use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow};
use yforge_ai::{Ai, Endpoints, Limits, MemoryStore};
use yforge_platform::PlatformService;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

struct Repo {
    _scratch: tempfile::TempDir,
    path: PathBuf,
}

impl Repo {
    fn path(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    fn write(&self, name: &str, contents: &str) {
        std::fs::write(self.path.join(name), contents).unwrap();
    }

    fn git(&self, args: &[&str]) -> String {
        git(&self.path, args)
    }

    fn commit(&self, name: &str, contents: &str, message: &str) {
        self.write(name, contents);
        self.git(&["add", "--", name]);
        self.git(&["commit", "-q", "-m", message]);
    }
}

fn repository() -> Repo {
    let scratch = tempfile::tempdir().unwrap();
    let path = scratch.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    let repo = Repo {
        _scratch: scratch,
        path,
    };
    repo.commit("a.txt", "1\n", "First commit");
    repo
}

struct Fake {
    url: String,
    root: String,
    bodies: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    port: u16,
}

impl Fake {
    fn start(reply: impl Fn() -> (u16, String, Duration) + Send + Sync + 'static) -> Self {
        Self::routed(move |_| reply())
    }

    fn routed(reply: impl Fn(&str) -> (u16, String, Duration) + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let reply = Arc::new(reply);
        let (seen, halt) = (bodies.clone(), stop.clone());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if halt.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(mut stream) = stream else { continue };
                let (seen, reply) = (seen.clone(), reply.clone());
                std::thread::spawn(move || {
                    let Some((path, body)) = read_body(&mut stream) else {
                        return;
                    };
                    seen.lock().unwrap().push(body);
                    let (status, payload, delay) = reply(&path);
                    std::thread::sleep(delay);
                    let _ = stream.write_all(
                        format!(
                            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                            payload.len()
                        )
                        .as_bytes(),
                    );
                });
            }
        });
        Self {
            url: format!("http://127.0.0.1:{port}/v1"),
            root: format!("http://127.0.0.1:{port}"),
            bodies,
            stop,
            port,
        }
    }

    fn replying(content: &str) -> Self {
        let payload = json!({"choices": [{"message": {"role": "assistant", "content": content}}]})
            .to_string();
        Self::start(move || (200, payload.clone(), Duration::ZERO))
    }

    fn bodies(&self) -> Vec<String> {
        self.bodies.lock().unwrap().clone()
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn read_body(stream: &mut TcpStream) -> Option<(String, String)> {
    let mut data = Vec::new();
    let mut chunk = [0_u8; 4096];
    let end = loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..read]);
        if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            break at + 4;
        }
    };
    let head = String::from_utf8_lossy(&data[..end]).to_lowercase();
    let path = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or_default()
        .to_owned();
    let length: usize = head
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(0);
    while data.len() < end + length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
    }
    Some((path, String::from_utf8_lossy(&data[end..]).into_owned()))
}

struct Harness {
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    data: tempfile::TempDir,
    secrets: Arc<MemoryStore>,
    claude_code: Arc<MemoryStore>,
}

fn harness() -> Harness {
    harness_at(Endpoints::default())
}

fn harness_at(endpoints: Endpoints) -> Harness {
    let secrets = Arc::new(MemoryStore::default());
    let claude_code = Arc::new(MemoryStore::default());
    let ai = Ai::new(secrets.clone())
        .with_claude_code_store(claude_code.clone())
        .with_limits(Limits {
            poll_margin: Duration::ZERO,
            ..Limits::default()
        })
        .with_endpoints(endpoints);
    let app = yforge_lib::register_with(mock_builder(), ai, PlatformService::new(secrets.clone()))
        .build(mock_context(noop_assets()))
        .expect("build app");
    let data = tempfile::tempdir().expect("tempdir");
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    Harness {
        app,
        window,
        data,
        secrets,
        claude_code,
    }
}

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().expect("url"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| response.deserialize::<Value>().expect("json response"))
}

fn add_endpoint(h: &Harness, url: &str, key: Option<&str>) -> String {
    let added = invoke(
        &h.window,
        "ai_provider_add",
        json!({"input": {"kind": "openai_compatible", "name": "Endpoint", "base_url": url, "api_key": key}}),
    )
    .unwrap();
    let id = added["config"]["id"].as_str().unwrap().to_owned();
    invoke(
        &h.window,
        "ai_set_active",
        json!({"id": id, "model": "model-x"}),
    )
    .unwrap();
    id
}

