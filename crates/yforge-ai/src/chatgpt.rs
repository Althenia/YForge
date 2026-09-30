use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use yforge_core::CancelToken;

use crate::encoding::{base64url_decode, base64url_encode, random_bytes, sha256};
use crate::error::{AiError, Result};
use crate::http::{send, with_query, Body, Request};
use crate::limits::{seconds, Limits};

pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const LABEL: &str = "ChatGPT";
const SCOPE: &str = "openid profile email offline_access";
const ORIGINATOR: &str = "yforge";
const CANCEL_POLL: Duration = Duration::from_millis(50);
const EXPIRY_BUFFER_MS: i64 = 60_000;
const DEFAULT_LIFETIME_SECONDS: i64 = 3600;
const DEFAULT_POLL_SECONDS: u64 = 5;
const CALLBACK_READ_LIMIT: Duration = Duration::from_secs(2);

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
    pub expires_at: i64,
    pub account_id: Option<String>,
}

impl Tokens {
    pub fn expired(&self, now_ms: i64) -> bool {
        self.expires_at - EXPIRY_BUFFER_MS <= now_ms
    }
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Result<Pkce> {
    let verifier = base64url_encode(&random_bytes::<32>().map_err(entropy)?);
    let challenge = base64url_encode(&sha256(verifier.as_bytes()));
    Ok(Pkce {
        verifier,
        challenge,
    })
}

fn entropy(error: std::io::Error) -> AiError {
    AiError::Unavailable {
        provider: LABEL.to_owned(),
        detail: format!("no secure random source: {error}"),
    }
}

pub fn authorize_url(issuer: &str, redirect: &str, challenge: &str, state: &str) -> Result<String> {
    with_query(
        &format!("{issuer}/oauth/authorize"),
        &[
            ("response_type", "code"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect),
            ("scope", SCOPE),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("id_token_add_organizations", "true"),
            ("codex_cli_simplified_flow", "true"),
            ("state", state),
            ("originator", ORIGINATOR),
        ],
    )
}

fn claim(token: &str) -> Option<String> {
    let payload = base64url_decode(token.split('.').nth(1)?)?;
    let claims: Value = serde_json::from_slice(&payload).ok()?;
    let text = |value: Option<&Value>| value.and_then(Value::as_str).map(str::to_owned);
    text(claims.get("chatgpt_account_id"))
        .or_else(|| {
            text(
                claims
                    .get("https://api.openai.com/auth")
                    .and_then(|auth| auth.get("chatgpt_account_id")),
            )
        })
        .or_else(|| text(claims.pointer("/organizations/0/id")))
}

pub fn account_id(id_token: Option<&str>, access_token: &str) -> Option<String> {
    id_token.and_then(claim).or_else(|| claim(access_token))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn tokens_from(text: &str, previous: Option<&Tokens>) -> Result<Tokens> {
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: LABEL.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value =
        serde_json::from_str(text).map_err(|_| invalid("the token reply is not JSON"))?;
    let field = |name: &str| value.get(name).and_then(Value::as_str);
    let access =
        field("access_token").ok_or_else(|| invalid("the token reply has no access token"))?;
    let refresh = field("refresh_token")
        .or_else(|| previous.map(|tokens| tokens.refresh.as_str()))
        .ok_or_else(|| invalid("the token reply has no refresh token"))?;
    let lifetime = value
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_LIFETIME_SECONDS);
    Ok(Tokens {
        access: access.to_owned(),
        refresh: refresh.to_owned(),
        expires_at: now_ms().saturating_add(lifetime.saturating_mul(1000)),
        account_id: account_id(field("id_token"), access)
            .or_else(|| previous.and_then(|tokens| tokens.account_id.clone())),
    })
}

pub async fn exchange(
    issuer: &str,
    code: &str,
    redirect: &str,
    verifier: &str,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<Tokens> {
    let request = Request::post(
        LABEL,
        format!("{issuer}/oauth/token"),
        Body::Form(vec![
            ("grant_type", "authorization_code".to_owned()),
            ("code", code.to_owned()),
            ("redirect_uri", redirect.to_owned()),
            ("client_id", CLIENT_ID.to_owned()),
            ("code_verifier", verifier.to_owned()),
        ]),
    );
    let text = send(request, limits.status, Some(cancel))
        .await?
        .success()?;
    tokens_from(&text, None)
}

pub async fn refresh(issuer: &str, previous: &Tokens, limits: &Limits) -> Result<Tokens> {
    let request = Request::post(
        LABEL,
        format!("{issuer}/oauth/token"),
        Body::Form(vec![
            ("grant_type", "refresh_token".to_owned()),
            ("refresh_token", previous.refresh.clone()),
            ("client_id", CLIENT_ID.to_owned()),
        ]),
    );
    let reply = send(request, limits.status, None).await?;
    if reply.status.is_client_error() {
        return Err(AiError::AuthRequired {
            provider: LABEL.to_owned(),
            detail: "the ChatGPT sign-in expired; sign in again".to_owned(),
        });
    }
    tokens_from(&reply.success()?, Some(previous))
}

pub struct Device {
    pub id: String,
    pub user_code: String,
    pub interval: Duration,
}

pub async fn device_start(issuer: &str, limits: &Limits, cancel: &CancelToken) -> Result<Device> {
    let request = Request::post(
        LABEL,
        format!("{issuer}/api/accounts/deviceauth/usercode"),
        Body::Json(json!({"client_id": CLIENT_ID}).to_string()),
    );
    let text = send(request, limits.status, Some(cancel))
        .await?
        .success()?;
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: LABEL.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value =
        serde_json::from_str(&text).map_err(|_| invalid("the device reply is not JSON"))?;
    let field = |name: &str| value.get(name).and_then(Value::as_str).map(str::to_owned);
    let interval = match value.get("interval") {
        Some(Value::String(text)) => text.trim().parse().ok(),
        Some(number) => number.as_u64(),
        None => None,
    }
    .unwrap_or(DEFAULT_POLL_SECONDS);
    Ok(Device {
        id: field("device_auth_id").ok_or_else(|| invalid("the device reply has no device id"))?,
        user_code: field("user_code")
            .ok_or_else(|| invalid("the device reply has no user code"))?,
        interval: Duration::from_secs(interval),
    })
}

pub enum Poll {
    Pending,
    Approved {
        authorization_code: String,
        code_verifier: String,
    },
}

pub async fn device_poll(
    issuer: &str,
    device: &Device,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<Poll> {
    let request = Request::post(
        LABEL,
        format!("{issuer}/api/accounts/deviceauth/token"),
        Body::Json(json!({"device_auth_id": device.id, "user_code": device.user_code}).to_string()),
    );
    let reply = send(request, limits.status, Some(cancel)).await?;
    if matches!(reply.status.as_u16(), 403 | 404) {
        return Ok(Poll::Pending);
    }
    let text = reply.success()?;
    let invalid = |reason: &str| AiError::InvalidResponse {
        provider: LABEL.to_owned(),
        reason: reason.to_owned(),
    };
    let value: Value =
        serde_json::from_str(&text).map_err(|_| invalid("the approval reply is not JSON"))?;
    let field = |name: &str| value.get(name).and_then(Value::as_str).map(str::to_owned);
    Ok(Poll::Approved {
        authorization_code: field("authorization_code")
            .ok_or_else(|| invalid("the approval reply has no authorization code"))?,
        code_verifier: field("code_verifier")
            .ok_or_else(|| invalid("the approval reply has no code verifier"))?,
    })
}

async fn pause(duration: Duration, cancel: &CancelToken) -> Result<()> {
    let until = Instant::now() + duration;
    loop {
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(());
        }
        tokio::time::sleep(CANCEL_POLL.min(left)).await;
    }
}

pub async fn sign_in_device(
    issuer: &str,
    limits: &Limits,
    cancel: &CancelToken,
    on_code: &(dyn Fn(&str, &str) + Send + Sync),
) -> Result<Tokens> {
    let deadline = Instant::now() + limits.sign_in;
    let device = device_start(issuer, limits, cancel).await?;
    on_code(&format!("{issuer}/codex/device"), &device.user_code);
    loop {
        match device_poll(issuer, &device, limits, cancel).await? {
            Poll::Approved {
                authorization_code,
                code_verifier,
            } => {
                return exchange(
                    issuer,
                    &authorization_code,
                    &format!("{issuer}/deviceauth/callback"),
                    &code_verifier,
                    limits,
                    cancel,
                )
                .await
            }
            Poll::Pending => {
                if Instant::now() >= deadline {
                    return Err(AiError::Timeout {
                        provider: LABEL.to_owned(),
                        seconds: seconds(limits.sign_in),
                    });
                }
                pause(device.interval + limits.poll_margin, cancel).await?;
            }
        }
    }
}

enum Callback {
    Ignored,
    Code(String),
    Failed(String),
}

const PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>YForge</title><body style=\"font-family:system-ui;text-align:center;margin-top:20vh\"><h1>";

fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!("{PAGE}{message}</h1></body>");
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
}

fn handle_connection(mut stream: TcpStream, state: &str) -> Callback {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(CALLBACK_READ_LIMIT));
    let mut data = Vec::new();
    let mut chunk = [0_u8; 2048];
    while !data.windows(4).any(|window| window == b"\r\n\r\n") && data.len() < 16 * 1024 {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => data.extend_from_slice(&chunk[..read]),
        }
    }
    let head = String::from_utf8_lossy(&data);
    let mut parts = head.lines().next().unwrap_or_default().split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return Callback::Ignored;
    };
    let Ok(url) = Url::parse(&format!("http://localhost{target}")) else {
        return Callback::Ignored;
    };
    if url.path() != "/auth/callback" {
        respond(&mut stream, "404 Not Found", "Not found");
        return Callback::Ignored;
    }
    let param = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    if let Some(error) = param("error_description").or_else(|| param("error")) {
        respond(
            &mut stream,
            "400 Bad Request",
            "Sign-in failed. Close this tab and try again in YForge.",
        );
        return Callback::Failed(error);
    }
    let Some(code) = param("code") else {
        respond(
            &mut stream,
            "400 Bad Request",
            "Sign-in failed. Close this tab and try again in YForge.",
        );
        return Callback::Failed("the sign-in reply has no authorization code".to_owned());
    };
    if param("state").as_deref() != Some(state) {
        respond(
            &mut stream,
            "400 Bad Request",
            "Sign-in failed. Close this tab and try again in YForge.",
        );
        return Callback::Failed("the sign-in reply has an invalid state".to_owned());
    }
    respond(
        &mut stream,
        "200 OK",
        "Signed in. You can close this tab and return to YForge.",
    );
    Callback::Code(code)
}

