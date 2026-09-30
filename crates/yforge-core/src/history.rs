use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::branch;
use crate::commit::{self, parse_raw, validate_sha};
use crate::diff::{self, ParsedDiff};
use crate::error::CoreError;
use crate::git;
use crate::graph;
use crate::model::{
    Author, DiffHunk, DiffLineKind, FileStatus, RebaseOutcome, RebasePlan, RebaseResult,
    RebaseStep, RebaseTodo, RecomposeChange, RecomposeFile, RecomposeGroup, RecomposeHunk,
    RecomposePreview, RecomposeResult,
};
use crate::operation;
use crate::repo;
use crate::snapshots::{self, Action};
use crate::stage;
use crate::undo;

struct RangeCommit {
    sha: String,
    summary: String,
    author: Author,
    is_merge: bool,
}

struct Range {
    base: String,
    head: String,
    commits: Vec<RangeCommit>,
}

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn resolve(root: &Path, spec: &str) -> Result<String, CoreError> {
    let completed = git::run_unchecked(root, &["rev-parse", "--verify", "--quiet", spec], None)?;
    if completed.succeeded() {
        Ok(completed.stdout.trim().to_owned())
    } else {
        Err(CoreError::invalid_request(format!(
            "{spec} is not a commit in this repository"
        )))
    }
}

fn parse_range_commit(line: &str) -> Result<RangeCommit, CoreError> {
    let fields: Vec<&str> = line.splitn(4, '\u{1f}').collect();
    let [sha, parents, author, summary] = fields[..] else {
        return Err(CoreError::invalid_output(
            "git log",
            format!("expected 4 fields in {line:?}"),
        ));
    };
    Ok(RangeCommit {
        sha: sha.to_owned(),
        summary: summary.to_owned(),
        author: graph::author(author),
        is_merge: parents
            .split(' ')
            .filter(|parent| !parent.is_empty())
            .count()
            > 1,
    })
}

fn read_range(root: &Path, base: &str) -> Result<Range, CoreError> {
    branch::require_start_point(root, base)?;
    if !git::run_unchecked(root, &["rev-parse", "--verify", "--quiet", "HEAD"], None)?.succeeded() {
        return Err(CoreError::invalid_request("there is no commit yet"));
    }
    let head = resolve(root, "HEAD^{commit}")?;
    let base = resolve(root, &format!("{base}^{{commit}}"))?;
    let ancestry = git::run_unchecked(root, &["merge-base", "--is-ancestor", &base, &head], None)?;
    match ancestry.status {
        Some(0) => {}
        Some(1) => {
            return Err(CoreError::invalid_request(format!(
                "{} is not an ancestor of HEAD",
                short(&base)
            )))
        }
        status => {
            return Err(CoreError::GitFailed {
                command: "git merge-base --is-ancestor".to_owned(),
                status,
                stderr: ancestry.stderr.trim().to_owned(),
            })
        }
    }
    let listing = git::run(
        root,
        &[
            "log",
            "--topo-order",
            "--reverse",
            "--no-show-signature",
            "--format=%H%x1f%P%x1f%an%x1f%s",
            &format!("{base}..{head}"),
        ],
    )?;
    let commits = listing
        .lines()
        .filter(|line| !line.is_empty())
        .map(parse_range_commit)
        .collect::<Result<Vec<_>, _>>()?;
    if commits.is_empty() {
        return Err(CoreError::invalid_request(format!(
            "there are no commits after {}",
            short(&base)
        )));
    }
    Ok(Range {
        base,
        head,
        commits,
    })
}

fn reject_merges(range: &Range) -> Result<(), CoreError> {
    match range.commits.iter().find(|commit| commit.is_merge) {
        Some(merge) => Err(CoreError::MergeCommitInRange {
            sha: merge.sha.clone(),
        }),
        None => Ok(()),
    }
}

fn pushed_commits(root: &Path, range: &Range) -> Result<HashSet<String>, CoreError> {
    if !commit::has_upstream(root)? {
        return Ok(HashSet::new());
    }
    let unpushed = git::run(
        root,
        &[
            "rev-list",
            &format!("{}..{}", range.base, range.head),
            "--not",
            "@{upstream}",
        ],
    )?;
    let unpushed: HashSet<&str> = unpushed.lines().collect();
    Ok(range
        .commits
        .iter()
        .filter(|commit| !unpushed.contains(commit.sha.as_str()))
        .map(|commit| commit.sha.clone())
        .collect())
}

