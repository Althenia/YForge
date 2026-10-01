use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{open, sql};
use crate::error::CoreError;

const ALIAS_LIMIT: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RepoAlias {
    pub path: String,
    pub alias: String,
}

pub fn repo_alias_problem(alias: &str) -> Option<String> {
    let trimmed = alias.trim();
    if trimmed.is_empty() {
        Some("Enter an alias".to_owned())
    } else if trimmed.chars().count() > ALIAS_LIMIT {
        Some(format!("An alias is at most {ALIAS_LIMIT} characters"))
    } else {
        None
    }
}

fn read_all(dir: &Path) -> Result<Vec<RepoAlias>, CoreError> {
    open(dir)?
        .prepare("SELECT path, alias FROM repo_aliases ORDER BY path")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok(RepoAlias {
                        path: row.get(0)?,
                        alias: row.get(1)?,
                    })
                })?
                .collect()
        })
        .map_err(sql(dir))
}

pub fn repo_aliases_list(dir: &Path) -> Result<Vec<RepoAlias>, CoreError> {
    read_all(dir)
}

pub fn repo_aliases_set(
    dir: &Path,
    path: &str,
    alias: Option<&str>,
) -> Result<Vec<RepoAlias>, CoreError> {
    if path.trim().is_empty() {
        return Err(CoreError::invalid_request(
            "an alias belongs to a repository path",
        ));
    }
    if let Some(problem) = alias.and_then(repo_alias_problem) {
        return Err(CoreError::invalid_request(problem));
    }
    let conn = open(dir)?;
    match alias {
        Some(alias) => conn.execute(
            "INSERT INTO repo_aliases (path, alias) VALUES (?1, ?2)
             ON CONFLICT (path) DO UPDATE SET alias = excluded.alias",
            params![path, alias.trim()],
        ),
        None => conn.execute("DELETE FROM repo_aliases WHERE path = ?1", [path]),
    }
    .map_err(sql(dir))?;
    read_all(dir)
}
