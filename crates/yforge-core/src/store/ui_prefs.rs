use std::collections::HashSet;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{open, parse, put_setting, sql, state_path, stored_values};
use crate::error::CoreError;
use crate::model::GraphVisibility;
use crate::sqlite::{failure, unix_now};

const WIDTH_RANGE: std::ops::RangeInclusive<u32> = 24..=2000;
const MAX_FOLDERS: usize = 5000;
const MAX_REFS: usize = 500;
const MAX_NAME_CHARS: usize = 1024;
const MAX_PALETTE_RECENTS: usize = 8;
const MAX_PATH_CHARS: usize = 4096;
const PALETTE_RECENTS: &str = "ui.palette_recents";
const LAST_PARENT_FOLDER: &str = "ui.last_parent_folder";
const FILE_LIST_MODE: &str = "ui.file_list_mode";
const ZOOM_PERCENT: &str = "ui.zoom_percent";
const SIDEBAR_HIDDEN: &str = "ui.sidebar_hidden";
const INSPECTOR_HIDDEN: &str = "ui.inspector_hidden";
const SYNTAX_HIGHLIGHTING: &str = "ui.syntax_highlighting";
pub const ZOOM_STEPS: [u32; 9] = [80, 90, 100, 110, 125, 140, 150, 175, 200];
pub const DEFAULT_ZOOM_PERCENT: u32 = 100;

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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum FileListMode {
    #[default]
    Path,
    Tree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, deny_unknown_fields)]
pub struct AppUiPrefs {
    pub palette_recents: Vec<String>,
    #[ts(optional = nullable)]
    pub last_parent_folder: Option<String>,
    pub file_list_mode: FileListMode,
    pub zoom_percent: u32,
    pub sidebar_hidden: bool,
    pub inspector_hidden: bool,
    pub syntax_highlighting: bool,
}

impl Default for AppUiPrefs {
    fn default() -> Self {
        Self {
            palette_recents: Vec::new(),
            last_parent_folder: None,
            file_list_mode: FileListMode::default(),
            zoom_percent: DEFAULT_ZOOM_PERCENT,
            sidebar_hidden: false,
            inspector_hidden: false,
            syntax_highlighting: true,
        }
    }
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

fn validate_app(prefs: &AppUiPrefs) -> Result<(), CoreError> {
    if prefs.palette_recents.len() > MAX_PALETTE_RECENTS {
        return Err(invalid(format!(
            "at most {MAX_PALETTE_RECENTS} recent commands can be remembered"
        )));
    }
    let mut seen = HashSet::new();
    for command in &prefs.palette_recents {
        require_name("command id", command)?;
        if !seen.insert(command.as_str()) {
            return Err(invalid(format!("command {command} is listed twice")));
        }
    }
    if let Some(folder) = &prefs.last_parent_folder {
        if folder.trim().is_empty() || folder.chars().count() > MAX_PATH_CHARS {
            return Err(invalid(format!(
                "a parent folder must be 1 to {MAX_PATH_CHARS} characters"
            )));
        }
    }
    if !ZOOM_STEPS.contains(&prefs.zoom_percent) {
        return Err(invalid(format!(
            "the zoom must be one of {}",
            ZOOM_STEPS.map(|step| format!("{step}%")).join(", ")
        )));
    }
    Ok(())
}

pub fn app_ui_prefs_load(dir: &Path) -> Result<AppUiPrefs, CoreError> {
    let conn = open(dir)?;
    let stored = stored_values(
        &conn,
        "SELECT key, value FROM settings WHERE key IN (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        [
            PALETTE_RECENTS,
            LAST_PARENT_FOLDER,
            FILE_LIST_MODE,
            ZOOM_PERCENT,
            SIDEBAR_HIDDEN,
            INSPECTOR_HIDDEN,
            SYNTAX_HIGHLIGHTING,
        ],
    )
    .map_err(sql(dir))?;
    Ok(AppUiPrefs {
        palette_recents: parse(dir, &stored, PALETTE_RECENTS, Vec::new())?,
        last_parent_folder: parse(dir, &stored, LAST_PARENT_FOLDER, None)?,
        file_list_mode: parse(dir, &stored, FILE_LIST_MODE, FileListMode::Path)?,
        zoom_percent: parse(dir, &stored, ZOOM_PERCENT, DEFAULT_ZOOM_PERCENT)?,
        sidebar_hidden: parse(dir, &stored, SIDEBAR_HIDDEN, false)?,
        inspector_hidden: parse(dir, &stored, INSPECTOR_HIDDEN, false)?,
        syntax_highlighting: parse(dir, &stored, SYNTAX_HIGHLIGHTING, true)?,
    })
}

pub fn app_ui_prefs_save(dir: &Path, prefs: &AppUiPrefs) -> Result<(), CoreError> {
    validate_app(prefs)?;
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    put_setting(&tx, PALETTE_RECENTS, &prefs.palette_recents).map_err(sql(dir))?;
    put_setting(&tx, LAST_PARENT_FOLDER, &prefs.last_parent_folder).map_err(sql(dir))?;
    put_setting(&tx, FILE_LIST_MODE, &prefs.file_list_mode).map_err(sql(dir))?;
    put_setting(&tx, ZOOM_PERCENT, &prefs.zoom_percent).map_err(sql(dir))?;
    put_setting(&tx, SIDEBAR_HIDDEN, &prefs.sidebar_hidden).map_err(sql(dir))?;
    put_setting(&tx, INSPECTOR_HIDDEN, &prefs.inspector_hidden).map_err(sql(dir))?;
    put_setting(&tx, SYNTAX_HIGHLIGHTING, &prefs.syntax_highlighting).map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))
}
