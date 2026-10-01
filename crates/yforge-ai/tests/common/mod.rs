#![allow(dead_code)]
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use yforge_ai::{Ai, Endpoints, Limits, MemoryStore, CLAUDE_CODE_SERVICE};
use yforge_core::{AuthMode, ProviderInput, ProviderKind};

pub struct Harness {
    pub data: tempfile::TempDir,
    pub secrets: Arc<MemoryStore>,
    pub claude_code: Arc<MemoryStore>,
}

impl Harness {
    pub fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        yforge_core::start_storage(data.path()).unwrap();
        Self {
            data,
            secrets: Arc::new(MemoryStore::default()),
            claude_code: Arc::new(MemoryStore::default()),
        }
    }

    pub fn dir(&self) -> &Path {
        self.data.path()
    }

    pub fn ai(&self) -> Ai {
        self.ai_with(test_limits(), Endpoints::default())
    }

    pub fn ai_at(&self, endpoints: Endpoints) -> Ai {
        self.ai_with(test_limits(), endpoints)
    }

    pub fn ai_with(&self, limits: Limits, endpoints: Endpoints) -> Ai {
        Ai::new(self.secrets.clone())
            .with_claude_code_store(self.claude_code.clone())
            .with_limits(limits)
            .with_endpoints(endpoints)
    }

    pub fn claude_code_signs_in(&self, json: &str) {
        yforge_ai::SecretStore::set(&*self.claude_code, CLAUDE_CODE_SERVICE, json).unwrap();
    }
}

pub fn test_limits() -> Limits {
    Limits {
        completion: Duration::from_secs(20),
        status: Duration::from_secs(10),
        sign_in: Duration::from_secs(20),
        poll_margin: Duration::ZERO,
    }
}

pub fn provider_input(kind: ProviderKind, auth_mode: AuthMode, name: &str) -> ProviderInput {
    ProviderInput {
        kind,
        auth_mode,
        name: name.to_owned(),
        base_url: None,
        api_key: None,
    }
}

pub fn keyed_input(kind: ProviderKind, name: &str, key: &str) -> ProviderInput {
    ProviderInput {
        api_key: Some(key.to_owned()),
        ..provider_input(kind, AuthMode::ApiKey, name)
    }
}

pub fn http_input(name: &str, base_url: &str, key: Option<&str>) -> ProviderInput {
    ProviderInput {
        base_url: Some(base_url.to_owned()),
        api_key: key.map(str::to_owned),
        ..provider_input(ProviderKind::OpenaiCompatible, AuthMode::ApiKey, name)
    }
}

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

pub struct Reply {
    pub status: u16,
    pub body: String,
    pub delay: Duration,
}

impl Reply {
    pub fn ok(body: &str) -> Self {
        Self {
            status: 200,
            body: body.to_owned(),
            delay: Duration::ZERO,
        }
    }

    pub fn status(status: u16, body: &str) -> Self {
        Self {
            status,
            body: body.to_owned(),
            delay: Duration::ZERO,
        }
    }

    pub fn delayed(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

pub struct HttpFake {
    pub url: String,
    pub root: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
    stop: Arc<AtomicBool>,
    port: u16,
}

fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    let mut data = Vec::new();
    let mut chunk = [0_u8; 4096];
    let end = loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..read]);
        if let Some(position) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let head = String::from_utf8_lossy(&data[..end]).into_owned();
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    let method = start.next()?.to_owned();
    let path = start.next()?.to_owned();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.parse().ok())
        .unwrap_or(0);
    while data.len() < end + length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8_lossy(&data[end..]).into_owned();
    Some(Recorded {
        method,
        path,
        headers,
        body,
    })
}

impl HttpFake {
    pub fn start(route: impl Fn(&Recorded) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let route = Arc::new(route);
        let (seen, halt) = (requests.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if halt.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(mut stream) = stream else { continue };
                let (seen, route) = (seen.clone(), route.clone());
                std::thread::spawn(move || {
                    let Some(request) = read_request(&mut stream) else {
                        return;
                    };
                    seen.lock().unwrap().push(request.clone());
                    let reply = route(&request);
                    std::thread::sleep(reply.delay);
                    let text = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        reply.status,
                        reply.body.len(),
                        reply.body
                    );
                    let _ = stream.write_all(text.as_bytes());
                });
            }
        });
        Self {
            url: format!("http://127.0.0.1:{port}/v1"),
            root: format!("http://127.0.0.1:{port}"),
            requests,
            stop,
            port,
        }
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for HttpFake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

pub fn closed_port_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    format!("http://127.0.0.1:{port}/v1")
}

pub fn sse(events: &[serde_json::Value]) -> String {
    events
        .iter()
        .map(|event| format!("event: x\ndata: {event}\n\n"))
        .collect()
}

