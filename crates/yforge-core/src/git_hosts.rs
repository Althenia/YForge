use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreError;
use crate::ssh::{expand_home, new_key_problem};
use crate::store::ssh_plan;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitHost {
    pub id: String,
    pub host: String,
    pub ssh_key_path: Option<String>,
    pub https_user: Option<String>,
    pub key_kind: Option<String>,
    pub key_fingerprint: Option<String>,
    pub has_public_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct GitHostDraft {
    pub host: String,
    pub ssh_key_path: Option<String>,
    pub https_user: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct GitHostProblem {
    pub title: String,
    pub detail: Option<String>,
}

impl GitHostProblem {
    pub(crate) fn title(title: &str) -> Self {
        Self {
            title: title.to_owned(),
            detail: None,
        }
    }

    pub(crate) fn with_detail(title: &str, detail: &str) -> Self {
        Self {
            title: title.to_owned(),
            detail: Some(detail.to_owned()),
        }
    }

    pub(crate) fn into_error(self) -> CoreError {
        match self.detail {
            Some(detail) => CoreError::invalid_request(format!("{}. {detail}", self.title)),
            None => CoreError::invalid_request(self.title),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    Ssh,
    Https,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAddress {
    pub transport: Transport,
    pub host: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum IdentitySource {
    Repository,
    Host,
    App,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub source: IdentitySource,
    pub key: Option<PathBuf>,
    pub host: Option<GitHost>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SshPlan {
    pub repository_key: Option<PathBuf>,
    pub app_key: Option<PathBuf>,
    pub hosts: Vec<GitHost>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct UrlIdentity {
    pub transport: Transport,
    pub source: IdentitySource,
    pub host: Option<String>,
    pub ssh_key_path: Option<String>,
    pub https_user: Option<String>,
}

const HOST_HINT: &str = "Enter the host name, such as gitlab.corp-a.com";
const HOST_SHAPE: &str =
    "Enter only the host name and an optional port, such as gitlab.corp-b.com:2222";

fn split_port(authority: &str) -> Option<(String, Option<u16>)> {
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (inside, after) = rest.split_once(']')?;
        if inside.is_empty() || !inside.chars().all(|c| c.is_ascii_hexdigit() || c == ':') {
            return None;
        }
        let port = match after {
            "" => None,
            _ => Some(after.strip_prefix(':')?),
        };
        (format!("[{inside}]"), port)
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host.to_owned(), Some(port)),
            None => (authority.to_owned(), None),
        }
    };
    let valid_host = host.starts_with('[')
        || (!host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')));
    if !valid_host {
        return None;
    }
    let port = match port {
        None => None,
        Some(text) => {
            let number = text
                .chars()
                .all(|c| c.is_ascii_digit())
                .then(|| text.parse::<u16>().ok())
                .flatten()
                .filter(|number| *number != 0)?;
            Some(number)
        }
    };
    Some((host.to_ascii_lowercase(), port))
}

fn joined(host: String, port: Option<u16>) -> String {
    match port {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}

pub fn remote_address(url: &str) -> Option<RemoteAddress> {
    let url = url.trim();
    if let Some((scheme, rest)) = url.split_once("://") {
        let transport = match scheme.to_ascii_lowercase().as_str() {
            "ssh" | "git+ssh" | "ssh+git" => Transport::Ssh,
            "https" | "http" => Transport::Https,
            "git" => Transport::Other,
            _ => return None,
        };
        let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
        let authority = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        let (host, port) = split_port(authority)?;
        return Some(RemoteAddress {
            transport,
            host: joined(host, port),
        });
    }
    let after_user = match url.split_once('@') {
        Some((user, rest)) if !user.contains(['/', ':', '[']) => rest,
        _ => url,
    };
    let (authority, path) = if after_user.starts_with('[') {
        let end = after_user.find("]:")?;
        (&after_user[..=end], &after_user[end + 2..])
    } else {
        after_user.split_once(':')?
    };
    if authority.contains('/') || path.is_empty() {
        return None;
    }
    let (host, port) = split_port(authority)?;
    port.is_none().then_some(RemoteAddress {
        transport: Transport::Ssh,
        host,
    })
}

pub(crate) fn normalized_host(input: &str) -> Result<String, GitHostProblem> {
    let text = input.trim();
    if text.is_empty() {
        return Err(GitHostProblem::title(HOST_HINT));
    }
    split_port(text)
        .map(|(host, port)| joined(host, port))
        .ok_or_else(|| GitHostProblem::title(HOST_SHAPE))
}

const PUBLIC_KEY_KINDS: [&str; 4] = ["ssh-", "ecdsa-", "sk-ssh-", "sk-ecdsa-"];

fn key_problem(value: &str) -> Result<PathBuf, GitHostProblem> {
    let path = expand_home(value);
    if !path.is_absolute() {
        return Err(GitHostProblem::title("Use the full path of the key file"));
    }
    if !path.is_file() {
        return Err(GitHostProblem::with_detail(
            "That key file does not exist",
            "Choose an existing private key file. Nothing was saved.",
        ));
    }
    let mut head = Vec::new();
    let read = File::open(&path).and_then(|file| file.take(512).read_to_end(&mut head));
    if let Err(error) = read {
        return Err(GitHostProblem::with_detail(
            "That key file cannot be read",
            &format!("{error}. Nothing was saved."),
        ));
    }
    let head = String::from_utf8_lossy(&head);
    let first = head.lines().next().unwrap_or_default();
    let public = path.extension().is_some_and(|extension| extension == "pub")
        || PUBLIC_KEY_KINDS.iter().any(|kind| first.starts_with(kind));
    if public {
        return Err(GitHostProblem::with_detail(
            "That is a public key",
            "Choose the private key file (usually the same name without .pub). Nothing was saved.",
        ));
    }
    if !(first.starts_with("-----BEGIN ") && first.contains("PRIVATE KEY-----")) {
        return Err(GitHostProblem::with_detail(
            "That is not an SSH private key",
            "Choose a private key file, such as ~/.ssh/id_ed25519. Nothing was saved.",
        ));
    }
    Ok(path)
}

pub fn git_host_problem(field: &str, value: &str) -> Option<GitHostProblem> {
    match field {
        "host" => normalized_host(value).err(),
        "ssh_key" if value.trim().is_empty() => None,
        "ssh_key" => key_problem(value.trim()).err(),
        "new_key" => new_key_problem(value),
        _ => None,
    }
}

pub(crate) fn valid_draft(draft: &GitHostDraft) -> Result<GitHostDraft, CoreError> {
    let host = normalized_host(&draft.host).map_err(GitHostProblem::into_error)?;
    let ssh_key_path = match draft.ssh_key_path.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(key) => Some(
            key_problem(key)
                .map_err(GitHostProblem::into_error)?
                .display()
                .to_string(),
        ),
    };
    let https_user = draft
        .https_user
        .as_deref()
        .map(str::trim)
        .filter(|user| !user.is_empty())
        .map(str::to_owned);
    if https_user
        .as_deref()
        .is_some_and(|user| user.chars().any(char::is_control))
    {
        return Err(CoreError::invalid_request(
            "the HTTPS user name cannot contain a line break or control character",
        ));
    }
    Ok(GitHostDraft {
        host,
        ssh_key_path,
        https_user,
    })
}

impl SshPlan {
    pub fn resolve(&self, url: Option<&str>) -> Resolved {
        if let Some(key) = &self.repository_key {
            return Resolved {
                source: IdentitySource::Repository,
                key: Some(key.clone()),
                host: None,
            };
        }
        let matched = url
            .and_then(remote_address)
            .and_then(|address| self.hosts.iter().find(|host| host.host == address.host));
        if let Some(host) = matched {
            return Resolved {
                source: IdentitySource::Host,
                key: host.ssh_key_path.as_ref().map(PathBuf::from),
                host: Some(host.clone()),
            };
        }
        match &self.app_key {
            Some(key) => Resolved {
                source: IdentitySource::App,
                key: Some(key.clone()),
                host: None,
            },
            None => Resolved {
                source: IdentitySource::Agent,
                key: None,
                host: None,
            },
        }
    }

    pub(crate) fn https_user(&self, host: &str) -> Option<&str> {
        let host = host.to_ascii_lowercase();
        self.hosts
            .iter()
            .find(|entry| entry.host == host)
            .and_then(|entry| entry.https_user.as_deref())
    }
}

pub fn url_identity(dir: &Path, url: &str) -> Result<UrlIdentity, CoreError> {
    let plan = SshPlan {
        repository_key: None,
        ..ssh_plan(dir, None)?
    };
    let transport = remote_address(url).map_or(Transport::Other, |address| address.transport);
    if transport == Transport::Other {
        return Ok(UrlIdentity {
            transport,
            source: IdentitySource::Agent,
            host: None,
            ssh_key_path: None,
            https_user: None,
        });
    }
    let resolved = plan.resolve(Some(url));
    let https_user = resolved
        .host
        .as_ref()
        .and_then(|host| host.https_user.clone());
    Ok(UrlIdentity {
        transport,
        source: resolved.source,
        host: resolved.host.map(|host| host.host),
        ssh_key_path: resolved.key.map(|key| key.display().to_string()),
        https_user,
    })
}
