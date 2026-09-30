use std::path::Path;

use serde_json::Value;
use yforge_core::{CancelToken, ProviderKind, ProviderStatus};

use crate::error::{AiError, Result};
use crate::limits::{seconds, Limits};
use crate::process::{run, Invocation, Output, RunFailure};
use crate::prompt::Prompt;
use crate::text::{mentions_sign_in, sanitize, tail};

pub fn binary_name(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::ClaudeCode => "claude",
        _ => "codex",
    }
}

fn invocation(binary: &Path, args: &[&str]) -> Invocation {
    Invocation {
        program: binary.to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        path_prefix: binary.parent().map(Path::to_owned),
        ..Invocation::default()
    }
}

pub fn run_failure(label: &str, failure: RunFailure, limit: std::time::Duration) -> AiError {
    match failure {
        RunFailure::Timeout => AiError::Timeout {
            provider: label.to_owned(),
            seconds: seconds(limit),
        },
        RunFailure::Cancelled => AiError::Cancelled,
        RunFailure::Spawn(error) => AiError::Unavailable {
            provider: label.to_owned(),
            detail: format!("the command could not be started: {error}"),
        },
    }
}

pub fn classify(label: &str, text: &str) -> AiError {
    let detail = sanitize(text, &[]);
    if mentions_sign_in(text) {
        AiError::AuthRequired {
            provider: label.to_owned(),
            detail,
        }
    } else {
        AiError::Failed {
            provider: label.to_owned(),
            output: detail,
        }
    }
}

pub async fn status(kind: ProviderKind, binary: &Path, limits: &Limits) -> ProviderStatus {
    let args: &[&str] = match kind {
        ProviderKind::ClaudeCode => &["auth", "status", "--json"],
        _ => &["login", "status"],
    };
    let output = match run(&invocation(binary, args), limits.status, None, &|_| ()).await {
        Ok(output) => output,
        Err(RunFailure::Timeout) => {
            return ProviderStatus::CheckFailed {
                message: "the status check timed out".to_owned(),
            }
        }
        Err(RunFailure::Cancelled) => {
            return ProviderStatus::CheckFailed {
                message: "the status check was cancelled".to_owned(),
            }
        }
        Err(RunFailure::Spawn(error)) => {
            return ProviderStatus::CheckFailed {
                message: format!("the command could not be started: {error}"),
            }
        }
    };
    match kind {
        ProviderKind::ClaudeCode => claude_status(&output),
        _ => codex_status(&output),
    }
}

fn codex_status(output: &Output) -> ProviderStatus {
    if output.status == Some(0) {
        return ProviderStatus::Ready;
    }
    let text = format!("{}{}", output.stdout, output.stderr);
    if text.to_lowercase().contains("not logged in") {
        return ProviderStatus::SignedOut;
    }
    ProviderStatus::CheckFailed {
        message: sanitize(&tail(&text, 5), &[]),
    }
}

fn claude_status(output: &Output) -> ProviderStatus {
    match serde_json::from_str::<Value>(output.stdout.trim())
        .ok()
        .and_then(|value| value.get("loggedIn").and_then(Value::as_bool))
    {
        Some(true) => ProviderStatus::Ready,
        Some(false) => ProviderStatus::SignedOut,
        None => ProviderStatus::CheckFailed {
            message: sanitize(
                &tail(&format!("{}{}", output.stdout, output.stderr), 5),
                &[],
            ),
        },
    }
}

fn chosen(model: Option<&str>) -> Option<&str> {
    model
        .map(str::trim)
        .filter(|model| !model.is_empty() && !model.eq_ignore_ascii_case("default"))
}

