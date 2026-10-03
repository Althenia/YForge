use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreError;
use crate::git;
use crate::repo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SigningScope {
    Global,
    Repository,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SigningFormat {
    Openpgp,
    Ssh,
    X509,
}

impl SigningFormat {
    fn value(self) -> &'static str {
        match self {
            Self::Openpgp => "openpgp",
            Self::Ssh => "ssh",
            Self::X509 => "x509",
        }
    }

    fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "ssh" => Self::Ssh,
            "x509" => Self::X509,
            _ => Self::Openpgp,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SigningConfig {
    pub sign_commits: bool,
    pub sign_tags: bool,
    pub format: SigningFormat,
    pub key: String,
    pub program: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SigningKey {
    pub id: String,
    pub label: String,
    pub format: SigningFormat,
}

fn scope_dir(scope: SigningScope, path: Option<&Path>) -> Result<PathBuf, CoreError> {
    match (scope, path) {
        (SigningScope::Repository, Some(path)) => repo::open(path),
        (SigningScope::Repository, None) => Err(CoreError::invalid_request(
            "open a repository to change its signing settings",
        )),
        (SigningScope::Global, _) => Ok(std::env::temp_dir()),
    }
}

fn config_args(scope: SigningScope) -> Vec<&'static str> {
    let mut args = vec!["config"];
    if scope == SigningScope::Global {
        args.push("--global");
    }
    args
}

fn read_key(dir: &Path, scope: SigningScope, key: &str) -> Result<Option<String>, CoreError> {
    let mut args = config_args(scope);
    args.extend(["--get", key]);
    let completed = git::run_unchecked(dir, &args, None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

fn read_flag(dir: &Path, scope: SigningScope, key: &str) -> Result<bool, CoreError> {
    let mut args = config_args(scope);
    args.extend(["--type=bool", "--get", key]);
    let completed = git::run_unchecked(dir, &args, None)?;
    Ok(completed.succeeded() && completed.stdout.trim() == "true")
}

pub(crate) fn signs_tags(root: &Path) -> Result<bool, CoreError> {
    read_flag(root, SigningScope::Repository, "tag.gpgSign")
}

pub fn signing_read(scope: SigningScope, path: Option<&Path>) -> Result<SigningConfig, CoreError> {
    let dir = scope_dir(scope, path)?;
    Ok(SigningConfig {
        sign_commits: read_flag(&dir, scope, "commit.gpgSign")?,
        sign_tags: read_flag(&dir, scope, "tag.gpgSign")?,
        format: read_key(&dir, scope, "gpg.format")?
            .as_deref()
            .map_or(SigningFormat::Openpgp, SigningFormat::parse),
        key: read_key(&dir, scope, "user.signingkey")?.unwrap_or_default(),
        program: read_key(&dir, scope, "gpg.program")?.unwrap_or_default(),
    })
}

fn write_key(
    dir: &Path,
    scope: SigningScope,
    key: &str,
    value: Option<&str>,
) -> Result<(), CoreError> {
    let mut args = vec!["config"];
    args.push(if scope == SigningScope::Global {
        "--global"
    } else {
        "--local"
    });
    match value {
        Some(value) => {
            args.extend([key, value]);
            git::run(dir, &args).map(drop)
        }
        None => {
            args.extend(["--unset", key]);
            git::run_allowing(dir, &args, &[5]).map(drop)
        }
    }
}

pub fn signing_write(
    scope: SigningScope,
    path: Option<&Path>,
    config: &SigningConfig,
) -> Result<(), CoreError> {
    let dir = scope_dir(scope, path)?;
    fn text(value: &str) -> Option<&str> {
        Some(value.trim()).filter(|value| !value.is_empty())
    }
    let flag = |value: bool| Some(if value { "true" } else { "false" });
    write_key(&dir, scope, "commit.gpgSign", flag(config.sign_commits))?;
    write_key(&dir, scope, "tag.gpgSign", flag(config.sign_tags))?;
    write_key(&dir, scope, "gpg.format", Some(config.format.value()))?;
    write_key(&dir, scope, "user.signingkey", text(&config.key))?;
    write_key(&dir, scope, "gpg.program", text(&config.program))
}

fn unescape_colons(text: &str) -> String {
    text.replace("\\x3a", ":")
}

pub(crate) fn parse_openpgp_keys(output: &str) -> Vec<SigningKey> {
    let mut keys = Vec::new();
    let mut pending: Option<String> = None;
    for line in output.lines() {
        let fields: Vec<&str> = line.split(':').collect();
        match fields.first().copied() {
            Some("sec") => {
                let usable = !matches!(fields.get(1).copied(), Some("r" | "e" | "d" | "i"));
                pending = fields
                    .get(4)
                    .filter(|id| usable && !id.is_empty())
                    .map(|id| (*id).to_owned());
            }
            Some("uid") => {
                if let (Some(id), Some(identity)) = (pending.take(), fields.get(9)) {
                    keys.push(SigningKey {
                        label: format!("{} · {id}", unescape_colons(identity)),
                        id,
                        format: SigningFormat::Openpgp,
                    });
                }
            }
            _ => {}
        }
    }
    keys
}

fn openpgp_keys(program: &str) -> Vec<SigningKey> {
    let program = if program.trim().is_empty() {
        "gpg"
    } else {
        program.trim()
    };
    let Ok(output) = Command::new(program)
        .args(["--list-secret-keys", "--with-colons"])
        .stdin(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_openpgp_keys(&String::from_utf8_lossy(&output.stdout))
}

pub(crate) fn parse_ssh_key(file_name: &str, path: &Path, text: &str) -> Option<SigningKey> {
    let mut words = text
        .lines()
        .find(|line| !line.trim().is_empty())?
        .split_whitespace();
    let kind = words.next()?;
    words.next()?;
    let identity: Vec<&str> = words.collect();
    Some(SigningKey {
        id: path.display().to_string(),
        label: format!(
            "{file_name} · {}",
            if identity.is_empty() {
                kind.to_owned()
            } else {
                identity.join(" ")
            }
        ),
        format: SigningFormat::Ssh,
    })
}

fn ssh_keys(ssh_dir: &Path) -> Vec<SigningKey> {
    let Ok(entries) = fs::read_dir(ssh_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "pub"))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_string_lossy().into_owned();
            parse_ssh_key(&name, path, &fs::read_to_string(path).ok()?)
        })
        .collect()
}

pub fn signing_keys(program: &str, ssh_dir: &Path) -> Vec<SigningKey> {
    let mut keys = openpgp_keys(program);
    keys.extend(ssh_keys(ssh_dir));
    keys
}

pub fn list_signing_keys(program: &str) -> Vec<SigningKey> {
    let ssh_dir =
        std::env::var_os("HOME").map_or_else(PathBuf::new, |home| PathBuf::from(home).join(".ssh"));
    signing_keys(program, &ssh_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_secret_keys_with_their_first_identity() {
        let output = "sec:u:255:22:AAAABBBBCCCCDDDD:1700000000:::u:::scESC:::+:::23::0:\nfpr:::::::::0123456789ABCDEF0123456789ABCDEFAAAABBBB:\nuid:u::::1700000000::HASH::Yui Lin <yui@example.test>::::::::::0:\nuid:u::::1700000000::HASH2::Other <o@example.test>::::::::::0:\nssb:u:255:18:1111222233334444:1700000000::::::e:::+:::23:\nsec:r:255:22:EEEEFFFFEEEEFFFF:1700000000:::u:::scESC:::+:::23::0:\nuid:r::::1700000000::H3::Revoked <r@example.test>::::::::::0:\n";
        assert_eq!(
            parse_openpgp_keys(output),
            vec![SigningKey {
                id: "AAAABBBBCCCCDDDD".to_owned(),
                label: "Yui Lin <yui@example.test> · AAAABBBBCCCCDDDD".to_owned(),
                format: SigningFormat::Openpgp,
            }]
        );
    }

    #[test]
    fn labels_ssh_keys_by_file_and_identity() {
        let path = Path::new("/home/y/.ssh/id_ed25519.pub");
        let key = parse_ssh_key("id_ed25519.pub", path, "ssh-ed25519 AAAAC3 yui@laptop\n").unwrap();
        assert_eq!(key.id, "/home/y/.ssh/id_ed25519.pub");
        assert_eq!(key.label, "id_ed25519.pub · yui@laptop");
        assert!(parse_ssh_key("x.pub", path, "\n").is_none());
    }
}
