use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

use crate::error::CoreError;
use crate::git;
use crate::layout::{self, index_u32, RowLayout};
use crate::model::{
    Author, CarriedEdge, ChangeCounts, GraphPage, GraphRef, GraphRow, Head, NodeKind, RefKind,
    SearchResult, StashEntry,
};
use crate::refs::{self, RefEntry};
use crate::repo;
use crate::status::ParsedStatus;

const LOG_COMMAND: &str = "git log";

struct RowSeed {
    sha: Option<String>,
    parents: Vec<String>,
    summary: String,
    author: Option<Author>,
    time: Option<i64>,
    kind: NodeKind,
}

fn initials(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let letters: String = match words.as_slice() {
        [] => return "?".to_owned(),
        [only] => only.chars().take(2).collect(),
        [first, .., last] => first.chars().take(1).chain(last.chars().take(1)).collect(),
    };
    letters.to_uppercase()
}

fn author(name: &str) -> Author {
    Author {
        name: name.to_owned(),
        initials: initials(name),
    }
}

fn parse_commits(output: &str) -> Result<Vec<RowSeed>, CoreError> {
    let mut seeds = Vec::new();
    for record in output.split('\0').filter(|record| !record.is_empty()) {
        let fields: Vec<&str> = record.splitn(5, '\u{1f}').collect();
        let [sha, parents, author_name, time, summary] = fields[..] else {
            return Err(CoreError::invalid_output(
                LOG_COMMAND,
                format!("expected 5 fields in {record:?}"),
            ));
        };
        let time = time.parse::<i64>().map_err(|_| {
            CoreError::invalid_output(LOG_COMMAND, format!("malformed time {time:?}"))
        })?;
        let parents: Vec<String> = parents
            .split(' ')
            .filter(|parent| !parent.is_empty())
            .map(str::to_owned)
            .collect();
        seeds.push(RowSeed {
            sha: Some(sha.to_owned()),
            kind: if parents.len() > 1 {
                NodeKind::Merge
            } else {
                NodeKind::Commit
            },
            parents,
            summary: summary.to_owned(),
            author: Some(author(author_name)),
            time: Some(time),
        });
    }
    Ok(seeds)
}

fn read_commits(root: &Path) -> Result<Vec<RowSeed>, CoreError> {
    let output = git::run(
        root,
        &[
            "log",
            "--topo-order",
            "--no-show-signature",
            "--exclude=refs/stash",
            "--all",
            "-z",
            "--format=%H%x1f%P%x1f%an%x1f%at%x1f%s",
        ],
    )?;
    parse_commits(&output)
}

fn stash_seed(stash: &StashEntry) -> RowSeed {
    RowSeed {
        sha: Some(stash.sha.clone()),
        parents: stash.base_sha.iter().cloned().collect(),
        summary: stash.message.clone(),
        author: Some(author(&stash.author_name)),
        time: Some(stash.time),
        kind: NodeKind::Stash,
    }
}

fn with_stashes(commits: Vec<RowSeed>, stashes: &[StashEntry]) -> Vec<RowSeed> {
    let mut placed: Vec<(usize, usize, RowSeed)> = stashes
        .iter()
        .enumerate()
        .map(|(order, stash)| {
            let position = commits
                .iter()
                .position(|commit| {
                    commit.time <= Some(stash.time)
                        || (stash.base_sha.is_some() && commit.sha == stash.base_sha)
                })
                .unwrap_or(commits.len());
            (position, order, stash_seed(stash))
        })
        .collect();
    placed.sort_by_key(|(position, order, _)| (*position, *order));

    let mut merged = Vec::with_capacity(commits.len() + placed.len());
    let mut pending = placed.into_iter().peekable();
    for (index, commit) in commits.into_iter().enumerate() {
        while let Some((_, _, stash)) = pending.next_if(|(position, _, _)| *position <= index) {
            merged.push(stash);
        }
        merged.push(commit);
    }
    merged.extend(pending.map(|(_, _, stash)| stash));
    merged
}

