use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow};

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
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
}

fn fixture_repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Yui Lin"]);
    git(dir.path(), &["config", "user.email", "yui@example.test"]);
    git(dir.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.path().join("a.txt"), "1\n").expect("write");
    git(dir.path(), &["add", "a.txt"]);
    git(dir.path(), &["commit", "-q", "-m", "First commit"]);
    std::fs::write(dir.path().join("a.txt"), "2\n").expect("write");
    std::fs::write(dir.path().join("new.txt"), "n\n").expect("write");
    dir
}

struct DataGuard(#[allow(dead_code)] tempfile::TempDir);

fn app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build app");
    let data = tempfile::tempdir().expect("tempdir");
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    app.manage(DataGuard(data));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    (app, window)
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

#[test]
fn app_info_reports_the_app_and_git_versions() {
    let (_app, window) = app();

    let info = invoke(&window, "app_info", json!({})).expect("app_info succeeds");

    assert_eq!(info["app_version"], env!("CARGO_PKG_VERSION"));
    assert!(info["git_version"]
        .as_str()
        .is_some_and(|version| !version.is_empty()));
}

#[test]
fn repo_open_returns_the_serialized_snapshot_of_a_fixture_repository() {
    let (_app, window) = app();
    let repo = fixture_repository();

    let snapshot =
        invoke(&window, "repo_open", json!({ "path": repo.path() })).expect("repo_open succeeds");

    assert_eq!(snapshot["head"]["kind"], "branch");
    assert_eq!(snapshot["head"]["name"], "main");
    assert_eq!(snapshot["upstream"], Value::Null);
    assert_eq!(snapshot["operation"], Value::Null);
    assert_eq!(snapshot["branches"], json!(["main"]));
    assert_eq!(snapshot["counts"]["modified"], 1);
    assert_eq!(snapshot["counts"]["untracked"], 1);
    let files = snapshot["files"].as_array().expect("files array");
    assert!(files.iter().any(|file| file["path"] == "a.txt"
        && file["area"] == "unstaged"
        && file["status"] == "modified"));
    assert!(files.iter().any(|file| file["path"] == "new.txt"
        && file["area"] == "untracked"
        && file["status"] == "untracked"));
    assert_eq!(
        snapshot["worktrees"].as_array().expect("worktrees").len(),
        1
    );
}

#[test]
fn repo_graph_returns_a_serialized_page_with_a_changes_row_over_the_head_commit() {
    let (_app, window) = app();
    let repo = fixture_repository();

    let page = invoke(
        &window,
        "repo_graph",
        json!({ "path": repo.path(), "offset": 0, "limit": 50 }),
    )
    .expect("repo_graph succeeds");

    assert_eq!(page["total"], 2);
    let rows = page["rows"].as_array().expect("rows array");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["kind"], "changes");
    assert_eq!(rows[0]["sha"], Value::Null);
    assert_eq!(rows[0]["edges"][0]["parent_row"], 1);
    assert_eq!(rows[1]["kind"], "commit");
    assert_eq!(rows[1]["summary"], "First commit");
    assert_eq!(rows[1]["author"]["initials"], "YL");
    assert_eq!(rows[1]["refs"][0]["name"], "main");
    assert_eq!(rows[1]["refs"][0]["kind"], "local_branch");
    assert_eq!(rows[1]["refs"][0]["is_head"], true);
    assert_eq!(page["carried"], json!([]));
}

#[test]
fn repo_graph_windows_by_offset_and_limit() {
    let (_app, window) = app();
    let repo = fixture_repository();

    let page = invoke(
        &window,
        "repo_graph",
        json!({ "path": repo.path(), "offset": 1, "limit": 1 }),
    )
    .expect("repo_graph succeeds");

    assert_eq!(page["total"], 2);
    assert_eq!(page["rows"].as_array().expect("rows").len(), 1);
    assert_eq!(page["rows"][0]["kind"], "commit");
    assert_eq!(page["carried"][0]["kind"], "changes");
}

#[test]
fn errors_serialize_as_tagged_kind_and_message() {
    let (_app, window) = app();
    let not_a_repository = tempfile::tempdir().expect("tempdir");

    let error = invoke(
        &window,
        "repo_open",
        json!({ "path": not_a_repository.path() }),
    )
    .expect_err("repo_open fails outside a repository");

    assert_eq!(error["kind"], "not_a_repository");
    assert!(error["message"]
        .as_str()
        .is_some_and(|message| message.contains("is not inside a Git repository")));
}

