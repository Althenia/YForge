use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Row};

use super::{open, sql, state_path};
use crate::error::CoreError;
use crate::jira::{jira_site_host, JiraConnection, JiraKind, JiraProject};
use crate::sqlite::{failure, unix_now};

const COLUMNS: &str = "id, kind, site, email, display_name, projects, created_at";

type Stored = (String, String, JiraConnection);

fn read_row(row: &Row<'_>) -> rusqlite::Result<Stored> {
    let site: String = row.get(2)?;
    let kind: String = row.get(1)?;
    let projects: String = row.get(5)?;
    let connection = JiraConnection {
        id: row.get(0)?,
        kind: JiraKind::Cloud,
        host: jira_site_host(&site),
        site,
        email: row.get(3)?,
        display_name: row.get(4)?,
        projects: Vec::new(),
        created_at: row.get(6)?,
    };
    Ok((kind, projects, connection))
}

fn decode(
    dir: &Path,
    (kind, projects, mut connection): Stored,
) -> Result<JiraConnection, CoreError> {
    let broken = |detail: String| failure(&state_path(dir), detail);
    connection.kind = JiraKind::parse(&kind).ok_or_else(|| {
        broken(format!(
            "jira connection {} has an unknown kind `{kind}`",
            connection.id
        ))
    })?;
    connection.projects = serde_json::from_str(&projects).map_err(|error| {
        broken(format!(
            "jira connection {} has unreadable projects: {error}",
            connection.id
        ))
    })?;
    Ok(connection)
}

fn encode_projects(dir: &Path, projects: &[JiraProject]) -> Result<String, CoreError> {
    serde_json::to_string(projects).map_err(|error| failure(&state_path(dir), error))
}

fn fresh_id(conn: &Connection, kind: JiraKind) -> rusqlite::Result<String> {
    let mut stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    loop {
        let id = format!("jira-{}-{stamp:x}", kind.as_str());
        let taken: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM jira_connections WHERE id = ?1)",
            [&id],
            |row| row.get(0),
        )?;
        if !taken {
            return Ok(id);
        }
        stamp += 1;
    }
}

pub fn jira_connections_list(dir: &Path) -> Result<Vec<JiraConnection>, CoreError> {
    let conn = open(dir)?;
    let rows = conn
        .prepare(&format!(
            "SELECT {COLUMNS} FROM jira_connections ORDER BY seq"
        ))
        .and_then(|mut statement| {
            statement
                .query_map([], read_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    rows.into_iter().map(|row| decode(dir, row)).collect()
}

pub fn jira_connection_add(
    dir: &Path,
    kind: JiraKind,
    site: &str,
    email: Option<&str>,
    display_name: &str,
    projects: &[JiraProject],
) -> Result<JiraConnection, CoreError> {
    let conn = open(dir)?;
    let id = fresh_id(&conn, kind).map_err(sql(dir))?;
    let created_at = unix_now();
    conn.execute(
        "INSERT INTO jira_connections (id, kind, site, email, display_name, projects, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            kind.as_str(),
            site,
            email,
            display_name,
            encode_projects(dir, projects)?,
            created_at
        ],
    )
    .map_err(sql(dir))?;
    Ok(JiraConnection {
        id,
        kind,
        host: jira_site_host(site),
        site: site.to_owned(),
        email: email.map(str::to_owned),
        display_name: display_name.to_owned(),
        projects: projects.to_vec(),
        created_at,
    })
}

pub fn jira_connection_update(
    dir: &Path,
    id: &str,
    display_name: &str,
    projects: &[JiraProject],
) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute(
            "UPDATE jira_connections SET display_name = ?2, projects = ?3 WHERE id = ?1",
            params![id, display_name, encode_projects(dir, projects)?],
        )
        .map_err(sql(dir))?;
    missing_unless_changed(changed, id)
}

pub fn jira_connection_remove(dir: &Path, id: &str) -> Result<(), CoreError> {
    let changed = open(dir)?
        .execute("DELETE FROM jira_connections WHERE id = ?1", [id])
        .map_err(sql(dir))?;
    missing_unless_changed(changed, id)
}

fn missing_unless_changed(changed: usize, id: &str) -> Result<(), CoreError> {
    if changed == 0 {
        return Err(CoreError::invalid_request(format!(
            "there is no Jira connection `{id}`"
        )));
    }
    Ok(())
}
