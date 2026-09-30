use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};

fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let git = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Yui Lin")
            .env("GIT_AUTHOR_EMAIL", "yui@example.test")
            .env("GIT_COMMITTER_NAME", "Yui Lin")
            .env("GIT_COMMITTER_EMAIL", "yui@example.test")
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?} failed");
    };
    git(&["init", "-q", "-b", "main"]);
    std::fs::write(dir.path().join("a.txt"), "1\n").expect("write");
    git(&["add", "a.txt"]);
    git(&["-c", "commit.gpgsign=false", "commit", "-q", "-m", "First"]);
    std::fs::write(dir.path().join("a.txt"), "2\n").expect("write");
    dir
}

struct Session {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

fn start(data: &Path) -> Session {
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build app");
    app.manage(yforge_lib::DataDir(data.to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    Session { _app: app, window }
}

fn call(session: &Session, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        &session.window,
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

fn set_telemetry(session: &Session, opted: bool) {
    let mut settings = call(session, "settings_load", json!({})).unwrap();
    settings["telemetry_opt_in"] = json!(opted);
    call(session, "settings_save", json!({ "settings": settings })).unwrap();
}

#[test]
fn activity_survives_a_restart_as_read_only_history_and_never_offers_undo() {
    let data = tempfile::tempdir().unwrap();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let before = start(data.path());
    call(
        &before,
        "create_branch",
        json!({ "path": path, "name": "two", "at": null, "checkout": false }),
    )
    .unwrap();
    let live = call(&before, "activity_list", json!({})).unwrap();
    let id = live[0]["id"].clone();
    assert_eq!(live[0]["undo"]["kind"], "available");
    let same_session = call(
        &before,
        "activity_history",
        json!({ "repo": path, "before": null, "limit": 10 }),
    )
    .unwrap();
    assert_eq!(same_session[0]["undo"]["kind"], "available");

    let after = start(data.path());
    let listed = call(&after, "activity_list", json!({})).unwrap();
    let history = call(
        &after,
        "activity_history",
        json!({ "repo": path, "before": null, "limit": 10 }),
    )
    .unwrap();
    let undo = call(&after, "undo_last", json!({ "path": path, "id": id })).unwrap_err();

    assert_eq!(listed, json!([]));
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["id"], id);
    assert_eq!(history[0]["operation"], "Create branch");
    assert_eq!(history[0]["repo"], json!(path));
    assert_eq!(history[0]["undo"]["kind"], "unavailable");
    assert!(history[0]["commands"]
        .as_array()
        .is_some_and(|c| !c.is_empty()));
    assert_eq!(undo["kind"], "invalid_request");
}

#[test]
fn history_pages_newest_first_and_clear_removes_persisted_entries() {
    let data = tempfile::tempdir().unwrap();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let session = start(data.path());
    call(&session, "stage_all", json!({ "path": path })).unwrap();
    call(&session, "unstage_all", json!({ "path": path })).unwrap();
    call(&session, "stage_all", json!({ "path": path })).unwrap();

    let first = call(
        &session,
        "activity_history",
        json!({ "repo": path, "before": null, "limit": 2 }),
    )
    .unwrap();
    let second = call(
        &session,
        "activity_history",
        json!({ "repo": path, "before": first[1]["id"], "limit": 2 }),
    )
    .unwrap();
    call(&session, "activity_clear", json!({ "repo": path })).unwrap();
    let cleared = call(
        &session,
        "activity_history",
        json!({ "repo": path, "before": null, "limit": 10 }),
    )
    .unwrap();

    assert_eq!(first[0]["operation"], "Stage all");
    assert_eq!(first[1]["operation"], "Unstage all");
    assert_eq!(second.as_array().unwrap().len(), 1);
    assert_eq!(cleared, json!([]));
}

#[test]
fn frontend_crash_reports_are_redacted_listed_exported_and_cleared() {
    let data = tempfile::tempdir().unwrap();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let session = start(data.path());
    call(&session, "repo_open", json!({ "path": path })).unwrap();
    let home = std::env::var("HOME").unwrap_or_default();

    call(
        &session,
        "crash_report",
        json!({ "report": {
            "kind": "unhandledrejection",
            "message": format!("clone https://yui:tok3n@example.test/r.git failed in {path}"),
            "stack": format!("at open ({home}/app/index.js:1:1)"),
            "view": format!("/repo{path}"),
        } }),
    )
    .unwrap();
    let listed = call(
        &session,
        "crash_list",
        json!({ "before": null, "limit": 10 }),
    )
    .unwrap();
    let target = data.path().join("crashes.json");
    let exported = call(&session, "crash_export", json!({ "path": target })).unwrap();
    let rejected = call(&session, "crash_export", json!({ "path": "relative.json" })).unwrap_err();
    call(&session, "crash_clear", json!({})).unwrap();

    let crash = &listed[0];
    assert_eq!(crash["origin"], "frontend");
    assert_eq!(crash["kind"], "unhandledrejection");
    assert_eq!(crash["app_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(
        crash["message"],
        "clone https://***@example.test/r.git failed in <repository>"
    );
    assert_eq!(crash["view"], "/repo<repository>");
    if !home.is_empty() {
        assert_eq!(crash["stack"], "at open (~/app/index.js:1:1)");
    }
    assert_eq!(exported, 1);
    let file: Value = serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
    assert_eq!(file[0]["message"], crash["message"]);
    assert_eq!(rejected["kind"], "invalid_request");
    assert_eq!(
        call(
            &session,
            "crash_list",
            json!({ "before": null, "limit": 10 })
        )
        .unwrap(),
        json!([])
    );
}

#[test]
fn tracked_operations_record_usage_only_after_opting_in_and_opting_out_purges() {
    let data = tempfile::tempdir().unwrap();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let session = start(data.path());
    let usage = || {
        call(
            &session,
            "usage_list",
            json!({ "before": null, "limit": 10 }),
        )
        .unwrap()
    };

    call(&session, "stage_all", json!({ "path": path })).unwrap();
    let while_off = usage();
    set_telemetry(&session, true);
    call(&session, "unstage_all", json!({ "path": path })).unwrap();
    let missing = call(
        &session,
        "stage_files",
        json!({ "path": "/no/such/repo", "files": ["a"] }),
    );
    let while_on = usage();
    let activity = call(&session, "activity_list", json!({})).unwrap();
    let target = data.path().join("usage.json");
    let exported = call(&session, "usage_export", json!({ "path": target })).unwrap();
    set_telemetry(&session, false);
    let after_opt_out = usage();

    assert_eq!(while_off, json!([]));
    assert!(missing.is_err());
    assert_eq!(while_on.as_array().unwrap().len(), 2);
    assert_eq!(while_on[0]["event"], "stage");
    assert_eq!(while_on[0]["ok"], false);
    assert!(while_on[0]["error_kind"].is_string());
    assert_eq!(while_on[1]["event"], "unstage_all");
    assert_eq!(while_on[1]["ok"], true);
    assert_eq!(while_on[1]["error_kind"], Value::Null);
    assert_eq!(while_on[1]["app_version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(while_on[1]["correlation_id"], activity[1]["id"]);
    let mut keys: Vec<&str> = while_on[1]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "app_version",
            "correlation_id",
            "count",
            "duration_ms",
            "error_kind",
            "event",
            "id",
            "occurred_at",
            "ok"
        ]
    );
    assert_eq!(exported, 2);
    assert_eq!(after_opt_out, json!([]));
}

#[test]
fn usage_can_be_deleted_without_turning_telemetry_off() {
    let data = tempfile::tempdir().unwrap();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let session = start(data.path());
    set_telemetry(&session, true);
    call(&session, "stage_all", json!({ "path": path })).unwrap();

    call(&session, "usage_clear", json!({})).unwrap();
    call(&session, "unstage_all", json!({ "path": path })).unwrap();

    let usage = call(
        &session,
        "usage_list",
        json!({ "before": null, "limit": 10 }),
    )
    .unwrap();
    assert_eq!(usage.as_array().unwrap().len(), 1);
    assert_eq!(usage[0]["event"], "unstage_all");
}