fn entries(h: &Harness) -> Vec<Value> {
    invoke(&h.window, "activity_list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

fn opt_in(h: &Harness) {
    let mut settings = invoke(&h.window, "settings_load", json!({})).unwrap();
    settings["telemetry_opt_in"] = json!(true);
    invoke(&h.window, "settings_save", json!({"settings": settings})).unwrap();
}

const DRAFT: &str = r#"{"summary":"Describe the change","description":"Why it matters."}"#;

#[test]
fn providers_are_managed_over_ipc_with_the_key_only_in_the_secret_store() {
    let h = harness();
    let key = "sk-ipc-secret-0001";

    let id = add_endpoint(&h, "http://127.0.0.1:9/v1", Some(key));

    let listed = invoke(&h.window, "ai_providers_list", json!({})).unwrap();
    assert_eq!(listed[0]["config"]["id"], id);
    assert_eq!(listed[0]["config"]["kind"], "openai_compatible");
    assert_eq!(listed[0]["config"]["auth_mode"], "api_key");
    assert_eq!(listed[0]["config"]["model"], "model-x");
    assert_eq!(listed[0]["config"]["has_api_key"], true);
    assert_eq!(listed[0]["active"], true);
    assert_eq!(listed[0]["status"], json!({"kind": "ready"}));
    assert!(!listed.to_string().contains(key));
    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&id));

    let updated = invoke(
        &h.window,
        "ai_provider_update",
        json!({"update": {"id": id, "auth_mode": "api_key", "name": "Renamed", "base_url": "http://127.0.0.1:9/v1", "api_key": {"kind": "clear"}}}),
    )
    .unwrap();
    assert_eq!(updated["config"]["name"], "Renamed");
    assert_eq!(updated["config"]["has_api_key"], false);
    assert!(h.secrets.accounts().is_empty());

    invoke(&h.window, "ai_provider_remove", json!({"id": id})).unwrap();
    assert_eq!(
        invoke(&h.window, "ai_providers_list", json!({})).unwrap(),
        json!([])
    );
    let bad = invoke(&h.window, "ai_provider_remove", json!({"id": id})).unwrap_err();
    assert_eq!(bad["kind"], "invalid_request");
}

#[test]
fn models_and_the_connection_test_go_through_the_chosen_endpoint() {
    let h = harness();
    let fake = Fake::start(|| {
        (
            200,
            json!({"data": [{"id": "b"}, {"id": "a", "name": "Model A"}]}).to_string(),
            Duration::ZERO,
        )
    });
    let id = add_endpoint(&h, &fake.url, None);

    let models = invoke(&h.window, "ai_models", json!({"providerId": id})).unwrap();
    let status = invoke(&h.window, "ai_provider_test", json!({"id": id})).unwrap();

    assert_eq!(
        models,
        json!([
            {"id": "a", "display_name": "Model A", "context_window": null},
            {"id": "b", "display_name": "b", "context_window": null}
        ])
    );
    assert_eq!(status, json!({"kind": "ready"}));
}

#[test]
fn a_commit_draft_is_returned_recorded_without_content_and_changes_nothing() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "1\nUNIQUE-STAGED-LINE\n");
    repo.git(&["add", "a.txt"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    let fake = Fake::replying(DRAFT);
    add_endpoint(&h, &fake.url, Some("k-secret"));
    opt_in(&h);

    let draft = invoke(
        &h.window,
        "ai_generate_commit_message",
        json!({"path": repo.path(), "id": "ai-1"}),
    )
    .unwrap();

    assert_eq!(draft["summary"], "Describe the change");
    assert_eq!(draft["description"], "Why it matters.");
    assert_eq!(draft["summary_trimmed"], false);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["status", "--porcelain"]), "M  a.txt");
    assert!(fake.bodies()[0].contains("UNIQUE-STAGED-LINE"));
    let entry = entries(&h).pop().unwrap();
    assert_eq!(entry["operation"], "AI commit message");
    assert_eq!(entry["ok"], true);
    assert_eq!(entry["local"], false);
    assert_eq!(entry["commands"], json!([]));
    assert_eq!(entry["summary"], "Endpoint · model-x");
    assert_eq!(entry["undo"]["kind"], "unavailable");
    let recorded = entry.to_string();
    for content in [
        "UNIQUE-STAGED-LINE",
        "Describe the change",
        "Why it matters",
        "k-secret",
    ] {
        assert!(!recorded.contains(content), "activity leaked {content}");
    }
    let usage = invoke(
        &h.window,
        "usage_list",
        json!({"before": null, "limit": 10}),
    )
    .unwrap();
    assert_eq!(usage[0]["event"], "ai_commit_message");
    assert_eq!(usage[0]["ok"], true);
    assert_eq!(usage[0]["provider"], "openai_compatible");
    assert_eq!(usage[0]["model"], "model-x");
    assert_eq!(usage[0]["count"], 0);
    let stored = usage.to_string();
    for content in ["UNIQUE-STAGED-LINE", "Describe the change", "k-secret"] {
        assert!(!stored.contains(content), "usage leaked {content}");
    }
}

