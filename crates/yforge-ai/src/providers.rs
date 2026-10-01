use serde_json::{json, Value};
use yforge_core::{AuthMode, CancelToken, ModelInfo, ProviderKind};

use crate::error::{AiError, Result};
use crate::http::{send, with_query, Body, Request};
use crate::limits::Limits;
use crate::prompt::Prompt;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_OAUTH_BETA: &str = "claude-code-20250219,oauth-2025-04-20";
const CLAUDE_CODE_IDENTITY: &str = "You are Claude Code, Anthropic's official CLI for Claude.";
const CODEX_CLIENT_VERSION: &str = "0.157.1";
const ANTHROPIC_MODEL_LIMIT: &str = "1000";
const ANTHROPIC_MAX_TOKENS: u32 = 8192;

#[derive(Clone)]
pub enum Access {
    Anonymous,
    Key(String),
    Subscription {
        token: String,
        account_id: Option<String>,
    },
}

pub struct Connection {
    pub label: String,
    pub kind: ProviderKind,
    pub mode: AuthMode,
    pub base_url: String,
    pub access: Access,
}

impl Connection {
    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base_url.trim_end_matches('/'))
    }

    fn invalid(&self, reason: &str) -> AiError {
        AiError::InvalidResponse {
            provider: self.label.clone(),
            reason: reason.to_owned(),
        }
    }

    fn headers(&self) -> Vec<(&'static str, String)> {
        let mut headers = Vec::new();
        match (&self.access, self.kind) {
            (Access::Anonymous, _) => {}
            (Access::Key(key), ProviderKind::Claude) => {
                headers.push(("x-api-key", key.clone()));
                headers.push(("anthropic-version", ANTHROPIC_VERSION.to_owned()));
            }
            (Access::Key(key), _) => headers.push(("authorization", format!("Bearer {key}"))),
            (Access::Subscription { token, .. }, ProviderKind::Claude) => {
                headers.push(("authorization", format!("Bearer {token}")));
                headers.push(("anthropic-version", ANTHROPIC_VERSION.to_owned()));
                headers.push(("anthropic-beta", ANTHROPIC_OAUTH_BETA.to_owned()));
                headers.push(("x-app", "cli".to_owned()));
            }
            (Access::Subscription { token, account_id }, _) => {
                headers.push(("authorization", format!("Bearer {token}")));
                if let Some(account) = account_id {
                    headers.push(("chatgpt-account-id", account.clone()));
                }
            }
        }
        headers
    }
}

pub async fn complete(
    connection: &Connection,
    model: &str,
    prompt: &Prompt,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<String> {
    let (path, body) = match connection.kind {
        ProviderKind::Chatgpt => ("responses", responses_body(model, prompt)),
        ProviderKind::Claude => (
            "messages",
            messages_body(model, prompt, connection.mode == AuthMode::Subscription),
        ),
        ProviderKind::Openrouter | ProviderKind::OpenaiCompatible => {
            ("chat/completions", chat_body(model, prompt))
        }
    };
    let request = Request::post(
        &connection.label,
        connection.url(path),
        Body::Json(body.to_string()),
    )
    .headers(connection.headers());
    let text = send(request, limits.completion, Some(cancel))
        .await?
        .success()?;
    let reply = match connection.kind {
        ProviderKind::Chatgpt => read_responses(connection, &text)?,
        ProviderKind::Claude => read_messages(connection, &text)?,
        ProviderKind::Openrouter | ProviderKind::OpenaiCompatible => read_chat(connection, &text)?,
    };
    if reply.trim().is_empty() {
        return Err(connection.invalid("the reply has empty message content"));
    }
    Ok(reply)
}

fn chat_body(model: &str, prompt: &Prompt) -> Value {
    json!({
        "model": model,
        "stream": false,
        "messages": [
            {"role": "system", "content": prompt.system},
            {"role": "user", "content": prompt.user},
        ],
    })
}

fn responses_body(model: &str, prompt: &Prompt) -> Value {
    json!({
        "model": model,
        "instructions": prompt.system,
        "input": [{
            "role": "user",
            "content": [{"type": "input_text", "text": prompt.user}],
        }],
        "stream": true,
        "store": false,
    })
}

fn messages_body(model: &str, prompt: &Prompt, identify_as_claude_code: bool) -> Value {
    let mut system = Vec::new();
    if identify_as_claude_code {
        system.push(json!({"type": "text", "text": CLAUDE_CODE_IDENTITY}));
    }
    system.push(json!({"type": "text", "text": prompt.system}));
    json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "system": system,
        "messages": [{"role": "user", "content": prompt.user}],
    })
}