#[test]
fn launch_path_resolves_to_a_non_empty_path() {
    let (_app, window) = app();

    let path = invoke(&window, "launch_path", json!({})).expect("launch_path succeeds");

    assert!(path.as_str().is_some_and(|path| !path.is_empty()));
}

fn status_areas(window: &WebviewWindow<MockRuntime>, repo: &Path) -> Vec<(String, String)> {
    let snapshot = invoke(window, "repo_open", json!({ "path": repo })).expect("repo_open");
    snapshot["files"]
        .as_array()
        .expect("files")
        .iter()
        .map(|file| {
            (
                file["path"].as_str().expect("path").to_owned(),
                file["area"].as_str().expect("area").to_owned(),
            )
        })
        .collect()
}

#[test]
fn diff_file_serializes_hunks_lines_and_the_binary_flag() {
    let (_app, window) = app();
    let repo = fixture_repository();

    let diff = invoke(
        &window,
        "diff_file",
        json!({ "path": repo.path(), "file": "a.txt", "area": "unstaged" }),
    )
    .expect("diff_file succeeds");

    assert_eq!(diff["path"], "a.txt");
    assert_eq!(diff["original_path"], Value::Null);
    assert_eq!(diff["binary"], false);
    let lines = diff["hunks"][0]["lines"].as_array().expect("lines");
    assert_eq!(lines[0]["kind"], "removed");
    assert_eq!(lines[0]["old_number"], 1);
    assert_eq!(lines[0]["new_number"], Value::Null);
    assert_eq!(lines[0]["text"], "1");
    assert_eq!(lines[1]["kind"], "added");
    assert_eq!(lines[1]["new_number"], 1);
    assert_eq!(lines[1]["no_newline"], false);

    let untracked = invoke(
        &window,
        "diff_file",
        json!({ "path": repo.path(), "file": "new.txt", "area": "untracked" }),
    )
    .expect("untracked diff");
    assert_eq!(untracked["hunks"][0]["old_lines"], 0);
}

