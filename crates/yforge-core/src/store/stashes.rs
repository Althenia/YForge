use std::path::Path;

use rusqlite::params;

use super::{open, sql};
use crate::error::CoreError;
use crate::model::SwitchStash;
use crate::refs;
use crate::repo;
use crate::sqlite::unix_now;

pub(crate) fn record_switch_stash(
    dir: &Path,
    repository: &Path,
    branch: &str,
    sha: &str,
    message: &str,
) -> Result<(), CoreError> {
    open(dir)?
        .execute(
            "INSERT OR REPLACE INTO switch_stashes (repository, branch, sha, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                repository.to_string_lossy(),
                branch,
                sha,
                message,
                unix_now()
            ],
        )
        .map(drop)
        .map_err(sql(dir))
}

pub fn dismiss_switch_stash(
    dir: &Path,
    path: &Path,
    branch: &str,
    sha: &str,
) -> Result<(), CoreError> {
    let root = repo::resolve_root(path)?;
    open(dir)?
        .execute(
            "DELETE FROM switch_stashes WHERE repository = ?1 AND branch = ?2 AND sha = ?3",
            params![root.to_string_lossy(), branch, sha],
        )
        .map(drop)
        .map_err(sql(dir))
}

pub fn switch_stashes(
    dir: &Path,
    path: &Path,
    branch: &str,
) -> Result<Vec<SwitchStash>, CoreError> {
    let root = repo::open(path)?;
    let repository = root.to_string_lossy().into_owned();
    let conn = open(dir)?;
    let recorded = conn
        .prepare(
            "SELECT sha, message, created_at FROM switch_stashes
             WHERE repository = ?1 AND branch = ?2 ORDER BY seq DESC",
        )
        .and_then(|mut statement| {
            statement
                .query_map(params![repository, branch], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(sql(dir))?;
    let live = refs::read_stashes(&root)?;
    let mut offered = Vec::new();
    for (sha, message, created_at) in recorded {
        match live.iter().find(|entry| entry.sha == sha) {
            Some(entry) => offered.push(SwitchStash {
                branch: branch.to_owned(),
                sha,
                message,
                created_at,
                index: entry.index,
            }),
            None => {
                conn.execute(
                    "DELETE FROM switch_stashes WHERE repository = ?1 AND branch = ?2 AND sha = ?3",
                    params![repository, branch, sha],
                )
                .map_err(sql(dir))?;
            }
        }
    }
    Ok(offered)
}
