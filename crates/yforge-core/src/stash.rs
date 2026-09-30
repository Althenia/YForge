use std::path::Path;

use crate::commit::{commit_files, empty_tree};
use crate::diff;
use crate::error::CoreError;
use crate::git;
use crate::model::{CommitFile, FileDiff, StashDetails, StashFile, StashRestore};
use crate::refs;
use crate::repo;
use crate::snapshots::{self, Action};

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
    snapshots::capture(
        &root,
        Action::DropStash,
        &format!("Drop {reference}"),
        Some(sha),
    )?;
    git::run(&root, &["stash", "drop", "--quiet", &reference]).map(drop)
}

fn renamed_message(current: &str, message: &str) -> String {
    current
        .strip_prefix("On ")
        .or_else(|| current.strip_prefix("WIP on "))
        .and_then(|rest| rest.split_once(": "))
        .map_or_else(
            || message.to_owned(),
            |(branch, _)| format!("On {branch}: {message}"),
        )
}

pub fn stash_rename(path: &Path, index: u32, sha: &str, message: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let message = message.trim();
    if message.is_empty() {
        return Err(CoreError::invalid_request("enter a name for the stash"));
    }
    let reference = verified_ref(&root, index, sha)?;
    let current = refs::read_stashes(&root)?
        .into_iter()
        .find(|entry| entry.index == index)
        .map(|entry| entry.message)
        .unwrap_or_default();
    git::run(&root, &["stash", "drop", "--quiet", &reference])?;
    let renamed = renamed_message(&current, message);
    git::run(&root, &["stash", "store", "-m", &renamed, sha])
        .map(drop)
        .inspect_err(|_| {
            let _ = git::run(&root, &["stash", "store", "-m", &current, sha]);
        })
}

struct Located {
    base: String,
    target: String,
    file: CommitFile,
    untracked: bool,
}

fn stash_parents(root: &Path, sha: &str) -> Result<Vec<String>, CoreError> {
    Ok(git::run(root, &["rev-list", "--parents", "-n", "1", sha])?
        .split_whitespace()
        .skip(1)
        .map(str::to_owned)
        .collect())
}

fn located_files(root: &Path, sha: &str) -> Result<(Vec<String>, Vec<Located>), CoreError> {
    let parents = stash_parents(root, sha)?;
    let mut located = Vec::new();
    if let Some(base) = parents.first() {
        located.extend(
            commit_files(root, base, sha)?
                .into_iter()
                .map(|file| Located {
                    base: base.clone(),
                    target: sha.to_owned(),
                    file,
                    untracked: false,
                }),
        );
    }
    if let Some(untracked) = parents.get(2) {
        let empty = empty_tree(root)?;
        located.extend(
            commit_files(root, &empty, untracked)?
                .into_iter()
                .map(|file| Located {
                    base: empty.clone(),
                    target: untracked.clone(),
                    file,
                    untracked: true,
                }),
        );
    }
    Ok((parents, located))
}

pub fn stash_details(path: &Path, index: u32, sha: &str) -> Result<StashDetails, CoreError> {
    let root = repo::open(path)?;
    verified_ref(&root, index, sha)?;
    let message = refs::read_stashes(&root)?
        .into_iter()
        .find(|entry| entry.index == index)
        .map(|entry| entry.message)
        .unwrap_or_default();
    let (parents, located) = located_files(&root, sha)?;
    Ok(StashDetails {
        index,
        sha: sha.to_owned(),
        message,
        base_sha: parents.first().cloned(),
        untracked_sha: parents.get(2).cloned(),
        files: located
            .into_iter()
            .map(|entry| StashFile {
                path: entry.file.path,
                original_path: entry.file.original_path,
                status: entry.file.status,
                additions: entry.file.additions,
                deletions: entry.file.deletions,
                untracked: entry.untracked,
            })
            .collect(),
    })
}

pub fn stash_file_diff(
    path: &Path,
    index: u32,
    sha: &str,
    file: &str,
    ignore_whitespace: bool,
) -> Result<FileDiff, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    verified_ref(&root, index, sha)?;
    let (_, located) = located_files(&root, sha)?;
    let entry = located
        .into_iter()
        .find(|entry| entry.file.path == file)
        .ok_or_else(|| CoreError::invalid_request(format!("{file} is not part of this stash")))?;
    diff::diff_between(
        &root,
        &entry.base,
        &entry.target,
        file,
        entry.file.original_path.as_deref(),
        ignore_whitespace,
    )
}
