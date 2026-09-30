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

fn numbered(repo: &Repo, changes: &[(usize, &str)]) {
    let contents: String = (1..=30)
        .map(|number| {
            let text = changes
                .iter()
                .find(|(line, _)| *line == number)
                .map_or_else(|| format!("line {number}"), |(_, text)| (*text).to_owned());
            format!("{text}\n")
        })
        .collect();
    repo.write("f.txt", &contents);
}

fn cluster(repo: &Repo) {
    numbered(repo, &[]);
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "Numbered"]);
    numbered(repo, &[(5, "five"), (6, "six")]);
}

fn hunk_of(h: &Harness, repo: &Repo, area: &str, ignore: Option<bool>) -> Value {
    let mut body = json!({ "path": repo.path(), "file": "f.txt", "area": area });
    if let Some(ignore) = ignore {
        body["ignoreWhitespace"] = json!(ignore);
    }
    call(h, "diff_file", body).unwrap()["hunks"][0].clone()
}

fn indexes(hunk: &Value, wanted: &[(&str, &str)]) -> Vec<u32> {
    let lines = hunk["lines"].as_array().unwrap();
    wanted
        .iter()
        .map(|(kind, text)| {
            lines
                .iter()
                .position(|line| line["kind"] == *kind && line["text"] == *text)
                .unwrap() as u32
        })
        .collect()
}

#[test]
fn line_commands_stage_unstage_and_discard_a_selection_and_discard_is_undoable() {
    let h = harness();
    let repo = repository();
    cluster(&repo);
    let hunk = hunk_of(&h, &repo, "unstaged", None);
    let picked = indexes(&hunk, &[("removed", "line 5"), ("added", "five")]);

    call(
        &h,
        "stage_lines",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": hunk, "lines": picked }),
    )
    .unwrap();
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Stage lines");
    assert_eq!(entry["local"], false);
    let staged = repo.git(&["diff", "--cached"]);
    assert!(staged.contains("+five") && !staged.contains("+six"));

    let staged_hunk = hunk_of(&h, &repo, "staged", None);
    let picked = indexes(&staged_hunk, &[("added", "five"), ("removed", "line 5")]);
    call(
        &h,
        "unstage_lines",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": staged_hunk, "lines": picked }),
    )
    .unwrap();
    assert_eq!(last_entry(&h)["operation"], "Unstage lines");
    assert_eq!(repo.git(&["diff", "--cached"]), "");

    let hunk = hunk_of(&h, &repo, "unstaged", None);
    let picked = indexes(&hunk, &[("removed", "line 6"), ("added", "six")]);
    let before = repo.read("f.txt");
    call(
        &h,
        "discard_lines",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": hunk, "lines": picked }),
    )
    .unwrap();
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Discard lines");
    assert_eq!(entry["local"], true);
    assert_ne!(repo.read("f.txt"), before);
    assert!(repo.read("f.txt").contains("line 6") && repo.read("f.txt").contains("five"));

    undo_last(&h, &repo);

    assert_eq!(repo.read("f.txt"), before);
}

#[test]
fn a_stale_selection_is_a_stale_hunk_error_and_a_whitespace_view_is_refused_with_its_own_kind() {
    let h = harness();
    let repo = repository();
    cluster(&repo);
    let hunk = hunk_of(&h, &repo, "unstaged", None);
    let picked = indexes(&hunk, &[("added", "five")]);

    let refused = call(
        &h,
        "stage_lines",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": hunk, "lines": picked, "ignoreWhitespace": true }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "whitespace_ignored");
    let refused_hunk = call(
        &h,
        "stage_hunk",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": hunk, "ignoreWhitespace": true }),
    )
    .unwrap_err();
    assert_eq!(refused_hunk["kind"], "whitespace_ignored");

    repo.write("f.txt", "changed underneath\n");
    let stale = call(
        &h,
        "stage_lines",
        json!({ "path": repo.path(), "file": "f.txt", "hunk": hunk, "lines": picked }),
    )
    .unwrap_err();
    assert_eq!(stale["kind"], "stale_hunk");
    assert_eq!(repo.git(&["diff", "--cached"]), "");
}

#[test]
fn diff_file_ignores_whitespace_only_when_asked() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "1  \n");

    let plain = call(
        &h,
        "diff_file",
        json!({ "path": repo.path(), "file": "a.txt", "area": "unstaged" }),
    )
    .unwrap();
    let ignored = call(
        &h,
        "diff_file",
        json!({ "path": repo.path(), "file": "a.txt", "area": "unstaged", "ignoreWhitespace": true }),
    )
    .unwrap();

    assert_eq!(plain["hunks"].as_array().unwrap().len(), 1);
    assert!(ignored["hunks"].as_array().unwrap().is_empty());
}

