const LIMIT: usize = 2000;

pub fn strip_ansi(text: &str) -> String {
    let mut clean = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            clean.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        }
    }
    clean
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')
}

fn mask_tokens(text: &str) -> String {
    let mut masked = String::with_capacity(text.len());
    let mut after_bearer = false;
    let mut rest = text;
    while !rest.is_empty() {
        let split = rest
            .find(|c: char| is_token_char(c) != is_token_char(rest.chars().next().unwrap_or(' ')))
            .unwrap_or(rest.len());
        let (run, tail) = rest.split_at(split);
        let is_token = run.chars().next().is_some_and(is_token_char);
        if is_token && (after_bearer || (run.starts_with("sk-") && run.len() >= 8)) {
            masked.push_str("***");
            after_bearer = false;
        } else {
            masked.push_str(run);
            if is_token {
                after_bearer = run.eq_ignore_ascii_case("bearer");
            } else if !run.chars().all(char::is_whitespace) {
                after_bearer = false;
            }
        }
        rest = tail;
    }
    masked
}

pub fn sanitize(text: &str, secrets: &[&str]) -> String {
    let mut clean = strip_ansi(text);
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        clean = clean.replace(secret, "***");
    }
    let clean = mask_tokens(&yforge_core::redact(clean.trim()));
    if clean.chars().count() <= LIMIT {
        return clean;
    }
    let mut cut: String = clean.chars().take(LIMIT).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_colour_codes() {
        assert_eq!(
            strip_ansi("\u{1b}[94mhttps://x\u{1b}[0m done"),
            "https://x done"
        );
    }

    #[test]
    fn masks_known_secrets_bearer_tokens_and_sk_keys() {
        let text = "failed: Authorization: Bearer abc123 and key sk-live-1234567890 and my-secret";
        let clean = sanitize(text, &["my-secret"]);
        assert!(!clean.contains("abc123"));
        assert!(!clean.contains("sk-live"));
        assert!(!clean.contains("my-secret"));
    }

    #[test]
    fn keeps_plain_words_and_caps_the_length() {
        assert_eq!(
            sanitize("quota exceeded, retry later", &[]),
            "quota exceeded, retry later"
        );
        let long = "x ".repeat(5000);
        assert!(sanitize(&long, &[]).chars().count() <= LIMIT + 1);
    }
}
