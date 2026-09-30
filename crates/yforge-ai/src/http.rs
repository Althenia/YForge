use std::time::Duration;

use reqwest::{redirect, Client, Method, StatusCode, Url};
use serde_json::Value;
use yforge_core::{CancelToken, ProviderStatus};

use crate::error::{AiError, Result};
use crate::limits::seconds;
use crate::text::sanitize;

const CANCEL_POLL: Duration = Duration::from_millis(50);
const CREDENTIAL_HEADERS: [&str; 3] = ["authorization", "x-api-key", "chatgpt-account-id"];

pub enum Body {
    Json(String),
    Form(Vec<(&'static str, String)>),
}

pub struct Request {
    pub label: String,
    pub method: Method,
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Option<Body>,
}

impl Request {
    pub fn get(label: &str, url: String) -> Self {
        Self {
            label: label.to_owned(),
            method: Method::GET,
            url,
            headers: Vec::new(),
            body: None,
        }
    }

    pub fn post(label: &str, url: String, body: Body) -> Self {
        Self {
            label: label.to_owned(),
            method: Method::POST,
            url,
            headers: Vec::new(),
            body: Some(body),
        }
    }

    pub fn headers(mut self, headers: Vec<(&'static str, String)>) -> Self {
        self.headers = headers;
        self
    }

    fn secrets(&self) -> Vec<&str> {
        self.headers
            .iter()
            .filter(|(name, _)| CREDENTIAL_HEADERS.contains(name))
            .flat_map(|(_, value)| [value.as_str(), value.strip_prefix("Bearer ").unwrap_or("")])
            .filter(|secret| !secret.is_empty())
            .collect()
    }
}

pub struct Reply {
    pub status: StatusCode,
    pub text: String,
    label: String,
    secrets: Vec<String>,
}

impl Reply {
    pub fn success(self) -> Result<String> {
        if self.status.is_success() {
            return Ok(self.text);
        }
        Err(self.rejection())
    }

    pub fn rejection(&self) -> AiError {
        let secrets: Vec<&str> = self.secrets.iter().map(String::as_str).collect();
        let detail = sanitize(&error_message(&self.text), &secrets);
        match self.status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AiError::AuthRequired {
                provider: self.label.clone(),
                detail,
            },
            _ => AiError::Failed {
                provider: self.label.clone(),
                output: format!("HTTP {}: {detail}", self.status.as_u16()),
            },
        }
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

pub fn form_encode(pairs: &[(&str, &str)]) -> String {
    let mut url = Url::parse("http://form.invalid/").expect("static URL parses");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_owned()
}

pub fn with_query(base: &str, pairs: &[(&str, &str)]) -> Result<String> {
    let mut url = Url::parse(base)
        .map_err(|error| AiError::invalid(format!("`{base}` is not a valid URL: {error}")))?;
    url.query_pairs_mut().extend_pairs(pairs);
    Ok(url.into())
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

fn transport(label: &str, error: &reqwest::Error, limit: Duration) -> AiError {
    if error.is_timeout() {
        return AiError::Timeout {
            provider: label.to_owned(),
            seconds: seconds(limit),
        };
    }
    let reason = if error.is_connect() {
        "could not connect to the endpoint"
    } else {
        "the request failed"
    };
    AiError::Unavailable {
        provider: label.to_owned(),
        detail: reason.to_owned(),
    }
}

pub async fn send(
    request: Request,
    limit: Duration,
    cancel: Option<&CancelToken>,
) -> Result<Reply> {
    let label = request.label.clone();
    let secrets: Vec<String> = request.secrets().into_iter().map(str::to_owned).collect();
    let mut builder = client()?
        .request(request.method, request.url)
        .timeout(limit)
        .header("Accept", "application/json");
    for (name, value) in request.headers {
        builder = builder.header(name, value);
    }
    builder = match request.body {
        Some(Body::Json(text)) => builder
            .header("Content-Type", "application/json")
            .body(text),
        Some(Body::Form(pairs)) => {
            let pairs: Vec<(&str, &str)> = pairs
                .iter()
                .map(|(name, value)| (*name, value.as_str()))
                .collect();
            builder
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form_encode(&pairs))
        }
        None => builder,
    };
    let exchange = async {
        let response = builder
            .send()
            .await
            .map_err(|error| transport(&label, &error, limit))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| transport(&label, &error, limit))?;
        Ok(Reply {
            status,
            text,
            label: label.clone(),
            secrets,
        })
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

pub fn status_of<T>(result: Result<T>) -> ProviderStatus {
    match result {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn form_bodies_escape_reserved_characters() {
        assert_eq!(
            form_encode(&[
                ("redirect_uri", "http://localhost:1/a b"),
                ("code", "x&y=z")
            ]),
            "redirect_uri=http%3A%2F%2Flocalhost%3A1%2Fa+b&code=x%26y%3Dz"
        );
    }

    #[test]
    fn credential_headers_are_redacted_from_error_details() {
        let request = Request::get("P", "http://x/".to_owned()).headers(vec![
            ("authorization", "Bearer tok-123".to_owned()),
            ("x-app", "cli".to_owned()),
        ]);
        assert_eq!(request.secrets(), ["Bearer tok-123", "tok-123"]);
    }
}