#[test]
fn edit_head_message_rewords_head_records_an_undoable_amend_and_flags_pushed_history() {
    let h = harness();
    let (repo, _remote) = published();
    repo.write("staged.txt", "s\n");
    repo.git(&["add", "staged.txt"]);
    let before = repo.git(&["rev-parse", "HEAD"]);

    let edit = call(
        &h,
        "edit_head_message",
        json!({ "path": repo.path(), "sha": before, "summary": "Reworded", "description": "Body." }),
    )
    .unwrap();

    assert_eq!(edit["pushed"], true);
    assert_eq!(edit["sha"], repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Reworded");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "staged.txt");
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Edit message");
    assert_eq!(entry["local"], true);

    undo_last(&h, &repo);

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    let refused = call(
        &h,
        "edit_head_message",
        json!({ "path": repo.path(), "sha": "deadbeef", "summary": "No", "description": "" }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "not_head");
}

#[test]
fn deleting_a_remote_branch_runs_on_the_network_runner_and_is_undoable_by_pushing_it_back() {
    let h = harness();
    let (repo, remote) = published();
    repo.git(&["push", "-q", "origin", "main:topic"]);
    let tip = repo.git(&["rev-parse", "HEAD"]);

    call(
        &h,
        "delete_remote_branch",
        json!({ "path": repo.path(), "id": "del-1", "remote": "origin", "name": "topic" }),
    )
    .unwrap();

    assert_eq!(git(&remote, &["for-each-ref", "refs/heads/topic"]), "");
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Delete remote branch");
    assert_eq!(entry["local"], true);
    assert!(entry["undo"]["scope"]
        .as_str()
        .unwrap()
        .contains("origin/topic"));

    undo_last(&h, &repo);

    assert_eq!(git(&remote, &["rev-parse", "refs/heads/topic"]), tip);
}

#[test]
fn set_upstream_and_unset_are_undoable_and_push_to_creates_the_remote_branch() {
    let h = harness();
    let (repo, remote) = published();
    repo.git(&["branch", "feature"]);
    repo.git(&["push", "-q", "origin", "feature"]);
    let upstream = |branch: &str| {
        repo.git(&[
            "for-each-ref",
            "--format=%(upstream:short)",
            &format!("refs/heads/{branch}"),
        ])
    };

    call(
        &h,
        "set_upstream",
        json!({ "path": repo.path(), "branch": "feature", "upstream": "origin/feature" }),
    )
    .unwrap();
    assert_eq!(upstream("feature"), "origin/feature");
    assert_eq!(last_entry(&h)["operation"], "Set upstream");
    undo_last(&h, &repo);
    assert_eq!(upstream("feature"), "");

    call(
        &h,
        "set_upstream",
        json!({ "path": repo.path(), "branch": "main", "upstream": null }),
    )
    .unwrap();
    assert_eq!(upstream("main"), "");
    undo_last(&h, &repo);
    assert_eq!(upstream("main"), "origin/main");

    call(
        &h,
        "push_to",
        json!({ "path": repo.path(), "id": "to-1", "target": { "remote": "origin", "name": "review/main", "set_upstream": true } }),
    )
    .unwrap();
    assert_eq!(
        git(&remote, &["rev-parse", "refs/heads/review/main"]),
        repo.git(&["rev-parse", "HEAD"])
    );
    assert_eq!(upstream("main"), "origin/review/main");
    let entry = last_entry(&h);
    assert_eq!(entry["operation"], "Push to");
    assert_eq!(entry["local"], false);
}

#[test]
fn fetch_with_prune_removes_remote_tracking_refs_of_deleted_branches() {
    let h = harness();
    let (repo, remote) = published();
    repo.git(&["push", "-q", "origin", "main:gone"]);
    git(&remote, &["branch", "-D", "gone"]);
    assert!(repo.git(&["branch", "-r"]).contains("origin/gone"));

    call(
        &h,
        "fetch",
        json!({ "path": repo.path(), "id": "kept", "prune": false }),
    )
    .unwrap();
    assert!(repo.git(&["branch", "-r"]).contains("origin/gone"));
    call(
        &h,
        "fetch",
        json!({ "path": repo.path(), "id": "pruned", "prune": true }),
    )
    .unwrap();

    assert!(!repo.git(&["branch", "-r"]).contains("origin/gone"));
    let commands = last_entry(&h)["commands"].clone();
    assert!(commands
        .as_array()
        .unwrap()
        .iter()
        .any(|record| record["command"] == "git fetch --progress --prune origin"));
}

#[test]
fn a_stash_can_be_renamed_and_the_list_shows_the_new_order() {
    let h = harness();
    let repo = repository();
    repo.write("a.txt", "older\n");
    call(
        &h,
        "stash_push",
        json!({ "path": repo.path(), "message": "older", "untracked": false }),
    )
    .unwrap();
    repo.write("a.txt", "newer\n");
    call(
        &h,
        "stash_push",
        json!({ "path": repo.path(), "message": "newer", "untracked": false }),
    )
    .unwrap();
    let stashes = call(&h, "repo_open", json!({ "path": repo.path() })).unwrap()["stashes"].clone();

    call(
        &h,
        "stash_rename",
        json!({ "path": repo.path(), "index": 1, "sha": stashes[1]["sha"], "message": "renamed" }),
    )
    .unwrap();

    let after = call(&h, "repo_open", json!({ "path": repo.path() })).unwrap()["stashes"].clone();
    assert_eq!(after[0]["sha"], stashes[1]["sha"]);
    assert_eq!(after[0]["message"], "On main: renamed");
    assert_eq!(after[1]["sha"], stashes[0]["sha"]);
    assert_eq!(last_entry(&h)["operation"], "Rename stash");
}

#[test]
fn pull_with_autostash_reports_the_stash_outcome_and_restores_local_changes() {
    let h = harness();
    let (repo, remote) = published();
    let other = repo.sibling("other");
    git(
        repo.path.parent().unwrap(),
        &["clone", "-q", remote.to_str().unwrap(), "other"],
    );
    git(&other, &["config", "user.name", "Yui Lin"]);
    git(&other, &["config", "user.email", "yui@example.test"]);
    std::fs::write(other.join("b.txt"), "b\n").unwrap();
    git(&other, &["add", "b.txt"]);
    git(&other, &["commit", "-q", "-m", "Upstream"]);
    git(&other, &["push", "-q"]);
    repo.write("a.txt", "local edit\n");

    let report = call(
        &h,
        "pull_with_autostash",
        json!({ "path": repo.path(), "id": "pull-1", "mode": "fast_forward_or_merge" }),
    )
    .unwrap();

    assert_eq!(
        report,
        json!({ "outcome": "updated", "stash": { "kind": "restored" } })
    );
    assert_eq!(repo.read("a.txt"), "local edit\n");
    assert_eq!(repo.read("b.txt"), "b\n");
    assert_eq!(last_entry(&h)["operation"], "Pull with auto-stash");
}

#[test]
fn leaving_changes_stashed_records_them_per_branch_and_they_can_be_restored_or_dismissed() {
    let h = harness();
    let repo = repository();
    repo.git(&["branch", "feature"]);
    repo.write("a.txt", "local edit\n");

    let outcome = call(
        &h,
        "checkout",
        json!({ "path": repo.path(), "target": { "kind": "local_branch", "name": "feature" }, "stash": true, "leaveStashed": true }),
    )
    .unwrap();

    assert_eq!(outcome["auto_stash"], "stashed");
    assert_eq!(repo.read("a.txt"), "1\n");
    let offered = call(
        &h,
        "switch_stashes",
        json!({ "path": repo.path(), "branch": "main" }),
    )
    .unwrap();
    assert_eq!(offered.as_array().unwrap().len(), 1);
    assert_eq!(offered[0]["index"], 0);
    let none = call(
        &h,
        "switch_stashes",
        json!({ "path": repo.path(), "branch": "feature" }),
    )
    .unwrap();
    assert!(none.as_array().unwrap().is_empty());

    call(
        &h,
        "checkout",
        json!({ "path": repo.path(), "target": { "kind": "local_branch", "name": "main" }, "stash": false }),
    )
    .unwrap();
    let restored = call(
        &h,
        "switch_stash_restore",
        json!({ "path": repo.path(), "branch": "main", "sha": offered[0]["sha"] }),
    )
    .unwrap();

    assert_eq!(restored, "applied");
    assert_eq!(repo.read("a.txt"), "local edit\n");
    assert_eq!(last_entry(&h)["operation"], "Pop stash");
    assert!(call(
        &h,
        "switch_stashes",
        json!({ "path": repo.path(), "branch": "main" })
    )
    .unwrap()
    .as_array()
    .unwrap()
    .is_empty());

    call(
        &h,
        "checkout",
        json!({ "path": repo.path(), "target": { "kind": "local_branch", "name": "feature" }, "stash": true, "leaveStashed": true }),
    )
    .unwrap();
    let second = call(
        &h,
        "switch_stashes",
        json!({ "path": repo.path(), "branch": "main" }),
    )
    .unwrap();
    call(
        &h,
        "switch_stash_dismiss",
        json!({ "path": repo.path(), "branch": "main", "sha": second[0]["sha"] }),
    )
    .unwrap();
    assert!(call(
        &h,
        "switch_stashes",
        json!({ "path": repo.path(), "branch": "main" })
    )
    .unwrap()
    .as_array()
    .unwrap()
    .is_empty());
    assert_eq!(
        call(&h, "repo_open", json!({ "path": repo.path() })).unwrap()["stashes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn ssh_key_settings_round_trip_through_the_settings_commands() {
    let h = harness();
    let repo = repository();
    let key = repo.sibling("id_work");
    std::fs::write(&key, "private").unwrap();
    let mut settings = call(&h, "settings_load", json!({})).unwrap();
    assert!(settings["ssh_key_path"].is_null());

    settings["ssh_key_path"] = json!(key.to_string_lossy());
    let saved = call(&h, "settings_save", json!({ "settings": settings })).unwrap();
    assert_eq!(saved["ssh_key_path"], key.to_string_lossy().as_ref());
    call(
        &h,
        "repo_settings_save",
        json!({ "path": repo.path(), "settings": { "pull_mode": null, "ssh_key_path": key.to_string_lossy() } }),
    )
    .unwrap();
    let repo_settings = call(&h, "repo_settings_load", json!({ "path": repo.path() })).unwrap();
    assert_eq!(
        repo_settings["ssh_key_path"],
        key.to_string_lossy().as_ref()
    );
    let legacy = call(
        &h,
        "repo_settings_save",
        json!({ "path": repo.path(), "settings": { "pull_mode": "rebase" } }),
    );
    assert!(legacy.is_ok());
    assert!(
        call(&h, "repo_settings_load", json!({ "path": repo.path() })).unwrap()["ssh_key_path"]
            .is_null()
    );

    settings["ssh_key_path"] = json!("relative/key");
    let refused = call(&h, "settings_save", json!({ "settings": settings })).unwrap_err();
    assert_eq!(refused["kind"], "invalid_request");
}

fn worktree_add(h: &Harness, repo: &Repo, branch: &str, create: bool) -> PathBuf {
    let suggested = call(
        h,
        "worktree_suggest_path",
        json!({ "path": repo.path(), "branch": branch }),
    )
    .unwrap();
    assert_eq!(
        suggested,
        repo.sibling(&format!("repo-{branch}"))
            .to_string_lossy()
            .as_ref()
    );
    let created = call(
        h,
        "worktree_create",
        json!({ "path": repo.path(), "branch": branch, "create": create, "start": null, "destination": suggested }),
    )
    .unwrap();
    PathBuf::from(created.as_str().unwrap())
}

#[test]
fn worktrees_are_created_listed_removed_and_integrated_through_commands() {
    let h = harness();
    let repo = repository();
    let feat = worktree_add(&h, &repo, "feat", true);
    assert_eq!(last_entry(&h)["operation"], "Create worktree");
    std::fs::write(feat.join("f.txt"), "f\n").unwrap();
    git(&feat, &["add", "f.txt"]);
    git(&feat, &["commit", "-q", "-m", "Feature work"]);
    repo.commit("m.txt", "m\n", "Main work");
    std::fs::write(feat.join("dirty.txt"), "d\n").unwrap();

    let listed = call(&h, "worktree_list", json!({ "path": repo.path() })).unwrap();
    let entry = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["branch"] == "feat")
        .unwrap();
    assert_eq!(entry["dirty"], true);
    assert_eq!(entry["locked"], false);
    let refused = call(
        &h,
        "worktree_integrate",
        json!({ "path": repo.path(), "worktree": feat.to_string_lossy(), "target": "main", "cleanup": true }),
    )
    .unwrap_err();
    assert_eq!(refused["kind"], "worktree_dirty");
    let refused_remove = call(
        &h,
        "worktree_remove",
        json!({ "path": repo.path(), "worktree": feat.to_string_lossy(), "force": false }),
    )
    .unwrap_err();
    assert_eq!(refused_remove["kind"], "worktree_dirty");
    std::fs::remove_file(feat.join("dirty.txt")).unwrap();

    let outcome = call(
        &h,
        "worktree_integrate",
        json!({ "path": repo.path(), "worktree": feat.to_string_lossy(), "target": "main", "cleanup": true }),
    )
    .unwrap();

    assert_eq!(outcome["kind"], "integrated");
    assert_eq!(outcome["cleaned_up"], true);
    assert_eq!(outcome["target_sha"], repo.git(&["rev-parse", "HEAD"]));
    assert!(!feat.exists());
    assert_eq!(repo.git(&["rev-list", "--merges", "--count", "main"]), "0");
    assert_eq!(
        repo.git(&["log", "--format=%s", "-3"]),
        "Feature work\nMain work\nFirst commit"
    );
    assert_eq!(last_entry(&h)["operation"], "Integrate worktree");

    let existing = worktree_add(&h, &repo, "later", true);
    call(
        &h,
        "worktree_remove",
        json!({ "path": repo.path(), "worktree": existing.to_string_lossy(), "force": false }),
    )
    .unwrap();
    assert!(!existing.exists());
    assert_eq!(last_entry(&h)["operation"], "Remove worktree");
}

#[test]
fn a_conflicting_worktree_integration_reports_the_conflict_outcome() {
    let h = harness();
    let repo = repository();
    let feat = worktree_add(&h, &repo, "feat", true);
    repo.commit("a.txt", "main side\n", "Main edit");
    std::fs::write(feat.join("a.txt"), "feature side\n").unwrap();
    git(&feat, &["add", "a.txt"]);
    git(&feat, &["commit", "-q", "-m", "Feature edit"]);

    let outcome = call(
        &h,
        "worktree_integrate",
        json!({ "path": repo.path(), "worktree": feat.to_string_lossy(), "target": "main", "cleanup": false }),
    )
    .unwrap();

    assert_eq!(outcome["kind"], "conflicts");
    assert!(outcome["worktree"].as_str().unwrap().ends_with("repo-feat"));
    let snapshot = call(&h, "repo_open", json!({ "path": feat.to_string_lossy() })).unwrap();
    assert_eq!(snapshot["operation"], "rebase");
}