#[test]
fn file_level_staging_commands_move_files_between_areas() {
    let (_app, window) = app();
    let repo = fixture_repository();
    let path = repo.path();

    let stage = invoke(
        &window,
        "stage_files",
        json!({ "path": path, "files": ["a.txt"] }),
    );
    assert_eq!(stage.expect("stage_files"), Value::Null);
    assert!(status_areas(&window, path).contains(&("a.txt".into(), "staged".into())));

    invoke(
        &window,
        "unstage_files",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .expect("unstage_files");
    assert!(status_areas(&window, path).contains(&("a.txt".into(), "unstaged".into())));

    invoke(&window, "stage_all", json!({ "path": path })).expect("stage_all");
    assert!(status_areas(&window, path)
        .iter()
        .all(|(_, area)| area == "staged"));

    invoke(&window, "unstage_all", json!({ "path": path })).expect("unstage_all");
    invoke(
        &window,
        "discard_files",
        json!({ "path": path, "files": ["a.txt", "new.txt"] }),
    )
    .expect("discard_files");
    assert_eq!(status_areas(&window, path), Vec::<(String, String)>::new());
    assert!(!path.join("new.txt").exists());
}

#[test]
fn hunk_commands_accept_the_hunk_exactly_as_diff_file_returned_it() {
    let (_app, window) = app();
    let repo = fixture_repository();
    let path = repo.path();
    let diff = invoke(
        &window,
        "diff_file",
        json!({ "path": path, "file": "a.txt", "area": "unstaged" }),
    )
    .expect("diff_file");
    let hunk = diff["hunks"][0].clone();

    invoke(
        &window,
        "stage_hunk",
        json!({ "path": path, "file": "a.txt", "hunk": hunk }),
    )
    .expect("stage_hunk");
    assert!(status_areas(&window, path).contains(&("a.txt".into(), "staged".into())));

    let stale = invoke(
        &window,
        "stage_hunk",
        json!({ "path": path, "file": "a.txt", "hunk": hunk }),
    )
    .expect_err("the hunk is no longer unstaged");
    assert_eq!(stale["kind"], "stale_hunk");
    assert_eq!(stale["output"], Value::Null);

    invoke(
        &window,
        "unstage_hunk",
        json!({ "path": path, "file": "a.txt", "hunk": hunk }),
    )
    .expect("unstage_hunk");
    invoke(
        &window,
        "discard_hunk",
        json!({ "path": path, "file": "a.txt", "hunk": hunk }),
    )
    .expect("discard_hunk");
    assert_eq!(
        std::fs::read_to_string(path.join("a.txt")).expect("read"),
        "1\n"
    );
}

#[test]
fn commit_returns_the_new_sha_and_the_inspector_commands_describe_it() {
    let (_app, window) = app();
    let repo = fixture_repository();
    let path = repo.path();
    invoke(
        &window,
        "stage_files",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .expect("stage");

    let sha = invoke(
        &window,
        "commit",
        json!({ "path": path, "summary": "Change a", "description": "Because.", "amend": false }),
    )
    .expect("commit");

    let sha = sha.as_str().expect("sha string").to_owned();
    assert_eq!(sha.len(), 40);
    let details = invoke(
        &window,
        "commit_details",
        json!({ "path": path, "sha": sha }),
    )
    .expect("commit_details");
    assert_eq!(details["summary"], "Change a");
    assert_eq!(details["body"], "Because.");
    assert_eq!(details["author"]["email"], "yui@example.test");
    assert_eq!(details["parents"].as_array().expect("parents").len(), 1);
    assert_eq!(details["refs"][0]["name"], "main");
    assert_eq!(details["files"][0]["path"], "a.txt");
    assert_eq!(details["files"][0]["status"], "modified");
    assert_eq!(details["files"][0]["additions"], 1);
    assert_eq!(details["files"][0]["deletions"], 1);

    let diff = invoke(
        &window,
        "commit_file_diff",
        json!({ "path": path, "sha": sha, "file": "a.txt" }),
    )
    .expect("commit_file_diff");
    assert_eq!(diff["hunks"][0]["lines"][1]["text"], "2");

    let info = invoke(&window, "amend_info", json!({ "path": path })).expect("amend_info");
    assert_eq!(info["sha"], details["sha"]);
    assert_eq!(info["summary"], "Change a");
    assert_eq!(info["pushed"], false);
}

#[cfg(unix)]
#[test]
fn a_failing_hook_serializes_as_commit_failed_with_its_output() {
    use std::os::unix::fs::PermissionsExt;
    let (_app, window) = app();
    let repo = fixture_repository();
    let path = repo.path();
    let hook = path.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\necho hook says no\nexit 1\n").expect("hook");
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    invoke(&window, "stage_all", json!({ "path": path })).expect("stage_all");

    let error = invoke(
        &window,
        "commit",
        json!({ "path": path, "summary": "Blocked", "description": "", "amend": false }),
    )
    .expect_err("the hook rejects the commit");

    assert_eq!(error["kind"], "commit_failed");
    assert!(error["output"]
        .as_str()
        .is_some_and(|output| output.contains("hook says no")));
}

#[test]
fn invalid_requests_serialize_with_their_kind() {
    let (_app, window) = app();
    let repo = fixture_repository();

    let error = invoke(
        &window,
        "stage_files",
        json!({ "path": repo.path(), "files": [] }),
    )
    .expect_err("no files");

    assert_eq!(error["kind"], "invalid_request");
    assert_eq!(error["output"], Value::Null);
}

#[test]
fn repo_watch_emits_repo_changed_with_the_watched_path() {
    let (app, window) = app();
    let repo = fixture_repository();
    let (sender, receiver) = std::sync::mpsc::channel();
    app.listen("repo-changed", move |event| {
        let _ = sender.send(event.payload().to_owned());
    });

    invoke(&window, "repo_watch", json!({ "path": repo.path() })).expect("repo_watch");
    std::thread::sleep(std::time::Duration::from_millis(600));
    while receiver.try_recv().is_ok() {}
    std::fs::write(repo.path().join("a.txt"), "changed\n").expect("write");

    let payload = receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("repo-changed event");
    let payload: Value = serde_json::from_str(&payload).expect("json payload");
    assert_eq!(payload["path"], json!(repo.path()));
}

fn committed_repository() -> tempfile::TempDir {
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

struct Remote {
    repo: tempfile::TempDir,
    bare: tempfile::TempDir,
}

fn repository_with_remote() -> Remote {
    let repo = committed_repository();
    let bare = tempfile::tempdir().expect("tempdir");
    git(bare.path(), &["init", "-q", "--bare", "-b", "main"]);
    git(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            bare.path().to_str().expect("utf-8"),
        ],
    );
    git(repo.path(), &["push", "-q", "-u", "origin", "main"]);
    Remote { repo, bare }
}

fn git_output(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git runs");
    assert!(output.status.success(), "git {args:?} failed");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn collect_progress(app: &App<MockRuntime>) -> std::sync::mpsc::Receiver<Value> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.listen("operation-progress", move |event| {
        let _ = sender.send(serde_json::from_str(event.payload()).expect("json payload"));
    });
    receiver
}

#[test]
fn branch_commands_create_check_out_rename_and_delete() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();

    let valid = invoke(
        &window,
        "check_branch_name",
        json!({ "path": path, "name": "feature/x" }),
    )
    .expect("valid name");
    assert_eq!(valid, "feature/x");
    let invalid = invoke(
        &window,
        "check_branch_name",
        json!({ "path": path, "name": "bad name" }),
    )
    .expect_err("invalid name");
    assert_eq!(invalid["kind"], "invalid_request");

    invoke(
        &window,
        "create_branch",
        json!({ "path": path, "name": "feature/x", "at": null, "checkout": true }),
    )
    .expect("create_branch");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["head"]["name"], "feature/x");

    invoke(
        &window,
        "checkout",
        json!({ "path": path, "target": { "kind": "local_branch", "name": "main" }, "stash": false }),
    )
    .expect("checkout");
    invoke(
        &window,
        "rename_branch",
        json!({ "path": path, "from": "feature/x", "to": "feature/y" }),
    )
    .expect("rename_branch");
    let lost = invoke(
        &window,
        "branch_delete_preview",
        json!({ "path": path, "name": "feature/y" }),
    )
    .expect("preview");
    assert_eq!(lost, json!({ "count": 0, "commits": [] }));
    invoke(
        &window,
        "delete_branch",
        json!({ "path": path, "name": "feature/y", "force": false }),
    )
    .expect("delete_branch");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["branches"], json!(["main"]));
}

