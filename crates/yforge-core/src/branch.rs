use std::path::Path;

use crate::commit::{parse_briefs, validate_sha, BRIEF_FORMAT};
use crate::error::CoreError;
use crate::git;
use crate::model::{AutoStash, CheckoutOutcome, CheckoutTarget, CommitBrief, StashRestore};
use crate::refs;
use crate::repo;
use crate::snapshots::{self, Action};
use crate::stash;
use crate::store;

const LOCAL_CHANGES_MARKERS: [&str; 4] = [
    "would be overwritten",
    "You have unstaged changes",
    "Your index contains uncommitted changes",
    "commit your changes or stash them",
];

pub(crate) fn classify_local_changes(error: CoreError) -> CoreError {
    match error {
        CoreError::GitFailed { stderr, .. }
            if LOCAL_CHANGES_MARKERS
                .iter()
                .any(|marker| stderr.contains(marker)) =>
        {
            CoreError::LocalChanges { detail: stderr }
        }
        other => other,
    }
}

pub(crate) fn ref_exists(root: &Path, full_name: &str) -> Result<bool, CoreError> {
    Ok(
        git::run_unchecked(root, &["show-ref", "--verify", "--quiet", full_name], None)?
            .succeeded(),
    )
}

pub(crate) fn validated_name(root: &Path, name: &str) -> Result<String, CoreError> {
    let invalid = || CoreError::invalid_request(format!("{name:?} is not a valid branch name"));
    if name.is_empty() {
        return Err(CoreError::invalid_request("enter a branch name"));
    }
    let completed = git::run_unchecked(root, &["check-ref-format", "--branch", name], None)?;
    if completed.succeeded() && completed.stdout.trim() == name {
        Ok(name.to_owned())
    } else {
        Err(invalid())
    }
}

pub(crate) fn require_local_branch(root: &Path, name: &str) -> Result<(), CoreError> {
    if ref_exists(root, &format!("refs/heads/{name}"))? {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "there is no local branch {name}"
        )))
    }
}

pub(crate) fn require_new_branch(root: &Path, name: &str) -> Result<(), CoreError> {
    if ref_exists(root, &format!("refs/heads/{name}"))? {
        Err(CoreError::invalid_request(format!(
            "a branch named {name} already exists"
        )))
    } else {
        Ok(())
    }
}

pub(crate) fn require_commit(root: &Path, sha: &str) -> Result<(), CoreError> {
    validate_sha(sha)?;
    require_revision(root, sha)
}

pub(crate) fn require_start_point(root: &Path, start: &str) -> Result<(), CoreError> {
    if start.starts_with("refs/") {
        require_revision(root, start)
    } else {
        require_commit(root, start)
    }
}

fn require_revision(root: &Path, sha: &str) -> Result<(), CoreError> {
    let spec = format!("{sha}^{{commit}}");
    if git::run_unchecked(root, &["rev-parse", "--verify", "--quiet", &spec], None)?.succeeded() {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "{sha} is not a commit in this repository"
        )))
    }
}

