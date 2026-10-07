use std::collections::HashMap;
use std::path::Path;

use crate::diff;
use crate::error::CoreError;
use crate::git;
use crate::graph;
use crate::model::{
    AmendInfo, CommitBrief, CommitDetails, CommitFile, FileDiff, FileStatus, MessageEdit, Signature,
};
use crate::operation;
use crate::refs;
use crate::repo;

const LOG_COMMAND: &str = "git log";
const RAW_COMMAND: &str = "git diff --raw";
const NUMSTAT_COMMAND: &str = "git diff --numstat";
const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%b";

struct RawCommit {
    sha: String,
    parents: Vec<String>,
    author: Signature,
    committer: Signature,
    summary: String,
    body: String,
}

pub(crate) fn validate_sha(sha: &str) -> Result<(), CoreError> {
    if (4..=64).contains(&sha.len()) && sha.chars().all(|letter| letter.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "{sha:?} is not a commit id"
        )))
    }
}

pub(crate) const BRIEF_FORMAT: &str = "--format=%H%x1f%s";

pub(crate) fn parse_briefs(output: &str) -> Result<Vec<CommitBrief>, CoreError> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            line.split_once('\u{1f}')
                .map(|(sha, summary)| CommitBrief {
                    sha: sha.to_owned(),
                    summary: summary.to_owned(),
                })
                .ok_or_else(|| {
                    CoreError::invalid_output(LOG_COMMAND, format!("malformed line {line:?}"))
                })
        })
        .collect()
}

fn signature(name: &str, email: &str, time: &str) -> Result<Signature, CoreError> {
    let time = time
        .parse::<i64>()
        .map_err(|_| CoreError::invalid_output(LOG_COMMAND, format!("malformed time {time:?}")))?;
    Ok(Signature {
        name: name.to_owned(),
        email: email.to_owned(),
        time,
    })
}

fn parse_commit(output: &str) -> Result<RawCommit, CoreError> {
    let fields: Vec<&str> = output.splitn(10, '\u{1f}').collect();
    let [sha, parents, author_name, author_email, author_time, committer_name, committer_email, committer_time, summary, body] =
        fields[..]
    else {
        return Err(CoreError::invalid_output(
            LOG_COMMAND,
            format!("expected 10 fields in {output:?}"),
        ));
    };
    Ok(RawCommit {
        sha: sha.to_owned(),
        parents: parents
            .split(' ')
            .filter(|parent| !parent.is_empty())
            .map(str::to_owned)
            .collect(),
        author: signature(author_name, author_email, author_time)?,
        committer: signature(committer_name, committer_email, committer_time)?,
        summary: summary.to_owned(),
        body: body.trim_end().to_owned(),
    })
}

fn read_commit(root: &Path, revision: &str) -> Result<RawCommit, CoreError> {
    let output = git::run(
        root,
        &[
            "log",
            "-1",
            "--no-show-signature",
            LOG_FORMAT,
            revision,
            "--",
        ],
    )?;
    parse_commit(&output)
}

pub(crate) fn empty_tree(root: &Path) -> Result<String, CoreError> {
    Ok(git::run(root, &["hash-object", "-t", "tree", "/dev/null"])?
        .trim()
        .to_owned())
}

fn diff_base(root: &Path, commit: &RawCommit) -> Result<String, CoreError> {
    match commit.parents.first() {
        Some(parent) => Ok(parent.clone()),
        None => empty_tree(root),
    }
}

pub(crate) fn status_of(letter: char) -> Result<FileStatus, CoreError> {
    Ok(match letter {
        'M' => FileStatus::Modified,
        'A' => FileStatus::Added,
        'D' => FileStatus::Deleted,
        'R' => FileStatus::Renamed,
        'C' => FileStatus::Copied,
        'T' => FileStatus::TypeChanged,
        other => {
            return Err(CoreError::invalid_output(
                RAW_COMMAND,
                format!("unknown status letter {other:?}"),
            ))
        }
    })
}

pub(crate) fn parse_raw(
    output: &str,
) -> Result<Vec<(FileStatus, String, Option<String>)>, CoreError> {
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut entries = Vec::new();
    let missing = |field: &str| {
        CoreError::invalid_output(RAW_COMMAND, format!("missing path after {field:?}"))
    };
    while let Some(meta) = fields.next() {
        let letter = meta
            .rsplit(' ')
            .next()
            .and_then(|status| status.chars().next())
            .filter(|_| meta.starts_with(':'))
            .ok_or_else(|| {
                CoreError::invalid_output(RAW_COMMAND, format!("malformed record {meta:?}"))
            })?;
        let status = status_of(letter)?;
        let first = fields.next().ok_or_else(|| missing(meta))?;
        if matches!(status, FileStatus::Renamed | FileStatus::Copied) {
            let second = fields.next().ok_or_else(|| missing(meta))?;
            entries.push((status, second.to_owned(), Some(first.to_owned())));
        } else {
            entries.push((status, first.to_owned(), None));
        }
    }
    Ok(entries)
}

