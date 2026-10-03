use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow};

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

    fn git(&self, args: &[&str]) -> String {
        git(&self.path, args)
    }
}

fn repository() -> Repo {
    let scratch = tempfile::tempdir().expect("tempdir");
    let path = scratch.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    git(&path, &["config", "user.name", "Yui Lin"]);
    git(&path, &["config", "user.email", "yui@example.test"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    std::fs::write(path.join("a.txt"), "1\n").unwrap();
    git(&path, &["add", "a.txt"]);
    git(&path, &["commit", "-q", "-m", "First commit"]);
    Repo {
        _scratch: scratch,
        path,
    }
}

struct Harness {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    _data: tempfile::TempDir,
    redo_events: Arc<Mutex<Vec<Value>>>,
}

fn harness() -> Harness {
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build app");
    let data = tempfile::tempdir().expect("tempdir");
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    let redo_events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&redo_events);
    app.listen("redo-changed", move |event| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(event.payload()).expect("event payload"));
    });
    Harness {
        _app: app,
        window,
        _data: data,
        redo_events,
    }
}

fn call(h: &Harness, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        &h.window,
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

fn entries(h: &Harness) -> Vec<Value> {
    call(h, "activity_list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

fn last_entry(h: &Harness) -> Value {
    entries(h).last().unwrap().clone()
}

fn create_branch(h: &Harness, repo: &Repo, name: &str, checkout: bool) {
    call(
        h,
        "create_branch",
        json!({ "path": repo.path(), "name": name, "at": null, "checkout": checkout }),
    )
    .unwrap();
}

fn undo_latest(h: &Harness, repo: &Repo) {
    let latest = entries(h)
        .into_iter()
        .rev()
        .find(|entry| entry["local"] == true && entry["undo"]["kind"] == "available")
        .expect("an undoable entry");
    call(
        h,
        "undo_last",
        json!({ "path": repo.path(), "id": latest["id"] }),
    )
    .unwrap();
}

fn redo(h: &Harness, repo: &Repo) -> Result<Value, Value> {
    call(h, "redo_last", json!({ "path": repo.path() }))
}

fn last_redo_scope(h: &Harness) -> Value {
    h.redo_events.lock().unwrap().last().unwrap()["scope"].clone()
}

fn has_branch(repo: &Repo, name: &str) -> bool {
    !repo.git(&["branch", "--list", name]).trim().is_empty()
}

#[test]
fn redo_re_applies_what_the_last_undo_reverted_and_can_itself_be_undone() {
    let h = harness();
    let repo = repository();
    create_branch(&h, &repo, "topic", true);
    let tip = repo.git(&["rev-parse", "topic"]);
    assert!(h.redo_events.lock().unwrap().is_empty());

    undo_latest(&h, &repo);

    assert!(!has_branch(&repo, "topic"));
    let scope = last_redo_scope(&h);
    assert!(scope.as_str().unwrap().starts_with("Redo"), "{scope}");

    redo(&h, &repo).unwrap();

    assert_eq!(repo.git(&["rev-parse", "topic"]), tip);
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "topic");
    assert_eq!(last_redo_scope(&h), Value::Null);
    let recorded = last_entry(&h);
    assert_eq!(recorded["operation"], "Redo");
    assert_eq!(recorded["ok"], true);
    assert_eq!(recorded["local"], true);
    assert_eq!(recorded["undo"]["kind"], "available");

    undo_latest(&h, &repo);

    assert!(!has_branch(&repo, "topic"));
    assert!(last_redo_scope(&h).is_string());
    redo(&h, &repo).unwrap();
    assert_eq!(repo.git(&["rev-parse", "topic"]), tip);
}

#[test]
fn redo_walks_back_through_several_undos_in_the_order_they_were_undone() {
    let h = harness();
    let repo = repository();
    create_branch(&h, &repo, "first", false);
    create_branch(&h, &repo, "second", false);
    undo_latest(&h, &repo);
    undo_latest(&h, &repo);
    assert!(!has_branch(&repo, "first") && !has_branch(&repo, "second"));

    redo(&h, &repo).unwrap();
    assert!(has_branch(&repo, "first") && !has_branch(&repo, "second"));
    assert!(last_redo_scope(&h).is_string());

    redo(&h, &repo).unwrap();
    assert!(has_branch(&repo, "first") && has_branch(&repo, "second"));
    assert_eq!(last_redo_scope(&h), Value::Null);
    assert!(redo(&h, &repo).is_err());
}

#[test]
fn a_new_operation_after_an_undo_ends_the_redo_and_redo_then_refuses() {
    let h = harness();
    let repo = repository();
    create_branch(&h, &repo, "topic", false);
    undo_latest(&h, &repo);
    assert!(last_redo_scope(&h).is_string());

    create_branch(&h, &repo, "other", false);

    assert_eq!(last_redo_scope(&h), Value::Null);
    let refused = redo(&h, &repo).unwrap_err();
    assert!(
        refused["message"]
            .as_str()
            .unwrap()
            .contains("nothing to redo"),
        "{refused}"
    );
    assert!(!has_branch(&repo, "topic"));
    assert!(has_branch(&repo, "other"));
}

#[test]
fn redo_is_refused_and_keeps_the_redo_when_the_repository_moved_on() {
    let h = harness();
    let repo = repository();
    create_branch(&h, &repo, "topic", false);
    undo_latest(&h, &repo);
    repo.git(&["branch", "topic"]);

    let refused = redo(&h, &repo).unwrap_err();

    assert!(
        refused["message"]
            .as_str()
            .unwrap()
            .contains("exists again"),
        "{refused}"
    );
    assert!(last_redo_scope(&h).is_string());
    repo.git(&["branch", "-D", "topic"]);
    redo(&h, &repo).unwrap();
    assert!(has_branch(&repo, "topic"));
}

#[test]
fn redo_state_of_one_repository_is_not_visible_in_another() {
    let h = harness();
    let repo = repository();
    let other = repository();
    create_branch(&h, &repo, "topic", false);
    undo_latest(&h, &repo);

    assert!(redo(&h, &other).is_err());
    assert!(!has_branch(&repo, "topic"));
}

#[test]
fn clearing_the_activity_log_ends_the_redo_and_tells_the_window() {
    let h = harness();
    let repo = repository();
    create_branch(&h, &repo, "topic", false);
    undo_latest(&h, &repo);
    assert!(last_redo_scope(&h).is_string());

    call(&h, "activity_clear", json!({ "repo": null })).unwrap();

    assert_eq!(last_redo_scope(&h), Value::Null);
    assert!(redo(&h, &repo).is_err());
}
