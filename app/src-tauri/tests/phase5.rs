use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
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

    fn write(&self, name: &str, contents: &str) {
        std::fs::write(self.path.join(name), contents).unwrap();
    }

    fn commit(&self, name: &str, contents: &str, message: &str) {
        self.write(name, contents);
        git(&self.path, &["add", "--", name]);
        git(&self.path, &["commit", "-q", "-m", message]);
    }
}

fn repository() -> Repo {
    let scratch = tempfile::tempdir().expect("tempdir");
    let path = scratch.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    git(&path, &["config", "commit.gpgsign", "false"]);
    let repo = Repo {
        _scratch: scratch,
        path,
    };
    repo.commit("a.txt", "one\ntwo\n", "First commit");
    repo
}

struct Harness {
    app: App<MockRuntime>,
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
        app,
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

fn summaries(page: &Value) -> Vec<String> {
    page["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["summary"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn repo_graph_and_search_take_an_optional_visibility_and_a_clean_tree_has_no_changes_row() {
    let h = harness();
    let repo = repository();
    git(&repo.path, &["checkout", "-q", "-b", "feature"]);
    repo.commit("f.txt", "f\n", "Feature work");
    git(&repo.path, &["checkout", "-q", "main"]);
    let window = |extra: Value| {
        let mut body = json!({ "path": repo.path(), "offset": 0, "limit": 50 });
        if !extra.is_null() {
            body["visibility"] = extra;
        }
        call(&h, "repo_graph", body).unwrap()
    };

    let default = window(Value::Null);
    let all = window(json!({ "kind": "all" }));
    let current = window(json!({ "kind": "current_and_upstream" }));
    let listed = window(json!({
        "kind": "refs",
        "refs": [{ "name": "feature", "kind": "local_branch" }]
    }));

    assert_eq!(default, all);
    assert_eq!(default["rows"][0]["kind"], "commit");
    assert_eq!(default["total"], 2);
    assert_eq!(current["total"], 1);
    assert_eq!(summaries(&current)[0], "First commit");
    assert_eq!(summaries(&listed), ["Feature work", "First commit"]);
    let search = |visibility: Value| {
        call(
            &h,
            "search_commits",
            json!({ "path": repo.path(), "query": "feature", "visibility": visibility }),
        )
        .unwrap()
    };
    assert_eq!(
        search(json!({ "kind": "all" })),
        json!({ "total": 2, "rows": [0] })
    );
    assert_eq!(
        search(json!({ "kind": "current_and_upstream" })),
        json!({ "total": 1, "rows": [] })
    );
    let rejected = call(
        &h,
        "repo_graph",
        json!({ "path": repo.path(), "offset": 0, "limit": 5, "visibility": { "kind": "nope" } }),
    );
    assert!(rejected.is_err());
}

#[test]
fn file_diffs_take_ignore_whitespace_and_binary_ones_report_byte_sizes() {
    let h = harness();
    let repo = repository();
    repo.commit("w.txt", "one\ntwo\n", "Add w");
    repo.commit("w.txt", "one  \n  two\n", "Spaces");
    std::fs::write(repo.path.join("logo.png"), b"PNG\0\x01").unwrap();
    git(&repo.path, &["add", "logo.png"]);
    git(&repo.path, &["commit", "-q", "-m", "Add logo"]);
    let head = git(&repo.path, &["rev-parse", "HEAD"]);
    let spaces = git(&repo.path, &["rev-parse", "HEAD~1"]);

    let plain = call(
        &h,
        "commit_file_diff",
        json!({ "path": repo.path(), "sha": spaces, "file": "w.txt" }),
    )
    .unwrap();
    let ignored = call(
        &h,
        "commit_file_diff",
        json!({ "path": repo.path(), "sha": spaces, "file": "w.txt", "ignoreWhitespace": true }),
    )
    .unwrap();
    let binary = call(
        &h,
        "commit_file_diff",
        json!({ "path": repo.path(), "sha": head, "file": "logo.png" }),
    )
    .unwrap();

    assert_eq!(plain["hunks"].as_array().unwrap().len(), 1);
    assert_eq!(plain["old_size"], Value::Null);
    assert!(ignored["hunks"].as_array().unwrap().is_empty());
    assert_eq!(binary["binary"], true);
    assert_eq!(binary["old_size"], Value::Null);
    assert_eq!(binary["new_size"], 5);
}

#[test]
fn file_at_revision_returns_tagged_text_and_binary_and_a_typed_error_for_large_files() {
    let h = harness();
    let repo = repository();
    std::fs::write(repo.path.join("logo.png"), b"PNG\0\x01").unwrap();
    std::fs::write(repo.path.join("big.txt"), "a".repeat(2 * 1024 * 1024 + 1)).unwrap();
    repo.write("a.txt", "on disk\r\n");
    let head = git(&repo.path, &["rev-parse", "HEAD"]);
    let at = |file: &str, rev: &str| {
        call(
            &h,
            "file_at_revision",
            json!({ "path": repo.path(), "file": file, "rev": rev }),
        )
    };

    assert_eq!(
        at("a.txt", &head).unwrap(),
        json!({ "kind": "text", "text": "one\ntwo\n", "size": 8, "eol": "\n" })
    );
    assert_eq!(
        at("a.txt", ":worktree").unwrap(),
        json!({ "kind": "text", "text": "on disk\r\n", "size": 9, "eol": "\r\n" })
    );
    assert_eq!(
        at("logo.png", ":worktree").unwrap(),
        json!({ "kind": "binary", "size": 5 })
    );
    let too_large = at("big.txt", ":worktree").unwrap_err();
    assert_eq!(too_large["kind"], "file_too_large");
    assert_eq!(too_large["output"], "2097153");
    assert_eq!(at("a.txt", "HEAD").unwrap_err()["kind"], "invalid_request");
    assert_eq!(
        at("nope.txt", &head).unwrap_err()["kind"],
        "invalid_request"
    );
}

#[test]
fn stash_details_and_file_diffs_cover_tracked_and_untracked_files() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "one\nchanged\n");
    repo.write("loose.txt", "loose\n");
    call(
        &h,
        "stash_push",
        json!({ "path": repo.path(), "message": "parked", "untracked": true }),
    )
    .unwrap();
    let snapshot = call(&h, "repo_open", json!({ "path": repo.path() })).unwrap();
    let stash = &snapshot["stashes"][0];
    let target = json!({ "path": repo.path(), "index": stash["index"], "sha": stash["sha"] });

