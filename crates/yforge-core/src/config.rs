use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::clone::valid_url;
use crate::error::CoreError;
use crate::git;
use crate::refs;
use crate::repo;
use crate::signing::SigningConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ConfigSource {
    Repository,
    Folder,
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

pub(crate) fn root_global_config_path(dir: &Path) -> PathBuf {
    if let Some(value) = std::env::var_os("GIT_CONFIG_GLOBAL") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        let plain = home.join(".gitconfig");
        if plain.exists() {
            return plain;
        }
        let xdg = home.join(".config/git/config");
        if xdg.exists() {
            return xdg;
        }
        return plain;
    }
    let _ = dir;
    PathBuf::from(".gitconfig")
}

pub(crate) fn same_config_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn origin_path(origin: &str) -> PathBuf {
    let raw = origin.strip_prefix("file:").unwrap_or(origin);
    PathBuf::from(raw)
}

fn read_value(dir: &Path, global_only: bool, key: &str) -> Result<ConfigValue, CoreError> {
    let mut args = vec![
        "config".to_owned(),
        "--includes".to_owned(),
        "--show-scope".to_owned(),
        "--show-origin".to_owned(),
    ];
    if global_only {
        args.push("--global".to_owned());
    }
    args.extend(["--get-all".to_owned(), key.to_owned()]);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let completed = git::run_unchecked(dir, &arg_refs, None)?;
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
    let line = completed
        .stdout
        .lines()
        .rfind(|line| !line.is_empty())
        .ok_or_else(|| CoreError::invalid_output("git config", completed.stdout.clone()))?;
    let mut parts = line.split('\t');
    let scope = parts.next().unwrap_or_default();
    let origin = parts.next().unwrap_or_default();
    let value = parts.collect::<Vec<_>>().join("\t");
    let source = match scope {
        "local" | "worktree" => ConfigSource::Repository,
        "global" => {
            if same_config_path(&origin_path(origin), &root_global_config_path(dir)) {
                ConfigSource::Global
            } else {
                ConfigSource::Folder
            }
        }
        "system" => ConfigSource::System,
        _ => ConfigSource::Other,
    };
    Ok(ConfigValue {
        value: Some(value),
        source,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FolderGitConfig {
    pub folder: String,
    pub config_path: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub ssh_key_path: Option<String>,
    pub signing: SigningConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct FolderGitConfigDraft {
    pub folder: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub ssh_key_path: Option<String>,
    pub signing: SigningConfig,
}

fn global_dir() -> PathBuf {
    std::env::temp_dir()
}

fn read_file_value(file: &Path, key: &str) -> Option<String> {
    let file_text = file.to_string_lossy().into_owned();
    let completed = git::run_unchecked(
        &global_dir(),
        &["config", "--file", &file_text, "--get", key],
        None,
    )
    .ok()?;
    completed
        .succeeded()
        .then(|| completed.stdout.trim_end_matches(['\n', '\r']).to_owned())
        .filter(|value| !value.is_empty())
}

pub(crate) fn parse_ssh_command_key(command: &str) -> Option<String> {
    let mut tokens = command.split_whitespace();
    while let Some(token) = tokens.next() {
        if token == "-i" {
            let value = tokens.next()?;
            return Some(value.trim_matches(|c| c == '\'' || c == '"').to_owned());
        }
        if let Some(value) = token.strip_prefix("-i") {
            if !value.is_empty() {
                return Some(value.trim_matches(|c| c == '\'' || c == '"').to_owned());
            }
        }
    }
    None
}

fn folder_signing(file: &Path) -> SigningConfig {
    crate::signing::read_signing_file(file)
}

fn build_folder_config(folder: String, config_path: &Path) -> FolderGitConfig {
    let ssh_key_path = read_file_value(config_path, "yforge.sshKeyPath").or_else(|| {
        read_file_value(config_path, "core.sshCommand")
            .and_then(|command| parse_ssh_command_key(&command))
    });
    FolderGitConfig {
        folder,
        config_path: config_path.display().to_string(),
        author_name: read_file_value(config_path, "user.name"),
        author_email: read_file_value(config_path, "user.email"),
        ssh_key_path,
        signing: folder_signing(config_path),
    }
}

fn include_entries() -> Result<Vec<(String, String)>, CoreError> {
    let completed = git::run_unchecked(
        &global_dir(),
        &[
            "config",
            "--global",
            "--get-regexp",
            "^includeIf\\.gitdir:.*\\.path$",
        ],
        None,
    )?;
    if completed.status == Some(1) {
        return Ok(Vec::new());
    }
    if !completed.succeeded() {
        return Err(CoreError::GitFailed {
            command: "git config --global --get-regexp includeIf".to_owned(),
            status: completed.status,
            stderr: completed.stderr.trim().to_owned(),
        });
    }
    let mut entries = Vec::new();
    for line in completed.stdout.lines().filter(|line| !line.is_empty()) {
        let Some((key, value)) = line.split_once([' ', '\t']) else {
            continue;
        };
        let lower = key.to_ascii_lowercase();
        if !lower.starts_with("includeif.gitdir:") || !lower.ends_with(".path") {
            continue;
        }
        let pattern = key["includeif.gitdir:".len()..key.len() - ".path".len()].to_owned();
        let folder = if let Some(stripped) = pattern.strip_suffix("/**") {
            stripped.to_owned()
        } else {
            pattern.trim_end_matches('/').to_owned()
        };
        entries.push((folder, value.trim().to_owned()));
        let _ = pattern;
    }
    Ok(entries)
}

pub fn list_folder_git_configs(data_dir: &Path) -> Result<Vec<FolderGitConfig>, CoreError> {
    let _ = data_dir;
    Ok(include_entries()?
        .into_iter()
        .map(|(folder, path)| build_folder_config(folder, Path::new(&path)))
        .collect())
}

pub(crate) fn folder_config_file(folder: &Path) -> Option<PathBuf> {
    let raw = folder.to_string_lossy().trim_end_matches('/').to_owned();
    let canonical = folder
        .canonicalize()
        .map(|path| path.to_string_lossy().trim_end_matches('/').to_owned())
        .unwrap_or_else(|_| raw.clone());
    include_entries()
        .ok()?
        .into_iter()
        .find_map(|(listed, path)| {
            (listed == raw || listed == canonical).then(|| PathBuf::from(path))
        })
}

fn set_file_value(file: &Path, key: &str, value: Option<&str>) -> Result<(), CoreError> {
    let file_text = file.display().to_string();
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => {
            git::run(&global_dir(), &["config", "--file", &file_text, key, value]).map(drop)
        }
        None => git::run_allowing(
            &global_dir(),
            &["config", "--file", &file_text, "--unset", key],
            &[5],
        )
        .map(drop),
    }
}

fn fnv_hex(text: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn normalized_folder(folder: &str) -> Result<String, CoreError> {
    let trimmed = folder.trim();
    if trimmed.is_empty() || !Path::new(trimmed).is_absolute() {
        return Err(CoreError::invalid_request("the folder must be a full path"));
    }
    let path = Path::new(trimmed);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let text = canonical.to_string_lossy().into_owned();
    Ok(if text.len() > 1 {
        text.trim_end_matches('/').to_owned()
    } else {
        text
    })
}

pub fn save_folder_git_config(
    data_dir: &Path,
    draft: &FolderGitConfigDraft,
) -> Result<FolderGitConfig, CoreError> {
    let folder = normalized_folder(&draft.folder)?;
    let pattern = format!("gitdir:{folder}/");
    let include_key = format!("includeIf.{pattern}.path");
    let existing = git::run_unchecked(
        &global_dir(),
        &["config", "--global", "--get", &include_key],
        None,
    )?;
    let config_path = if existing.succeeded() && !existing.stdout.trim().is_empty() {
        PathBuf::from(existing.stdout.trim())
    } else {
        let directory = data_dir.join("git-folders");
        std::fs::create_dir_all(&directory).map_err(|error| CoreError::GitFailed {
            command: format!("create {}", directory.display()),
            status: None,
            stderr: error.to_string(),
        })?;
        directory.join(format!("{}.gitconfig", fnv_hex(&folder)))
    };
    if !config_path.exists() {
        std::fs::write(&config_path, "").map_err(|error| CoreError::GitFailed {
            command: format!("write {}", config_path.display()),
            status: None,
            stderr: error.to_string(),
        })?;
    }
    set_file_value(&config_path, "user.name", draft.author_name.as_deref())?;
    set_file_value(&config_path, "user.email", draft.author_email.as_deref())?;
    match draft
        .ssh_key_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(key) => {
            let quoted = key.replace('\'', "'\\''");
            set_file_value(
                &config_path,
                "core.sshCommand",
                Some(&format!("ssh -i '{quoted}' -o IdentitiesOnly=yes")),
            )?;
            set_file_value(&config_path, "yforge.sshKeyPath", Some(key))?;
        }
        None => {
            set_file_value(&config_path, "core.sshCommand", None)?;
            set_file_value(&config_path, "yforge.sshKeyPath", None)?;
        }
    }
    crate::signing::write_signing_file(&config_path, &draft.signing)?;
    let config_text = config_path.display().to_string();
    git::run(
        &global_dir(),
        &["config", "--global", &include_key, &config_text],
    )?;
    Ok(build_folder_config(folder, &config_path))
}

pub fn remove_folder_git_config(data_dir: &Path, folder: &str) -> Result<(), CoreError> {
    let mut candidates = vec![folder.trim().trim_end_matches('/').to_owned()];
    if let Ok(normalized) = normalized_folder(folder) {
        if !candidates.contains(&normalized) {
            candidates.push(normalized);
        }
    }
    let mut config_path: Option<PathBuf> = None;
    for candidate in &candidates {
        let key = format!("includeIf.gitdir:{candidate}/.path");
        let existing =
            git::run_unchecked(&global_dir(), &["config", "--global", "--get", &key], None)?;
        if existing.succeeded() && !existing.stdout.trim().is_empty() {
            config_path = Some(PathBuf::from(existing.stdout.trim()));
            git::run_allowing(
                &global_dir(),
                &["config", "--global", "--unset", &key],
                &[5],
            )?;
        }
    }
    if let Some(path) = config_path {
        let folders = data_dir.join("git-folders");
        let folders_canonical = folders.canonicalize().unwrap_or(folders);
        if let Ok(canonical) = path.canonicalize() {
            if canonical.starts_with(&folders_canonical) {
                let _ = std::fs::remove_file(&canonical);
            }
        }
    }
    Ok(())
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
