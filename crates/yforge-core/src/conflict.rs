use std::fs;
use std::path::Path;

use crate::error::CoreError;
use crate::git;
use crate::model::{ConflictFile, ConflictSegment, ConflictSide, ConflictSides};
use crate::operation::{has_conflict_markers, mark_resolved, require_conflicted};
use crate::repo;
use crate::stage;

const LS_FILES_COMMAND: &str = "git ls-files --unmerged";

enum Marker {
    Start,
    Base,
    Divider,
    End,
}

fn marker(line: &str) -> Option<Marker> {
    let is = |sigil: &str| line == sigil || line.starts_with(&format!("{sigil} "));
    if is("<<<<<<<") {
        Some(Marker::Start)
    } else if is("|||||||") {
        Some(Marker::Base)
    } else if line == "=======" {
        Some(Marker::Divider)
    } else if is(">>>>>>>") {
        Some(Marker::End)
    } else {
        None
    }
}

enum Step {
    Continue,
    Done,
    Broken,
}

struct Region {
    raw: Vec<String>,
    current: Vec<String>,
    base: Option<Vec<String>>,
    incoming: Vec<String>,
    stage: u8,
}

impl Region {
    fn start(line: String) -> Self {
        Self {
            raw: vec![line],
            current: Vec::new(),
            base: None,
            incoming: Vec::new(),
            stage: 1,
        }
    }

    fn accept(&mut self, line: &str, seen: Option<Marker>) -> Step {
        match (self.stage, seen) {
            (1, Some(Marker::Base)) => {
                self.base = Some(Vec::new());
                self.stage = 2;
            }
            (1 | 2, Some(Marker::Divider)) => self.stage = 3,
            (_, None) => match self.stage {
                1 => self.current.push(line.to_owned()),
                2 => self.base.get_or_insert_with(Vec::new).push(line.to_owned()),
                _ => self.incoming.push(line.to_owned()),
            },
            (3, Some(Marker::End)) => return Step::Done,
            _ => return Step::Broken,
        }
        self.raw.push(line.to_owned());
        Step::Continue
    }
}

fn push_text(segments: &mut Vec<ConflictSegment>, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }
    if let Some(ConflictSegment::Text { lines: last }) = segments.last_mut() {
        last.extend(lines);
    } else {
        segments.push(ConflictSegment::Text { lines });
    }
}

pub(crate) fn majority_eol(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let bare = text.matches('\n').count() - crlf;
    if crlf > bare {
        "\r\n"
    } else {
        "\n"
    }
}

fn split_lines(text: &str) -> (String, bool, Vec<String>) {
    let final_newline = text.ends_with('\n');
    let body = text.strip_suffix('\n').unwrap_or(text);
    let lines = if text.is_empty() {
        Vec::new()
    } else {
        body.split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line).to_owned())
            .collect()
    };
    (majority_eol(text).to_owned(), final_newline, lines)
}

pub(crate) fn parse_conflicts(text: &str) -> (String, bool, Vec<ConflictSegment>) {
    let (eol, final_newline, lines) = split_lines(text);
    let mut segments = Vec::new();
    let mut plain: Vec<String> = Vec::new();
    let mut region: Option<Region> = None;
    for line in lines {
        let seen = marker(&line);
        let starts = matches!(seen, Some(Marker::Start));
        let Some(mut open) = region.take() else {
            if starts {
                region = Some(Region::start(line));
            } else {
                plain.push(line);
            }
            continue;
        };
        if starts {
            plain.extend(open.raw);
            region = Some(Region::start(line));
            continue;
        }
        match open.accept(&line, seen) {
            Step::Continue => region = Some(open),
            Step::Done => {
                push_text(&mut segments, std::mem::take(&mut plain));
                segments.push(ConflictSegment::Conflict {
                    current: open.current,
                    incoming: open.incoming,
                    base: open.base,
                });
            }
            Step::Broken => {
                plain.extend(open.raw);
                plain.push(line);
            }
        }
    }
    if let Some(open) = region {
        plain.extend(open.raw);
    }
    push_text(&mut segments, plain);
    (eol, final_newline, segments)
}

fn read_sides(root: &Path, file: &str) -> Result<ConflictSides, CoreError> {
    let output = git::run(root, &["ls-files", "--unmerged", "-z", "--", file])?;
    let mut sides = ConflictSides {
        base: false,
        current: false,
        incoming: false,
    };
    for entry in output.split('\0').filter(|entry| !entry.is_empty()) {
        let (meta, _) = entry.split_once('\t').ok_or_else(|| {
            CoreError::invalid_output(LS_FILES_COMMAND, format!("malformed entry {entry:?}"))
        })?;
        match meta.rsplit(' ').next() {
            Some("1") => sides.base = true,
            Some("2") => sides.current = true,
            Some("3") => sides.incoming = true,
            _ => {
                return Err(CoreError::invalid_output(
                    LS_FILES_COMMAND,
                    format!("unexpected stage in {entry:?}"),
                ))
            }
        }
    }
    Ok(sides)
}

pub fn conflict_file(path: &Path, file: &str) -> Result<ConflictFile, CoreError> {
    let root = repo::open(path)?;
    require_conflicted(&root, &[file.to_owned()])?;
    let sides = read_sides(&root, file)?;
    let bytes = fs::read(root.join(file)).ok();
    let text = bytes.as_ref().and_then(|bytes| {
        (!bytes.contains(&0))
            .then(|| String::from_utf8(bytes.clone()).ok())
            .flatten()
    });
    let binary = bytes.is_some() && text.is_none();
    let (eol, final_newline, segments) = match &text {
        Some(text) => parse_conflicts(text),
        None => ("\n".to_owned(), true, Vec::new()),
    };
    Ok(ConflictFile {
        file: file.to_owned(),
        eol,
        final_newline,
        binary,
        sides,
        segments,
    })
}

