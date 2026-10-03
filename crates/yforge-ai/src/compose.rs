use std::collections::HashSet;

use serde::Deserialize;
use yforge_core::{ChangesContext, ComposeGroup, ComposeProposal};

use crate::changes::{decode, examples, invalid, known};
use crate::error::Result;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    groups: Vec<Group>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Group {
    message: String,
    files: Vec<String>,
}

pub fn parse(label: &str, reply: &str, context: &ChangesContext) -> Result<ComposeProposal> {
    let parsed: Reply = decode(label, reply)?;
    if parsed.groups.is_empty() {
        return Err(invalid(label, "there are no groups"));
    }
    let mut claimed: HashSet<&str> = HashSet::new();
    let mut groups = Vec::new();
    for (position, group) in parsed.groups.into_iter().enumerate() {
        let number = position + 1;
        let message = group.message.trim();
        if message.is_empty() || message.contains('\0') {
            return Err(invalid(
                label,
                &format!("group {number} has a blank message"),
            ));
        }
        if group.files.is_empty() {
            return Err(invalid(label, &format!("group {number} has no files")));
        }
        for file in &group.files {
            let Some(listed) = known(context, file) else {
                return Err(invalid(
                    label,
                    &format!("group {number} names an unknown file `{file}`"),
                ));
            };
            if !claimed.insert(listed.as_str()) {
                return Err(invalid(
                    label,
                    &format!("group {number} repeats `{file}`, which is already in a group"),
                ));
            }
        }
        groups.push(ComposeGroup {
            message: message.to_owned(),
            files: group.files,
        });
    }
    let missing: Vec<&String> = context
        .files
        .iter()
        .filter(|file| !claimed.contains(file.as_str()))
        .collect();
    if !missing.is_empty() {
        return Err(invalid(
            label,
            &format!(
                "{} file(s) are not in any group, for example {}",
                missing.len(),
                examples(&missing)
            ),
        ));
    }
    Ok(ComposeProposal {
        groups,
        excluded: context.excluded.clone(),
        truncated: context.truncated.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::sample;
    use crate::AiError;

    fn reason(reply: &str) -> String {
        match parse("P", reply, &sample()).unwrap_err() {
            AiError::InvalidResponse { reason, .. } => reason,
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn a_complete_assignment_becomes_groups_in_order_with_the_notes() {
        let proposal = parse(
            "P",
            r#"{"groups":[{"message":" Add a\n\nBody ","files":["a.rs",".env"]},{"message":"Add b","files":["b.rs"]}]}"#,
            &sample(),
        )
        .unwrap();

        assert_eq!(
            proposal.groups,
            [
                ComposeGroup {
                    message: "Add a\n\nBody".to_owned(),
                    files: vec!["a.rs".to_owned(), ".env".to_owned()]
                },
                ComposeGroup {
                    message: "Add b".to_owned(),
                    files: vec!["b.rs".to_owned()]
                },
            ]
        );
        assert_eq!(proposal.excluded, [".env"]);
        assert_eq!(proposal.truncated, ["b.rs"]);
    }

    #[test]
    fn every_file_must_be_in_exactly_one_group_and_nothing_is_repaired() {
        assert!(reason(r#"{"groups":[]}"#).contains("no groups"));
        assert!(
            reason(r#"{"groups":[{"message":" ","files":["a.rs"]}]}"#).contains("blank message")
        );
        assert!(reason(r#"{"groups":[{"message":"x","files":[]}]}"#).contains("no files"));
        assert!(reason(r#"{"groups":[{"message":"x","files":["nope"]}]}"#)
            .contains("unknown file `nope`"));
        assert!(reason(r#"{"groups":[{"message":"x","files":["a.rs",".env","b.rs"]},{"message":"y","files":["a.rs"]}]}"#)
            .contains("repeats `a.rs`"));
        assert!(reason(r#"{"groups":[{"message":"x","files":["a.rs"]}]}"#)
            .contains("2 file(s) are not in any group, for example .env, b.rs"));
        assert!(
            reason(r#"{"groups":[{"message":"x","files":["a.rs"],"changes":[]}]}"#)
                .contains("changes")
        );
    }
}
