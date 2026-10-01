use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::branch;
use crate::error::CoreError;
use crate::stash;
use crate::tag;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct BatchFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct BatchOutcome {
    pub done: Vec<String>,
    pub failed: Vec<BatchFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct StashTarget {
    pub index: u32,
    pub sha: String,
}

fn run_batch<T>(
    items: &[T],
    name: impl Fn(&T) -> String,
    mut run: impl FnMut(&T) -> Result<(), CoreError>,
) -> Result<BatchOutcome, CoreError> {
    if items.is_empty() {
        return Err(CoreError::invalid_request("nothing was selected"));
    }
    let mut done = Vec::new();
    let mut failed = Vec::new();
    let mut first_error = None;
    for item in items {
        match run(item) {
            Ok(()) => done.push(name(item)),
            Err(error) => {
                failed.push(BatchFailure {
                    name: name(item),
                    reason: error.to_string(),
                });
                first_error.get_or_insert(error);
            }
        }
    }
    match first_error {
        Some(error) if done.is_empty() => Err(error),
        _ => Ok(BatchOutcome { done, failed }),
    }
}

pub fn delete_branches(
    path: &Path,
    names: &[String],
    forced: &[String],
) -> Result<BatchOutcome, CoreError> {
    run_batch(names, Clone::clone, |name| {
        branch::delete_branch(path, name, forced.contains(name))
    })
}

pub fn delete_tags(path: &Path, names: &[String]) -> Result<BatchOutcome, CoreError> {
    run_batch(names, Clone::clone, |name| tag::delete_tag(path, name))
}

pub fn drop_stashes(path: &Path, targets: &[StashTarget]) -> Result<BatchOutcome, CoreError> {
    let mut highest_first = targets.to_vec();
    highest_first.sort_by_key(|target| std::cmp::Reverse(target.index));
    run_batch(
        &highest_first,
        |target| format!("stash@{{{}}}", target.index),
        |target| stash::stash_drop(path, target.index, &target.sha),
    )
}
