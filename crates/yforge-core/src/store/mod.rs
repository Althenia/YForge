mod ai;
mod aliases;
mod git_hosts;
mod history;
mod hook_approvals;
mod jira;
mod legacy;
mod platform;
mod profiles;
mod repositories;
mod session;
mod stashes;
mod tool_choices;
mod ui_prefs;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::clone::valid_default_branch;
use crate::diagnostics;
use crate::error::CoreError;
use crate::model::{AheadBehind, ChangeCounts, Head, PullMode};
use crate::repo;
use crate::sqlite::{failure, unix_now, Database};

pub use ai::{
    ai_feature_config, ai_feature_config_enable, ai_feature_config_reset, ai_feature_config_set,
    ai_feature_configs, ai_provider, ai_provider_add, ai_provider_delete, ai_provider_edit,
    ai_provider_key_flag, ai_providers,
};
pub use aliases::{repo_alias_problem, repo_aliases_list, repo_aliases_set, RepoAlias};
pub use git_hosts::{git_host_add, git_host_remove, git_host_update, git_hosts_list, ssh_plan};
pub use history::{activity_history, append_activity, clear_activity, mark_activity_undone};
pub(crate) use hook_approvals::{approve_hook_hash, approved_hook_hash};
pub use jira::{
    jira_connection_add, jira_connection_remove, jira_connection_update, jira_connections_list,
};
pub use platform::{
    platform_connection_add, platform_connection_remove, platform_connections_list,
};
pub(crate) use profiles::active_author;
pub use profiles::{
    profile_activate, profile_delete, profile_save, profile_switch, profiles_list, Profile,
    ProfileDraft, ProfileList, DEFAULT_PROFILE,
};
pub use repositories::{
    folder_scan, repositories_list, repository_remove, repository_restore, scan_folder_remove,
    scan_folder_rescan, scan_folder_save, FolderRemoved, FolderScan, FoundRepo, ManagedRepo,
    RepoRemoved, Repositories, Rescan, ScannedFolder,
};
pub(crate) use session::write_session;
pub use session::{load_session, save_session, TabGroup, TabGroupColor, TabSession};
pub(crate) use stashes::record_switch_stash;
pub use stashes::{dismiss_switch_stash, switch_stashes};
pub use tool_choices::{tool_choices_load, tool_choices_save};
pub use ui_prefs::{
    app_ui_prefs_load, app_ui_prefs_save, repo_ui_prefs_load, repo_ui_prefs_save, AppUiPrefs,
    ColumnPref, FileListMode, GraphColumn, RepoUiPrefs,
};

const RECENT_LIMIT: i64 = 30;
const THEME: &str = "appearance.theme";
const DENSITY: &str = "appearance.density";
const DEFAULT_BRANCH: &str = "git.default_branch";
const PULL_MODE: &str = "git.pull_mode";
const AUTO_FETCH: &str = "git.auto_fetch_minutes";
const EDITOR: &str = "tools.editor_command";
const LANGUAGE_SERVERS: &str = "tools.language_servers";
const TERMINAL: &str = "tools.terminal_command";
const TELEMETRY: &str = "privacy.telemetry_opt_in";
const AVATARS: &str = "privacy.gravatar_avatars";
const SSH_KEY: &str = "git.ssh_key_path";
const SUBMODULE_UPDATE_ON_FETCH: &str = "git.submodule_update_on_fetch";