fn changes_summary(counts: &ChangeCounts) -> String {
    let parts: Vec<String> = [
        (counts.modified, "modified"),
        (counts.added, "added"),
        (counts.deleted, "deleted"),
        (counts.renamed, "renamed"),
        (counts.untracked, "untracked"),
        (counts.conflicted, "conflicted"),
    ]
    .into_iter()
    .filter(|(count, _)| *count > 0)
    .map(|(count, label)| format!("{count} {label}"))
    .collect();
    format!("Changes: {}", parts.join(", "))
}

pub(crate) fn ref_labels(refs: &[RefEntry], head: &Head) -> HashMap<String, Vec<GraphRef>> {
    let checked_out = match head {
        Head::Branch { name, .. } => Some(name.as_str()),
        Head::Detached { .. } | Head::Unborn { .. } => None,
    };
    let mut by_target: HashMap<String, Vec<GraphRef>> = HashMap::new();
    for entry in refs {
        by_target
            .entry(entry.target.clone())
            .or_default()
            .push(GraphRef {
                name: entry.name.clone(),
                kind: entry.kind,
                is_head: entry.kind == RefKind::LocalBranch
                    && checked_out == Some(entry.name.as_str()),
            });
    }
    let rank = |label: &GraphRef| {
        let kind = match label.kind {
            RefKind::LocalBranch => 0,
            RefKind::RemoteBranch => 1,
            RefKind::Tag => 2,
        };
        (!label.is_head, kind)
    };
    for labels in by_target.values_mut() {
        labels.sort_by(|left, right| {
            rank(left)
                .cmp(&rank(right))
                .then_with(|| left.name.cmp(&right.name))
        });
    }
    by_target
}

fn parent_indices(seeds: &[RowSeed]) -> Vec<Vec<usize>> {
    let mut row_of: HashMap<&str, usize> = seeds
        .iter()
        .enumerate()
        .filter_map(|(index, seed)| seed.sha.as_deref().map(|sha| (sha, index)))
        .collect();
    let mut next_outside = seeds.len();
    seeds
        .iter()
        .map(|seed| {
            seed.parents
                .iter()
                .map(|parent| {
                    *row_of.entry(parent.as_str()).or_insert_with(|| {
                        next_outside += 1;
                        next_outside - 1
                    })
                })
                .collect()
        })
        .collect()
}

fn ordered_seeds(
    root: &Path,
    status: &ParsedStatus,
    stashes: &[StashEntry],
) -> Result<Vec<RowSeed>, CoreError> {
    let mut seeds = with_stashes(read_commits(root)?, stashes);
    if status.counts.total() > 0 {
        let head_sha = match &status.head {
            Head::Branch { sha, .. } | Head::Detached { sha } => Some(sha.clone()),
            Head::Unborn { .. } => None,
        };
        seeds.insert(
            0,
            RowSeed {
                sha: None,
                parents: head_sha.into_iter().collect(),
                summary: String::new(),
                author: None,
                time: None,
                kind: NodeKind::Changes,
            },
        );
    }

    Ok(seeds)
}

struct History {
    seeds: Vec<RowSeed>,
    layouts: Vec<RowLayout>,
}

impl History {
    fn summary(&self, row: usize, status: &ParsedStatus) -> String {
        let seed = &self.seeds[row];
        match seed.kind {
            NodeKind::Changes => changes_summary(&status.counts),
            _ => seed.summary.clone(),
        }
    }
}

fn history_key(
    root: &Path,
    status: &ParsedStatus,
    stashes: &[StashEntry],
) -> Result<String, CoreError> {
    let refs = git::run(root, &["for-each-ref", "--format=%(objectname) %(refname)"])?;
    let head = match &status.head {
        Head::Branch { sha, .. } | Head::Detached { sha } => sha.as_str(),
        Head::Unborn { .. } => "",
    };
    let stash_shas: Vec<&str> = stashes.iter().map(|stash| stash.sha.as_str()).collect();
    Ok(format!(
        "{head}\n{}\n{}\n{refs}",
        status.counts.total() > 0,
        stash_shas.join(" ")
    ))
}

struct CachedHistory {
    key: String,
    history: Arc<History>,
}

static HISTORIES: LazyLock<Mutex<HashMap<PathBuf, CachedHistory>>> = LazyLock::new(Mutex::default);

