use serde_json::Value;
use yforge_core::{PullRequestContext, PullRequestDisclosure, PullRequestDraft};

use crate::commit::fit_summary;
use crate::error::{AiError, Result};
use crate::json::parse_reply;

pub(crate) fn disclosure(label: &str, context: &PullRequestContext) -> PullRequestDisclosure {
    PullRequestDisclosure {
        commit_messages: context
            .comparison
            .commits
            .len()
            .try_into()
            .unwrap_or(u32::MAX),
        files: context.comparison.files,
        additions: context.comparison.additions,
        deletions: context.comparison.deletions,
        provider_name: label.to_owned(),
        excluded: context.excluded.clone(),
        truncated: context.truncated.clone(),
    }
}

pub(crate) fn context_text(context: &PullRequestContext, template: &str) -> Result<String> {
    if template.len() > 20 * 1024 {
        return Err(AiError::invalid("the pull request template exceeds 20 KiB"));
    }
    Ok(format!("Compared commit messages:\n{}\n\nDiffstat: {} files, +{} additions, -{} deletions\n\nCompared diff (withheld, binary, truncated, or omitted content is incomplete):\n{}\n\nDescription template:\n{}", serde_json::to_string(&context.commit_messages).map_err(|error| AiError::invalid(error.to_string()))?, context.comparison.files, context.comparison.additions, context.comparison.deletions, context.diff, template))
}

pub(crate) fn parse(
    label: &str,
    reply: &str,
    template: &str,
    context: &PullRequestContext,
) -> Result<PullRequestDraft> {
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: label.to_owned(),
        reason: reason.to_owned(),
    };
    let value = parse_reply(reply).map_err(|reason| invalid(&reason))?;
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("`title` is missing or not a string"))?;
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("`description` is missing or not a string"))?;
    let (title, title_trimmed) = fit_summary(title);
    if title.is_empty() || description.trim().is_empty() {
        return Err(invalid("the title and description must not be empty"));
    }
    for heading in template
        .lines()
        .filter(|line| line.starts_with('#') && line.trim_start_matches('#').starts_with(' '))
    {
        let mut lines = description
            .lines()
            .skip_while(|line| line.trim() != heading.trim());
        if lines.next().is_none()
            || !lines
                .take_while(|line| !line.starts_with('#'))
                .any(|line| !line.trim().is_empty())
        {
            return Err(invalid("the description must fill every template section"));
        }
    }
    Ok(PullRequestDraft {
        title,
        description: description.trim().to_owned(),
        title_trimmed,
        sent: disclosure(label, context),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> PullRequestContext {
        PullRequestContext {
            comparison: yforge_core::BranchComparison {
                merge_base: "base".to_owned(),
                source: "source".to_owned(),
                target: "target".to_owned(),
                commits: Vec::new(),
                files: 1,
                additions: 1,
                deletions: 0,
            },
            commit_messages: Vec::new(),
            diff: "+line".to_owned(),
            excluded: Vec::new(),
            truncated: Vec::new(),
        }
    }

    #[test]
    fn titles_fit_unicode_and_missing_or_empty_sections_are_refused() {
        let long = "字".repeat(100);
        let reply = serde_json::json!({"title":long,"description":"## Summary\nChange.\n\n## Testing\nUnknown."}).to_string();
        let draft = parse("Work", &reply, "## Summary\n\n## Testing\n", &context()).unwrap();
        assert_eq!(draft.title.chars().count(), 72);
        assert!(draft.title_trimmed);
        for description in ["## Summary\nChange.", "## Summary\nChange.\n\n## Testing\n"] {
            let reply =
                serde_json::json!({"title":"Change", "description":description}).to_string();
            assert!(matches!(
                parse("Work", &reply, "## Summary\n\n## Testing\n", &context()),
                Err(AiError::InvalidResponse { .. })
            ));
        }
    }
}
