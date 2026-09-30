#![allow(dead_code)]
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};

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

struct Repo {
    _scratch: tempfile::TempDir,
    path: PathBuf,
}

impl Repo {
    fn path(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    fn sibling(&self, name: &str) -> PathBuf {
        self.path.parent().unwrap().join(name)
    }

    fn write(&self, name: &str, contents: &str) {
        std::fs::write(self.path.join(name), contents).unwrap();
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.path.join(name)).unwrap()
    }

    fn commit(&self, name: &str, contents: &str, message: &str) {
        self.write(name, contents);
        git(&self.path, &["add", "--", name]);
        git(&self.path, &["commit", "-q", "-m", message]);
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
    let repo = Repo {
        _scratch: scratch,
        path,
    };
    repo.commit("a.txt", "1\n", "First commit");
    repo
}

struct Harness {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    _data: tempfile::TempDir,
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
    Harness {
        _app: app,
        window,
        _data: data,
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

fn last_entry(h: &Harness) -> Value {
    call(h, "activity_list", json!({}))
        .unwrap()
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone()
}

fn undo_last(h: &Harness, repo: &Repo) -> Value {
    let entry = last_entry(h);
    assert_eq!(entry["undo"]["kind"], "available", "{entry}");
    call(
        h,
        "undo_last",
        json!({ "path": repo.path(), "id": entry["id"] }),
    )
    .unwrap()
}

fn head_of(repo: &Repo) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn snapshots(h: &Harness, repo: &Repo) -> Vec<Value> {
    call(h, "snapshots_list", json!({ "path": repo.path() }))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn the_reflog_is_listed_and_paged_over_ipc_and_rejects_other_refs() {
    let h = harness();
    let repo = repository();
    repo.commit("b.txt", "b\n", "Second");
    repo.commit("c.txt", "c\n", "Third");

    let refs = call(&h, "reflog_refs", json!({ "path": repo.path() })).unwrap();
    let page = call(
        &h,
        "reflog_list",
        json!({ "path": repo.path(), "reference": "HEAD", "before": null, "limit": 2 }),
    )
    .unwrap();
    let next = call(
        &h,
        "reflog_list",
        json!({ "path": repo.path(), "reference": "HEAD", "before": 1, "limit": 2 }),
    )
    .unwrap();
    let bad = call(
        &h,
        "reflog_list",
        json!({ "path": repo.path(), "reference": "refs/tags/x", "before": null, "limit": 2 }),
    )
    .unwrap_err();

    assert_eq!(refs, json!(["HEAD", "refs/heads/main"]));
    assert_eq!(page[0]["selector"], "HEAD@{0}");
    assert_eq!(page[0]["action"], "commit");
    assert_eq!(page[0]["summary"], "Third");
    assert_eq!(page[0]["exists"], true);
    assert_eq!(page[0]["previous_sha"], page[1]["sha"]);
    assert_eq!(next[0]["index"], 2);
    assert_eq!(next[0]["action"], "commit (initial)");
    assert_eq!(next[0]["previous_sha"], Value::Null);
    assert_eq!(bad["kind"], "invalid_request");
}

#[test]
fn lost_commits_are_found_over_ipc_with_a_releasable_operation_id() {
    let h = harness();
    let repo = repository();
    repo.git(&["switch", "-q", "-c", "doomed"]);
    repo.commit("b.txt", "b\n", "Only here");
    let tip = head_of(&repo);
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["branch", "-D", "doomed"]);

    let first = call(
        &h,
        "lost_commits",
        json!({ "path": repo.path(), "id": "lost-1" }),
    )
    .unwrap();
    let again = call(
        &h,
        "lost_commits",
        json!({ "path": repo.path(), "id": "lost-1" }),
    )
    .unwrap();
    let anonymous = call(&h, "lost_commits", json!({ "path": repo.path() })).unwrap();

    assert_eq!(first[0]["sha"], tip);
    assert_eq!(first[0]["summary"], "Only here");
    assert_eq!(first[0]["kind"], "commit");
    assert_eq!(again, first);
    assert_eq!(anonymous, first);
    let cancelled = call(&h, "operation_cancel", json!({ "id": "lost-1" })).unwrap();
    assert_eq!(cancelled, false);
}

#[test]
fn restoring_a_lost_commit_as_a_branch_is_recorded_and_undone() {
    let h = harness();
    let repo = repository();
    repo.git(&["switch", "-q", "-c", "doomed"]);
    repo.commit("b.txt", "b\n", "Only here");
    let tip = head_of(&repo);
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["branch", "-D", "doomed"]);

    call(
        &h,
        "restore_as_branch",
        json!({ "path": repo.path(), "sha": tip, "name": "rescued" }),
    )
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "rescued"]), tip);
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Restore as branch");
    assert_eq!(entry["local"], true);
    undo_last(&h, &repo);
    assert!(repo.git(&["branch", "--list", "rescued"]).is_empty());

    let invalid = call(
        &h,
        "restore_as_branch",
        json!({ "path": repo.path(), "sha": tip, "name": "main" }),
    )
    .unwrap_err();
    assert_eq!(invalid["kind"], "invalid_request");
}

