use yforge_core::AiFeature;

pub const CONTEXT_PLACEHOLDER: &str = "{context}";
const FALLBACK_SYSTEM: &str = "Follow the instructions in the user message.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prompt {
    pub system: String,
    pub user: String,
}

pub fn render(template: &str, context: &str) -> Prompt {
    let (before, after) = template
        .split_once(CONTEXT_PLACEHOLDER)
        .unwrap_or((template, ""));
    let system = before.trim();
    Prompt {
        system: if system.is_empty() {
            FALLBACK_SYSTEM.to_owned()
        } else {
            system.to_owned()
        },
        user: format!("{context}{after}"),
    }
}

pub fn validate_template(template: &str) -> Result<(), String> {
    match template.matches(CONTEXT_PLACEHOLDER).count() {
        1 => Ok(()),
        0 => Err(format!(
            "the prompt must contain the {CONTEXT_PLACEHOLDER} placeholder"
        )),
        _ => Err(format!(
            "the prompt must contain {CONTEXT_PLACEHOLDER} exactly once"
        )),
    }
}

pub fn default_template(feature: AiFeature) -> &'static str {
    match feature {
        AiFeature::GenerateCommit => COMMIT_TEMPLATE,
        AiFeature::Recompose => RECOMPOSE_TEMPLATE,
        AiFeature::ConflictFix => CONFLICT_TEMPLATE,
    }
}

const COMMIT_TEMPLATE: &str = "You write Git commit messages. Reply with one JSON object and nothing else, in exactly this shape: {\"summary\": string, \"description\": string}. The summary is one line of at most 72 characters in the imperative mood, without a trailing period, and follows the style of the recent commit subjects you are given. The description explains what changed and why in plain paragraphs wrapped at 72 columns, or is an empty string when the summary is enough. Base the message only on the staged changes provided. Do not use tools, do not read files, and do not wrap the JSON in any other text.\n\n{context}";

const RECOMPOSE_TEMPLATE: &str = "You regroup the changes of unpushed Git commits into a new series of commits. You receive a list of units: each hunk has an id, and some files can only be moved as a whole. Reply with one JSON object and nothing else, in exactly this shape: {\"groups\": [{\"message\": string, \"changes\": [{\"kind\": \"hunk\", \"id\": string} or {\"kind\": \"file\", \"path\": string}]}]}. Every hunk id and every whole-file unit must appear in exactly one group; never invent ids or paths, and never list a hunk of a file that you also list as a whole file. Groups become commits in the order given, so order them so that each commit is a coherent, reviewable step. A message is a summary line of at most 72 characters in the imperative mood, optionally followed by a blank line and a description. Do not use tools, do not read files, and do not wrap the JSON in any other text.\n\n{context}";

const CONFLICT_TEMPLATE: &str = "You resolve Git merge conflicts. You receive numbered conflict regions; each has the CURRENT side (the checked-out branch), the INCOMING side, and sometimes the BASE (the common ancestor), with a few lines of surrounding context. Reply with one JSON object and nothing else, in exactly this shape: {\"regions\": [{\"index\": number, \"text\": string, \"rationale\": string}]}. Give exactly one entry per region. text is the complete replacement for that region: the resolved lines joined with newline characters, without conflict markers and without the surrounding context, and an empty string when the region should resolve to no lines. rationale is one or two sentences saying why. Preserve the intent of both sides where they are compatible. Do not use tools, do not read files, and do not wrap the JSON in any other text.\n\n{context}";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_templates_render_the_instructions_as_system_and_the_context_as_user() {
        for feature in AiFeature::ALL {
            let template = default_template(feature);
            assert_eq!(validate_template(template), Ok(()));
            let prompt = render(template, "CONTEXT BODY");
            assert_eq!(prompt.user, "CONTEXT BODY");
            assert!(prompt.system.starts_with("You "), "{feature:?}");
            assert!(!prompt.system.contains(CONTEXT_PLACEHOLDER));
        }
    }

    #[test]
    fn a_custom_template_keeps_text_after_the_context_in_the_user_message() {
        let prompt = render("Be brief.\n{context}\nAnswer in JSON.", "diff");

        assert_eq!(prompt.system, "Be brief.");
        assert_eq!(prompt.user, "diff\nAnswer in JSON.");
    }

    #[test]
    fn a_template_that_starts_with_the_context_still_gets_a_system_message() {
        let prompt = render("{context} Summarize.", "diff");

        assert_eq!(prompt.system, FALLBACK_SYSTEM);
        assert_eq!(prompt.user, "diff Summarize.");
    }

    #[test]
    fn a_template_needs_the_placeholder_exactly_once() {
        assert!(validate_template("no placeholder").is_err());
        assert!(validate_template("{context} and {context}").is_err());
        assert_eq!(validate_template("x {context}"), Ok(()));
    }
}
