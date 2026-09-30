#![allow(dead_code)]
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use yforge_ai::{Ai, Environment, Limits, MemoryStore};
use yforge_core::{ProviderInput, ProviderKind};

pub struct Harness {
    pub data: tempfile::TempDir,
    pub bin: tempfile::TempDir,
    pub secrets: Arc<MemoryStore>,
}

impl Harness {
    pub fn new() -> Self {
        let data = tempfile::tempdir().unwrap();
        yforge_core::start_storage(data.path()).unwrap();
        Self {
            data,
            bin: tempfile::tempdir().unwrap(),
            secrets: Arc::new(MemoryStore::default()),
        }
    }

    pub fn dir(&self) -> &Path {
        self.data.path()
    }

    pub fn script(&self, name: &str, body: &str) -> PathBuf {
        let path = self.bin.path().join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    pub fn log(&self, name: &str) -> String {
        std::fs::read_to_string(self.bin.path().join(name)).unwrap_or_default()
    }

    pub fn log_path(&self, name: &str) -> String {
        self.bin.path().join(name).display().to_string()
    }

    pub fn ai(&self) -> Ai {
        self.ai_with(Limits {
            completion: Duration::from_secs(20),
            status: Duration::from_secs(10),
            discovery: Duration::from_secs(5),
            sign_in: Duration::from_secs(20),
        })
    }

    pub fn ai_with(&self, limits: Limits) -> Ai {
        Ai::new(self.secrets.clone())
            .with_environment(Environment {
                shell: None,
                known_dirs: vec![self.bin.path().to_owned()],
            })
            .with_limits(limits)
    }
}

pub fn cli_input(kind: ProviderKind, name: &str) -> ProviderInput {
    ProviderInput {
        kind,
        name: name.to_owned(),
        base_url: None,
        executable_path: None,
        api_key: None,
    }
}

pub fn http_input(name: &str, base_url: &str, key: Option<&str>) -> ProviderInput {
    ProviderInput {
        kind: ProviderKind::OpenaiCompatible,
        name: name.to_owned(),
        base_url: Some(base_url.to_owned()),
        executable_path: None,
        api_key: key.map(str::to_owned),
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

pub fn chat_reply(content: &str) -> String {
    serde_json::json!({"choices": [{"message": {"role": "assistant", "content": content}}]})
        .to_string()
}

pub async fn assert_stopped(pid: &str) {
    let pid = pid.trim();
    assert!(!pid.is_empty(), "the fake CLI never started");
    for _ in 0..50 {
        let listing = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", pid])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&listing.stdout).trim().to_owned();
        if state.is_empty() || state.starts_with('Z') {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("process {pid} is still running");
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
    yforge_core::ai_choose(h.dir(), Some(&added.config.id), Some("model-x")).unwrap();
    let selection = ai.resolve(h.dir()).await.unwrap();
    (fake, selection)
}
