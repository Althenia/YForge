use std::path::Path;

use crate::error::CoreError;
use crate::file_view::FILE_VIEW_LIMIT;
use crate::git;
use crate::model::{ChangeArea, DiffHunk, DiffLine, DiffLineKind, FileDiff};
use crate::repo;

const COMMAND: &str = "git diff";

const DIFF_FLAGS: [&str; 8] = [
    "--literal-pathspecs",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=3",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedDiff {
    pub header: String,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

fn invalid(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_output(COMMAND, detail)
}

fn parse_range(range: &str) -> Option<(u32, u32)> {
    match range.split_once(',') {
        Some((start, count)) => Some((start.parse().ok()?, count.parse().ok()?)),
        None => Some((range.parse().ok()?, 1)),
    }
}

fn parse_hunk_header(line: &str) -> Result<DiffHunk, CoreError> {
    let malformed = || invalid(format!("malformed hunk header {line:?}"));
    let rest = line.strip_prefix("@@ -").ok_or_else(malformed)?;
    let (ranges, heading) = rest.split_once(" @@").ok_or_else(malformed)?;
    let (old, new) = ranges.split_once(" +").ok_or_else(malformed)?;
    let (old_start, old_lines) = parse_range(old).ok_or_else(malformed)?;
    let (new_start, new_lines) = parse_range(new).ok_or_else(malformed)?;
    Ok(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        heading: heading.strip_prefix(' ').unwrap_or(heading).to_owned(),
        lines: Vec::new(),
    })
}

fn push_line(hunk: &mut DiffHunk, cursor: &mut (u32, u32), line: &str) -> Result<(), CoreError> {
    let mut chars = line.chars();
    let marker = chars.next();
    let text = chars.as_str().to_owned();
    let (old_next, new_next) = *cursor;
    let (kind, old_number, new_number) = match marker {
        Some(' ') => (DiffLineKind::Context, Some(old_next), Some(new_next)),
        Some('-') => (DiffLineKind::Removed, Some(old_next), None),
        Some('+') => (DiffLineKind::Added, None, Some(new_next)),
        Some('\\') => {
            let last = hunk
                .lines
                .last_mut()
                .ok_or_else(|| invalid("no-newline marker before any line"))?;
            last.no_newline = true;
            return Ok(());
        }
        _ => return Err(invalid(format!("unexpected line in hunk {line:?}"))),
    };
    *cursor = (
        old_next + u32::from(old_number.is_some()),
        new_next + u32::from(new_number.is_some()),
    );
    hunk.lines.push(DiffLine {
        kind,
        old_number,
        new_number,
        text,
        no_newline: false,
    });
    Ok(())
}

fn verify_counts(hunk: &DiffHunk) -> Result<(), CoreError> {
    let count = |excluded: DiffLineKind| {
        hunk.lines
            .iter()
            .filter(|line| line.kind != excluded)
            .count() as u32
    };
    if count(DiffLineKind::Added) != hunk.old_lines
        || count(DiffLineKind::Removed) != hunk.new_lines
    {
        return Err(invalid(format!(
            "hunk -{},{} +{},{} does not match its {} lines",
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines,
            hunk.lines.len()
        )));
    }
    Ok(())
}

pub(crate) fn parse_diff(output: &str) -> Result<ParsedDiff, CoreError> {
    let mut lines: Vec<&str> = output.split('\n').collect();
    if lines.last() == Some(&"") {
        lines.pop();
    }
    let first_hunk = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .unwrap_or(lines.len());
    let (header_lines, hunk_lines) = lines.split_at(first_hunk);
    let binary = header_lines
        .iter()
        .any(|line| line.starts_with("Binary files ") || *line == "GIT binary patch");
    let header = header_lines
        .iter()
        .map(|line| format!("{line}\n"))
        .collect::<String>();
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut cursor = (0, 0);
    for line in hunk_lines {
        if line.starts_with("@@ ") {
            let hunk = parse_hunk_header(line)?;
            cursor = (hunk.old_start, hunk.new_start);
            hunks.push(hunk);
        } else {
            let hunk = hunks
                .last_mut()
                .ok_or_else(|| invalid("line before the first hunk"))?;
            push_line(hunk, &mut cursor, line)?;
        }
    }
    hunks.iter().try_for_each(verify_counts)?;
    Ok(ParsedDiff {
        header,
        binary,
        hunks,
    })
}