#[test]
fn deleting_an_unmerged_branch_serializes_as_unmerged_branch_and_the_preview_names_the_commit() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    git(path, &["switch", "-q", "-c", "topic"]);
    std::fs::write(path.join("t.txt"), "t\n").expect("write");
    git(path, &["add", "t.txt"]);
    git(path, &["commit", "-q", "-m", "Topic work"]);
    git(path, &["switch", "-q", "main"]);

    let preview = invoke(
        &window,
        "branch_delete_preview",
        json!({ "path": path, "name": "topic" }),
    )
    .expect("preview");
    assert_eq!(preview["count"], 1);
    assert_eq!(preview["commits"][0]["summary"], "Topic work");
    let error = invoke(
        &window,
        "delete_branch",
        json!({ "path": path, "name": "topic", "force": false }),
    )
    .expect_err("unmerged");
    assert_eq!(error["kind"], "unmerged_branch");
    invoke(
        &window,
        "delete_branch",
        json!({ "path": path, "name": "topic", "force": true }),
    )
    .expect("forced");
}

#[test]
fn checkout_with_conflicting_changes_is_local_changes_until_stash_and_switch() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    git(path, &["switch", "-q", "-c", "topic"]);
    std::fs::write(path.join("a.txt"), "topic\n").expect("write");
    git(path, &["commit", "-q", "-am", "Topic edit"]);
    git(path, &["switch", "-q", "main"]);
    std::fs::write(path.join("a.txt"), "local\n").expect("write");
    let target = json!({ "kind": "local_branch", "name": "topic" });

    let error = invoke(
        &window,
        "checkout",
        json!({ "path": path, "target": target, "stash": false }),
    )
    .expect_err("blocked");
    assert_eq!(error["kind"], "local_changes");
    assert!(error["output"]
        .as_str()
        .is_some_and(|output| output.contains("a.txt")));

    let outcome = invoke(
        &window,
        "checkout",
        json!({ "path": path, "target": target, "stash": true }),
    )
    .expect("stash and switch");
    assert_eq!(outcome["auto_stash"], "conflicts");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["head"]["name"], "topic");
    assert_eq!(snapshot["stashes"].as_array().expect("stashes").len(), 1);
}

