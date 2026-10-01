use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use crate::branch;
use crate::error::CoreError;
use crate::git::{self, CancelToken};
use crate::model::{LostCommit, LostKind, ReflogEntry};
use crate::repo;
use crate::snapshots::MESSAGE_MARK;

const MAX_LOST: usize = 500;
const MAX_PAGE: u32 = 200;
const HEAD: &str = "HEAD";
const BRANCH_PREFIX: &str = "refs/heads/";
const INDEX_SUMMARY: &str = "index on ";
const UNTRACKED_SUMMARY: &str = "untracked files on ";

pub(crate) fn git_path(root: &Path, name: &str) -> Result<PathBuf, CoreError> {
    let output = git::run(root, &["rev-parse", "--git-path", name])?;
    Ok(root.join(output.trim_end_matches('\n')))
}

fn log_file(root: &Path, reference: &str) -> Result<PathBuf, CoreError> {
    if reference == HEAD {
        return git_path(root, "logs/HEAD");
    }
    let name = reference
        .strip_prefix(BRANCH_PREFIX)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| {
            CoreError::invalid_request(
                "only HEAD and local branches (refs/heads/*) have a reflog here",
            )
        })?;
    branch::require_local_branch(root, name)?;
    git_path(root, &format!("logs/{reference}"))
}

fn collect_logs(dir: &Path, prefix: &str, found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => collect_logs(&entry.path(), &format!("{name}/"), found),
            Ok(kind) if kind.is_file() => found.push(name),
            _ => {}
        }
    }
}

pub fn reflog_refs(path: &Path) -> Result<Vec<String>, CoreError> {
    let root = repo::open(path)?;
    let mut refs = Vec::new();
    if fs::metadata(log_file(&root, HEAD)?).is_ok_and(|metadata| metadata.len() > 0) {
        refs.push(HEAD.to_owned());
    }
    let mut logged = Vec::new();
    collect_logs(&git_path(&root, "logs/refs/heads")?, "", &mut logged);
    let existing: HashSet<String> = git::run(
        &root,
        &["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads"],
    )?
    .lines()
    .map(str::to_owned)
    .collect();
    logged.retain(|name| existing.contains(name));
    logged.sort();
    refs.extend(
        logged
            .into_iter()
            .map(|name| format!("{BRANCH_PREFIX}{name}")),
    );
    Ok(refs)
}

struct RawEntry {
    previous: String,
    sha: String,
    time: i64,
    message: String,
}

fn parse_line(line: &str) -> Result<RawEntry, CoreError> {
    let malformed = || CoreError::invalid_output("reflog", format!("unexpected line {line:?}"));
    let (header, message) = line.split_once('\t').unwrap_or((line, ""));
    let mut fields = header.splitn(3, ' ');
    let (previous, sha, identity) = (
        fields.next().ok_or_else(malformed)?,
        fields.next().ok_or_else(malformed)?,
        fields.next().ok_or_else(malformed)?,
    );
    let mut tail = identity.rsplitn(3, ' ');
    let _zone = tail.next().ok_or_else(malformed)?;
    let time = tail
        .next()
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(malformed)?;
    Ok(RawEntry {
        previous: previous.to_owned(),
        sha: sha.to_owned(),
        time,
        message: message.to_owned(),
    })
}

fn action_of(message: &str) -> String {
    let head = message.split(':').next().unwrap_or_default().trim();
    let word = head.split_whitespace().next().unwrap_or_default();
    if word == "commit" {
        if let Some(kind) = head
            .split_once('(')
            .and_then(|(_, rest)| rest.strip_suffix(')'))
        {
            return format!("commit ({kind})");
        }
    }
    if word.is_empty() {
        "other".to_owned()
    } else {
        word.to_owned()
    }
}

fn is_zero(sha: &str) -> bool {
    sha.chars().all(|digit| digit == '0')
}

