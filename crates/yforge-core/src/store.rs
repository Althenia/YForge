use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::clone::valid_default_branch;
use crate::error::CoreError;
use crate::model::{AheadBehind, ChangeCounts, Head, PullMode};
use crate::repo;

const RECENT_LIMIT: usize = 30;
const AUTO_FETCH_CHOICES: [u32; 4] = [0, 5, 10, 30];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    Compact,
    Default,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default)]
pub struct AppSettings {
    pub theme: Theme,
    pub density: Density,
    pub default_branch: String,
    pub pull_mode: PullMode,
    pub auto_fetch_minutes: u32,
    pub editor_command: String,
    pub terminal_command: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            density: Density::Default,
            default_branch: "main".to_owned(),
            pull_mode: PullMode::FastForwardOrMerge,
            auto_fetch_minutes: 0,
            editor_command: String::new(),
            terminal_command: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RepoSettings {
    pub pull_mode: Option<PullMode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecentRepo {
    pub path: String,
    pub opened_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TabSession {
    pub tabs: Vec<String>,
    pub active: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecentStatus {
    pub path: String,
    pub exists: bool,
    pub branch: Option<String>,
    pub unborn: bool,
    pub ahead_behind: Option<AheadBehind>,
    pub counts: Option<ChangeCounts>,
    pub worktrees: u32,
}

fn failure(path: &Path, detail: impl ToString) -> CoreError {
    CoreError::StorageFailed {
        path: path.display().to_string(),
        detail: detail.to_string(),
    }
}

fn read<T: DeserializeOwned + Default>(dir: &Path, name: &str) -> Result<T, CoreError> {
    let path = dir.join(name);
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|error| failure(&path, error)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(failure(&path, error)),
    }
}

fn write<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), CoreError> {
    let path = dir.join(name);
    fs::create_dir_all(dir).map_err(|error| failure(dir, error))?;
    let staged = dir.join(format!("{name}.tmp"));
    let text = serde_json::to_string_pretty(value).map_err(|error| failure(&path, error))?;
    fs::write(&staged, text).map_err(|error| failure(&staged, error))?;
    fs::rename(&staged, &path).map_err(|error| failure(&path, error))
}

pub fn load_settings(dir: &Path) -> Result<AppSettings, CoreError> {
    read(dir, "settings.json")
}

pub fn save_settings(dir: &Path, settings: &AppSettings) -> Result<(), CoreError> {
    let default_branch = valid_default_branch(&settings.default_branch)?;
    if !AUTO_FETCH_CHOICES.contains(&settings.auto_fetch_minutes) {
        return Err(CoreError::invalid_request(
            "auto-fetch must be off, 5, 10, or 30 minutes",
        ));
    }
    write(
        dir,
        "settings.json",
        &AppSettings {
            default_branch,
            ..settings.clone()
        },
    )
}

pub fn load_repo_settings(dir: &Path, repository: &str) -> Result<RepoSettings, CoreError> {
    let all: BTreeMap<String, RepoSettings> = read(dir, "repositories.json")?;
    Ok(all.get(repository).cloned().unwrap_or_default())
}

pub fn save_repo_settings(
    dir: &Path,
    repository: &str,
    settings: &RepoSettings,
) -> Result<(), CoreError> {
    let mut all: BTreeMap<String, RepoSettings> = read(dir, "repositories.json")?;
    if *settings == RepoSettings::default() {
        all.remove(repository);
    } else {
        all.insert(repository.to_owned(), settings.clone());
    }
    write(dir, "repositories.json", &all)
}

pub fn load_recents(dir: &Path) -> Result<Vec<RecentRepo>, CoreError> {
    read(dir, "recents.json")
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_secs()).ok())
        .unwrap_or_default()
}

pub fn add_recent(dir: &Path, repository: &str) -> Result<Vec<RecentRepo>, CoreError> {
    let mut recents = load_recents(dir)?;
    recents.retain(|recent| recent.path != repository);
    recents.insert(
        0,
        RecentRepo {
            path: repository.to_owned(),
            opened_at: now(),
        },
    );
    recents.truncate(RECENT_LIMIT);
    write(dir, "recents.json", &recents)?;
    Ok(recents)
}

pub fn remove_recent(dir: &Path, repository: &str) -> Result<Vec<RecentRepo>, CoreError> {
    let mut recents = load_recents(dir)?;
    recents.retain(|recent| recent.path != repository);
    write(dir, "recents.json", &recents)?;
    Ok(recents)
}

pub fn load_session(dir: &Path) -> Result<TabSession, CoreError> {
    read(dir, "session.json")
}

pub fn save_session(dir: &Path, session: &TabSession) -> Result<(), CoreError> {
    write(dir, "session.json", session)
}

pub fn recent_status(path: &Path) -> RecentStatus {
    let missing = || RecentStatus {
        path: path.display().to_string(),
        exists: false,
        branch: None,
        unborn: false,
        ahead_behind: None,
        counts: None,
        worktrees: 0,
    };
    let Ok(root) = repo::resolve_root(path) else {
        return missing();
    };
    let Ok(status) = repo::read_status(&root) else {
        return missing();
    };
    let worktrees = repo::count_worktrees(&root).unwrap_or(1);
    let (branch, unborn) = match &status.head {
        Head::Branch { name, .. } => (Some(name.clone()), false),
        Head::Unborn { branch } => (Some(branch.clone()), true),
        Head::Detached { sha } => (Some(sha.chars().take(7).collect()), false),
    };
    RecentStatus {
        path: path.display().to_string(),
        exists: true,
        branch,
        unborn,
        ahead_behind: status.upstream.and_then(|upstream| upstream.ahead_behind),
        counts: Some(status.counts),
        worktrees,
    }
}
