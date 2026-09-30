use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::CoreError;
use crate::git;

const POLL: Duration = Duration::from_millis(25);
const DIR_ENV: &str = "YFORGE_ASKPASS_DIR";

const SCRIPT: &str = r#"#!/bin/sh
dir="$YFORGE_ASKPASS_DIR"
id="$$"
{ printf '%s\n' "$SSH_ASKPASS_PROMPT"; printf '%s' "$1"; } > "$dir/.req-$id" || exit 1
mv "$dir/.req-$id" "$dir/req-$id" || exit 1
while [ ! -f "$dir/res-$id" ]; do
  [ -d "$dir" ] || exit 1
  sleep 0.05
done
{ read -r status; cat; } < "$dir/res-$id"
rm -f "$dir/res-$id"
exit "$status"
"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AuthKind {
    Credentials,
    Passphrase,
    HostKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AuthPrompt {
    pub id: String,
    pub kind: AuthKind,
    pub url: Option<String>,
    pub host: Option<String>,
    pub username: Option<String>,
    pub message: String,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthReply {
    Credentials {
        username: Option<String>,
        secret: String,
        save: bool,
    },
    Trust,
    Cancel,
    TimedOut,
}

pub type AuthHandler = Arc<dyn Fn(AuthPrompt) -> AuthReply + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UsedCredential {
    url: String,
    username: String,
    secret: String,
    save: bool,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct AskpassOutcome {
    pub cancelled: bool,
    pub timed_out: bool,
    pub used: Vec<UsedCredential>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Parsed {
    Username {
        url: String,
    },
    Password {
        url: String,
        username: Option<String>,
    },
    Passphrase {
        message: String,
    },
    HostKey {
        host: Option<String>,
        fingerprint: Option<String>,
        message: String,
    },
}

fn quoted(prompt: &str) -> Option<&str> {
    let start = prompt.find('\'')? + 1;
    let end = prompt[start..].find('\'')? + start;
    Some(&prompt[start..end])
}

fn split_userinfo(url: &str) -> (String, Option<String>) {
    let Some((scheme, rest)) = url.split_once("://") else {
        return (url.to_owned(), None);
    };
    let authority_end = rest.find('/').unwrap_or(rest.len());
    match rest[..authority_end].split_once('@') {
        Some((user, host)) => (
            format!("{scheme}://{host}{}", &rest[authority_end..]),
            Some(user.to_owned()),
        ),
        None => (url.to_owned(), None),
    }
}

fn host_key_fingerprint(prompt: &str) -> Option<String> {
    let start = prompt.find("SHA256:").or_else(|| prompt.find("MD5:"))?;
    let token: String = prompt[start..]
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != ')')
        .collect();
    Some(token.trim_end_matches('.').to_owned())
}

fn host_key_host(prompt: &str) -> Option<String> {
    let start = prompt.find("host '")? + "host '".len();
    let name: String = prompt[start..]
        .chars()
        .take_while(|c| *c != '\'' && *c != ' ')
        .collect();
    (!name.is_empty()).then_some(name)
}

fn classify(kind: &str, prompt: &str) -> Parsed {
    if kind == "confirm" || prompt.contains("continue connecting") {
        return Parsed::HostKey {
            host: host_key_host(prompt),
            fingerprint: host_key_fingerprint(prompt),
            message: prompt.trim().to_owned(),
        };
    }
    if prompt.starts_with("Username for ") {
        if let Some(url) = quoted(prompt) {
            return Parsed::Username {
                url: split_userinfo(url).0,
            };
        }
    }
    if prompt.starts_with("Password for ") {
        if let Some(url) = quoted(prompt) {
            let (url, username) = split_userinfo(url);
            return Parsed::Password { url, username };
        }
    }
    Parsed::Passphrase {
        message: prompt.trim().to_owned(),
    }
}

fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = rest.split('/').next().unwrap_or(rest);
    (!host.is_empty()).then(|| host.to_owned())
}

#[derive(Default)]
struct State {
    outcome: AskpassOutcome,
    pending: Option<(String, String, String, bool)>,
}

pub(crate) struct Askpass {
    dir: PathBuf,
    stop: Arc<AtomicBool>,
    state: Arc<Mutex<State>>,
}

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn create_dir() -> io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "yforge-askpass-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::SeqCst)
    ));
    fs::DirBuilder::new().mode(0o700).create(&dir)?;
    Ok(dir)
}

