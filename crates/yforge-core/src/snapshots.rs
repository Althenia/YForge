use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{LazyLock, Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::activity;
use crate::branch;
use crate::error::CoreError;
use crate::git;
use crate::model::{FileStatus, SnapshotChange, SnapshotInfo};
use crate::operation;
use crate::repo;
use crate::stage;
use crate::undo;

const REF_PREFIX: &str = "refs/yforge/snapshots/";
const RETENTION_MS: u128 = 30 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOTS: usize = 200;
const CREATE_ATTEMPTS: u128 = 8;
const IDENTITY: [(&str, &str); 4] = [
    ("GIT_AUTHOR_NAME", "YForge"),
    ("GIT_AUTHOR_EMAIL", "snapshots@yforge.invalid"),
    ("GIT_COMMITTER_NAME", "YForge"),
    ("GIT_COMMITTER_EMAIL", "snapshots@yforge.invalid"),
];
pub(crate) const MESSAGE_MARK: &str = "YForge snapshot";
const INDEX_MESSAGE: &str = "YForge snapshot index";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Discard,
    DiscardHunk,
    DiscardLines,
    ResetHard,
    Checkout,
    InteractiveRebase,
    SquashCommits,
    Recompose,
    DropStash,
    DeleteBranch,
    RemoveWorktree,
    RestoreFiles,
    RestoreSnapshot,
}

impl Action {
    fn slug(self) -> &'static str {
        match self {
            Self::Discard => "discard",
            Self::DiscardHunk => "discard_hunk",
            Self::DiscardLines => "discard_lines",
            Self::ResetHard => "reset_hard",
            Self::Checkout => "checkout",
            Self::InteractiveRebase => "interactive_rebase",
            Self::SquashCommits => "squash_commits",
            Self::Recompose => "recompose",
            Self::DropStash => "drop_stash",
            Self::DeleteBranch => "delete_branch",
            Self::RemoveWorktree => "remove_worktree",
            Self::RestoreFiles => "restore_files",
            Self::RestoreSnapshot => "restore_snapshot",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Discard => "discarding changes",
            Self::DiscardHunk => "discarding a hunk",
            Self::DiscardLines => "discarding lines",
            Self::ResetHard => "a hard reset",
            Self::Checkout => "switching with an automatic stash",
            Self::InteractiveRebase => "an interactive rebase",
            Self::SquashCommits => "squashing commits",
            Self::Recompose => "recomposing commits",
            Self::DropStash => "dropping a stash",
            Self::DeleteBranch => "deleting a branch",
            Self::RemoveWorktree => "removing a worktree",
            Self::RestoreFiles => "restoring files from a snapshot",
            Self::RestoreSnapshot => "restoring a snapshot",
        }
    }
}

pub(crate) struct Taken {
    pub reference: String,
    worktree_tree: String,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

struct ScratchIndex {
    path: PathBuf,
    env: String,
}

static SCRATCH_COUNTER: AtomicU32 = AtomicU32::new(0);

impl ScratchIndex {
    fn create(root: &Path) -> Result<Self, CoreError> {
        let git_path = |name: &str| -> Result<PathBuf, CoreError> {
            let output = git::run(root, &["rev-parse", "--git-path", name])?;
            Ok(root.join(output.trim_end_matches('\n')))
        };
        let real = git_path("index")?;
        let scratch = git_path(&format!(
            "yforge-snapshot-index-{}-{}",
            std::process::id(),
            SCRATCH_COUNTER.fetch_add(1, Ordering::SeqCst)
        ))?;
        if real.is_file() {
            fs::copy(&real, &scratch).map_err(|error| failed_io(&scratch, &error))?;
        }
        Ok(Self {
            env: scratch.to_string_lossy().into_owned(),
            path: scratch,
        })
    }

    fn run(&self, root: &Path, args: &[&str]) -> Result<String, CoreError> {
        git::run_env(root, args, &[("GIT_INDEX_FILE", &self.env)])
    }

