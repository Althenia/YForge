use std::fmt;
use std::future::Future;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::task::Poll;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use yforge_core::{CancelToken, PlatformKind};
pub use yforge_core::{PlatformOAuthMethod, PlatformOAuthStage};

use crate::error::{PlatformError, Result};
use crate::http::{encode, scheme_for};

const EXPIRY_BUFFER_MS: i64 = 60_000;
const CANCEL_POLL: Duration = Duration::from_millis(50);
const CALLBACK_READ_LIMIT: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const GITHUB_SCOPE: &str = "repo read:org";
const GITLAB_SCOPE: &str = "api read_user write_repository";
const BITBUCKET_CLOUD_HOST: &str = "bitbucket.org";
const BITBUCKET_DATA_CENTER_MESSAGE: &str =
    "Bitbucket Data Center uses personal access tokens; paste an HTTP access token instead";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthRecord {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub client_id: String,
    pub client_secret: Option<String>,
}

impl fmt::Debug for OAuthRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OAuthRecord")
            .field("access_token", &"<redacted>")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "<redacted>"),
            )
            .field("expires_at", &self.expires_at)
            .field("client_id", &self.client_id)
            .field(
                "client_secret",
                &self.client_secret.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

impl OAuthRecord {
    pub fn expired(&self, now_ms: i64) -> bool {
        self.expires_at
            .is_some_and(|expires_at| expires_at.saturating_sub(EXPIRY_BUFFER_MS) <= now_ms)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthEndpoints {
    pub github_base: Option<String>,
    pub gitlab_base: Option<String>,
    pub bitbucket_base: Option<String>,
    pub callback_port: u16,
}

pub fn git_https_username(kind: PlatformKind, host: &str, login: Option<&str>) -> String {
    match kind {
        PlatformKind::GitHub => "x-access-token".to_owned(),
        PlatformKind::GitLab => "oauth2".to_owned(),
        PlatformKind::Bitbucket if host.eq_ignore_ascii_case(BITBUCKET_CLOUD_HOST) => {
            "x-token-auth".to_owned()
        }
        PlatformKind::Bitbucket => login
            .filter(|login| !login.trim().is_empty())
            .unwrap_or("x-token-auth")
            .to_owned(),
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const ROUND_CONSTANTS: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_STATE: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut message = data.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    let mut state = INITIAL_STATE;
    let (blocks, _) = message.as_chunks::<64>();
    for block in blocks {
        let mut words = [0_u32; 64];
        let (word_bytes, _) = block.as_chunks::<4>();
        for (word, bytes) in words.iter_mut().zip(word_bytes) {
            *word = u32::from_be_bytes(*bytes);
        }
        for i in 16..64 {
            let (a, b) = (words[i - 15], words[i - 2]);
            let low = a.rotate_right(7) ^ a.rotate_right(18) ^ (a >> 3);
            let high = b.rotate_right(17) ^ b.rotate_right(19) ^ (b >> 10);
            words[i] = words[i - 16]
                .wrapping_add(low)
                .wrapping_add(words[i - 7])
                .wrapping_add(high);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..64 {
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ (!e & g);
            let first = h
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(ROUND_CONSTANTS[i])
                .wrapping_add(words[i]);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let second = sum0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(first);
            d = c;
            c = b;
            b = a;
            a = first.wrapping_add(second);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }
    let mut digest = [0_u8; 32];
    let (out, _) = digest.as_chunks_mut::<4>();
    for (bytes, word) in out.iter_mut().zip(state) {
        *bytes = word.to_be_bytes();
    }
    digest
}

fn base64url_encode(data: &[u8]) -> String {
    let mut text = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let value = chunk.iter().enumerate().fold(0_u32, |acc, (i, byte)| {
            acc | (u32::from(*byte) << (16 - 8 * i))
        });
        for i in 0..=chunk.len() {
            text.push(char::from(
                ALPHABET[((value >> (18 - 6 * i)) & 63) as usize],
            ));
        }
    }
    text
}

fn random_bytes<const N: usize>() -> std::io::Result<[u8; N]> {
    let mut bytes = [0_u8; N];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn random_text() -> Result<String> {
    random_bytes::<32>()
        .map(|bytes| base64url_encode(&bytes))
        .map_err(|error| PlatformError::Network {
            host: "localhost".to_owned(),
            detail: format!("no secure random source: {error}"),
        })
}

fn pkce_pair() -> Result<(String, String)> {
    let verifier = random_text()?;
    let challenge = base64url_encode(&sha256(verifier.as_bytes()));
    Ok((verifier, challenge))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn cancelled() -> PlatformError {
    PlatformError::Core(yforge_core::CoreError::Cancelled)
}

fn check_cancel(cancel: &CancelToken) -> Result<()> {
    if cancel.is_cancelled() {
        Err(cancelled())
    } else {
        Ok(())
    }
}

async fn sleep_async(duration: Duration) {
    if duration.is_zero() {
        return;
    }
    let deadline = Instant::now() + duration;
    std::future::poll_fn(move |cx| {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Poll::Ready(());
        }
        let waker = cx.waker().clone();
        let wait = left.min(CANCEL_POLL);
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            waker.wake();
        });
        Poll::Pending
    })
    .await;
}

async fn pause(duration: Duration, cancel: &CancelToken) -> Result<()> {
    let deadline = Instant::now() + duration;
    loop {
        check_cancel(cancel)?;
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(());
        }
        sleep_async(left.min(CANCEL_POLL)).await;
    }
}

fn client(insecure_tls: bool, host: &str) -> Result<Client> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .danger_accept_invalid_certs(insecure_tls)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| PlatformError::Network {
            host: host.to_owned(),
            detail: error.to_string(),
        })
}

fn transport(host: &str, error: &reqwest::Error) -> PlatformError {
    let detail = if error.is_timeout() {
        "the request timed out"
    } else if error.is_connect() {
        "could not connect"
    } else {
        "the request failed"
    };
    PlatformError::Network {
        host: host.to_owned(),
        detail: detail.to_owned(),
    }
}

async fn post_form(
    client: &Client,
    url: &str,
    host: &str,
    pairs: Vec<(String, String)>,
    basic: Option<(String, String)>,
    cancel: &CancelToken,
) -> Result<(u16, String)> {
    check_cancel(cancel)?;
    let body = pairs
        .iter()
        .map(|(name, value)| {
            format!(
                "{}={}",
                encode(name).replace("%20", "+"),
                encode(value).replace("%20", "+")
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    let mut request = client
        .post(url)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body);
    if let Some((user, secret)) = basic {
        request = request.basic_auth(user, Some(secret));
    }
    let token = cancel.clone();
    let mut future = Box::pin(request.send());
    let response = std::future::poll_fn(move |cx| {
        if token.is_cancelled() {
            return Poll::Ready(Err(cancelled()));
        }
        match future.as_mut().poll(cx) {
            Poll::Ready(Ok(response)) => Poll::Ready(Ok(response)),
            Poll::Ready(Err(error)) => Poll::Ready(Err(transport(host, &error))),
            Poll::Pending => Poll::Pending,
        }
    })
    .await?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|error| transport(host, &error))?;
    check_cancel(cancel)?;
    Ok((status, text))
}

fn message_from(text: &str) -> String {
    let value: Option<Value> = serde_json::from_str(text).ok();
    let found = value.as_ref().and_then(|value| {
        [
            value.get("error_description"),
            value.get("error"),
            value.get("message"),
            value.pointer("/error/message"),
        ]
        .into_iter()
        .flatten()
        .find_map(Value::as_str)
        .map(str::to_owned)
    });
    found
        .unwrap_or_else(|| text.chars().take(300).collect())
        .chars()
        .take(300)
        .collect()
}

fn field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value.get(name).and_then(Value::as_str)
}

fn token_from(
    status: u16,
    text: &str,
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    previous: Option<&OAuthRecord>,
) -> Result<OAuthRecord> {
    if matches!(status, 401 | 403) {
        return Err(PlatformError::AuthFailed {
            host: host.to_owned(),
            detail: message_from(text),
        });
    }
    if !(200..300).contains(&status) {
        return Err(PlatformError::Api {
            host: host.to_owned(),
            status,
            detail: message_from(text),
        });
    }
    let value: Value = serde_json::from_str(text).map_err(|error| PlatformError::Api {
        host: host.to_owned(),
        status: 200,
        detail: format!("unexpected response: {error}"),
    })?;
    if let Some(error) = field(&value, "error") {
        return Err(PlatformError::AuthFailed {
            host: host.to_owned(),
            detail: field(&value, "error_description")
                .unwrap_or(error)
                .to_owned(),
        });
    }
    let access_token = field(&value, "access_token")
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| PlatformError::Api {
            host: host.to_owned(),
            status: 200,
            detail: "the OAuth token reply has no access token".to_owned(),
        })?;
    let expires_at = value
        .get("expires_in")
        .and_then(Value::as_i64)
        .map(|seconds| now_ms().saturating_add(seconds.saturating_mul(1000)));
    Ok(OAuthRecord {
        access_token: access_token.to_owned(),
        refresh_token: field(&value, "refresh_token")
            .map(str::to_owned)
            .or_else(|| previous.and_then(|record| record.refresh_token.clone())),
        expires_at: expires_at.or_else(|| previous.and_then(|record| record.expires_at)),
        client_id: client_id.to_owned(),
        client_secret: client_secret
            .map(str::to_owned)
            .or_else(|| previous.and_then(|record| record.client_secret.clone())),
    })
}