pub(crate) fn hunk_patch(hunk: &DiffHunk) -> String {
    let heading = if hunk.heading.is_empty() {
        String::new()
    } else {
        format!(" {}", hunk.heading)
    };
    let mut patch = format!(
        "@@ -{},{} +{},{} @@{heading}\n",
        hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
    );
    for line in &hunk.lines {
        patch.push(match line.kind {
            DiffLineKind::Context => ' ',
            DiffLineKind::Added => '+',
            DiffLineKind::Removed => '-',
        });
        patch.push_str(&line.text);
        patch.push('\n');
        if line.no_newline {
            patch.push_str("\\ No newline at end of file\n");
        }
    }
    patch
}

fn staged_original(root: &Path, file: &str) -> Result<Option<String>, CoreError> {
    Ok(repo::read_status(root)?
        .files
        .into_iter()
        .find(|change| change.path == file && change.area == ChangeArea::Staged)
        .and_then(|change| change.original_path))
}

pub(crate) fn read_file_diff(
    root: &Path,
    file: &str,
    area: ChangeArea,
    detect_renames: bool,
    ignore_whitespace: bool,
) -> Result<(ParsedDiff, Option<String>), CoreError> {
    let mut args: Vec<&str> = DIFF_FLAGS.to_vec();
    if ignore_whitespace {
        args.push("-w");
    }
    let mut original = None;
    match area {
        ChangeArea::Unstaged => args.extend(["--no-renames", "--", file]),
        ChangeArea::Staged => {
            original = if detect_renames {
                staged_original(root, file)?
            } else {
                None
            };
            args.extend([
                "--cached",
                if original.is_some() {
                    "-M"
                } else {
                    "--no-renames"
                },
                "--",
            ]);
            args.extend(original.as_deref());
            args.push(file);
        }
        ChangeArea::Untracked => args.extend(["--no-index", "--", "/dev/null", file]),
        ChangeArea::Conflicted => {
            let conflicted = repo::read_status(root)?
                .files
                .iter()
                .any(|change| change.path == file && change.area == ChangeArea::Conflicted);
            if !conflicted {
                return Err(CoreError::invalid_request(format!(
                    "{file} is not conflicted"
                )));
            }
            args.extend(["--no-index", "--", "/dev/null", file]);
        }
    }
    let allowed: &[i32] = if matches!(area, ChangeArea::Untracked | ChangeArea::Conflicted) {
        &[0, 1]
    } else {
        &[0]
    };
    let output = git::run_allowing(root, &args, allowed)?;
    Ok((parse_diff(&output)?, original))
}

pub(crate) fn read_commit_diff(
    root: &Path,
    base: &str,
    sha: &str,
    file: &str,
    original: Option<&str>,
    ignore_whitespace: bool,
) -> Result<ParsedDiff, CoreError> {
    let mut args: Vec<&str> = DIFF_FLAGS.to_vec();
    if ignore_whitespace {
        args.push("-w");
    }
    args.extend(["-M", base, sha, "--"]);
    args.extend(original);
    args.push(file);
    parse_diff(&git::run(root, &args)?)
}

pub(crate) fn read_worktree_diff(
    root: &Path,
    base: &str,
    file: &str,
    original: Option<&str>,
) -> Result<ParsedDiff, CoreError> {
    let mut args: Vec<&str> = DIFF_FLAGS.to_vec();
    args.extend([
        if original.is_some() {
            "-M"
        } else {
            "--no-renames"
        },
        base,
        "--",
    ]);
    args.extend(original);
    args.push(file);
    parse_diff(&git::run(root, &args)?)
}

