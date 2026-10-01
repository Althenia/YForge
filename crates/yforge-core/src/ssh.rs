use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use ts_rs::TS;

use crate::error::CoreError;
use crate::git_hosts::{normalized_host, GitHostProblem};
use crate::passphrase::PassphraseStore;
use crate::sqlite::failure;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SshKey {
    pub path: String,
    pub name: String,
    pub algorithm: String,
}

pub fn list_ssh_keys(ssh_dir: &Path) -> Result<Vec<SshKey>, CoreError> {
    let entries = match fs::read_dir(ssh_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(failure(ssh_dir, error)),
    };
    let mut keys = Vec::new();
    for entry in entries {
        let path = entry.map_err(|error| failure(ssh_dir, error))?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.ends_with(".pub") || !path.is_file() {
            continue;
        }
        let Ok(public) = fs::read_to_string(ssh_dir.join(format!("{name}.pub"))) else {
            continue;
        };
        let Some(algorithm) = public.split_whitespace().next() else {
            continue;
        };
        keys.push(SshKey {
            path: path.display().to_string(),
            name: name.to_owned(),
            algorithm: algorithm.to_owned(),
        });
    }
    keys.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(keys)
}

const PASSPHRASE_ENV: &str = "YFORGE_KEY_PASSPHRASE";
const PASSPHRASE_SCRIPT: &str = "#!/bin/sh\nprintf '%s\\n' \"$YFORGE_KEY_PASSPHRASE\"\n";

pub(crate) fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) if !home.is_empty() => Path::new(&home).join(rest),
        _ => PathBuf::from(path),
    }
}

fn keygen_failure(detail: impl ToString) -> CoreError {
    CoreError::GitFailed {
        command: "ssh-keygen".to_owned(),
        status: None,
        stderr: detail.to_string(),
    }
}

fn key_file_stem(host: &str) -> String {
    let name = if host.starts_with('[') {
        host.split_once(']').map_or(host, |(inside, _)| inside)
    } else {
        host.split(':').next().unwrap_or(host)
    };
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

static SCRATCH: AtomicU64 = AtomicU64::new(0);

fn passphrase_askpass() -> Result<PathBuf, CoreError> {
    let dir = std::env::temp_dir().join(format!(
        "yforge-keygen-{}-{}",
        std::process::id(),
        SCRATCH.fetch_add(1, Ordering::SeqCst)
    ));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&dir)
        .map_err(|error| failure(&dir, error))?;
    let script = dir.join("askpass.sh");
    fs::write(&script, PASSPHRASE_SCRIPT)
        .and_then(|()| fs::set_permissions(&script, fs::Permissions::from_mode(0o700)))
        .map_err(|error| failure(&script, error))?;
    Ok(script)
}

pub fn default_key_path(host: &str) -> Result<String, CoreError> {
    let host = normalized_host(host).map_err(GitHostProblem::into_error)?;
    Ok(format!("~/.ssh/yforge_{}", key_file_stem(&host)))
}

pub(crate) fn new_key_problem(value: &str) -> Option<GitHostProblem> {
    let value = value.trim();
    if value.is_empty() {
        return Some(GitHostProblem::title(
            "Enter where to write the key, such as ~/.ssh/yforge_gitlab.corp-a.com",
        ));
    }
    let key = expand_home(value);
    if !key.is_absolute() {
        return Some(GitHostProblem::title("Use the full path of the key file"));
    }
    if key.extension().is_some_and(|extension| extension == "pub") {
        return Some(GitHostProblem::title("Name the private key, without .pub"));
    }
    if key.symlink_metadata().is_ok() || public_path(&key).symlink_metadata().is_ok() {
        return Some(GitHostProblem::with_detail(
            "A file already exists there",
            "YForge never overwrites a key. Choose another path, or pick that file with Choose key file…",
        ));
    }
    let nearest = key
        .ancestors()
        .skip(1)
        .find(|path| path.symlink_metadata().is_ok());
    if nearest.is_some_and(|path| !path.is_dir()) {
        return Some(GitHostProblem::title(
            "The parent of that path is not a folder",
        ));
    }
    None
}

pub fn generate_ssh_key(
    host: &str,
    key_path: &str,
    passphrase: Option<&str>,
    passphrases: &dyn PassphraseStore,
) -> Result<PathBuf, CoreError> {
    let host = normalized_host(host).map_err(GitHostProblem::into_error)?;
    if let Some(problem) = new_key_problem(key_path) {
        return Err(CoreError::invalid_request(format!(
            "{}: {}",
            key_path.trim(),
            match problem.detail {
                Some(detail) => format!("{}. {detail}", problem.title),
                None => problem.title,
            }
        )));
    }
    let key = expand_home(key_path.trim());
    let public = public_path(&key);
    if let Some(parent) = key.parent() {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .map_err(|error| failure(parent, error))?;
    }
    let passphrase = passphrase.filter(|text| !text.is_empty());
    let mut command = Command::new("ssh-keygen");
    command
        .args([
            "-q",
            "-t",
            "ed25519",
            "-C",
            &format!("yforge@{}", key_file_stem(&host)),
            "-f",
        ])
        .arg(&key)
        .stdin(Stdio::null());
    let askpass = match passphrase {
        None => {
            command.args(["-N", ""]);
            None
        }
        Some(text) => {
            let script = passphrase_askpass()?;
            command
                .env(PASSPHRASE_ENV, text)
                .env("SSH_ASKPASS", &script)
                .env("SSH_ASKPASS_REQUIRE", "force");
            Some(script)
        }
    };
    let output = command.output();
    if let Some(script) = askpass {
        let _ = script.parent().map(fs::remove_dir_all);
    }
    let removed = || {
        let _ = fs::remove_file(&key);
        let _ = fs::remove_file(&public);
    };
    let output = output.map_err(keygen_failure)?;
    if !output.status.success() {
        removed();
        return Err(keygen_failure(
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    if let Some(text) = passphrase {
        if let Err(error) = passphrases.set(&key.display().to_string(), text) {
            removed();
            return Err(error);
        }
    }
    Ok(key)
}

pub(crate) fn public_path(key: &Path) -> PathBuf {
    let mut name = key.as_os_str().to_owned();
    name.push(".pub");
    PathBuf::from(name)
}

pub fn public_key_text(key: &Path) -> Result<String, CoreError> {
    let public = public_path(key);
    let text = fs::read_to_string(&public).map_err(|_| {
        CoreError::invalid_request(format!(
            "there is no public key next to this key; expected {}",
            public.display()
        ))
    })?;
    Ok(text.trim().to_owned())
}

pub(crate) fn key_details(key: &Path) -> Option<(String, String)> {
    let public = public_path(key);
    if !public.is_file() {
        return None;
    }
    let output = Command::new("ssh-keygen")
        .arg("-l")
        .arg("-f")
        .arg(&public)
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let line = String::from_utf8_lossy(&output.stdout);
    let fingerprint = line.split_whitespace().nth(1)?.to_owned();
    let kind = line
        .trim_end()
        .rsplit_once('(')?
        .1
        .strip_suffix(')')?
        .to_ascii_lowercase();
    Some((kind, fingerprint))
}
