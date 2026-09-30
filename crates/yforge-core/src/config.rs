use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::clone::valid_url;
use crate::error::CoreError;
use crate::git;
use crate::refs;
use crate::repo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConfigSource {
    Repository,
    Global,
    System,
    Other,
    Unset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ConfigValue {
    pub value: Option<String>,
    pub source: ConfigSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Identity {
    pub name: ConfigValue,
    pub email: ConfigValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum IdentityField {
    Name,
    Email,
}

impl IdentityField {
    fn key(self) -> &'static str {
        match self {
            Self::Name => "user.name",
            Self::Email => "user.email",
        }
    }
}

fn scope_dir(path: Option<&Path>) -> Result<PathBuf, CoreError> {
    match path {
        Some(path) => repo::open(path),
        None => Ok(std::env::temp_dir()),
    }
}

fn read_value(dir: &Path, global_only: bool, key: &str) -> Result<ConfigValue, CoreError> {
    let mut args = vec!["config", "--show-scope"];
    if global_only {
        args.push("--global");
    }
    args.extend(["--get", key]);
    let completed = git::run_unchecked(dir, &args, None)?;
    if completed.status == Some(1) {
        return Ok(ConfigValue {
            value: None,
            source: ConfigSource::Unset,
        });
    }
    if !completed.succeeded() {
        return Err(CoreError::GitFailed {
            command: format!("git {}", args.join(" ")),
            status: completed.status,
            stderr: completed.stderr.trim().to_owned(),
        });
    }
    let line = completed.stdout.trim_end_matches('\n');
    let (scope, value) = line
        .split_once('\t')
        .ok_or_else(|| CoreError::invalid_output("git config", line))?;
    let source = match scope {
        "local" | "worktree" => ConfigSource::Repository,
        "global" => ConfigSource::Global,
        "system" => ConfigSource::System,
        _ => ConfigSource::Other,
    };
    Ok(ConfigValue {
        value: Some(value.to_owned()),
        source,
    })
}

pub fn read_identity(path: Option<&Path>) -> Result<Identity, CoreError> {
    let dir = scope_dir(path)?;
    let global_only = path.is_none();
    Ok(Identity {
        name: read_value(&dir, global_only, IdentityField::Name.key())?,
        email: read_value(&dir, global_only, IdentityField::Email.key())?,
    })
}

pub fn write_identity(
    path: Option<&Path>,
    field: IdentityField,
    value: Option<&str>,
) -> Result<(), CoreError> {
    let dir = scope_dir(path)?;
    let scope = if path.is_none() {
        "--global"
    } else {
        "--local"
    };
    match value.map(str::trim) {
        Some("") => Err(CoreError::invalid_request(format!(
            "{} cannot be empty",
            field.key()
        ))),
        Some(value) => git::run(&dir, &["config", scope, field.key(), value]).map(drop),
        None => git::run_allowing(&dir, &["config", scope, "--unset", field.key()], &[5]).map(drop),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: Option<String>,
}

pub fn list_remotes(path: &Path) -> Result<Vec<RemoteInfo>, CoreError> {
    let root = repo::open(path)?;
    refs::read_remotes(&root)?
        .into_iter()
        .map(|name| {
            let fetch_url = git::run(&root, &["remote", "get-url", &name])?
                .trim()
                .to_owned();
            let push = git::run(&root, &["remote", "get-url", "--push", &name])?
                .trim()
                .to_owned();
            Ok(RemoteInfo {
                push_url: (push != fetch_url).then_some(push),
                name,
                fetch_url,
            })
        })
        .collect()
}

fn checked_remote(root: &Path, name: &str, url: &str) -> Result<(String, String), CoreError> {
    let (name, url) = (name.trim(), url.trim());
    let named = git::run_unchecked(
        root,
        &["check-ref-format", &format!("refs/remotes/{name}/x")],
        None,
    )?;
    if name.is_empty() || name.contains('/') || !named.succeeded() {
        return Err(CoreError::invalid_request(format!(
            "{name:?} is not a valid remote name"
        )));
    }
    if !valid_url(url) {
        return Err(CoreError::invalid_request(format!(
            "{} is not an https, ssh, or local repository address",
            crate::activity::redact(url)
        )));
    }
    Ok((name.to_owned(), url.to_owned()))
}

pub fn add_remote(path: &Path, name: &str, url: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let (name, url) = checked_remote(&root, name, url)?;
    git::run(&root, &["remote", "add", "--", &name, &url]).map(drop)
}

pub fn edit_remote(path: &Path, name: &str, new_name: &str, url: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let (new_name, url) = checked_remote(&root, new_name, url)?;
    if new_name != name {
        git::run(&root, &["remote", "rename", "--", name, &new_name])?;
    }
    git::run(&root, &["remote", "set-url", "--", &new_name, &url]).map(drop)
}

pub fn remove_remote(path: &Path, name: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    git::run(&root, &["remote", "remove", "--", name]).map(drop)
}
