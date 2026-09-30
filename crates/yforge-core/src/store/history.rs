use std::path::Path;

use rusqlite::{params, Connection, Row};

use super::{open, sql};
use crate::activity::{ActivityEntry, CommandRecord, UndoStatus};
use crate::error::CoreError;
use crate::sqlite::{failure, page_cursor, page_limit};

const RETAINED_PER_REPOSITORY: i64 = 1_000;

fn undo_columns(undo: &UndoStatus) -> (&'static str, Option<&str>) {
    match undo {
        UndoStatus::Available { scope } => ("available", Some(scope)),
        UndoStatus::Unavailable { reason } => ("unavailable", Some(reason)),
        UndoStatus::Undone => ("undone", None),
    }
}

fn undo_status(kind: &str, detail: Option<String>) -> rusqlite::Result<UndoStatus> {
    let detail = detail.unwrap_or_default();
    match kind {
        "available" => Ok(UndoStatus::Available { scope: detail }),
        "unavailable" => Ok(UndoStatus::Unavailable { reason: detail }),
        "undone" => Ok(UndoStatus::Undone),
        other => Err(rusqlite::Error::InvalidColumnType(
            0,
            format!("undo_kind {other}"),
            rusqlite::types::Type::Text,
        )),
    }
}

pub fn append_activity(dir: &Path, entry: &ActivityEntry) -> Result<u32, CoreError> {
    let mut conn = open(dir)?;
    let mut insert = || -> rusqlite::Result<i64> {
        let tx = conn.transaction()?;
        let (kind, detail) = undo_columns(&entry.undo);
        tx.execute(
            "INSERT INTO activity (repo, operation, summary, started_at, duration_ms, succeeded,
                                   is_local, toast, error, undo_kind, undo_detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                entry.repo,
                entry.operation,
                entry.summary,
                entry.started_at,
                entry.duration_ms,
                entry.ok,
                entry.local,
                entry.toast,
                entry.error,
                kind,
                detail
            ],
        )?;
        let id = tx.last_insert_rowid();
        for (position, record) in (0_i64..).zip(&entry.commands) {
            tx.execute(
                "INSERT INTO activity_commands (activity_id, position, command, status, duration_ms, output)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, position, record.command, record.status, record.duration_ms, record.output],
            )?;
        }
        tx.execute(
            "DELETE FROM activity WHERE repo = ?1
               AND id NOT IN (SELECT id FROM activity WHERE repo = ?1 ORDER BY id DESC LIMIT ?2)",
            params![entry.repo, RETAINED_PER_REPOSITORY],
        )?;
        tx.commit()?;
        Ok(id)
    };
    let id = insert().map_err(sql(dir))?;
    u32::try_from(id).map_err(|error| failure(&super::state_path(dir), error))
}

fn commands(conn: &Connection, id: i64) -> rusqlite::Result<Vec<CommandRecord>> {
    conn.prepare(
        "SELECT command, status, duration_ms, output FROM activity_commands
         WHERE activity_id = ?1 ORDER BY position",
    )?
    .query_map([id], |row| {
        Ok(CommandRecord {
            command: row.get(0)?,
            status: row.get(1)?,
            duration_ms: row.get(2)?,
            output: row.get(3)?,
        })
    })?
    .collect()
}

fn entry(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<ActivityEntry> {
    let id: i64 = row.get(0)?;
    Ok(ActivityEntry {
        id: row.get(0)?,
        repo: row.get(1)?,
        operation: row.get(2)?,
        summary: row.get(3)?,
        started_at: row.get(4)?,
        duration_ms: row.get(5)?,
        ok: row.get(6)?,
        local: row.get(7)?,
        toast: row.get(8)?,
        error: row.get(9)?,
        commands: commands(conn, id)?,
        undo: undo_status(&row.get::<_, String>(10)?, row.get(11)?)?,
    })
}

pub fn activity_history(
    dir: &Path,
    repo: &str,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<ActivityEntry>, CoreError> {
    let conn = open(dir)?;
    let read = || -> rusqlite::Result<Vec<ActivityEntry>> {
        conn.prepare(
            "SELECT id, repo, operation, summary, started_at, duration_ms, succeeded, is_local,
                    toast, error, undo_kind, undo_detail
             FROM activity WHERE repo = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
        )?
        .query_map(
            params![repo, page_cursor(before), page_limit(limit)],
            |row| entry(&conn, row),
        )?
        .collect()
    };
    read().map_err(sql(dir))
}

pub fn mark_activity_undone(dir: &Path, id: u32) -> Result<(), CoreError> {
    open(dir)?
        .execute(
            "UPDATE activity SET undo_kind = 'undone', undo_detail = NULL WHERE id = ?1",
            [id],
        )
        .map(drop)
        .map_err(sql(dir))
}

pub fn clear_activity(dir: &Path, repo: Option<&str>) -> Result<(), CoreError> {
    let conn = open(dir)?;
    match repo {
        Some(repo) => conn.execute("DELETE FROM activity WHERE repo = ?1", [repo]),
        None => conn.execute("DELETE FROM activity", []),
    }
    .map(drop)
    .map_err(sql(dir))
}