    fn write_tree(&self, root: &Path) -> Result<String, CoreError> {
        let completed = git::run_with_env(root, &["write-tree"], &[("GIT_INDEX_FILE", &self.env)])?;
        if completed.succeeded() {
            return Ok(completed.stdout.trim().to_owned());
        }
        let unmerged = self.run(root, &["ls-files", "--unmerged", "-z"])?;
        let mut paths: Vec<String> = unmerged
            .split('\0')
            .filter_map(|entry| entry.split_once('\t').map(|(_, path)| path.to_owned()))
            .collect();
        paths.sort();
        paths.dedup();
        if paths.is_empty() {
            return Err(CoreError::GitFailed {
                command: "git write-tree".to_owned(),
                status: completed.status,
                stderr: completed.stderr.trim().to_owned(),
            });
        }
        self.run(
            root,
            &stage::with_paths(&["rm", "--cached", "--quiet", "--ignore-unmatch"], &paths),
        )?;
        Ok(self.run(root, &["write-tree"])?.trim().to_owned())
    }
}

impl Drop for ScratchIndex {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn failed_io(path: &Path, error: &std::io::Error) -> CoreError {
    CoreError::GitFailed {
        command: format!("write {}", path.display()),
        status: None,
        stderr: error.to_string(),
    }
}

fn commit_tree(
    root: &Path,
    tree: &str,
    parents: &[&str],
    message: &str,
) -> Result<String, CoreError> {
    let mut args = vec!["commit-tree", tree];
    for parent in parents {
        args.extend(["-p", parent]);
    }
    args.extend(["-m", message]);
    Ok(git::run_env(root, &args, &IDENTITY)?.trim().to_owned())
}

fn empty_tree(root: &Path) -> Result<String, CoreError> {
    Ok(git::run(root, &["hash-object", "-t", "tree", "/dev/null"])?
        .trim()
        .to_owned())
}

fn base_tree(root: &Path, head: Option<&str>) -> Result<String, CoreError> {
    match head {
        Some(head) => Ok(git::run(root, &["rev-parse", &format!("{head}^{{tree}}")])?
            .trim()
            .to_owned()),
        None => empty_tree(root),
    }
}

pub(crate) struct TreeChange {
    pub status: FileStatus,
    pub old_mode: String,
    pub new_mode: String,
    pub new_sha: String,
    pub path: String,
}

pub(crate) fn tree_changes(
    root: &Path,
    from: &str,
    to: &str,
) -> Result<Vec<TreeChange>, CoreError> {
    let output = git::run(
        root,
        &["diff-tree", "-r", "--no-renames", "--raw", "-z", from, to],
    )?;
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut changes = Vec::new();
    while let Some(header) = fields.next() {
        let path = fields.next().ok_or_else(|| {
            CoreError::invalid_output("git diff-tree", format!("no path after {header:?}"))
        })?;
        let parts: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
        let [old_mode, new_mode, _, new_sha, letter] = parts[..] else {
            return Err(CoreError::invalid_output(
                "git diff-tree",
                format!("unexpected line {header:?}"),
            ));
        };
        changes.push(TreeChange {
            status: match letter {
                "A" => FileStatus::Added,
                "D" => FileStatus::Deleted,
                "T" => FileStatus::TypeChanged,
                _ => FileStatus::Modified,
            },
            old_mode: old_mode.to_owned(),
            new_mode: new_mode.to_owned(),
            new_sha: new_sha.to_owned(),
            path: path.to_owned(),
        });
    }
    Ok(changes)
}

fn take(
    root: &Path,
    action: Action,
    detail: &str,
    subject: Option<&str>,
) -> Result<Taken, CoreError> {
    let head = undo::head_sha(root)?;
    let branch = branch::current_branch(root)?;
    let (index_tree, worktree_tree) = activity::quietly(|| -> Result<_, CoreError> {
        let scratch = ScratchIndex::create(root)?;
        let index_tree = scratch.write_tree(root)?;
        scratch.run(root, &["add", "--all"])?;
        Ok((index_tree, scratch.write_tree(root)?))
    })?;
    let parents: Vec<&str> = head.as_deref().into_iter().collect();
    let commit = activity::quietly(|| -> Result<_, CoreError> {
        let index_commit = commit_tree(root, &index_tree, &parents, INDEX_MESSAGE)?;
        let base = base_tree(root, head.as_deref())?;
        let files = tree_changes(root, &base, &worktree_tree)?.len();
        let state = match (&branch, &head) {
            (Some(name), Some(sha)) => format!("on {name} at {}", short(sha)),
            (None, Some(sha)) => format!("detached at {}", short(sha)),
            (_, None) => "before the first commit".to_owned(),
        };
        let mut message = format!(
            "{MESSAGE_MARK}: {}\n\n{} ({state}, {files} changed path(s) against HEAD)\n\n\
             YForge-Action: {}\nYForge-Head: {}\nYForge-Branch: {}\nYForge-Index: {index_commit}\nYForge-Files: {files}",
            action.slug(),
            detail.replace('\n', " "),
            action.slug(),
            head.as_deref().unwrap_or("-"),
            branch.as_deref().unwrap_or("-"),
        );
        if let Some(subject) = subject {
            message.push_str(&format!("\nYForge-Subject: {subject}"));
        }
        let mut all_parents = parents.clone();
        all_parents.push(&index_commit);
        commit_tree(root, &worktree_tree, &all_parents, &message)
    })?;
    let reference = store_ref(root, action, &commit)?;
    let _ = prune(root);
    Ok(Taken {
        reference,
        worktree_tree,
    })
}

fn store_ref(root: &Path, action: Action, commit: &str) -> Result<String, CoreError> {
    let start = now_ms();
    let mut last = None;
    for step in 0..CREATE_ATTEMPTS {
        let name = format!("{REF_PREFIX}{}-{}", start + step, action.slug());
        let request = format!("create {name} {commit}\n");
        match git::run_with_input(root, &["update-ref", "--stdin"], &request) {
            Ok(_) => return Ok(name),
            Err(error) => {
                if !branch::ref_exists(root, &name)? {
                    return Err(error);
                }
                last = Some(error);
            }
        }
    }
    Err(last.unwrap_or_else(|| CoreError::invalid_request("could not name the snapshot")))
}

pub(crate) fn capture(
    root: &Path,
    action: Action,
    detail: &str,
    subject: Option<&str>,
) -> Result<Taken, CoreError> {
    take(root, action, detail, subject).map_err(|error| CoreError::SnapshotFailed {
        action: action.label().to_owned(),
        detail: error.to_string(),
    })
}

fn snapshot_time_ms(reference: &str) -> Option<u128> {
    reference
        .strip_prefix(REF_PREFIX)?
        .split('-')
        .next()?
        .parse()
        .ok()
}

fn snapshot_refs(root: &Path) -> Result<Vec<(String, u128)>, CoreError> {
    let output = git::run(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/yforge/snapshots",
        ],
    )?;
    let mut refs: Vec<(String, u128)> = output
        .lines()
        .filter_map(|line| Some((line.to_owned(), snapshot_time_ms(line)?)))
        .collect();
    refs.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| right.0.cmp(&left.0)));
    Ok(refs)
}

