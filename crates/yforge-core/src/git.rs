use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use crate::activity;
use crate::askpass::{self, Askpass, AuthHandler};
use crate::error::CoreError;
use crate::git_hosts::SshPlan;
use crate::passphrase::PassphraseStore;

const REQUIRED_MAJOR: u32 = 2;
const REQUIRED_MINOR: u32 = 39;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitVersion {
    pub major: u32,
    pub minor: u32,
    pub text: String,
}

fn base_command() -> Command {
    let mut command = Command::new("git");
    command
        .arg("--no-pager")
        .env("LC_ALL", "C")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(Stdio::null());
    if let Some((name, email)) = crate::store::active_author() {
        command
            .env("GIT_AUTHOR_NAME", &name)
            .env("GIT_AUTHOR_EMAIL", &email)
            .env("GIT_COMMITTER_NAME", &name)
            .env("GIT_COMMITTER_EMAIL", &email);
    }
    command
}

pub(crate) struct Completed {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Completed {
    pub(crate) fn succeeded(&self) -> bool {
        self.status == Some(0)
    }
}

fn spawn_failure(error: &std::io::Error, description: &str) -> CoreError {
    if error.kind() == ErrorKind::NotFound {
        CoreError::GitMissing
    } else {
        CoreError::GitFailed {
            command: description.to_owned(),
            status: None,
            stderr: error.to_string(),
        }
    }
}

fn capture(
    mut command: Command,
    input: Option<&str>,
    description: &str,
) -> Result<Completed, CoreError> {
    let started = Instant::now();
    let output = match input {
        None => command.output(),
        Some(input) => {
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command
                .spawn()
                .map_err(|e| spawn_failure(&e, description))?;
            if let Some(mut stdin) = child.stdin.take() {
                if let Err(error) = stdin.write_all(input.as_bytes()) {
                    if error.kind() != ErrorKind::BrokenPipe {
                        return Err(spawn_failure(&error, description));
                    }
                }
            }
            child.wait_with_output()
        }
    }
    .map_err(|error| spawn_failure(&error, description))?;
    let completed = Completed {
        status: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    };
    note(description, &completed, started);
    Ok(completed)
}

fn note(description: &str, completed: &Completed, started: Instant) {
    activity::note(
        description,
        completed.status,
        &format!("{}{}", completed.stdout, completed.stderr),
        started.elapsed(),
    );
}

fn checked(completed: Completed, description: String) -> Result<String, CoreError> {
    if !completed.succeeded() {
        return Err(CoreError::GitFailed {
            command: description,
            status: completed.status,
            stderr: completed.stderr.trim().to_owned(),
        });
    }
    Ok(completed.stdout)
}

fn describe(args: &[&str]) -> String {
    format!("git {}", activity::redact(&args.join(" ")))
}

fn in_directory(dir: &Path, args: &[&str]) -> Command {
    let mut command = base_command();
    command.arg("-C").arg(dir).args(args);
    command
}

pub(crate) fn run_unchecked(
    dir: &Path,
    args: &[&str],
    input: Option<&str>,
) -> Result<Completed, CoreError> {
    capture(in_directory(dir, args), input, &describe(args))
}

pub(crate) fn run_with_env(
    dir: &Path,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<Completed, CoreError> {
    let mut command = in_directory(dir, args);
    command.envs(env.iter().copied());
    capture(command, None, &describe(args))
}

pub(crate) fn run_env(
    dir: &Path,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<String, CoreError> {
    checked(run_with_env(dir, args, env)?, describe(args))
}

pub(crate) fn run(dir: &Path, args: &[&str]) -> Result<String, CoreError> {
    checked(run_unchecked(dir, args, None)?, describe(args))
}

pub(crate) fn run_bytes(dir: &Path, args: &[&str]) -> Result<Vec<u8>, CoreError> {
    let description = describe(args);
    let output = in_directory(dir, args)
        .output()
        .map_err(|error| spawn_failure(&error, &description))?;
    if !output.status.success() {
        return Err(CoreError::GitFailed {
            command: description,
            status: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        });
    }
    Ok(output.stdout)
}

pub(crate) fn run_allowing(
    dir: &Path,
    args: &[&str],
    allowed: &[i32],
) -> Result<String, CoreError> {
    let completed = run_unchecked(dir, args, None)?;
    if completed.status.is_some_and(|code| allowed.contains(&code)) {
        return Ok(completed.stdout);
    }
    checked(completed, describe(args))
}

pub(crate) fn run_with_input(dir: &Path, args: &[&str], input: &str) -> Result<String, CoreError> {
    checked(run_unchecked(dir, args, Some(input))?, describe(args))
}

#[derive(Clone, Default)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
    auth: Option<AuthHandler>,
    plan: SshPlan,
    passphrases: Option<Arc<dyn PassphraseStore>>,
    ssh_key: Option<PathBuf>,
}

impl std::fmt::Debug for CancelToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CancelToken")
            .field("cancelled", &self.is_cancelled())
            .field("interactive", &self.auth.is_some())
            .finish()
    }
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_auth(auth: AuthHandler) -> Self {
        Self {
            flag: Arc::default(),
            auth: Some(auth),
            plan: SshPlan::default(),
            passphrases: None,
            ssh_key: None,
        }
    }