pub(crate) fn current_branch(root: &Path) -> Result<Option<String>, CoreError> {
    let completed =
        git::run_unchecked(root, &["symbolic-ref", "--quiet", "--short", "HEAD"], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

pub fn check_branch_name(path: &Path, name: &str) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    validated_name(&root, name)
}

struct Switch {
    args: Vec<String>,
    detached: bool,
    label: String,
}

fn plan_switch(root: &Path, target: &CheckoutTarget) -> Result<Switch, CoreError> {
    match target {
        CheckoutTarget::LocalBranch { name } => {
            validated_name(root, name)?;
            require_local_branch(root, name)?;
            Ok(Switch {
                args: vec!["switch".into(), name.clone()],
                detached: false,
                label: name.clone(),
            })
        }
        CheckoutTarget::RemoteBranch { name } => {
            let remotes = refs::read_remotes(root)?;
            let short = refs::split_remote(name, &remotes).ok_or_else(|| {
                CoreError::invalid_request(format!("{name} does not belong to a known remote"))
            })?;
            if !ref_exists(root, &format!("refs/remotes/{name}"))? {
                return Err(CoreError::invalid_request(format!(
                    "there is no remote branch {name}"
                )));
            }
            validated_name(root, short)?;
            require_new_branch(root, short)?;
            Ok(Switch {
                args: vec!["switch".into(), "--track".into(), name.clone()],
                detached: false,
                label: short.to_owned(),
            })
        }
        CheckoutTarget::Tag { name } => {
            let full = format!("refs/tags/{name}");
            if !ref_exists(root, &full)? {
                return Err(CoreError::invalid_request(format!(
                    "there is no tag {name}"
                )));
            }
            Ok(Switch {
                args: vec!["switch".into(), "--detach".into(), full],
                detached: true,
                label: name.clone(),
            })
        }
        CheckoutTarget::Commit { sha } => {
            require_commit(root, sha)?;
            Ok(Switch {
                args: vec!["switch".into(), "--detach".into(), sha.clone()],
                detached: true,
                label: sha.chars().take(7).collect(),
            })
        }
    }
}

fn run_switch(root: &Path, switch: &Switch) -> Result<(), CoreError> {
    let args: Vec<&str> = switch.args.iter().map(String::as_str).collect();
    git::run(root, &args)
        .map(drop)
        .map_err(classify_local_changes)
}

#[derive(Clone, Copy)]
enum Stashing<'a> {
    Off,
    Carry,
    Leave(&'a Path),
}

fn restore_after_failed_switch(root: &Path, failure: CoreError) -> CoreError {
    match stash::restore(root, &["stash", "pop", "--quiet"]) {
        Ok(StashRestore::Applied) => failure,
        _ => CoreError::invalid_request(format!(
            "{failure}; your stashed changes could not be restored and remain in stash@{{0}}"
        )),
    }
}

fn switch_branch(
    path: &Path,
    target: &CheckoutTarget,
    stashing: Stashing<'_>,
) -> Result<CheckoutOutcome, CoreError> {
    let root = repo::open(path)?;
    let switch = plan_switch(&root, target)?;
    let dirty = repo::read_status(&root)?.counts.total() > 0;
    if matches!(stashing, Stashing::Off) {
        if switch.detached && dirty {
            return Err(CoreError::LocalChanges {
                detail: "The working tree has uncommitted changes.".to_owned(),
            });
        }
        run_switch(&root, &switch)?;
        return Ok(CheckoutOutcome {
            auto_stash: AutoStash::None,
        });
    }
    let left = current_branch(&root)?;
    if dirty && matches!(stashing, Stashing::Leave(_)) && left.is_none() {
        return Err(CoreError::invalid_request(
            "leaving changes stashed needs a checked-out branch to return to; carry the changes instead",
        ));
    }
    if dirty {
        snapshots::capture(
            &root,
            Action::Checkout,
            &format!("Auto-stash before switching to {}", switch.label),
            None,
        )?;
    }
    let message = format!("YForge: auto-stash before switching to {}", switch.label);
    if !dirty || !stash::push_auto(&root, &message, true)? {
        run_switch(&root, &switch)?;
        return Ok(CheckoutOutcome {
            auto_stash: AutoStash::None,
        });
    }
    if let (Stashing::Leave(dir), Some(left)) = (stashing, &left) {
        let entry = refs::read_stashes(&root)?
            .into_iter()
            .next()
            .ok_or_else(|| {
                CoreError::invalid_request("the stash that was just saved is missing")
            })?;
        if let Err(failure) =
            store::record_switch_stash(dir, &root, left, &entry.sha, &entry.message)
        {
            return Err(restore_after_failed_switch(&root, failure));
        }
        if let Err(failure) = run_switch(&root, &switch) {
            store::dismiss_switch_stash(dir, &root, left, &entry.sha)?;
            return Err(restore_after_failed_switch(&root, failure));
        }
        return Ok(CheckoutOutcome {
            auto_stash: AutoStash::Stashed,
        });
    }
    if let Err(failure) = run_switch(&root, &switch) {
        return Err(restore_after_failed_switch(&root, failure));
    }
    let auto_stash = match stash::restore(&root, &["stash", "pop", "--quiet"]) {
        Ok(StashRestore::Applied) => AutoStash::Restored,
        Ok(StashRestore::Conflicts) => AutoStash::Conflicts,
        Err(_) => AutoStash::Kept,
    };
    Ok(CheckoutOutcome { auto_stash })
}

pub fn checkout(
    path: &Path,
    target: &CheckoutTarget,
    stash_changes: bool,
) -> Result<CheckoutOutcome, CoreError> {
    let stashing = if stash_changes {
        Stashing::Carry
    } else {
        Stashing::Off
    };
    switch_branch(path, target, stashing)
}

pub fn checkout_leaving_stash(
    path: &Path,
    target: &CheckoutTarget,
    data_dir: &Path,
) -> Result<CheckoutOutcome, CoreError> {
    switch_branch(path, target, Stashing::Leave(data_dir))
}

pub fn create_branch(
    path: &Path,
    name: &str,
    at: Option<&str>,
    check_out: bool,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    validated_name(&root, name)?;
    require_new_branch(&root, name)?;
    if let Some(start) = at {
        require_start_point(&root, start)?;
    }
    let mut args = if check_out {
        vec!["switch", "--create", name]
    } else {
        vec!["branch", name]
    };
    args.extend(at);
    git::run(&root, &args)
        .map(drop)
        .map_err(classify_local_changes)
}

pub fn rename_branch(path: &Path, from: &str, to: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_local_branch(&root, from)?;
    validated_name(&root, to)?;
    require_new_branch(&root, to)?;
    git::run(&root, &["branch", "--move", from, to]).map(drop)
}

fn lost_commits(root: &Path, name: &str) -> Result<Vec<CommitBrief>, CoreError> {
    let branch = format!("refs/heads/{name}");
    let exclude = format!("--exclude={name}");
    let output = git::run(
        root,
        &[
            "log",
            "--no-show-signature",
            BRIEF_FORMAT,
            &branch,
            "--not",
            &exclude,
            "--branches",
            "--remotes",
            "--tags",
        ],
    )?;
    parse_briefs(&output)
}

pub fn branch_delete_preview(path: &Path, name: &str) -> Result<Vec<CommitBrief>, CoreError> {
    let root = repo::open(path)?;
    require_local_branch(&root, name)?;
    lost_commits(&root, name)
}

pub fn delete_branch(path: &Path, name: &str, force: bool) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_local_branch(&root, name)?;
    if current_branch(&root)?.as_deref() == Some(name) {
        return Err(CoreError::invalid_request(format!(
            "{name} is checked out; switch to another branch before deleting it"
        )));
    }
    if !force {
        let lost = lost_commits(&root, name)?;
        if !lost.is_empty() {
            return Err(CoreError::UnmergedBranch {
                branch: name.to_owned(),
                commits: u32::try_from(lost.len()).unwrap_or(u32::MAX),
            });
        }
    }
    let tip = git::run(&root, &["rev-parse", &format!("refs/heads/{name}")])?;
    snapshots::capture(
        &root,
        Action::DeleteBranch,
        &format!("Delete branch {name}"),
        Some(tip.trim()),
    )?;
    git::run(&root, &["branch", "--delete", "--force", name]).map(drop)
}

pub fn set_upstream(path: &Path, branch: &str, upstream: Option<&str>) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_local_branch(&root, branch)?;
    match upstream {
        None => git::run(&root, &["branch", "--unset-upstream", branch]).map(drop),
        Some(name) => {
            let exists = ref_exists(&root, &format!("refs/remotes/{name}"))?
                || ref_exists(&root, &format!("refs/heads/{name}"))?;
            if !exists {
                return Err(CoreError::invalid_request(format!(
                    "there is no branch {name} to track"
                )));
            }
            let target = format!("--set-upstream-to={name}");
            git::run(&root, &["branch", &target, branch]).map(drop)
        }
    }
}