#[test]
fn ai_failures_are_tagged_and_recorded_by_kind_only() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "2\n");
    repo.git(&["add", "a.txt"]);
    let call = |id: &str| {
        invoke(
            &h.window,
            "ai_generate_commit_message",
            json!({"path": repo.path(), "id": id}),
        )
        .unwrap_err()
    };

    assert_eq!(call("n-1")["kind"], "ai_not_configured");
    assert!(
        entries(&h).is_empty(),
        "nothing was sent, so nothing is recorded"
    );

    let rejecting = Fake::start(|| {
        (
            401,
            json!({"error": {"message": "bad key SECRET-BODY"}}).to_string(),
            Duration::ZERO,
        )
    });
    let id = add_endpoint(&h, &rejecting.url, Some("test-key-abcdef"));
    let auth = call("n-2");
    assert_eq!(auth["kind"], "ai_auth_required");
    assert!(auth["output"].as_str().unwrap().contains("bad key"));

    let chatty = Fake::replying("Sure, here you go");
    invoke(
        &h.window,
        "ai_provider_update",
        json!({"update": {"id": id, "auth_mode": "api_key", "name": "Endpoint", "base_url": chatty.url, "api_key": {"kind": "keep"}}}),
    )
    .unwrap();
    assert_eq!(call("n-3")["kind"], "ai_invalid_response");

    let recorded = entries(&h);
    let errors: Vec<&str> = recorded
        .iter()
        .map(|e| e["error"].as_str().unwrap())
        .collect();
    assert_eq!(errors, ["ai_auth_required", "ai_invalid_response"]);
    assert!(recorded.iter().all(|e| e["ok"] == false));
    assert!(!Value::Array(recorded).to_string().contains("SECRET-BODY"));
}

#[test]
fn nothing_staged_is_refused_before_anything_is_sent() {
    let h = harness();
    let repo = repository();
    let fake = Fake::replying(DRAFT);
    add_endpoint(&h, &fake.url, None);

    let error = invoke(
        &h.window,
        "ai_generate_commit_message",
        json!({"path": repo.path(), "id": "ai-1"}),
    )
    .unwrap_err();

    assert_eq!(error["kind"], "invalid_request");
    assert!(fake.bodies().is_empty());
}

#[test]
fn operation_cancel_abandons_a_running_ai_call() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "2\n");
    repo.git(&["add", "a.txt"]);
    let fake = Fake::start(|| (200, "{}".to_owned(), Duration::from_secs(6)));
    add_endpoint(&h, &fake.url, None);
    let canceller = h.window.clone();
    let handle = std::thread::spawn(move || {
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(100));
            if invoke(&canceller, "operation_cancel", json!({"id": "ai-slow"})) == Ok(json!(true)) {
                return;
            }
        }
        panic!("the operation never registered");
    });
    let started = Instant::now();

    let error = invoke(
        &h.window,
        "ai_generate_commit_message",
        json!({"path": repo.path(), "id": "ai-slow"}),
    )
    .unwrap_err();

    handle.join().unwrap();
    assert_eq!(error["kind"], "cancelled");
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(entries(&h).pop().unwrap()["error"], "cancelled");
    assert_eq!(
        invoke(&h.window, "operation_cancel", json!({"id": "ai-slow"})).unwrap(),
        json!(false)
    );
}

