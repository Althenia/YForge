use std::path::Path;

use crate::diff;
use crate::error::CoreError;
use crate::git;
use crate::model::{ChangeArea, DiffHunk, DiffLineKind};
use crate::repo;
use crate::snapshots::{self, Action};

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
    let mut args = vec!["add".to_owned(), "--all".to_owned()];
    let nested = repo::nested_worktree_directories(&root)?;
    if !nested.is_empty() {
        args.extend(["--".to_owned(), ".".to_owned()]);
        args.extend(
            nested
                .iter()
                .map(|directory| format!(":(exclude,literal){directory}")),
        );
    }
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    git::run(&root, &args).map(drop)
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
    snapshots::capture(
        &root,
        Action::Discard,
        &format!("Discard changes in {} file(s)", files.len()),
        None,
    )?;
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

fn in_head(root: &Path, file: &str) -> Result<bool, CoreError> {
    let completed = git::run_unchecked(
        root,
        &["ls-tree", "--name-only", "-z", "HEAD", "--", file],
        None,
    )?;
    Ok(completed.succeeded() && !completed.stdout.is_empty())
}

pub fn discard_staged_files(path: &Path, files: &[String]) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(files)?;
    let changes = repo::read_status(&root)?.files;
    let mut untracked = Vec::new();
    let mut restored = Vec::new();
    let mut removed = Vec::new();
    for file in files {
        let staged = changes
            .iter()
            .any(|change| change.area == ChangeArea::Staged && change.path == *file);
        let renamed_from = changes.iter().any(|change| {
            change.area == ChangeArea::Staged && change.original_path.as_deref() == Some(file)
        });
        let loose = changes
            .iter()
            .any(|change| change.area == ChangeArea::Untracked && change.path == *file);
        if loose && !staged {
            untracked.push(file.clone());
        } else if staged || renamed_from {
            if in_head(&root, file)? {
                restored.push(file.clone());
            } else {
                removed.push(file.clone());
            }
        } else {
            return Err(CoreError::invalid_request(format!(
                "{file} has no staged or untracked change to discard"
            )));
        }
    }
    snapshots::capture(
        &root,
        Action::Discard,
        &format!("Discard staged changes in {} file(s)", files.len()),
        None,
    )?;
    if !restored.is_empty() {
        git::run(
            &root,
            &with_paths(
                &["restore", "--source=HEAD", "--staged", "--worktree"],
                &restored,
            ),
        )?;
    }
    if !removed.is_empty() {
        git::run(&root, &with_paths(&["rm", "--force", "--quiet"], &removed))?;
    }
    if !untracked.is_empty() {
        git::run(
            &root,
            &with_paths(&["clean", "--force", "--quiet"], &untracked),
        )?;
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
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

fn select_lines(
    hunk: &DiffHunk,
    selected: &[u32],
    action: HunkAction,
) -> Result<DiffHunk, CoreError> {
    if selected
        .iter()
        .any(|index| *index as usize >= hunk.lines.len())
    {
        return Err(CoreError::invalid_request(
            "the selection reaches past the end of the hunk",
        ));
    }
    let chosen = |index: usize| selected.iter().any(|picked| *picked as usize == index);
    if !hunk
        .lines
        .iter()
        .enumerate()
        .any(|(index, line)| line.kind != DiffLineKind::Context && chosen(index))
    {
        return Err(CoreError::invalid_request(
            "select at least one added or removed line",
        ));
    }
    let forward = action == HunkAction::Stage;
    let mut lines = Vec::new();
    for (index, line) in hunk.lines.iter().enumerate() {
        let mut line = line.clone();
        match (line.kind, chosen(index)) {
            (DiffLineKind::Context, _) | (DiffLineKind::Removed | DiffLineKind::Added, true) => {}
            (DiffLineKind::Removed, false) if forward => line.kind = DiffLineKind::Context,
            (DiffLineKind::Added, false) if !forward => line.kind = DiffLineKind::Context,
            (DiffLineKind::Removed | DiffLineKind::Added, false) => continue,
        }
        lines.push(line);
    }
    let count =
        |excluded: DiffLineKind| lines.iter().filter(|line| line.kind != excluded).count() as u32;
    Ok(DiffHunk {
        old_start: hunk.old_start,
        old_lines: count(DiffLineKind::Added),
        new_start: hunk.new_start,
        new_lines: count(DiffLineKind::Removed),
        heading: hunk.heading.clone(),
        lines,
    })
}

pub(crate) fn select_staged_lines(
    hunk: &DiffHunk,
    selected: &[u32],
) -> Result<DiffHunk, CoreError> {
    select_lines(hunk, selected, HunkAction::Stage)
}

fn apply_selection(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    selected: Option<&[u32]>,
    action: HunkAction,
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    if ignore_whitespace {
        return Err(CoreError::WhitespaceIgnored);
    }
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let (current, _) = diff::read_file_diff(&root, file, action.area(), false, false)?;
    if !current.hunks.contains(hunk) {
        return Err(CoreError::StaleHunk {
            file: file.to_owned(),
            detail: "the file changed after the diff was read".to_owned(),
        });
    }
    let body = match selected {
        Some(selected) => diff::hunk_patch(&select_lines(hunk, selected, action)?),
        None => diff::hunk_patch(hunk),
    };
    let patch = format!("{}{body}", current.header);
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
    if action == HunkAction::Discard {
        let (kind, unit) = if selected.is_some() {
            (Action::DiscardLines, "lines")
        } else {
            (Action::DiscardHunk, "a hunk")
        };
        snapshots::capture(&root, kind, &format!("Discard {unit} in {file}"), None)?;
    }
    let mut apply: Vec<&str> = base.to_vec();
    apply.push("-");
    git::run_with_input(&root, &apply, &patch).map(drop)
}

pub fn stage_hunk(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(path, file, hunk, None, HunkAction::Stage, ignore_whitespace)
}

pub fn unstage_hunk(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(
        path,
        file,
        hunk,
        None,
        HunkAction::Unstage,
        ignore_whitespace,
    )
}

pub fn discard_hunk(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(
        path,
        file,
        hunk,
        None,
        HunkAction::Discard,
        ignore_whitespace,
    )
}

pub fn stage_lines(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    lines: &[u32],
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(
        path,
        file,
        hunk,
        Some(lines),
        HunkAction::Stage,
        ignore_whitespace,
    )
}

pub fn unstage_lines(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    lines: &[u32],
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(
        path,
        file,
        hunk,
        Some(lines),
        HunkAction::Unstage,
        ignore_whitespace,
    )
}

pub fn discard_lines(
    path: &Path,
    file: &str,
    hunk: &DiffHunk,
    lines: &[u32],
    ignore_whitespace: bool,
) -> Result<(), CoreError> {
    apply_selection(
        path,
        file,
        hunk,
        Some(lines),
        HunkAction::Discard,
        ignore_whitespace,
    )
}