const STATE: Database = Database {
    file: "yforge.db",
    migrations,
};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("schema.sql")),
        M::up(include_str!("switch_stashes.sql")),
        M::up(include_str!("ai_providers.sql")),
        M::up(include_str!("repo_ui_prefs.sql")),
        M::up(include_str!("platform_connections.sql")),
        M::up(include_str!("ai_v2.sql")),
        M::up(include_str!("ai_feature_switch.sql")),
        M::up(include_str!("tab_groups.sql")),
        M::up(include_str!("jira_connections.sql")),
        M::up(include_str!("git_hosts.sql")),
        M::up(include_str!("repo_aliases.sql")),
        M::up(include_str!("scanned_folders.sql")),
        M::up(include_str!("ai_features_more.sql")),
        M::up(include_str!("hook_approvals.sql")),
        M::up(include_str!("profiles.sql")),
        M::up(include_str!("ai_pull_request.sql")),
    ])
}
const AUTO_FETCH_CHOICES: [u32; 4] = [0, 5, 10, 30];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Light,
    Dark,
    System,
    Classic,
    Ocean,
    Eighties,
    Gruvbox,
    Nord,
    Dracula,
    Monokai,
    Woodland,
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
    pub language_servers: BTreeMap<String, String>,
    pub terminal_command: String,
    pub telemetry_opt_in: bool,
    pub gravatar_avatars: bool,
    #[ts(optional = nullable)]
    pub ssh_key_path: Option<String>,
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
            language_servers: BTreeMap::new(),
            terminal_command: String::new(),
            telemetry_opt_in: false,
            gravatar_avatars: true,
            ssh_key_path: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RepoSettings {
    pub pull_mode: Option<PullMode>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub ssh_key_path: Option<String>,
    /// Missing or false: fetch does not move submodules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub submodule_update_on_fetch: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecentRepo {
    pub path: String,
    pub opened_at: i64,
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
    pub unreadable: Option<String>,
}

pub(crate) fn open(dir: &Path) -> Result<Connection, CoreError> {
    let mut conn = STATE.open(dir)?;
    legacy::import(&mut conn, dir)?;
    Ok(conn)
}

pub(crate) fn prepare(dir: &Path) -> Result<(), CoreError> {
    STATE.prepare(dir)?;
    open(dir).map(drop)
}

fn state_path(dir: &Path) -> std::path::PathBuf {
    STATE.path(dir)
}

fn sql(dir: &Path) -> impl Fn(rusqlite::Error) -> CoreError + '_ {
    move |error| failure(&state_path(dir), error)
}

fn stored_values(
    conn: &Connection,
    query: &str,
    parameters: impl rusqlite::Params,
) -> rusqlite::Result<HashMap<String, String>> {
    conn.prepare(query)?
        .query_map(parameters, |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

fn parse<T: DeserializeOwned>(
    dir: &Path,
    stored: &HashMap<String, String>,
    key: &str,
    default: T,
) -> Result<T, CoreError> {
    match stored.get(key) {
        None => Ok(default),
        Some(value) => serde_json::from_str(value).map_err(|error| {
            failure(
                &state_path(dir),
                format!("setting `{key}` holds an invalid value: {error}"),
            )
        }),
    }
}

fn encode<T: Serialize>(value: &T) -> rusqlite::Result<String> {
    serde_json::to_string(value)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

fn put_setting<T: Serialize>(conn: &Connection, key: &str, value: &T) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, encode(value)?],
    )
    .map(drop)
}

pub(crate) fn read_settings(conn: &Connection, dir: &Path) -> Result<AppSettings, CoreError> {
    let stored = stored_values(conn, "SELECT key, value FROM settings", []).map_err(sql(dir))?;
    let defaults = AppSettings::default();
    Ok(AppSettings {
        theme: parse(dir, &stored, THEME, defaults.theme)?,
        density: parse(dir, &stored, DENSITY, defaults.density)?,
        default_branch: parse(dir, &stored, DEFAULT_BRANCH, defaults.default_branch)?,
        pull_mode: parse(dir, &stored, PULL_MODE, defaults.pull_mode)?,
        auto_fetch_minutes: parse(dir, &stored, AUTO_FETCH, defaults.auto_fetch_minutes)?,
        editor_command: parse(dir, &stored, EDITOR, defaults.editor_command)?,
        language_servers: parse(dir, &stored, LANGUAGE_SERVERS, defaults.language_servers)?,
        terminal_command: parse(dir, &stored, TERMINAL, defaults.terminal_command)?,
        telemetry_opt_in: parse(dir, &stored, TELEMETRY, defaults.telemetry_opt_in)?,
        gravatar_avatars: parse(dir, &stored, AVATARS, defaults.gravatar_avatars)?,
        ssh_key_path: parse(dir, &stored, SSH_KEY, defaults.ssh_key_path)?,
    })
}

