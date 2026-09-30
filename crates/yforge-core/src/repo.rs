use std::path::{Component, Path, PathBuf};

use crate::error::CoreError;
use crate::git;
use crate::model::{Operation, RefKind, RepoSnapshot, Worktree};
use crate::operation;
use crate::refs;
use crate::snapshots;
use crate::status::{self, ParsedStatus};

const WORKTREE_COMMAND: &str = "git worktree list";

pub(crate) fn resolve_root(path: &Path) -> Result<PathBuf, CoreError> {
    let not_a_repository = || CoreError::NotARepository {
        path: path.display().to_string(),
    };
    if !path.is_dir() {
        return Err(not_a_repository());
    }
    match git::run(path, &["rev-parse", "--show-toplevel"]) {
        Ok(output) => Ok(PathBuf::from(output.trim_end_matches('\n'))),
        Err(CoreError::GitFailed { stderr, .. })
            if stderr.contains("not a git repository")
                || stderr.contains("this operation must be run in a work tree") =>
        {
            Err(not_a_repository())
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn open(path: &Path) -> Result<PathBuf, CoreError> {
    git::ensure_supported()?;
    resolve_root(path)
}

pub(crate) fn check_paths<S: AsRef<str>>(files: &[S]) -> Result<(), CoreError> {
    if files.is_empty() {
        return Err(CoreError::invalid_request("no files were given"));
    }
    for file in files {
        let file = file.as_ref();
        let escapes = Path::new(file).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        });
        if file.is_empty() || escapes {
            return Err(CoreError::invalid_request(format!(
                "{file:?} is not a path inside the repository"
            )));
        }
    }
    Ok(())
}

pub(crate) fn read_status(root: &Path) -> Result<ParsedStatus, CoreError> {
    let output = git::run(
        root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    status::parse_status(&output)
}

fn sequence_operation(git_dir: &Path) -> Operation {
    let next_step = std::fs::read_to_string(git_dir.join("sequencer/todo"))
        .ok()
        .and_then(|todo| {
            todo.lines()
                .find(|line| !line.trim().is_empty() && !line.starts_with('#'))
                .and_then(|line| line.split_whitespace().next().map(str::to_owned))
        });
    let reverting = match next_step.as_deref() {
        Some("revert" | "r") => true,
        Some(_) => false,
        None => git_dir.join("REVERT_HEAD").is_file(),
    };
    if reverting {
        Operation::RevertSequence
    } else {
        Operation::CherryPickSequence
    }
}

pub(crate) fn detect_operation(git_dir: &Path) -> Option<Operation> {
    if git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply").is_dir() {
        Some(Operation::Rebase)
    } else if git_dir.join("MERGE_HEAD").is_file() {
        Some(Operation::Merge)
    } else if git_dir.join("sequencer").is_dir() {
        Some(sequence_operation(git_dir))
    } else if git_dir.join("CHERRY_PICK_HEAD").is_file() {
        Some(Operation::CherryPick)
    } else if git_dir.join("REVERT_HEAD").is_file() {
        Some(Operation::Revert)
    } else if git_dir.join("BISECT_LOG").is_file() {
        Some(Operation::Bisect)
    } else {
        None
    }
}

pub(crate) fn read_operation(root: &Path) -> Result<(Option<Operation>, PathBuf), CoreError> {
    let output = git::run(root, &["rev-parse", "--git-dir"])?;
    let git_dir = root.join(output.trim_end_matches('\n'));
    Ok((detect_operation(&git_dir), git_dir))
}

fn read_last_fetch(git_dir: &Path) -> Option<i64> {
    let modified = std::fs::metadata(git_dir.join("FETCH_HEAD"))
        .ok()?
        .modified()
        .ok()?;
    let elapsed = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(elapsed.as_secs()).ok()
}

pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

pub(crate) fn count_worktrees(root: &Path) -> Result<u32, CoreError> {
    Ok(crate::layout::index_u32(read_worktrees(root)?.len()))
}

pub(crate) fn read_worktrees(root: &Path) -> Result<Vec<Worktree>, CoreError> {
    let output = git::run(root, &["worktree", "list", "--porcelain", "-z"])?;
    parse_worktrees(&output, root)
}

fn parse_worktrees(output: &str, root: &Path) -> Result<Vec<Worktree>, CoreError> {
    let mut worktrees = Vec::new();
    let mut current: Option<Worktree> = None;
    for field in output.split('\0') {
        if field.is_empty() {
            worktrees.extend(current.take());
            continue;
        }
        if let Some(path) = field.strip_prefix("worktree ") {
            worktrees.extend(current.take());
            current = Some(Worktree {
                path: path.to_owned(),
                head: None,
                branch: None,
                bare: false,
                locked: false,
                prunable: false,
                current: same_path(Path::new(path), root),
            });
            continue;
        }
        let worktree = current.as_mut().ok_or_else(|| {
            CoreError::invalid_output(
                WORKTREE_COMMAND,
                format!("field before worktree: {field:?}"),
            )
        })?;
        let (key, value) = field.split_once(' ').unwrap_or((field, ""));
        match key {
            "HEAD" => worktree.head = Some(value.to_owned()),
            "branch" => {
                worktree.branch = Some(
                    value
                        .strip_prefix("refs/heads/")
                        .unwrap_or(value)
                        .to_owned(),
                );
            }
            "bare" => worktree.bare = true,
            "locked" => worktree.locked = true,
            "prunable" => worktree.prunable = true,
            _ => {}
        }
    }
    worktrees.extend(current);
    Ok(worktrees)
}

pub fn repo_snapshot(path: &Path) -> Result<RepoSnapshot, CoreError> {
    git::ensure_supported()?;
    let root = resolve_root(path)?;
    snapshots::prune_on_open(&root);
    let ParsedStatus {
        head,
        upstream,
        files,
        counts,
    } = read_status(&root)?;
    let refs = refs::read_refs(&root)?;
    let names = |wanted: RefKind| {
        refs.iter()
            .filter(|entry| entry.kind == wanted)
            .map(|entry| entry.name.clone())
            .collect::<Vec<_>>()
    };
    let (operation, git_dir) = read_operation(&root)?;
    let operation_detail = operation
        .map(|operation| operation::detail(&root, &git_dir, operation, &files))
        .transpose()?;
    Ok(RepoSnapshot {
        root: root.display().to_string(),
        head,
        upstream,
        counts,
        files,
        operation,
        operation_detail,
        last_fetch: read_last_fetch(&git_dir),
        worktrees: read_worktrees(&root)?,
        branches: names(RefKind::LocalBranch),
        remote_branches: names(RefKind::RemoteBranch),
        remotes: refs::read_remotes(&root)?,
        tags: names(RefKind::Tag),
        stashes: refs::read_stashes(&root)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_each_operation_from_its_state_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detect_operation(dir.path()), None);
        let cases = [
            ("MERGE_HEAD", false, Operation::Merge),
            ("CHERRY_PICK_HEAD", false, Operation::CherryPick),
            ("REVERT_HEAD", false, Operation::Revert),
            ("BISECT_LOG", false, Operation::Bisect),
            ("rebase-merge", true, Operation::Rebase),
            ("rebase-apply", true, Operation::Rebase),
        ];
        for (entry, is_dir, expected) in cases {
            let git_dir = tempfile::tempdir().unwrap();
            let target = git_dir.path().join(entry);
            if is_dir {
                std::fs::create_dir(&target).unwrap();
            } else {
                std::fs::write(&target, "x").unwrap();
            }
            assert_eq!(detect_operation(git_dir.path()), Some(expected), "{entry}");
        }
    }

    #[test]
    fn a_sequencer_directory_takes_its_kind_from_the_next_todo_step_or_the_stop_marker() {
        let cases = [
            (
                Some("pick abc subject\n"),
                None,
                Operation::CherryPickSequence,
            ),
            (Some("p abc subject\n"), None, Operation::CherryPickSequence),
            (
                Some("revert abc subject\n"),
                None,
                Operation::RevertSequence,
            ),
            (Some("r abc subject\n"), None, Operation::RevertSequence),
            (
                Some("# note\n\nrevert abc x\n"),
                None,
                Operation::RevertSequence,
            ),
            (None, Some("REVERT_HEAD"), Operation::RevertSequence),
            (
                None,
                Some("CHERRY_PICK_HEAD"),
                Operation::CherryPickSequence,
            ),
            (None, None, Operation::CherryPickSequence),
            (
                Some("pick abc x\n"),
                Some("REVERT_HEAD"),
                Operation::CherryPickSequence,
            ),
        ];
        for (todo, marker, expected) in cases {
            let git_dir = tempfile::tempdir().unwrap();
            std::fs::create_dir(git_dir.path().join("sequencer")).unwrap();
            if let Some(todo) = todo {
                std::fs::write(git_dir.path().join("sequencer/todo"), todo).unwrap();
            }
            if let Some(marker) = marker {
                std::fs::write(git_dir.path().join(marker), "x").unwrap();
            }
            assert_eq!(
                detect_operation(git_dir.path()),
                Some(expected),
                "{todo:?} {marker:?}"
            );
        }
    }

    #[test]
    fn a_merge_takes_precedence_over_a_sequencer_and_a_sequencer_over_a_bisect() {
        let git_dir = tempfile::tempdir().unwrap();
        std::fs::write(git_dir.path().join("BISECT_LOG"), "x").unwrap();
        assert_eq!(detect_operation(git_dir.path()), Some(Operation::Bisect));
        std::fs::create_dir(git_dir.path().join("sequencer")).unwrap();
        assert_eq!(
            detect_operation(git_dir.path()),
            Some(Operation::CherryPickSequence)
        );
        std::fs::write(git_dir.path().join("MERGE_HEAD"), "x").unwrap();
        assert_eq!(detect_operation(git_dir.path()), Some(Operation::Merge));
    }

    #[test]
    fn parses_worktrees_from_nul_separated_porcelain() {
        let output = "worktree /repo\0HEAD aaa\0branch refs/heads/main\0\0\
                      worktree /repo-wt\0HEAD bbb\0detached\0locked because\0\0\
                      worktree /old\0HEAD ccc\0branch refs/heads/gone\0prunable gitdir file points to non-existent location\0\0";
        let worktrees = parse_worktrees(output, Path::new("/repo")).unwrap();
        assert_eq!(worktrees.len(), 3);
        assert!(worktrees[0].current);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(!worktrees[1].current);
        assert_eq!(worktrees[1].branch, None);
        assert!(worktrees[1].locked);
        assert!(worktrees[2].prunable);
    }

    #[test]
    fn rejects_worktree_fields_before_a_worktree_line() {
        assert!(parse_worktrees("HEAD aaa\0", Path::new("/repo")).is_err());
    }
}