fn clean_base(base: &str) -> String {
    base.trim().trim_end_matches('/').to_owned()
}

fn github_base(host: &str, endpoints: &OAuthEndpoints) -> String {
    if let Some(base) = &endpoints.github_base {
        return clean_base(base);
    }
    if host.eq_ignore_ascii_case("github.com") {
        "https://github.com".to_owned()
    } else {
        format!("{}://{host}", scheme_for(host))
    }
}

fn gitlab_base(host: &str, endpoints: &OAuthEndpoints) -> String {
    if let Some(base) = &endpoints.gitlab_base {
        return clean_base(base);
    }
    format!("{}://{host}", scheme_for(host))
}

fn bitbucket_base(endpoints: &OAuthEndpoints) -> String {
    endpoints
        .bitbucket_base
        .as_deref()
        .map_or_else(|| "https://bitbucket.org".to_owned(), clean_base)
}

fn url_with_query(base: &str, pairs: &[(&str, &str)]) -> String {
    let query = pairs
        .iter()
        .map(|(name, value)| format!("{}={}", encode(name), encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{base}?{query}")
}

fn form_pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

enum Callback {
    Ignored,
    Code(String),
    Failed(String),
}

fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>YForge</title><body>{message}</body>"
    );
    let reply = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(reply.as_bytes());
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    Err(_) => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        if percent_decode(key) == name {
            Some(percent_decode(value))
        } else {
            None
        }
    })
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
    let (path, query) = target
        .split_once('?')
        .map_or((target, ""), |(path, query)| (path, query));
    if path != "/oauth/callback" {
        respond(&mut stream, "404 Not Found", "Not found");
        return Callback::Ignored;
    }
    if let Some(error) =
        query_param(query, "error_description").or_else(|| query_param(query, "error"))
    {
        respond(
            &mut stream,
            "400 Bad Request",
            "Sign-in failed. Close this tab and try again in YForge.",
        );
        return Callback::Failed(error);
    }
    let Some(code) = query_param(query, "code") else {
        respond(
            &mut stream,
            "400 Bad Request",
            "Sign-in failed. Close this tab and try again in YForge.",
        );
        return Callback::Failed("the sign-in reply has no authorization code".to_owned());
    };
    if query_param(query, "state").as_deref() != Some(state) {
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
        "Signed in to YForge. You can close this tab.",
    );
    Callback::Code(code)
}