#[test]
fn stash_commands_save_apply_pop_and_drop() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    std::fs::write(path.join("a.txt"), "edited\n").expect("write");

    invoke(
        &window,
        "stash_push",
        json!({ "path": path, "message": "wip", "untracked": false }),
    )
    .expect("stash_push");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    let stash = &snapshot["stashes"][0];
    assert_eq!(stash["message"], "On main: wip");
    let (index, sha) = (stash["index"].clone(), stash["sha"].clone());

    let applied = invoke(
        &window,
        "stash_apply",
        json!({ "path": path, "index": index, "sha": sha }),
    )
    .expect("stash_apply");
    assert_eq!(applied, "applied");
    git(path, &["checkout", "--", "a.txt"]);
    let popped = invoke(
        &window,
        "stash_pop",
        json!({ "path": path, "index": index, "sha": sha }),
    )
    .expect("stash_pop");
    assert_eq!(popped, "applied");
    assert_eq!(
        std::fs::read_to_string(path.join("a.txt")).expect("read"),
        "edited\n"
    );

    git(path, &["stash", "push", "-q"]);
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    let (index, sha) = (
        snapshot["stashes"][0]["index"].clone(),
        snapshot["stashes"][0]["sha"].clone(),
    );
    invoke(
        &window,
        "stash_drop",
        json!({ "path": path, "index": index, "sha": sha }),
    )
    .expect("stash_drop");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["stashes"], json!([]));
}

#[test]
fn fetch_pull_and_push_stream_progress_events_tagged_with_the_operation_id() {
    let (app, window) = app();
    let remote = repository_with_remote();
    let path = remote.repo.path();
    let progress = collect_progress(&app);
    let other = tempfile::tempdir().expect("tempdir");
    let other_path = other.path().join("other");
    git(
        other.path(),
        &[
            "clone",
            "-q",
            remote.bare.path().to_str().expect("utf-8"),
            "other",
        ],
    );
    git(&other_path, &["config", "user.name", "Yui Lin"]);
    git(&other_path, &["config", "user.email", "yui@example.test"]);
    std::fs::write(other_path.join("r.txt"), "r\n").expect("write");
    git(&other_path, &["add", "r.txt"]);
    git(&other_path, &["commit", "-q", "-m", "Remote work"]);
    git(&other_path, &["push", "-q"]);

    invoke(
        &window,
        "fetch",
        json!({ "path": path, "id": "fetch-1", "prune": false }),
    )
    .expect("fetch");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["upstream"]["ahead_behind"]["behind"], 1);
    assert!(snapshot["last_fetch"].is_i64());
    let first = progress
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("progress event");
    assert_eq!(first["id"], "fetch-1");
    assert_eq!(first["phase"], "Fetching origin");
    assert_eq!(first["percent"], Value::Null);

    let outcome = invoke(
        &window,
        "pull",
        json!({ "path": path, "id": "pull-1", "mode": "fast_forward_only" }),
    )
    .expect("pull");
    assert_eq!(outcome, "updated");

    std::fs::write(path.join("local.txt"), "l\n").expect("write");
    git(path, &["add", "local.txt"]);
    git(path, &["commit", "-q", "-m", "Local work"]);
    invoke(&window, "push", json!({ "path": path, "id": "push-1" })).expect("push");
    assert_eq!(
        git_output(remote.bare.path(), &["log", "-1", "--format=%s", "main"]),
        "Local work"
    );
    let ids: Vec<Value> = std::iter::from_fn(|| progress.try_recv().ok())
        .map(|event| event["id"].clone())
        .collect();
    assert!(ids
        .iter()
        .all(|id| ["fetch-1", "pull-1", "push-1"].contains(&id.as_str().expect("id string"))));
}