pub(crate) fn prune(root: &Path) -> Result<u32, CoreError> {
    let refs = snapshot_refs(root)?;
    let cutoff = now_ms().saturating_sub(RETENTION_MS);
    let expired: Vec<&str> = refs
        .iter()
        .enumerate()
        .filter(|(position, (_, time))| *time < cutoff || *position >= MAX_SNAPSHOTS)
        .map(|(_, (name, _))| name.as_str())
        .collect();
    if expired.is_empty() {
        return Ok(0);
    }
    let requests: String = expired
        .iter()
        .map(|name| format!("delete {name}\n"))
        .collect();
    git::run_with_input(root, &["update-ref", "--stdin"], &requests)?;
    Ok(u32::try_from(expired.len()).unwrap_or(u32::MAX))
}

static PRUNED: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(Mutex::default);

pub(crate) fn prune_on_open(root: &Path) {
    let first = PRUNED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(root.to_path_buf());
    if first {
        let _ = prune(root);
    }
}

struct Snapshot {
    worktree_tree: String,
    index_commit: String,
    head: Option<String>,
    branch: Option<String>,
    action: String,
    description: String,
    files: u32,
}

fn trailer<'a>(message: &'a str, key: &str) -> Option<&'a str> {
    message
        .lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix(": "))
}

fn present(value: &str) -> Option<String> {
    (value != "-").then(|| value.to_owned())
}