async fn wait_for_code(
    listener: &TcpListener,
    state: &str,
    host: &str,
    cancel: &CancelToken,
) -> Result<String> {
    loop {
        check_cancel(cancel)?;
        match listener.accept() {
            Ok((stream, _)) => match handle_connection(stream, state) {
                Callback::Code(code) => return Ok(code),
                Callback::Failed(reason) => {
                    return Err(PlatformError::AuthFailed {
                        host: host.to_owned(),
                        detail: reason,
                    })
                }
                Callback::Ignored => {}
            },
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                sleep_async(CANCEL_POLL).await;
            }
            Err(error) => {
                return Err(PlatformError::Network {
                    host: host.to_owned(),
                    detail: format!("the sign-in listener failed: {error}"),
                })
            }
        }
    }
}

struct BrowserFlow {
    authorize_url: String,
    token_url: String,
    token_pairs: Vec<(String, String)>,
    basic: Option<(String, String)>,
}

#[allow(clippy::too_many_arguments)]
async fn run_browser(
    flow_for_redirect: impl FnOnce(&str, &str) -> Result<BrowserFlow>,
    host: &str,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
    client_id: &str,
    client_secret: Option<&str>,
    previous: Option<&OAuthRecord>,
) -> Result<OAuthRecord> {
    check_cancel(cancel)?;
    let listener = TcpListener::bind(("127.0.0.1", endpoints.callback_port)).map_err(|error| {
        PlatformError::Network {
            host: host.to_owned(),
            detail: format!(
                "could not listen for the sign-in on port {}: {error}",
                endpoints.callback_port
            ),
        }
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| PlatformError::Network {
            host: host.to_owned(),
            detail: format!("the sign-in listener failed: {error}"),
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| PlatformError::Network {
            host: host.to_owned(),
            detail: format!("the sign-in listener failed: {error}"),
        })?
        .port();
    let redirect = format!("http://127.0.0.1:{port}/oauth/callback");
    let state = random_text()?;
    let flow = flow_for_redirect(&redirect, &state)?;
    on_stage(PlatformOAuthStage::Browser {
        url: flow.authorize_url.clone(),
    });
    let code = wait_for_code(&listener, &state, host, cancel).await?;
    drop(listener);
    let http = client(insecure_tls, host)?;
    let (status, text) = post_form(
        &http,
        &flow.token_url,
        host,
        flow.token_pairs_with_code(&code),
        flow.basic.clone(),
        cancel,
    )
    .await?;
    let _ = (client_id, client_secret);
    token_from(status, &text, host, client_id, client_secret, previous)
}

impl BrowserFlow {
    fn token_pairs_with_code(&self, code: &str) -> Vec<(String, String)> {
        self.token_pairs
            .iter()
            .map(|(name, value)| {
                if name == "code" {
                    (name.clone(), code.to_owned())
                } else {
                    (name.clone(), value.clone())
                }
            })
            .collect()
    }
}

fn secret_pair(pairs: &mut Vec<(String, String)>, client_secret: Option<&str>) {
    if let Some(secret) = client_secret {
        pairs.push(("client_secret".to_owned(), secret.to_owned()));
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn github_sign_in(
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    method: PlatformOAuthMethod,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
) -> Result<OAuthRecord> {
    let base = github_base(host, endpoints);
    match method {
        PlatformOAuthMethod::DeviceCode => {
            github_device_sign_in(
                &base,
                host,
                client_id,
                client_secret,
                insecure_tls,
                cancel,
                on_stage,
            )
            .await
        }
        PlatformOAuthMethod::Browser => {
            let http_client_id = client_id.to_owned();
            let secret = client_secret.map(str::to_owned);
            run_browser(
                move |redirect, state| {
                    let (verifier, challenge) = pkce_pair()?;
                    let authorize_url = url_with_query(
                        &format!("{base}/login/oauth/authorize"),
                        &[
                            ("client_id", &http_client_id),
                            ("redirect_uri", redirect),
                            ("scope", GITHUB_SCOPE),
                            ("state", state),
                            ("code_challenge", &challenge),
                            ("code_challenge_method", "S256"),
                        ],
                    );
                    let mut pairs = form_pairs(&[
                        ("client_id", &http_client_id),
                        ("code", ""),
                        ("redirect_uri", redirect),
                        ("code_verifier", &verifier),
                    ]);
                    secret_pair(&mut pairs, secret.as_deref());
                    Ok(BrowserFlow {
                        authorize_url,
                        token_url: format!("{base}/login/oauth/access_token"),
                        token_pairs: pairs,
                        basic: None,
                    })
                },
                host,
                endpoints,
                insecure_tls,
                cancel,
                on_stage,
                client_id,
                client_secret,
                None,
            )
            .await
        }
    }
}

async fn github_device_sign_in(
    base: &str,
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
) -> Result<OAuthRecord> {
    let http = client(insecure_tls, host)?;
    let (status, text) = post_form(
        &http,
        &format!("{base}/login/device/code"),
        host,
        form_pairs(&[("client_id", client_id), ("scope", GITHUB_SCOPE)]),
        None,
        cancel,
    )
    .await?;
    if !(200..300).contains(&status) {
        return Err(if matches!(status, 401 | 403) {
            PlatformError::AuthFailed {
                host: host.to_owned(),
                detail: message_from(&text),
            }
        } else {
            PlatformError::Api {
                host: host.to_owned(),
                status,
                detail: message_from(&text),
            }
        });
    }
    let value: Value = serde_json::from_str(&text).map_err(|error| PlatformError::Api {
        host: host.to_owned(),
        status: 200,
        detail: format!("unexpected response: {error}"),
    })?;
    let device_code = field(&value, "device_code")
        .ok_or_else(|| PlatformError::invalid("the device reply has no device code"))?
        .to_owned();
    let user_code = field(&value, "user_code")
        .ok_or_else(|| PlatformError::invalid("the device reply has no user code"))?
        .to_owned();
    let verification = field(&value, "verification_uri")
        .or_else(|| field(&value, "verification_url"))
        .unwrap_or("https://github.com/login/device")
        .to_owned();
    let mut interval = value
        .get("interval")
        .and_then(|interval| {
            interval
                .as_u64()
                .or_else(|| interval.as_str().and_then(|text| text.trim().parse().ok()))
        })
        .unwrap_or(5);
    let lifetime = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(900);
    let deadline = Instant::now() + Duration::from_secs(lifetime);
    on_stage(PlatformOAuthStage::DeviceCode {
        url: verification,
        code: user_code,
    });
    loop {
        if Instant::now() >= deadline {
            return Err(PlatformError::AuthFailed {
                host: host.to_owned(),
                detail: "the device code expired".to_owned(),
            });
        }
        pause(Duration::from_secs(interval), cancel).await?;
        let (status, text) = post_form(
            &http,
            &format!("{base}/login/oauth/access_token"),
            host,
            form_pairs(&[
                ("client_id", client_id),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", &device_code),
            ]),
            None,
            cancel,
        )
        .await?;
        let parsed: Option<Value> = serde_json::from_str(&text).ok();
        let error = parsed.as_ref().and_then(|value| field(value, "error"));
        match error {
            Some("authorization_pending") => {}
            Some("slow_down") => interval = interval.saturating_add(5),
            Some("access_denied") => {
                return Err(PlatformError::AuthFailed {
                    host: host.to_owned(),
                    detail: "access was denied".to_owned(),
                })
            }
            Some("expired_token") => {
                return Err(PlatformError::AuthFailed {
                    host: host.to_owned(),
                    detail: "the device code expired".to_owned(),
                })
            }
            Some(other) => {
                return Err(PlatformError::AuthFailed {
                    host: host.to_owned(),
                    detail: parsed
                        .as_ref()
                        .and_then(|value| field(value, "error_description"))
                        .unwrap_or(other)
                        .to_owned(),
                })
            }
            None => {
                return token_from(status, &text, host, client_id, client_secret, None);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn gitlab_sign_in(
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    method: PlatformOAuthMethod,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
) -> Result<OAuthRecord> {
    if method == PlatformOAuthMethod::DeviceCode {
        return Err(PlatformError::invalid(
            "GitLab sign-in uses the browser flow",
        ));
    }
    let base = gitlab_base(host, endpoints);
    let client_id_owned = client_id.to_owned();
    let secret = client_secret.map(str::to_owned);
    run_browser(
        move |redirect, state| {
            let (verifier, challenge) = pkce_pair()?;
            let authorize_url = url_with_query(
                &format!("{base}/oauth/authorize"),
                &[
                    ("client_id", &client_id_owned),
                    ("redirect_uri", redirect),
                    ("response_type", "code"),
                    ("scope", GITLAB_SCOPE),
                    ("state", state),
                    ("code_challenge", &challenge),
                    ("code_challenge_method", "S256"),
                ],
            );
            let mut pairs = form_pairs(&[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id_owned),
                ("code", ""),
                ("redirect_uri", redirect),
                ("code_verifier", &verifier),
            ]);
            secret_pair(&mut pairs, secret.as_deref());
            Ok(BrowserFlow {
                authorize_url,
                token_url: format!("{base}/oauth/token"),
                token_pairs: pairs,
                basic: None,
            })
        },
        host,
        endpoints,
        insecure_tls,
        cancel,
        on_stage,
        client_id,
        client_secret,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn bitbucket_sign_in(
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    method: PlatformOAuthMethod,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
) -> Result<OAuthRecord> {
    if !host.eq_ignore_ascii_case(BITBUCKET_CLOUD_HOST) {
        return Err(PlatformError::invalid(BITBUCKET_DATA_CENTER_MESSAGE));
    }
    if method == PlatformOAuthMethod::DeviceCode {
        return Err(PlatformError::invalid(
            "Bitbucket sign-in uses the browser flow",
        ));
    }
    let base = bitbucket_base(endpoints);
    let client_id_owned = client_id.to_owned();
    let secret = client_secret.map(str::to_owned);
    run_browser(
        move |redirect, state| {
            let authorize_url = url_with_query(
                &format!("{base}/site/oauth2/authorize"),
                &[
                    ("client_id", &client_id_owned),
                    ("response_type", "code"),
                    ("state", state),
                    ("redirect_uri", redirect),
                ],
            );
            let mut pairs = form_pairs(&[
                ("grant_type", "authorization_code"),
                ("code", ""),
                ("redirect_uri", redirect),
                ("client_id", &client_id_owned),
            ]);
            secret_pair(&mut pairs, secret.as_deref());
            Ok(BrowserFlow {
                authorize_url,
                token_url: format!("{base}/site/oauth2/access_token"),
                token_pairs: pairs,
                basic: Some((client_id_owned.clone(), secret.clone().unwrap_or_default())),
            })
        },
        host,
        endpoints,
        insecure_tls,
        cancel,
        on_stage,
        client_id,
        client_secret,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn sign_in(
    kind: PlatformKind,
    host: &str,
    client_id: &str,
    client_secret: Option<&str>,
    method: PlatformOAuthMethod,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
    on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
) -> Result<OAuthRecord> {
    match kind {
        PlatformKind::GitHub => {
            github_sign_in(
                host,
                client_id,
                client_secret,
                method,
                endpoints,
                insecure_tls,
                cancel,
                on_stage,
            )
            .await
        }
        PlatformKind::GitLab => {
            gitlab_sign_in(
                host,
                client_id,
                client_secret,
                method,
                endpoints,
                insecure_tls,
                cancel,
                on_stage,
            )
            .await
        }
        PlatformKind::Bitbucket => {
            bitbucket_sign_in(
                host,
                client_id,
                client_secret,
                method,
                endpoints,
                insecure_tls,
                cancel,
                on_stage,
            )
            .await
        }
    }
}

pub async fn refresh(
    kind: PlatformKind,
    host: &str,
    record: &OAuthRecord,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
) -> Result<OAuthRecord> {
    let refresh_token =
        record
            .refresh_token
            .as_deref()
            .ok_or_else(|| PlatformError::AuthFailed {
                host: host.to_owned(),
                detail: "no refresh token is stored for this connection".to_owned(),
            })?;
    let http = client(insecure_tls, host)?;
    let (url, pairs, basic) = match kind {
        PlatformKind::GitHub => {
            let mut pairs = form_pairs(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", &record.client_id),
            ]);
            secret_pair(&mut pairs, record.client_secret.as_deref());
            (
                format!("{}/login/oauth/access_token", github_base(host, endpoints)),
                pairs,
                None,
            )
        }
        PlatformKind::GitLab => {
            let mut pairs = form_pairs(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", &record.client_id),
            ]);
            secret_pair(&mut pairs, record.client_secret.as_deref());
            (
                format!("{}/oauth/token", gitlab_base(host, endpoints)),
                pairs,
                None,
            )
        }
        PlatformKind::Bitbucket => {
            if !host.eq_ignore_ascii_case(BITBUCKET_CLOUD_HOST) {
                return Err(PlatformError::invalid(BITBUCKET_DATA_CENTER_MESSAGE));
            }
            let mut pairs = form_pairs(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", &record.client_id),
            ]);
            secret_pair(&mut pairs, record.client_secret.as_deref());
            (
                format!("{}/site/oauth2/access_token", bitbucket_base(endpoints)),
                pairs,
                Some((
                    record.client_id.clone(),
                    record.client_secret.clone().unwrap_or_default(),
                )),
            )
        }
    };
    let (status, text) = post_form(&http, &url, host, pairs, basic, cancel).await?;
    token_from(
        status,
        &text,
        host,
        &record.client_id,
        record.client_secret.as_deref(),
        Some(record),
    )
}

pub async fn refresh_github(
    host: &str,
    record: &OAuthRecord,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
) -> Result<OAuthRecord> {
    refresh(
        PlatformKind::GitHub,
        host,
        record,
        endpoints,
        insecure_tls,
        cancel,
    )
    .await
}

pub async fn refresh_gitlab(
    host: &str,
    record: &OAuthRecord,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
) -> Result<OAuthRecord> {
    refresh(
        PlatformKind::GitLab,
        host,
        record,
        endpoints,
        insecure_tls,
        cancel,
    )
    .await
}

pub async fn refresh_bitbucket(
    host: &str,
    record: &OAuthRecord,
    endpoints: &OAuthEndpoints,
    insecure_tls: bool,
    cancel: &CancelToken,
) -> Result<OAuthRecord> {
    refresh(
        PlatformKind::Bitbucket,
        host,
        record,
        endpoints,
        insecure_tls,
        cancel,
    )
    .await
}