#[test]
fn a_recompose_proposal_over_ipc_feeds_recompose_apply() {
    let h = harness();
    let repo = repository();
    repo.commit("b.txt", "b\n", "Add b");
    repo.commit("c.txt", "c\n", "Add c");
    let base = repo.git(&["rev-parse", "HEAD~2"]);
    let reply = json!({"groups": [
        {"message": "Add c", "changes": [{"kind": "file", "path": "c.txt"}]},
        {"message": "Add b", "changes": [{"kind": "file", "path": "b.txt"}]}
    ]})
    .to_string();
    let fake = Fake::replying(&reply);
    add_endpoint(&h, &fake.url, None);
    let head = repo.git(&["rev-parse", "HEAD"]);

    let proposal = invoke(
        &h.window,
        "ai_propose_recompose",
        json!({"path": repo.path(), "id": "ai-2", "base": base}),
    )
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(proposal["excluded"], json!([]));
    assert_eq!(proposal["groups"][0]["message"], "Add c");
    assert_eq!(
        entries(&h).pop().unwrap()["operation"],
        "AI recompose proposal"
    );
    invoke(
        &h.window,
        "recompose_apply",
        json!({"path": repo.path(), "base": base, "groups": proposal["groups"]}),
    )
    .unwrap();
    assert_eq!(repo.git(&["log", "--format=%s", "-2"]), "Add b\nAdd c");

    let bad = Fake::replying(r#"{"groups":[]}"#);
    let id = invoke(&h.window, "ai_providers_list", json!({})).unwrap()[0]["config"]["id"].clone();
    invoke(
        &h.window,
        "ai_provider_update",
        json!({"update": {"id": id, "auth_mode": "api_key", "name": "Endpoint", "base_url": bad.url, "api_key": {"kind": "keep"}}}),
    )
    .unwrap();
    let rejected = invoke(
        &h.window,
        "ai_propose_recompose",
        json!({"path": repo.path(), "id": "ai-3", "base": base}),
    )
    .unwrap_err();
    assert_eq!(rejected["kind"], "ai_invalid_response");
}

#[test]
fn a_conflict_proposal_over_ipc_answers_each_region_and_leaves_the_file_alone() {
    let h = harness();
    let repo = repository();
    let filler = "m1\nm2\nm3\nm4\nm5\nm6\nm7\n";
    repo.commit("c.txt", &format!("top\nshared\n{filler}end\n"), "Base c");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit(
        "c.txt",
        &format!("top\nTOPIC\n{filler}end TOPIC\n"),
        "Topic",
    );
    repo.git(&["switch", "-q", "main"]);
    repo.commit("c.txt", &format!("top\nMAIN\n{filler}end MAIN\n"), "Main");
    let merged = Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .output()
        .unwrap();
    assert!(!merged.status.success());
    let before = std::fs::read_to_string(repo.path.join("c.txt")).unwrap();
    let reply = json!({"regions": [
        {"index": 0, "text": "MAIN+TOPIC", "rationale": "both"},
        {"index": 1, "text": "end BOTH", "rationale": "merged"}
    ]})
    .to_string();
    let fake = Fake::replying(&reply);
    add_endpoint(&h, &fake.url, None);

    let proposal = invoke(
        &h.window,
        "ai_propose_conflict",
        json!({"path": repo.path(), "id": "ai-4", "file": "c.txt"}),
    )
    .unwrap();

    assert_eq!(
        proposal,
        json!({"regions": [
            {"index": 0, "text": "MAIN+TOPIC", "rationale": "both"},
            {"index": 1, "text": "end BOTH", "rationale": "merged"}
        ]})
    );
    assert_eq!(
        std::fs::read_to_string(repo.path.join("c.txt")).unwrap(),
        before
    );
    assert_eq!(
        entries(&h).pop().unwrap()["operation"],
        "AI conflict proposal"
    );
}

fn add_subscription(h: &Harness, kind: &str) -> String {
    let added = invoke(
        &h.window,
        "ai_provider_add",
        json!({"input": {"kind": kind, "auth_mode": "subscription", "name": "Subscription"}}),
    )
    .unwrap();
    assert_eq!(added["config"]["auth_mode"], "subscription");
    assert_eq!(added["status"], json!({"kind": "signed_out"}));
    added["config"]["id"].as_str().unwrap().to_owned()
}

#[test]
fn a_headless_chatgpt_sign_in_emits_the_code_then_completion_and_can_be_cancelled() {
    let approved = Arc::new(AtomicBool::new(false));
    let gate = approved.clone();
    let fake = Fake::routed(move |path| match path {
        "/api/accounts/deviceauth/usercode" => (
            200,
            json!({"device_auth_id": "dev-1", "user_code": "WXYZ-12345", "interval": "0"})
                .to_string(),
            Duration::ZERO,
        ),
        "/api/accounts/deviceauth/token" if gate.load(Ordering::SeqCst) => (
            200,
            json!({"authorization_code": "auth-1", "code_verifier": "ver-1"}).to_string(),
            Duration::ZERO,
        ),
        "/api/accounts/deviceauth/token" => (403, "pending".to_owned(), Duration::ZERO),
        "/oauth/token" => (
            200,
            json!({"access_token": "acc", "refresh_token": "ref", "expires_in": 3600}).to_string(),
            Duration::ZERO,
        ),
        other => panic!("unexpected {other}"),
    });
    let h = harness_at(Endpoints {
        openai_auth: fake.root.clone(),
        ..Endpoints::default()
    });
    let provider = add_subscription(&h, "chatgpt");
    let (sender, events) = mpsc::channel();
    h.app.listen("ai-sign-in", move |event| {
        let _ = sender.send(serde_json::from_str::<Value>(event.payload()).unwrap());
    });
    let worker = h.window.clone();
    let target = provider.clone();
    let handle = std::thread::spawn(move || {
        invoke(
            &worker,
            "ai_sign_in",
            json!({"provider": target, "id": "signin-1", "method": "device_code"}),
        )
    });

    let code = events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(code["operation"], "signin-1");
    assert_eq!(code["provider"], provider);
    assert_eq!(
        code["stage"],
        json!({"kind": "device_code", "url": format!("{}/codex/device", fake.root), "code": "WXYZ-12345"})
    );
    approved.store(true, Ordering::SeqCst);
    let status = handle.join().unwrap().unwrap();
    let done = events.recv_timeout(Duration::from_secs(10)).unwrap();

    assert_eq!(status, json!({"kind": "ready"}));
    assert_eq!(
        done["stage"],
        json!({"kind": "completed", "status": {"kind": "ready"}})
    );
    assert_eq!(h.secrets.accounts(), [format!("{provider}:oauth")]);
    let listed = invoke(&h.window, "ai_providers_list", json!({})).unwrap();
    assert_eq!(listed[0]["status"], json!({"kind": "ready"}));

    approved.store(false, Ordering::SeqCst);
    let worker = h.window.clone();
    let target = provider.clone();
    let handle = std::thread::spawn(move || {
        invoke(
            &worker,
            "ai_sign_in",
            json!({"provider": target, "id": "signin-2", "method": "device_code"}),
        )
    });
    let _code = events.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(
        invoke(&h.window, "operation_cancel", json!({"id": "signin-2"})).unwrap(),
        json!(true)
    );
    let error = handle.join().unwrap().unwrap_err();
    assert_eq!(error["kind"], "cancelled");
}

#[test]
fn claude_code_sign_in_needs_its_credentials_and_reads_them_without_writing() {
    let h = harness();
    let provider = add_subscription(&h, "claude");
    let sign_in = |operation: &str| {
        invoke(
            &h.window,
            "ai_sign_in",
            json!({"provider": provider, "id": operation, "method": "browser"}),
        )
    };

    let missing = sign_in("cc-1").unwrap_err();
    assert_eq!(missing["kind"], "ai_auth_required");
    assert_eq!(missing["output"], "Sign in to Claude Code first");

    let blob = json!({"claudeAiOauth": {
        "accessToken": "cc-access", "refreshToken": "cc-refresh", "expiresAt": 4_102_444_800_000_i64
    }})
    .to_string();
    yforge_ai::SecretStore::set(&*h.claude_code, yforge_ai::CLAUDE_CODE_SERVICE, &blob).unwrap();
    let ready = sign_in("cc-2").unwrap();

    assert_eq!(ready, json!({"kind": "ready"}));
    assert_eq!(
        yforge_ai::SecretStore::get(&*h.claude_code, yforge_ai::CLAUDE_CODE_SERVICE)
            .unwrap()
            .as_deref(),
        Some(blob.as_str())
    );
    assert!(h.secrets.accounts().is_empty());
}

fn models_fake() -> Fake {
    Fake::routed(|path| {
        if path.ends_with("/models") {
            (
                200,
                json!({"data": [{"id": "listed-model", "name": "Listed"}]}).to_string(),
                Duration::ZERO,
            )
        } else {
            (
                200,
                json!({"choices": [{"message": {"role": "assistant", "content": DRAFT}}]})
                    .to_string(),
                Duration::ZERO,
            )
        }
    })
}

#[test]
fn feature_configs_are_listed_set_validated_and_reset_over_ipc() {
    let h = harness();
    let fake = models_fake();
    let id = add_endpoint(&h, &fake.url, None);

    let listed = invoke(&h.window, "ai_feature_config_list", json!({})).unwrap();
    assert_eq!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["feature"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["generate_commit", "recompose", "conflict_fix"]
    );
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["config"].is_null()
            && s["default_prompt_template"]
                .as_str()
                .unwrap()
                .contains("{context}")));

    let refused = invoke(
        &h.window,
        "ai_feature_config_set",
        json!({"feature": "recompose", "providerId": id, "modelId": "invented", "promptTemplate": "x {context}"}),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "invalid_request");
    let no_placeholder = invoke(
        &h.window,
        "ai_feature_config_set",
        json!({"feature": "recompose", "providerId": id, "modelId": "listed-model", "promptTemplate": "x"}),
    )
    .unwrap_err();
    assert_eq!(no_placeholder["kind"], "invalid_request");

    let saved = invoke(
        &h.window,
        "ai_feature_config_set",
        json!({"feature": "recompose", "providerId": id, "modelId": "listed-model", "promptTemplate": "Regroup.\n{context}"}),
    )
    .unwrap();
    assert_eq!(
        saved["config"],
        json!({"feature": "recompose", "provider_id": id, "model_id": "listed-model", "prompt_template": "Regroup.\n{context}"})
    );
    let listed = invoke(&h.window, "ai_feature_config_list", json!({})).unwrap();
    assert_eq!(listed[1]["config"]["model_id"], "listed-model");
    assert!(listed[0]["config"].is_null());

    let reset = invoke(
        &h.window,
        "ai_feature_config_reset",
        json!({"feature": "recompose"}),
    )
    .unwrap();
    assert!(reset["config"].is_null());
    let listed = invoke(&h.window, "ai_feature_config_list", json!({})).unwrap();
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["config"].is_null()));
}

