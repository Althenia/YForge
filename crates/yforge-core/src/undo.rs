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
pub struct SnapshotFile {
    pub path: String,
    pub before: Option<String>,
    pub executable: bool,
    pub after: Option<String>,
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

fn head_sha(root: &Path) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(root, &["rev-parse", "--verify", "--quiet", "HEAD"], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

fn tracked_changes(root: &Path) -> Result<bool, CoreError> {
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
        return unavailable("The reset discarded uncommitted changes, which cannot be restored");
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

fn is_executable(root: &Path, file: &str) -> bool {
    fs::metadata(root.join(file)).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

pub fn snapshot_files(path: &Path, files: &[String]) -> Result<Vec<SnapshotFile>, CoreError> {
    let root = repo::open(path)?;
    files
        .iter()
        .map(|file| {
            Ok(SnapshotFile {
                path: file.clone(),
                before: file_hash(&root, file, true)?,
                executable: is_executable(&root, file),
                after: None,
            })
        })
        .collect()
}

pub fn plan_discard(path: &Path, mut files: Vec<SnapshotFile>) -> Result<Planned, CoreError> {
    let root = repo::open(path)?;
    for file in &mut files {
        file.after = file_hash(&root, &file.path, false)?;
    }
    let count = files.len();
    Ok(available(
        UndoAction::RestoreFiles { files },
        format!(
            "Undo discard: restores {count} {} from the snapshot taken before discarding, if unchanged since",
            if count == 1 { "file" } else { "files" }
        ),
    ))
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
            git::run(&root, &["branch", "--quiet", name, sha])?;
            if let Some(upstream) = upstream {
                let upstream_ref = format!("--set-upstream-to={upstream}");
                git::run_unchecked(&root, &["branch", "--quiet", &upstream_ref, name], None)?;
            }
            Ok(format!("Recreated branch {name} at {}", short(sha)))
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
        UndoAction::RestoreFiles { files } => {
            for file in files {
                if file_hash(&root, &file.path, false)? != file.after {
                    return Err(refuse(format!(
                        "{} changed after it was discarded",
                        file.path
                    )));
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
            }
            Ok(format!("Restored {} discarded file(s)", files.len()))
        }
    }
}
