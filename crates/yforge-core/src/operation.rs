use std::fs;
use std::path::Path;

use crate::branch::{self, classify_local_changes};
use crate::error::CoreError;
use crate::git;
use crate::model::{
    ChangeArea, FileChange, Operation, OperationDetail, OperationOutcome, OperationStep,
};
use crate::repo;
use crate::stage;

fn read_line(git_dir: &Path, name: &str) -> Option<String> {
    fs::read_to_string(git_dir.join(name))
        .ok()
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty())
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn ref_at(root: &Path, sha: &str) -> Result<Option<String>, CoreError> {
    let output = git::run(
        root,
        &[
            "for-each-ref",
            "--points-at",
            sha,
            "--format=%(symref)%00%(refname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    Ok(output.lines().find_map(|line| {
        let (symref, name) = line.split_once('\0')?;
        symref.is_empty().then(|| name.to_owned())
    }))
}

fn commit_label(root: &Path, sha: &str) -> Result<String, CoreError> {
    let subject = git::run(
        root,
        &["log", "-1", "--no-show-signature", "--format=%s", sha],
    )?;
    Ok(format!("{} {}", short_sha(sha), subject.trim()))
}

fn merge_message(git_dir: &Path) -> String {
    fs::read_to_string(git_dir.join("MERGE_MSG"))
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

fn rebase_step(git_dir: &Path) -> Option<OperationStep> {
    let number = |name: &str| read_line(git_dir, name)?.parse::<u32>().ok();
    let (current, total) = if git_dir.join("rebase-merge").is_dir() {
        (number("rebase-merge/msgnum")?, number("rebase-merge/end")?)
    } else {
        (number("rebase-apply/next")?, number("rebase-apply/last")?)
    };
    Some(OperationStep { current, total })
}

fn resolved_paths(root: &Path, conflicted: &[FileChange]) -> Result<Vec<String>, CoreError> {
    let output = git::run(root, &["ls-files", "--resolve-undo", "-z"])?;
    let mut paths: Vec<String> = Vec::new();
    for entry in output.split('\0').filter(|entry| !entry.is_empty()) {
        let (_, path) = entry.split_once('\t').ok_or_else(|| {
            CoreError::invalid_output(
                "git ls-files --resolve-undo",
                format!("malformed entry {entry:?}"),
            )
        })?;
        let still_conflicted = conflicted.iter().any(|change| change.path == path);
        if !still_conflicted && !paths.iter().any(|known| known == path) {
            paths.push(path.to_owned());
        }
    }
    Ok(paths)
}

pub(crate) fn detail(
    root: &Path,
    git_dir: &Path,
    operation: Operation,
    files: &[FileChange],
) -> Result<OperationDetail, CoreError> {
    let conflicted: Vec<FileChange> = files
        .iter()
        .filter(|change| change.area == ChangeArea::Conflicted)
        .cloned()
        .collect();
    let (current, incoming, message, step) = match operation {
        Operation::Merge => {
            let incoming = match read_line(git_dir, "MERGE_HEAD") {
                Some(sha) => Some(ref_at(root, &sha)?.unwrap_or_else(|| short_sha(&sha))),
                None => None,
            };
            (head_name(root)?, incoming, merge_message(git_dir), None)
        }
        Operation::CherryPick
        | Operation::Revert
        | Operation::CherryPickSequence
        | Operation::RevertSequence => {
            let head = match operation {
                Operation::Revert | Operation::RevertSequence => "REVERT_HEAD",
                _ => "CHERRY_PICK_HEAD",
            };
            let incoming = match read_line(git_dir, head) {
                Some(sha) => Some(commit_label(root, &sha)?),
                None => None,
            };
            (head_name(root)?, incoming, String::new(), None)
        }
        Operation::Rebase => {
            let directory = if git_dir.join("rebase-merge").is_dir() {
                "rebase-merge"
            } else {
                "rebase-apply"
            };
            let branch = read_line(git_dir, &format!("{directory}/head-name"))
                .and_then(|name| name.strip_prefix("refs/heads/").map(str::to_owned));
            let onto = match read_line(git_dir, &format!("{directory}/onto")) {
                Some(sha) => ref_at(root, &sha)?.unwrap_or_else(|| short_sha(&sha)),
                None => head_name(root)?,
            };
            (onto, branch, String::new(), rebase_step(git_dir))
        }
        Operation::Bisect => {
            let origin = match read_line(git_dir, "BISECT_START") {
                Some(origin) => origin,
                None => head_name(root)?,
            };
            (origin, None, String::new(), None)
        }
    };
    Ok(OperationDetail {
        current,
        incoming,
        message,
        step,
        resolved: resolved_paths(root, &conflicted)?,
    })
}

fn head_name(root: &Path) -> Result<String, CoreError> {
    match branch::current_branch(root)? {
        Some(name) => Ok(name),
        None => Ok(short_sha(git::run(root, &["rev-parse", "HEAD"])?.trim())),
    }
}

pub(crate) fn require_no_operation(root: &Path) -> Result<(), CoreError> {
    match repo::read_operation(root)?.0 {
        None => Ok(()),
        Some(operation) => Err(CoreError::invalid_request(format!(
            "finish or abort the {} in progress first",
            operation_noun(operation)
        ))),
    }
}

fn operation_noun(operation: Operation) -> &'static str {
    match operation {
        Operation::Merge => "merge",
        Operation::Rebase => "rebase",
        Operation::CherryPick | Operation::CherryPickSequence => "cherry-pick",
        Operation::Revert | Operation::RevertSequence => "revert",
        Operation::Bisect => "bisect",
    }
}