#[test]
fn force_push_uses_the_plan_lease_and_a_rejected_push_serializes_its_kind() {
    let (_app, window) = app();
    let remote = repository_with_remote();
    let path = remote.repo.path();
    std::fs::write(path.join("b.txt"), "first\n").expect("write");
    git(path, &["add", "b.txt"]);
    git(path, &["commit", "-q", "-m", "Original work"]);
    invoke(&window, "push", json!({ "path": path, "id": "push-1" })).expect("push");
    git(path, &["commit", "-q", "--amend", "-m", "Rewritten work"]);

    let rejected =
        invoke(&window, "push", json!({ "path": path, "id": "push-2" })).expect_err("rejected");
    assert_eq!(rejected["kind"], "push_rejected");
    let plan = invoke(&window, "push_plan", json!({ "path": path })).expect("push_plan");
    assert_eq!(plan["replaced"]["count"], 1);
    assert_eq!(plan["replaced"]["commits"][0]["summary"], "Original work");
    assert_eq!(plan["upstream"], "origin/main");

    invoke(
        &window,
        "push_force",
        json!({ "path": path, "id": "push-3", "lease": plan["lease"] }),
    )
    .expect("push_force");
    assert_eq!(
        git_output(remote.bare.path(), &["log", "-1", "--format=%s", "main"]),
        "Rewritten work"
    );
}

#[cfg(unix)]
#[test]
fn operation_cancel_stops_a_running_fetch_and_reports_cancelled() {
    use std::os::unix::fs::PermissionsExt;
    let (_app, window) = app();
    let remote = repository_with_remote();
    let path = remote.repo.path();
    let script = path.join("slow.sh");
    std::fs::write(&script, "#!/bin/sh\nsleep 5\nexec git-upload-pack \"$@\"\n").expect("script");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    git(
        path,
        &[
            "config",
            "remote.origin.uploadpack",
            script.to_str().expect("utf-8"),
        ],
    );
    let canceller = window.clone();
    let handle = std::thread::spawn(move || {
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if invoke(&canceller, "operation_cancel", json!({ "id": "slow-1" })) == Ok(json!(true))
            {
                return;
            }
        }
        panic!("the operation never registered");
    });
    let started = std::time::Instant::now();

    let error = invoke(
        &window,
        "fetch",
        json!({ "path": path, "id": "slow-1", "prune": false }),
    )
    .expect_err("cancelled");

    handle.join().expect("canceller");
    assert_eq!(error["kind"], "cancelled");
    assert!(started.elapsed() < std::time::Duration::from_secs(4));
    assert_eq!(
        invoke(&window, "operation_cancel", json!({ "id": "slow-1" })).expect("cancel"),
        json!(false)
    );
}

#[test]
fn operation_commands_resolve_continue_and_abort_a_merge() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    git(path, &["switch", "-q", "-c", "topic"]);
    std::fs::write(path.join("a.txt"), "topic\n").expect("write");
    git(path, &["commit", "-q", "-am", "Topic edit"]);
    git(path, &["switch", "-q", "main"]);
    std::fs::write(path.join("a.txt"), "main\n").expect("write");
    git(path, &["commit", "-q", "-am", "Main edit"]);
    let merge = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status()
        .expect("git runs");
    assert!(!merge.success());

    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["operation"], "merge");
    assert_eq!(snapshot["operation_detail"]["incoming"], "topic");
    let early = invoke(
        &window,
        "operation_continue",
        json!({ "path": path, "message": null }),
    )
    .expect_err("conflicted");
    assert_eq!(early["kind"], "invalid_request");
    let marked = invoke(
        &window,
        "mark_resolved",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .expect_err("markers");
    assert_eq!(marked["kind"], "conflict_markers");
    let skipped =
        invoke(&window, "operation_skip", json!({ "path": path })).expect_err("not a rebase");
    assert_eq!(skipped["kind"], "invalid_request");

    std::fs::write(path.join("a.txt"), "resolved\n").expect("write");
    invoke(
        &window,
        "mark_resolved",
        json!({ "path": path, "files": ["a.txt"] }),
    )
    .expect("mark_resolved");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["operation_detail"]["resolved"], json!(["a.txt"]));
    let outcome = invoke(
        &window,
        "operation_continue",
        json!({ "path": path, "message": "Merge topic" }),
    )
    .expect("continue");
    assert_eq!(outcome, "completed");
    assert_eq!(
        git_output(path, &["log", "-1", "--format=%s"]),
        "Merge topic"
    );

    git(path, &["reset", "-q", "--hard", "HEAD~1"]);
    let _ = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status();
    invoke(&window, "operation_abort", json!({ "path": path })).expect("abort");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["operation"], Value::Null);
}

