use std::path::Path;

use crate::diff;
use crate::error::CoreError;
use crate::git;
use crate::model::{ChangeArea, DiffHunk};
use crate::repo;

pub(crate) fn with_paths<'a>(prefix: &[&'a str], files: &'a [String]) -> Vec<&'a str> {
    let mut args = vec!["--literal-pathspecs"];
    args.extend(prefix);
    args.push("--");
    args.extend(files.iter().map(String::as_str));
    args
}

pub fn stage_files(path: &Path, files: &[String]) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    git::run(&root, &with_paths(&["add"], files)).map(drop)
}

pub fn unstage_files(path: &Path, files: &[String]) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    git::run(&root, &with_paths(&["reset", "--quiet"], files)).map(drop)
}

pub fn stage_all(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let conflicted = repo::read_status(&root)?.counts.conflicted;
    if conflicted > 0 {
        return Err(CoreError::invalid_request(format!(
            "resolve the {conflicted} conflicted {} before staging everything",
            if conflicted == 1 { "file" } else { "files" }
        )));
    }
    git::run(&root, &["add", "--all"]).map(drop)
}

pub fn unstage_all(path: &Path) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    git::run(&root, &["reset", "--quiet"]).map(drop)
}

pub fn discard_files(path: &Path, files: &[String]) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    let changes = repo::read_status(&root)?.files;
    let has = |file: &str, area: ChangeArea| {
        changes
            .iter()
            .any(|change| change.path == file && change.area == area)
    };
    let mut untracked = Vec::new();
    let mut tracked = Vec::new();
    for file in files {
        if has(file, ChangeArea::Untracked) {
            untracked.push(file.clone());
        } else if has(file, ChangeArea::Unstaged) {
            tracked.push(file.clone());
        } else {
            return Err(CoreError::invalid_request(format!(
                "{file} has no unstaged or untracked change to discard"
            )));
        }
    }
    if !tracked.is_empty() {
        git::run(&root, &with_paths(&["restore"], &tracked))?;
    }
    if !untracked.is_empty() {
        git::run(
            &root,
            &with_paths(&["clean", "--force", "--quiet"], &untracked),
        )?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum HunkAction {
    Stage,
    Unstage,
    Discard,
}

impl HunkAction {
    fn area(self) -> ChangeArea {
        match self {
            Self::Stage | Self::Discard => ChangeArea::Unstaged,
            Self::Unstage => ChangeArea::Staged,
        }
    }

    fn apply_args(self) -> &'static [&'static str] {
        match self {
            Self::Stage => &["apply", "--cached", "--whitespace=nowarn"],
            Self::Unstage => &["apply", "--cached", "--whitespace=nowarn", "--reverse"],
            Self::Discard => &["apply", "--whitespace=nowarn", "--reverse"],
        }
    }
}

fn apply_hunk(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    action: HunkAction,
) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let (current, _) = diff::read_file_diff(&root, file, action.area(), false)?;
    if !current.hunks.contains(hunk) {
        return Err(CoreError::StaleHunk {
            file: file.to_owned(),
            detail: "the file changed after the diff was read".to_owned(),
        });
    }
    let patch = format!("{}{}", current.header, diff::hunk_patch(hunk));
    let base = action.apply_args();
    let stale = |error: CoreError| match error {
        CoreError::GitFailed { stderr, .. } => CoreError::StaleHunk {
            file: file.to_owned(),
            detail: stderr,
        },
        other => other,
    };
    let mut check: Vec<&str> = base.to_vec();
    check.extend(["--check", "-"]);
    git::run_with_input(&root, &check, &patch).map_err(stale)?;
    let mut apply: Vec<&str> = base.to_vec();
    apply.push("-");
    git::run_with_input(&root, &apply, &patch).map(drop)
}

pub fn stage_hunk(path: &Path, file: &str, hunk: &DiffHunk) -> Result<(), CoreError> {
    apply_hunk(path, file, hunk, HunkAction::Stage)
}

pub fn unstage_hunk(path: &Path, file: &str, hunk: &DiffHunk) -> Result<(), CoreError> {
    apply_hunk(path, file, hunk, HunkAction::Unstage)
}

pub fn discard_hunk(path: &Path, file: &str, hunk: &DiffHunk) -> Result<(), CoreError> {
    apply_hunk(path, file, hunk, HunkAction::Discard)
}
