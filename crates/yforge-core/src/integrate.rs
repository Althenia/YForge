use std::path::Path;

use crate::branch::{self, ref_exists};
use crate::commit::{parse_briefs, validate_sha, BRIEF_FORMAT};
use crate::error::CoreError;
use crate::git;
use crate::model::{IntegrationPreview, MergeMode, OperationOutcome, ResetMode, RevisionRange};
use crate::operation::{require_no_operation, settle};
use crate::repo;
use crate::snapshots::{self, Action};

const PREVIEW_LIMIT: &str = "--max-count=20";

fn branch_ref(root: &Path, name: &str) -> Result<String, CoreError> {
    for prefix in ["refs/heads/", "refs/remotes/"] {
        let full = format!("{prefix}{name}");
        if ref_exists(root, &full)? {
            return Ok(full);
        }
    }
    Err(CoreError::invalid_request(format!(
        "there is no branch {name}"
    )))
}

fn revision(root: &Path, name: &str) -> Result<String, CoreError> {
    if name == "HEAD" {
        return Ok(name.to_owned());
    }
    if let Ok(full) = branch_ref(root, name) {
        return Ok(full);
    }
    branch::require_start_point(root, name)?;
    Ok(name.to_owned())
}

fn range(root: &Path, spec: &str) -> Result<RevisionRange, CoreError> {
    let count = git::run(root, &["rev-list", "--count", spec])?;
    let listing = git::run(
        root,
        &[
            "log",
            "--no-show-signature",
            PREVIEW_LIMIT,
            BRIEF_FORMAT,
            spec,
        ],
    )?;
    Ok(RevisionRange {
        count: count.trim().parse().map_err(|_| {
            CoreError::invalid_output("git rev-list --count", format!("not a number: {count:?}"))
        })?,
        commits: parse_briefs(&listing)?,
    })
}

pub fn integration_preview(
    path: &Path,
    base: Option<&str>,
    other: &str,
) -> Result<IntegrationPreview, CoreError> {
    let root = repo::open(path)?;
    let base = revision(&root, base.unwrap_or("HEAD"))?;
    let other = revision(&root, other)?;
    let incoming = range(&root, &format!("{base}..{other}"))?;
    let outgoing = range(&root, &format!("{other}..{base}"))?;
    let fast_forward = incoming.count > 0 && outgoing.count == 0;
    Ok(IntegrationPreview {
        incoming,
        outgoing,
        fast_forward,
    })
}

fn not_fast_forward(detail: impl Into<String>) -> CoreError {
    CoreError::NotFastForward {
        detail: detail.into(),
    }
}

fn merge_operand(root: &Path, source: &str) -> Result<String, CoreError> {
    let full = branch_ref(root, source)?;
    if ref_exists(root, &format!("refs/tags/{source}"))? {
        Ok(full)
    } else {
        Ok(source.to_owned())
    }
}

pub fn merge(path: &Path, source: &str, mode: MergeMode) -> Result<OperationOutcome, CoreError> {
    let root = repo::open(path)?;
    require_no_operation(&root)?;
    let reference = merge_operand(&root, source)?;
    let args = match mode {
        MergeMode::FastForward => ["merge", "--ff-only", &reference],
        MergeMode::MergeCommit => ["merge", "--no-ff", &reference],
    };
    let completed = git::run_unchecked(&root, &args, None)?;
    if !completed.succeeded() && completed.stderr.contains("Not possible to fast-forward") {
        return Err(not_fast_forward(completed.stderr.trim()));
    }
    settle(&root, &args, completed)
}

pub fn rebase(path: &Path, onto: &str) -> Result<OperationOutcome, CoreError> {
    let root = repo::open(path)?;
    require_no_operation(&root)?;
    let reference = branch_ref(&root, onto)?;
    let args = ["rebase", &reference];
    let completed = git::run_unchecked(&root, &args, None)?;
    settle(&root, &args, completed)
}

pub fn fast_forward(path: &Path, branch: &str, target: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_no_operation(&root)?;
    branch::require_local_branch(&root, branch)?;
    let local = format!("refs/heads/{branch}");
    let reference = branch_ref(&root, target)?;
    let sha = git::run(&root, &["rev-parse", &format!("{reference}^{{commit}}")])?;
    let sha = sha.trim();
    if git::run(&root, &["rev-parse", &local])?.trim() == sha {
        return Err(CoreError::invalid_request(format!(
            "{branch} is already at {target}"
        )));
    }
    let ancestor = git::run_unchecked(&root, &["merge-base", "--is-ancestor", &local, sha], None)?;
    if !ancestor.succeeded() {
        return Err(not_fast_forward(format!(
            "{branch} has commits that {target} does not contain"
        )));
    }
    if branch::current_branch(&root)?.as_deref() == Some(branch) {
        git::run(&root, &["merge", "--ff-only", sha])
            .map(drop)
            .map_err(branch::classify_local_changes)
    } else {
        git::run(&root, &["branch", "--force", branch, sha]).map(drop)
    }
}

fn apply_commit(path: &Path, command: &str, sha: &str) -> Result<OperationOutcome, CoreError> {
    let root = repo::open(path)?;
    validate_sha(sha)?;
    require_no_operation(&root)?;
    branch::require_commit(&root, sha)?;
    let parents = git::run(&root, &["rev-list", "--parents", "--max-count=1", sha])?;
    if parents.split_whitespace().count() > 2 {
        return Err(CoreError::invalid_request(format!(
            "{} is a merge commit; choosing which parent to follow is not supported",
            sha.chars().take(7).collect::<String>()
        )));
    }
    let args: Vec<&str> = match command {
        "revert" => vec!["revert", "--no-edit", sha],
        _ => vec![command, sha],
    };
    let completed = git::run_unchecked(&root, &args, None)?;
    if !completed.succeeded()
        && repo::read_operation(&root)?.0.is_some()
        && repo::read_status(&root)?.counts.conflicted == 0
    {
        git::run(&root, &[command, "--abort"])?;
        return Err(CoreError::invalid_request(format!(
            "{} would change nothing on this branch",
            sha.chars().take(7).collect::<String>()
        )));
    }
    settle(&root, &args, completed)
}

pub fn cherry_pick(path: &Path, sha: &str) -> Result<OperationOutcome, CoreError> {
    apply_commit(path, "cherry-pick", sha)
}

pub fn revert(path: &Path, sha: &str) -> Result<OperationOutcome, CoreError> {
    apply_commit(path, "revert", sha)
}

pub fn reset(path: &Path, target: &str, mode: ResetMode) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_no_operation(&root)?;
    let target = revision(&root, target)?;
    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    if mode == ResetMode::Hard {
        snapshots::capture(
            &root,
            Action::ResetHard,
            &format!("Reset --hard to {target}"),
            None,
        )?;
    }
    git::run(&root, &["reset", "--quiet", flag, &target]).map(drop)
}