type Counts = (Option<u32>, Option<u32>);

fn parse_numstat(output: &str) -> Result<HashMap<String, Counts>, CoreError> {
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut counts = HashMap::new();
    let malformed = |field: &str| {
        CoreError::invalid_output(NUMSTAT_COMMAND, format!("malformed record {field:?}"))
    };
    while let Some(field) = fields.next() {
        let mut parts = field.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next())
        else {
            return Err(malformed(field));
        };
        let path = if path.is_empty() {
            fields.next().ok_or_else(|| malformed(field))?;
            fields.next().ok_or_else(|| malformed(field))?
        } else {
            path
        };
        counts.insert(path.to_owned(), (added.parse().ok(), removed.parse().ok()));
    }
    Ok(counts)
}

pub(crate) fn commit_files(
    root: &Path,
    base: &str,
    sha: &str,
) -> Result<Vec<CommitFile>, CoreError> {
    let flags = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "-M",
        "-z",
    ];
    let range = [base, sha, "--"];
    let raw_args: Vec<&str> = flags
        .iter()
        .copied()
        .chain(["--raw"])
        .chain(range)
        .collect();
    let numstat_args: Vec<&str> = flags
        .iter()
        .copied()
        .chain(["--numstat"])
        .chain(range)
        .collect();
    let entries = parse_raw(&git::run(root, &raw_args)?)?;
    let counts = parse_numstat(&git::run(root, &numstat_args)?)?;
    Ok(entries
        .into_iter()
        .map(|(status, path, original_path)| {
            let (additions, deletions) = counts.get(&path).copied().unwrap_or((None, None));
            CommitFile {
                path,
                original_path,
                status,
                additions,
                deletions,
            }
        })
        .collect())
}

pub fn commit_details(path: &Path, sha: &str) -> Result<CommitDetails, CoreError> {
    let root = repo::open(path)?;
    validate_sha(sha)?;
    let commit = read_commit(&root, sha)?;
    let head = repo::read_status(&root)?.head;
    let refs = graph::ref_labels(&refs::read_refs(&root)?, &head)
        .remove(&commit.sha)
        .unwrap_or_default();
    let base = diff_base(&root, &commit)?;
    let files = commit_files(&root, &base, &commit.sha)?;
    Ok(CommitDetails {
        sha: commit.sha,
        summary: commit.summary,
        body: commit.body,
        author: commit.author,
        committer: commit.committer,
        parents: commit.parents,
        refs,
        files,
    })
}

pub(crate) struct FileInCommit {
    pub sha: String,
    pub base: String,
    pub original: Option<String>,
}

pub(crate) fn file_in_commit(
    root: &Path,
    sha: &str,
    file: &str,
) -> Result<FileInCommit, CoreError> {
    validate_sha(sha)?;
    repo::check_paths(&[file])?;
    let commit = read_commit(root, sha)?;
    let base = diff_base(root, &commit)?;
    let original = commit_files(root, &base, &commit.sha)?
        .into_iter()
        .find(|entry| entry.path == file)
        .and_then(|entry| entry.original_path);
    Ok(FileInCommit {
        sha: commit.sha,
        base,
        original,
    })
}

pub fn commit_file_diff(
    path: &Path,
    sha: &str,
    file: &str,
    ignore_whitespace: bool,
) -> Result<FileDiff, CoreError> {
    let root = repo::open(path)?;
    let change = file_in_commit(&root, sha, file)?;
    diff::diff_between(
        &root,
        &change.base,
        &change.sha,
        file,
        change.original.as_deref(),
        ignore_whitespace,
    )
}

pub fn amend_info(path: &Path) -> Result<AmendInfo, CoreError> {
    let root = repo::open(path)?;
    let head = git::run_unchecked(
        &root,
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        None,
    )?;
    if !head.succeeded() {
        return Err(CoreError::invalid_request(
            "there is no commit to amend yet",
        ));
    }
    let commit = read_commit(&root, "HEAD")?;
    Ok(AmendInfo {
        pushed: head_is_on_upstream(&root)?,
        sha: commit.sha,
        summary: commit.summary,
        description: commit.body,
    })
}

pub(crate) fn has_upstream(root: &Path) -> Result<bool, CoreError> {
    Ok(git::run_unchecked(
        root,
        &["rev-parse", "--verify", "--quiet", "@{upstream}"],
        None,
    )?
    .succeeded())
}