    pub fn with_ssh_plan(mut self, plan: SshPlan) -> Self {
        self.plan = plan;
        self
    }

    pub fn with_passphrases(mut self, passphrases: Arc<dyn PassphraseStore>) -> Self {
        self.passphrases = Some(passphrases);
        self
    }

    pub(crate) fn toward(&self, url: Option<&str>) -> Self {
        Self {
            ssh_key: self.plan.resolve(url).key,
            ..self.clone()
        }
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

const CANCEL_POLL: Duration = Duration::from_millis(50);

fn non_interactive_ssh(dir: &Path) -> bool {
    std::env::var_os("GIT_SSH_COMMAND").is_none()
        && std::env::var_os("GIT_SSH").is_none()
        && run_unchecked(dir, &["config", "--get", "core.sshCommand"], None)
            .is_ok_and(|completed| completed.status == Some(1))
}

fn ssh_command(key: &Path, batch: bool) -> String {
    let quoted = key.to_string_lossy().replace('\'', "'\\''");
    format!(
        "ssh -i '{quoted}' -o IdentitiesOnly=yes{}",
        if batch { " -o BatchMode=yes" } else { "" }
    )
}

fn forward_lines(mut source: impl Read, lines: mpsc::Sender<String>) {
    let mut pending = Vec::new();
    let mut chunk = [0_u8; 4096];
    let flush = |pending: &mut Vec<u8>| {
        if !pending.is_empty() {
            let line = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            return lines.send(line).is_ok();
        }
        true
    };
    while let Ok(read) = source.read(&mut chunk) {
        if read == 0 {
            break;
        }
        for byte in &chunk[..read] {
            if matches!(byte, b'\r' | b'\n') {
                if !flush(&mut pending) {
                    return;
                }
            } else {
                pending.push(*byte);
            }
        }
    }
    flush(&mut pending);
}

pub(crate) fn parse_progress(line: &str) -> Option<(String, u32)> {
    let line = line.strip_prefix("remote: ").unwrap_or(line);
    let (phase, rest) = line.split_once(':')?;
    let digits: String = rest
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    let percent = digits.parse::<u32>().ok()?;
    let after = rest.trim_start().get(digits.len()..)?;
    if !after.starts_with('%') || phase.trim().is_empty() {
        return None;
    }
    Some((phase.trim().to_owned(), percent))
}

pub(crate) fn run_streaming(
    dir: &Path,
    args: &[&str],
    cancel: &CancelToken,
    on_line: impl FnMut(&str),
) -> Result<Completed, CoreError> {
    run_streaming_until(dir, args, cancel, None, on_line)
}

pub(crate) fn run_streaming_until(
    dir: &Path,
    args: &[&str],
    cancel: &CancelToken,
    deadline: Option<Instant>,
    mut on_line: impl FnMut(&str),
) -> Result<Completed, CoreError> {
    let description = describe(args);
    let started = Instant::now();
    let mut command = in_directory(dir, args);
    let askpass = cancel
        .auth
        .clone()
        .map(|auth| Askpass::start(auth, cancel.plan.clone(), cancel.passphrases.clone()))
        .transpose()?;
    if let Some(askpass) = &askpass {
        askpass.apply(&mut command);
    }
    match &cancel.ssh_key {
        Some(key) => {
            command.env("GIT_SSH_COMMAND", ssh_command(key, askpass.is_none()));
        }
        None if askpass.is_none() && non_interactive_ssh(dir) => {
            command.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
        }
        None => {}
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            askpass.map(Askpass::finish);
            return Err(spawn_failure(&error, &description));
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stdout) = stdout {
            let _ = stdout.read_to_end(&mut bytes);
        }
        bytes
    });
    let (sender, lines) = mpsc::channel();
    let err_reader = thread::spawn(move || {
        if let Some(stderr) = stderr {
            forward_lines(stderr, sender);
        }
    });
    let mut kept = Vec::new();
    let mut killed = false;
    let mut timed_out = false;
    loop {
        if cancel.is_cancelled() {
            killed = true;
            let _ = child.kill();
            break;
        }
        if deadline.is_some_and(|limit| Instant::now() >= limit) {
            timed_out = true;
            let _ = child.kill();
            break;
        }
        match lines.recv_timeout(CANCEL_POLL) {
            Ok(line) => {
                on_line(&line);
                if parse_progress(&line).is_none() {
                    kept.push(line);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = child
        .wait()
        .map_err(|error| spawn_failure(&error, &description));
    let outcome = askpass.map(Askpass::finish).unwrap_or_default();
    let status = status?;
    if killed {
        return Err(CoreError::Cancelled);
    }
    if timed_out {
        return Err(CoreError::GitFailed {
            command: description,
            status: None,
            stderr: "timed out".to_owned(),
        });
    }
    let _ = err_reader.join();
    let stdout = out_reader.join().unwrap_or_default();
    let completed = Completed {
        status: status.code(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: kept.join("\n"),
    };
    note(&description, &completed, started);
    if outcome.cancelled && !completed.succeeded() {
        return Err(CoreError::Cancelled);
    }
    if completed.succeeded() {
        askpass::settle_credentials(dir, &outcome.used)?;
    }
    Ok(completed)
}

pub fn git_version() -> Result<GitVersion, CoreError> {
    let mut command = base_command();
    command.arg("--version");
    let completed = capture(command, None, "git --version")?;
    parse_version(&checked(completed, "git --version".to_owned())?)
}

pub fn ensure_supported() -> Result<GitVersion, CoreError> {
    let version = git_version()?;
    if (version.major, version.minor) < (REQUIRED_MAJOR, REQUIRED_MINOR) {
        return Err(CoreError::GitTooOld {
            found: version.text,
            required: format!("{REQUIRED_MAJOR}.{REQUIRED_MINOR}"),
        });
    }
    Ok(version)
}

fn parse_version(output: &str) -> Result<GitVersion, CoreError> {
    let text = output
        .trim()
        .strip_prefix("git version ")
        .ok_or_else(|| CoreError::invalid_output("git --version", output.trim()))?
        .to_owned();
    let mut parts = text.split('.');
    let mut number = |label: &str| {
        parts
            .next()
            .and_then(|part| part.parse::<u32>().ok())
            .ok_or_else(|| {
                CoreError::invalid_output(
                    "git --version",
                    format!("no {label} version in {text:?}"),
                )
            })
    };
    let major = number("major")?;
    let minor = number("minor")?;
    Ok(GitVersion { major, minor, text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_vendor_versions() {
        let plain = parse_version("git version 2.55.0\n").unwrap();
        assert_eq!(
            (plain.major, plain.minor, plain.text.as_str()),
            (2, 55, "2.55.0")
        );
        let vendor = parse_version("git version 2.39.3 (Apple Git-146)\n").unwrap();
        assert_eq!((vendor.major, vendor.minor), (2, 39));
        assert_eq!(vendor.text, "2.39.3 (Apple Git-146)");
    }

    #[test]
    fn parses_git_progress_lines_with_and_without_the_remote_prefix() {
        assert_eq!(
            parse_progress("Receiving objects:  42% (5/12), 1.2 MiB | 2.0 MiB/s"),
            Some(("Receiving objects".to_owned(), 42))
        );
        assert_eq!(
            parse_progress("remote: Counting objects: 100% (5/5), done."),
            Some(("Counting objects".to_owned(), 100))
        );
        assert_eq!(
            parse_progress("Resolving deltas:   0% (0/3)"),
            Some(("Resolving deltas".to_owned(), 0))
        );
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        assert_eq!(
            parse_progress("remote: Enumerating objects: 5, done."),
            None
        );
        assert_eq!(parse_progress("From /tmp/remote"), None);
        assert_eq!(
            parse_progress("fatal: could not read Username: terminal prompts disabled"),
            None
        );
        assert_eq!(
            parse_progress(" * [new branch]      main       -> origin/main"),
            None
        );
    }

    #[test]
    fn rejects_unrecognised_version_output() {
        assert!(matches!(
            parse_version("not git"),
            Err(CoreError::InvalidGitOutput { .. })
        ));
        assert!(matches!(
            parse_version("git version x.y"),
            Err(CoreError::InvalidGitOutput { .. })
        ));
    }
}
