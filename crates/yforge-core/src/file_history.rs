use std::collections::HashMap;
use std::path::Path;

use crate::commit::{self, validate_sha};
use crate::diff;
use crate::error::CoreError;
use crate::git;
use crate::model::{BlameRun, FileRevision, FileStatus};
use crate::repo;
use crate::undo::head_sha;

const LOG_COMMAND: &str = "git log --follow";
const BLAME_COMMAND: &str = "git blame --porcelain";
const LOG_FORMAT: &str = "--format=%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%s";
const RECORD: char = '\u{1e}';
const FIELD: char = '\u{1f}';
const MODE_LINES: [&str; 2] = ["old mode ", "new mode "];

fn short(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn parse_time(command: &str, time: &str) -> Result<i64, CoreError> {
    time.parse()
        .map_err(|_| CoreError::invalid_output(command, format!("malformed time {time:?}")))
}

fn parse_history(output: &str, file: &str) -> Result<Vec<FileRevision>, CoreError> {
    let mut revisions = Vec::new();
    let mut current = file.to_owned();
    for record in output
        .split(RECORD)
        .filter(|record| !record.trim().is_empty())
    {
        let (header, changes) = record.split_once('\0').unwrap_or((record, ""));
        let fields: Vec<&str> = header.splitn(5, FIELD).collect();
        let [sha, author, email, time, summary] = fields[..] else {
            return Err(CoreError::invalid_output(
                LOG_COMMAND,
                format!("malformed record {header:?}"),
            ));
        };
        let mut parts = changes
            .split('\0')
            .map(|part| part.trim_start_matches('\n'))
            .filter(|part| !part.is_empty());
        let status = match parts.next().and_then(|letters| letters.chars().next()) {
            Some(letter) => commit::status_of(letter)?,
            None => FileStatus::Modified,
        };
        if let Some(path) = parts.next_back() {
            path.clone_into(&mut current);
        }
        revisions.push(FileRevision {
            sha: sha.to_owned(),
            short: short(sha),
            summary: summary.to_owned(),
            author: author.to_owned(),
            email: email.to_owned(),
            time: parse_time(LOG_COMMAND, time)?,
            path: current.clone(),
            status,
        });
    }
    Ok(revisions)
}

/// Every commit that changed `file`, newest first, following renames.
pub fn file_history(path: &Path, file: &str) -> Result<Vec<FileRevision>, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    if head_sha(&root)?.is_none() {
        return Ok(Vec::new());
    }
    let output = git::run(
        &root,
        &[
            "--literal-pathspecs",
            "log",
            "--follow",
            "-M",
            "--diff-merges=first-parent",
            "--no-show-signature",
            LOG_FORMAT,
            "--name-status",
            "-z",
            "--",
            file,
        ],
    )?;
    parse_history(&output, file)
}

#[derive(Default)]
struct Origin {
    author: String,
    email: String,
    time: i64,
    summary: String,
}

fn malformed_blame(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_output(BLAME_COMMAND, detail)
}

fn parse_blame_header(line: &str) -> Result<(String, u32), CoreError> {
    let mut fields = line.split(' ');
    let sha = fields.next().filter(|sha| validate_sha(sha).is_ok());
    let number = fields.nth(1).and_then(|number| number.parse().ok());
    match (sha, number) {
        (Some(sha), Some(number)) => Ok((sha.to_owned(), number)),
        _ => Err(malformed_blame(format!("malformed header {line:?}"))),
    }
}

fn parse_blame(output: &str) -> Result<Vec<BlameRun>, CoreError> {
    let mut origins: HashMap<String, Origin> = HashMap::new();
    let mut runs: Vec<BlameRun> = Vec::new();
    let mut current: Option<(String, u32)> = None;
    for line in output.split('\n') {
        if let Some(text) = line.strip_prefix('\t') {
            let (sha, number) = current
                .take()
                .ok_or_else(|| malformed_blame("a line without a header"))?;
            let origin = &origins[&sha];
            match runs.last_mut() {
                Some(run)
                    if run.sha == sha
                        && run.start as usize + run.lines.len() == number as usize =>
                {
                    run.lines.push(text.to_owned());
                }
                _ => runs.push(BlameRun {
                    short: short(&sha),
                    author: origin.author.clone(),
                    email: origin.email.clone(),
                    time: origin.time,
                    summary: origin.summary.clone(),
                    start: number,
                    lines: vec![text.to_owned()],
                    sha,
                }),
            }
            continue;
        }
        let Some((sha, _)) = &current else {
            if !line.is_empty() {
                let header = parse_blame_header(line)?;
                origins.entry(header.0.clone()).or_default();
                current = Some(header);
            }
            continue;
        };
        let origin = origins.entry(sha.clone()).or_default();
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        match key {
            "author" => value.clone_into(&mut origin.author),
            "author-mail" => {
                value
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .clone_into(&mut origin.email);
            }
            "author-time" => origin.time = parse_time(BLAME_COMMAND, value)?,
            "summary" => value.clone_into(&mut origin.summary),
            _ => {}
        }
    }
    Ok(runs)
}