fn write_atomic(target: &Path, content: &str) -> Result<(), CoreError> {
    let failure = |error: std::io::Error| CoreError::GitFailed {
        command: format!("write {}", target.display()),
        status: None,
        stderr: error.to_string(),
    };
    let name = target
        .file_name()
        .ok_or_else(|| CoreError::invalid_request("the file has no name"))?
        .to_string_lossy();
    let temporary = target.with_file_name(format!(".{name}.yforge-{}", std::process::id()));
    let written = fs::write(&temporary, content).and_then(|()| {
        if let Ok(existing) = fs::metadata(target) {
            fs::set_permissions(&temporary, existing.permissions())?;
        }
        fs::rename(&temporary, target)
    });
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(failure(error));
    }
    Ok(())
}

pub fn conflict_resolve(path: &Path, file: &str, content: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let files = [file.to_owned()];
    require_conflicted(&root, &files)?;
    if has_conflict_markers(content) {
        return Err(CoreError::ConflictMarkers {
            file: file.to_owned(),
        });
    }
    write_atomic(&root.join(file), content)?;
    mark_resolved(&root, &files)
}

pub fn conflict_take_side(path: &Path, file: &str, side: ConflictSide) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    let files = [file.to_owned()];
    require_conflicted(&root, &files)?;
    let sides = read_sides(&root, file)?;
    let (present, flag) = match side {
        ConflictSide::Current => (sides.current, "--ours"),
        ConflictSide::Incoming => (sides.incoming, "--theirs"),
    };
    if present {
        git::run(&root, &["checkout", flag, "--", file])?;
        mark_resolved(&root, &files)
    } else {
        git::run(&root, &stage::with_paths(&["rm", "--quiet"], &files)).map(drop)
    }
}

pub fn conflict_reset(path: &Path, file: &str) -> Result<(), CoreError> {
    let root = repo::open(path)?;
    require_conflicted(&root, &[file.to_owned()])?;
    git::run(&root, &["checkout", "--merge", "--", file]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|line| (*line).to_owned()).collect()
    }

    fn conflict(current: &[&str], incoming: &[&str], base: Option<&[&str]>) -> ConflictSegment {
        ConflictSegment::Conflict {
            current: lines(current),
            incoming: lines(incoming),
            base: base.map(lines),
        }
    }

    fn text(items: &[&str]) -> ConflictSegment {
        ConflictSegment::Text {
            lines: lines(items),
        }
    }

    #[test]
    fn parses_a_two_way_region_between_plain_text() {
        let source = "one\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\ntwo\n";

        let (eol, final_newline, segments) = parse_conflicts(source);

        assert_eq!(eol, "\n");
        assert!(final_newline);
        assert_eq!(
            segments,
            vec![
                text(&["one"]),
                conflict(&["ours"], &["theirs"], None),
                text(&["two"])
            ]
        );
    }

    #[test]
    fn parses_diff3_regions_with_their_base() {
        let source = "<<<<<<< HEAD\nours\n||||||| base\norig\n=======\ntheirs\n>>>>>>> topic\n";

        let (_, _, segments) = parse_conflicts(source);

        assert_eq!(
            segments,
            vec![conflict(&["ours"], &["theirs"], Some(&["orig"]))]
        );
    }

    #[test]
    fn parses_several_regions_and_empty_sides() {
        let source = "<<<<<<< a\n=======\nx\n>>>>>>> b\nmid\n<<<<<<< a\ny\n=======\n>>>>>>> b\n";

        let (_, _, segments) = parse_conflicts(source);

        assert_eq!(
            segments,
            vec![
                conflict(&[], &["x"], None),
                text(&["mid"]),
                conflict(&["y"], &[], None)
            ]
        );
    }

    #[test]
    fn keeps_crlf_and_a_missing_final_newline() {
        let source = "a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> t\r\nz";

        let (eol, final_newline, segments) = parse_conflicts(source);

        assert_eq!(eol, "\r\n");
        assert!(!final_newline);
        assert_eq!(
            segments,
            vec![
                text(&["a"]),
                conflict(&["ours"], &["theirs"], None),
                text(&["z"])
            ]
        );
    }

    #[test]
    fn treats_unterminated_or_misordered_markers_as_plain_text() {
        for source in [
            "<<<<<<< HEAD\nours\n",
            "<<<<<<< HEAD\nours\n=======\ntheirs\n",
            "=======\n>>>>>>> t\n",
            "Title\n=======\nbody\n",
        ] {
            let (_, _, segments) = parse_conflicts(source);
            assert!(
                segments
                    .iter()
                    .all(|segment| matches!(segment, ConflictSegment::Text { .. })),
                "{source:?}"
            );
            let joined: Vec<String> = segments
                .into_iter()
                .flat_map(|segment| match segment {
                    ConflictSegment::Text { lines } => lines,
                    ConflictSegment::Conflict { .. } => Vec::new(),
                })
                .collect();
            assert_eq!(joined.join("\n") + "\n", source);
        }
    }

    #[test]
    fn restarts_at_a_second_opening_marker() {
        let source = "<<<<<<< a\nx\n<<<<<<< b\ny\n=======\nz\n>>>>>>> c\n";

        let (_, _, segments) = parse_conflicts(source);

        assert_eq!(
            segments,
            vec![text(&["<<<<<<< a", "x"]), conflict(&["y"], &["z"], None)]
        );
    }

    #[test]
    fn an_empty_file_has_no_segments() {
        assert_eq!(parse_conflicts(""), ("\n".to_owned(), false, vec![]));
    }
}
