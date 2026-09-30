use std::path::Path;

use crate::branch::{self, classify_local_changes};
use crate::error::CoreError;
use crate::git;
use crate::model::{OperationOutcome, Worktree, WorktreeIntegration, WorktreeStatus};
use crate::operation::{require_settled, settle};
use crate::repo;
use crate::snapshots::{self, Action};

fn is_dirty(dir: &Path) -> Result<bool, CoreError> {
    Ok(
        !git::run(dir, &["status", "--porcelain", "--untracked-files=all"])?
            .trim()
            .is_empty(),
    )
}

fn find<'a>(worktrees: &'a [Worktree], path: &str) -> Result<&'a Worktree, CoreError> {
    worktrees
        .iter()
        .find(|worktree| repo::same_path(Path::new(&worktree.path), Path::new(path)))
        .ok_or_else(|| {
            CoreError::invalid_request(format!("{path} is not a worktree of this repository"))
        })
}

pub fn list_worktrees(path: &Path) -> Result<Vec<WorktreeStatus>, CoreError> {
    let root = repo::open(path)?;
    repo::read_worktrees(&root)?
        .into_iter()
        .map(|worktree| {
            let present =
                !worktree.bare && !worktree.prunable && Path::new(&worktree.path).is_dir();
            let dirty = present && is_dirty(Path::new(&worktree.path))?;
            Ok(WorktreeStatus {
                path: worktree.path,
                head: worktree.head,
                branch: worktree.branch,
                bare: worktree.bare,
                locked: worktree.locked,
                prunable: worktree.prunable,
                current: worktree.current,
                dirty,
            })
        })
        .collect()
}

pub fn suggest_worktree_path(path: &Path, branch: &str) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(CoreError::invalid_request("enter a branch name"));
    }
    let worktrees = repo::read_worktrees(&root)?;
    let main = worktrees
        .first()
        .map(|worktree| Path::new(&worktree.path))
        .ok_or_else(|| CoreError::invalid_request("this repository has no worktrees"))?;
    let name = main
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let parent = main.parent().unwrap_or(main);
    Ok(parent
        .join(format!("{name}-{}", branch.replace('/', "-")))
        .display()
        .to_string())
}

fn require_free_destination(destination: &Path) -> Result<(), CoreError> {
    if !destination.is_absolute() {
        return Err(CoreError::invalid_request(
            "the worktree location must be a full path",
        ));
    }
    if destination.exists() {
        let empty = destination
            .read_dir()
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty {
            return Err(CoreError::invalid_request(format!(
                "{} already exists and is not an empty folder",
                destination.display()
            )));
        }
    }
    Ok(())
}

pub fn create_worktree(
    path: &Path,
    branch: &str,
    create: bool,
    start: Option<&str>,
    destination: &Path,
) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    branch::validated_name(&root, branch)?;
    require_free_destination(destination)?;
    let location = destination.display().to_string();
    let mut args = vec!["worktree", "add"];
    if create {
        branch::require_new_branch(&root, branch)?;
        if let Some(start) = start {
            branch::require_start_point(&root, start)?;
        }
        args.extend(["-b", branch, &location]);
        args.extend(start);
    } else {
        branch::require_local_branch(&root, branch)?;
        if let Some(holder) = repo::read_worktrees(&root)?
            .iter()
            .find(|worktree| worktree.branch.as_deref() == Some(branch))
        {
            return Err(CoreError::invalid_request(format!(
                "{branch} is already checked out at {}",
                holder.path
            )));
        }
        args.extend([&location, branch]);
    }
    git::run(&root, &args)?;
    Ok(location)
}

pub fn remove_worktree(path: &Path, worktree: &str, force: bool) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let worktrees = repo::read_worktrees(&root)?;
    let target = find(&worktrees, worktree)?;
    if target.current {
        return Err(CoreError::invalid_request(
            "this worktree is open here; switch to another worktree to remove it",
        ));
    }
    if worktrees
        .first()
        .is_some_and(|main| main.path == target.path)
    {
        return Err(CoreError::invalid_request(
            "the main worktree cannot be removed",
        ));
    }
    if target.locked {
        return Err(CoreError::invalid_request(format!(
            "{} is locked; unlock it first",
            target.path
        )));
    }
    let present = !target.prunable && Path::new(&target.path).is_dir();
    if present && !force && is_dirty(Path::new(&target.path))? {
        return Err(CoreError::WorktreeDirty {
            path: target.path.clone(),
        });
    }
    if present && force {
        let location = repo::resolve_root(Path::new(&target.path))?;
        snapshots::capture(
            &location,
            Action::RemoveWorktree,
            &format!("Remove worktree {}", target.path),
            None,
        )?;
    }
    let mut args = vec!["worktree", "remove"];
    if force || !present {
        args.push("--force");
    }
    args.push(&target.path);
    git::run(&root, &args).map(drop)
}

pub fn integrate_worktree(
    path: &Path,
    worktree: &str,
    target: &str,
    cleanup: bool,
) -> Result<WorktreeIntegration, CoreError> {
    let root = repo::open(path)?;
    let worktrees = repo::read_worktrees(&root)?;
    let source = find(&worktrees, worktree)?;
    require_settled(Path::new(&source.path))?;
    let branch = source.branch.clone().ok_or_else(|| {
        CoreError::invalid_request("the worktree has no branch checked out; check one out first")
    })?;
    if branch == target {
        return Err(CoreError::invalid_request(
            "a branch cannot be integrated into itself",
        ));
    }
    branch::require_local_branch(&root, target)?;
    let destination = worktrees
        .iter()
        .find(|candidate| candidate.branch.as_deref() == Some(target))
        .ok_or_else(|| {
            CoreError::invalid_request(format!(
                "{target} is not checked out in any worktree; check it out first"
            ))
        })?;
    let (source_dir, target_dir) = (Path::new(&source.path), Path::new(&destination.path));
    require_settled(target_dir)?;
    if is_dirty(source_dir)? {
        return Err(CoreError::WorktreeDirty {
            path: source.path.clone(),
        });
    }
    let onto = format!("refs/heads/{target}");
    let rebase = ["rebase", &onto];
    let completed = git::run_unchecked(source_dir, &rebase, None)?;
    if settle(source_dir, &rebase, completed)? == OperationOutcome::Conflicts {
        return Ok(WorktreeIntegration::Conflicts {
            worktree: source.path.clone(),
        });
    }
    let tip = format!("refs/heads/{branch}");
    let merge = ["merge", "--ff-only", &tip];
    let completed = git::run_unchecked(target_dir, &merge, None)?;
    if !completed.succeeded() && completed.stderr.contains("Not possible to fast-forward") {
        return Err(CoreError::NotFastForward {
            detail: completed.stderr.trim().to_owned(),
        });
    }
    if !completed.succeeded() {
        return Err(classify_local_changes(CoreError::GitFailed {
            command: format!("git {}", merge.join(" ")),
            status: completed.status,
            stderr: format!("{}{}", completed.stdout, completed.stderr)
                .trim()
                .to_owned(),
        }));
    }
    if cleanup {
        git::run(target_dir, &["worktree", "remove", &source.path])?;
        git::run(target_dir, &["branch", "--delete", "--force", &branch])?;
    }
    Ok(WorktreeIntegration::Integrated {
        target_sha: git::run(target_dir, &["rev-parse", "HEAD"])?
            .trim()
            .to_owned(),
        cleaned_up: cleanup,
    })
}
