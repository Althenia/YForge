use serde_json::Value;

const REASON_LIMIT: usize = 200;

pub fn cap(reason: &str) -> String {
    let flat: String = reason
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if flat.chars().count() <= REASON_LIMIT {
        return flat;
    }
    let mut cut: String = flat.chars().take(REASON_LIMIT).collect();
    cut.push('…');
    cut
}

pub fn parse_reply(reply: &str) -> Result<Value, String> {
    let trimmed = reply.trim();
    let body = match trimmed.strip_prefix("```") {
        Some(fenced) => {
            let inner = fenced.split_once('\n').map_or("", |(_, rest)| rest);
            inner
                .trim_end()
                .strip_suffix("```")
                .ok_or_else(|| "the reply opens a code block that never closes".to_owned())?
        }
        None => trimmed,
    };
    serde_json::from_str(body.trim()).map_err(|error| {
        cap(&format!(
            "the reply is not a single JSON value ({})",
            error.classify_name()
        ))
    })
}

trait ClassifyName {
    fn classify_name(&self) -> &'static str;
}

impl ClassifyName for serde_json::Error {
    fn classify_name(&self) -> &'static str {
        match self.classify() {
            serde_json::error::Category::Io => "read error",
            serde_json::error::Category::Syntax => "syntax error",
            serde_json::error::Category::Data => "unexpected data",
            serde_json::error::Category::Eof => "it ends early",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_json_and_one_fenced_block() {
        assert_eq!(parse_reply(" {\"a\": 1}\n").unwrap()["a"], 1);
        assert_eq!(parse_reply("```json\n{\"a\": 2}\n```\n").unwrap()["a"], 2);
        assert_eq!(parse_reply("```\n{\"a\": 3}\n```").unwrap()["a"], 3);
    }

    #[test]
    fn rejects_prose_around_the_json_and_unclosed_fences() {
        assert!(parse_reply("Here you go: {\"a\": 1}").is_err());
        assert!(parse_reply("```json\n{\"a\": 1}").is_err());
        assert!(parse_reply("").is_err());
    }

    #[test]
    fn caps_long_reasons_on_one_line() {
        let reason = cap(&format!("a\n{}", "b".repeat(500)));
        assert!(!reason.contains('\n'));
        assert_eq!(reason.chars().count(), 201);
    }
}