#[test]
fn a_detached_restore_checkout_refuses_a_dirty_tree_and_is_undone() {
    let h = harness();
    let repo = repository();
    let first = head_of(&repo);
    repo.commit("b.txt", "b\n", "Second");
    repo.write("a.txt", "dirty\n");

    let refused = call(
        &h,
        "restore_checkout",
        json!({ "path": repo.path(), "sha": first }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "local_changes");
    repo.git(&["checkout", "--", "a.txt"]);

    call(
        &h,
        "restore_checkout",
        json!({ "path": repo.path(), "sha": first }),
    )
    .unwrap();

    assert_eq!(head_of(&repo), first);
    assert_eq!(repo.git(&["branch", "--show-current"]), "");
    assert_eq!(last_entry(&h)["operation"], "Restore checkout");
    undo_last(&h, &repo);
    assert_eq!(repo.git(&["branch", "--show-current"]), "main");
}

#[test]
fn a_restore_reset_moves_the_branch_and_is_undone_and_a_hard_one_takes_a_snapshot() {
    let h = harness();
    let repo = repository();
    let first = head_of(&repo);
    repo.commit("b.txt", "b\n", "Second");
    let second = head_of(&repo);

    call(
        &h,
        "restore_reset",
        json!({ "path": repo.path(), "sha": first, "mode": "soft" }),
    )
    .unwrap();
    assert_eq!(head_of(&repo), first);
    assert!(snapshots(&h, &repo).is_empty());
    repo.git(&["reset", "-q", "--hard", &second]);
    let cleared = snapshots(&h, &repo).len();

    call(
        &h,
        "restore_reset",
        json!({ "path": repo.path(), "sha": first, "mode": "hard" }),
    )
    .unwrap();

    assert_eq!(head_of(&repo), first);
    assert_eq!(snapshots(&h, &repo).len(), cleared + 1);
    assert_eq!(snapshots(&h, &repo)[0]["action"], "reset_hard");
    assert_eq!(last_entry(&h)["operation"], "Restore reset");
    undo_last(&h, &repo);
    assert_eq!(head_of(&repo), second);
}

#[test]
fn snapshots_are_listed_inspected_restored_and_deleted_over_ipc() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "precious\n");
    repo.write("new.txt", "fresh\n");
    call(
        &h,
        "discard_files",
        json!({ "path": repo.path(), "files": ["a.txt", "new.txt"] }),
    )
    .unwrap();

    let listed = snapshots(&h, &repo);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["action"], "discard");
    assert_eq!(listed[0]["branch"], "main");
    assert_eq!(listed[0]["head_sha"], head_of(&repo));
    assert_eq!(listed[0]["files_changed"], 2);
    let reference = listed[0]["ref"].as_str().unwrap().to_owned();
    assert!(reference.starts_with("refs/yforge/snapshots/"));

    let files = call(
        &h,
        "snapshot_files",
        json!({ "path": repo.path(), "reference": reference }),
    )
    .unwrap();
    assert_eq!(
        files,
        json!([
            { "path": "a.txt", "status": "modified" },
            { "path": "new.txt", "status": "added" }
        ])
    );

    let safety = call(
        &h,
        "snapshot_restore_files",
        json!({ "path": repo.path(), "reference": reference, "files": ["new.txt"] }),
    )
    .unwrap();
    assert_eq!(repo.read("new.txt"), "fresh\n");
    assert_eq!(repo.read("a.txt"), "1\n");
    assert!(safety.as_str().unwrap().ends_with("-restore_files"));
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Restore snapshot");
    assert_eq!(entry["ok"], true);

    repo.write("later.txt", "x\n");
    call(
        &h,
        "snapshot_restore_all",
        json!({ "path": repo.path(), "reference": reference, "force": false }),
    )
    .unwrap();
    assert_eq!(repo.read("a.txt"), "precious\n");
    assert!(!repo.path.join("later.txt").exists());

    repo.commit("b.txt", "b\n", "Head moves");
    let moved = call(
        &h,
        "snapshot_restore_all",
        json!({ "path": repo.path(), "reference": reference, "force": false }),
    )
    .unwrap_err();
    assert_eq!(moved["kind"], "invalid_request");

    call(
        &h,
        "snapshot_delete",
        json!({ "path": repo.path(), "reference": reference }),
    )
    .unwrap();
    assert!(snapshots(&h, &repo)
        .iter()
        .all(|snapshot| snapshot["ref"] != reference));
    assert_eq!(last_entry(&h)["operation"], "Delete snapshot");
}

#[test]
fn a_snapshot_that_cannot_be_saved_refuses_the_discard_with_a_typed_error() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "precious\n");
    std::fs::write(repo.path.join(".git/refs/yforge"), "blocked").unwrap();

    let error = call(
        &h,
        "discard_files",
        json!({ "path": repo.path(), "files": ["a.txt"] }),
    )
    .unwrap_err();

    assert_eq!(error["kind"], "snapshot_failed");
    assert!(error["message"]
        .as_str()
        .unwrap()
        .contains("safety snapshot"));
    assert_eq!(repo.read("a.txt"), "precious\n");
    let entry = last_entry(&h);
    assert_eq!(entry["ok"], false);
}