fn summaries(root: &Path, shas: &[&str]) -> Result<HashMap<String, String>, CoreError> {
    let unique: Vec<&str> = shas
        .iter()
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let probe: String = unique
        .iter()
        .map(|sha| format!("{sha}^{{commit}}\n"))
        .collect();
    let checked = git::run_with_input(root, &["cat-file", "--batch-check"], &probe)?;
    let present: Vec<&str> = unique
        .iter()
        .zip(checked.lines())
        .filter(|(_, line)| !line.ends_with(" missing"))
        .map(|(sha, _)| *sha)
        .collect();
    if present.is_empty() {
        return Ok(HashMap::new());
    }
    let input: String = present.iter().map(|sha| format!("{sha}\n")).collect();
    let listing = git::run_with_input(
        root,
        &[
            "log",
            "--no-walk=unsorted",
            "--no-show-signature",
            "--stdin",
            "-z",
            "--format=%H%x1f%s",
        ],
        &input,
    )?;
    Ok(listing
        .split('\0')
        .filter_map(|record| record.split_once('\u{1f}'))
        .map(|(sha, summary)| (sha.to_owned(), summary.to_owned()))
        .collect())
}

pub fn reflog_list(
    path: &Path,
    reference: &str,
    before: Option<u32>,
    limit: u32,
) -> Result<Vec<ReflogEntry>, CoreError> {
    let root = repo::open(path)?;
    let file = log_file(&root, reference)?;
    let content = match fs::read_to_string(&file) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(CoreError::GitFailed {
                command: format!("read {}", file.display()),
                status: None,
                stderr: error.to_string(),
            })
        }
    };
    let start = before.map_or(0, |index| index.saturating_add(1)) as usize;
    let take = limit.clamp(1, MAX_PAGE) as usize;
    let label = reference.strip_prefix(BRANCH_PREFIX).unwrap_or(reference);
    let lines: Vec<&str> = content.lines().filter(|line| !line.is_empty()).collect();
    let mut raw = Vec::new();
    for (index, line) in lines.iter().rev().enumerate().skip(start).take(take) {
        raw.push((index, parse_line(line)?));
    }
    let shas: Vec<&str> = raw
        .iter()
        .flat_map(|(_, entry)| [entry.sha.as_str(), entry.previous.as_str()])
        .filter(|sha| !is_zero(sha))
        .collect();
    let known = summaries(&root, &shas)?;
    Ok(raw
        .into_iter()
        .map(|(index, entry)| ReflogEntry {
            index: u32::try_from(index).unwrap_or(u32::MAX),
            selector: format!("{label}@{{{index}}}"),
            action: action_of(&entry.message),
            summary: known.get(&entry.sha).cloned().unwrap_or_default(),
            exists: known.contains_key(&entry.sha),
            previous_sha: (!is_zero(&entry.previous)).then_some(entry.previous),
            sha: entry.sha,
            message: entry.message,
            time: entry.time,
        })
        .collect())
}

struct Watchdog {
    done: Arc<AtomicBool>,
}

impl Watchdog {
    fn start(outer: &CancelToken, inner: &CancelToken) -> Self {
        if outer.is_cancelled() {
            inner.cancel();
        }
        let done = Arc::new(AtomicBool::new(false));
        let (outer, inner, flag) = (outer.clone(), inner.clone(), done.clone());
        thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                if outer.is_cancelled() {
                    inner.cancel();
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
        });
        Self { done }
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        self.done.store(true, Ordering::SeqCst);
    }
}

fn unreachable_commits(
    root: &Path,
    cancel: &CancelToken,
    timeout: Duration,
) -> Result<Vec<String>, CoreError> {
    let inner = CancelToken::new();
    let _watchdog = Watchdog::start(cancel, &inner);
    let completed = git::run_streaming_until(
        root,
        &["fsck", "--no-reflogs", "--unreachable", "--no-progress"],
        &inner,
        Some(Instant::now() + timeout),
        |_| {},
    )?;
    let commits: Vec<String> = completed
        .stdout
        .lines()
        .filter_map(|line| line.strip_prefix("unreachable commit "))
        .map(|sha| sha.trim().to_owned())
        .collect();
    if commits.is_empty() && !completed.succeeded() {
        return Err(CoreError::GitFailed {
            command: "git fsck".to_owned(),
            status: completed.status,
            stderr: completed.stderr.trim().to_owned(),
        });
    }
    Ok(commits)
}

struct Metadata {
    sha: String,
    parents: Vec<String>,
    author: String,
    time: i64,
    summary: String,
}

