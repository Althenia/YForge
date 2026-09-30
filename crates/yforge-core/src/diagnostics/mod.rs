mod crash;
mod redact;
mod usage;

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::error::CoreError;
use crate::sqlite::{failure, unix_now, Database};

pub use crash::{
    clear_crashes, export_crashes, list_crashes, record_crash, record_panic, CrashOrigin,
    CrashRecord, CrashReport, NewCrash,
};
pub use redact::Redactor;
pub use usage::{delete_usage, export_usage, list_usage, record_usage, UsageEvent, UsageRecord};

const RETENTION_SECONDS: i64 = 90 * 24 * 60 * 60;
const CRASH_LIMIT: i64 = 500;
const EVENT_LIMIT: i64 = 10_000;

const DIAGNOSTICS: Database = Database {
    file: "diagnostics.db",
    migrations,
};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![M::up(include_str!("schema.sql"))])
}

fn open(dir: &Path) -> Result<Connection, CoreError> {
    DIAGNOSTICS.open(dir)
}

fn sql(dir: &Path) -> impl Fn(rusqlite::Error) -> CoreError + '_ {
    move |error| failure(&DIAGNOSTICS.path(dir), error)
}

fn prune(conn: &Connection, table: &str, limit: i64) -> rusqlite::Result<usize> {
    conn.execute(
        &format!(
            "DELETE FROM {table} WHERE occurred_at < ?1
               OR id NOT IN (SELECT id FROM {table} ORDER BY id DESC LIMIT ?2)"
        ),
        rusqlite::params![unix_now() - RETENTION_SECONDS, limit],
    )
}

pub(crate) fn prepare(dir: &Path) -> Result<Option<PathBuf>, CoreError> {
    let moved = match DIAGNOSTICS.check_integrity(dir) {
        Ok(()) => None,
        Err(_) => Some(DIAGNOSTICS.move_aside(dir)?),
    };
    DIAGNOSTICS.prepare(dir)?;
    let conn = open(dir)?;
    prune(&conn, "crashes", CRASH_LIMIT)
        .and_then(|_| prune(&conn, "events", EVENT_LIMIT))
        .map_err(sql(dir))?;
    Ok(moved)
}
