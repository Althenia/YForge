use yforge_core::{ChangesContext, StashDraft};

use crate::commit::parse_message;
use crate::error::Result;

pub fn parse(label: &str, reply: &str, context: &ChangesContext) -> Result<StashDraft> {
    let message = parse_message(label, reply)?;
    Ok(StashDraft {
        summary: message.summary,
        description: message.description,
        excluded: context.excluded.clone(),
        truncated: context.truncated.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::sample;
    use crate::AiError;

    #[test]
    fn a_valid_reply_becomes_a_stash_draft_carrying_the_notes() {
        let draft = parse(
            "P",
            r#"{"summary":" WIP: parser rewrite ","description":"Half done.\n"}"#,
            &sample(),
        )
        .unwrap();

        assert_eq!(draft.summary, "WIP: parser rewrite");
        assert_eq!(draft.description, "Half done.");
        assert_eq!(draft.excluded, [".env"]);
        assert_eq!(draft.truncated, ["b.rs"]);
    }

    #[test]
    fn a_long_summary_is_cut_to_one_line_of_72_characters() {
        let reply = serde_json::json!({"summary": "word ".repeat(30)}).to_string();
        let draft = parse("P", &reply, &sample()).unwrap();
        assert!(draft.summary.chars().count() <= 72);
        assert_eq!(draft.description, "");
    }

    #[test]
    fn schema_violations_are_invalid_responses() {
        for reply in [
            "nope",
            "{}",
            r#"{"summary":"  "}"#,
            r#"{"summary":"x","description":1}"#,
        ] {
            assert!(
                matches!(
                    parse("P", reply, &sample()).unwrap_err(),
                    AiError::InvalidResponse { .. }
                ),
                "{reply}"
            );
        }
    }
}
