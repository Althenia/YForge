use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::{symlink, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::branch;
use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::repo;
use crate::store::{approve_hook_hash, approved_hook_hash};

pub const HOOK_LIMIT: Duration = Duration::from_secs(120);

const POLL: Duration = Duration::from_millis(50);
const DRAIN: Duration = Duration::from_millis(200);
const SCRIPT_LIMIT: u64 = 512 * 1024;
const SAMPLE_SUFFIX: &str = ".sample";
const NOT_A_HOOK: &str = "Not a Git hook name";
const NOT_EXECUTABLE: &str = "Not executable: Git skips this hook";
const HOOK_NAMES: [&str; 28] = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-receive",
    "update",
    "proc-receive",
    "post-receive",
    "post-update",
    "reference-transaction",
    "push-to-checkout",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "fsmonitor-watchman",
    "p4-changelist",
    "p4-prepare-changelist",
    "p4-post-changelist",
    "p4-pre-submit",
    "post-index-change",
];
const STOPPING_HOOKS: [&str; 12] = [
    "applypatch-msg",
    "pre-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "pre-rebase",
    "pre-push",
    "pre-receive",
    "update",
    "push-to-checkout",
    "pre-auto-gc",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct HookEntry {
    pub name: String,
    pub path: String,
    pub active: bool,
    pub reason: Option<String>,
    pub hash: String,
    pub approved: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct HookList {
    pub directory: String,
    pub hooks: Vec<HookEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct HookScript {
    pub hook: HookEntry,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HookMode {
    Run,
    Test,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HookStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct HookOutput {
    pub id: String,
    pub stream: HookStream,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HookEnd {
    Exited,
    TimedOut,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
pub struct HookOutcome {
    pub end: HookEnd,
    pub exit_code: Option<i32>,
    pub stops_git: bool,
}

fn hooks_directory(root: &Path) -> Result<PathBuf, CoreError> {
    let output = git::run(root, &["rev-parse", "--git-path", "hooks"])?;
    Ok(root.join(output.trim_end_matches('\n')))
}

fn repository_key(root: &Path) -> Result<String, CoreError> {
    let output = git::run(
        root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    Ok(output.trim_end_matches('\n').to_owned())
}

fn inactive_reason(name: &str, executable: bool) -> Option<String> {
    if !HOOK_NAMES.contains(&name) {
        Some(NOT_A_HOOK.to_owned())
    } else if !executable {
        Some(NOT_EXECUTABLE.to_owned())
    } else {
        None
    }
}

fn entry_for(
    dir: &Path,
    root: &Path,
    repository: &str,
    file: &Path,
    name: &str,
) -> Result<Option<HookEntry>, CoreError> {
    let Ok(metadata) = fs::metadata(file) else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    let reason = inactive_reason(name, metadata.permissions().mode() & 0o111 != 0);
    let path = file.to_string_lossy().into_owned();
    let hash = git::run(root, &["hash-object", "--", &path])?
        .trim()
        .to_owned();
    let approved = approved_hook_hash(dir, repository, name)?.as_deref() == Some(hash.as_str());
    Ok(Some(HookEntry {
        name: name.to_owned(),
        path,
        active: reason.is_none(),
        reason,
        hash,
        approved,
    }))
}

pub fn hooks_list(dir: &Path, path: &Path) -> Result<HookList, CoreError> {
    let root = repo::open(path)?;
    let directory = hooks_directory(&root)?;
    let repository = repository_key(&root)?;
    let mut names: Vec<String> = match fs::read_dir(&directory) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| !name.ends_with(SAMPLE_SUFFIX))
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    let mut hooks = Vec::new();
    for name in names {
        if let Some(entry) = entry_for(dir, &root, &repository, &directory.join(&name), &name)? {
            hooks.push(entry);
        }
    }
    Ok(HookList {
        directory: directory.to_string_lossy().into_owned(),
        hooks,
    })
}

fn find(dir: &Path, root: &Path, name: &str) -> Result<HookEntry, CoreError> {
    if name.is_empty() || name.contains('/') || name.ends_with(SAMPLE_SUFFIX) {
        return Err(CoreError::invalid_request(format!(
            "{name:?} is not a hook file"
        )));
    }
    let directory = hooks_directory(root)?;
    let repository = repository_key(root)?;
    entry_for(dir, root, &repository, &directory.join(name), name)?
        .ok_or_else(|| CoreError::invalid_request(format!("there is no hook {name}")))
}

pub fn hook_read(dir: &Path, path: &Path, name: &str) -> Result<HookScript, CoreError> {
    let root = repo::open(path)?;
    let hook = find(dir, &root, name)?;
    let file = fs::File::open(&hook.path).map_err(|error| {
        CoreError::invalid_request(format!("could not read {}: {error}", hook.path))
    })?;
    let mut bytes = Vec::new();
    file.take(SCRIPT_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            CoreError::invalid_request(format!("could not read {}: {error}", hook.path))
        })?;
    let truncated = bytes.len() as u64 > SCRIPT_LIMIT;
    bytes.truncate(SCRIPT_LIMIT as usize);
    Ok(HookScript {
        hook,
        content: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

pub fn hook_approve(dir: &Path, path: &Path, name: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let hook = find(dir, &root, name)?;
    if let Some(reason) = hook.reason {
        return Err(CoreError::invalid_request(reason));
    }
    approve_hook_hash(dir, &repository_key(&root)?, name, &hook.hash)
}

struct Scratch {
    root: PathBuf,
    base: PathBuf,
    tree: Option<PathBuf>,
}

impl Scratch {
    fn new(root: &Path) -> Result<Self, CoreError> {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let base = std::env::temp_dir().join(format!("yforge-hook-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&base).map_err(|error| {
            CoreError::invalid_request(format!("could not create a temporary folder: {error}"))
        })?;
        Ok(Self {
            root: root.to_owned(),
            base,
            tree: None,
        })
    }

    fn message_file(&self, message: &str) -> Result<String, CoreError> {
        let file = self.base.join("COMMIT_EDITMSG");
        let text = if message.is_empty() || message.ends_with('\n') {
            message.to_owned()
        } else {
            format!("{message}\n")
        };
        fs::write(&file, text).map_err(|error| {
            CoreError::invalid_request(format!("could not write the message file: {error}"))
        })?;
        Ok(file.to_string_lossy().into_owned())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if let Some(tree) = &self.tree {
            let _ = git::run_unchecked(
                &self.root,
                &["worktree", "remove", "--force", &tree.to_string_lossy()],
                None,
            );
        }
        let _ = fs::remove_dir_all(&self.base);
        if self.tree.is_some() {
            let _ = git::run_unchecked(&self.root, &["worktree", "prune"], None);
        }
    }
}

const WITHOUT_HOOKS: [(&str, &str); 3] = [
    ("GIT_CONFIG_COUNT", "1"),
    ("GIT_CONFIG_KEY_0", "core.hooksPath"),
    ("GIT_CONFIG_VALUE_0", "/dev/null"),
];

fn write_patch(scratch: &Scratch, name: &str, patch: &[u8]) -> Result<String, CoreError> {
    let file = scratch.base.join(name);
    fs::write(&file, patch).map_err(|error| {
        CoreError::invalid_request(format!("could not write a temporary patch: {error}"))
    })?;
    Ok(file.to_string_lossy().into_owned())
}

fn copy_untracked(root: &Path, tree: &Path) -> Result<(), CoreError> {
    let listing = git::run(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for relative in listing.split('\0').filter(|entry| !entry.is_empty()) {
        if relative.ends_with('/') {
            continue;
        }
        let (from, to) = (root.join(relative), tree.join(relative));
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                CoreError::invalid_request(format!("could not copy {relative}: {error}"))
            })?;
        }
        let copied = match fs::symlink_metadata(&from) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                fs::read_link(&from).and_then(|target| symlink(target, &to))
            }
            Ok(_) => fs::copy(&from, &to).map(drop),
            Err(error) => Err(error),
        };
        copied.map_err(|error| {
            CoreError::invalid_request(format!("could not copy {relative}: {error}"))
        })?;
    }
    Ok(())
}

fn prepare_tree(scratch: &mut Scratch) -> Result<(PathBuf, Vec<(String, String)>), CoreError> {
    let root = scratch.root.clone();
    let tree = scratch.base.join("tree");
    let objects = scratch.base.join("objects");
    fs::create_dir(&objects).map_err(|error| {
        CoreError::invalid_request(format!("could not create a temporary folder: {error}"))
    })?;
    let common = git::run(
        &root,
        &[
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "objects",
        ],
    )?;
    let quarantine = vec![
        (
            "GIT_OBJECT_DIRECTORY".to_owned(),
            objects.to_string_lossy().into_owned(),
        ),
        (
            "GIT_ALTERNATE_OBJECT_DIRECTORIES".to_owned(),
            common.trim_end_matches('\n').to_owned(),
        ),
    ];
    let borrowed: Vec<(&str, &str)> = quarantine
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect();
    scratch.tree = Some(tree.clone());
    git::run_env(
        &root,
        &[
            "worktree",
            "add",
            "--detach",
            "--quiet",
            &tree.to_string_lossy(),
            "HEAD",
        ],
        &WITHOUT_HOOKS,
    )
    .map_err(|error| match error {
        CoreError::GitFailed { stderr, .. } => {
            CoreError::invalid_request(format!("could not create the temporary worktree: {stderr}"))
        }
        other => other,
    })?;
    let staged = git::run_bytes(&root, &["diff", "--cached", "--binary", "--no-ext-diff"])?;
    if !staged.is_empty() {
        let patch = write_patch(scratch, "staged.patch", &staged)?;
        git::run_env(
            &tree,
            &["apply", "--index", "--whitespace=nowarn", &patch],
            &borrowed,
        )?;
    }
    let unstaged = git::run_bytes(&root, &["diff", "--binary", "--no-ext-diff"])?;
    if !unstaged.is_empty() {
        let patch = write_patch(scratch, "unstaged.patch", &unstaged)?;
        git::run_env(&tree, &["apply", "--whitespace=nowarn", &patch], &borrowed)?;
    }
    copy_untracked(&root, &tree)?;
    Ok((tree, quarantine))
}

fn upstream_remote(root: &Path) -> Result<(String, String), CoreError> {
    let branch = branch::current_branch(root)?.ok_or_else(|| {
        CoreError::invalid_request("pre-push needs a checked-out branch with an upstream remote")
    })?;
    let reference = format!("refs/heads/{branch}");
    let remote = git::run(
        root,
        &[
            "for-each-ref",
            "--format=%(upstream:remotename)",
            &reference,
        ],
    )?
    .trim()
    .to_owned();
    if remote.is_empty() || remote == "." {
        return Err(CoreError::invalid_request(format!(
            "{branch} has no upstream remote, so there is no remote name and URL to give pre-push"
        )));
    }
    let url = git::run(root, &["remote", "get-url", "--push", &remote])?
        .trim()
        .to_owned();
    Ok((remote, url))
}

fn hook_arguments(
    root: &Path,
    name: &str,
    scratch: &Scratch,
    message: &str,
) -> Result<Vec<String>, CoreError> {
    Ok(match name {
        "commit-msg" | "prepare-commit-msg" => vec![scratch.message_file(message)?],
        "pre-push" => {
            let (remote, url) = upstream_remote(root)?;
            vec![remote, url]
        }
        "post-checkout" => vec!["HEAD".to_owned(), "HEAD".to_owned(), "1".to_owned()],
        _ => Vec::new(),
    })
}

fn forward(pipe: impl Read, stream: HookStream, lines: mpsc::Sender<(HookStream, String)>) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    while reader
        .read_until(b'\n', &mut line)
        .is_ok_and(|read| read > 0)
    {
        let text = String::from_utf8_lossy(&line).into_owned();
        line.clear();
        if lines.send((stream, text)).is_err() {
            return;
        }
    }
}

fn kill_group(pid: u32) {
    let _ = Command::new("sh")
        .args(["-c", &format!("kill -s KILL -- -{pid}")])
        .output();
}

#[allow(clippy::too_many_arguments)]
fn execute(
    script: &str,
    arguments: &[String],
    cwd: &Path,
    environment: &[(String, String)],
    limit: Duration,
    cancel: &CancelToken,
    on_output: &mut dyn FnMut(HookStream, &str),
) -> Result<HookOutcome, CoreError> {
    let mut child = Command::new(script)
        .args(arguments)
        .current_dir(cwd)
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|error| {
            CoreError::invalid_request(format!("could not start {script}: {error}"))
        })?;
    let (sender, lines) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let sender = sender.clone();
        thread::spawn(move || forward(stdout, HookStream::Stdout, sender));
    }
    if let Some(stderr) = child.stderr.take() {
        let sender = sender.clone();
        thread::spawn(move || forward(stderr, HookStream::Stderr, sender));
    }
    drop(sender);
    let deadline = Instant::now() + limit;
    let mut open = true;
    let (end, status) = loop {
        let interrupted = if cancel.is_cancelled() {
            Some(HookEnd::Stopped)
        } else if Instant::now() >= deadline {
            Some(HookEnd::TimedOut)
        } else {
            None
        };
        if let Some(end) = interrupted {
            kill_group(child.id());
            let status = child.wait().ok();
            break (end, status);
        }
        if open {
            match lines.recv_timeout(POLL) {
                Ok((stream, text)) => on_output(stream, &text),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => open = false,
            }
        } else {
            thread::sleep(POLL);
        }
        if let Ok(Some(status)) = child.try_wait() {
            break (HookEnd::Exited, Some(status));
        }
    };
    while let Ok((stream, text)) = lines.recv_timeout(DRAIN) {
        on_output(stream, &text);
    }
    let exit_code = status.and_then(|status| status.code());
    Ok(HookOutcome {
        end,
        exit_code,
        stops_git: false,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn run_hook(
    dir: &Path,
    path: &Path,
    name: &str,
    mode: HookMode,
    message: &str,
    limit: Duration,
    cancel: &CancelToken,
    on_output: &mut dyn FnMut(HookStream, &str),
) -> Result<HookOutcome, CoreError> {
    let root = repo::open(path)?;
    let hook = find(dir, &root, name)?;
    if let Some(reason) = &hook.reason {
        return Err(CoreError::invalid_request(reason.clone()));
    }
    if !hook.approved {
        return Err(CoreError::invalid_request(format!(
            "{} has not been approved to run: confirm it first",
            hook.path
        )));
    }
    let mut scratch = Scratch::new(&root)?;
    let arguments = hook_arguments(&root, name, &scratch, message)?;
    let outcome = match mode {
        HookMode::Run => execute(&hook.path, &arguments, &root, &[], limit, cancel, on_output)?,
        HookMode::Test => {
            let (tree, quarantine) = prepare_tree(&mut scratch)?;
            execute(
                &hook.path,
                &arguments,
                &tree,
                &quarantine,
                limit,
                cancel,
                on_output,
            )?
        }
    };
    let failed = outcome.exit_code != Some(0);
    Ok(HookOutcome {
        stops_git: outcome.end == HookEnd::Exited && failed && STOPPING_HOOKS.contains(&name),
        ..outcome
    })
}
