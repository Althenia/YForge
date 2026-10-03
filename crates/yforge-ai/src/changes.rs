use serde::de::DeserializeOwned;
use yforge_core::ChangesContext;

use crate::error::{AiError, Result};
use crate::json::{cap, parse_reply};

pub fn context_text(context: &ChangesContext) -> String {
    let message = context
        .message
        .as_deref()
        .map(|message| format!("Commit message:\n{message}\n\n"))
        .unwrap_or_default();
    let files: String = context
        .files
        .iter()
        .map(|file| format!("- {file}\n"))
        .collect();
    format!(
        "{message}Changed files:\n{files}\nDiff per file (files marked as withheld, binary, truncated or omitted are incomplete):\n{}",
        context.diff
    )
}

pub fn invalid(label: &str, reason: &str) -> AiError {
    AiError::InvalidResponse {
        provider: label.to_owned(),
        reason: cap(reason),
    }
}

pub fn decode<T: DeserializeOwned>(label: &str, reply: &str) -> Result<T> {
    let value = parse_reply(reply).map_err(|reason| invalid(label, &reason))?;
    serde_json::from_value(value).map_err(|error| invalid(label, &error.to_string()))
}

pub fn known<'a>(context: &'a ChangesContext, path: &str) -> Option<&'a String> {
    context.files.iter().find(|file| *file == path)
}

pub fn examples(missing: &[&String]) -> String {
    missing
        .iter()
        .take(5)
        .map(|file| file.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
pub fn sample() -> ChangesContext {
    ChangesContext {
        message: None,
        diff: "=== a.rs (modified) ===\n+fn a()\n=== .env (untracked, content withheld: secret file) ===\n=== b.rs (added) ===\n+fn b()\n".to_owned(),
        files: vec![".env".to_owned(), "a.rs".to_owned(), "b.rs".to_owned()],
        excluded: vec![".env".to_owned()],
        truncated: vec!["b.rs".to_owned()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_context_lists_every_file_and_the_diff_and_a_commit_message_when_there_is_one() {
        let mut context = sample();
        let text = context_text(&context);
        assert!(text.starts_with("Changed files:\n- .env\n- a.rs\n- b.rs\n"));
        assert!(text.contains("+fn a()"));
        assert!(!text.contains("Commit message"));

        context.message = Some("Add a\n\nBecause.".to_owned());
        assert!(context_text(&context)
            .starts_with("Commit message:\nAdd a\n\nBecause.\n\nChanged files:"));
    }
}
