use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{open, sql};
use crate::activity::OperationKind;
use crate::ai::ProviderKind;
use crate::error::{CoreError, ErrorKind};
use crate::sqlite::{failure, page_cursor, page_limit, unix_now, write_json};
use crate::store::load_settings;

const SCHEMA_VERSION: u32 = 1;
const BATCH: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageEvent {
    pub kind: OperationKind,
    pub ok: bool,
    pub error_kind: Option<ErrorKind>,
    pub duration_ms: u32,
    pub count: u32,
    pub correlation_id: u32,
    pub provider: Option<ProviderKind>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct UsageRecord {
    pub id: u32,
    pub occurred_at: i64,
    pub app_version: String,
    pub event: OperationKind,
    pub ok: bool,
    pub error_kind: Option<ErrorKind>,
    pub duration_ms: u32,
    pub count: u32,
    pub correlation_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub provider: Option<ProviderKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Attributes {
    app_version: String,
    ok: bool,
    error_kind: Option<ErrorKind>,
    duration_ms: u32,
    count: u32,
    correlation_id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider: Option<ProviderKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

struct Stored {
    id: u32,
    occurred_at: i64,
    kind: String,
    schema_version: u32,
    attributes: String,
}

pub fn record_usage(dir: &Path, app_version: &str, event: &UsageEvent) -> Result<(), CoreError> {
    if !load_settings(dir)?.telemetry_opt_in {
        return Ok(());
    }
    let attributes = serde_json::to_string(&Attributes {
        app_version: app_version.to_owned(),
        ok: event.ok,
        error_kind: event.error_kind,
        duration_ms: event.duration_ms,
        count: event.count,
        correlation_id: event.correlation_id,
        provider: event.provider,
        model: event.model.clone(),
    })
    .map_err(|error| failure(dir, error))?;
    let kind = serde_json::to_value(event.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| failure(dir, "operation kind is not text"))?;
    open(dir)?
        .execute(
            "INSERT INTO events (occurred_at, kind, schema_version, attrs) VALUES (?1, ?2, ?3, ?4)",
            params![unix_now(), kind, SCHEMA_VERSION, attributes],
        )
        .map(drop)
        .map_err(sql(dir))
}

fn stored_page(conn: &Connection, before: i64, limit: usize) -> rusqlite::Result<Vec<Stored>> {
    conn.prepare(
        "SELECT id, occurred_at, kind, schema_version, attrs FROM events
         WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
    )?
    .query_map(
        params![before, i64::try_from(limit).unwrap_or(i64::MAX)],
        |row| {
            Ok(Stored {
                id: row.get(0)?,
                occurred_at: row.get(1)?,
                kind: row.get(2)?,
                schema_version: row.get(3)?,
                attributes: row.get(4)?,
            })
        },
    )?
    .collect()
}

fn decode(dir: &Path, stored: Stored) -> Result<Option<UsageRecord>, CoreError> {
    if stored.schema_version > SCHEMA_VERSION {
        return Ok(None);
    }
    let Ok(event) = serde_json::from_value(serde_json::Value::String(stored.kind)) else {
        return Ok(None);
    };
    let attributes: Attributes = serde_json::from_str(&stored.attributes).map_err(|error| {
        failure(
            &super::DIAGNOSTICS.path(dir),
            format!("event {} has unreadable attributes: {error}", stored.id),
        )
    })?;
    Ok(Some(UsageRecord {
        id: stored.id,
        occurred_at: stored.occurred_at,
        app_version: attributes.app_version,
        event,
        ok: attributes.ok,
        error_kind: attributes.error_kind,
        duration_ms: attributes.duration_ms,
        count: attributes.count,
        correlation_id: attributes.correlation_id,
        provider: attributes.provider,
        model: attributes.model,
    }))
}

fn collect(dir: &Path, before: i64, wanted: usize) -> Result<Vec<UsageRecord>, CoreError> {
    let conn = open(dir)?;
    let batch = wanted.min(BATCH);
    let mut cursor = before;
    let mut found = Vec::new();
    loop {
        let rows = stored_page(&conn, cursor, batch).map_err(sql(dir))?;
        let fetched = rows.len();
        for stored in rows {
            cursor = i64::from(stored.id);
            if let Some(record) = decode(dir, stored)? {
                found.push(record);
                if found.len() == wanted {
                    return Ok(found);
                }
            }
        }
        if fetched < batch {
            return Ok(found);
        }
    }
}

pub fn list_usage(
    dir: &Path,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<UsageRecord>, CoreError> {
    collect(
        dir,
        page_cursor(before),
        usize::try_from(page_limit(limit)).unwrap_or(1),
    )
}

pub fn export_usage(dir: &Path, path: &Path) -> Result<u32, CoreError> {
    let records = collect(dir, i64::MAX, usize::MAX)?;
    write_json(path, &records)?;
    u32::try_from(records.len()).map_err(|error| failure(path, error))
}

pub fn delete_usage(dir: &Path) -> Result<(), CoreError> {
    open(dir)?
        .execute("DELETE FROM events", [])
        .map(drop)
        .map_err(sql(dir))
}
