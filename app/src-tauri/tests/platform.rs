use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};
use yforge_ai::{Ai, MemoryStore};
use yforge_platform::PlatformService;

struct Fake {
    host: String,
    requests: Arc<Mutex<Vec<(String, String, String)>>>,
    stop: Arc<AtomicBool>,
    port: u16,
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
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
    let head = String::from_utf8_lossy(&data[..end]).into_owned();
    let mut start = head.lines().next()?.split_whitespace();
    let method = start.next()?.to_owned();
    let path = start.next()?.to_owned();
    let authorization = head
        .lines()
        .find_map(|line| line.strip_prefix("authorization: "))
        .unwrap_or_default()
        .to_owned();
    Some((method, path, authorization))
}

impl Fake {
    fn start(route: impl Fn(&str, &str) -> (u16, String) + Send + Sync + 'static) -> Self {
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
                    let (status, payload) = route(&request.0, &request.1);
                    seen.lock().unwrap().push(request);
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
            host: format!("127.0.0.1:{port}"),
            requests,
            stop,
            port,
        }
    }

    fn requests(&self) -> Vec<(String, String, String)> {
        self.requests.lock().unwrap().clone()
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

struct Harness {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    _data: tempfile::TempDir,
    secrets: Arc<MemoryStore>,
}

fn harness() -> Harness {
    let secrets = Arc::new(MemoryStore::default());
    let app = yforge_lib::register_with(
        mock_builder(),
        Ai::new(secrets.clone()),
        PlatformService::new(secrets.clone()),
    )
    .build(mock_context(noop_assets()))
    .expect("build app");
    let data = tempfile::tempdir().expect("tempdir");
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    Harness {
        _app: app,
        window,
        _data: data,
        secrets,
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

struct Repo {
    _scratch: tempfile::TempDir,
    path: PathBuf,
}

impl Repo {
    fn path(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repository(remote: Option<&str>) -> Repo {
    let scratch = tempfile::tempdir().unwrap();
    let path = scratch.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    if let Some(url) = remote {
        git(&path, &["remote", "add", "origin", url]);
    }
    Repo {
        _scratch: scratch,
        path,
    }
}

fn add(h: &Harness, fake: &Fake) -> Result<Value, Value> {
    invoke(
        &h.window,
        "platform_connection_add",
        json!({"kind": "gitlab", "host": fake.host, "name": "Work",
               "token": "tok-ipc-secret", "insecureTls": false}),
    )
}

fn merge_request(state: &str) -> Value {
    json!({
        "iid": 3, "title": "Add thing", "description": "Because.", "state": state,
        "source_branch": "feature", "target_branch": "main",
        "author": {"username": "yui"}, "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-02T10:00:00Z", "merge_status": "can_merge",
        "web_url": "https://gitlab.example/acme/widget/-/merge_requests/3"
    })
}

fn serving() -> Fake {
    Fake::start(|method, path| {
        if path.ends_with("/user") {
            (200, r#"{"username":"yui"}"#.to_owned())
        } else if method == "PUT" {
            (200, merge_request("merged").to_string())
        } else if method == "POST" {
            (201, merge_request("opened").to_string())
        } else if path.contains("?state=") {
            (200, json!([merge_request("opened")]).to_string())
        } else {
            (200, merge_request("opened").to_string())
        }
    })
}

#[test]
fn connections_are_managed_over_ipc_with_the_token_only_in_the_secret_store() {
    let h = harness();
    let fake = serving();

    let added = add(&h, &fake).unwrap();

    assert_eq!(added["kind"], "gitlab");
    assert_eq!(added["host"], fake.host.as_str());
    assert_eq!(added["name"], "Work");
    assert_eq!(added["insecure_tls"], false);
    let id = added["id"].as_str().unwrap().to_owned();
    let listed = invoke(&h.window, "platform_connections_list", json!({})).unwrap();
    assert_eq!(listed, json!([added]));
    assert!(!listed.to_string().contains("tok-ipc-secret"));
    assert_eq!(h.secrets.accounts(), [format!("platform.{id}")]);
    assert_eq!(
        invoke(&h.window, "platform_connection_test", json!({"id": id})).unwrap(),
        "yui"
    );

    let removed = invoke(&h.window, "platform_connection_remove", json!({"id": id})).unwrap();

    assert_eq!(removed, Value::Null);
    assert_eq!(
        invoke(&h.window, "platform_connections_list", json!({})).unwrap(),
        json!([])
    );
    assert!(h.secrets.accounts().is_empty());
    let again = invoke(&h.window, "platform_connection_remove", json!({"id": id})).unwrap_err();
    assert_eq!(again["kind"], "invalid_request");
}

#[test]
fn adding_with_a_rejected_token_is_auth_failed_and_stores_nothing() {
    let h = harness();
    let fake = Fake::start(|_, _| (401, r#"{"message":"401 Unauthorized"}"#.to_owned()));

    let error = add(&h, &fake).unwrap_err();

    assert_eq!(error["kind"], "auth_failed");
    assert_eq!(
        error["message"],
        format!("Authentication failed for {}", fake.host)
    );
    assert_eq!(
        invoke(&h.window, "platform_connections_list", json!({})).unwrap(),
        json!([])
    );
    assert!(h.secrets.accounts().is_empty());
}

#[test]
fn a_repository_is_matched_through_its_remote_and_lists_its_pull_requests() {
    let h = harness();
    let fake = serving();
    let added = add(&h, &fake).unwrap();
    let repo = repository(Some(&format!("http://{}/acme/widget.git", fake.host)));

    let matched = invoke(
        &h.window,
        "platform_repo_match",
        json!({"path": repo.path()}),
    )
    .unwrap();
    let pulls = invoke(
        &h.window,
        "platform_prs_list",
        json!({"path": repo.path(), "state": "open"}),
    )
    .unwrap();

    assert_eq!(matched["connection"], added);
    assert_eq!(matched["remote"], "origin");
    assert_eq!(matched["repo"], json!({"owner": "acme", "repo": "widget"}));
    assert_eq!(pulls[0]["number"], 3);
    assert_eq!(pulls[0]["state"], "open");
    assert_eq!(pulls[0]["source_ref"], "feature");
    assert_eq!(pulls[0]["mergeable"], true);
    let (method, path, authorization) = fake.requests().pop().unwrap();
    assert_eq!(method, "GET");
    assert_eq!(
        path,
        "/api/v4/projects/acme%2Fwidget/merge_requests?state=opened&per_page=100"
    );
    assert_eq!(authorization, "Bearer tok-ipc-secret");
}

#[test]
fn a_repository_without_a_matching_connection_has_no_match_and_cannot_list() {
    let h = harness();
    let fake = serving();
    add(&h, &fake).unwrap();
    let repo = repository(Some("https://example.org/acme/widget.git"));

    let matched = invoke(
        &h.window,
        "platform_repo_match",
        json!({"path": repo.path()}),
    )
    .unwrap();
    let error = invoke(
        &h.window,
        "platform_prs_list",
        json!({"path": repo.path(), "state": "all"}),
    )
    .unwrap_err();

    assert_eq!(matched, Value::Null);
    assert_eq!(error["kind"], "invalid_request");
}

#[test]
fn listing_maps_a_rejected_token_and_a_missing_repository_to_their_error_kinds() {
    let h = harness();
    let rejecting = Arc::new(AtomicBool::new(false));
    let switch = rejecting.clone();
    let fake = Fake::start(move |_, path| {
        if path.ends_with("/user") {
            (200, r#"{"username":"yui"}"#.to_owned())
        } else if switch.load(Ordering::SeqCst) {
            (401, r#"{"message":"401 Unauthorized"}"#.to_owned())
        } else {
            (404, r#"{"message":"404 Project Not Found"}"#.to_owned())
        }
    });
    add(&h, &fake).unwrap();
    let repo = repository(Some(&format!("http://{}/acme/widget.git", fake.host)));
    let list = || {
        invoke(
            &h.window,
            "platform_prs_list",
            json!({"path": repo.path(), "state": "open"}),
        )
        .unwrap_err()
    };

    let missing = list();
    rejecting.store(true, Ordering::SeqCst);
    let rejected = list();

    assert_eq!(missing["kind"], "not_found");
    assert_eq!(
        missing["message"],
        "No GitLab repository found for acme/widget"
    );
    assert_eq!(rejected["kind"], "auth_failed");
    assert_eq!(
        rejected["message"],
        format!("Authentication failed for {}", fake.host)
    );
}

#[test]
fn detail_create_and_merge_go_through_the_matched_connection() {
    let h = harness();
    let fake = serving();
    add(&h, &fake).unwrap();
    let repo = repository(Some(&format!("http://{}/acme/widget.git", fake.host)));

    let detail = invoke(
        &h.window,
        "platform_pr_detail",
        json!({"path": repo.path(), "number": 3}),
    )
    .unwrap();
    let created = invoke(
        &h.window,
        "platform_pr_create",
        json!({"path": repo.path(), "input": {"source_ref": "feature", "target_ref": "main",
               "title": "Add thing", "body": "Because."}}),
    )
    .unwrap();
    let merged = invoke(
        &h.window,
        "platform_pr_merge",
        json!({"path": repo.path(), "number": 3}),
    )
    .unwrap();

    assert_eq!(detail["pull"]["number"], 3);
    assert_eq!(detail["files"], json!([]));
    assert_eq!(created["state"], "open");
    assert_eq!(merged["state"], "merged");
}