fn parse_snapshot(tree: &str, message: &str) -> Option<Snapshot> {
    if !message.starts_with(MESSAGE_MARK) {
        return None;
    }
    let description = message
        .split("\n\n")
        .nth(1)
        .unwrap_or_default()
        .trim()
        .to_owned();
    Some(Snapshot {
        worktree_tree: tree.to_owned(),
        index_commit: trailer(message, "YForge-Index")?.to_owned(),
        head: present(trailer(message, "YForge-Head")?),
        branch: present(trailer(message, "YForge-Branch")?),
        action: trailer(message, "YForge-Action")?.to_owned(),
        description,
        files: trailer(message, "YForge-Files")?.parse().ok()?,
    })
}

fn read_snapshot(root: &Path, reference: &str) -> Result<Snapshot, CoreError> {
    let unknown = || CoreError::invalid_request(format!("{reference} is not a YForge snapshot"));
    if !reference.starts_with(REF_PREFIX) || snapshot_time_ms(reference).is_none() {
        return Err(unknown());
    }
    let valid = git::run_unchecked(root, &["check-ref-format", reference], None)?;
    let found = git::run_unchecked(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{reference}^{{commit}}"),
        ],
        None,
    )?;
    if !valid.succeeded() || !found.succeeded() {
        return Err(unknown());
    }
    let output = git::run(
        root,
        &[
            "log",
            "-1",
            "--no-show-signature",
            "--format=%T%x1f%B",
            reference,
        ],
    )?;
    let (tree, message) = output.split_once('\u{1f}').ok_or_else(unknown)?;
    parse_snapshot(tree.trim(), message).ok_or_else(unknown)
}

pub fn snapshots_list(path: &Path) -> Result<Vec<SnapshotInfo>, CoreError> {
    let root = repo::open(path)?;
    let mut infos = Vec::new();
    for (reference, time) in snapshot_refs(&root)? {
        if let Ok(snapshot) = read_snapshot(&root, &reference) {
            infos.push(SnapshotInfo {
                reference,
                time: i64::try_from(time / 1000).unwrap_or(i64::MAX),
                action: snapshot.action,
                description: snapshot.description,
                head_sha: snapshot.head,
                branch: snapshot.branch,
                files_changed: snapshot.files,
            });
        }
    }
    Ok(infos)
}

pub fn snapshot_changed_files(
    path: &Path,
    reference: &str,
) -> Result<Vec<SnapshotChange>, CoreError> {
    let root = repo::open(path)?;
    let snapshot = read_snapshot(&root, reference)?;
    let base = base_tree(&root, snapshot.head.as_deref())?;
    Ok(tree_changes(&root, &base, &snapshot.worktree_tree)?
        .into_iter()
        .map(|change| SnapshotChange {
            path: change.path,
            status: change.status,
        })
        .collect())
}

pub fn snapshot_delete(path: &Path, reference: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    read_snapshot(&root, reference)?;
    git::run(&root, &["update-ref", "-d", reference]).map(drop)
}

fn refuse(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_request(format!("{}. Nothing was changed", detail.into()))
}

fn check_inside(root: &Path, target: &Path) -> Result<(), CoreError> {
    let relative = target.strip_prefix(root).unwrap_or(target);
    let mut current = root.to_path_buf();
    let count = relative.components().count();
    for (position, component) in relative.components().enumerate() {
        current.push(component);
        let is_leaf = position + 1 == count;
        if !is_leaf
            && fs::symlink_metadata(&current)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return Err(CoreError::invalid_request(format!(
                "{} passes through a symbolic link",
                relative.display()
            )));
        }
    }
    Ok(())
}

fn write_blob(root: &Path, path: &str, mode: &str, sha: &str) -> Result<(), CoreError> {
    let target = root.join(path);
    let io = |error: std::io::Error| {
        CoreError::invalid_request(format!("could not write {path}: {error}"))
    };
    let content = git::run_bytes(root, &["cat-file", "blob", sha])?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(io)?;
    }
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.is_dir() {
            return Err(CoreError::invalid_request(format!(
                "{path} is a folder in the working tree"
            )));
        }
        fs::remove_file(&target).map_err(io)?;
    }
    if mode == "120000" {
        let link = String::from_utf8_lossy(&content).into_owned();
        return symlink(link, &target).map_err(io);
    }
    fs::write(&target, content).map_err(io)?;
    let permissions = if mode == "100755" { 0o755 } else { 0o644 };
    fs::set_permissions(&target, fs::Permissions::from_mode(permissions)).map_err(io)
}

