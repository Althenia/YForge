use crate::error::CoreError;
use crate::model::{AheadBehind, ChangeArea, ChangeCounts, FileChange, FileStatus, Head, Upstream};

const COMMAND: &str = "git status --porcelain=v2";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedStatus {
    pub head: Head,
    pub upstream: Option<Upstream>,
    pub files: Vec<FileChange>,
    pub counts: ChangeCounts,
}

#[derive(Default)]
struct Headers {
    oid: Option<String>,
    head: Option<String>,
    upstream: Option<String>,
    ahead_behind: Option<AheadBehind>,
}

fn invalid(detail: impl Into<String>) -> CoreError {
    CoreError::invalid_output(COMMAND, detail)
}

fn status_of(letter: char) -> Result<Option<FileStatus>, CoreError> {
    Ok(Some(match letter {
        '.' => return Ok(None),
        'M' => FileStatus::Modified,
        'A' => FileStatus::Added,
        'D' => FileStatus::Deleted,
        'R' => FileStatus::Renamed,
        'C' => FileStatus::Copied,
        'T' => FileStatus::TypeChanged,
        other => return Err(invalid(format!("unknown status letter {other:?}"))),
    }))
}

fn xy(field: &str) -> Result<(Option<FileStatus>, Option<FileStatus>), CoreError> {
    let mut letters = field.chars();
    match (letters.next(), letters.next(), letters.next()) {
        (Some(staged), Some(unstaged), None) => Ok((status_of(staged)?, status_of(unstaged)?)),
        _ => Err(invalid(format!("malformed XY field {field:?}"))),
    }
}

fn parse_ahead_behind(value: &str) -> Result<AheadBehind, CoreError> {
    let count = |part: Option<&str>, sign: char| {
        part.and_then(|text| text.strip_prefix(sign))
            .and_then(|digits| digits.parse::<u32>().ok())
            .ok_or_else(|| invalid(format!("malformed branch.ab {value:?}")))
    };
    let mut parts = value.split(' ');
    let ahead = count(parts.next(), '+')?;
    let behind = count(parts.next(), '-')?;
    Ok(AheadBehind { ahead, behind })
}

fn apply_header(headers: &mut Headers, line: &str) -> Result<(), CoreError> {
    if let Some(value) = line.strip_prefix("branch.oid ") {
        headers.oid = Some(value.to_owned());
    } else if let Some(value) = line.strip_prefix("branch.head ") {
        headers.head = Some(value.to_owned());
    } else if let Some(value) = line.strip_prefix("branch.upstream ") {
        headers.upstream = Some(value.to_owned());
    } else if let Some(value) = line.strip_prefix("branch.ab ") {
        headers.ahead_behind = Some(parse_ahead_behind(value)?);
    }
    Ok(())
}

fn count(counts: &mut ChangeCounts, status: FileStatus) {
    let slot = match status {
        FileStatus::Modified | FileStatus::TypeChanged => &mut counts.modified,
        FileStatus::Added => &mut counts.added,
        FileStatus::Deleted => &mut counts.deleted,
        FileStatus::Renamed | FileStatus::Copied => &mut counts.renamed,
        FileStatus::Untracked => &mut counts.untracked,
        FileStatus::Conflicted => &mut counts.conflicted,
    };
    *slot += 1;
}

fn tracked_entry(
    parsed: &mut ParsedStatus,
    fields: &[&str],
    path_index: usize,
    original_path: Option<&str>,
) -> Result<(), CoreError> {
    if fields.len() != path_index + 1 {
        return Err(invalid(format!("truncated entry {:?}", fields.join(" "))));
    }
    let (staged, unstaged) = xy(fields[1])?;
    let path = fields[path_index];
    for (area, status) in [
        (ChangeArea::Staged, staged),
        (ChangeArea::Unstaged, unstaged),
    ] {
        if let Some(status) = status {
            parsed.files.push(FileChange {
                path: path.to_owned(),
                original_path: original_path.map(str::to_owned),
                area,
                status,
            });
        }
    }
    let primary = staged
        .or(unstaged)
        .ok_or_else(|| invalid(format!("entry {path:?} has no change")))?;
    count(&mut parsed.counts, primary);
    Ok(())
}