async fn wait_for_code(
    listener: &TcpListener,
    state: &str,
    limits: &Limits,
    cancel: &CancelToken,
) -> Result<String> {
    let deadline = Instant::now() + limits.sign_in;
    loop {
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        if Instant::now() >= deadline {
            return Err(AiError::Timeout {
                provider: LABEL.to_owned(),
                seconds: seconds(limits.sign_in),
            });
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let state = state.to_owned();
                let outcome =
                    tokio::task::spawn_blocking(move || handle_connection(stream, &state))
                        .await
                        .map_err(|_| AiError::Failed {
                            provider: LABEL.to_owned(),
                            output: "the sign-in listener failed".to_owned(),
                        })?;
                match outcome {
                    Callback::Code(code) => return Ok(code),
                    Callback::Failed(reason) => {
                        return Err(AiError::AuthRequired {
                            provider: LABEL.to_owned(),
                            detail: crate::text::sanitize(&reason, &[]),
                        })
                    }
                    Callback::Ignored => {}
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(CANCEL_POLL).await;
            }
            Err(error) => {
                return Err(AiError::Unavailable {
                    provider: LABEL.to_owned(),
                    detail: format!("the sign-in listener failed: {error}"),
                })
            }
        }
    }
}

pub async fn sign_in_browser(
    issuer: &str,
    callback_port: u16,
    limits: &Limits,
    cancel: &CancelToken,
    on_url: &(dyn Fn(&str) + Send + Sync),
) -> Result<Tokens> {
    let listener =
        TcpListener::bind(("127.0.0.1", callback_port)).map_err(|error| AiError::Unavailable {
            provider: LABEL.to_owned(),
            detail: format!("could not listen for the sign-in on port {callback_port}: {error}"),
        })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| AiError::Unavailable {
            provider: LABEL.to_owned(),
            detail: format!("the sign-in listener failed: {error}"),
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| AiError::Unavailable {
            provider: LABEL.to_owned(),
            detail: format!("the sign-in listener failed: {error}"),
        })?
        .port();
    let redirect = format!("http://localhost:{port}/auth/callback");
    let pkce = pkce()?;
    let state = base64url_encode(&random_bytes::<32>().map_err(entropy)?);
    on_url(&authorize_url(issuer, &redirect, &pkce.challenge, &state)?);
    let code = wait_for_code(&listener, &state, limits, cancel).await?;
    drop(listener);
    exchange(issuer, &code, &redirect, &pkce.verifier, limits, cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(claims: &Value) -> String {
        format!("h.{}.s", base64url_encode(claims.to_string().as_bytes()))
    }

    #[test]
    fn the_account_id_comes_from_the_top_level_claim_first() {
        let token = jwt(&json!({
            "chatgpt_account_id": "top",
            "https://api.openai.com/auth": {"chatgpt_account_id": "nested"},
            "organizations": [{"id": "org"}],
        }));

        assert_eq!(account_id(Some(&token), "x.y.z"), Some("top".to_owned()));
    }

    #[test]
    fn the_account_id_falls_back_to_the_nested_claim_then_the_first_organization() {
        let nested = jwt(&json!({
            "https://api.openai.com/auth": {"chatgpt_account_id": "nested"},
            "organizations": [{"id": "org"}],
        }));
        let organization = jwt(&json!({"organizations": [{"id": "org-1"}, {"id": "org-2"}]}));

        assert_eq!(account_id(Some(&nested), "x"), Some("nested".to_owned()));
        assert_eq!(
            account_id(Some(&organization), "x"),
            Some("org-1".to_owned())
        );
    }

    #[test]
    fn the_access_token_is_consulted_when_the_id_token_has_no_account() {
        let id_token = jwt(&json!({"sub": "user"}));
        let access = jwt(&json!({"chatgpt_account_id": "from-access"}));

        assert_eq!(
            account_id(Some(&id_token), &access),
            Some("from-access".to_owned())
        );
        assert_eq!(account_id(None, &access), Some("from-access".to_owned()));
        assert_eq!(account_id(Some("garbage"), "also.garbage.here"), None);
    }

    #[test]
    fn the_pkce_challenge_is_the_s256_of_the_verifier() {
        let pair = pkce().unwrap();

        assert_eq!(pair.verifier.len(), 43);
        assert_eq!(
            pair.challenge,
            base64url_encode(&sha256(pair.verifier.as_bytes()))
        );
    }

    #[test]
    fn the_authorize_url_carries_the_pkce_and_codex_parameters() {
        let url = authorize_url(
            "https://auth.example.test",
            "http://localhost:1455/auth/callback",
            "challenge-1",
            "state-1",
        )
        .unwrap();
        let url = Url::parse(&url).unwrap();
        let param = |name: &str| {
            url.query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
        };

        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(param("response_type").as_deref(), Some("code"));
        assert_eq!(param("client_id").as_deref(), Some(CLIENT_ID));
        assert_eq!(
            param("redirect_uri").as_deref(),
            Some("http://localhost:1455/auth/callback")
        );
        assert_eq!(
            param("scope").as_deref(),
            Some("openid profile email offline_access")
        );
        assert_eq!(param("code_challenge").as_deref(), Some("challenge-1"));
        assert_eq!(param("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(param("id_token_add_organizations").as_deref(), Some("true"));
        assert_eq!(param("codex_cli_simplified_flow").as_deref(), Some("true"));
        assert_eq!(param("state").as_deref(), Some("state-1"));
        assert_eq!(param("originator").as_deref(), Some("yforge"));
    }
}