pub fn responses_reply(text: &str) -> String {
    sse(&[
        serde_json::json!({"type": "response.output_text.delta", "delta": text}),
        serde_json::json!({"type": "response.completed", "response": {"output": []}}),
    ])
}

pub fn messages_reply(text: &str) -> String {
    serde_json::json!({"content": [{"type": "text", "text": text}]}).to_string()
}

pub fn chat_reply(content: &str) -> String {
    serde_json::json!({"choices": [{"message": {"role": "assistant", "content": content}}]})
        .to_string()
}

pub struct Repo {
    _scratch: tempfile::TempDir,
    pub path: PathBuf,
}

impl Repo {
    pub fn new() -> Self {
        let scratch = tempfile::tempdir().unwrap();
        let path = scratch.path().canonicalize().unwrap().join("repo");
        std::fs::create_dir(&path).unwrap();
        let repo = Self {
            _scratch: scratch,
            path,
        };
        repo.git(&["init", "-q", "-b", "main"]);
        repo
    }

    pub fn git(&self, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&self.path)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Yui Lin")
            .env("GIT_AUTHOR_EMAIL", "yui@example.test")
            .env("GIT_COMMITTER_NAME", "Yui Lin")
            .env("GIT_COMMITTER_EMAIL", "yui@example.test")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    pub fn write(&self, name: &str, contents: &str) {
        let path = self.path.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, contents).unwrap();
    }

    pub fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.path.join(name)).unwrap()
    }

    pub fn commit(&self, name: &str, contents: &str, message: &str) {
        self.write(name, contents);
        self.git(&["add", "--", name]);
        self.git(&["commit", "-q", "-m", message]);
    }

    pub fn snapshot(&self) -> (String, String) {
        (
            self.git(&["rev-parse", "HEAD"]),
            self.git(&["status", "--porcelain=v1"]),
        )
    }
}

pub fn jwt(claims: &serde_json::Value) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut payload = String::new();
    for chunk in claims.to_string().as_bytes().chunks(3) {
        let value = chunk.iter().enumerate().fold(0_u32, |acc, (i, byte)| {
            acc | (u32::from(*byte) << (16 - 8 * i))
        });
        for i in 0..=chunk.len() {
            payload.push(char::from(
                ALPHABET[((value >> (18 - 6 * i)) & 63) as usize],
            ));
        }
    }
    format!("header.{payload}.signature")
}

pub const FAR_FUTURE: i64 = 4_102_444_800_000;

pub fn chatgpt_tokens(access: &str, expires_at: i64, account: Option<&str>) -> String {
    serde_json::json!({
        "access": access,
        "refresh": "refresh-1",
        "expires_at": expires_at,
        "account_id": account,
    })
    .to_string()
}

pub fn claude_blob(access: &str, refresh: &str, expires_at: i64) -> String {
    serde_json::json!({"claudeAiOauth": {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresAt": expires_at,
        "subscriptionType": "max",
    }})
    .to_string()
}

pub async fn configure(h: &Harness, ai: &Ai, id: &str, model: &str) {
    for summary in ai.feature_configs(h.dir()).await.unwrap() {
        let config = yforge_core::AiFeatureConfig {
            feature: summary.feature,
            provider_id: id.to_owned(),
            model_id: model.to_owned(),
            prompt_template: summary.default_prompt_template,
        };
        yforge_core::ai_feature_config_set(h.dir(), &config).unwrap();
    }
}

pub async fn add_configured(h: &Harness, ai: &Ai, input: ProviderInput, model: &str) -> String {
    let added = ai.add(h.dir(), input).await.unwrap();
    configure(h, ai, &added.config.id, model).await;
    added.config.id
}

pub fn store_tokens(h: &Harness, id: &str, json: &str) {
    yforge_ai::SecretStore::set(&*h.secrets, &format!("{id}:oauth"), json).unwrap();
}

pub fn commit_context() -> yforge_core::CommitContext {
    yforge_core::CommitContext {
        diff: "=== a.txt (modified) ===\n+DIFF-MARKER\n".to_owned(),
        recent_subjects: vec!["Earlier".to_owned()],
        excluded: Vec::new(),
        truncated: Vec::new(),
    }
}

pub const GOOD: &str = r#"{"summary":"Add thing","description":"Because."}"#;

pub async fn use_provider(h: &Harness, ai: &Ai, reply: Reply) -> (HttpFake, yforge_ai::Selection) {
    let fake = HttpFake::start(move |_| Reply {
        status: reply.status,
        body: reply.body.clone(),
        delay: reply.delay,
    });
    let added = ai
        .add(h.dir(), http_input("Endpoint", &fake.url, None))
        .await
        .unwrap();
    configure(h, ai, &added.config.id, "model-x").await;
    let selection = ai
        .resolve(h.dir(), yforge_core::AiFeature::GenerateCommit)
        .await
        .unwrap();
    (fake, selection)
}