fn read_metadata(root: &Path, shas: &[String]) -> Result<Vec<Metadata>, CoreError> {
    if shas.is_empty() {
        return Ok(Vec::new());
    }
    let input: String = shas.iter().map(|sha| format!("{sha}\n")).collect();
    let listing = git::run_with_input(
        root,
        &[
            "log",
            "--no-walk=sorted",
            "--no-show-signature",
            "--stdin",
            "-z",
            "--format=%H%x1f%P%x1f%an%x1f%ct%x1f%s",
        ],
        &input,
    )?;
    listing
        .split('\0')
        .filter(|record| !record.is_empty())
        .map(|record| {
            let fields: Vec<&str> = record.split('\u{1f}').collect();
            let [sha, parents, author, time, summary] = fields[..] else {
                return Err(CoreError::invalid_output(
                    "git log",
                    format!("expected 5 fields in {record:?}"),
                ));
            };
            Ok(Metadata {
                sha: sha.to_owned(),
                parents: parents.split_whitespace().map(str::to_owned).collect(),
                author: author.to_owned(),
                time: time.parse().map_err(|_| {
                    CoreError::invalid_output("git log", format!("malformed time {time:?}"))
                })?,
                summary: summary.to_owned(),
            })
        })
        .collect()
}

type Helpers = HashMap<String, (Vec<String>, String)>;

fn stash_parts(commit: &Metadata, helpers: &Helpers) -> Option<Vec<String>> {
    let [base, index, rest @ ..] = &commit.parents[..] else {
        return None;
    };
    let untracked_ok = match rest {
        [] => true,
        [untracked] => helpers.get(untracked).is_some_and(|(parents, summary)| {
            parents.is_empty() && summary.starts_with(UNTRACKED_SUMMARY)
        }),
        _ => false,
    };
    let index_ok = helpers.get(index).is_some_and(|(parents, summary)| {
        parents.len() == 1 && &parents[0] == base && summary.starts_with(INDEX_SUMMARY)
    });
    (untracked_ok && index_ok).then(|| commit.parents[1..].to_vec())
}

pub fn lost_commits(
    path: &Path,
    cancel: &CancelToken,
    timeout: Duration,
) -> Result<Vec<LostCommit>, CoreError> {
    let root = repo::open(path)?;
    let unreachable = unreachable_commits(&root, cancel, timeout)?;
    let commits = read_metadata(&root, &unreachable)?;
    let helpers: Vec<String> = commits
        .iter()
        .filter(|commit| (2..=3).contains(&commit.parents.len()))
        .flat_map(|commit| commit.parents[1..].iter().cloned())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let parents_of: Helpers = read_metadata(&root, &helpers)?
        .into_iter()
        .map(|commit| (commit.sha, (commit.parents, commit.summary)))
        .collect();
    let mut hidden = HashSet::new();
    let mut stashes = HashSet::new();
    for commit in &commits {
        if let Some(parts) = stash_parts(commit, &parents_of) {
            stashes.insert(commit.sha.clone());
            hidden.extend(parts);
        }
    }
    Ok(commits
        .into_iter()
        .filter(|commit| !hidden.contains(&commit.sha) && !commit.summary.starts_with(MESSAGE_MARK))
        .take(MAX_LOST)
        .map(|commit| LostCommit {
            kind: if stashes.contains(&commit.sha) {
                LostKind::Stash
            } else {
                LostKind::Commit
            },
            sha: commit.sha,
            summary: commit.summary,
            author: commit.author,
            time: commit.time,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_action_from_reflog_messages() {
        let cases = [
            ("commit (initial): First", "commit (initial)"),
            ("commit (amend): Fix", "commit (amend)"),
            ("commit (merge): Merge x", "commit (merge)"),
            ("commit: Add", "commit"),
            ("checkout: moving from a to b", "checkout"),
            ("pull: Fast-forward", "pull"),
            ("pull --rebase (finish): returning to refs/heads/x", "pull"),
            ("rebase (pick): Add", "rebase"),
            ("merge feature: Fast-forward", "merge"),
            ("cherry-pick: Add", "cherry-pick"),
            ("branch: Created from HEAD", "branch"),
            ("reset: moving to HEAD~1", "reset"),
            ("", "other"),
        ];
        for (message, action) in cases {
            assert_eq!(action_of(message), action, "{message}");
        }
    }

    #[test]
    fn parses_reflog_lines_with_zero_old_ids_and_multiword_identities() {
        let line = "0000000000000000000000000000000000000000 abc Yui Lin <y@x.test> 1700000000 +0700\tcommit (initial): First";
        let entry = parse_line(line).unwrap();
        assert!(is_zero(&entry.previous));
        assert_eq!((entry.sha.as_str(), entry.time), ("abc", 1_700_000_000));
        assert_eq!(entry.message, "commit (initial): First");
        assert!(parse_line("garbage").is_err());
    }
}