pub(crate) fn parse_status(output: &str) -> Result<ParsedStatus, CoreError> {
    let mut headers = Headers::default();
    let mut parsed = ParsedStatus {
        head: Head::Unborn {
            branch: String::new(),
        },
        upstream: None,
        files: Vec::new(),
        counts: ChangeCounts::default(),
    };
    let mut records = output.split('\0');
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        if let Some(header) = record.strip_prefix("# ") {
            apply_header(&mut headers, header)?;
            continue;
        }
        match record.as_bytes()[0] {
            b'1' => {
                let fields: Vec<&str> = record.splitn(9, ' ').collect();
                tracked_entry(&mut parsed, &fields, 8, None)?;
            }
            b'2' => {
                let original = records
                    .next()
                    .filter(|path| !path.is_empty())
                    .ok_or_else(|| {
                        invalid(format!("renamed entry without original path: {record:?}"))
                    })?;
                let fields: Vec<&str> = record.splitn(10, ' ').collect();
                tracked_entry(&mut parsed, &fields, 9, Some(original))?;
            }
            b'u' => {
                let fields: Vec<&str> = record.splitn(11, ' ').collect();
                if fields.len() != 11 {
                    return Err(invalid(format!("truncated unmerged entry {record:?}")));
                }
                if fields[1].chars().count() != 2 {
                    return Err(invalid(format!("malformed XY field {:?}", fields[1])));
                }
                parsed.files.push(FileChange {
                    path: fields[10].to_owned(),
                    original_path: None,
                    area: ChangeArea::Conflicted,
                    status: FileStatus::Conflicted,
                });
                count(&mut parsed.counts, FileStatus::Conflicted);
            }
            b'?' => {
                parsed.files.push(FileChange {
                    path: record[1..]
                        .strip_prefix(' ')
                        .filter(|path| !path.is_empty())
                        .ok_or_else(|| invalid(format!("malformed untracked entry {record:?}")))?
                        .to_owned(),
                    original_path: None,
                    area: ChangeArea::Untracked,
                    status: FileStatus::Untracked,
                });
                count(&mut parsed.counts, FileStatus::Untracked);
            }
            b'!' => {}
            _ => return Err(invalid(format!("unknown record {record:?}"))),
        }
    }

    let oid = headers
        .oid
        .ok_or_else(|| invalid("missing branch.oid header"))?;
    let branch = headers
        .head
        .ok_or_else(|| invalid("missing branch.head header"))?;
    parsed.head = match (oid.as_str(), branch.as_str()) {
        ("(initial)", "(detached)") => return Err(invalid("detached HEAD without a commit")),
        ("(initial)", _) => Head::Unborn { branch },
        (_, "(detached)") => Head::Detached { sha: oid },
        _ => Head::Branch {
            name: branch,
            sha: oid,
        },
    };
    parsed.upstream = headers.upstream.map(|name| Upstream {
        name,
        ahead_behind: headers.ahead_behind,
    });
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "1111111111111111111111111111111111111111";
    const ZERO: &str = "0000000000000000000000000000000000000000";

    fn headers(head: &str, extra: &[&str]) -> String {
        let mut out = format!("# branch.oid {SHA}\0# branch.head {head}\0");
        for line in extra {
            out.push_str(line);
            out.push('\0');
        }
        out
    }

    fn ordinary(xy: &str, path: &str) -> String {
        format!("1 {xy} N... 100644 100644 100644 {ZERO} {ZERO} {path}\0")
    }

    #[test]
    fn parses_branch_headers_with_upstream_and_ahead_behind() {
        let input = headers(
            "main",
            &["# branch.upstream origin/main", "# branch.ab +3 -1"],
        );
        let parsed = parse_status(&input).unwrap();
        assert_eq!(
            parsed.head,
            Head::Branch {
                name: "main".into(),
                sha: SHA.into()
            }
        );
        assert_eq!(
            parsed.upstream,
            Some(Upstream {
                name: "origin/main".into(),
                ahead_behind: Some(AheadBehind {
                    ahead: 3,
                    behind: 1
                })
            })
        );
        assert!(parsed.files.is_empty());
        assert_eq!(parsed.counts.total(), 0);
    }

    #[test]
    fn upstream_without_ab_header_has_unknown_ahead_behind() {
        let input = headers("main", &["# branch.upstream origin/gone"]);
        let parsed = parse_status(&input).unwrap();
        assert_eq!(
            parsed.upstream,
            Some(Upstream {
                name: "origin/gone".into(),
                ahead_behind: None
            })
        );
    }

    #[test]
    fn parses_detached_and_unborn_heads() {
        let detached = parse_status(&headers("(detached)", &[])).unwrap();
        assert_eq!(detached.head, Head::Detached { sha: SHA.into() });
        let unborn = parse_status("# branch.oid (initial)\0# branch.head main\0").unwrap();
        assert_eq!(
            unborn.head,
            Head::Unborn {
                branch: "main".into()
            }
        );
        assert_eq!(unborn.upstream, None);
    }

    #[test]
    fn ordinary_entry_with_both_sides_yields_staged_and_unstaged_changes_counted_once() {
        let input = format!("{}{}", headers("main", &[]), ordinary("MM", "src/a b.rs"));
        let parsed = parse_status(&input).unwrap();
        assert_eq!(
            parsed.files,
            vec![
                FileChange {
                    path: "src/a b.rs".into(),
                    original_path: None,
                    area: ChangeArea::Staged,
                    status: FileStatus::Modified
                },
                FileChange {
                    path: "src/a b.rs".into(),
                    original_path: None,
                    area: ChangeArea::Unstaged,
                    status: FileStatus::Modified
                },
            ]
        );
        assert_eq!(parsed.counts.modified, 1);
        assert_eq!(parsed.counts.total(), 1);
    }

    #[test]
    fn counts_by_primary_status_letter() {
        let input = format!(
            "{}{}{}{}{}",
            headers("main", &[]),
            ordinary("A.", "added.txt"),
            ordinary(".D", "deleted.txt"),
            ordinary("AM", "added-then-edited.txt"),
            ordinary(".T", "typechanged"),
        );
        let parsed = parse_status(&input).unwrap();
        assert_eq!(parsed.counts.added, 2);
        assert_eq!(parsed.counts.deleted, 1);
        assert_eq!(parsed.counts.modified, 1);
        assert_eq!(parsed.files.len(), 5);
    }

    #[test]
    fn renamed_entry_carries_original_path_from_following_record() {
        let input = format!(
            "{}2 R. N... 100644 100644 100644 {ZERO} {ZERO} R100 new name.txt\0old name.txt\0{}",
            headers("main", &[]),
            ordinary(".M", "after.txt"),
        );
        let parsed = parse_status(&input).unwrap();
        assert_eq!(
            parsed.files[0],
            FileChange {
                path: "new name.txt".into(),
                original_path: Some("old name.txt".into()),
                area: ChangeArea::Staged,
                status: FileStatus::Renamed
            }
        );
        assert_eq!(parsed.files[1].path, "after.txt");
        assert_eq!(parsed.counts.renamed, 1);
        assert_eq!(parsed.counts.modified, 1);
    }

    #[test]
    fn unmerged_and_untracked_entries() {
        let input = format!(
            "{}u UU N... 100644 100644 100644 100644 {ZERO} {ZERO} {ZERO} conflict.txt\0? scratch dir/new.txt\0",
            headers("main", &[]),
        );
        let parsed = parse_status(&input).unwrap();
        assert_eq!(
            parsed.files,
            vec![
                FileChange {
                    path: "conflict.txt".into(),
                    original_path: None,
                    area: ChangeArea::Conflicted,
                    status: FileStatus::Conflicted
                },
                FileChange {
                    path: "scratch dir/new.txt".into(),
                    original_path: None,
                    area: ChangeArea::Untracked,
                    status: FileStatus::Untracked
                },
            ]
        );
        assert_eq!((parsed.counts.conflicted, parsed.counts.untracked), (1, 1));
    }

    #[test]
    fn malformed_input_is_an_error_not_a_panic() {
        for input in [
            "",
            "# branch.oid abc\0",
            "# branch.oid abc\0# branch.head main\0# branch.ab +x -1\0",
            "# branch.oid abc\0# branch.head main\0Z what\0",
            "# branch.oid abc\0# branch.head main\x0001 M. N...\0",
            "# branch.oid abc\0# branch.head main\0? \0",
            "# branch.oid (initial)\0# branch.head (detached)\0",
        ] {
            assert!(
                matches!(parse_status(input), Err(CoreError::InvalidGitOutput { .. })),
                "{input:?}"
            );
        }
    }
}