pub(crate) fn write_settings(conn: &Connection, settings: &AppSettings) -> rusqlite::Result<()> {
    put_setting(conn, THEME, &settings.theme)?;
    put_setting(conn, DENSITY, &settings.density)?;
    put_setting(conn, DEFAULT_BRANCH, &settings.default_branch)?;
    put_setting(conn, PULL_MODE, &settings.pull_mode)?;
    put_setting(conn, AUTO_FETCH, &settings.auto_fetch_minutes)?;
    put_setting(conn, EDITOR, &settings.editor_command)?;
    put_setting(conn, LANGUAGE_SERVERS, &settings.language_servers)?;
    put_setting(conn, TERMINAL, &settings.terminal_command)?;
    put_setting(conn, TELEMETRY, &settings.telemetry_opt_in)?;
    put_setting(conn, AVATARS, &settings.gravatar_avatars)?;
    put_setting(conn, SSH_KEY, &settings.ssh_key_path)
}

pub fn load_settings(dir: &Path) -> Result<AppSettings, CoreError> {
    read_settings(&open(dir)?, dir)
}

pub fn save_settings(dir: &Path, settings: &AppSettings) -> Result<(), CoreError> {
    let default_branch = valid_default_branch(&settings.default_branch)?;
    if settings
        .language_servers
        .iter()
        .any(|(extension, command)| {
            extension.is_empty()
                || extension.len() > 16
                || !extension
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                || command.trim().is_empty()
                || command.len() > 1024
        })
    {
        return Err(CoreError::invalid_request(
            "language servers need a lower-case file extension and an installed command",
        ));
    }
    if !AUTO_FETCH_CHOICES.contains(&settings.auto_fetch_minutes) {
        return Err(CoreError::invalid_request(
            "auto-fetch must be off, 5, 10, or 30 minutes",
        ));
    }
    let saved = AppSettings {
        default_branch,
        ssh_key_path: valid_ssh_key(settings.ssh_key_path.as_deref())?,
        ..settings.clone()
    };
    let mut conn = open(dir)?;
    if !saved.telemetry_opt_in && read_settings(&conn, dir)?.telemetry_opt_in {
        diagnostics::delete_usage(dir)?;
    }
    let tx = conn.transaction().map_err(sql(dir))?;
    write_settings(&tx, &saved).map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))
}

fn valid_ssh_key(key: Option<&str>) -> Result<Option<String>, CoreError> {
    let Some(key) = key.map(str::trim).filter(|key| !key.is_empty()) else {
        return Ok(None);
    };
    let path = Path::new(key);
    if !path.is_absolute() || !path.is_file() {
        return Err(CoreError::invalid_request(format!(
            "{key} is not an existing key file; choose the full path of a private key"
        )));
    }
    Ok(Some(key.to_owned()))
}

pub(crate) fn write_repo_settings(
    conn: &Connection,
    repository: &str,
    settings: &RepoSettings,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM repo_settings WHERE repository = ?1",
        [repository],
    )?;
    if let Some(mode) = &settings.pull_mode {
        conn.execute(
            "INSERT INTO repo_settings (repository, key, value) VALUES (?1, ?2, ?3)",
            params![repository, PULL_MODE, encode(mode)?],
        )?;
    }
    if let Some(key) = &settings.ssh_key_path {
        conn.execute(
            "INSERT INTO repo_settings (repository, key, value) VALUES (?1, ?2, ?3)",
            params![repository, SSH_KEY, encode(key)?],
        )?;
    }
    if settings.submodule_update_on_fetch == Some(true) {
        conn.execute(
            "INSERT INTO repo_settings (repository, key, value) VALUES (?1, ?2, ?3)",
            params![repository, SUBMODULE_UPDATE_ON_FETCH, encode(&true)?],
        )?;
    }
    Ok(())
}

