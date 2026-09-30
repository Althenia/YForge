use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{open, sql, state_path};
use crate::error::CoreError;
use crate::model::GraphVisibility;
use crate::sqlite::{failure, unix_now};

const WIDTH_RANGE: std::ops::RangeInclusive<u32> = 24..=2000;
const MAX_FOLDERS: usize = 5000;
const MAX_REFS: usize = 500;
const MAX_NAME_CHARS: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GraphColumn {
    Refs,
    Author,
    Date,
    Sha,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ColumnPref {
    pub column: GraphColumn,
    pub visible: bool,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub width: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct RepoUiPrefs {
    pub columns: Vec<ColumnPref>,
    pub collapsed_folders: Vec<String>,
    pub branch_visibility: GraphVisibility,
}

fn invalid(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_request(detail)
}

fn require_name(kind: &str, name: &str) -> Result<(), CoreError> {
    if name.trim().is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid(format!(
            "a {kind} must be 1 to {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(())
}

fn validate(prefs: &RepoUiPrefs) -> Result<(), CoreError> {
    let mut seen = HashSet::new();
    for column in &prefs.columns {
        if !seen.insert(column.column) {
            return Err(invalid(format!("{:?} is listed twice", column.column)));
        }
        if column.column == GraphColumn::Refs && !column.visible {
            return Err(invalid("the branch and tag column cannot be hidden"));
        }
        if column
            .width
            .is_some_and(|width| !WIDTH_RANGE.contains(&width))
        {
            return Err(invalid(format!(
                "a column width must be {} to {} pixels",
                WIDTH_RANGE.start(),
                WIDTH_RANGE.end()
            )));
        }
    }
    if prefs.collapsed_folders.len() > MAX_FOLDERS {
        return Err(invalid(format!(
            "at most {MAX_FOLDERS} folders can be remembered"
        )));
    }
    let mut folders = HashSet::new();
    for folder in &prefs.collapsed_folders {
        require_name("folder", folder)?;
        if !folders.insert(folder.as_str()) {
            return Err(invalid(format!("folder {folder} is listed twice")));
        }
    }
    if let GraphVisibility::Refs { refs } = &prefs.branch_visibility {
        if refs.len() > MAX_REFS {
            return Err(invalid(format!("at most {MAX_REFS} refs can be shown")));
        }
        let mut names = HashSet::new();
        for selector in refs {
            require_name("ref name", &selector.name)?;
            if !names.insert((selector.name.as_str(), selector.kind)) {
                return Err(invalid(format!("ref {} is listed twice", selector.name)));
            }
        }
    }
    Ok(())
}

pub fn repo_ui_prefs_load(dir: &Path, repository: &str) -> Result<RepoUiPrefs, CoreError> {
    let stored: Option<String> = open(dir)?
        .query_row(
            "SELECT prefs FROM repo_ui_prefs WHERE repository = ?1",
            [repository],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql(dir))?;
    match stored {
        None => Ok(RepoUiPrefs::default()),
        Some(blob) => serde_json::from_str(&blob).map_err(|error| {
            failure(
                &state_path(dir),
                format!("the interface preferences of {repository} are invalid: {error}"),
            )
        }),
    }
}

pub fn repo_ui_prefs_save(
    dir: &Path,
    repository: &str,
    prefs: &RepoUiPrefs,
) -> Result<(), CoreError> {
    require_name("repository path", repository)?;
    validate(prefs)?;
    let blob = serde_json::to_string(prefs).map_err(|error| failure(&state_path(dir), error))?;
    open(dir)?
        .execute(
            "INSERT INTO repo_ui_prefs (repository, prefs, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (repository) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at",
            params![repository, blob, unix_now()],
        )
        .map(drop)
        .map_err(sql(dir))
}