fn write_response(dir: &Path, id: &str, status: i32, answer: &str) -> io::Result<()> {
    let staged = dir.join(format!(".res-{id}"));
    fs::write(&staged, format!("{status}\n{answer}"))?;
    fs::set_permissions(&staged, fs::Permissions::from_mode(0o600))?;
    fs::rename(&staged, dir.join(format!("res-{id}")))
}

fn ask(
    handler: &AuthHandler,
    state: &Mutex<State>,
    sequence: u64,
    parsed: Parsed,
) -> (i32, String) {
    let lock = || state.lock().unwrap_or_else(PoisonError::into_inner);
    let prompt_id = format!("auth-{sequence}");
    let refuse = |reply: &AuthReply| {
        let mut guard = lock();
        match reply {
            AuthReply::TimedOut => guard.outcome.timed_out = true,
            _ => guard.outcome.cancelled = true,
        }
        (1, String::new())
    };
    match parsed {
        Parsed::Username { url } => {
            let reply = handler(AuthPrompt {
                id: prompt_id,
                kind: AuthKind::Credentials,
                host: host_of(&url),
                url: Some(url.clone()),
                username: None,
                message: format!("{} needs credentials.", host_of(&url).unwrap_or_default()),
                fingerprint: None,
            });
            match reply {
                AuthReply::Credentials {
                    username,
                    secret,
                    save,
                } => {
                    let username = username.unwrap_or_default();
                    lock().pending = Some((url, username.clone(), secret, save));
                    (0, username)
                }
                other => refuse(&other),
            }
        }
        Parsed::Password { url, username } => {
            let stored = lock()
                .pending
                .take()
                .filter(|(pending, ..)| *pending == url);
            if let Some((url, username, secret, save)) = stored {
                lock().outcome.used.push(UsedCredential {
                    url,
                    username,
                    secret: secret.clone(),
                    save,
                });
                return (0, secret);
            }
            let reply = handler(AuthPrompt {
                id: prompt_id,
                kind: AuthKind::Credentials,
                host: host_of(&url),
                url: Some(url.clone()),
                username: username.clone(),
                message: format!(
                    "{} needs a password or token.",
                    host_of(&url).unwrap_or_default()
                ),
                fingerprint: None,
            });
            match reply {
                AuthReply::Credentials { secret, save, .. } => {
                    lock().outcome.used.push(UsedCredential {
                        url,
                        username: username.unwrap_or_default(),
                        secret: secret.clone(),
                        save,
                    });
                    (0, secret)
                }
                other => refuse(&other),
            }
        }
        Parsed::Passphrase { message } => {
            let reply = handler(AuthPrompt {
                id: prompt_id,
                kind: AuthKind::Passphrase,
                url: None,
                host: None,
                username: None,
                message,
                fingerprint: None,
            });
            match reply {
                AuthReply::Credentials { secret, .. } => (0, secret),
                other => refuse(&other),
            }
        }
        Parsed::HostKey {
            host,
            fingerprint,
            message,
        } => {
            let reply = handler(AuthPrompt {
                id: prompt_id,
                kind: AuthKind::HostKey,
                url: None,
                host,
                username: None,
                message,
                fingerprint,
            });
            match reply {
                AuthReply::Trust => (0, "yes".to_owned()),
                other => refuse(&other),
            }
        }
    }
}

fn serve(dir: &Path, handler: &AuthHandler, state: &Mutex<State>, stop: &AtomicBool) {
    let mut sequence = 0;
    while !stop.load(Ordering::SeqCst) {
        let requests: Vec<PathBuf> = fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("req-"))
            .map(|entry| entry.path())
            .collect();
        for request in requests {
            let id = request
                .file_name()
                .map(|name| name.to_string_lossy().trim_start_matches("req-").to_owned())
                .unwrap_or_default();
            let content = fs::read_to_string(&request).unwrap_or_default();
            let _ = fs::remove_file(&request);
            let (kind, prompt) = content.split_once('\n').unwrap_or(("", &content));
            sequence += 1;
            let (status, answer) = ask(handler, state, sequence, classify(kind, prompt));
            let answer = answer.split('\n').next().unwrap_or_default();
            let _ = write_response(dir, &id, status, answer);
        }
        thread::sleep(POLL);
    }
    let _ = fs::remove_dir_all(dir);
}

