use std::collections::BTreeMap;
use std::path::Path;

use crate::commit;
use crate::error::CoreError;
use crate::git;
use crate::git::CancelToken;
use crate::model::{ChangeArea, DiffHunk, DiffLineKind, FileChange, FileStatus};
use crate::pull_request::BranchComparison;
use crate::undo::head_sha;
use crate::{diff, repo};

const TOTAL_BUDGET: usize = 60 * 1024;
const FILE_BUDGET: usize = 20 * 1024;
const RECENT_SUBJECTS: &str = "--max-count=10";
const MIN_USEFUL_BUDGET: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitContext {
    pub diff: String,
    pub recent_subjects: Vec<String>,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangesContext {
    pub message: Option<String>,
    pub diff: String,
    pub files: Vec<String>,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestContext {
    pub comparison: BranchComparison,
    pub commit_messages: Vec<String>,
    pub diff: String,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

pub fn pull_request_context(
    path: &Path,
    source: &str,
    target: &str,
    cancel: &CancelToken,
) -> Result<PullRequestContext, CoreError> {
    git::local_read(Some(cancel), || {
        read_pull_request_context(path, source, target, cancel)
    })
}

fn read_pull_request_context(
    path: &Path,
    source: &str,
    target: &str,
    cancel: &CancelToken,
) -> Result<PullRequestContext, CoreError> {
    if cancel.is_cancelled() {
        return Err(CoreError::Cancelled);
    }
    let comparison = crate::branch_comparison(path, source, target)?;
    if comparison.commits.is_empty() {
        return Err(CoreError::invalid_request(
            "the source has no commits that the target lacks",
        ));
    }
    let root = repo::open(path)?;
    let range = format!("{}..{}", comparison.target, comparison.source);
    let messages = git::run(
        &root,
        &[
            "log",
            "--no-show-signature",
            "-z",
            "--format=%B",
            &range,
            "--",
        ],
    )?;
    let entries: Vec<Entry> =
        commit::commit_files(&root, &comparison.merge_base, &comparison.source)?
            .into_iter()
            .map(|file| Entry {
                path: file.path,
                original: file.original_path,
                status: file.status,
                untracked: false,
            })
            .collect();
    refuse_secret_only(&entries, "compared")?;
    let rendered = render_entries(&entries, |entry| {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let parsed = diff::read_commit_diff(
            &root,
            &comparison.merge_base,
            &comparison.source,
            &entry.path,
            entry.original.as_deref(),
            false,
        )?;
        Ok((parsed.binary, parsed.hunks))
    })?;
    if cancel.is_cancelled() {
        return Err(CoreError::Cancelled);
    }
    Ok(PullRequestContext {
        comparison,
        commit_messages: messages
            .trim_end_matches('\0')
            .split('\0')
            .map(|message| message.trim().to_owned())
            .collect(),
        diff: rendered.diff,
        excluded: rendered.excluded,
        truncated: rendered.truncated,
    })
}

struct Rendered {
    diff: String,
    excluded: Vec<String>,
    truncated: Vec<String>,
}

struct Entry {
    path: String,
    original: Option<String>,
    status: FileStatus,
    untracked: bool,
}

impl From<&FileChange> for Entry {
    fn from(change: &FileChange) -> Self {
        Self {
            path: change.path.clone(),
            original: change.original_path.clone(),
            status: change.status,
            untracked: change.area == ChangeArea::Untracked,
        }
    }
}

pub fn is_secret_file(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    name.starts_with(".env")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.starts_with("id_rsa")
        || name.starts_with("credentials")
}

pub fn status_word(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Modified => "modified",
        FileStatus::Added => "added",
        FileStatus::Deleted => "deleted",
        FileStatus::Renamed => "renamed",
        FileStatus::Copied => "copied",
        FileStatus::TypeChanged => "type changed",
        FileStatus::Untracked => "untracked",
        FileStatus::Conflicted => "conflicted",
    }
}

pub fn render_hunk(hunk: &DiffHunk) -> String {
    let mut text = format!(
        "@@ -{},{} +{},{} @@{}\n",
        hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines, hunk.heading
    );
    for line in &hunk.lines {
        text.push(match line.kind {
            DiffLineKind::Context => ' ',
            DiffLineKind::Added => '+',
            DiffLineKind::Removed => '-',
        });
        text.push_str(&line.text);
        text.push('\n');
        if line.no_newline {
            text.push_str("\\ No newline at end of file\n");
        }
    }
    text
}

pub fn cut_at_line(text: &str, limit: usize) -> (&str, usize) {
    if text.len() <= limit {
        return (text, 0);
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let end = text[..end].rfind('\n').map_or(0, |newline| newline + 1);
    (&text[..end], text.len() - end)
}

fn heading(entry: &Entry, note: &str) -> String {
    let origin = entry
        .original
        .as_deref()
        .map(|from| format!(" from {from}"))
        .unwrap_or_default();
    format!(
        "=== {} ({}{origin}{note}) ===\n",
        entry.path,
        status_word(entry.status)
    )
}

fn render_entries(
    entries: &[Entry],
    mut read: impl FnMut(&Entry) -> Result<(bool, Vec<DiffHunk>), CoreError>,
) -> Result<Rendered, CoreError> {
    let mut rendered = Rendered {
        diff: String::new(),
        excluded: Vec::new(),
        truncated: Vec::new(),
    };
    for entry in entries {
        if is_secret_file(&entry.path) || entry.original.as_deref().is_some_and(is_secret_file) {
            rendered.excluded.push(entry.path.clone());
            rendered
                .diff
                .push_str(&heading(entry, ", content withheld: secret file"));
            continue;
        }
        let (binary, hunks) = read(entry)?;
        if binary {
            rendered
                .diff
                .push_str(&heading(entry, ", binary: content not shown"));
            continue;
        }
        rendered.diff.push_str(&heading(entry, ""));
        let body: String = hunks.iter().map(render_hunk).collect();
        let remaining = TOTAL_BUDGET.saturating_sub(rendered.diff.len());
        if remaining < MIN_USEFUL_BUDGET {
            rendered
                .diff
                .push_str("[diff omitted: size budget reached]\n");
            rendered.truncated.push(entry.path.clone());
            continue;
        }
        let (kept, omitted) = cut_at_line(&body, FILE_BUDGET.min(remaining));
        rendered.diff.push_str(kept);
        if omitted > 0 {
            rendered
                .diff
                .push_str(&format!("[diff truncated: {omitted} bytes omitted]\n"));
            rendered.truncated.push(entry.path.clone());
        }
    }
    Ok(rendered)
}

fn refuse_secret_only(entries: &[Entry], what: &str) -> Result<(), CoreError> {
    if entries.iter().all(|entry| is_secret_file(&entry.path)) {
        return Err(CoreError::invalid_request(format!(
            "every {what} file is withheld from AI as a secret file"
        )));
    }
    Ok(())
}

fn recent_subjects(root: &Path) -> Vec<String> {
    git::run_unchecked(root, &["log", RECENT_SUBJECTS, "--format=%s"], None)
        .ok()
        .filter(git::Completed::succeeded)
        .map(|completed| {
            completed
                .stdout
                .lines()
                .map(str::trim)
                .filter(|subject| !subject.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub fn commit_context(path: &Path) -> Result<CommitContext, CoreError> {
    let root = repo::open(path)?;
    let staged: Vec<Entry> = repo::read_status(&root)?
        .files
        .iter()
        .filter(|change| change.area == ChangeArea::Staged)
        .map(Entry::from)
        .collect();
    if staged.is_empty() {
        return Err(CoreError::invalid_request("nothing is staged to describe"));
    }
    refuse_secret_only(&staged, "staged")?;
    let rendered = render_entries(&staged, |entry| {
        let file_diff = diff::diff_file_unbounded(&root, &entry.path, ChangeArea::Staged, false)?;
        Ok((file_diff.binary, file_diff.hunks))
    })?;
    Ok(CommitContext {
        diff: rendered.diff,
        recent_subjects: recent_subjects(&root),
        excluded: rendered.excluded,
        truncated: rendered.truncated,
    })
}

pub fn amend_commit_context(path: &Path) -> Result<CommitContext, CoreError> {
    let root = repo::open(path)?;
    let head = head_sha(&root)?
        .ok_or_else(|| CoreError::invalid_request("there is no commit to amend"))?;
    let details = commit::commit_details(&root, &head)?;
    let base = match details.parents.first() {
        Some(parent) => parent.clone(),
        None => commit::empty_tree(&root)?,
    };
    let raw = git::run(
        &root,
        &[
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            "--raw",
            "-z",
            &base,
        ],
    )?;
    let entries: Vec<Entry> = commit::parse_raw(&raw)?
        .into_iter()
        .map(|(status, path, original)| Entry {
            path,
            original,
            status,
            untracked: false,
        })
        .collect();
    if entries.is_empty() {
        return Err(CoreError::invalid_request(
            "the amended commit changes no files",
        ));
    }
    refuse_secret_only(&entries, "amended")?;
    let rendered = render_entries(&entries, |entry| {
        let parsed = diff::read_index_diff(&root, &base, &entry.path, entry.original.as_deref())?;
        Ok((parsed.binary, parsed.hunks))
    })?;
    Ok(CommitContext {
        diff: rendered.diff,
        recent_subjects: recent_subjects(&root),
        excluded: rendered.excluded,
        truncated: rendered.truncated,
    })
}

fn area_rank(area: ChangeArea) -> u8 {
    match area {
        ChangeArea::Staged => 0,
        ChangeArea::Conflicted => 1,
        ChangeArea::Unstaged => 2,
        ChangeArea::Untracked => 3,
    }
}

fn working_entries(root: &Path) -> Result<Vec<Entry>, CoreError> {
    let mut chosen: BTreeMap<String, FileChange> = BTreeMap::new();
    for change in repo::read_status(root)?.files {
        let keep = chosen
            .get(&change.path)
            .is_none_or(|kept| area_rank(change.area) < area_rank(kept.area));
        if keep {
            chosen.insert(change.path.clone(), change);
        }
    }
    Ok(chosen.values().map(Entry::from).collect())
}

/// Everything uncommitted in the working tree (staged, unstaged, and untracked) as one
/// diff per file against HEAD, with secret files withheld and large diffs cut.
pub fn working_changes_context(path: &Path) -> Result<ChangesContext, CoreError> {
    let root = repo::open(path)?;
    let entries = working_entries(&root)?;
    if entries.is_empty() {
        return Err(CoreError::invalid_request(
            "there are no uncommitted changes",
        ));
    }
    refuse_secret_only(&entries, "changed")?;
    let base = match head_sha(&root)? {
        Some(head) => head,
        None => commit::empty_tree(&root)?,
    };
    let rendered = render_entries(&entries, |entry| {
        let parsed = if entry.untracked {
            diff::read_file_diff(&root, &entry.path, ChangeArea::Untracked, false, false)?.0
        } else {
            diff::read_worktree_diff(&root, &base, &entry.path, entry.original.as_deref())?
        };
        Ok((parsed.binary, parsed.hunks))
    })?;
    Ok(ChangesContext {
        message: None,
        diff: rendered.diff,
        files: entries.into_iter().map(|entry| entry.path).collect(),
        excluded: rendered.excluded,
        truncated: rendered.truncated,
    })
}

/// The message of commit `sha` and its diff against its first parent, one file at a time,
/// with secret files withheld and large diffs cut.
pub fn commit_changes_context(path: &Path, sha: &str) -> Result<ChangesContext, CoreError> {
    let root = repo::open(path)?;
    let details = commit::commit_details(&root, sha)?;
    let entries: Vec<Entry> = details
        .files
        .iter()
        .map(|file| Entry {
            path: file.path.clone(),
            original: file.original_path.clone(),
            status: file.status,
            untracked: false,
        })
        .collect();
    if entries.is_empty() {
        return Err(CoreError::invalid_request("this commit changes no files"));
    }
    refuse_secret_only(&entries, "changed")?;
    let base = match details.parents.first() {
        Some(parent) => parent.clone(),
        None => commit::empty_tree(&root)?,
    };
    let rendered = render_entries(&entries, |entry| {
        let parsed = diff::read_commit_diff(
            &root,
            &base,
            &details.sha,
            &entry.path,
            entry.original.as_deref(),
            false,
        )?;
        Ok((parsed.binary, parsed.hunks))
    })?;
    let message = if details.body.is_empty() {
        details.summary.clone()
    } else {
        format!("{}\n\n{}", details.summary, details.body)
    };
    Ok(ChangesContext {
        message: Some(message),
        diff: rendered.diff,
        files: entries.into_iter().map(|entry| entry.path).collect(),
        excluded: rendered.excluded,
        truncated: rendered.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_patterns_match_the_basename_case_insensitively() {
        for secret in [
            ".env",
            ".env.local",
            "config/.ENV.production",
            "certs/server.pem",
            "a/b/Private.KEY",
            "id_rsa",
            "home/id_rsa.pub",
            "credentials.json",
            "aws/Credentials",
        ] {
            assert!(is_secret_file(secret), "{secret} should be withheld");
        }
        for plain in [
            "src/environment.rs",
            "keys.md",
            "docs/env.md",
            "monkey.txt",
            "id_ed25519",
            "src/credentials/mod.rs",
        ] {
            assert!(!is_secret_file(plain), "{plain} should be sent");
        }
    }

    #[test]
    fn cuts_on_a_line_boundary_and_reports_the_omitted_bytes() {
        assert_eq!(
            cut_at_line("one\ntwo\nthree\n", 100),
            ("one\ntwo\nthree\n", 0)
        );
        assert_eq!(cut_at_line("one\ntwo\nthree\n", 9), ("one\ntwo\n", 6));
        assert_eq!(cut_at_line("aé\nbb\n", 2), ("", 7));
    }
}