fn history(
    root: &Path,
    status: &ParsedStatus,
    stashes: &[StashEntry],
) -> Result<Arc<History>, CoreError> {
    let key = history_key(root, status, stashes)?;
    let cached = HISTORIES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(root)
        .filter(|cached| cached.key == key)
        .map(|cached| Arc::clone(&cached.history));
    if let Some(history) = cached {
        return Ok(history);
    }
    let seeds = ordered_seeds(root, status, stashes)?;
    let layouts = layout::layout(&parent_indices(&seeds));
    let history = Arc::new(History { seeds, layouts });
    HISTORIES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(
            root.to_owned(),
            CachedHistory {
                key,
                history: Arc::clone(&history),
            },
        );
    Ok(history)
}

pub fn graph_page(path: &Path, offset: usize, limit: usize) -> Result<GraphPage, CoreError> {
    git::ensure_supported()?;
    let root = repo::resolve_root(path)?;
    let status = repo::read_status(&root)?;
    let refs = refs::read_refs(&root)?;
    let stashes = refs::read_stashes(&root)?;

    let history = history(&root, &status, &stashes)?;
    let mut labels = ref_labels(&refs, &status.head);
    let total = index_u32(history.seeds.len());
    let carried = history
        .seeds
        .iter()
        .zip(&history.layouts)
        .enumerate()
        .take(offset)
        .flat_map(|(row, (seed, row_layout))| {
            row_layout
                .edges
                .iter()
                .filter(|edge| {
                    edge.parent_row
                        .is_none_or(|parent| parent as usize >= offset)
                })
                .map(move |edge| CarriedEdge {
                    row: index_u32(row),
                    column: index_u32(row_layout.column),
                    kind: seed.kind,
                    edge: *edge,
                })
        })
        .collect();
    let rows = history
        .seeds
        .iter()
        .zip(&history.layouts)
        .enumerate()
        .skip(offset)
        .take(limit)
        .map(|(row, (seed, row_layout))| GraphRow {
            refs: seed
                .sha
                .as_ref()
                .and_then(|sha| labels.remove(sha))
                .unwrap_or_default(),
            sha: seed.sha.clone(),
            parents: seed.parents.clone(),
            summary: history.summary(row, &status),
            author: seed.author.clone(),
            time: seed.time,
            kind: seed.kind,
            column: index_u32(row_layout.column),
            edges: row_layout.edges.clone(),
        })
        .collect();
    Ok(GraphPage {
        rows,
        carried,
        total,
    })
}

struct Searchable {
    author: String,
    email: String,
    message: String,
}

enum Scope {
    Any,
    Author,
    Sha,
}

fn parse_query(query: &str) -> (Scope, String) {
    let query = query.trim();
    for (prefix, scope) in [("author:", Scope::Author), ("sha:", Scope::Sha)] {
        if let Some(rest) = query.strip_prefix(prefix) {
            return (scope, rest.trim().to_lowercase());
        }
    }
    (Scope::Any, query.to_lowercase())
}

fn read_searchables(root: &Path) -> Result<HashMap<String, Searchable>, CoreError> {
    let output = git::run(
        root,
        &[
            "log",
            "--no-show-signature",
            "--exclude=refs/stash",
            "--all",
            "-z",
            "--format=%H%x1f%an%x1f%ae%x1f%B",
        ],
    )?;
    let mut found = HashMap::new();
    for record in output.split('\0').filter(|record| !record.is_empty()) {
        let fields: Vec<&str> = record.splitn(4, '\u{1f}').collect();
        let [sha, author, email, message] = fields[..] else {
            return Err(CoreError::invalid_output(
                LOG_COMMAND,
                format!("expected 4 fields in {record:?}"),
            ));
        };
        found.insert(
            sha.to_owned(),
            Searchable {
                author: author.to_lowercase(),
                email: email.to_lowercase(),
                message: message.to_lowercase(),
            },
        );
    }
    Ok(found)
}