pub(crate) fn read_index_diff(
    root: &Path,
    base: &str,
    file: &str,
    original: Option<&str>,
) -> Result<ParsedDiff, CoreError> {
    let mut args: Vec<&str> = DIFF_FLAGS.to_vec();
    args.extend([
        "--cached",
        if original.is_some() {
            "-M"
        } else {
            "--no-renames"
        },
        base,
        "--",
    ]);
    args.extend(original);
    args.push(file);
    parse_diff(&git::run(root, &args)?)
}

fn blob_size(root: &Path, spec: &str) -> Result<Option<u64>, CoreError> {
    let completed = git::run_unchecked(root, &["cat-file", "-s", spec], None)?;
    Ok(completed
        .succeeded()
        .then(|| completed.stdout.trim().parse().ok())
        .flatten())
}

fn worktree_size(root: &Path, file: &str) -> Option<u64> {
    std::fs::symlink_metadata(root.join(file))
        .ok()
        .filter(std::fs::Metadata::is_file)
        .map(|metadata| metadata.len())
}

pub(crate) fn hunks_text_size(hunks: &[DiffHunk]) -> u64 {
    hunks
        .iter()
        .flat_map(|hunk| &hunk.lines)
        .map(|line| line.text.len() as u64 + 1)
        .sum()
}

fn within_view_limit(file: &str, diff: FileDiff) -> Result<FileDiff, CoreError> {
    let size = hunks_text_size(&diff.hunks);
    if size > FILE_VIEW_LIMIT {
        return Err(CoreError::FileTooLarge {
            file: file.to_owned(),
            size,
            limit: FILE_VIEW_LIMIT,
        });
    }
    Ok(diff)
}

pub(crate) fn diff_between(
    root: &Path,
    base: &str,
    target: &str,
    file: &str,
    original: Option<&str>,
    ignore_whitespace: bool,
) -> Result<FileDiff, CoreError> {
    let parsed = read_commit_diff(root, base, target, file, original, ignore_whitespace)?;
    let (old_size, new_size) = if parsed.binary {
        (
            blob_size(root, &format!("{base}:{}", original.unwrap_or(file)))?,
            blob_size(root, &format!("{target}:{file}"))?,
        )
    } else {
        (None, None)
    };
    within_view_limit(
        file,
        FileDiff {
            path: file.to_owned(),
            original_path: original.map(str::to_owned),
            binary: parsed.binary,
            old_size,
            new_size,
            hunks: parsed.hunks,
        },
    )
}

fn working_sizes(
    root: &Path,
    area: ChangeArea,
    file: &str,
    original: Option<&str>,
) -> Result<(Option<u64>, Option<u64>), CoreError> {
    Ok(match area {
        ChangeArea::Unstaged => (
            blob_size(root, &format!(":0:{file}"))?,
            worktree_size(root, file),
        ),
        ChangeArea::Staged => (
            blob_size(root, &format!("HEAD:{}", original.unwrap_or(file)))?,
            blob_size(root, &format!(":0:{file}"))?,
        ),
        ChangeArea::Untracked | ChangeArea::Conflicted => (None, worktree_size(root, file)),
    })
}

pub fn diff_file(
    path: &Path,
    file: &str,
    area: ChangeArea,
    ignore_whitespace: bool,
) -> Result<FileDiff, CoreError> {
    within_view_limit(
        file,
        diff_file_unbounded(path, file, area, ignore_whitespace)?,
    )
}