pub fn load_repo_settings(dir: &Path, repository: &str) -> Result<RepoSettings, CoreError> {
    let conn = open(dir)?;
    let stored = stored_values(
        &conn,
        "SELECT key, value FROM repo_settings WHERE repository = ?1",
        [repository],
    )
    .map_err(sql(dir))?;
    Ok(RepoSettings {
        pull_mode: parse(dir, &stored, PULL_MODE, None)?,
        ssh_key_path: parse(dir, &stored, SSH_KEY, None)?,
        submodule_update_on_fetch: parse(dir, &stored, SUBMODULE_UPDATE_ON_FETCH, None)?,
    })
}

pub fn save_repo_settings(
    dir: &Path,
    repository: &str,
    settings: &RepoSettings,
) -> Result<(), CoreError> {
    let saved = RepoSettings {
        ssh_key_path: valid_ssh_key(settings.ssh_key_path.as_deref())?,
        ..settings.clone()
    };
    let mut conn = open(dir)?;
    let tx = conn.transaction().map_err(sql(dir))?;
    write_repo_settings(&tx, repository, &saved).map_err(sql(dir))?;
    tx.commit().map_err(sql(dir))
}

fn read_recents(conn: &Connection) -> rusqlite::Result<Vec<RecentRepo>> {
    conn.prepare("SELECT path, opened_at FROM recents ORDER BY seq DESC")?
        .query_map([], |row| {
            Ok(RecentRepo {
                path: row.get(0)?,
                opened_at: row.get(1)?,
            })
        })?
        .collect()
}

pub(crate) fn insert_recent(conn: &Connection, recent: &RecentRepo) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM recents WHERE path = ?1", [&recent.path])?;
    conn.execute(
        "INSERT INTO recents (path, opened_at) VALUES (?1, ?2)",
        params![recent.path, recent.opened_at],
    )?;
    conn.execute(
        "DELETE FROM recents WHERE seq NOT IN (SELECT seq FROM recents ORDER BY seq DESC LIMIT ?1)",
        [RECENT_LIMIT],
    )
    .map(drop)
}

pub fn load_recents(dir: &Path) -> Result<Vec<RecentRepo>, CoreError> {
    read_recents(&open(dir)?).map_err(sql(dir))
}

pub fn add_recent(dir: &Path, repository: &str) -> Result<Vec<RecentRepo>, CoreError> {
    let conn = open(dir)?;
    insert_recent(
        &conn,
        &RecentRepo {
            path: repository.to_owned(),
            opened_at: unix_now(),
        },
    )
    .and_then(|()| read_recents(&conn))
    .map_err(sql(dir))
}

pub fn remove_recent(dir: &Path, repository: &str) -> Result<Vec<RecentRepo>, CoreError> {
    let conn = open(dir)?;
    conn.execute("DELETE FROM recents WHERE path = ?1", [repository])
        .and_then(|_| read_recents(&conn))
        .map_err(sql(dir))
}

pub fn recent_status(path: &Path) -> RecentStatus {
    let summary = |exists: bool| RecentStatus {
        path: path.display().to_string(),
        exists,
        branch: None,
        unborn: false,
        ahead_behind: None,
        counts: None,
        worktrees: 0,
        unreadable: None,
    };
    let Ok(root) = repo::resolve_root(path) else {
        return summary(false);
    };
    let unreadable = |error: CoreError| RecentStatus {
        unreadable: Some(error.to_string()),
        ..summary(true)
    };
    let status = match repo::read_status(&root) {
        Ok(status) => status,
        Err(error) => return unreadable(error),
    };
    let worktrees = match repo::count_worktrees(&root) {
        Ok(worktrees) => worktrees,
        Err(error) => return unreadable(error),
    };
    let (branch, unborn) = match &status.head {
        Head::Branch { name, .. } => (Some(name.clone()), false),
        Head::Unborn { branch } => (Some(branch.clone()), true),
        Head::Detached { sha } => (Some(sha.chars().take(7).collect()), false),
    };
    RecentStatus {
        branch,
        unborn,
        ahead_behind: status.upstream.and_then(|upstream| upstream.ahead_behind),
        counts: Some(status.counts),
        worktrees,
        ..summary(true)
    }
}
