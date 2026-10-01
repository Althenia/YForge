use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use yforge_core::{
    cut_at_line, is_secret_file, render_hunk, status_word, RecomposeChange, RecomposeFile,
    RecomposeGroup, RecomposePreview,
};

use crate::error::{AiError, Result};
use crate::json::{cap, parse_reply};

const TOTAL_BUDGET: usize = 60 * 1024;
const HUNK_BUDGET: usize = 4 * 1024;
const MIN_USEFUL_BUDGET: usize = 256;

pub struct RecomposeContext {
    pub text: String,
    pub excluded: Vec<String>,
}

fn is_whole(file: &RecomposeFile) -> bool {
    file.whole_file_only || file.hunks.is_empty()
}

fn unit(value: serde_json::Value) -> String {
    value.to_string()
}

pub fn context_text(preview: &RecomposePreview) -> RecomposeContext {
    let mut text = String::new();
    let mut excluded = Vec::new();
    let mut spent = 0_usize;
    for file in &preview.files {
        let secret = is_secret_file(&file.path);
        if secret {
            excluded.push(file.path.clone());
        }
        let binary = if file.binary { ", binary" } else { "" };
        let whole = if is_whole(file) {
            ", whole file only"
        } else {
            ""
        };
        text.push_str(&format!(
            "FILE {} ({}{binary}{whole})\n",
            file.path,
            status_word(file.status)
        ));
        if is_whole(file) {
            text.push_str(&format!(
                "  UNIT {}\n",
                unit(serde_json::json!({"kind": "file", "path": file.path}))
            ));
            continue;
        }
        for hunk in &file.hunks {
            text.push_str(&format!(
                "  UNIT {}\n",
                unit(serde_json::json!({"kind": "hunk", "id": hunk.id}))
            ));
            if secret {
                text.push_str("  [content withheld: secret file]\n");
                continue;
            }
            let remaining = TOTAL_BUDGET.saturating_sub(spent);
            if remaining < MIN_USEFUL_BUDGET {
                text.push_str("  [content omitted: size budget reached]\n");
                continue;
            }
            let body = render_hunk(&hunk.hunk);
            let (kept, omitted) = cut_at_line(&body, HUNK_BUDGET.min(remaining));
            spent += kept.len();
            text.push_str(kept);
            if omitted > 0 {
                text.push_str(&format!("[hunk truncated: {omitted} bytes omitted]\n"));
            }
        }
    }
    RecomposeContext {
        text: format!("Regroup these changes. Copy each unit object exactly.\n\n{text}"),
        excluded,
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    groups: Vec<Group>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group {
    message: String,
    changes: Vec<Change>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Change {
    Hunk { id: String },
    File { path: String },
}

struct Catalog<'a> {
    files: HashMap<&'a str, &'a RecomposeFile>,
    hunks: HashMap<&'a str, &'a str>,
}

impl<'a> Catalog<'a> {
    fn new(preview: &'a RecomposePreview) -> Self {
        let mut catalog = Self {
            files: HashMap::new(),
            hunks: HashMap::new(),
        };
        for file in &preview.files {
            catalog.files.insert(&file.path, file);
            if !is_whole(file) {
                for hunk in &file.hunks {
                    catalog.hunks.insert(&hunk.id, &file.path);
                }
            }
        }
        catalog
    }

    fn atoms(&self, preview: &'a RecomposePreview) -> Vec<String> {
        preview
            .files
            .iter()
            .flat_map(|file| {
                if is_whole(file) {
                    vec![format!("file {}", file.path)]
                } else {
                    file.hunks
                        .iter()
                        .map(|hunk| format!("hunk {}", hunk.id))
                        .collect()
                }
            })
            .collect()
    }
}

pub fn parse(label: &str, reply: &str, preview: &RecomposePreview) -> Result<Vec<RecomposeGroup>> {
    let invalid = |reason: String| AiError::InvalidResponse {
        provider: label.to_owned(),
        reason: cap(&reason),
    };
    let value = parse_reply(reply).map_err(invalid)?;
    let parsed: Reply =
        serde_json::from_value(value).map_err(|error| invalid(error.to_string()))?;
    if parsed.groups.is_empty() {
        return Err(invalid("there are no groups".to_owned()));
    }
    let catalog = Catalog::new(preview);
    let mut claimed: HashSet<String> = HashSet::new();
    let mut claim = |atom: String, group: usize| -> std::result::Result<(), String> {
        if claimed.insert(atom.clone()) {
            Ok(())
        } else {
            Err(format!(
                "group {group} repeats `{atom}`, which is already in another change"
            ))
        }
    };
    let mut groups = Vec::new();
    for (position, group) in parsed.groups.into_iter().enumerate() {
        let number = position + 1;
        let message = group.message.trim();
        if message.is_empty() || message.contains('\0') {
            return Err(invalid(format!("group {number} has a blank message")));
        }
        if group.changes.is_empty() {
            return Err(invalid(format!("group {number} has no changes")));
        }
        let mut changes = Vec::new();
        for change in group.changes {
            match &change {
                Change::Hunk { id } => {
                    if !catalog.hunks.contains_key(id.as_str()) {
                        return Err(invalid(format!(
                            "group {number} names an unknown or whole-file-only hunk `{id}`"
                        )));
                    }
                    claim(format!("hunk {id}"), number).map_err(invalid)?;
                    changes.push(RecomposeChange::Hunk { id: id.clone() });
                }
                Change::File { path } => {
                    let Some(file) = catalog.files.get(path.as_str()) else {
                        return Err(invalid(format!(
                            "group {number} names an unknown file `{path}`"
                        )));
                    };
                    if is_whole(file) {
                        claim(format!("file {path}"), number).map_err(invalid)?;
                    } else {
                        for hunk in &file.hunks {
                            claim(format!("hunk {}", hunk.id), number).map_err(invalid)?;
                        }
                    }
                    changes.push(RecomposeChange::File { path: path.clone() });
                }
            }
        }
        groups.push(RecomposeGroup {
            message: message.to_owned(),
            changes,
        });
    }
    let missing: Vec<String> = catalog
        .atoms(preview)
        .into_iter()
        .filter(|atom| !claimed.contains(atom))
        .collect();
    if !missing.is_empty() {
        let shown: Vec<&str> = missing.iter().take(5).map(String::as_str).collect();
        return Err(invalid(format!(
            "{} change(s) are not in any group, for example {}",
            missing.len(),
            shown.join(", ")
        )));
    }
    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;
    use yforge_core::{DiffHunk, DiffLine, DiffLineKind, FileStatus, RecomposeFile, RecomposeHunk};

    fn hunk(id: &str, added: &str) -> RecomposeHunk {
        RecomposeHunk {
            id: id.to_owned(),
            hunk: DiffHunk {
                old_start: 1,
                old_lines: 1,
                new_start: 1,
                new_lines: 2,
                heading: String::new(),
                lines: vec![DiffLine {
                    kind: DiffLineKind::Added,
                    old_number: None,
                    new_number: Some(1),
                    text: added.to_owned(),
                    no_newline: false,
                }],
            },
        }
    }

    fn file(path: &str, whole: bool, hunks: Vec<RecomposeHunk>) -> RecomposeFile {
        RecomposeFile {
            path: path.to_owned(),
            status: FileStatus::Modified,
            binary: false,
            whole_file_only: whole,
            hunks_omitted: None,
            hunks,
        }
    }

    fn preview() -> RecomposePreview {
        RecomposePreview {
            base: "b".to_owned(),
            head: "h".to_owned(),
            pushed: false,
            files: vec![
                file(
                    "a.rs",
                    false,
                    vec![
                        hunk("a.rs@1,1+1,2", "fn a()"),
                        hunk("a.rs@9,1+10,2", "fn b()"),
                    ],
                ),
                file("logo.png", true, vec![]),
                file(".env", false, vec![hunk(".env@1,1+1,2", "TOKEN=hunter2")]),
            ],
        }
    }

    const VALID: &str = r#"{"groups":[
        {"message":"Add a","changes":[{"kind":"hunk","id":"a.rs@1,1+1,2"},{"kind":"file","path":"logo.png"}]},
        {"message":"Add b\n\nBody","changes":[{"kind":"hunk","id":"a.rs@9,1+10,2"},{"kind":"hunk","id":".env@1,1+1,2"}]}
    ]}"#;

    fn reason(reply: &str) -> String {
        match parse("P", reply, &preview()).unwrap_err() {
            AiError::InvalidResponse { reason, .. } => reason,
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn a_complete_assignment_becomes_groups_in_order() {
        let groups = parse("P", VALID, &preview()).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].message, "Add a");
        assert_eq!(
            groups[0].changes,
            [
                RecomposeChange::Hunk {
                    id: "a.rs@1,1+1,2".to_owned()
                },
                RecomposeChange::File {
                    path: "logo.png".to_owned()
                },
            ]
        );
        assert_eq!(groups[1].message, "Add b\n\nBody");
    }

    #[test]
    fn a_file_change_claims_every_hunk_of_a_splittable_file() {
        let reply = r#"{"groups":[
            {"message":"A","changes":[{"kind":"file","path":"a.rs"},{"kind":"file","path":"logo.png"}]},
            {"message":"B","changes":[{"kind":"file","path":".env"}]}]}"#;
        assert_eq!(parse("P", reply, &preview()).unwrap().len(), 2);
    }

    #[test]
    fn each_violation_is_named_and_nothing_is_repaired() {
        assert!(reason(r#"{"groups":[]}"#).contains("no groups"));
        assert!(reason(r#"{"groups":[{"message":" ","changes":[]}]}"#).contains("blank message"));
        assert!(reason(r#"{"groups":[{"message":"x","changes":[]}]}"#).contains("no changes"));
        assert!(
            reason(r#"{"groups":[{"message":"x","changes":[{"kind":"hunk","id":"zzz"}]}]}"#)
                .contains("unknown")
        );
        assert!(reason(
            r#"{"groups":[{"message":"x","changes":[{"kind":"file","path":"nope"}]}]}"#
        )
        .contains("unknown file"));
        assert!(reason(
            r#"{"groups":[{"message":"x","changes":[{"kind":"hunk","id":"logo.png@1,1+1,1"}]}]}"#
        )
        .contains("unknown"));
        assert!(reason(r#"{"groups":[{"message":"x","changes":[{"kind":"lines","id":"a.rs@1,1+1,2","lines":[0]}]}]}"#).contains("lines"));
        assert!(reason(r#"{"groups":[{"message":"x","changes":[{"kind":"hunk","id":"a.rs@1,1+1,2"},{"kind":"hunk","id":"a.rs@1,1+1,2"}]}]}"#).contains("repeats"));
        assert!(reason(r#"{"groups":[{"message":"x","changes":[{"kind":"hunk","id":"a.rs@1,1+1,2"}]},{"message":"y","changes":[{"kind":"file","path":"a.rs"}]}]}"#).contains("repeats"));
        assert!(reason(
            r#"{"groups":[{"message":"x","changes":[{"kind":"hunk","id":"a.rs@1,1+1,2"}]}]}"#
        )
        .contains("not in any group"));
        assert!(reason("```\nnot closed").contains("never closes"));
        assert!(reason(r#"{"groups":[{"message":"x","changes":[],"extra":1}]}"#).contains("extra"));
    }

    #[test]
    fn the_context_shows_unit_objects_and_withholds_secret_content() {
        let built = context_text(&preview());
        assert_eq!(built.excluded, [".env"]);
        assert!(built
            .text
            .contains(r#"UNIT {"id":"a.rs@1,1+1,2","kind":"hunk"}"#));
        assert!(built
            .text
            .contains(r#"UNIT {"kind":"file","path":"logo.png"}"#));
        assert!(built.text.contains("+fn a()"));
        assert!(!built.text.contains("hunter2"));
        assert!(built.text.contains("[content withheld: secret file]"));
        assert!(built.text.contains("logo.png (modified, whole file only)"));
    }

    #[test]
    fn oversized_hunks_are_cut_but_every_unit_stays_listed() {
        let big = "x".repeat(200);
        let hunks: Vec<RecomposeHunk> = (0..400)
            .map(|n| {
                let mut h = hunk(&format!("big.rs@{n},1+{n},2"), &big);
                for _ in 0..40 {
                    let line = h.hunk.lines[0].clone();
                    h.hunk.lines.push(line);
                }
                h
            })
            .collect();
        let preview = RecomposePreview {
            base: "b".to_owned(),
            head: "h".to_owned(),
            pushed: false,
            files: vec![file("big.rs", false, hunks)],
        };
        let built = context_text(&preview);
        assert!(built.text.len() < 100 * 1024);
        assert!(built
            .text
            .contains("[content omitted: size budget reached]"));
        assert!(built.text.contains("big.rs@399,1+399,2"));
    }
}