fn read_chat(connection: &Connection, text: &str) -> Result<String> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| connection.invalid("the reply is not JSON"))?;
    value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| connection.invalid("the reply has no message content"))
}

fn read_messages(connection: &Connection, text: &str) -> Result<String> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| connection.invalid("the reply is not JSON"))?;
    let blocks = value
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| connection.invalid("the reply has no content blocks"))?;
    Ok(blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect())
}

fn read_responses(connection: &Connection, stream: &str) -> Result<String> {
    let mut deltas = String::new();
    let mut completed = None;
    for line in stream.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    deltas.push_str(delta);
                }
            }
            Some("response.completed") => completed = event.get("response").cloned(),
            Some("response.failed" | "response.incomplete" | "error") => {
                let message = event
                    .pointer("/response/error/message")
                    .or_else(|| event.pointer("/response/incomplete_details/reason"))
                    .or_else(|| event.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("the model stopped without a reply");
                return Err(AiError::Failed {
                    provider: connection.label.clone(),
                    output: crate::text::sanitize(message, &[]),
                });
            }
            _ => {}
        }
    }
    if !deltas.is_empty() {
        return Ok(deltas);
    }
    let response =
        completed.ok_or_else(|| connection.invalid("the reply stream never completed"))?;
    Ok(response
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect())
}

pub async fn models(connection: &Connection, limits: &Limits) -> Result<Vec<ModelInfo>> {
    let subscription_chatgpt =
        connection.kind == ProviderKind::Chatgpt && connection.mode == AuthMode::Subscription;
    let url = match (connection.kind, subscription_chatgpt) {
        (ProviderKind::Chatgpt, true) => with_query(
            &connection.url("models"),
            &[("client_version", CODEX_CLIENT_VERSION)],
        )?,
        (ProviderKind::Claude, _) => with_query(
            &connection.url("models"),
            &[("limit", ANTHROPIC_MODEL_LIMIT)],
        )?,
        _ => connection.url("models"),
    };
    let request = Request::get(&connection.label, url).headers(connection.headers());
    let text = send(request, limits.status, None).await?.success()?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|_| connection.invalid("the model list is not JSON"))?;
    let (key, id_field) = if subscription_chatgpt {
        ("models", "slug")
    } else {
        ("data", "id")
    };
    let entries = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| connection.invalid(&format!("the model list has no `{key}` array")))?;
    let mut models: Vec<ModelInfo> = entries
        .iter()
        .filter_map(|entry| model_info(connection.kind, id_field, entry))
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

fn model_info(kind: ProviderKind, id_field: &str, entry: &Value) -> Option<ModelInfo> {
    let id = entry.get(id_field)?.as_str()?.to_owned();
    let name_field = match kind {
        ProviderKind::Claude | ProviderKind::Chatgpt => "display_name",
        _ => "name",
    };
    let display_name = entry
        .get(name_field)
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(&id)
        .to_owned();
    let window_field = match kind {
        ProviderKind::Chatgpt | ProviderKind::OpenaiCompatible => "context_window",
        ProviderKind::Claude => "max_input_tokens",
        ProviderKind::Openrouter => "context_length",
    };
    let limit = entry.get("limit");
    let context_window = [
        entry.get(window_field),
        limit.and_then(|limit| limit.get("context")),
        limit.and_then(|limit| limit.get("input")),
    ]
    .into_iter()
    .flatten()
    .find_map(|tokens| {
        tokens
            .as_u64()
            .and_then(|tokens| u32::try_from(tokens).ok())
    });
    Some(ModelInfo {
        id,
        display_name,
        context_window,
    })
}