#[test]
fn create_branch_starts_at_the_given_older_commit_and_leaves_head_alone() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    let older = git_output(path, &["rev-parse", "HEAD"]);
    std::fs::write(path.join("b.txt"), "b\n").expect("write");
    git(path, &["add", "b.txt"]);
    git(path, &["commit", "-q", "-m", "Second commit"]);

    invoke(
        &window,
        "create_branch",
        json!({ "path": path, "name": "from-older", "at": older, "checkout": false }),
    )
    .expect("create_branch");

    assert_eq!(git_output(path, &["rev-parse", "from-older"]), older);
    let listing = git_output(path, &["branch", "-v"]);
    assert!(
        listing.contains("from-older") && listing.contains("First commit"),
        "{listing}"
    );
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["head"]["name"], "main");
}

fn diverged_repository() -> tempfile::TempDir {
    let repo = committed_repository();
    let path = repo.path();
    git(path, &["switch", "-q", "-c", "topic"]);
    std::fs::write(path.join("a.txt"), "topic\n").expect("write");
    git(path, &["commit", "-q", "-am", "Topic edit"]);
    git(path, &["switch", "-q", "main"]);
    std::fs::write(path.join("a.txt"), "main\n").expect("write");
    git(path, &["commit", "-q", "-am", "Main edit"]);
    repo
}

#[test]
fn integration_commands_preview_merge_rebase_pick_revert_and_fast_forward() {
    let (_app, window) = app();
    let repo = diverged_repository();
    let path = repo.path();

    let preview = invoke(
        &window,
        "integration_preview",
        json!({ "path": path, "base": null, "other": "topic" }),
    )
    .expect("preview");
    assert_eq!(preview["incoming"]["count"], 1);
    assert_eq!(preview["incoming"]["commits"][0]["summary"], "Topic edit");
    assert_eq!(preview["outgoing"]["count"], 1);
    assert_eq!(preview["fast_forward"], false);

    let refused = invoke(
        &window,
        "fast_forward",
        json!({ "path": path, "branch": "main", "target": "topic" }),
    )
    .expect_err("diverged");
    assert_eq!(refused["kind"], "not_fast_forward");

    let merged = invoke(
        &window,
        "merge",
        json!({ "path": path, "source": "topic", "mode": "merge_commit" }),
    )
    .expect("merge");
    assert_eq!(merged, "conflicts");
    let snapshot = invoke(&window, "repo_open", json!({ "path": path })).expect("repo_open");
    assert_eq!(snapshot["operation"], "merge");
    assert_eq!(snapshot["operation_detail"]["current"], "main");
    let blocked = invoke(&window, "rebase", json!({ "path": path, "onto": "topic" }))
        .expect_err("operation in progress");
    assert_eq!(blocked["kind"], "invalid_request");
    invoke(&window, "operation_abort", json!({ "path": path })).expect("abort");

    git(path, &["switch", "-q", "topic"]);
    let rebased =
        invoke(&window, "rebase", json!({ "path": path, "onto": "main" })).expect("rebase");
    assert_eq!(rebased, "conflicts");
    invoke(&window, "operation_abort", json!({ "path": path })).expect("abort");

    git(path, &["switch", "-q", "main"]);
    std::fs::write(path.join("b.txt"), "b\n").expect("write");
    git(path, &["add", "b.txt"]);
    git(path, &["commit", "-q", "-m", "Add b"]);
    let added = git_output(path, &["rev-parse", "HEAD"]);
    git(path, &["reset", "-q", "--hard", "HEAD~1"]);
    let picked = invoke(
        &window,
        "cherry_pick",
        json!({ "path": path, "sha": added }),
    )
    .expect("pick");
    assert_eq!(picked, "completed");
    assert_eq!(git_output(path, &["log", "-1", "--format=%s"]), "Add b");
    let head = git_output(path, &["rev-parse", "HEAD"]);
    let reverted = invoke(&window, "revert", json!({ "path": path, "sha": head })).expect("revert");
    assert_eq!(reverted, "completed");
    assert!(!path.join("b.txt").exists());
}

