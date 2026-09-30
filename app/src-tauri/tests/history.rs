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

fn published() -> (Repo, PathBuf) {
    let repo = repository();
    let remote = repo.sibling("origin.git");
    git(
        repo.path.parent().unwrap(),
        &[
            "init",
            "-q",
            "--bare",
            "-b",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    git(
        &repo.path,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    git(&repo.path, &["push", "-q", "-u", "origin", "main"]);
    (repo, remote)
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

fn steps_pick(sha: &str) -> Value {
    json!({ "kind": "pick", "sha": sha })
}

fn sha_at(repo: &Repo, spec: &str) -> String {
    repo.git(&["rev-parse", spec])
}

fn subjects(repo: &Repo) -> Vec<String> {
    repo.git(&["log", "--format=%s"])
        .lines()
        .map(str::to_owned)
        .collect()
}

fn history() -> (Repo, String, Vec<String>) {
    let repo = repository();
    let base = sha_at(&repo, "HEAD");
    repo.commit("f1.txt", "one\n", "Second");
    repo.commit("f2.txt", "two\n", "Third");
    repo.commit("f3.txt", "three\n", "Fourth");
    let shas = repo
        .git(&["log", "--reverse", "--format=%H", &format!("{base}..HEAD")])
        .lines()
        .map(str::to_owned)
        .collect();
    (repo, base, shas)
}

#[test]
fn the_plan_and_an_interactive_rebase_are_recorded_and_undone_to_the_recorded_head() {
    let h = harness();
    let (repo, base, shas) = history();
    let before = sha_at(&repo, "HEAD");

    let plan = call(
        &h,
        "rebase_plan",
        json!({ "path": repo.path(), "base": base }),
    )
    .unwrap();
    assert_eq!(plan["commits"].as_array().unwrap().len(), 3);
    assert_eq!(plan["commits"][0]["sha"], shas[0]);
    assert_eq!(plan["commits"][0]["author"]["initials"], "YL");
    assert_eq!(plan["pushed"], false);

    let result = call(
        &h,
        "rebase_interactive",
        json!({
            "path": repo.path(),
            "base": base,
            "steps": [
                steps_pick(&shas[2]),
                { "kind": "reword", "sha": shas[0], "message": "Renamed\n\nWith a body." },
                { "kind": "drop", "sha": shas[1] },
            ],
        }),
    )
    .unwrap();

    assert_eq!(result["outcome"], "completed");
    assert_eq!(result["pushed"], false);
    assert_eq!(result["dropped_all"], false);
    assert_eq!(subjects(&repo), ["Renamed", "Fourth", "First commit"]);
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Interactive rebase");
    assert_eq!(entry["local"], true);

    repo.write("scratch.txt", "x\n");
    repo.git(&["add", "scratch.txt"]);
    let dirty = call(
        &h,
        "undo_last",
        json!({ "path": repo.path(), "id": entry["id"] }),
    )
    .unwrap_err();
    assert_eq!(dirty["kind"], "local_changes");
    repo.git(&["reset", "-q", "--hard"]);

    call(
        &h,
        "undo_last",
        json!({ "path": repo.path(), "id": entry["id"] }),
    )
    .unwrap();

    assert_eq!(sha_at(&repo, "HEAD"), before);
    assert_eq!(
        subjects(&repo),
        ["Fourth", "Third", "Second", "First commit"]
    );
}

#[test]
fn an_undo_is_refused_once_head_moved_after_the_rewrite() {
    let h = harness();
    let (repo, base, shas) = history();
    call(
        &h,
        "rebase_interactive",
        json!({ "path": repo.path(), "base": base,
                "steps": [steps_pick(&shas[1]), steps_pick(&shas[0]), steps_pick(&shas[2])] }),
    )
    .unwrap();
    let entry = last_entry(&h);
    repo.commit("later.txt", "later\n", "Later");

    let refused = call(
        &h,
        "undo_last",
        json!({ "path": repo.path(), "id": entry["id"] }),
    )
    .unwrap_err();

    assert_eq!(refused["kind"], "invalid_request");
    assert_eq!(subjects(&repo)[0], "Later");
}

#[test]
fn an_edit_stop_is_reported_named_in_the_snapshot_and_has_no_undo_until_it_finishes() {
    let h = harness();
    let (repo, base, shas) = history();

    let result = call(
        &h,
        "rebase_interactive",
        json!({ "path": repo.path(), "base": base,
                "steps": [steps_pick(&shas[0]), { "kind": "edit", "sha": shas[1] }, steps_pick(&shas[2])] }),
    )
    .unwrap();

    assert_eq!(result["outcome"], "stopped_to_edit");
    let entry = last_entry(&h);
    assert_eq!(entry["undo"]["kind"], "unavailable");
    let snapshot = call(&h, "repo_open", json!({ "path": repo.path() })).unwrap();
    assert_eq!(snapshot["operation"], "rebase");
    assert_eq!(
        snapshot["operation_detail"]["stopped_edit"],
        sha_at(&repo, "HEAD")
    );

    let outcome = call(
        &h,
        "operation_continue",
        json!({ "path": repo.path(), "message": null }),
    )
    .unwrap();
    assert_eq!(outcome, "completed");
    let snapshot = call(&h, "repo_open", json!({ "path": repo.path() })).unwrap();
    assert_eq!(snapshot["operation"], Value::Null);
}

#[test]
fn a_rewrite_during_another_operation_and_a_merge_in_the_range_have_typed_errors() {
    let h = harness();
    let (repo, base, shas) = history();
    repo.git(&["switch", "-q", "-c", "topic", &shas[0]]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"]);

    let refused = call(
        &h,
        "rebase_interactive",
        json!({ "path": repo.path(), "base": base, "steps": [] }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "merge_commit_in_range");
    let refused = call(
        &h,
        "squash_commits",
        json!({ "path": repo.path(), "shas": [shas[0], shas[1]], "message": "No" }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "merge_commit_in_range");

    repo.git(&["reset", "-q", "--hard", &shas[2]]);
    repo.git(&["switch", "-q", "-c", "clash", &base]);
    repo.commit("f1.txt", "clash\n", "Clash");
    repo.git(&["switch", "-q", "main"]);
    let merge = Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["merge", "clash"])
        .output()
        .unwrap();
    assert!(!merge.status.success());
    let refused = call(
        &h,
        "rebase_interactive",
        json!({ "path": repo.path(), "base": base, "steps": [] }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "operation_in_progress");
}

#[test]
fn squashing_a_range_records_pushed_history_and_can_be_undone() {
    let h = harness();
    let (repo, _, shas) = history();
    let remote = repo.sibling("origin.git");
    git(
        repo.path.parent().unwrap(),
        &[
            "init",
            "-q",
            "--bare",
            "-b",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    repo.git(&["remote", "add", "origin", remote.to_str().unwrap()]);
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let before = sha_at(&repo, "HEAD");

    let result = call(
        &h,
        "squash_commits",
        json!({ "path": repo.path(), "shas": [shas[2], shas[1]], "message": "Squashed pair" }),
    )
    .unwrap();

    assert_eq!(result["outcome"], "completed");
    assert_eq!(result["pushed"], true);
    assert_eq!(subjects(&repo), ["Squashed pair", "Second", "First commit"]);
    assert_eq!(last_entry(&h)["operation"], "Squash commits");

    undo_last(&h, &repo);

    assert_eq!(sha_at(&repo, "HEAD"), before);
}

#[test]
fn recompose_previews_applies_refuses_a_dirty_tree_and_is_undone() {
    let h = harness();
    let (repo, base, _) = history();
    let before = sha_at(&repo, "HEAD");
    let tree = sha_at(&repo, "HEAD^{tree}");

    let preview = call(
        &h,
        "recompose_preview",
        json!({ "path": repo.path(), "base": base }),
    )
    .unwrap();
    assert_eq!(preview["head"], before);
    let files: Vec<&str> = preview["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["path"].as_str().unwrap())
        .collect();
    assert_eq!(files, ["f1.txt", "f2.txt", "f3.txt"]);
    assert_eq!(preview["files"][0]["hunks"][0]["id"], "f1.txt@0,0+1,1");

    repo.write("f1.txt", "dirty\n");
    let refused = call(
        &h,
        "recompose_apply",
        json!({ "path": repo.path(), "base": base, "groups": [] }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "local_changes");
    repo.git(&["checkout", "--", "f1.txt"]);

    let result = call(
        &h,
        "recompose_apply",
        json!({
            "path": repo.path(),
            "base": base,
            "groups": [
                { "message": "Add f1", "changes": [{ "kind": "file", "path": "f1.txt" }] },
                { "message": "Add f2 and f3", "changes": [
                    { "kind": "hunk", "id": "f2.txt@0,0+1,1" },
                    { "kind": "file", "path": "f3.txt" },
                ] },
            ],
        }),
    )
    .unwrap();

    assert_eq!(result["head"], sha_at(&repo, "HEAD"));
    assert_eq!(result["pushed"], false);
    assert_eq!(sha_at(&repo, "HEAD^{tree}"), tree);
    assert_eq!(subjects(&repo), ["Add f2 and f3", "Add f1", "First commit"]);
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Recompose");
    assert_eq!(entry["local"], true);

    undo_last(&h, &repo);

    assert_eq!(sha_at(&repo, "HEAD"), before);
    assert_eq!(
        subjects(&repo),
        ["Fourth", "Third", "Second", "First commit"]
    );
}
