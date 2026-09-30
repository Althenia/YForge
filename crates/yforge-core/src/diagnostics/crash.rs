use std::path::Path;
use std::time::Duration;

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{open, sql, DIAGNOSTICS};
use crate::error::CoreError;
use crate::sqlite::{failure, page_cursor, page_limit, unix_now, write_json};
use crate::Redactor;

const PANIC_BUSY_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CrashOrigin {
    Rust,
    Frontend,
}

impl CrashOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::Frontend => "frontend",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CrashRecord {
    pub id: u32,
    pub occurred_at: i64,
    pub origin: CrashOrigin,
    pub kind: String,
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub thread: Option<String>,
    pub message: String,
    pub location: Option<String>,
    pub stack: Option<String>,
    pub view: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
pub struct CrashReport {
    pub kind: String,
    pub message: String,
    pub stack: Option<String>,
    pub view: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewCrash {
    pub origin: CrashOrigin,
    pub kind: String,
    pub thread: Option<String>,
    pub message: String,
    pub location: Option<String>,
    pub stack: Option<String>,
    pub view: Option<String>,
}

impl From<CrashReport> for NewCrash {
    fn from(report: CrashReport) -> Self {
        Self {
            origin: CrashOrigin::Frontend,
            kind: report.kind,
            thread: None,
            message: report.message,
            location: None,
            stack: report.stack,
            view: report.view,
        }
    }
}

fn insert(
    conn: &Connection,
    app_version: &str,
    redactor: &Redactor,
    crash: &NewCrash,
) -> rusqlite::Result<()> {
    let redacted = |text: &Option<String>| text.as_deref().map(|text| redactor.redact(text));
    conn.execute(
        "INSERT INTO crashes (occurred_at, origin, kind, app_version, os, arch, thread, message,
                              location, stack, view)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            unix_now(),
            crash.origin.as_str(),
            redactor.redact(&crash.kind),
            app_version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            redacted(&crash.thread),
            redactor.redact(&crash.message),
            redacted(&crash.location),
            redacted(&crash.stack),
            redacted(&crash.view),
        ],
    )
    .map(drop)
}

pub fn record_crash(
    dir: &Path,
    app_version: &str,
    redactor: &Redactor,
    crash: &NewCrash,
) -> Result<(), CoreError> {
    insert(&open(dir)?, app_version, redactor, crash).map_err(sql(dir))?;
    Ok(())
}

pub fn record_panic(
    dir: &Path,
    app_version: &str,
    redactor: &Redactor,
    crash: &NewCrash,
) -> Result<(), CoreError> {
    let conn = DIAGNOSTICS.connect(dir, PANIC_BUSY_TIMEOUT)?;
    insert(&conn, app_version, redactor, crash).map_err(sql(dir))
}

fn record(row: &Row<'_>) -> rusqlite::Result<CrashRecord> {
    let origin = match row.get::<_, String>(2)?.as_str() {
        "rust" => CrashOrigin::Rust,
        "frontend" => CrashOrigin::Frontend,
        other => {
            return Err(rusqlite::Error::InvalidColumnType(
                2,
                format!("origin {other}"),
                rusqlite::types::Type::Text,
            ))
        }
    };
    Ok(CrashRecord {
        id: row.get(0)?,
        occurred_at: row.get(1)?,
        origin,
        kind: row.get(3)?,
        app_version: row.get(4)?,
        os: row.get(5)?,
        arch: row.get(6)?,
        thread: row.get(7)?,
        message: row.get(8)?,
        location: row.get(9)?,
        stack: row.get(10)?,
        view: row.get(11)?,
    })
}

fn page(dir: &Path, before: i64, limit: i64) -> Result<Vec<CrashRecord>, CoreError> {
    let conn = open(dir)?;
    conn.prepare(
        "SELECT id, occurred_at, origin, kind, app_version, os, arch, thread, message, location,
                stack, view
         FROM crashes WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
    )
    .and_then(|mut statement| {
        statement
            .query_map(params![before, limit], record)?
            .collect()
    })
    .map_err(sql(dir))
}

pub fn list_crashes(
    dir: &Path,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<CrashRecord>, CoreError> {
    page(dir, page_cursor(before), page_limit(limit))
}

pub fn export_crashes(dir: &Path, path: &Path) -> Result<u32, CoreError> {
    let records = page(dir, i64::MAX, i64::MAX)?;
    write_json(path, &records)?;
    u32::try_from(records.len()).map_err(|error| failure(path, error))
}

pub fn clear_crashes(dir: &Path) -> Result<(), CoreError> {
    open(dir)?
        .execute("DELETE FROM crashes", [])
        .map(drop)
        .map_err(sql(dir))
}
