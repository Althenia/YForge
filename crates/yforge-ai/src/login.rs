use std::path::Path;
use std::sync::Mutex;

use yforge_core::{AiSignInMethod, CancelToken, ProviderKind};

use crate::cli::run_failure;
use crate::error::{AiError, Result};
use crate::limits::Limits;
use crate::process::{run, Invocation};
use crate::text::{sanitize, strip_ansi, tail};

#[derive(Default)]
struct Scan {
    url: Option<String>,
    code: Option<String>,
    sent: bool,
}

fn looks_like_code(line: &str) -> bool {
    let Some((left, right)) = line.split_once('-') else {
        return false;
    };
    let part = |text: &str| {
        text.len() >= 4
            && text
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
    };
    part(left) && part(right)
}

fn scan_line(state: &Mutex<Scan>, raw: &str, emit: &(dyn Fn(&str, &str) + Send + Sync)) {
    let line = strip_ansi(raw);
    let line = line.trim();
    let mut scan = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if scan.url.is_none() {
        if let Some(start) = line.find("https://") {
            let url = line[start..].split_whitespace().next().unwrap_or_default();
            scan.url = Some(url.to_owned());
        }
    }
    if scan.code.is_none() && looks_like_code(line) {
        scan.code = Some(line.to_owned());
    }
    if !scan.sent {
        if let (Some(url), Some(code)) = (&scan.url, &scan.code) {
            emit(url, code);
            scan.sent = true;
        }
    }
}

fn arguments(kind: ProviderKind, method: AiSignInMethod) -> Result<&'static [&'static str]> {
    match (kind, method) {
        (ProviderKind::Chatgpt, AiSignInMethod::Browser) => Ok(&["login"]),
        (ProviderKind::Chatgpt, AiSignInMethod::DeviceCode) => Ok(&["login", "--device-auth"]),
        (ProviderKind::ClaudeCode, AiSignInMethod::Browser) => Ok(&["auth", "login"]),
        (ProviderKind::ClaudeCode, AiSignInMethod::DeviceCode) => Err(AiError::invalid(
            "Claude Code signs in through the browser only",
        )),
        _ => Err(AiError::invalid(
            "this provider has no command-line sign-in",
        )),
    }
}

pub async fn sign_in(
    kind: ProviderKind,
    label: &str,
    binary: &Path,
    method: AiSignInMethod,
    limits: &Limits,
    cancel: &CancelToken,
    on_device_code: &(dyn Fn(&str, &str) + Send + Sync),
) -> Result<()> {
    let args = arguments(kind, method)?;
    let call = Invocation {
        program: binary.to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        path_prefix: binary.parent().map(Path::to_owned),
        ..Invocation::default()
    };
    let state = Mutex::new(Scan::default());
    let watch = |line: &str| {
        if method == AiSignInMethod::DeviceCode {
            scan_line(&state, line, on_device_code);
        }
    };
    let output = run(&call, limits.sign_in, Some(cancel), &watch)
        .await
        .map_err(|failure| run_failure(label, failure, limits.sign_in))?;
    if output.status == Some(0) {
        return Ok(());
    }
    Err(AiError::Failed {
        provider: label.to_owned(),
        output: sanitize(
            &tail(&format!("{}\n{}", output.stderr, output.stdout), 10),
            &[],
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn finds_the_url_and_code_in_coloured_device_output() {
        let seen = StdMutex::new(Vec::new());
        let emit =
            |url: &str, code: &str| seen.lock().unwrap().push((url.to_owned(), code.to_owned()));
        let state = Mutex::new(Scan::default());
        for line in [
            "Welcome to Codex [v\u{1b}[90m0.154.0\u{1b}[0m]",
            "   \u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m",
            "2. Enter this one-time code \u{1b}[90m(expires in 15 minutes)\u{1b}[0m",
            "   \u{1b}[94m66F7-PDYII\u{1b}[0m",
            "   \u{1b}[94m66F7-PDYII\u{1b}[0m",
        ] {
            scan_line(&state, line, &emit);
        }
        assert_eq!(
            *seen.lock().unwrap(),
            [(
                "https://auth.openai.com/codex/device".to_owned(),
                "66F7-PDYII".to_owned()
            )]
        );
    }

    #[test]
    fn claude_has_no_device_flow() {
        assert!(arguments(ProviderKind::ClaudeCode, AiSignInMethod::DeviceCode).is_err());
        assert_eq!(
            arguments(ProviderKind::Chatgpt, AiSignInMethod::DeviceCode).unwrap(),
            ["login", "--device-auth"]
        );
    }
}