pub fn rebase_plan(path: &Path, base: &str) -> Result<RebasePlan, CoreError> {
    let root = repo::open(path)?;
    let range = read_range(&root, base)?;
    let pushed = pushed_commits(&root, &range)?;
    Ok(RebasePlan {
        pushed: !pushed.is_empty(),
        commits: range
            .commits
            .into_iter()
            .map(|commit| RebaseTodo {
                pushed: pushed.contains(&commit.sha),
                sha: commit.sha,
                summary: commit.summary,
                author: commit.author,
                is_merge: commit.is_merge,
            })
            .collect(),
        base: range.base,
    })
}

fn valid_message(message: &str) -> Result<String, CoreError> {
    if message.trim().is_empty() {
        return Err(CoreError::invalid_request("the commit message is empty"));
    }
    if message.contains('\0') {
        return Err(CoreError::invalid_request(
            "the commit message contains a NUL character",
        ));
    }
    Ok(message.to_owned())
}

fn range_index(range: &Range, sha: &str) -> Result<usize, CoreError> {
    validate_sha(sha)?;
    let wanted = sha.to_ascii_lowercase();
    let mut matches = range
        .commits
        .iter()
        .enumerate()
        .filter(|(_, commit)| commit.sha.starts_with(&wanted))
        .map(|(index, _)| index);
    match (matches.next(), matches.next()) {
        (Some(index), None) => Ok(index),
        (None, _) => Err(CoreError::invalid_request(format!(
            "{sha} is not in the rewritten range"
        ))),
        (Some(_), Some(_)) => Err(CoreError::invalid_request(format!(
            "{sha} matches more than one commit"
        ))),
    }
}

struct Chain {
    sha: String,
    edit: bool,
    message: Option<String>,
    followers: Vec<String>,
}

struct Todo {
    text: String,
    dropped_all: bool,
}

fn octal(message: &str) -> String {
    message
        .bytes()
        .map(|byte| format!("\\{byte:03o}"))
        .collect()
}

fn build_todo(range: &Range, steps: &[RebaseStep]) -> Result<Todo, CoreError> {
    let mut seen = HashSet::new();
    let mut chains: Vec<Chain> = Vec::new();
    for step in steps {
        let (RebaseStep::Pick { sha }
        | RebaseStep::Reword { sha, .. }
        | RebaseStep::Squash { sha, .. }
        | RebaseStep::Fixup { sha }
        | RebaseStep::Drop { sha }
        | RebaseStep::Edit { sha }) = step;
        let index = range_index(range, sha)?;
        if !seen.insert(index) {
            return Err(CoreError::invalid_request(format!(
                "{} appears more than once",
                short(&range.commits[index].sha)
            )));
        }
        let full = range.commits[index].sha.clone();
        let no_previous = || {
            CoreError::invalid_request(format!(
                "{} cannot be squashed or fixed up: there is no earlier kept commit to combine it with",
                short(&full)
            ))
        };
        match step {
            RebaseStep::Pick { .. } => chains.push(Chain {
                sha: full,
                edit: false,
                message: None,
                followers: Vec::new(),
            }),
            RebaseStep::Reword { message, .. } => chains.push(Chain {
                sha: full,
                edit: false,
                message: Some(valid_message(message)?),
                followers: Vec::new(),
            }),
            RebaseStep::Edit { .. } => chains.push(Chain {
                sha: full,
                edit: true,
                message: None,
                followers: Vec::new(),
            }),
            RebaseStep::Drop { .. } => {}
            RebaseStep::Fixup { .. } => chains
                .last_mut()
                .ok_or_else(no_previous)?
                .followers
                .push(full),
            RebaseStep::Squash { message, .. } => {
                let message = valid_message(message)?;
                let chain = chains.last_mut().ok_or_else(no_previous)?;
                chain.followers.push(full);
                chain.message = Some(message);
            }
        }
    }
    let mut text = String::new();
    for chain in &chains {
        let verb = if chain.edit { "edit" } else { "pick" };
        text.push_str(&format!("{verb} {}\n", chain.sha));
        for follower in &chain.followers {
            text.push_str(&format!("fixup {follower}\n"));
        }
        if let Some(message) = &chain.message {
            text.push_str(&format!(
                "exec git commit --quiet --amend --allow-empty -m \"$(printf '{}')\"\n",
                octal(message)
            ));
        }
    }
    for commit in &range.commits {
        let kept = chains
            .iter()
            .any(|chain| chain.sha == commit.sha || chain.followers.contains(&commit.sha));
        if !kept {
            text.push_str(&format!("drop {}\n", commit.sha));
        }
    }
    Ok(Todo {
        text,
        dropped_all: chains.is_empty(),
    })
}

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct Scratch(PathBuf);

