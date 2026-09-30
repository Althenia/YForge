use std::time::Duration;

use reqwest::{redirect, Client, Response, StatusCode, Url};
use serde_json::{json, Value};
use yforge_core::{AiModel, CancelToken, ProviderStatus};

use crate::error::{AiError, Result};
use crate::limits::{seconds, Limits};
use crate::prompt::Prompt;
use crate::text::sanitize;

const CANCEL_POLL: Duration = Duration::from_millis(50);

pub struct Endpoint<'a> {
    pub label: &'a str,
    pub base_url: &'a str,
    pub api_key: Option<&'a str>,
}

impl Endpoint<'_> {
    fn secrets(&self) -> Vec<&str> {
        self.api_key.into_iter().collect()
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base_url.trim_end_matches('/'))
    }
}

fn client() -> Result<Client> {
    Client::builder()
        .redirect(redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| AiError::Unavailable {
            provider: "HTTP client".to_owned(),
            detail: error.to_string(),
        })
}

pub fn validate_base_url(text: &str) -> Result<String> {
    let trimmed = text.trim().trim_end_matches('/');
    let url = Url::parse(trimmed)
        .map_err(|error| AiError::invalid(format!("`{trimmed}` is not a valid URL: {error}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| AiError::invalid("the base URL needs a host"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AiError::invalid(
            "the base URL must not contain credentials; use the API key field",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AiError::invalid(
            "the base URL must not have a query or fragment",
        ));
    }
    let loopback = host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::Ipv6Addr>()
            .is_ok_and(|ip| ip.is_loopback());
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        "http" => {
            return Err(AiError::invalid(
                "http is only accepted for localhost; use https for remote endpoints",
            ))
        }
        other => {
            return Err(AiError::invalid(format!(
                "the base URL must use http or https, not {other}"
            )))
        }
    }
    Ok(trimmed.to_owned())
}

async fn cancelled(cancel: Option<&CancelToken>) {
    match cancel {
        Some(token) => {
            while !token.is_cancelled() {
                tokio::time::sleep(CANCEL_POLL).await;
            }
        }
        None => std::future::pending().await,
    }
}

fn transport(endpoint: &Endpoint<'_>, error: &reqwest::Error, limit: Duration) -> AiError {
    if error.is_timeout() {
        return AiError::Timeout {
            provider: endpoint.label.to_owned(),
            seconds: seconds(limit),
        };
    }
    let reason = if error.is_connect() {
        "could not connect to the endpoint"
    } else {
        "the request failed"
    };
    AiError::Unavailable {
        provider: endpoint.label.to_owned(),
        detail: reason.to_owned(),
    }
}

async fn send(
    endpoint: &Endpoint<'_>,
    method: reqwest::Method,
    path: &str,
    body: Option<String>,
    limit: Duration,
    cancel: Option<&CancelToken>,
) -> Result<(StatusCode, String)> {
    let client = client()?;
    let mut request = client
        .request(method, endpoint.url(path))
        .timeout(limit)
        .header("Accept", "application/json");
    if let Some(key) = endpoint.api_key {
        request = request.bearer_auth(key);
    }
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body);
    }
    let exchange = async {
        let response: Response = request
            .send()
            .await
            .map_err(|error| transport(endpoint, &error, limit))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| transport(endpoint, &error, limit))?;
        Ok((status, text))
    };
    tokio::select! {
        biased;
        () = cancelled(cancel) => Err(AiError::Cancelled),
        result = exchange => result,
    }
}

fn error_message(text: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(text).ok();
    parsed
        .as_ref()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("error"))
                .or_else(|| value.get("message"))
        })
        .and_then(Value::as_str)
        .map_or_else(|| text.to_owned(), str::to_owned)
}

fn rejected(endpoint: &Endpoint<'_>, status: StatusCode, text: &str) -> AiError {
    let detail = sanitize(&error_message(text), &endpoint.secrets());
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AiError::AuthRequired {
            provider: endpoint.label.to_owned(),
            detail,
        },
        _ => AiError::Failed {
            provider: endpoint.label.to_owned(),
            output: format!("HTTP {}: {detail}", status.as_u16()),
        },
    }
}

pub async fn models(endpoint: &Endpoint<'_>, limits: &Limits) -> Result<Vec<AiModel>> {
    let (status, text) = send(
        endpoint,
        reqwest::Method::GET,
        "models",
        None,
        limits.status,
        None,
    )
    .await?;
    if !status.is_success() {
        return Err(rejected(endpoint, status, &text));
    }
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: endpoint.label.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value =
        serde_json::from_str(&text).map_err(|_| invalid("the model list is not JSON"))?;
    let entries = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("the model list has no `data` array"))?;
    let mut models: Vec<AiModel> = entries
        .iter()
        .filter_map(|entry| {
            let id = entry.get("id")?.as_str()?.to_owned();
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| *name != id)
                .map(str::to_owned);
            Some(AiModel { id, name })
        })
        .collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

pub async fn check(endpoint: &Endpoint<'_>, limits: &Limits) -> ProviderStatus {
    match models(endpoint, limits).await {
        Ok(_) => ProviderStatus::Ready,
        Err(AiError::AuthRequired { .. }) => ProviderStatus::KeyRejected,
        Err(AiError::Unavailable { detail, .. }) => ProviderStatus::Unreachable { message: detail },
        Err(AiError::Timeout { seconds, .. }) => ProviderStatus::Unreachable {
            message: format!("no answer within {seconds} seconds"),
        },
        Err(AiError::Failed { output, .. }) => ProviderStatus::CheckFailed { message: output },
        Err(AiError::InvalidResponse { reason, .. }) => {
            ProviderStatus::CheckFailed { message: reason }
        }
        Err(other) => ProviderStatus::CheckFailed {
            message: other.to_string(),
        },
    }
}

pub async fn complete(
    endpoint: &Endpoint<'_>,
    model: &str,
    prompt: &Prompt,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<String> {
    let body = json!({
        "model": model,
        "stream": false,
        "messages": [
            {"role": "system", "content": prompt.system},
            {"role": "user", "content": prompt.user},
        ],
    })
    .to_string();
    let (status, text) = send(
        endpoint,
        reqwest::Method::POST,
        "chat/completions",
        Some(body),
        limits.completion,
        Some(cancel),
    )
    .await?;
    if !status.is_success() {
        return Err(rejected(endpoint, status, &text));
    }
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: endpoint.label.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value = serde_json::from_str(&text).map_err(|_| invalid("the reply is not JSON"))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("the reply has no message content"))?;
    if content.trim().is_empty() {
        return Err(invalid("the reply has empty message content"));
    }
    Ok(content.to_owned())
}
