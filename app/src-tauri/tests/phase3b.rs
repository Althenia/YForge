use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

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
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "protocol.file.allow")
        .env("GIT_CONFIG_VALUE_0", "always")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Yui Lin"]);
    git(dir.path(), &["config", "user.email", "yui@example.test"]);
    git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("a.txt"), "1\n").expect("write");
    git(dir.path(), &["add", "a.txt"]);
    git(dir.path(), &["commit", "-q", "-m", "First commit"]);
    dir
}

struct Harness {
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    data: tempfile::TempDir,
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
    Harness { app, window, data }
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

fn entries(harness: &Harness) -> Vec<Value> {
    invoke(&harness.window, "activity_list", json!({}))
        .expect("activity_list")
        .as_array()
        .expect("array")
        .clone()
}

#[test]
fn settings_default_persist_and_reject_invalid_values_with_a_tagged_error() {
    let h = harness();

    let defaults = invoke(&h.window, "settings_load", json!({})).unwrap();
    let saved = invoke(
        &h.window,
        "settings_save",
        json!({ "settings": { "theme": "light", "density": "compact", "default_branch": "trunk",
            "pull_mode": "rebase", "auto_fetch_minutes": 10, "editor_command": "code", "terminal_command": "" } }),
    )
    .unwrap();
    let rejected = invoke(
        &h.window,
        "settings_save",
        json!({ "settings": { "theme": "dark", "density": "default", "default_branch": "main",
            "pull_mode": "rebase", "auto_fetch_minutes": 7, "editor_command": "", "terminal_command": "" } }),
    )
    .unwrap_err();

    assert_eq!(defaults["theme"], "system");
    assert_eq!(defaults["default_branch"], "main");
    assert_eq!(saved["theme"], "light");
    assert_eq!(saved["default_branch"], "trunk");
    assert_eq!(
        invoke(&h.window, "settings_load", json!({})).unwrap()["auto_fetch_minutes"],
        10
    );
    assert_eq!(rejected["kind"], "invalid_request");
    assert!(h.data.path().join("yforge.db").is_file());
}

#[test]
fn recents_sessions_and_repository_overrides_persist_in_the_data_directory() {
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();

    invoke(&h.window, "recent_add", json!({ "path": path })).unwrap();
    invoke(&h.window, "recent_add", json!({ "path": "/gone" })).unwrap();
    let recents = invoke(&h.window, "recents_list", json!({})).unwrap();
    let statuses = invoke(
        &h.window,
        "recent_statuses",
        json!({ "paths": [path, "/gone"] }),
    )
    .unwrap();
    invoke(&h.window, "recent_remove", json!({ "path": "/gone" })).unwrap();
    invoke(
        &h.window,
        "session_save",
        json!({ "session": { "tabs": [path], "active": 0 } }),
    )
    .unwrap();
    invoke(
        &h.window,
        "repo_settings_save",
        json!({ "path": path, "settings": { "pull_mode": "rebase" } }),
    )
    .unwrap();

    assert_eq!(recents[0]["path"], "/gone");
    assert_eq!(recents[1]["path"], json!(path));
    assert_eq!(statuses[0]["exists"], true);
    assert_eq!(statuses[0]["branch"], "main");
    assert_eq!(statuses[1]["exists"], false);
    assert_eq!(
        invoke(&h.window, "recents_list", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        invoke(&h.window, "session_load", json!({})).unwrap()["tabs"],
        json!([path])
    );
    assert_eq!(
        invoke(&h.window, "repo_settings_load", json!({ "path": path })).unwrap()["pull_mode"],
        "rebase"
    );
}

#[test]
fn clone_streams_progress_records_activity_and_init_uses_the_default_branch() {
    let h = harness();
    let source = repository();
    let bare = tempfile::tempdir().unwrap();
    git(bare.path(), &["init", "-q", "--bare", "-b", "main", "."]);
    git(
        source.path(),
        &["remote", "add", "origin", bare.path().to_str().unwrap()],
    );
    git(source.path(), &["push", "-q", "origin", "main"]);
    let (sender, progress) = mpsc::channel();
    h.app.listen("operation-progress", move |event| {
        let _ = sender.send(serde_json::from_str::<Value>(event.payload()).unwrap());
    });
    let parent = tempfile::tempdir().unwrap();
    let destination: PathBuf = parent.path().join("cloned");

    let root = invoke(
        &h.window,
        "clone_repo",
        json!({ "id": "clone-1", "url": format!("file://{}", bare.path().display()), "destination": destination }),
    )
    .unwrap();

    assert_eq!(
        std::fs::canonicalize(root.as_str().unwrap()).unwrap(),
        std::fs::canonicalize(&destination).unwrap()
    );
    let first = progress.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(first["id"], "clone-1");
    let entry = entries(&h).pop().unwrap();
    assert_eq!(entry["operation"], "Clone");
    assert_eq!(entry["ok"], true);
    assert_eq!(entry["local"], false);
    assert!(entry["commands"][0]["command"]
        .as_str()
        .unwrap()
        .starts_with("git clone --progress"));

    invoke(
        &h.window,
        "settings_save",
        json!({ "settings": { "theme": "system", "density": "default",
        "default_branch": "trunk", "pull_mode": "fast_forward_or_merge", "auto_fetch_minutes": 0,
        "editor_command": "", "terminal_command": "" } }),
    )
    .unwrap();
    let fresh = parent.path().join("fresh");
    invoke(&h.window, "init_repo", json!({ "path": fresh })).unwrap();
    assert_eq!(git(&fresh, &["symbolic-ref", "--short", "HEAD"]), "trunk");
    let again = invoke(&h.window, "init_repo", json!({ "path": fresh })).unwrap_err();
    assert_eq!(again["kind"], "already_a_repository");
}

#[test]
fn a_failed_clone_records_a_failed_entry_without_the_url_credentials() {
    let h = harness();
    let parent = tempfile::tempdir().unwrap();

    let error = invoke(
        &h.window,
        "clone_repo",
        json!({ "id": "clone-2", "url": "https://yui:hunter2@127.0.0.1:9/r.git", "destination": parent.path().join("x") }),
    )
    .unwrap_err();

    assert!(!error.to_string().contains("hunter2"));
    let entry = entries(&h).pop().unwrap();
    assert_eq!(entry["ok"], false);
    assert!(!entry.to_string().contains("hunter2"));
}

#[test]
fn identity_and_remote_commands_read_write_and_report_sources() {
    let global = tempfile::NamedTempFile::new().unwrap();
    std::env::set_var("GIT_CONFIG_GLOBAL", global.path());
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    git(repo.path(), &["config", "--unset", "user.name"]);
    git(repo.path(), &["config", "--unset", "user.email"]);

    invoke(
        &h.window,
        "identity_write",
        json!({ "path": null, "field": "name", "value": "Global Yui" }),
    )
    .unwrap();
    invoke(
        &h.window,
        "identity_write",
        json!({ "path": path, "field": "email", "value": "repo@example.test" }),
    )
    .unwrap();
    let repo_identity = invoke(&h.window, "identity_read", json!({ "path": path })).unwrap();
    let global_identity = invoke(&h.window, "identity_read", json!({ "path": null })).unwrap();

    assert_eq!(
        repo_identity["name"],
        json!({ "value": "Global Yui", "source": "global" })
    );
    assert_eq!(
        repo_identity["email"],
        json!({ "value": "repo@example.test", "source": "repository" })
    );
    assert_eq!(global_identity["email"]["source"], "unset");
    assert!(std::fs::read_to_string(global.path())
        .unwrap()
        .contains("Global Yui"));

    invoke(
        &h.window,
        "remote_add",
        json!({ "path": path, "name": "origin", "url": "https://example.test/a.git" }),
    )
    .unwrap();
    invoke(&h.window, "remote_edit", json!({ "path": path, "name": "origin", "newName": "upstream", "url": "ssh://git@example.test/a.git" })).unwrap();
    let listed = invoke(&h.window, "remotes_list", json!({ "path": path })).unwrap();
    invoke(
        &h.window,
        "remote_remove",
        json!({ "path": path, "name": "upstream" }),
    )
    .unwrap();
    let bad = invoke(
        &h.window,
        "remote_add",
        json!({ "path": path, "name": "x", "url": "nonsense" }),
    )
    .unwrap_err();

    assert_eq!(listed[0]["name"], "upstream");
    assert_eq!(listed[0]["fetch_url"], "ssh://git@example.test/a.git");
    assert_eq!(
        invoke(&h.window, "remotes_list", json!({ "path": path })).unwrap(),
        json!([])
    );
    assert_eq!(bad["kind"], "invalid_request");
}

#[test]
fn search_commits_returns_row_indexes_and_the_searched_total() {
    let h = harness();
    let repo = repository();
    std::fs::write(repo.path().join("b.txt"), "b\n").unwrap();
    git(repo.path(), &["add", "b.txt"]);
    git(repo.path(), &["commit", "-q", "-m", "Fix parser"]);

    let found = invoke(
        &h.window,
        "search_commits",
        json!({ "path": repo.path(), "query": "PARSER" }),
    )
    .unwrap();

    assert_eq!(found, json!({ "total": 2, "rows": [1] }));
}

#[test]
fn a_commit_is_recorded_with_its_command_line_and_can_be_undone_once() {
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let first = git(repo.path(), &["rev-parse", "HEAD"]);
    let hook = repo.path().join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho hook says hello >&2\n").unwrap();
    std::fs::set_permissions(&hook, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let (sender, recorded) = mpsc::channel();
    h.app.listen("activity-recorded", move |event| {
        let _ = sender.send(serde_json::from_str::<Value>(event.payload()).unwrap());
    });
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    invoke(
        &h.window,
        "stage_files",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .unwrap();

    invoke(
        &h.window,
        "commit",
        json!({ "path": path, "summary": "Second", "description": "", "amend": false }),
    )
    .unwrap();

    let staged = recorded.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(staged["operation"], "Stage");
    assert_eq!(staged["local"], false);
    let event = recorded.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(event["operation"], "Commit");
    assert_eq!(event["toast"], true);
    assert_eq!(event["undo"]["kind"], "available");
    assert!(event["undo"]["scope"]
        .as_str()
        .unwrap()
        .contains("keeps its changes staged"));
    let commands = event["commands"].as_array().unwrap();
    assert!(commands.iter().any(|record| record["command"]
        .as_str()
        .unwrap()
        .starts_with("git commit")
        && record["status"] == 0
        && record["output"]
            .as_str()
            .unwrap()
            .contains("hook says hello")));
    assert_eq!(commands.len(), 1);
    let id = event["id"].clone();

    let message = invoke(&h.window, "undo_last", json!({ "path": path, "id": id })).unwrap();

    assert!(message.as_str().unwrap().contains("main"));
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), first);
    let listed = entries(&h);
    assert_eq!(
        listed.iter().find(|entry| entry["id"] == id).unwrap()["undo"]["kind"],
        "undone"
    );
    assert_eq!(listed.last().unwrap()["operation"], "Undo");
    let again = invoke(&h.window, "undo_last", json!({ "path": path, "id": id })).unwrap_err();
    assert_eq!(again["kind"], "invalid_request");
}

#[test]
fn a_force_push_is_undoable_and_undo_puts_the_previous_remote_commit_back() {
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    let remote = tempfile::tempdir().expect("tempdir");
    git(remote.path(), &["init", "-q", "--bare", "-b", "main"]);
    git(
        repo.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    git(repo.path(), &["push", "-q", "-u", "origin", "main"]);
    std::fs::write(repo.path().join("b.txt"), "1\n").unwrap();
    git(repo.path(), &["add", "b.txt"]);
    git(repo.path(), &["commit", "-q", "-m", "Original work"]);
    git(repo.path(), &["push", "-q"]);
    let original = git(repo.path(), &["rev-parse", "HEAD"]);
    git(
        repo.path(),
        &["commit", "-q", "--amend", "-m", "Rewritten work"],
    );
    let rewritten = git(repo.path(), &["rev-parse", "HEAD"]);
    let plan = invoke(&h.window, "push_plan", json!({ "path": path })).unwrap();

    invoke(
        &h.window,
        "push_force",
        json!({ "path": path, "id": "op-1", "lease": plan["lease"] }),
    )
    .unwrap();

    assert_eq!(
        git(remote.path(), &["rev-parse", "refs/heads/main"]),
        rewritten
    );
    let entry = entries(&h).last().unwrap().clone();
    assert_eq!(entry["operation"], "Force push");
    assert_eq!(entry["local"], true);
    assert_eq!(entry["undo"]["kind"], "available");
    assert!(entry["undo"]["scope"]
        .as_str()
        .unwrap()
        .contains("origin/main"));

    let message = invoke(
        &h.window,
        "undo_last",
        json!({ "path": path, "id": entry["id"] }),
    )
    .unwrap();

    assert!(message.as_str().unwrap().contains("refs/heads/main"));
    assert_eq!(
        git(remote.path(), &["rev-parse", "refs/heads/main"]),
        original
    );
    assert_eq!(git(repo.path(), &["rev-parse", "HEAD"]), rewritten);
    let listed = entries(&h);
    assert_eq!(
        listed
            .iter()
            .find(|item| item["id"] == entry["id"])
            .unwrap()["undo"]["kind"],
        "undone"
    );
    assert_eq!(listed.last().unwrap()["operation"], "Undo");
}

#[test]
fn only_the_last_local_operation_can_be_undone_and_unsafe_ones_say_why() {
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    invoke(
        &h.window,
        "create_branch",
        json!({ "path": path, "name": "one", "at": null, "checkout": false }),
    )
    .unwrap();
    invoke(
        &h.window,
        "create_branch",
        json!({ "path": path, "name": "two", "at": null, "checkout": false }),
    )
    .unwrap();
    invoke(
        &h.window,
        "create_tag",
        json!({ "path": path, "name": "v1", "at": null, "message": null }),
    )
    .unwrap();
    let listed = entries(&h);
    let by = |operation: &str| {
        listed
            .iter()
            .find(|entry| entry["operation"] == operation)
            .unwrap()
            .clone()
    };

    let stale = invoke(
        &h.window,
        "undo_last",
        json!({ "path": path, "id": listed[0]["id"] }),
    )
    .unwrap_err();
    let tag = invoke(
        &h.window,
        "undo_last",
        json!({ "path": path, "id": by("Create tag")["id"] }),
    )
    .unwrap_err();

    assert_eq!(stale["kind"], "invalid_request");
    assert!(stale["message"]
        .as_str()
        .unwrap()
        .contains("last local operation"));
    assert_eq!(tag["kind"], "invalid_request");
    assert_eq!(by("Create tag")["undo"]["kind"], "unavailable");
    assert!(by("Create tag")["undo"]["reason"]
        .as_str()
        .unwrap()
        .contains("no safe undo"));
    assert_eq!(by("Create branch")["undo"]["kind"], "available");
}

#[test]
fn discard_is_undoable_and_delete_branch_recreates_the_branch() {
    let h = harness();
    let repo = repository();
    let path = repo.path().to_string_lossy().into_owned();
    std::fs::write(repo.path().join("a.txt"), "edited\n").unwrap();
    invoke(
        &h.window,
        "discard_files",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .unwrap();
    let discard = entries(&h).pop().unwrap();
    assert_eq!(discard["undo"]["kind"], "available");

    invoke(
        &h.window,
        "undo_last",
        json!({ "path": path, "id": discard["id"] }),
    )
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "edited\n"
    );

    git(repo.path(), &["checkout", "--", "a.txt"]);
    git(repo.path(), &["branch", "topic"]);
    let topic = git(repo.path(), &["rev-parse", "topic"]);
    invoke(
        &h.window,
        "delete_branch",
        json!({ "path": path, "name": "topic", "force": false }),
    )
    .unwrap();
    let deleted = entries(&h).pop().unwrap();
    invoke(
        &h.window,
        "undo_last",
        json!({ "path": path, "id": deleted["id"] }),
    )
    .unwrap();
    assert_eq!(git(repo.path(), &["rev-parse", "topic"]), topic);
}

#[test]
fn activity_clear_can_target_one_repository_and_auth_respond_reports_unknown_prompts() {
    let h = harness();
    let one = repository();
    let two = repository();
    for repo in [&one, &two] {
        invoke(&h.window, "stage_all", json!({ "path": repo.path() })).unwrap();
    }

    invoke(&h.window, "activity_clear", json!({ "repo": one.path() })).unwrap();
    let remaining = entries(&h);
    let unknown = invoke(
        &h.window,
        "auth_respond",
        json!({ "id": "op/none", "reply": { "kind": "cancel" } }),
    )
    .unwrap();
    invoke(&h.window, "activity_clear", json!({ "repo": null })).unwrap();

    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0]["repo"], json!(two.path()));
    assert_eq!(unknown, json!(false));
    assert!(entries(&h).is_empty());
}
