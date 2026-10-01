use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
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

fn server_site(fake: &Fake) -> String {
    format!("http://{}/jira", fake.host)
}

fn server() -> Fake {
    Fake::start(|_, path| {
        if path.starts_with("/jira/rest/api/2/myself") {
            (200, r#"{"displayName":"you"}"#.to_owned())
        } else if path.starts_with("/jira/rest/api/2/project") {
            (200, r#"[{"key":"OPS","name":"Operations"}]"#.to_owned())
        } else if path.starts_with("/jira/rest/api/2/search") {
            (
                200,
                json!({"issues": [{"key": "OPS-9", "fields": {
                    "summary": "Proxy settings for new laptops",
                    "status": {"name": "To Do", "statusCategory": {"key": "new"}},
                    "issuetype": {"name": "Task"}, "project": {"key": "OPS"},
                    "assignee": {"displayName": "you"},
                    "updated": "2026-10-01T09:30:00.000+0000"}}]})
                .to_string(),
            )
        } else {
            (404, "{}".to_owned())
        }
    })
}

fn add(h: &Harness, fake: &Fake) -> Result<Value, Value> {
    invoke(
        &h.window,
        "jira_connection_add",
        json!({"kind": "data_center", "site": server_site(fake), "email": null,
               "token": "pat-ipc-secret"}),
    )
}

#[test]
fn jira_connections_are_managed_over_ipc_with_the_token_only_in_the_secret_store() {
    let h = harness();
    let fake = server();

    let added = add(&h, &fake).unwrap();

    assert_eq!(added["kind"], "data_center");
    assert_eq!(added["host"], fake.host.as_str());
    assert_eq!(added["display_name"], "you");
    assert_eq!(
        added["projects"],
        json!([{"key": "OPS", "name": "Operations"}])
    );
    assert_eq!(added["email"], Value::Null);
    let id = added["id"].as_str().unwrap().to_owned();
    let listed = invoke(&h.window, "jira_connections_list", json!({})).unwrap();
    assert_eq!(listed, json!([added]));
    assert!(!listed.to_string().contains("pat-ipc-secret"));
    assert_eq!(h.secrets.accounts(), [format!("jira.{id}")]);
    assert_eq!(
        invoke(&h.window, "jira_connection_test", json!({"id": id})).unwrap(),
        "you"
    );
    let authorizations: Vec<String> = fake.requests().into_iter().map(|r| r.2).collect();
    assert!(authorizations
        .iter()
        .all(|value| value == "Bearer pat-ipc-secret"));
    assert!(fake.requests().iter().all(|request| request.0 == "GET"));

    let removed = invoke(&h.window, "jira_connection_remove", json!({"id": id})).unwrap();

    assert_eq!(removed, Value::Null);
    assert_eq!(
        invoke(&h.window, "jira_connections_list", json!({})).unwrap(),
        json!([])
    );
    assert!(h.secrets.accounts().is_empty());
    let again = invoke(&h.window, "jira_connection_remove", json!({"id": id})).unwrap_err();
    assert_eq!(again["kind"], "invalid_request");
}

#[test]
fn a_rejected_jira_token_is_auth_failed_and_stores_nothing() {
    let h = harness();
    let fake = Fake::start(|_, _| (401, r#"{"errorMessages":["expired"]}"#.to_owned()));

    let error = add(&h, &fake).unwrap_err();

    assert_eq!(error["kind"], "auth_failed");
    assert_eq!(
        invoke(&h.window, "jira_connections_list", json!({})).unwrap(),
        json!([])
    );
    assert!(h.secrets.accounts().is_empty());
}

#[test]
fn field_problems_branch_names_and_issue_keys_come_from_the_core() {
    let h = harness();
    let fake = server();
    add(&h, &fake).unwrap();

    let site = invoke(
        &h.window,
        "jira_field_problem",
        json!({"field": "site", "value": "http://jira.example.com"}),
    )
    .unwrap();
    let fine = invoke(
        &h.window,
        "jira_field_problem",
        json!({"field": "email", "value": "you@example.com"}),
    )
    .unwrap();
    let name = invoke(
        &h.window,
        "jira_branch_name",
        json!({"key": "OPS-9", "summary": "Proxy settings for new laptops, with a very long tail"}),
    )
    .unwrap();
    let keys = invoke(
        &h.window,
        "jira_issue_keys",
        json!({"texts": ["fix OPS-9 and ABC-1", "nothing", "OPS-9 OPS-9"]}),
    )
    .unwrap();

    assert!(site.as_str().unwrap().contains("https://"));
    assert_eq!(fine, Value::Null);
    assert_eq!(name, "OPS-9-proxy-settings-for-new-laptops-with-a-very");
    assert_eq!(keys, json!([["OPS-9"], [], ["OPS-9"]]));
}

#[test]
fn my_issues_and_lookups_read_from_the_connected_site() {
    let h = harness();
    let fake = server();
    let id = add(&h, &fake).unwrap()["id"].as_str().unwrap().to_owned();

    let mine = invoke(&h.window, "jira_my_issues", json!({"id": id})).unwrap();
    let lookup = invoke(
        &h.window,
        "jira_issues_lookup",
        json!({"keys": ["OPS-9", "NONE-1"]}),
    )
    .unwrap();

    assert_eq!(mine["issues"][0]["key"], "OPS-9");
    assert_eq!(mine["issues"][0]["status"], "To Do");
    assert_eq!(mine["issues"][0]["status_category"], "todo");
    assert_eq!(mine["issues"][0]["assignee"], "you");
    assert_eq!(
        (&mine["total"], &mine["capped"]),
        (&json!(1), &json!(false))
    );
    assert_eq!(
        lookup[0]["issue"]["summary"],
        "Proxy settings for new laptops"
    );
    assert_eq!(
        lookup[1],
        json!({"key": "NONE-1", "issue": null, "failure": null})
    );
    let error = invoke(&h.window, "jira_my_issues", json!({"id": "nope"})).unwrap_err();
    assert_eq!(error["kind"], "invalid_request");
}

#[test]
fn wips_list_recent_repositories_with_unfinished_work() {
    let h = harness();
    let scratch = tempfile::tempdir().unwrap();
    let dirty = scratch.path().canonicalize().unwrap().join("dirty");
    let clean = scratch.path().canonicalize().unwrap().join("clean");
    for path in [&dirty, &clean] {
        std::fs::create_dir(path).unwrap();
        git(path, &["init", "-q", "-b", "main"]);
    }
    std::fs::write(dirty.join("a.txt"), "x").unwrap();
    for path in [&dirty, &clean] {
        invoke(
            &h.window,
            "recent_add",
            json!({"path": path.to_string_lossy()}),
        )
        .unwrap();
    }

    let wips = invoke(&h.window, "launchpad_wips", json!({})).unwrap();

    assert_eq!(wips.as_array().unwrap().len(), 1);
    assert_eq!(wips[0]["name"], "dirty");
    assert_eq!(wips[0]["changes"], 1);
    assert_eq!(wips[0]["unpushed"], 0);
}

#[test]
fn my_pulls_are_read_per_connection_and_matched_to_recent_repositories() {
    let h = harness();
    let fake = Fake::start(|_, path| {
        if path.ends_with("/user") {
            (200, r#"{"username":"yui"}"#.to_owned())
        } else if path.contains("scope=created_by_me") {
            (
                200,
                json!([{"iid": 3, "title": "Add thing", "description": "", "state": "opened",
                    "source_branch": "feature", "target_branch": "main",
                    "author": {"username": "yui"}, "created_at": "2026-09-01T10:00:00Z",
                    "updated_at": "2026-09-02T10:00:00Z", "merge_status": "can_be_merged",
                    "web_url": "https://x.example/owner/widget/-/merge_requests/3"}])
                .to_string(),
            )
        } else {
            (200, "[]".to_owned())
        }
    });
    let connection = invoke(
        &h.window,
        "platform_connection_add",
        json!({"kind": "gitlab", "host": fake.host, "name": "Work",
               "token": "tok", "insecureTls": false}),
    )
    .unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let path = scratch.path().canonicalize().unwrap().join("widget");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    git(
        &path,
        &[
            "remote",
            "add",
            "origin",
            &format!("https://{}/owner/widget.git", fake.host),
        ],
    );
    invoke(
        &h.window,
        "recent_add",
        json!({"path": path.to_string_lossy()}),
    )
    .unwrap();

    let pulls = invoke(
        &h.window,
        "platform_my_pulls",
        json!({"id": connection["id"]}),
    )
    .unwrap();

    assert_eq!(pulls["pulls"].as_array().unwrap().len(), 1);
    assert_eq!(
        (&pulls["total"], &pulls["capped"]),
        (&json!(1), &json!(false))
    );
    assert_eq!(pulls["pulls"][0]["role"], "authored");
    assert_eq!(
        pulls["pulls"][0]["repo"],
        json!({"owner": "owner", "repo": "widget"})
    );
    assert_eq!(
        pulls["pulls"][0]["local_path"],
        path.to_string_lossy().as_ref()
    );
    assert!(fake.requests().iter().all(|request| request.0 == "GET"));
}