pub async fn complete(
    kind: ProviderKind,
    label: &str,
    binary: &Path,
    model: Option<&str>,
    prompt: &Prompt,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<String> {
    let scratch = tempfile::tempdir().map_err(|error| AiError::Unavailable {
        provider: label.to_owned(),
        detail: format!("could not create a private working directory: {error}"),
    })?;
    let mut call = match kind {
        ProviderKind::ClaudeCode => claude_call(binary, model, prompt),
        _ => codex_call(binary, scratch.path(), model, prompt),
    };
    call.cwd = Some(scratch.path().to_owned());
    let output = run(&call, limits.completion, Some(cancel), &|_| ())
        .await
        .map_err(|failure| run_failure(label, failure, limits.completion))?;
    match kind {
        ProviderKind::ClaudeCode => claude_reply(label, &output),
        _ => codex_reply(label, &output, &scratch.path().join(CODEX_REPLY)),
    }
}

const CODEX_REPLY: &str = "last-message.txt";

fn codex_call(binary: &Path, scratch: &Path, model: Option<&str>, prompt: &Prompt) -> Invocation {
    let reply = scratch.join(CODEX_REPLY);
    let mut call = invocation(
        binary,
        &[
            "exec",
            "--json",
            "--color",
            "never",
            "-s",
            "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
        ],
    );
    call.args.push("-C".to_owned());
    call.args.push(scratch.to_string_lossy().into_owned());
    call.args.push("-o".to_owned());
    call.args.push(reply.to_string_lossy().into_owned());
    if let Some(model) = chosen(model) {
        call.args.push("-m".to_owned());
        call.args.push(model.to_owned());
    }
    call.args.push("-".to_owned());
    call.stdin = Some(prompt.combined());
    call
}

fn codex_failure_text(output: &Output) -> String {
    output
        .stdout
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find_map(|event| match event.get("type").and_then(Value::as_str) {
            Some("error") => event
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned),
            Some("turn.failed") => event
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_owned),
            _ => None,
        })
        .unwrap_or_else(|| tail(&output.stderr, 10))
}

fn codex_reply(label: &str, output: &Output, reply: &Path) -> Result<String> {
    if output.status != Some(0) {
        return Err(classify(label, &codex_failure_text(output)));
    }
    match std::fs::read_to_string(reply) {
        Ok(text) if !text.trim().is_empty() => Ok(text),
        _ => Err(AiError::Failed {
            provider: label.to_owned(),
            output: "the command finished without a final message".to_owned(),
        }),
    }
}

fn claude_call(binary: &Path, model: Option<&str>, prompt: &Prompt) -> Invocation {
    let mut call = invocation(
        binary,
        &[
            "-p",
            "--output-format",
            "json",
            "--tools",
            "",
            "--safe-mode",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--system-prompt",
        ],
    );
    call.args.push(prompt.system.to_owned());
    if let Some(model) = chosen(model) {
        call.args.push("--model".to_owned());
        call.args.push(model.to_owned());
    }
    call.stdin = Some(prompt.user.clone());
    call
}

fn claude_reply(label: &str, output: &Output) -> Result<String> {
    let parsed: Option<Value> = serde_json::from_str(output.stdout.trim()).ok();
    let Some(value) = parsed else {
        let text = format!("{}\n{}", tail(&output.stderr, 10), tail(&output.stdout, 5));
        return Err(if output.status == Some(0) {
            AiError::InvalidResponse {
                provider: label.to_owned(),
                reason: "the command did not print a JSON result".to_owned(),
            }
        } else {
            classify(label, &text)
        });
    };
    let result = value
        .get("result")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let errored =
        value.get("is_error").and_then(Value::as_bool) == Some(true) || output.status != Some(0);
    if errored {
        if value.get("api_error_status").and_then(Value::as_u64) == Some(401) {
            return Err(AiError::AuthRequired {
                provider: label.to_owned(),
                detail: sanitize(result, &[]),
            });
        }
        let text = if result.is_empty() {
            tail(&output.stderr, 10)
        } else {
            result.to_owned()
        };
        return Err(classify(label, &text));
    }
    if result.trim().is_empty() {
        return Err(AiError::Failed {
            provider: label.to_owned(),
            output: "the command returned an empty result".to_owned(),
        });
    }
    Ok(result.to_owned())
}