fn remove_path(root: &Path, path: &str) -> Result<(), CoreError> {
    let target = root.join(path);
    if fs::symlink_metadata(&target).is_ok() {
        fs::remove_file(&target).map_err(|error| {
            CoreError::invalid_request(format!("could not remove {path}: {error}"))
        })?;
    }
    let mut parent = target.parent();
    while let Some(folder) = parent.filter(|folder| *folder != root) {
        if fs::remove_dir(folder).is_err() {
            break;
        }
        parent = folder.parent();
    }
    Ok(())
}

pub fn snapshot_restore_files(
    path: &Path,
    reference: &str,
    files: &[String],
) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    let snapshot = read_snapshot(&root, reference)?;
    let mut listing = git::run(
        &root,
        &stage::with_paths(&["ls-tree", "-z", &snapshot.worktree_tree], files),
    )?;
    let mut entries = Vec::new();
    while let Some((entry, rest)) = listing.split_once('\0') {
        let (meta, name) = entry.split_once('\t').ok_or_else(|| {
            CoreError::invalid_output("git ls-tree", format!("unexpected line {entry:?}"))
        })?;
        let parts: Vec<&str> = meta.split(' ').collect();
        let [mode, kind, sha] = parts[..] else {
            return Err(CoreError::invalid_output(
                "git ls-tree",
                format!("unexpected line {entry:?}"),
            ));
        };
        if kind != "blob" {
            return Err(refuse(format!("{name} is not a file in the snapshot")));
        }
        entries.push((name.to_owned(), mode.to_owned(), sha.to_owned()));
        listing = rest.to_owned();
    }
    for file in files {
        if !entries.iter().any(|(name, _, _)| name == file) {
            return Err(refuse(format!("{file} is not a file in the snapshot")));
        }
    }
    for (name, _, _) in &entries {
        check_inside(&root, &root.join(name)).map_err(|error| refuse(error.to_string()))?;
    }
    let safety = capture(
        &root,
        Action::RestoreFiles,
        &format!("Restore {} file(s) from {reference}", entries.len()),
        None,
    )?;
    for (name, mode, sha) in &entries {
        write_blob(&root, name, mode, sha)?;
    }
    Ok(safety.reference)
}

pub fn snapshot_restore_all(
    path: &Path,
    reference: &str,
    force: bool,
) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    operation::require_settled(&root)?;
    let snapshot = read_snapshot(&root, reference)?;
    let head = undo::head_sha(&root)?;
    let branch = branch::current_branch(&root)?;
    if !force && (head != snapshot.head || branch != snapshot.branch) {
        return Err(refuse(format!(
            "HEAD moved from {} to {} since this snapshot; restore with force to put its files on the current HEAD",
            snapshot.head.as_deref().map_or("the start", short),
            head.as_deref().map_or("the start", short)
        )));
    }
    let safety = capture(
        &root,
        Action::RestoreSnapshot,
        &format!("Restore everything from {reference}"),
        None,
    )?;
    let changes: Vec<TreeChange> =
        tree_changes(&root, &safety.worktree_tree, &snapshot.worktree_tree)?
            .into_iter()
            .filter(|change| change.old_mode != "160000" && change.new_mode != "160000")
            .collect();
    for change in &changes {
        check_inside(&root, &root.join(&change.path)).map_err(|error| refuse(error.to_string()))?;
    }
    for change in changes
        .iter()
        .filter(|change| change.status == FileStatus::Deleted)
    {
        remove_path(&root, &change.path)?;
    }
    for change in changes
        .iter()
        .filter(|change| change.status != FileStatus::Deleted)
    {
        write_blob(&root, &change.path, &change.new_mode, &change.new_sha)?;
    }
    git::run(&root, &["read-tree", "--reset", &snapshot.index_commit])?;
    git::run_unchecked(&root, &["update-index", "-q", "--refresh"], None)?;
    Ok(safety.reference)
}