impl Askpass {
    pub(crate) fn start(handler: AuthHandler) -> Result<Self, CoreError> {
        let failed = |error: io::Error| CoreError::GitFailed {
            command: "askpass".to_owned(),
            status: None,
            stderr: error.to_string(),
        };
        let dir = create_dir().map_err(failed)?;
        let script = dir.join("askpass.sh");
        fs::write(&script, SCRIPT).map_err(failed)?;
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).map_err(failed)?;
        let stop = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(State::default()));
        let (serving_dir, serving_stop, serving_state) = (dir.clone(), stop.clone(), state.clone());
        thread::spawn(move || serve(&serving_dir, &handler, &serving_state, &serving_stop));
        Ok(Self { dir, stop, state })
    }

    pub(crate) fn apply(&self, command: &mut Command) {
        let script = self.dir.join("askpass.sh");
        command
            .env("GIT_ASKPASS", &script)
            .env("SSH_ASKPASS", &script)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env(DIR_ENV, &self.dir);
    }

    pub(crate) fn finish(self) -> AskpassOutcome {
        self.stop.store(true, Ordering::SeqCst);
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .outcome
            .clone()
    }
}

fn credential_input(credential: &UsedCredential) -> String {
    let (protocol, rest) = credential
        .url
        .split_once("://")
        .unwrap_or(("https", &credential.url));
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let mut input = format!("protocol={protocol}\nhost={host}\n");
    if !path.is_empty() {
        input.push_str(&format!("path={path}\n"));
    }
    input.push_str(&format!(
        "username={}\npassword={}\n\n",
        credential.username, credential.secret
    ));
    input
}

pub(crate) fn settle_credentials(dir: &Path, used: &[UsedCredential]) -> Result<(), CoreError> {
    for credential in used {
        let verb = if credential.save { "approve" } else { "reject" };
        let completed = git::run_unchecked(
            dir,
            &["credential", verb],
            Some(&credential_input(credential)),
        )?;
        if !completed.succeeded() {
            return Err(CoreError::GitFailed {
                command: format!("git credential {verb}"),
                status: completed.status,
                stderr: completed.stderr.trim().to_owned(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_https_prompts_and_strips_the_user_from_the_url() {
        assert_eq!(
            classify("", "Username for 'https://github.com': "),
            Parsed::Username {
                url: "https://github.com".to_owned()
            }
        );
        assert_eq!(
            classify("", "Password for 'https://yui@github.com': "),
            Parsed::Password {
                url: "https://github.com".to_owned(),
                username: Some("yui".to_owned())
            }
        );
    }

    #[test]
    fn classifies_ssh_passphrase_and_host_key_prompts() {
        assert!(matches!(
            classify(
                "none",
                "Enter passphrase for key '/home/yui/.ssh/id_ed25519': "
            ),
            Parsed::Passphrase { .. }
        ));
        let prompt = "The authenticity of host 'github.com (140.82.112.3)' can't be established.\nED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
        let Parsed::HostKey {
            host, fingerprint, ..
        } = classify("confirm", prompt)
        else {
            panic!("expected a host key prompt");
        };
        assert_eq!(host.as_deref(), Some("github.com"));
        assert_eq!(
            fingerprint.as_deref(),
            Some("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU")
        );
    }

    #[test]
    fn credential_input_names_the_protocol_host_and_path() {
        let credential = UsedCredential {
            url: "https://example.test/team/repo.git".to_owned(),
            username: "yui".to_owned(),
            secret: "s3cret".to_owned(),
            save: true,
        };
        assert_eq!(
            credential_input(&credential),
            "protocol=https\nhost=example.test\npath=team/repo.git\nusername=yui\npassword=s3cret\n\n"
        );
    }
}