    let details = call(&h, "stash_details", target.clone()).unwrap();
    let mut tracked_request = target.clone();
    tracked_request["file"] = json!("a.txt");
    let tracked = call(&h, "stash_file_diff", tracked_request).unwrap();
    let mut untracked_request = target.clone();
    untracked_request["file"] = json!("loose.txt");
    untracked_request["ignoreWhitespace"] = json!(true);
    let untracked = call(&h, "stash_file_diff", untracked_request).unwrap();
    let mut missing_request = target;
    missing_request["file"] = json!("absent.txt");
    let missing = call(&h, "stash_file_diff", missing_request).unwrap_err();

    assert_eq!(details["message"], "On main: parked");
    assert_eq!(details["base_sha"], stash["base_sha"]);
    assert!(details["untracked_sha"].is_string());
    let files: Vec<(&str, &str, bool)> = details["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap(),
                file["status"].as_str().unwrap(),
                file["untracked"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        files,
        vec![("a.txt", "modified", false), ("loose.txt", "added", true)]
    );
    assert_eq!(tracked["hunks"][0]["lines"][2]["text"], "changed");
    assert_eq!(untracked["hunks"][0]["lines"][0]["text"], "loose");
    assert_eq!(missing["kind"], "invalid_request");
}

#[test]
fn repo_ui_prefs_round_trip_through_the_database_and_reject_invalid_values() {
    let h = harness();
    let prefs = json!({
        "columns": [
            { "column": "refs", "visible": true, "width": 240 },
            { "column": "sha", "visible": false }
        ],
        "collapsed_folders": ["local:feature"],
        "branch_visibility": { "kind": "current_and_upstream" }
    });

    let initial = call(&h, "repo_ui_prefs_load", json!({ "path": "/work/alpha" })).unwrap();
    call(
        &h,
        "repo_ui_prefs_save",
        json!({ "path": "/work/alpha", "prefs": prefs }),
    )
    .unwrap();
    let loaded = call(&h, "repo_ui_prefs_load", json!({ "path": "/work/alpha" })).unwrap();
    let other = call(&h, "repo_ui_prefs_load", json!({ "path": "/work/beta" })).unwrap();
    let invalid = call(
        &h,
        "repo_ui_prefs_save",
        json!({
            "path": "/work/alpha",
            "prefs": { "columns": [{ "column": "refs", "visible": false }] }
        }),
    )
    .unwrap_err();

    assert_eq!(
        initial,
        json!({
            "columns": [],
            "collapsed_folders": [],
            "branch_visibility": { "kind": "all" }
        })
    );
    assert_eq!(
        loaded["columns"][0],
        json!({ "column": "refs", "visible": true, "width": 240 })
    );
    assert_eq!(loaded["collapsed_folders"], json!(["local:feature"]));
    assert_eq!(
        loaded["branch_visibility"],
        json!({ "kind": "current_and_upstream" })
    );
    assert_eq!(other, initial);
    assert_eq!(invalid["kind"], "invalid_request");
    assert_eq!(
        call(&h, "repo_ui_prefs_load", json!({ "path": "/work/alpha" })).unwrap(),
        loaded
    );
}

#[test]
fn app_ui_prefs_round_trip_through_the_database_and_reject_invalid_values() {
    let h = harness();
    let prefs = json!({
        "palette_recents": ["tab.new", "repo.fetch"],
        "last_parent_folder": "/Users/dev/code",
        "file_list_mode": "tree",
        "zoom_percent": 125,
        "sidebar_hidden": true,
        "inspector_hidden": false,
        "syntax_highlighting": false
    });

    let initial = call(&h, "app_ui_prefs_load", json!({})).unwrap();
    call(&h, "app_ui_prefs_save", json!({ "prefs": prefs })).unwrap();
    let loaded = call(&h, "app_ui_prefs_load", json!({})).unwrap();
    let invalid = call(
        &h,
        "app_ui_prefs_save",
        json!({ "prefs": { "palette_recents": ["a", "a"] } }),
    )
    .unwrap_err();

    assert_eq!(
        initial,
        json!({
            "palette_recents": [],
            "last_parent_folder": null,
            "file_list_mode": "path",
            "zoom_percent": 100,
            "sidebar_hidden": false,
            "inspector_hidden": false,
            "syntax_highlighting": true
        })
    );
    assert_eq!(loaded, prefs);
    assert_eq!(invalid["kind"], "invalid_request");
    assert_eq!(call(&h, "app_ui_prefs_load", json!({})).unwrap(), loaded);
}

#[test]
fn repo_open_names_the_main_root_and_the_sibling_worktrees_of_a_linked_worktree() {
    let h = harness();
    let repo = repository();
    let linked = repo.path.parent().unwrap().join("repo-feature");
    git(
        &repo.path,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feature",
            linked.to_str().unwrap(),
        ],
    );

