use std::collections::HashSet;

use serde::Deserialize;
use yforge_core::{ChangesContext, Explanation, ExplanationItem};

use crate::changes::{decode, invalid, known};
use crate::error::Result;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    files: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Item {
    path: String,
    text: String,
}

pub fn parse(label: &str, reply: &str, context: &ChangesContext) -> Result<Explanation> {
    let parsed: Reply = decode(label, reply)?;
    if parsed.files.is_empty() {
        return Err(invalid(label, "it explains no files"));
    }
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for item in parsed.files {
        if known(context, &item.path).is_none() {
            return Err(invalid(
                label,
                &format!("it explains an unknown file `{}`", item.path),
            ));
        }
        if !seen.insert(item.path.clone()) {
            return Err(invalid(
                label,
                &format!("it explains `{}` twice", item.path),
            ));
        }
        let text = item.text.trim();
        if text.is_empty() {
            return Err(invalid(
                label,
                &format!("the explanation of `{}` is blank", item.path),
            ));
        }
        items.push(ExplanationItem {
            path: item.path,
            text: text.to_owned(),
        });
    }
    items.sort_by_key(|item| context.files.iter().position(|file| *file == item.path));
    Ok(Explanation {
        items,
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
    fn items_follow_the_file_order_and_carry_the_notes() {
        let explanation = parse(
            "P",
            r#"{"files":[{"path":"b.rs","text":" Adds b. "},{"path":"a.rs","text":"Adds a."}]}"#,
            &sample(),
        )
        .unwrap();

        let shown: Vec<(&str, &str)> = explanation
            .items
            .iter()
            .map(|item| (item.path.as_str(), item.text.as_str()))
            .collect();
        assert_eq!(shown, [("a.rs", "Adds a."), ("b.rs", "Adds b.")]);
        assert_eq!(explanation.excluded, [".env"]);
        assert_eq!(explanation.truncated, ["b.rs"]);
    }

    #[test]
    fn each_violation_is_named() {
        assert!(reason(r#"{"files":[]}"#).contains("no files"));
        assert!(reason(r#"{"files":[{"path":"zzz","text":"x"}]}"#).contains("unknown file `zzz`"));
        assert!(
            reason(r#"{"files":[{"path":"a.rs","text":"x"},{"path":"a.rs","text":"y"}]}"#)
                .contains("twice")
        );
        assert!(reason(r#"{"files":[{"path":"a.rs","text":"  "}]}"#).contains("blank"));
        assert!(reason(r#"{"files":[{"path":"a.rs","text":"x","extra":1}]}"#).contains("extra"));
        assert!(reason("not json").contains("JSON"));
    }
}