fn require_operation(root: &Path) -> Result<Operation, CoreError> {
    repo::read_operation(root)?.0.ok_or_else(|| {
        CoreError::invalid_request(
            "no merge, rebase, cherry-pick, revert, or bisect is in progress",
        )
    })
}

fn plural_files(count: u32) -> String {
    format!(
        "{count} conflicted {}",
        if count == 1 { "file" } else { "files" }
    )
}

pub(crate) fn settle(
    root: &Path,
    args: &[&str],
    completed: git::Completed,
) -> Result<OperationOutcome, CoreError> {
    if completed.succeeded() {
        return Ok(OperationOutcome::Completed);
    }
    if repo::read_operation(root)?.0.is_some() && repo::read_status(root)?.counts.conflicted > 0 {
        return Ok(OperationOutcome::Conflicts);
    }
    Err(classify_local_changes(CoreError::GitFailed {
        command: format!("git {}", args.join(" ")),
        status: completed.status,
        stderr: format!("{}{}", completed.stdout, completed.stderr)
            .trim()
            .to_owned(),
    }))
}

pub fn operation_continue(
    path: &Path,
    message: Option<&str>,
) -> Result<OperationOutcome, CoreError> {
    let root = repo::open(path)?;
    let operation = require_operation(&root)?;
    let conflicted = repo::read_status(&root)?.counts.conflicted;
    if conflicted > 0 {
        return Err(CoreError::invalid_request(format!(
            "resolve the {} first",
            plural_files(conflicted)
        )));
    }
    let message = message.map(str::trim);
    let args: Vec<&str> = match (operation, message) {
        (Operation::Merge, Some("")) => {
            return Err(CoreError::invalid_request("enter a merge message"))
        }
        (Operation::Merge, Some(text)) => vec!["commit", "--quiet", "-m", text],
        (Operation::Merge, None) => vec!["commit", "--quiet", "--no-edit"],
        (Operation::Rebase, _) => vec!["rebase", "--continue"],
        (Operation::CherryPick | Operation::CherryPickSequence, _) => {
            vec!["cherry-pick", "--continue"]
        }
        (Operation::Revert | Operation::RevertSequence, _) => vec!["revert", "--continue"],
        (Operation::Bisect, _) => {
            return Err(CoreError::invalid_request(
                "a bisect has nothing to continue; reset it to finish",
            ))
        }
    };
    let completed = git::run_unchecked(&root, &args, None)?;
    settle(&root, &args, completed)
}

pub fn operation_skip(path: &Path) -> Result<OperationOutcome, CoreError> {
    let root = repo::open(path)?;
    let args = match require_operation(&root)? {
        Operation::Rebase => ["rebase", "--skip"],
        Operation::CherryPickSequence => ["cherry-pick", "--skip"],
        Operation::RevertSequence => ["revert", "--skip"],
        _ => {
            return Err(CoreError::invalid_request(
                "only a rebase or a multi-commit cherry-pick or revert can skip a step",
            ))
        }
    };
    let completed = git::run_unchecked(&root, &args, None)?;
    settle(&root, &args, completed)
}

pub fn operation_abort(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let operation = require_operation(&root)?;
    let args = match operation {
        Operation::Bisect => ["bisect", "reset"],
        _ => [operation_noun(operation), "--abort"],
    };
    git::run(&root, &args).map(drop)
}

pub(crate) fn has_conflict_markers(text: &str) -> bool {
    let mut awaiting = 0;
    for line in text.lines() {
        let line = line.trim_end();
        awaiting = match awaiting {
            0 if line == "<<<<<<<" || line.starts_with("<<<<<<< ") => 1,
            1 if line == "=======" => 2,
            2 if line == ">>>>>>>" || line.starts_with(">>>>>>> ") => return true,
            other => other,
        };
    }
    false
}

pub(crate) fn require_conflicted(root: &Path, files: &[String]) -> Result<(), CoreError> {
    repo::check_paths(files)?;
    let status = repo::read_status(root)?.files;
    for file in files {
        let conflicted = status
            .iter()
            .any(|change| &change.path == file && change.area == ChangeArea::Conflicted);
        if !conflicted {
            return Err(CoreError::invalid_request(format!(
                "{file} is not conflicted"
            )));
        }
    }
    Ok(())
}

pub fn mark_resolved(path: &Path, files: &[String]) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_conflicted(&root, files)?;
    for file in files {
        if let Ok(bytes) = fs::read(root.join(file)) {
            if has_conflict_markers(&String::from_utf8_lossy(&bytes)) {
                return Err(CoreError::ConflictMarkers { file: file.clone() });
            }
        }
    }
    git::run(&root, &stage::with_paths(&["add", "--all"], files)).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_a_complete_conflict_block() {
        let text = "before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> origin/main\nafter\n";
        assert!(has_conflict_markers(text));
        assert!(has_conflict_markers(
            "<<<<<<<\n|||||||\nbase\n=======\nx\n>>>>>>>\n"
        ));
    }

    #[test]
    fn ignores_text_that_only_resembles_markers() {
        assert!(!has_conflict_markers("Title\n=======\nbody\n"));
        assert!(!has_conflict_markers("<<<<<<< HEAD\nunterminated\n"));
        assert!(!has_conflict_markers("<<<<<<<x\n=======\n>>>>>>>x\n"));
        assert!(!has_conflict_markers(">>>>>>> b\n=======\n<<<<<<< a\n"));
    }
}