fn head_is_on_upstream(root: &Path) -> Result<bool, CoreError> {
    if !has_upstream(root)? {
        return Ok(false);
    }
    let ancestry = git::run_unchecked(
        root,
        &["merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
        None,
    )?;
    match ancestry.status {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        status => Err(CoreError::GitFailed {
            command: "git merge-base --is-ancestor HEAD @{upstream}".to_owned(),
            status,
            stderr: ancestry.stderr.trim().to_owned(),
        }),
    }
}

pub fn commit(
    path: &Path,
    summary: &str,
    description: &str,
    amend: bool,
) -> Result<String, CoreError> {
    let root = repo::open(path)?;
    if summary.trim().is_empty() {
        return Err(CoreError::invalid_request("the commit summary is empty"));
    }
    let mut args = vec!["commit", "--quiet"];
    if amend {
        args.push("--amend");
    }
    args.extend(["-m", summary]);
    if !description.trim().is_empty() {
        args.extend(["-m", description]);
    }
    let completed = git::run_unchecked(&root, &args, None)?;
    if !completed.succeeded() {
        let output = [completed.stdout.trim(), completed.stderr.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(CoreError::CommitFailed {
            status: completed.status,
            output,
        });
    }
    Ok(git::run(&root, &["rev-parse", "HEAD"])?.trim().to_owned())
}

pub fn edit_head_message(
    path: &Path,
    sha: &str,
    summary: &str,
    description: &str,
) -> Result<MessageEdit, CoreError> {
    let root = repo::open(path)?;
    validate_sha(sha)?;
    if summary.trim().is_empty() {
        return Err(CoreError::invalid_request("the commit summary is empty"));
    }
    operation::require_settled(&root)?;
    let head = git::run_unchecked(&root, &["rev-parse", "--verify", "--quiet", "HEAD"], None)?;
    if !head.succeeded() || !head.stdout.trim().starts_with(sha) {
        return Err(CoreError::NotHead {
            sha: sha.to_owned(),
        });
    }
    let pushed = head_is_on_upstream(&root)?;
    let mut args = vec!["commit", "--quiet", "--amend", "--only", "-m", summary];
    if !description.trim().is_empty() {
        args.extend(["-m", description]);
    }
    let completed = git::run_unchecked(&root, &args, None)?;
    if !completed.succeeded() {
        return Err(CoreError::CommitFailed {
            status: completed.status,
            output: [completed.stdout.trim(), completed.stderr.trim()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
        });
    }
    Ok(MessageEdit {
        sha: git::run(&root, &["rev-parse", "HEAD"])?.trim().to_owned(),
        pushed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_commit_record_with_a_multiline_body() {
        let record = "aaa\u{1f}p1 p2\u{1f}Yui\u{1f}y@x\u{1f}1700000000\u{1f}Bo\u{1f}b@x\u{1f}1700000060\u{1f}Subject\u{1f}Line one\n\nLine two\n\n";
        let commit = parse_commit(record).unwrap();
        assert_eq!(commit.parents, vec!["p1", "p2"]);
        assert_eq!(commit.author.email, "y@x");
        assert_eq!(commit.committer.time, 1_700_000_060);
        assert_eq!(commit.summary, "Subject");
        assert_eq!(commit.body, "Line one\n\nLine two");
    }

    #[test]
    fn rejects_short_records_and_bad_times() {
        assert!(parse_commit("a\u{1f}b").is_err());
        assert!(
            parse_commit("a\u{1f}\u{1f}n\u{1f}e\u{1f}x\u{1f}n\u{1f}e\u{1f}1\u{1f}s\u{1f}").is_err()
        );
    }

    #[test]
    fn parses_raw_records_including_renames() {
        let output = ":100644 100644 a b M\0src/a.rs\0:100644 100644 c d R087\0old.rs\0new.rs\0:000000 100644 0 e A\0added.rs\0";
        assert_eq!(
            parse_raw(output).unwrap(),
            vec![
                (FileStatus::Modified, "src/a.rs".to_owned(), None),
                (
                    FileStatus::Renamed,
                    "new.rs".to_owned(),
                    Some("old.rs".to_owned())
                ),
                (FileStatus::Added, "added.rs".to_owned(), None),
            ]
        );
        assert!(parse_raw("not-a-record\0x\0").is_err());
        assert!(parse_raw(":1 2 a b M\0").is_err());
    }

    #[test]
    fn parses_numstat_records_with_binary_and_rename_forms() {
        let output = "3\t1\tsrc/a.rs\0-\t-\timg.png\x000\t0\t\0old.rs\0new.rs\0";
        let counts = parse_numstat(output).unwrap();
        assert_eq!(counts["src/a.rs"], (Some(3), Some(1)));
        assert_eq!(counts["img.png"], (None, None));
        assert_eq!(counts["new.rs"], (Some(0), Some(0)));
        assert!(parse_numstat("garbage\0").is_err());
    }

    #[test]
    fn accepts_only_hexadecimal_commit_ids() {
        assert!(validate_sha("abcdef0123").is_ok());
        assert!(validate_sha("abc").is_err());
        assert!(validate_sha("--all").is_err());
        assert!(validate_sha("HEAD").is_err());
    }
}
