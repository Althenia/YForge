use serde_json::Value;
use yforge_core::{CommitContext, CommitDraft};

use crate::error::{AiError, Result};
use crate::json::parse_reply;

const SUMMARY_LIMIT: usize = 72;

pub fn context_text(context: &CommitContext) -> String {
    let subjects = if context.recent_subjects.is_empty() {
        "(none: this repository has no commits yet)".to_owned()
    } else {
        context
            .recent_subjects
            .iter()
            .map(|subject| format!("- {subject}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "Recent commit subjects, newest first:\n{subjects}\n\nStaged changes (files marked as withheld, binary, truncated or omitted are incomplete):\n{}",
        context.diff
    )
}

pub fn fit_summary(summary: &str) -> (String, bool) {
    let first = summary.trim().lines().next().unwrap_or_default().trim();
    let changed = first != summary.trim();
    if first.chars().count() <= SUMMARY_LIMIT {
        return (first.to_owned(), changed);
    }
    let hard: String = first.chars().take(SUMMARY_LIMIT).collect();
    let cut = match hard.rfind(' ') {
        Some(space) if hard[..space].chars().count() >= SUMMARY_LIMIT / 2 => &hard[..space],
        _ => hard.as_str(),
    };
    (cut.trim_end().to_owned(), true)
}

pub struct Message {
    pub summary: String,
    pub description: String,
    pub summary_trimmed: bool,
}

pub fn parse_message(label: &str, reply: &str) -> Result<Message> {
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: label.to_owned(),
        reason: reason.to_owned(),
    };
    let value = parse_reply(reply).map_err(|reason| invalid(&reason))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("the JSON is not an object"))?;
    let summary = object
        .get("summary")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("`summary` is missing or not a string"))?;
    let description = match object.get("description") {
        None | Some(Value::Null) => "",
        Some(Value::String(text)) => text.as_str(),
        Some(_) => return Err(invalid("`description` is not a string")),
    };
    let (summary, summary_trimmed) = fit_summary(summary);
    if summary.is_empty() {
        return Err(invalid("`summary` is empty"));
    }
    Ok(Message {
        summary,
        description: description.trim().to_owned(),
        summary_trimmed,
    })
}

pub fn parse(label: &str, reply: &str, context: &CommitContext) -> Result<CommitDraft> {
    let message = parse_message(label, reply)?;
    Ok(CommitDraft {
        summary: message.summary,
        description: message.description,
        summary_trimmed: message.summary_trimmed,
        excluded: context.excluded.clone(),
        truncated: context.truncated.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> CommitContext {
        CommitContext {
            diff: "=== a.txt (modified) ===\n+x\n".to_owned(),
            recent_subjects: vec!["Fix parser".to_owned(), "Add cache".to_owned()],
            excluded: vec![".env".to_owned()],
            truncated: vec!["big.txt".to_owned()],
        }
    }

    #[test]
    fn the_context_lists_recent_subjects_and_the_diff() {
        let text = context_text(&context());
        assert!(text.contains("- Fix parser\n- Add cache"));
        assert!(text.contains("=== a.txt (modified) ==="));
    }

    #[test]
    fn a_valid_reply_becomes_a_draft_carrying_the_exclusions() {
        let draft = parse(
            "P",
            "{\"summary\": \" Add cache \", \"description\": \"Why.\\n\"}",
            &context(),
        )
        .unwrap();
        assert_eq!(draft.summary, "Add cache");
        assert_eq!(draft.description, "Why.");
        assert!(!draft.summary_trimmed);
        assert_eq!(draft.excluded, [".env"]);
        assert_eq!(draft.truncated, ["big.txt"]);
    }

    #[test]
    fn a_missing_description_is_empty() {
        let draft = parse("P", "{\"summary\": \"Do it\"}", &context()).unwrap();
        assert_eq!(draft.description, "");
    }

    #[test]
    fn a_long_summary_is_cut_at_a_word_and_flagged() {
        let long = format!("{} {}", "word".repeat(15), "tail ".repeat(10));
        let (fit, trimmed) = fit_summary(&long);
        assert!(trimmed);
        assert!(fit.chars().count() <= 72);
        assert!(fit.starts_with(&"word".repeat(15)));
        assert!(!fit.ends_with(' '));
    }

    #[test]
    fn a_summary_without_spaces_is_cut_hard_at_72_characters() {
        let (fit, trimmed) = fit_summary(&"é".repeat(100));
        assert!(trimmed);
        assert_eq!(fit.chars().count(), 72);
    }

    #[test]
    fn a_multi_line_summary_keeps_its_first_line_and_is_flagged() {
        assert_eq!(fit_summary("First\nsecond"), ("First".to_owned(), true));
        assert_eq!(fit_summary("Only"), ("Only".to_owned(), false));
    }

    #[test]
    fn schema_violations_are_invalid_responses() {
        for reply in [
            "not json",
            "[1]",
            "{}",
            "{\"summary\": 3}",
            "{\"summary\": \"  \"}",
            "{\"summary\": \"x\", \"description\": 4}",
        ] {
            let error = parse("P", reply, &context()).unwrap_err();
            assert!(matches!(error, AiError::InvalidResponse { .. }), "{reply}");
        }
    }
}
