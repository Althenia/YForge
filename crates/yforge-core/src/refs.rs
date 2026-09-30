use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::model::{RefKind, StashEntry};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RefEntry {
    pub name: String,
    pub kind: RefKind,
    pub target: String,
}

pub(crate) fn require_remote(root: &Path, remote: &str) -> Result<(), CoreError> {
    if read_remotes(root)?.iter().any(|known| known == remote) {
        Ok(())
    } else {
        Err(CoreError::invalid_request(format!(
            "{remote} is not a remote of this repository"
        )))
    }
}

const REFS_COMMAND: &str = "git for-each-ref";
const STASH_COMMAND: &str = "git stash list";

pub(crate) fn read_refs(root: &Path) -> Result<Vec<RefEntry>, CoreError> {
    let output = git::run(
        root,
        &[
            "for-each-ref",
            "--format=%(objectname)%00%(*objectname)%00%(refname)%00%(symref)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    parse_refs(&output)
}

fn parse_refs(output: &str) -> Result<Vec<RefEntry>, CoreError> {
    let mut refs = Vec::new();
    for line in output.lines().filter(|line| !line.is_empty()) {
        let fields: Vec<&str> = line.split('\0').collect();
        let [object, peeled, full_name, symref] = fields[..] else {
            return Err(CoreError::invalid_output(
                REFS_COMMAND,
                format!("expected 4 fields in {line:?}"),
            ));
        };
        if !symref.is_empty() {
            continue;
        }
        let (kind, name) = if let Some(name) = full_name.strip_prefix("refs/heads/") {
            (RefKind::LocalBranch, name)
        } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
            (RefKind::RemoteBranch, name)
        } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
            (RefKind::Tag, name)
        } else {
            return Err(CoreError::invalid_output(
                REFS_COMMAND,
                format!("unexpected ref {full_name:?}"),
            ));
        };
        let target = if peeled.is_empty() { object } else { peeled };
        refs.push(RefEntry {
            name: name.to_owned(),
            kind,
            target: target.to_owned(),
        });
    }
    Ok(refs)
}

pub(crate) fn read_stashes(root: &Path) -> Result<Vec<StashEntry>, CoreError> {
    let output = git::run(
        root,
        &["stash", "list", "--format=%H%x1f%P%x1f%an%x1f%ct%x1f%gs"],
    )?;
    parse_stashes(&output)
}

fn parse_stashes(output: &str) -> Result<Vec<StashEntry>, CoreError> {
    let mut stashes = Vec::new();
    for (index, line) in output.lines().filter(|line| !line.is_empty()).enumerate() {
        let fields: Vec<&str> = line.split('\u{1f}').collect();
        let [sha, parents, author_name, time, message] = fields[..] else {
            return Err(CoreError::invalid_output(
                STASH_COMMAND,
                format!("expected 5 fields in {line:?}"),
            ));
        };
        let time = time.parse::<i64>().map_err(|_| {
            CoreError::invalid_output(STASH_COMMAND, format!("malformed time {time:?}"))
        })?;
        stashes.push(StashEntry {
            index: u32::try_from(index).unwrap_or(u32::MAX),
            sha: sha.to_owned(),
            base_sha: parents
                .split(' ')
                .next()
                .filter(|sha| !sha.is_empty())
                .map(str::to_owned),
            author_name: author_name.to_owned(),
            message: message.to_owned(),
            time,
        });
    }
    Ok(stashes)
}

pub(crate) fn read_remotes(root: &Path) -> Result<Vec<String>, CoreError> {
    Ok(git::run(root, &["remote"])?
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect())
}

pub(crate) fn split_remote<'a>(name: &'a str, remotes: &[String]) -> Option<&'a str> {
    remotes
        .iter()
        .filter(|remote| name.starts_with(&format!("{remote}/")))
        .max_by_key(|remote| remote.len())
        .map(|remote| &name[remote.len() + 1..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branches_remotes_and_peels_annotated_tags() {
        let output = "aaa\0\0refs/heads/feature/x\0\n\
                      bbb\0\0refs/remotes/origin/main\0\n\
                      ccc\0\0refs/remotes/origin/HEAD\0refs/remotes/origin/main\n\
                      ddd\0eee\0refs/tags/v1\0\n";
        let refs = parse_refs(output).unwrap();
        assert_eq!(
            refs,
            vec![
                RefEntry {
                    name: "feature/x".into(),
                    kind: RefKind::LocalBranch,
                    target: "aaa".into()
                },
                RefEntry {
                    name: "origin/main".into(),
                    kind: RefKind::RemoteBranch,
                    target: "bbb".into()
                },
                RefEntry {
                    name: "v1".into(),
                    kind: RefKind::Tag,
                    target: "eee".into()
                },
            ]
        );
    }

    #[test]
    fn splits_the_longest_matching_remote_prefix() {
        let remotes = vec!["origin".to_owned(), "origin/fork".to_owned()];
        assert_eq!(
            split_remote("origin/feature/x", &remotes),
            Some("feature/x")
        );
        assert_eq!(split_remote("origin/fork/main", &remotes), Some("main"));
        assert_eq!(split_remote("upstream/main", &remotes), None);
    }

    #[test]
    fn rejects_malformed_ref_lines() {
        assert!(parse_refs("only\0two\n").is_err());
        assert!(parse_refs("a\0\0refs/notes/x\0\n").is_err());
    }

    #[test]
    fn parses_stashes_with_base_commit() {
        let output = "s1\u{1f}b1 i1\u{1f}Yui\u{1f}1700000000\u{1f}WIP on main: b1 msg\n\
                      s0\u{1f}b0\u{1f}Yui\u{1f}1600000000\u{1f}On main: named\n";
        let stashes = parse_stashes(output).unwrap();
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].index, 0);
        assert_eq!(stashes[0].base_sha.as_deref(), Some("b1"));
        assert_eq!(stashes[1].index, 1);
        assert_eq!(stashes[1].message, "On main: named");
        assert_eq!(stashes[1].time, 1_600_000_000);
    }

    #[test]
    fn rejects_malformed_stash_lines() {
        assert!(parse_stashes("a\u{1f}b\n").is_err());
        assert!(parse_stashes("a\u{1f}b\u{1f}c\u{1f}nan\u{1f}d\n").is_err());
    }
}
