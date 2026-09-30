use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::model::StashRestore;
use crate::repo;

fn stash_ref(index: u32) -> String {
    format!("stash@{{{index}}}")
}

pub(crate) fn top_stash(root: &Path) -> Result<Option<String>, CoreError> {
    let completed = git::run_unchecked(
        root,
        &["rev-parse", "--verify", "--quiet", "refs/stash"],
        None,
    )?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().to_owned()))
}

pub(crate) fn push_auto(
    root: &Path,
    message: &str,
    include_untracked: bool,
) -> Result<bool, CoreError> {
    let before = top_stash(root)?;
    let mut args = vec!["stash", "push", "--quiet"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.is_empty() {
        args.extend(["-m", message]);
    }
    git::run(root, &args)?;
    Ok(top_stash(root)? != before)
}

pub(crate) fn restore(root: &Path, args: &[&str]) -> Result<StashRestore, CoreError> {
    let completed = git::run_unchecked(root, args, None)?;
    if completed.succeeded() {
        return Ok(StashRestore::Applied);
    }
    if repo::read_status(root)?.counts.conflicted > 0 {
        return Ok(StashRestore::Conflicts);
    }
    Err(CoreError::GitFailed {
        command: format!("git {}", args.join(" ")),
        status: completed.status,
        stderr: completed.stderr.trim().to_owned(),
    })
}

fn verified_ref(root: &Path, index: u32, sha: &str) -> Result<String, CoreError> {
    let reference = stash_ref(index);
    let completed = git::run_unchecked(
        root,
        &["rev-parse", "--verify", "--quiet", &reference],
        None,
    )?;
    if completed.succeeded() && completed.stdout.trim() == sha {
        Ok(reference)
    } else {
        Err(CoreError::invalid_request(format!(
            "{reference} changed since it was listed; refresh and try again"
        )))
    }
}

pub fn stash_push(path: &Path, message: &str, include_untracked: bool) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    if !push_auto(&root, message.trim(), include_untracked)? {
        return Err(CoreError::invalid_request(
            "there are no local changes to stash",
        ));
    }
    Ok(())
}

pub fn stash_apply(path: &Path, index: u32, sha: &str) -> Result<StashRestore, CoreError> {
    let root = repo::open(path)?;
    let reference = verified_ref(&root, index, sha)?;
    restore(&root, &["stash", "apply", "--quiet", &reference])
}

pub fn stash_pop(path: &Path, index: u32, sha: &str) -> Result<StashRestore, CoreError> {
    let root = repo::open(path)?;
    let reference = verified_ref(&root, index, sha)?;
    restore(&root, &["stash", "pop", "--quiet", &reference])
}

pub fn stash_drop(path: &Path, index: u32, sha: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let reference = verified_ref(&root, index, sha)?;
    git::run(&root, &["stash", "drop", "--quiet", &reference]).map(drop)
}