pub(crate) fn diff_file_unbounded(
    path: &Path,
    file: &str,
    area: ChangeArea,
    ignore_whitespace: bool,
) -> Result<FileDiff, CoreError> {
    let root = repo::open(path)?;
    repo::check_paths(&[file])?;
    let (parsed, original_path) = read_file_diff(&root, file, area, true, ignore_whitespace)?;
    let (old_size, new_size) = if parsed.binary {
        working_sizes(&root, area, file, original_path.as_deref())?
    } else {
        (None, None)
    };
    Ok(FileDiff {
        path: file.to_owned(),
        original_path,
        binary: parsed.binary,
        old_size,
        new_size,
        hunks: parsed.hunks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT_DIFF: &str = "diff --git a/f.txt b/f.txt\nindex 111..222 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@ fn main\n one\n-two\n+2\n three\n@@ -10 +10,2 @@\n-ten\n\\ No newline at end of file\n+10\n+11\n";

    #[test]
    fn parses_headers_ranges_headings_and_line_numbers() {
        let parsed = parse_diff(TEXT_DIFF).unwrap();

        assert!(!parsed.binary);
        assert!(parsed.header.starts_with("diff --git a/f.txt b/f.txt\n"));
        assert!(parsed.header.ends_with("+++ b/f.txt\n"));
        assert_eq!(parsed.hunks.len(), 2);
        let first = &parsed.hunks[0];
        assert_eq!(
            (
                first.old_start,
                first.old_lines,
                first.new_start,
                first.new_lines
            ),
            (1, 3, 1, 3)
        );
        assert_eq!(first.heading, "fn main");
        let numbers: Vec<(Option<u32>, Option<u32>)> = first
            .lines
            .iter()
            .map(|line| (line.old_number, line.new_number))
            .collect();
        assert_eq!(
            numbers,
            vec![
                (Some(1), Some(1)),
                (Some(2), None),
                (None, Some(2)),
                (Some(3), Some(3))
            ]
        );
        let second = &parsed.hunks[1];
        assert_eq!(
            (
                second.old_start,
                second.old_lines,
                second.new_start,
                second.new_lines
            ),
            (10, 1, 10, 2)
        );
        assert!(second.lines[0].no_newline);
        assert!(!second.lines[1].no_newline);
    }

    #[test]
    fn keeps_carriage_returns_in_line_text() {
        let parsed = parse_diff("@@ -1 +1 @@\n-a\r\n+b\r\n").unwrap();
        assert_eq!(parsed.hunks[0].lines[0].text, "a\r");
        assert_eq!(parsed.hunks[0].lines[1].text, "b\r");
    }

    #[test]
    fn detects_binary_files_and_empty_diffs() {
        let binary = parse_diff("diff --git a/i.png b/i.png\nindex 1..2 100644\nBinary files a/i.png and b/i.png differ\n").unwrap();
        assert!(binary.binary);
        assert!(binary.hunks.is_empty());
        let empty = parse_diff("").unwrap();
        assert!(!empty.binary && empty.hunks.is_empty() && empty.header.is_empty());
    }

    #[test]
    fn rebuilds_a_hunk_as_an_applicable_patch_body() {
        let parsed = parse_diff(TEXT_DIFF).unwrap();
        assert_eq!(
            hunk_patch(&parsed.hunks[0]),
            "@@ -1,3 +1,3 @@ fn main\n one\n-two\n+2\n three\n"
        );
        assert_eq!(
            hunk_patch(&parsed.hunks[1]),
            "@@ -10,1 +10,2 @@\n-ten\n\\ No newline at end of file\n+10\n+11\n"
        );
    }

    #[test]
    fn rejects_malformed_and_inconsistent_hunks() {
        assert!(parse_diff("@@ nonsense\n").is_err());
        assert!(parse_diff("@@ -1,2 +1,2 @@\n one\n").is_err());
        assert!(parse_diff("@@ -1 +1 @@\n?bad\n").is_err());
        assert!(parse_diff("@@ -1 +1 @@\n\\ No newline at end of file\n").is_err());
    }
}
