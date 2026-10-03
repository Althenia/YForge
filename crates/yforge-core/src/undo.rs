use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use crate::branch;
use crate::commit::validate_sha;
use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::model::{ForceLease, ResetMode};
use crate::refs;
use crate::repo;
use crate::stage;
use crate::sync::{run_network, Progress};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoState {
    pub head: Option<String>,
    pub branch: Option<String>,
    pub clean: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeadRef {
    Branch(String),
    Detached(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    pub mode: String,
    pub oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexChange {
    Unchanged,
    Restore {
        before: Option<IndexEntry>,
        after: Option<IndexEntry>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotFile {
    pub path: String,
    pub before: Option<String>,
    pub executable: bool,
    pub after: Option<String>,
    pub index: IndexChange,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoredBranch {
    pub name: String,
    pub sha: String,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UndoAction {
    ResetHard {
        branch: Option<String>,
        from: String,
        to: String,
    },
    ResetSoft {
        branch: Option<String>,
        from: String,
        to: String,
    },
    DeleteBranch {
        name: String,
        sha: String,
        restore_head: Option<HeadRef>,
    },
    RecreateBranch {
        name: String,
        sha: String,
        upstream: Option<String>,
    },
    RecreateBranches {
        branches: Vec<RestoredBranch>,
    },
    SwitchBack {
        from: HeadRef,
        to: HeadRef,
    },
    UnStash {
        sha: String,
        subject: String,
        pop: bool,
        applied_tree: String,
    },
    RestoreFiles {
        files: Vec<SnapshotFile>,
    },
    ForcePush {
        remote: String,
        remote_ref: String,
        pushed: String,
        previous: String,
    },
    RestoreRemoteBranch {
        remote: String,
        remote_ref: String,
        sha: String,
    },
    RestoreUpstream {
        branch: String,
        from: Option<String>,
        to: Option<String>,
    },
    AdvanceSoft {
        branch: Option<String>,
        from: String,
        to: String,
        tree: String,
    },
    CreateBranchAt {
        name: String,
        sha: String,
        switch: bool,
    },
    DeleteBranches {
        branches: Vec<RestoredBranch>,
    },
    Restash {
        sha: String,
        pop: bool,
        applied_tree: String,
    },
    DeleteRemoteBranchAt {
        remote: String,
        remote_ref: String,
        sha: String,
    },
    GitFlowFinish(crate::git_flow::FlowRestore),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoPlan {
    pub action: UndoAction,
    pub scope: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Planned {
    Available(UndoPlan),
    Unavailable(String),
}

fn unavailable(reason: impl Into<String>) -> Planned {
    Planned::Unavailable(reason.into())
}

fn available(action: UndoAction, scope: String) -> Planned {
    Planned::Available(UndoPlan { action, scope })
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(7)]
}

pub(crate) fn head_sha(root: &Path) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(root, &["rev-parse", "--verify", "--quiet", "HEAD"], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

pub(crate) fn tracked_changes(root: &Path) -> Result<bool, CoreError> {
    Ok(
        !git::run(root, &["status", "--porcelain", "--untracked-files=no"])?
            .trim()
            .is_empty(),
    )
}

pub fn capture_state(path: &Path) -> Result<RepoState, CoreError> {
    let root = repo::open(path)?;
    Ok(RepoState {
        head: head_sha(&root)?,
        branch: branch::current_branch(&root)?,
        clean: !tracked_changes(&root)?,
    })
}

pub fn head_ref(path: &Path) -> Result<Option<HeadRef>, CoreError> {
    let root = repo::open(path)?;
    Ok(match (branch::current_branch(&root)?, head_sha(&root)?) {
        (Some(name), _) => Some(HeadRef::Branch(name)),
        (None, Some(sha)) => Some(HeadRef::Detached(sha)),
        (None, None) => None,
    })
}

fn head_label(head: &HeadRef) -> String {
    match head {
        HeadRef::Branch(name) => name.clone(),
        HeadRef::Detached(sha) => short(sha).to_owned(),
    }
}

fn where_label(branch: &Option<String>) -> String {
    branch.clone().unwrap_or_else(|| "HEAD".to_owned())
}

pub fn plan_commit(before: &RepoState, after: &RepoState, amend: bool) -> Planned {
    let (Some(from), Some(to)) = (after.head.clone(), before.head.clone()) else {
        return unavailable("This was the first commit; there is no earlier HEAD to return to");
    };
    let place = where_label(&after.branch);
    let scope = if amend {
        format!(
            "Undo amend: moves {place} back to {} and keeps the amended changes staged",
            short(&to)
        )
    } else {
        format!(
            "Undo commit {}: moves {place} back to {} and keeps its changes staged",
            short(&from),
            short(&to)
        )
    };
    available(
        UndoAction::ResetSoft {
            branch: after.branch.clone(),
            from,
            to,
        },
        scope,
    )
}

pub fn plan_integration(
    verb: &str,
    before: &RepoState,
    after: &RepoState,
    stopped: bool,
) -> Planned {
    if stopped {
        return unavailable("The operation stopped on conflicts; finish or abort it instead");
    }
    let (Some(from), Some(to)) = (after.head.clone(), before.head.clone()) else {
        return unavailable("There is no earlier HEAD to return to");
    };
    if from == to {
        return unavailable("The operation did not move HEAD");
    }
    available(
        UndoAction::ResetHard {
            branch: after.branch.clone(),
            from,
            to: to.clone(),
        },
        format!(
            "Undo {verb}: hard-resets {} to {}; needs a clean working tree",
            where_label(&after.branch),
            short(&to)
        ),
    )
}

pub fn plan_reset(before: &RepoState, after: &RepoState, mode: ResetMode) -> Planned {
    if mode == ResetMode::Hard && !before.clean {
        return unavailable(
            "The reset discarded uncommitted changes; restore them from Recovery, Safety snapshots",
        );
    }
    if mode != ResetMode::Hard && !after.clean {
        return unavailable(
            "The reset left changes in the working tree; undo needs a clean working tree",
        );
    }
    plan_integration("reset", before, after, false)
}

pub fn plan_branch_create(
    name: &str,
    sha: &str,
    before: &Option<HeadRef>,
    checked_out: bool,
) -> Planned {
    available(
        UndoAction::DeleteBranch {
            name: name.to_owned(),
            sha: sha.to_owned(),
            restore_head: checked_out.then(|| before.clone()).flatten(),
        },
        format!(
            "Undo create branch: deletes {name} at {} if it has no new commits{}",
            short(sha),
            match (checked_out, before) {
                (true, Some(head)) => format!(" and switches back to {}", head_label(head)),
                _ => String::new(),
            }
        ),
    )
}

pub struct BranchSnapshot {
    pub sha: String,
    pub upstream: Option<String>,
}

pub fn branch_snapshot(path: &Path, name: &str) -> Result<Option<BranchSnapshot>, CoreError> {
    let root = repo::open(path)?;
    let full = format!("refs/heads/{name}");
    let output = git::run(
        &root,
        &[
            "for-each-ref",
            "--format=%(objectname)%00%(upstream:short)",
            &full,
        ],
    )?;
    Ok(output
        .trim_end_matches('\n')
        .split_once('\0')
        .map(|(sha, upstream)| BranchSnapshot {
            sha: sha.to_owned(),
            upstream: (!upstream.is_empty()).then(|| upstream.to_owned()),
        }))
}

pub fn plan_branch_delete(name: &str, snapshot: &BranchSnapshot) -> Planned {
    available(
        UndoAction::RecreateBranch {
            name: name.to_owned(),
            sha: snapshot.sha.clone(),
            upstream: snapshot.upstream.clone(),
        },
        format!(
            "Undo delete branch: recreates {name} at {}{}",
            short(&snapshot.sha),
            snapshot
                .upstream
                .as_ref()
                .map(|upstream| format!(" tracking {upstream}"))
                .unwrap_or_default()
        ),
    )
}

pub fn plan_branches_delete(deleted: &[(String, &BranchSnapshot)]) -> Planned {
    available(
        UndoAction::RecreateBranches {
            branches: deleted
                .iter()
                .map(|(name, snapshot)| RestoredBranch {
                    name: name.clone(),
                    sha: snapshot.sha.clone(),
                    upstream: snapshot.upstream.clone(),
                })
                .collect(),
        },
        format!(
            "Undo delete branches: recreates {} at the commits they had, with their upstreams",
            counted(deleted.len(), "branch", "branches")
        ),
    )
}

pub fn plan_force_push(lease: &ForceLease, pushed: &str) -> Planned {
    if lease.expected_sha == pushed {
        return unavailable("The force push did not move the remote branch");
    }
    let branch = lease
        .remote_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(&lease.remote_ref);
    available(
        UndoAction::ForcePush {
            remote: lease.remote.clone(),
            remote_ref: lease.remote_ref.clone(),
            pushed: pushed.to_owned(),
            previous: lease.expected_sha.clone(),
        },
        format!(
            "Undo force push: force-pushes {}/{branch} back to {} with a lease on {}, so it is refused if the remote moved since",
            lease.remote,
            short(&lease.expected_sha),
            short(pushed)
        ),
    )
}

pub fn plan_remote_branch_delete(remote: &str, name: &str, sha: Option<String>) -> Planned {
    let Some(sha) = sha else {
        return unavailable(format!(
            "The tip of {remote}/{name} was not known locally, so it cannot be restored"
        ));
    };
    available(
        UndoAction::RestoreRemoteBranch {
            remote: remote.to_owned(),
            remote_ref: format!("refs/heads/{name}"),
            sha: sha.clone(),
        },
        format!(
            "Undo delete remote branch: pushes {} back to {remote}/{name}, only if that name does not exist on the remote",
            short(&sha)
        ),
    )
}

fn upstream_label(upstream: &Option<String>) -> String {
    upstream
        .as_ref()
        .map_or_else(|| "no upstream".to_owned(), Clone::clone)
}

pub fn plan_upstream(branch: &str, before: &Option<String>, after: &Option<String>) -> Planned {
    if before == after {
        return unavailable("The upstream did not change");
    }
    available(
        UndoAction::RestoreUpstream {
            branch: branch.to_owned(),
            from: after.clone(),
            to: before.clone(),
        },
        format!(
            "Undo set upstream: {branch} goes back to {} if its upstream is still {}",
            upstream_label(before),
            upstream_label(after)
        ),
    )
}

pub fn plan_checkout(
    before: &Option<HeadRef>,
    after: &Option<HeadRef>,
    kept_stash: bool,
) -> Planned {
    if kept_stash {
        return unavailable("Your changes were kept in a stash; restore them before undoing");
    }
    match (before, after) {
        (Some(to), Some(from)) if to != from => available(
            UndoAction::SwitchBack {
                from: from.clone(),
                to: to.clone(),
            },
            format!("Undo checkout: switches back to {}", head_label(to)),
        ),
        _ => unavailable("The checkout did not change HEAD"),
    }
}

pub fn worktree_tree(root: &Path) -> Result<Option<String>, CoreError> {
    let created = git::run(root, &["stash", "create"])?;
    let commit = created.trim();
    if commit.is_empty() {
        return Ok(None);
    }
    let tree = git::run(root, &["rev-parse", &format!("{commit}^{{tree}}")])?;
    Ok(Some(tree.trim().to_owned()))
}

pub fn plan_stash_restore(
    path: &Path,
    sha: &str,
    pop: bool,
    before: &RepoState,
) -> Result<Planned, CoreError> {
    let root = repo::open(path)?;
    if !before.clean {
        return Ok(unavailable(
            "The working tree had changes before the restore, so the applied changes cannot be told apart",
        ));
    }
    let has_untracked = git::run_unchecked(
        &root,
        &["rev-parse", "--verify", "--quiet", &format!("{sha}^3")],
        None,
    )?
    .succeeded();
    if has_untracked {
        return Ok(unavailable(
            "This stash includes untracked files; undo would have to delete them",
        ));
    }
    let Some(applied_tree) = worktree_tree(&root)? else {
        return Ok(unavailable("The stash left no changes in the working tree"));
    };
    let subject = git::run(&root, &["log", "-1", "--format=%s", sha])?
        .trim()
        .to_owned();
    let verb = if pop { "pop" } else { "apply" };
    Ok(available(
        UndoAction::UnStash {
            sha: sha.to_owned(),
            subject,
            pop,
            applied_tree,
        },
        format!(
            "Undo {verb}: discards the applied changes if the working tree is unchanged since{}",
            if pop {
                " and restores the stash entry"
            } else {
                ""
            }
        ),
    ))
}

fn file_hash(root: &Path, file: &str, write: bool) -> Result<Option<String>, CoreError> {
    let full = root.join(file);
    match fs::symlink_metadata(&full) {
        Err(_) => Ok(None),
        Ok(metadata) if !metadata.is_file() => Err(CoreError::invalid_request(format!(
            "{file} is not a regular file"
        ))),
        Ok(_) => {
            let mut args = vec!["hash-object"];
            if write {
                args.push("-w");
            }
            args.extend(["--", file]);
            Ok(Some(git::run(root, &args)?.trim().to_owned()))
        }
    }
}

fn index_entry(root: &Path, file: &str) -> Result<Option<IndexEntry>, CoreError> {
    let output = git::run(root, &["ls-files", "--stage", "--full-name", "--", file])?;
    Ok(output.lines().find_map(|line| {
        let (meta, _) = line.split_once('\t')?;
        let mut parts = meta.split(' ');
        let (mode, oid, stage) = (parts.next()?, parts.next()?, parts.next()?);
        (stage == "0").then(|| IndexEntry {
            mode: mode.to_owned(),
            oid: oid.to_owned(),
        })
    }))
}

fn restore_index_entry(
    root: &Path,
    file: &str,
    entry: &Option<IndexEntry>,
) -> Result<(), CoreError> {
    match entry {
        Some(entry) => git::run(
            root,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("{},{},{file}", entry.mode, entry.oid),
            ],
        ),
        None => git::run(
            root,
            &stage::with_paths(
                &["rm", "--cached", "--quiet", "--ignore-unmatch"],
                &[file.to_owned()],
            ),
        ),
    }
    .map(drop)
}

fn is_executable(root: &Path, file: &str) -> bool {
    fs::metadata(root.join(file)).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

pub fn snapshot_files(path: &Path, files: &[String]) -> Result<Vec<SnapshotFile>, CoreError> {
    let root = repo::open(path)?;
    files
        .iter()
        .map(|file| {
            let entry = index_entry(&root, file)?;
            Ok(SnapshotFile {
                path: file.clone(),
                before: file_hash(&root, file, true)?,
                executable: is_executable(&root, file),
                after: None,
                index: IndexChange::Restore {
                    before: entry.clone(),
                    after: entry,
                },
            })
        })
        .collect()
}

fn plan_restore(
    path: &Path,
    mut files: Vec<SnapshotFile>,
    (verb, gerund): (&str, &str),
) -> Result<Planned, CoreError> {
    let root = repo::open(path)?;
    for file in &mut files {
        file.after = file_hash(&root, &file.path, false)?;
        if let IndexChange::Restore { before, .. } = &file.index {
            let now = index_entry(&root, &file.path)?;
            file.index = if *before == now {
                IndexChange::Unchanged
            } else {
                IndexChange::Restore {
                    before: before.clone(),
                    after: now,
                }
            };
        }
    }
    let count = files.len();
    Ok(available(
        UndoAction::RestoreFiles { files },
        format!(
            "Undo {verb}: restores {count} {} from the snapshot taken before {gerund}, if unchanged since",
            if count == 1 { "file" } else { "files" }
        ),
    ))
}

pub fn plan_discard(path: &Path, files: Vec<SnapshotFile>) -> Result<Planned, CoreError> {
    plan_restore(path, files, ("discard", "discarding"))
}

pub fn plan_revert_hunk(path: &Path, files: Vec<SnapshotFile>) -> Result<Planned, CoreError> {
    plan_restore(path, files, ("revert hunk", "reverting"))
}

pub fn plan_compose(before: &RepoState, after: &RepoState, commits: usize) -> Planned {
    let (Some(from), Some(to)) = (after.head.clone(), before.head.clone()) else {
        return unavailable("The first commit was composed; there is no earlier HEAD to return to");
    };
    if from == to {
        return unavailable("Compose did not move HEAD");
    }
    let scope = format!(
        "Undo compose: moves {} back to {} and keeps the changes of {} staged",
        where_label(&after.branch),
        short(&to),
        counted(commits, "commit", "commits")
    );
    available(
        UndoAction::ResetSoft {
            branch: after.branch.clone(),
            from,
            to,
        },
        scope,
    )
}

fn current_index_tree(root: &Path) -> Result<String, CoreError> {
    Ok(git::run(root, &["write-tree"])?.trim().to_owned())
}

fn redo_restore_files(root: &Path, files: &[SnapshotFile]) -> Result<Vec<SnapshotFile>, CoreError> {
    files
        .iter()
        .map(|file| {
            let index = match &file.index {
                IndexChange::Unchanged => IndexChange::Unchanged,
                IndexChange::Restore { before, .. } => IndexChange::Restore {
                    before: index_entry(root, &file.path)?,
                    after: before.clone(),
                },
            };
            Ok(SnapshotFile {
                path: file.path.clone(),
                before: file_hash(root, &file.path, true)?,
                executable: is_executable(root, &file.path),
                after: file.before.clone(),
                index,
            })
        })
        .collect()
}

pub fn plan_redo(path: &Path, action: &UndoAction) -> Result<UndoPlan, CoreError> {
    let root = repo::open(path)?;
    let (redo, scope) = match action {
        UndoAction::ResetHard { branch, from, to } => (
            UndoAction::ResetHard {
                branch: branch.clone(),
                from: to.clone(),
                to: from.clone(),
            },
            format!(
                "Redo: hard-resets {} to {}; needs a clean working tree",
                where_label(branch),
                short(from)
            ),
        ),
        UndoAction::ResetSoft { branch, from, to } => (
            UndoAction::AdvanceSoft {
                branch: branch.clone(),
                from: to.clone(),
                to: from.clone(),
                tree: current_index_tree(&root)?,
            },
            format!(
                "Redo: moves {} forward to {} with the same staged changes, if they are unchanged since",
                where_label(branch),
                short(from)
            ),
        ),
        UndoAction::DeleteBranch {
            name,
            sha,
            restore_head,
        } => (
            UndoAction::CreateBranchAt {
                name: name.clone(),
                sha: sha.clone(),
                switch: restore_head.is_some(),
            },
            format!(
                "Redo: recreates {name} at {}{}",
                short(sha),
                if restore_head.is_some() {
                    " and switches to it"
                } else {
                    ""
                }
            ),
        ),
        UndoAction::RecreateBranch { name, sha, .. } => (
            UndoAction::DeleteBranch {
                name: name.clone(),
                sha: sha.clone(),
                restore_head: None,
            },
            format!(
                "Redo: deletes {name} at {} if it has no new commits",
                short(sha)
            ),
        ),
        UndoAction::RecreateBranches { branches } => (
            UndoAction::DeleteBranches {
                branches: branches.clone(),
            },
            format!(
                "Redo: deletes {} if they have no new commits",
                counted(branches.len(), "branch", "branches")
            ),
        ),
        UndoAction::SwitchBack { from, to } => (
            UndoAction::SwitchBack {
                from: to.clone(),
                to: from.clone(),
            },
            format!("Redo: switches to {}", head_label(from)),
        ),
        UndoAction::UnStash {
            sha,
            pop,
            applied_tree,
            ..
        } => (
            UndoAction::Restash {
                sha: sha.clone(),
                pop: *pop,
                applied_tree: applied_tree.clone(),
            },
            format!(
                "Redo: {} the stash again, if the working tree is clean",
                if *pop { "pops" } else { "applies" }
            ),
        ),
        UndoAction::RestoreFiles { files } => {
            let swapped = redo_restore_files(&root, files)?;
            let count = swapped.len();
            (
                UndoAction::RestoreFiles { files: swapped },
                format!(
                    "Redo: puts {count} {} back as they were before the undo, if unchanged since",
                    if count == 1 { "file" } else { "files" }
                ),
            )
        }
        UndoAction::ForcePush {
            remote,
            remote_ref,
            pushed,
            previous,
        } => {
            let branch = remote_ref.strip_prefix("refs/heads/").unwrap_or(remote_ref);
            (
                UndoAction::ForcePush {
                    remote: remote.clone(),
                    remote_ref: remote_ref.clone(),
                    pushed: previous.clone(),
                    previous: pushed.clone(),
                },
                format!(
                    "Redo: force-pushes {remote}/{branch} to {} with a lease on {}, so it is refused if the remote moved since",
                    short(pushed),
                    short(previous)
                ),
            )
        }
        UndoAction::RestoreRemoteBranch {
            remote,
            remote_ref,
            sha,
        } => (
            UndoAction::DeleteRemoteBranchAt {
                remote: remote.clone(),
                remote_ref: remote_ref.clone(),
                sha: sha.clone(),
            },
            format!(
                "Redo: deletes {remote_ref} from {remote}, only if it still points at {}",
                short(sha)
            ),
        ),
        UndoAction::RestoreUpstream { branch, from, to } => (
            UndoAction::RestoreUpstream {
                branch: branch.clone(),
                from: to.clone(),
                to: from.clone(),
            },
            format!(
                "Redo: {branch} goes to {} if its upstream is still {}",
                upstream_label(from),
                upstream_label(to)
            ),
        ),
        UndoAction::GitFlowFinish(_) => {
            return Err(CoreError::invalid_request(
                "a Git Flow finish cannot be redone; finish the branch again instead",
            ))
        }
        UndoAction::AdvanceSoft { .. }
        | UndoAction::CreateBranchAt { .. }
        | UndoAction::DeleteBranches { .. }
        | UndoAction::Restash { .. }
        | UndoAction::DeleteRemoteBranchAt { .. } => {
            return Err(CoreError::invalid_request(
                "a redo step cannot itself be redone",
            ))
        }
    };
    Ok(UndoPlan {
        action: redo,
        scope,
    })
}

fn refuse(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_request(format!("{}. Nothing was changed", detail.into()))
}

fn require_settled(root: &Path) -> Result<(), CoreError> {
    if repo::read_operation(root)?.0.is_some() {
        return Err(refuse(
            "An operation is in progress; finish or abort it first",
        ));
    }
    Ok(())
}

fn require_head(root: &Path, branch: &Option<String>, sha: &str) -> Result<(), CoreError> {
    if head_sha(root)?.as_deref() != Some(sha) || &branch::current_branch(root)? != branch {
        return Err(refuse(
            "HEAD is no longer where the operation left it, so undoing would also move later work",
        ));
    }
    Ok(())
}

fn switch_to(root: &Path, head: &HeadRef) -> Result<(), CoreError> {
    match head {
        HeadRef::Branch(name) => git::run(root, &["switch", "--quiet", name]).map(drop),
        HeadRef::Detached(sha) => git::run(root, &["switch", "--quiet", "--detach", sha]).map(drop),
    }
}

fn recreate_branch(
    root: &Path,
    name: &str,
    sha: &str,
    upstream: Option<&str>,
) -> Result<(), CoreError> {
    git::run(root, &["branch", "--quiet", name, sha])?;
    if let Some(upstream) = upstream {
        let upstream_ref = format!("--set-upstream-to={upstream}");
        git::run_unchecked(root, &["branch", "--quiet", &upstream_ref, name], None)?;
    }
    Ok(())
}

fn counted(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

pub fn undo(path: &Path, action: &UndoAction) -> Result<String, CoreError> {
    undo_with(path, action, &CancelToken::new(), &mut |_| {})
}

pub fn undo_with(
    path: &Path,
    action: &UndoAction,
    cancel: &CancelToken,
    on_progress: &mut dyn FnMut(Progress),
) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    require_settled(&root)?;
    match action {
        UndoAction::ResetHard { branch, from, to } => {
            require_head(&root, branch, from)?;
            if tracked_changes(&root)? {
                return Err(CoreError::LocalChanges {
                    detail: "Undo needs a clean working tree; commit or stash your changes first."
                        .to_owned(),
                });
            }
            git::run(&root, &["reset", "--hard", "--quiet", to])?;
            Ok(format!(
                "Moved {} back to {}",
                where_label(branch),
                short(to)
            ))
        }
        UndoAction::ResetSoft { branch, from, to } => {
            require_head(&root, branch, from)?;
            git::run(&root, &["reset", "--soft", "--quiet", to])?;
            Ok(format!(
                "Moved {} back to {}",
                where_label(branch),
                short(to)
            ))
        }
        UndoAction::DeleteBranch {
            name,
            sha,
            restore_head,
        } => {
            let current = branch_snapshot(&root, name)?
                .ok_or_else(|| refuse(format!("{name} no longer exists")))?;
            if &current.sha != sha {
                return Err(refuse(format!("{name} has new commits")));
            }
            if let Some(head) = restore_head {
                if branch::current_branch(&root)?.as_deref() == Some(name.as_str()) {
                    switch_to(&root, head)?;
                }
            }
            git::run(&root, &["branch", "--delete", "--force", "--quiet", name])?;
            Ok(format!("Deleted branch {name}"))
        }
        UndoAction::RecreateBranch {
            name,
            sha,
            upstream,
        } => {
            if branch_snapshot(&root, name)?.is_some() {
                return Err(refuse(format!("{name} exists again")));
            }
            recreate_branch(&root, name, sha, upstream.as_deref())?;
            Ok(format!("Recreated branch {name} at {}", short(sha)))
        }
        UndoAction::RecreateBranches { branches } => {
            if let Some(existing) = branches
                .iter()
                .find(|restored| branch_snapshot(&root, &restored.name).is_ok_and(|b| b.is_some()))
            {
                return Err(refuse(format!("{} exists again", existing.name)));
            }
            for restored in branches {
                recreate_branch(
                    &root,
                    &restored.name,
                    &restored.sha,
                    restored.upstream.as_deref(),
                )?;
            }
            Ok(format!(
                "Recreated {}",
                counted(branches.len(), "branch", "branches")
            ))
        }
        UndoAction::SwitchBack { from, to } => {
            let here = match from {
                HeadRef::Branch(name) => branch::current_branch(&root)?.as_deref() == Some(name),
                HeadRef::Detached(sha) => {
                    branch::current_branch(&root)?.is_none()
                        && head_sha(&root)?.as_deref() == Some(sha)
                }
            };
            if !here {
                return Err(refuse("HEAD is no longer where the checkout left it"));
            }
            switch_to(&root, to)?;
            Ok(format!("Switched back to {}", head_label(to)))
        }
        UndoAction::UnStash {
            sha,
            subject,
            pop,
            applied_tree,
        } => {
            if worktree_tree(&root)?.as_ref() != Some(applied_tree) {
                return Err(refuse(
                    "The working tree changed after the stash was applied, so its changes cannot be told apart",
                ));
            }
            git::run(&root, &["reset", "--hard", "--quiet", "HEAD"])?;
            if *pop {
                git::run(&root, &["stash", "store", "-m", subject, sha])?;
            }
            Ok("Discarded the applied stash changes".to_owned())
        }
        UndoAction::ForcePush {
            remote,
            remote_ref,
            pushed,
            previous,
        } => {
            validate_sha(pushed)?;
            validate_sha(previous)?;
            if !refs::read_remotes(&root)?.contains(remote) {
                return Err(refuse(format!(
                    "{remote} is no longer a remote of this repository"
                )));
            }
            let with_lease = format!("--force-with-lease={remote_ref}:{pushed}");
            let refspec = format!("{previous}:{remote_ref}");
            match run_network(
                &root,
                &["push", "--progress", &with_lease, remote, &refspec],
                remote,
                cancel,
                on_progress,
            ) {
                Ok(()) => Ok(format!(
                    "Restored {remote_ref} on {remote} to {}",
                    short(previous)
                )),
                Err(CoreError::PushRejected { detail }) if detail.contains("stale info") => {
                    Err(refuse(format!(
                        "{remote_ref} on {remote} moved after the force push, so restoring it would discard later remote work"
                    )))
                }
                Err(error) => Err(error),
            }
        }
        UndoAction::RestoreRemoteBranch {
            remote,
            remote_ref,
            sha,
        } => {
            validate_sha(sha)?;
            if !refs::read_remotes(&root)?.contains(remote) {
                return Err(refuse(format!(
                    "{remote} is no longer a remote of this repository"
                )));
            }
            let with_lease = format!("--force-with-lease={remote_ref}:");
            let refspec = format!("{sha}:{remote_ref}");
            match run_network(
                &root,
                &["push", "--progress", &with_lease, remote, &refspec],
                remote,
                cancel,
                on_progress,
            ) {
                Ok(()) => Ok(format!(
                    "Restored {remote_ref} on {remote} at {}",
                    short(sha)
                )),
                Err(CoreError::PushRejected { detail }) if detail.contains("stale info") => {
                    Err(refuse(format!(
                        "{remote_ref} exists again on {remote}, so it was left alone"
                    )))
                }
                Err(error) => Err(error),
            }
        }
        UndoAction::RestoreUpstream { branch, from, to } => {
            let current = branch_snapshot(&root, branch)?
                .ok_or_else(|| refuse(format!("{branch} no longer exists")))?;
            if &current.upstream != from {
                return Err(refuse(format!("the upstream of {branch} changed since")));
            }
            crate::branch::set_upstream(&root, branch, to.as_deref())?;
            Ok(format!(
                "Set the upstream of {branch} back to {}",
                upstream_label(to)
            ))
        }
        UndoAction::GitFlowFinish(restore) => crate::git_flow::undo_finish(&root, restore),
        UndoAction::RestoreFiles { files } => {
            for file in files {
                if file_hash(&root, &file.path, false)? != file.after {
                    return Err(refuse(format!(
                        "{} changed after it was discarded",
                        file.path
                    )));
                }
                if let IndexChange::Restore { after, .. } = &file.index {
                    if index_entry(&root, &file.path)? != *after {
                        return Err(refuse(format!(
                            "{} was staged differently after it was discarded",
                            file.path
                        )));
                    }
                }
            }
            for file in files {
                let target = root.join(&file.path);
                match &file.before {
                    Some(blob) => {
                        let content = git::run_bytes(&root, &["cat-file", "blob", blob])?;
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent)
                                .map_err(|error| refuse(error.to_string()))?;
                        }
                        fs::write(&target, content).map_err(|error| refuse(error.to_string()))?;
                        let mode = if file.executable { 0o755 } else { 0o644 };
                        fs::set_permissions(&target, fs::Permissions::from_mode(mode))
                            .map_err(|error| refuse(error.to_string()))?;
                    }
                    None if target.exists() => {
                        fs::remove_file(&target).map_err(|error| refuse(error.to_string()))?;
                    }
                    None => {}
                }
                if let IndexChange::Restore { before, .. } = &file.index {
                    restore_index_entry(&root, &file.path, before)?;
                }
            }
            Ok(format!("Restored {} discarded file(s)", files.len()))
        }
        UndoAction::AdvanceSoft {
            branch,
            from,
            to,
            tree,
        } => {
            require_head(&root, branch, from)?;
            if &current_index_tree(&root)? != tree {
                return Err(refuse(
                    "The staged changes changed after the undo, so they would not come back as they were",
                ));
            }
            git::run(&root, &["reset", "--soft", "--quiet", to])?;
            Ok(format!(
                "Moved {} forward to {}",
                where_label(branch),
                short(to)
            ))
        }
        UndoAction::CreateBranchAt { name, sha, switch } => {
            if branch_snapshot(&root, name)?.is_some() {
                return Err(refuse(format!("{name} exists again")));
            }
            recreate_branch(&root, name, sha, None)?;
            if *switch {
                if let Err(error) = switch_to(&root, &HeadRef::Branch(name.clone())) {
                    git::run(&root, &["branch", "--delete", "--force", "--quiet", name])?;
                    return Err(error);
                }
            }
            Ok(format!("Recreated branch {name} at {}", short(sha)))
        }
        UndoAction::DeleteBranches { branches } => {
            for restored in branches {
                let current = branch_snapshot(&root, &restored.name)?
                    .ok_or_else(|| refuse(format!("{} no longer exists", restored.name)))?;
                if current.sha != restored.sha {
                    return Err(refuse(format!("{} has new commits", restored.name)));
                }
            }
            for restored in branches {
                git::run(
                    &root,
                    &["branch", "--delete", "--force", "--quiet", &restored.name],
                )?;
            }
            Ok(format!(
                "Deleted {}",
                counted(branches.len(), "branch", "branches")
            ))
        }
        UndoAction::Restash {
            sha,
            pop,
            applied_tree,
        } => {
            validate_sha(sha)?;
            if tracked_changes(&root)? {
                return Err(CoreError::LocalChanges {
                    detail: "Redo needs a clean working tree; commit or stash your changes first."
                        .to_owned(),
                });
            }
            let applied = git::run_unchecked(&root, &["stash", "apply", "--quiet", sha], None)?;
            if !applied.succeeded() || worktree_tree(&root)?.as_ref() != Some(applied_tree) {
                git::run(&root, &["reset", "--hard", "--quiet", "HEAD"])?;
                return Err(refuse(
                    "The stash no longer applies to the same result as before",
                ));
            }
            if *pop {
                let listed = git::run(&root, &["stash", "list", "--format=%H"])?;
                if let Some(index) = listed.lines().position(|entry| entry == sha) {
                    git::run(
                        &root,
                        &["stash", "drop", "--quiet", &format!("stash@{{{index}}}")],
                    )?;
                }
            }
            Ok("Applied the stash changes again".to_owned())
        }
        UndoAction::DeleteRemoteBranchAt {
            remote,
            remote_ref,
            sha,
        } => {
            validate_sha(sha)?;
            if !refs::read_remotes(&root)?.contains(remote) {
                return Err(refuse(format!(
                    "{remote} is no longer a remote of this repository"
                )));
            }
            let with_lease = format!("--force-with-lease={remote_ref}:{sha}");
            let refspec = format!(":{remote_ref}");
            match run_network(
                &root,
                &["push", "--progress", &with_lease, remote, &refspec],
                remote,
                cancel,
                on_progress,
            ) {
                Ok(()) => Ok(format!("Deleted {remote_ref} from {remote}")),
                Err(CoreError::PushRejected { detail }) if detail.contains("stale info") => {
                    Err(refuse(format!(
                        "{remote_ref} on {remote} moved since, so it was left alone"
                    )))
                }
                Err(error) => Err(error),
            }
        }
    }
}
