use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::model::{ChangeArea, DiffHunk, DiffLineKind, FileChange, FileDiff, FileStatus};
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

fn render_hunks(diff: &FileDiff) -> String {
    diff.hunks.iter().map(render_hunk).collect()
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

fn heading(change: &FileChange, note: &str) -> String {
    let origin = change
        .original_path
        .as_deref()
        .map(|from| format!(" from {from}"))
        .unwrap_or_default();
    format!(
        "=== {} ({}{origin}{note}) ===\n",
        change.path,
        status_word(change.status)
    )
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
    let staged: Vec<FileChange> = repo::read_status(&root)?
        .files
        .into_iter()
        .filter(|change| change.area == ChangeArea::Staged)
        .collect();
    if staged.is_empty() {
        return Err(CoreError::invalid_request("nothing is staged to describe"));
    }
    if staged.iter().all(|change| is_secret_file(&change.path)) {
        return Err(CoreError::invalid_request(
            "every staged file is withheld from AI as a secret file",
        ));
    }
    let mut context = CommitContext {
        diff: String::new(),
        recent_subjects: recent_subjects(&root),
        excluded: Vec::new(),
        truncated: Vec::new(),
    };
    for change in &staged {
        if is_secret_file(&change.path) {
            context.excluded.push(change.path.clone());
            context
                .diff
                .push_str(&heading(change, ", content withheld: secret file"));
            continue;
        }
        let file_diff = diff::diff_file_unbounded(&root, &change.path, ChangeArea::Staged, false)?;
        if file_diff.binary {
            context
                .diff
                .push_str(&heading(change, ", binary: content not shown"));
            continue;
        }
        context.diff.push_str(&heading(change, ""));
        let body = render_hunks(&file_diff);
        let remaining = TOTAL_BUDGET.saturating_sub(context.diff.len());
        let limit = FILE_BUDGET.min(remaining);
        if remaining < MIN_USEFUL_BUDGET {
            context
                .diff
                .push_str("[diff omitted: size budget reached]\n");
            context.truncated.push(change.path.clone());
            continue;
        }
        let (kept, omitted) = cut_at_line(&body, limit);
        context.diff.push_str(kept);
        if omitted > 0 {
            context
                .diff
                .push_str(&format!("[diff truncated: {omitted} bytes omitted]\n"));
            context.truncated.push(change.path.clone());
        }
    }
    Ok(context)
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
