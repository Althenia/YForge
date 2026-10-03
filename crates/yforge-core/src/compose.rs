use std::collections::HashSet;
use std::path::Path;

use crate::activity;
use crate::ai::ComposeGroup;
use crate::error::CoreError;
use crate::git;
use crate::model::{ChangeArea, FileChange};
use crate::operation;
use crate::repo;
use crate::stage::with_paths;
use crate::undo::head_sha;

fn validate(groups: &[ComposeGroup], changes: &[FileChange]) -> Result<(), CoreError> {
    if groups.is_empty() {
        return Err(CoreError::invalid_request(
            "choose at least one group to commit",
        ));
    }
    let mut seen = HashSet::new();
    for (position, group) in groups.iter().enumerate() {
        let number = position + 1;
        if group.message.trim().is_empty() {
            return Err(CoreError::invalid_request(format!(
                "group {number} has a blank message"
            )));
        }
        if group.files.is_empty() {
            return Err(CoreError::invalid_request(format!(
                "group {number} has no files"
            )));
        }
        repo::check_paths(&group.files)?;
        for file in &group.files {
            if !seen.insert(file.as_str()) {
                return Err(CoreError::invalid_request(format!(
                    "{file} is in more than one group"
                )));
            }
            if !changes.iter().any(|change| &change.path == file) {
                return Err(CoreError::invalid_request(format!(
                    "{file} has no uncommitted change"
                )));
            }
        }
    }
    Ok(())
}

fn commit_group(
    root: &Path,
    group: &ComposeGroup,
    changes: &[FileChange],
) -> Result<String, CoreError> {
    let mut paths: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    for file in &group.files {
        for change in changes.iter().filter(|change| &change.path == file) {
            if change.area == ChangeArea::Untracked {
                untracked.push(file.clone());
            }
            if let Some(original) = &change.original_path {
                if !paths.contains(original) {
                    paths.push(original.clone());
                }
            }
        }
        paths.push(file.clone());
    }
    if !untracked.is_empty() {
        git::run(root, &with_paths(&["add"], &untracked))?;
    }
    let message = group.message.trim();
    let args = with_paths(&["commit", "--quiet", "--only", "-m", message], &paths);
    let completed = git::run_unchecked(root, &args, None)?;
    if !completed.succeeded() {
        return Err(CoreError::CommitFailed {
            status: completed.status,
            output: [completed.stdout.trim(), completed.stderr.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
        });
    }
    Ok(git::run(root, &["rev-parse", "HEAD"])?.trim().to_owned())
}

fn roll_back(root: &Path, head: Option<&str>, index_tree: &str) -> Result<(), CoreError> {
    match head {
        Some(head) => git::run(root, &["reset", "--soft", "--quiet", head])?,
        None => git::run(root, &["update-ref", "-d", "HEAD"])?,
    };
    git::run(root, &["read-tree", index_tree]).map(drop)
}

/// Creates one commit per group, in order, each holding exactly the current working-tree
/// content of its files; every other change and its staged state stay as they were.
pub fn compose_apply(path: &Path, groups: &[ComposeGroup]) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    operation::require_settled(&root)?;
    let changes = repo::read_status(&root)?.files;
    validate(groups, &changes)?;
    let head = head_sha(&root)?;
    let index_tree = activity::quietly(|| git::run(&root, &["write-tree"]))?
        .trim()
        .to_owned();
    let mut created = Vec::with_capacity(groups.len());
    for group in groups {
        match commit_group(&root, group, &changes) {
            Ok(sha) => created.push(sha),
            Err(error) => {
                roll_back(&root, head.as_deref(), &index_tree)?;
                return Err(error);
            }
        }
    }
    Ok(created)
}
