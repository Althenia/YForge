use std::time::Duration;

use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use yforge_core::PlatformConnection;

use crate::error::{PlatformError, Result};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MESSAGE_LIMIT: usize = 300;

pub(crate) struct Http {
    client: Client,
    base: String,
    host: String,
    token: String,
    accept: &'static str,
}

pub(crate) fn scheme_for(host: &str) -> &'static str {
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    let loopback = name == "localhost"
        || name
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if loopback {
        "http"
    } else {
        "https"
    }
}

pub(crate) fn encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(byte).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

impl Http {
    pub(crate) fn new(
        connection: &PlatformConnection,
        token: &str,
        base: String,
        accept: &'static str,
    ) -> Result<Self> {
        let client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .danger_accept_invalid_certs(connection.insecure_tls)
            .build()
            .map_err(|error| PlatformError::Network {
                host: connection.host.clone(),
                detail: error.to_string(),
            })?;
        Ok(Self {
            client,
            base,
            host: connection.host.clone(),
            token: token.to_owned(),
            accept,
        })
    }

    pub(crate) fn host(&self) -> &str {
        &self.host
    }

    fn transport(&self, error: &reqwest::Error) -> PlatformError {
        let detail = if error.is_timeout() {
            "the request timed out"
        } else if error.is_connect() {
            "could not connect"
        } else {
            "the request failed"
        };
        PlatformError::Network {
            host: self.host.clone(),
            detail: detail.to_owned(),
        }
    }

    fn message(&self, text: &str) -> String {
        let value: Option<Value> = serde_json::from_str(text).ok();
        let found = value.as_ref().and_then(|value| {
            [
                value.get("message"),
                value.get("error"),
                value.pointer("/error/message"),
                value.pointer("/errors/0/message"),
            ]
            .into_iter()
            .flatten()
            .find_map(Value::as_str)
            .map(str::to_owned)
        });
        let message = found.unwrap_or_else(|| text.to_owned());
        let message = if self.token.is_empty() {
            message
        } else {
            message.replace(&self.token, "<redacted>")
        };
        message.chars().take(MESSAGE_LIMIT).collect()
    }

    pub(crate) async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        missing: &str,
    ) -> Result<Value> {
        Ok(self.exchange(method, path, body, missing, None).await?.0)
    }

    pub(crate) async fn call_with_header(
        &self,
        path: &str,
        missing: &str,
        header: &str,
    ) -> Result<(Value, Option<String>)> {
        self.exchange(Method::GET, path, None, missing, Some(header))
            .await
    }

    async fn exchange(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        missing: &str,
        header: Option<&str>,
    ) -> Result<(Value, Option<String>)> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("Accept", self.accept);
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/json")
                .body(body.to_string());
        }
        let response = request
            .send()
            .await
            .map_err(|error| self.transport(&error))?;
        let status = response.status();
        let header = header
            .and_then(|name| response.headers().get(name))
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let text = response
            .text()
            .await
            .map_err(|error| self.transport(&error))?;
        match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(PlatformError::AuthFailed {
                host: self.host.clone(),
                detail: self.message(&text),
            }),
            StatusCode::NOT_FOUND => Err(PlatformError::NotFound {
                detail: missing.to_owned(),
            }),
            status if !status.is_success() => Err(PlatformError::Api {
                host: self.host.clone(),
                status: status.as_u16(),
                detail: self.message(&text),
            }),
            _ if text.trim().is_empty() => Ok((Value::Null, header)),
            _ => serde_json::from_str(&text)
                .map(|value| (value, header))
                .map_err(|error| self.unexpected(&error)),
        }
    }

    pub(crate) fn unexpected(&self, error: &serde_json::Error) -> PlatformError {
        PlatformError::Api {
            host: self.host.clone(),
            status: 200,
            detail: format!("unexpected response: {error}"),
        }
    }

    pub(crate) fn decode<T: DeserializeOwned>(&self, value: Value) -> Result<T> {
        serde_json::from_value(value).map_err(|error| self.unexpected(&error))
    }
}