/// The commit that last changed each line of `file` at `revision` (HEAD when absent),
/// with consecutive lines from one commit merged into one run.
pub fn file_blame(
    path: &Path,
    file: &str,
    revision: Option<&str>,
) -> Result<Vec<BlameRun>, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let revision = match revision {
        Some(sha) => {
            validate_sha(sha)?;
            sha
        }
        None => "HEAD",
    };
    let output = git::run(
        &root,
        &[
            "--literal-pathspecs",
            "blame",
            "--porcelain",
            revision,
            "--",
            file,
        ],
    )?;
    parse_blame(&output)
}

/// Every file path in the tree of commit `sha`, sorted.
pub fn commit_tree_paths(path: &Path, sha: &str) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    validate_sha(sha)?;
    let output = git::run(
        &root,
        &["ls-tree", "-r", "-z", "--name-only", "--full-tree", sha],
    )?;
    let mut paths: Vec<String> = output
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect();
    paths.sort();
    Ok(paths)
}

fn reversible_header(header: &str, file: &str, renamed: bool) -> String {
    if renamed {
        return format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n");
    }
    header
        .lines()
        .filter(|line| !MODE_LINES.iter().any(|mode| line.starts_with(mode)))
        .map(|line| format!("{line}\n"))
        .collect()
}

/// Applies the reverse of hunk `hunk` (0-based) of `file` in commit `sha` to the working
/// tree only, refusing when that hunk no longer applies.
pub fn revert_hunk(path: &Path, sha: &str, file: &str, hunk: u32) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let change = commit::file_in_commit(&root, sha, file)?;
    let short = short(&change.sha);
    let parsed = diff::read_commit_diff(
        &root,
        &change.base,
        &change.sha,
        file,
        change.original.as_deref(),
        false,
    )?;
    let chosen = usize::try_from(hunk)
        .ok()
        .and_then(|index| parsed.hunks.get(index))
        .ok_or_else(|| {
            CoreError::invalid_request(format!("{file} has no hunk {hunk} in {short}"))
        })?;
    let patch = format!(
        "{}{}",
        reversible_header(&parsed.header, file, change.original.is_some()),
        diff::hunk_patch(chosen)
    );
    let args = ["apply", "--reverse", "--whitespace=nowarn"];
    let check: Vec<&str> = args.iter().copied().chain(["--check", "-"]).collect();
    if !git::run_unchecked(&root, &check, Some(&patch))?.succeeded() {
        return Err(CoreError::HunkChangedAgain { short });
    }
    let apply: Vec<&str> = args.iter().copied().chain(["-"]).collect();
    git::run_with_input(&root, &apply, &patch).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_merge_record_without_changes_keeps_the_newer_path() {
        let output = "\u{1e}aaaa\u{1f}Yui\u{1f}y@x\u{1f}20\u{1f}Edit\0\nM\0new.txt\0\u{1e}bbbb\u{1f}Yui\u{1f}y@x\u{1f}10\u{1f}Merge\0\n";
        let revisions = parse_history(output, "new.txt").unwrap();
        assert_eq!(revisions.len(), 2);
        assert_eq!(revisions[1].path, "new.txt");
        assert_eq!(revisions[1].status, FileStatus::Modified);
        assert!(parse_history("\u{1e}aaaa\u{1f}x\0", "f").is_err());
    }

    #[test]
    fn mode_lines_are_dropped_and_renames_get_a_plain_header() {
        let header =
            "diff --git a/f b/f\nold mode 100644\nnew mode 100755\nindex 1..2\n--- a/f\n+++ b/f\n";
        assert_eq!(
            reversible_header(header, "f", false),
            "diff --git a/f b/f\nindex 1..2\n--- a/f\n+++ b/f\n"
        );
        assert_eq!(
            reversible_header(header, "g", true),
            "diff --git a/g b/g\n--- a/g\n+++ b/g\n"
        );
    }
}