#[test]
fn reset_accepts_each_mode_and_rejects_unknown_ones() {
    let (_app, window) = app();
    let repo = committed_repository();
    let path = repo.path();
    let first = git_output(path, &["rev-parse", "HEAD"]);
    std::fs::write(path.join("a.txt"), "2\n").expect("write");
    git(path, &["commit", "-q", "-am", "Second"]);

    invoke(
        &window,
        "reset",
        json!({ "path": path, "target": first, "mode": "soft" }),
    )
    .expect("soft");
    assert_eq!(git_output(path, &["status", "--porcelain"]), "M  a.txt");
    invoke(
        &window,
        "reset",
        json!({ "path": path, "target": first, "mode": "mixed" }),
    )
    .expect("mixed");
    assert_eq!(git_output(path, &["status", "--porcelain"]), "M a.txt");
    invoke(
        &window,
        "reset",
        json!({ "path": path, "target": first, "mode": "hard" }),
    )
    .expect("hard");
    assert_eq!(git_output(path, &["status", "--porcelain"]), "");
    assert_eq!(
        std::fs::read_to_string(path.join("a.txt")).expect("read"),
        "1\n"
    );
    assert!(invoke(
        &window,
        "reset",
        json!({ "path": path, "target": first, "mode": "medium" })
    )
    .is_err());
}

#[test]
fn tag_commands_create_push_and_delete_locally_and_on_the_remote() {
    let (app, window) = app();
    let remote = repository_with_remote();
    let path = remote.repo.path();
    let progress = collect_progress(&app);

    invoke(
        &window,
        "create_tag",
        json!({ "path": path, "name": "v1", "at": null, "message": "Release one" }),
    )
    .expect("create_tag");
    assert_eq!(git_output(path, &["cat-file", "-t", "v1"]), "tag");
    let duplicate = invoke(
        &window,
        "create_tag",
        json!({ "path": path, "name": "v1", "at": null, "message": null }),
    )
    .expect_err("duplicate");
    assert_eq!(duplicate["kind"], "invalid_request");

    invoke(
        &window,
        "push_tag",
        json!({ "path": path, "id": "tag-1", "remote": "origin", "name": "v1" }),
    )
    .expect("push_tag");
    assert_eq!(git_output(remote.bare.path(), &["tag", "--list"]), "v1");
    let event = progress
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("progress event");
    assert_eq!(event["id"], "tag-1");

    invoke(
        &window,
        "delete_remote_tag",
        json!({ "path": path, "id": "tag-2", "remote": "origin", "name": "v1" }),
    )
    .expect("delete_remote_tag");
    assert_eq!(git_output(remote.bare.path(), &["tag", "--list"]), "");
    invoke(&window, "delete_tag", json!({ "path": path, "name": "v1" })).expect("delete_tag");
    assert_eq!(git_output(path, &["tag", "--list"]), "");
}

#[test]
fn conflict_commands_read_regions_resolve_take_a_side_and_reset() {
    let (_app, window) = app();
    let repo = diverged_repository();
    let path = repo.path();
    let _ = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status();

    let file = invoke(
        &window,
        "conflict_file",
        json!({ "path": path, "file": "a.txt" }),
    )
    .expect("conflict_file");
    assert_eq!(file["segments"][0]["kind"], "conflict");
    assert_eq!(file["segments"][0]["current"], json!(["main"]));
    assert_eq!(file["segments"][0]["incoming"], json!(["topic"]));
    assert_eq!(
        file["sides"],
        json!({ "base": true, "current": true, "incoming": true })
    );

    std::fs::write(path.join("a.txt"), "half\n").expect("write");
    invoke(
        &window,
        "conflict_reset",
        json!({ "path": path, "file": "a.txt" }),
    )
    .expect("reset");
    assert!(std::fs::read_to_string(path.join("a.txt"))
        .expect("read")
        .contains("<<<<<<<"));

    let markers = invoke(
        &window,
        "conflict_resolve",
        json!({ "path": path, "file": "a.txt", "content": "<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n" }),
    )
    .expect_err("markers");
    assert_eq!(markers["kind"], "conflict_markers");
    invoke(
        &window,
        "conflict_resolve",
        json!({ "path": path, "file": "a.txt", "content": "main\ntopic\n" }),
    )
    .expect("resolve");
    assert_eq!(git_output(path, &["show", ":a.txt"]), "main\ntopic");

    invoke(&window, "operation_abort", json!({ "path": path })).expect("abort");
    let _ = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["merge", "topic"])
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .status();
    invoke(
        &window,
        "conflict_take_side",
        json!({ "path": path, "file": "a.txt", "side": "incoming" }),
    )
    .expect("take side");
    assert_eq!(
        std::fs::read_to_string(path.join("a.txt")).expect("read"),
        "topic\n"
    );
}
