use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Row};

use super::{open, sql, state_path};
use crate::error::CoreError;
use crate::platform::{PlatformConnection, PlatformKind};
use crate::sqlite::{failure, unix_now};

const COLUMNS: &str = "id, kind, host, name, insecure_tls, created_at";

fn read_row(row: &Row<'_>) -> rusqlite::Result<(String, PlatformConnection)> {
    let kind: String = row.get(1)?;
    let connection = PlatformConnection {
        id: row.get(0)?,
        kind: PlatformKind::GitHub,
        host: row.get(2)?,
        name: row.get(3)?,
        insecure_tls: row.get(4)?,
        created_at: row.get(5)?,
    };
    Ok((kind, connection))
}

fn decode(
    dir: &Path,
    (kind, mut connection): (String, PlatformConnection),
) -> Result<PlatformConnection, CoreError> {
    connection.kind = PlatformKind::parse(&kind).ok_or_else(|| {
        failure(
            &state_path(dir),
            format!(
                "platform connection {} has an unknown kind `{kind}`",
                connection.id
            ),
        )
    })?;
    Ok(connection)
}

fn fresh_id(conn: &Connection, kind: PlatformKind) -> rusqlite::Result<String> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    loop {
        let id = format!("{}-{stamp:x}", kind.as_str());
        let taken: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM platform_connections WHERE id = ?1)",
            [&id],
            |row| row.get(0),
        )?;
        if !taken {
            return Ok(id);
        }
        stamp += 1;
    }
}

pub fn platform_connections_list(dir: &Path) -> Result<Vec<PlatformConnection>, CoreError> {
    let conn = open(dir)?;
    let rows = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM platform_connections ORDER BY seq"
        ))
        .and_then(|mut statement| {
            statement
                .query_map([], read_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    rows.into_iter().map(|row| decode(dir, row)).collect()
}

pub fn platform_connection_add(
    dir: &Path,
    kind: PlatformKind,
    host: &str,
    name: &str,
    insecure_tls: bool,
) -> Result<PlatformConnection, CoreError> {
    let conn = open(dir)?;
    let id = fresh_id(&conn, kind).map_err(sql(dir))?;
    let created_at = unix_now();
    conn.execute(
        "INSERT INTO platform_connections (id, kind, host, name, insecure_tls, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, kind.as_str(), host, name, insecure_tls, created_at],
    )
    .map_err(sql(dir))?;
    Ok(PlatformConnection {
        id,
        kind,
        host: host.to_owned(),
        name: name.to_owned(),
        insecure_tls,
        created_at,
    })
}

pub fn platform_connection_remove(dir: &Path, id: &str) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute("DELETE FROM platform_connections WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    if changed == 0 {
        return Err(CoreError::invalid_request(format!(
            "there is no platform connection `{id}`"
        )));
    }
    Ok(())
}