impl Scratch {
    fn create() -> io::Result<Self> {
        let dir = std::env::temp_dir().join(format!(
            "yforge-rebase-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        ));
        fs::DirBuilder::new().mode(0o700).create(&dir)?;
        Ok(Self(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn write_sequence_editor(scratch: &Scratch, todo: &str) -> io::Result<PathBuf> {
    let todo_path = scratch.0.join("todo");
    fs::write(&todo_path, todo)?;
    let script = scratch.0.join("sequence-editor.sh");
    fs::write(
        &script,
        format!("#!/bin/sh\ncat {} > \"$1\"\n", shell_quote(&todo_path)),
    )?;
    fs::set_permissions(&script, fs::Permissions::from_mode(0o700))?;
    Ok(script)
}

fn run_rebase(root: &Path, base: &str, todo: &str) -> Result<RebaseOutcome, CoreError> {
    let failed = |error: io::Error| CoreError::GitFailed {
        command: "git rebase --interactive".to_owned(),
        status: None,
        stderr: error.to_string(),
    };
    let scratch = Scratch::create().map_err(failed)?;
    let script = write_sequence_editor(&scratch, todo).map_err(failed)?;
    let editor = shell_quote(&script);
    let args = ["rebase", "--interactive", "--no-autostash", base];
    let completed = git::run_with_env(root, &args, &[("GIT_SEQUENCE_EDITOR", &editor)])?;
    if completed.succeeded() && repo::read_operation(root)?.0.is_some() {
        return Ok(RebaseOutcome::StoppedToEdit);
    }
    Ok(match operation::settle(root, &args, completed)? {
        crate::model::OperationOutcome::Completed => RebaseOutcome::Completed,
        crate::model::OperationOutcome::Conflicts => RebaseOutcome::Conflicts,
    })
}

fn rewrite(
    root: &Path,
    range: &Range,
    steps: &[RebaseStep],
    action: Action,
) -> Result<RebaseResult, CoreError> {
    let todo = build_todo(range, steps)?;
    snapshots::capture(
        root,
        action,
        &format!(
            "Rewrite {} commit(s) above {}",
            range.commits.len(),
            short(&range.base)
        ),
        None,
    )?;
    let pushed = !pushed_commits(root, range)?.is_empty();
    let outcome = run_rebase(root, &range.base, &todo.text)?;
    Ok(RebaseResult {
        outcome,
        pushed,
        dropped_all: todo.dropped_all,
    })
}

pub fn rebase_interactive(
    path: &Path,
    base: &str,
    steps: &[RebaseStep],
) -> Result<RebaseResult, CoreError> {
    let root = repo::open(path)?;
    operation::require_settled(&root)?;
    let range = read_range(&root, base)?;
    reject_merges(&range)?;
    rewrite(&root, &range, steps, Action::InteractiveRebase)
}

fn selected_commits(root: &Path, shas: &[String]) -> Result<Vec<String>, CoreError> {
    let mut resolved = Vec::new();
    for sha in shas {
        validate_sha(sha)?;
        let full = resolve(root, &format!("{sha}^{{commit}}"))?;
        if resolved.contains(&full) {
            return Err(CoreError::invalid_request(format!(
                "{} is selected more than once",
                short(&full)
            )));
        }
        resolved.push(full);
    }
    Ok(resolved)
}

fn parent_of_oldest(root: &Path, selected: &[String]) -> Result<String, CoreError> {
    let mut args = vec!["merge-base", "--octopus"];
    args.extend(selected.iter().map(String::as_str));
    let common = git::run_unchecked(root, &args, None)?;
    let oldest = common.stdout.trim();
    if !common.succeeded() || !selected.iter().any(|sha| sha == oldest) {
        return Err(CoreError::invalid_request(
            "the selected commits are not one contiguous run of the current branch",
        ));
    }
    let listing = git::run(root, &["rev-list", "--parents", "--max-count=1", oldest])?;
    match listing.split_whitespace().nth(1) {
        Some(parent) => Ok(parent.to_owned()),
        None => Err(CoreError::invalid_request(
            "the first commit of the repository has no earlier commit to squash into",
        )),
    }
}

pub fn squash_commits(
    path: &Path,
    shas: &[String],
    message: &str,
) -> Result<RebaseResult, CoreError> {
    let root = repo::open(path)?;
    operation::require_settled(&root)?;
    if shas.len() < 2 {
        return Err(CoreError::invalid_request(
            "select at least two commits to squash",
        ));
    }
    let message = valid_message(message)?;
    let selected = selected_commits(&root, shas)?;
    let base = parent_of_oldest(&root, &selected)?;
    let range = read_range(&root, &base)?;
    reject_merges(&range)?;
    let mut positions = Vec::new();
    for sha in &selected {
        let position = range
            .commits
            .iter()
            .position(|commit| &commit.sha == sha)
            .ok_or_else(|| {
                CoreError::invalid_request(format!("{} is not on the current branch", short(sha)))
            })?;
        positions.push(position);
    }
    let first = positions.iter().copied().min().unwrap_or_default();
    let last = positions.iter().copied().max().unwrap_or_default();
    if last - first + 1 != positions.len() {
        return Err(CoreError::invalid_request(
            "the selected commits are not one contiguous run of the current branch",
        ));
    }
    let steps: Vec<RebaseStep> = range
        .commits
        .iter()
        .enumerate()
        .map(|(position, commit)| {
            let sha = commit.sha.clone();
            if positions.contains(&position) && position != first {
                RebaseStep::Squash {
                    sha,
                    message: message.clone(),
                }
            } else {
                RebaseStep::Pick { sha }
            }
        })
        .collect();
    rewrite(&root, &range, &steps, Action::SquashCommits)
}

struct FileEntry {
    path: String,
    status: FileStatus,
    parsed: ParsedDiff,
    whole_file_only: bool,
}

fn changes_mode(header: &str) -> bool {
    header
        .lines()
        .any(|line| line.starts_with("old mode ") || line.starts_with("new mode "))
}

fn hunk_id(path: &str, hunk: &DiffHunk) -> String {
    format!(
        "{path}@{},{}+{},{}",
        hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
    )
}

fn combined_diff(root: &Path, range: &Range) -> Result<Vec<FileEntry>, CoreError> {
    let raw = git::run(
        root,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--raw",
            "-z",
            &range.base,
            &range.head,
        ],
    )?;
    parse_raw(&raw)?
        .into_iter()
        .map(|(status, path, _)| {
            let parsed =
                diff::read_commit_diff(root, &range.base, &range.head, &path, None, false)?;
            let whole_file_only = parsed.binary
                || parsed.hunks.is_empty()
                || status == FileStatus::TypeChanged
                || changes_mode(&parsed.header);
            Ok(FileEntry {
                path,
                status,
                parsed,
                whole_file_only,
            })
        })
        .collect()
}

pub fn recompose_preview(path: &Path, base: &str) -> Result<RecomposePreview, CoreError> {
    let root = repo::open(path)?;
    let range = read_range(&root, base)?;
    reject_merges(&range)?;
    let files = combined_diff(&root, &range)?;
    let pushed = !pushed_commits(&root, &range)?.is_empty();
    Ok(RecomposePreview {
        base: range.base,
        head: range.head,
        pushed,
        files: files
            .into_iter()
            .map(|entry| RecomposeFile {
                hunks: entry
                    .parsed
                    .hunks
                    .into_iter()
                    .map(|hunk| RecomposeHunk {
                        id: hunk_id(&entry.path, &hunk),
                        hunk,
                    })
                    .collect(),
                path: entry.path,
                status: entry.status,
                binary: entry.parsed.binary,
                whole_file_only: entry.whole_file_only,
            })
            .collect(),
    })
}

type Atom = (usize, usize, u32);

fn hunk_atoms(file: usize, index: usize, hunk: &DiffHunk) -> impl Iterator<Item = Atom> + '_ {
    hunk.lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.kind != DiffLineKind::Context)
        .map(move |(line, _)| (file, index, line as u32))
}

fn file_atoms(file: usize, entry: &FileEntry) -> Vec<Atom> {
    if entry.parsed.hunks.is_empty() {
        return vec![(file, 0, 0)];
    }
    entry
        .parsed
        .hunks
        .iter()
        .enumerate()
        .flat_map(|(index, hunk)| hunk_atoms(file, index, hunk))
        .collect()
}

struct Catalog<'a> {
    files: &'a [FileEntry],
    by_path: HashMap<&'a str, usize>,
    hunks: HashMap<String, (usize, usize)>,
}

impl<'a> Catalog<'a> {
    fn new(files: &'a [FileEntry]) -> Self {
        let mut by_path = HashMap::new();
        let mut hunks = HashMap::new();
        for (file, entry) in files.iter().enumerate() {
            by_path.insert(entry.path.as_str(), file);
            for (index, hunk) in entry.parsed.hunks.iter().enumerate() {
                hunks.insert(hunk_id(&entry.path, hunk), (file, index));
            }
        }
        Self {
            files,
            by_path,
            hunks,
        }
    }

    fn hunk(&self, id: &str) -> Result<(usize, usize), CoreError> {
        let (file, index) = *self.hunks.get(id).ok_or_else(|| {
            CoreError::invalid_request(format!("{id} is not a hunk of the combined changes"))
        })?;
        if self.files[file].whole_file_only {
            return Err(CoreError::invalid_request(format!(
                "{} can only be selected as a whole file",
                self.files[file].path
            )));
        }
        Ok((file, index))
    }

    fn atoms(&self, change: &RecomposeChange) -> Result<BTreeSet<Atom>, CoreError> {
        match change {
            RecomposeChange::File { path } => {
                let file = *self.by_path.get(path.as_str()).ok_or_else(|| {
                    CoreError::invalid_request(format!(
                        "{path} is not part of the combined changes"
                    ))
                })?;
                Ok(file_atoms(file, &self.files[file]).into_iter().collect())
            }
            RecomposeChange::Hunk { id } => {
                let (file, index) = self.hunk(id)?;
                Ok(hunk_atoms(file, index, &self.files[file].parsed.hunks[index]).collect())
            }
            RecomposeChange::Lines { id, lines } => {
                let (file, index) = self.hunk(id)?;
                let hunk = &self.files[file].parsed.hunks[index];
                let mut atoms = BTreeSet::new();
                for line in lines {
                    let kind = hunk
                        .lines
                        .get(*line as usize)
                        .map(|line| line.kind)
                        .ok_or_else(|| {
                            CoreError::invalid_request(format!(
                                "line {line} is past the end of the hunk {id}"
                            ))
                        })?;
                    if kind != DiffLineKind::Context {
                        atoms.insert((file, index, *line));
                    }
                }
                if atoms.is_empty() {
                    return Err(CoreError::invalid_request(
                        "select at least one added or removed line",
                    ));
                }
                Ok(atoms)
            }
        }
    }
}

struct Assigned {
    message: String,
    atoms: BTreeSet<Atom>,
}

fn assign(files: &[FileEntry], groups: &[RecomposeGroup]) -> Result<Vec<Assigned>, CoreError> {
    if groups.is_empty() {
        return Err(CoreError::invalid_request(
            "add at least one commit to recompose into",
        ));
    }
    let catalog = Catalog::new(files);
    let mut assigned = Vec::new();
    let mut counts: HashMap<Atom, usize> = HashMap::new();
    for (position, group) in groups.iter().enumerate() {
        let message = valid_message(&group.message)?;
        if group.changes.is_empty() {
            return Err(CoreError::invalid_request(format!(
                "commit {} has no changes",
                position + 1
            )));
        }
        let mut atoms = BTreeSet::new();
        for change in &group.changes {
            atoms.extend(catalog.atoms(change)?);
        }
        for atom in &atoms {
            *counts.entry(*atom).or_default() += 1;
        }
        assigned.push(Assigned { message, atoms });
    }
    let mut unassigned = BTreeSet::new();
    let mut doubled = BTreeSet::new();
    for (file, entry) in files.iter().enumerate() {
        for atom in file_atoms(file, entry) {
            match counts.get(&atom) {
                None => unassigned.insert(entry.path.as_str()),
                Some(1) => false,
                Some(_) => doubled.insert(entry.path.as_str()),
            };
        }
    }
    let mut problems = Vec::new();
    if !unassigned.is_empty() {
        problems.push(format!(
            "changes not assigned to any commit: {}",
            unassigned.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if !doubled.is_empty() {
        problems.push(format!(
            "changes assigned to more than one commit: {}",
            doubled.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }
    if problems.is_empty() {
        Ok(assigned)
    } else {
        Err(CoreError::invalid_request(problems.join("; ")))
    }
}

fn renumbered(mut hunks: Vec<DiffHunk>) -> Vec<DiffHunk> {
    let mut delta = 0_i64;
    for hunk in &mut hunks {
        let old_first = i64::from(hunk.old_start) + i64::from(hunk.old_lines == 0);
        let new_first = old_first + delta;
        let start = if hunk.new_lines == 0 {
            new_first - 1
        } else {
            new_first
        };
        hunk.new_start = u32::try_from(start).unwrap_or_default();
        delta += i64::from(hunk.new_lines) - i64::from(hunk.old_lines);
    }
    hunks
}

fn partial_header(entry: &FileEntry) -> String {
    if entry.status != FileStatus::Deleted {
        return entry.parsed.header.clone();
    }
    entry
        .parsed
        .header
        .lines()
        .filter(|line| !line.starts_with("deleted file mode"))
        .map(|line| {
            if line == "+++ /dev/null" {
                format!("+++ b/{}\n", entry.path)
            } else {
                format!("{line}\n")
            }
        })
        .collect()
}

fn partial_patch(
    entry: &FileEntry,
    file: usize,
    selected: &BTreeSet<Atom>,
) -> Result<String, CoreError> {
    let mut hunks = Vec::new();
    for (index, hunk) in entry.parsed.hunks.iter().enumerate() {
        let lines: Vec<u32> = selected
            .range((file, index, 0)..=(file, index, u32::MAX))
            .map(|(_, _, line)| *line)
            .collect();
        if !lines.is_empty() {
            hunks.push(stage::select_staged_lines(hunk, &lines)?);
        }
    }
    let mut patch = partial_header(entry);
    for hunk in renumbered(hunks) {
        patch.push_str(&diff::hunk_patch(&hunk));
    }
    Ok(patch)
}

fn stage_cumulative(
    root: &Path,
    base: &str,
    files: &[FileEntry],
    file: usize,
    cumulative: &BTreeSet<Atom>,
) -> Result<(), CoreError> {
    let entry = &files[file];
    let selected: BTreeSet<Atom> = cumulative
        .range((file, 0, 0)..(file + 1, 0, 0))
        .copied()
        .collect();
    let paths = [entry.path.clone()];
    if selected.len() == file_atoms(file, entry).len() {
        return git::run(root, &stage::with_paths(&["add", "--all"], &paths)).map(drop);
    }
    git::run(
        root,
        &stage::with_paths(&["reset", "--quiet", base], &paths),
    )?;
    let patch = partial_patch(entry, file, &selected)?;
    git::run_with_input(
        root,
        &["apply", "--cached", "--whitespace=nowarn", "-"],
        &patch,
    )
    .map(drop)
}

fn commit_groups(
    root: &Path,
    range: &Range,
    files: &[FileEntry],
    groups: &[Assigned],
) -> Result<String, CoreError> {
    git::run(root, &["reset", "--quiet", "--mixed", &range.base])?;
    let mut cumulative = BTreeSet::new();
    for group in groups {
        cumulative.extend(group.atoms.iter().copied());
        let touched: BTreeSet<usize> = group.atoms.iter().map(|(file, _, _)| *file).collect();
        for file in touched {
            stage_cumulative(root, &range.base, files, file, &cumulative)?;
        }
        commit::commit(root, &group.message, "", false)?;
    }
    let tree = |revision: &str| resolve(root, &format!("{revision}^{{tree}}"));
    if tree("HEAD")? != tree(&range.head)? {
        return Err(CoreError::invalid_request(
            "the regrouped commits do not add up to the original changes",
        ));
    }
    resolve(root, "HEAD")
}

pub fn recompose_apply(
    path: &Path,
    base: &str,
    groups: &[RecomposeGroup],
) -> Result<RecomposeResult, CoreError> {
    let root = repo::open(path)?;
    operation::require_settled(&root)?;
    let range = read_range(&root, base)?;
    reject_merges(&range)?;
    if undo::tracked_changes(&root)? {
        return Err(CoreError::LocalChanges {
            detail: "Recompose needs a clean working tree and index; commit or stash your changes first."
                .to_owned(),
        });
    }
    let files = combined_diff(&root, &range)?;
    if files.is_empty() {
        return Err(CoreError::invalid_request(format!(
            "there are no changes between {} and HEAD",
            short(&range.base)
        )));
    }
    let assigned = assign(&files, groups)?;
    let pushed = !pushed_commits(&root, &range)?.is_empty();
    snapshots::capture(
        &root,
        Action::Recompose,
        &format!(
            "Recompose {} commit(s) above {}",
            range.commits.len(),
            short(&range.base)
        ),
        None,
    )?;
    match commit_groups(&root, &range, &files, &assigned) {
        Ok(head) => Ok(RecomposeResult { head, pushed }),
        Err(error) => {
            git::run(&root, &["reset", "--quiet", "--hard", &range.head])?;
            Err(error)
        }
    }
}
