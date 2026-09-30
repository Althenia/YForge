use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{open, parse, put_setting, sql, state_path, stored_values};
use crate::ai::{ProviderConfig, ProviderKind};
use crate::error::CoreError;
use crate::sqlite::{failure, unix_now};

const ACTIVE_PROVIDER: &str = "ai.active_provider";
const COLUMNS: &str = "id, kind, name, base_url, model, executable_path, has_api_key, created_at";

fn read_row(row: &Row<'_>) -> rusqlite::Result<(String, ProviderConfig)> {
    let kind: String = row.get(1)?;
    let config = ProviderConfig {
        id: row.get(0)?,
        kind: ProviderKind::Chatgpt,
        name: row.get(2)?,
        base_url: row.get(3)?,
        model: row.get(4)?,
        executable_path: row.get(5)?,
        has_api_key: row.get(6)?,
        created_at: row.get(7)?,
    };
    Ok((kind, config))
}

fn decode(
    dir: &Path,
    (kind, mut config): (String, ProviderConfig),
) -> Result<ProviderConfig, CoreError> {
    config.kind = ProviderKind::parse(&kind).ok_or_else(|| {
        failure(
            &state_path(dir),
            format!("AI provider {} has an unknown kind `{kind}`", config.id),
        )
    })?;
    Ok(config)
}

fn find(conn: &Connection, id: &str) -> rusqlite::Result<Option<(String, ProviderConfig)>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM ai_providers WHERE id = ?1"),
        [id],
        read_row,
    )
    .optional()
}

fn missing(id: &str) -> CoreError {
    CoreError::invalid_request(format!("there is no AI provider `{id}`"))
}

fn fresh_id(conn: &Connection, kind: ProviderKind) -> rusqlite::Result<String> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    loop {
        let id = format!("{}-{stamp:x}", kind.as_str());
        if find(conn, &id)?.is_none() {
            return Ok(id);
        }
        stamp += 1;
    }
}

pub fn ai_providers(dir: &Path) -> Result<Vec<ProviderConfig>, CoreError> {
    let conn = open(dir)?;
    let rows = conn
        .prepare(&format!("SELECT {COLUMNS} FROM ai_providers ORDER BY seq"))
        .and_then(|mut statement| {
            statement
                .query_map([], read_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    rows.into_iter().map(|row| decode(dir, row)).collect()
}

pub fn ai_provider(dir: &Path, id: &str) -> Result<ProviderConfig, CoreError> {
    let conn = open(dir)?;
    match find(&conn, id).map_err(sql(dir))? {
        Some(row) => decode(dir, row),
        None => Err(missing(id)),
    }
}

pub fn ai_provider_add(
    dir: &Path,
    kind: ProviderKind,
    name: &str,
    base_url: Option<&str>,
    executable_path: Option<&str>,
) -> Result<ProviderConfig, CoreError> {
    let conn = open(dir)?;
    let id = fresh_id(&conn, kind).map_err(sql(dir))?;
    let created_at = unix_now();
    conn.execute(
        "INSERT INTO ai_providers (id, kind, name, base_url, model, executable_path, has_api_key, created_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, 0, ?6)",
        params![id, kind.as_str(), name, base_url, executable_path, created_at],
    )
    .map_err(sql(dir))?;
    Ok(ProviderConfig {
        id,
        kind,
        name: name.to_owned(),
        base_url: base_url.map(str::to_owned),
        model: None,
        executable_path: executable_path.map(str::to_owned),
        has_api_key: false,
        created_at,
    })
}

pub fn ai_provider_edit(
    dir: &Path,
    id: &str,
    name: &str,
    base_url: Option<&str>,
    executable_path: Option<&str>,
) -> Result<ProviderConfig, CoreError> {
    let conn = open(dir)?;
    let changed = conn
        .execute(
            "UPDATE ai_providers SET name = ?2, base_url = ?3, executable_path = ?4 WHERE id = ?1",
            params![id, name, base_url, executable_path],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    ai_provider(dir, id)
}

pub fn ai_provider_key_flag(dir: &Path, id: &str, has_api_key: bool) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute(
            "UPDATE ai_providers SET has_api_key = ?2 WHERE id = ?1",
            params![id, has_api_key],
        )
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    Ok(())
}

pub fn ai_provider_delete(dir: &Path, id: &str) -> Result<(), CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    let changed = tx
        .execute("DELETE FROM ai_providers WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(missing(id));
    }
    if active_in(&tx, dir)?.as_deref() == Some(id) {
        tx.execute("DELETE FROM settings WHERE key = ?1", [ACTIVE_PROVIDER])
            .map_err(sql(dir))?;
    }
    tx.commit().map_err(sql(dir))
}

fn active_in(conn: &Connection, dir: &Path) -> Result<Option<String>, CoreError> {
    let stored = stored_values(
        conn,
        "SELECT key, value FROM settings WHERE key = ?1",
        [ACTIVE_PROVIDER],
    )
    .map_err(sql(dir))?;
    parse(dir, &stored, ACTIVE_PROVIDER, None)
}

pub fn ai_active_provider(dir: &Path) -> Result<Option<String>, CoreError> {
    active_in(&open(dir)?, dir)
}

pub fn ai_choose(dir: &Path, id: Option<&str>, model: Option<&str>) -> Result<(), CoreError> {
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    match id {
        None => {
            tx.execute("DELETE FROM settings WHERE key = ?1", [ACTIVE_PROVIDER])
                .map_err(sql(dir))?;
        }
        Some(id) => {
            let model = model.map(str::trim).filter(|model| !model.is_empty());
            let changed = tx
                .execute(
                    "UPDATE ai_providers SET model = ?2 WHERE id = ?1",
                    params![id, model],
                )
                .map_err(sql(dir))?;
            if changed == 0 {
                return Err(missing(id));
            }
            put_setting(&tx, ACTIVE_PROVIDER, &id).map_err(sql(dir))?;
        }
    }
    tx.commit().map_err(sql(dir))
}