#[test]
fn a_commit_draft_runs_on_the_provider_model_and_prompt_saved_for_that_feature() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "1\nUNIQUE-STAGED-LINE\n");
    repo.git(&["add", "a.txt"]);
    let unused = Fake::replying("{}");
    add_endpoint(&h, &unused.url, None);
    let chosen = models_fake();
    let chosen_id = invoke(
        &h.window,
        "ai_provider_add",
        json!({"input": {"kind": "openai_compatible", "name": "Chosen", "base_url": chosen.url}}),
    )
    .unwrap()["config"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    invoke(
        &h.window,
        "ai_feature_config_set",
        json!({"feature": "generate_commit", "providerId": chosen_id, "modelId": "listed-model", "promptTemplate": "Custom rules.\n{context}"}),
    )
    .unwrap();

    let draft = invoke(
        &h.window,
        "ai_generate_commit_message",
        json!({"path": repo.path(), "id": "ai-feature"}),
    )
    .unwrap();

    assert_eq!(draft["summary"], "Describe the change");
    let sent: Vec<String> = chosen
        .bodies()
        .into_iter()
        .filter(|body| body.contains("chat") || body.contains("messages"))
        .collect();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].contains("listed-model") && sent[0].contains("Custom rules."));
    assert!(sent[0].contains("UNIQUE-STAGED-LINE"));
    assert!(unused.bodies().is_empty());
}

#[test]
fn the_database_never_holds_the_api_key() {
    let h = harness();
    let key = "sk-never-in-sqlite-777";
    add_endpoint(&h, "http://127.0.0.1:9/v1", Some(key));

    let dir = h.data.path();
    for entry in std::fs::read_dir(dir).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap_or_default();
        assert!(!bytes.windows(key.len()).any(|w| w == key.as_bytes()));
    }
}