pub fn search_commits(path: &Path, query: &str) -> Result<SearchResult, CoreError> {
    git::ensure_supported()?;
    let root = repo::resolve_root(path)?;
    let status = repo::read_status(&root)?;
    let stashes = refs::read_stashes(&root)?;
    let history = history(&root, &status, &stashes)?;
    let seeds = &history.seeds;
    let commits = seeds
        .iter()
        .filter(|seed| seed.kind != NodeKind::Changes)
        .count();
    let (scope, needle) = parse_query(query);
    if needle.is_empty() {
        return Ok(SearchResult {
            total: index_u32(commits),
            rows: Vec::new(),
        });
    }
    let searchable = read_searchables(&root)?;
    let rows = seeds
        .iter()
        .enumerate()
        .filter(|(_, seed)| {
            let Some(sha) = seed.sha.as_deref() else {
                return false;
            };
            let by_sha = sha.starts_with(&needle);
            let (by_author, by_message) = match searchable.get(sha) {
                Some(found) => (
                    found.author.contains(&needle) || found.email.contains(&needle),
                    found.message.contains(&needle),
                ),
                None => (
                    seed.author
                        .as_ref()
                        .is_some_and(|author| author.name.to_lowercase().contains(&needle)),
                    seed.summary.to_lowercase().contains(&needle),
                ),
            };
            match scope {
                Scope::Any => by_sha || by_author || by_message,
                Scope::Author => by_author,
                Scope::Sha => by_sha,
            }
        })
        .map(|(row, _)| index_u32(row))
        .collect();
    Ok(SearchResult {
        total: index_u32(commits),
        rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(sha: &str, parents: &str, name: &str, time: &str, summary: &str) -> String {
        format!("{sha}\u{1f}{parents}\u{1f}{name}\u{1f}{time}\u{1f}{summary}\0")
    }

    #[test]
    fn initials_use_first_and_last_word() {
        assert_eq!(initials("Yui Lin"), "YL");
        assert_eq!(initials("mary jane watson"), "MW");
        assert_eq!(initials("Cher"), "CH");
        assert_eq!(initials("  "), "?");
        assert_eq!(initials(""), "?");
    }

    #[test]
    fn parses_commits_and_marks_merges() {
        let output = format!(
            "{}{}{}",
            record("m", "a b", "Yui Lin", "300", "Merge x | y"),
            record("a", "r", "Cher", "200", "Add\u{1f}odd"),
            record("r", "", "Bo", "100", "Root"),
        );
        let seeds = parse_commits(&output).unwrap();
        assert_eq!(seeds.len(), 3);
        assert_eq!(seeds[0].kind, NodeKind::Merge);
        assert_eq!(seeds[0].parents, vec!["a", "b"]);
        assert_eq!(seeds[1].kind, NodeKind::Commit);
        assert_eq!(seeds[1].summary, "Add\u{1f}odd");
        assert!(seeds[2].parents.is_empty());
        assert_eq!(seeds[2].author.as_ref().unwrap().initials, "BO");
    }

    #[test]
    fn rejects_malformed_log_records() {
        assert!(parse_commits("a\u{1f}b\0").is_err());
        assert!(parse_commits(&record("a", "", "n", "soon", "s")).is_err());
    }

    fn commit(sha: &str, time: i64) -> RowSeed {
        RowSeed {
            sha: Some(sha.to_owned()),
            parents: Vec::new(),
            summary: String::new(),
            author: None,
            time: Some(time),
            kind: NodeKind::Commit,
        }
    }

    fn stash(sha: &str, base: &str, time: i64) -> StashEntry {
        StashEntry {
            index: 0,
            sha: sha.to_owned(),
            base_sha: Some(base.to_owned()),
            author_name: "Yui".to_owned(),
            message: "WIP".to_owned(),
            time,
        }
    }

    fn order(seeds: &[RowSeed]) -> Vec<&str> {
        seeds
            .iter()
            .filter_map(|seed| seed.sha.as_deref())
            .collect()
    }

    #[test]
    fn stash_rows_precede_the_first_older_commit_and_always_precede_their_base() {
        let commits = vec![commit("c3", 300), commit("c2", 200), commit("c1", 100)];
        let merged = with_stashes(
            commits,
            &[stash("s-new", "c2", 250), stash("s-old", "c1", 400)],
        );
        assert_eq!(order(&merged), vec!["s-old", "c3", "s-new", "c2", "c1"]);

        let commits = vec![commit("c2", 200), commit("c1", 100)];
        let merged = with_stashes(commits, &[stash("s", "c1", 500_000)]);
        assert_eq!(order(&merged), vec!["s", "c2", "c1"]);

        let commits = vec![commit("c2", 200), commit("c1", 100)];
        let merged = with_stashes(commits, &[stash("s", "c1", 50)]);
        assert_eq!(order(&merged), vec!["c2", "s", "c1"]);
    }

    #[test]
    fn stash_whose_base_is_unreachable_is_still_listed() {
        let merged = with_stashes(vec![commit("c1", 100)], &[stash("s", "gone", 10)]);
        assert_eq!(order(&merged), vec!["c1", "s"]);
    }

    fn git_in(dir: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Yui Lin")
            .env("GIT_AUTHOR_EMAIL", "yui@example.test")
            .env("GIT_COMMITTER_NAME", "Yui Lin")
            .env("GIT_COMMITTER_EMAIL", "yui@example.test")
            .output()
            .expect("git runs");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn repository() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        git_in(&root, &["init", "-q", "-b", "main"]);
        git_in(&root, &["commit", "-q", "--allow-empty", "-m", "First"]);
        git_in(&root, &["commit", "-q", "--allow-empty", "-m", "Second"]);
        (dir, root)
    }

    fn cached(root: &Path) -> Arc<History> {
        let status = repo::read_status(root).unwrap();
        let stashes = refs::read_stashes(root).unwrap();
        history(root, &status, &stashes).unwrap()
    }

    #[test]
    fn a_second_request_reuses_the_layout_computed_for_the_same_refs_and_head() {
        let (_dir, root) = repository();

        let first = cached(&root);
        let second = cached(&root);

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(first.layouts.len(), 2);
    }

    #[test]
    fn a_new_commit_a_new_ref_or_a_new_stash_invalidates_the_cached_layout() {
        let (_dir, root) = repository();
        let first = cached(&root);

        git_in(&root, &["branch", "topic"]);
        let with_ref = cached(&root);
        assert!(!Arc::ptr_eq(&first, &with_ref));
        assert_eq!(with_ref.layouts.len(), 2);

        git_in(&root, &["commit", "-q", "--allow-empty", "-m", "Third"]);
        let with_commit = cached(&root);
        assert!(!Arc::ptr_eq(&with_ref, &with_commit));
        assert_eq!(with_commit.layouts.len(), 3);

        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        git_in(&root, &["add", "a.txt"]);
        let with_changes = cached(&root);
        assert!(!Arc::ptr_eq(&with_commit, &with_changes));
        assert_eq!(with_changes.layouts.len(), 4);
        git_in(&root, &["stash", "push", "-q"]);
        let with_stash = cached(&root);
        assert!(!Arc::ptr_eq(&with_changes, &with_stash));
        assert_eq!(with_stash.layouts.len(), 4);
    }

    #[test]
    fn editing_more_files_keeps_the_layout_and_refreshes_the_changes_summary() {
        let (_dir, root) = repository();
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        let first = cached(&root);
        let one = graph_page(&root, 0, 10).unwrap();

        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        let second = cached(&root);
        let two = graph_page(&root, 0, 10).unwrap();

        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(one.rows[0].summary, "Changes: 1 untracked");
        assert_eq!(two.rows[0].summary, "Changes: 2 untracked");
    }

    #[test]
    fn changes_summary_lists_non_zero_categories() {
        let counts = ChangeCounts {
            modified: 1,
            untracked: 2,
            ..ChangeCounts::default()
        };
        assert_eq!(changes_summary(&counts), "Changes: 1 modified, 2 untracked");
    }

    #[test]
    fn parent_shas_outside_the_rows_get_shared_indices_past_the_end() {
        let mut first = commit("a", 2);
        first.parents = vec!["x".into()];
        let mut second = commit("b", 1);
        second.parents = vec!["x".into(), "a".into()];
        assert_eq!(parent_indices(&[first, second]), vec![vec![2], vec![2, 0]]);
    }
}