    let snapshot = call(&h, "repo_open", json!({ "path": linked })).unwrap();

    assert_eq!(snapshot["main_root"], repo.path());
    assert_eq!(snapshot["root"], linked.to_string_lossy().as_ref());
    let worktrees: Vec<(&str, bool)> = snapshot["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|worktree| {
            (
                worktree["path"].as_str().unwrap(),
                worktree["current"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        worktrees,
        vec![
            (repo.path().as_str(), false),
            (linked.to_str().unwrap(), true)
        ]
    );
}

#[test]
fn a_second_launch_with_a_path_asks_the_window_to_open_it_and_one_without_only_focuses() {
    let h = harness();
    let (sender, received) = mpsc::channel();
    h.app.listen("open-path-requested", move |event| {
        sender
            .send(serde_json::from_str::<Value>(event.payload()).unwrap())
            .unwrap();
    });
    let argv = |arguments: &[&str]| -> Vec<String> {
        arguments
            .iter()
            .map(|argument| (*argument).to_owned())
            .collect()
    };

    yforge_lib::second_instance(
        h.app.handle(),
        &argv(&["yforge", "app", "ignored"]),
        "/work",
    );
    yforge_lib::second_instance(h.app.handle(), &argv(&["yforge"]), "/work");
    yforge_lib::second_instance(
        h.app.handle(),
        &argv(&["yforge", "/abs/repo"]),
        "/elsewhere",
    );

    let first = received.recv_timeout(Duration::from_secs(5)).unwrap();
    let second = received.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(first, json!({ "path": "/work/app" }));
    assert_eq!(second, json!({ "path": "/abs/repo" }));
    assert!(received.recv_timeout(Duration::from_millis(300)).is_err());
}
