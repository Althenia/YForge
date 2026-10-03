mod common;

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use common::Fixture;
use tempfile::TempDir;
use yforge_core::{
    hook_approve, hook_read, hooks_list, run_hook, CancelToken, HookEnd, HookMode, HookOutcome,
    HookStream, HOOK_LIMIT,
};

fn install(fixture: &Fixture, name: &str, body: &str, executable: bool) {
    let target = fixture.path.join(".git/hooks").join(name);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mode = if executable { 0o755 } else { 0o644 };
    fs::set_permissions(&target, fs::Permissions::from_mode(mode)).unwrap();
}

fn repository() -> (Fixture, TempDir) {
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    (fixture, tempfile::tempdir().unwrap())
}

struct Ran {
    outcome: HookOutcome,
    stdout: String,
    stderr: String,
}

fn run(
    dir: &Path,
    fixture: &Fixture,
    name: &str,
    mode: HookMode,
    message: &str,
) -> Result<Ran, yforge_core::CoreError> {
    let (mut stdout, mut stderr) = (String::new(), String::new());
    let outcome = run_hook(
        dir,
        &fixture.path,
        name,
        mode,
        message,
        HOOK_LIMIT,
        &CancelToken::new(),
        &mut |stream, text| match stream {
            HookStream::Stdout => stdout.push_str(text),
            HookStream::Stderr => stderr.push_str(text),
        },
    )?;
    Ok(Ran {
        outcome,
        stdout,
        stderr,
    })
}

fn approved_run(dir: &Path, fixture: &Fixture, name: &str, mode: HookMode, message: &str) -> Ran {
    hook_approve(dir, &fixture.path, name).unwrap();
    run(dir, fixture, name, mode, message).unwrap()
}

fn files_under(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, found: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let key = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if path.is_dir() {
                found.insert(format!("{key}/"), Vec::new());
                walk(base, &path, found);
            } else {
                found.insert(key, fs::read(&path).unwrap());
            }
        }
    }
    let mut found = BTreeMap::new();
    walk(root, root, &mut found);
    found
}

#[test]
fn lists_the_hooks_directory_without_samples_and_gives_each_inactive_hook_its_reason() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "exit 0", true);
    install(&fixture, "commit-msg", "exit 0", false);
    install(&fixture, "pre-commit.sample", "exit 0", true);
    install(&fixture, "deploy", "exit 0", true);

    let listed = hooks_list(dir.path(), &fixture.path).unwrap();

    assert_eq!(
        listed.directory,
        fixture.path.join(".git/hooks").to_string_lossy()
    );
    let summary: Vec<(&str, bool, Option<&str>)> = listed
        .hooks
        .iter()
        .map(|hook| (hook.name.as_str(), hook.active, hook.reason.as_deref()))
        .collect();
    assert_eq!(
        summary,
        vec![
            (
                "commit-msg",
                false,
                Some("Not executable: Git skips this hook")
            ),
            ("deploy", false, Some("Not a Git hook name")),
            ("pre-commit", true, None),
        ]
    );
    assert!(listed.hooks.iter().all(|hook| !hook.approved));
}

#[test]
fn follows_core_hooks_path_and_the_shared_directory_of_a_linked_worktree() {
    let (fixture, dir) = repository();
    let shared = fixture.path.join(".githooks");
    fs::create_dir_all(&shared).unwrap();
    fs::write(shared.join("pre-commit"), "#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(shared.join("pre-commit"), fs::Permissions::from_mode(0o755)).unwrap();
    install(&fixture, "post-commit", "exit 0", true);

    assert_eq!(
        hooks_list(dir.path(), &fixture.path).unwrap().hooks[0].name,
        "post-commit"
    );

    fixture.git(&["config", "core.hooksPath", ".githooks"]);
    let configured = hooks_list(dir.path(), &fixture.path).unwrap();
    assert_eq!(configured.directory, shared.to_string_lossy());
    assert_eq!(configured.hooks.len(), 1);
    assert_eq!(configured.hooks[0].name, "pre-commit");

    fixture.git(&["config", "--unset", "core.hooksPath"]);
    let linked = fixture.sibling("linked");
    fixture.git(&[
        "worktree",
        "add",
        "-q",
        linked.to_str().unwrap(),
        "-b",
        "side",
    ]);
    let from_linked = hooks_list(dir.path(), &linked).unwrap();
    assert_eq!(
        from_linked.directory,
        fixture.path.join(".git/hooks").to_string_lossy()
    );
    assert_eq!(from_linked.hooks[0].name, "post-commit");
}

#[test]
fn reads_the_script_with_its_path_and_state() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "echo checked", true);

    let script = hook_read(dir.path(), &fixture.path, "pre-commit").unwrap();

    assert_eq!(script.content, "#!/bin/sh\necho checked\n");
    assert!(!script.truncated);
    assert!(script.hook.path.ends_with(".git/hooks/pre-commit"));
    assert!(script.hook.active);
    assert!(hook_read(dir.path(), &fixture.path, "../config").is_err());
    assert!(hook_read(dir.path(), &fixture.path, "missing").is_err());
}

#[test]
fn refuses_to_run_before_approval_and_asks_again_after_the_script_changes() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "echo first", true);

    let refused = run(dir.path(), &fixture, "pre-commit", HookMode::Run, "").err();
    assert!(refused.unwrap().to_string().contains("approved"));

    let first = approved_run(dir.path(), &fixture, "pre-commit", HookMode::Run, "");
    assert_eq!(first.stdout, "first\n");
    assert!(hooks_list(dir.path(), &fixture.path).unwrap().hooks[0].approved);
    let again = run(dir.path(), &fixture, "pre-commit", HookMode::Test, "").unwrap();
    assert_eq!(again.outcome.exit_code, Some(0));

    install(&fixture, "pre-commit", "echo second", true);
    assert!(!hooks_list(dir.path(), &fixture.path).unwrap().hooks[0].approved);
    assert!(run(dir.path(), &fixture, "pre-commit", HookMode::Run, "").is_err());
    let second = approved_run(dir.path(), &fixture, "pre-commit", HookMode::Run, "");
    assert_eq!(second.stdout, "second\n");
}

#[test]
fn approval_is_kept_per_repository() {
    let (fixture, dir) = repository();
    let other = Fixture::init();
    other.identity();
    other.commit("a.txt", "a\n", "init");
    install(&fixture, "pre-commit", "exit 0", true);
    install(&other, "pre-commit", "exit 0", true);

    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();

    assert!(hooks_list(dir.path(), &fixture.path).unwrap().hooks[0].approved);
    assert!(!hooks_list(dir.path(), &other.path).unwrap().hooks[0].approved);
}

#[test]
fn refuses_an_inactive_hook_with_its_reason() {
    let (fixture, dir) = repository();
    install(&fixture, "commit-msg", "exit 0", false);
    install(&fixture, "deploy", "exit 0", true);

    for (name, reason) in [
        ("commit-msg", "Not executable: Git skips this hook"),
        ("deploy", "Not a Git hook name"),
    ] {
        assert!(hook_approve(dir.path(), &fixture.path, name)
            .unwrap_err()
            .to_string()
            .contains(reason));
        assert!(run(dir.path(), &fixture, name, HookMode::Run, "")
            .err()
            .unwrap()
            .to_string()
            .contains(reason));
    }
}

#[test]
fn run_executes_in_the_worktree_and_sees_the_staged_state() {
    let (fixture, dir) = repository();
    fixture.write("staged.txt", "staged\n");
    fixture.git(&["add", "staged.txt"]);
    fixture.write("README.md", "edited\n");
    install(
        &fixture,
        "pre-commit",
        "pwd; git diff --cached --name-only; echo problem >&2",
        true,
    );

    let ran = approved_run(dir.path(), &fixture, "pre-commit", HookMode::Run, "");

    assert_eq!(
        ran.stdout,
        format!("{}\nstaged.txt\n", fixture.path.display())
    );
    assert_eq!(ran.stderr, "problem\n");
    assert_eq!(ran.outcome.end, HookEnd::Exited);
    assert_eq!(ran.outcome.exit_code, Some(0));
    assert!(!ran.outcome.stops_git);
}

#[test]
fn gives_each_hook_the_arguments_git_would() {
    let (fixture, dir) = repository();
    let remote = fixture.add_bare_remote("origin.git");
    fixture.git(&["push", "-q", "-u", "origin", "main"]);
    install(&fixture, "commit-msg", "cat \"$1\"; echo \"args=$#\"", true);
    install(
        &fixture,
        "prepare-commit-msg",
        "cat \"$1\"; echo \"args=$#\"",
        true,
    );
    install(&fixture, "pre-push", "echo \"$1 $2 args=$#\"", true);
    install(&fixture, "post-checkout", "echo \"$1 $2 $3 args=$#\"", true);
    install(&fixture, "pre-commit", "echo \"args=$#\"", true);

    for name in ["commit-msg", "prepare-commit-msg"] {
        let ran = approved_run(
            dir.path(),
            &fixture,
            name,
            HookMode::Run,
            "Add things\n\nBody",
        );
        assert_eq!(ran.stdout, "Add things\n\nBody\nargs=1\n", "{name}");
    }
    let pushed = approved_run(dir.path(), &fixture, "pre-push", HookMode::Run, "");
    assert_eq!(
        pushed.stdout,
        format!("origin {} args=2\n", remote.display())
    );
    let checkout = approved_run(dir.path(), &fixture, "post-checkout", HookMode::Run, "");
    assert_eq!(checkout.stdout, "HEAD HEAD 1 args=3\n");
    let plain = approved_run(dir.path(), &fixture, "pre-commit", HookMode::Run, "");
    assert_eq!(plain.stdout, "args=0\n");
}

#[test]
fn pre_push_without_an_upstream_remote_says_why() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-push", "exit 0", true);
    hook_approve(dir.path(), &fixture.path, "pre-push").unwrap();

    let refused = run(dir.path(), &fixture, "pre-push", HookMode::Run, "").err();

    assert!(refused.unwrap().to_string().contains("no upstream remote"));
}

#[test]
fn reports_the_exit_code_and_whether_git_would_stop() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "exit 3", true);
    install(&fixture, "post-commit", "exit 1", true);

    let blocking = approved_run(dir.path(), &fixture, "pre-commit", HookMode::Run, "");
    assert_eq!(blocking.outcome.exit_code, Some(3));
    assert!(blocking.outcome.stops_git);
    let informative = approved_run(dir.path(), &fixture, "post-commit", HookMode::Run, "");
    assert_eq!(informative.outcome.exit_code, Some(1));
    assert!(!informative.outcome.stops_git);
}

#[test]
fn test_runs_in_a_temporary_worktree_with_every_change_and_leaves_the_repository_byte_identical() {
    let (fixture, dir) = repository();
    fixture.write("staged.txt", "staged\n");
    fixture.git(&["add", "staged.txt"]);
    fixture.write("README.md", "edited\n");
    fixture.write("untracked.txt", "new\n");
    install(
        &fixture,
        "pre-commit",
        "pwd\ngit diff --cached --name-only\ngit diff --name-only\ncat README.md untracked.txt\n\
         echo scribble > staged.txt\ngit add -A\ngit write-tree >/dev/null\nexit 7",
        true,
    );
    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();
    let before = files_under(&fixture.path);
    let status = fixture.git(&["status", "--porcelain=v2", "--branch"]);

    let ran = run(dir.path(), &fixture, "pre-commit", HookMode::Test, "").unwrap();

    assert_ne!(
        ran.stdout.lines().next().unwrap(),
        fixture.path.to_string_lossy()
    );
    let lines: Vec<&str> = ran.stdout.lines().skip(1).collect();
    assert_eq!(lines, vec!["staged.txt", "README.md", "edited", "new"]);
    assert_eq!(ran.outcome.exit_code, Some(7));
    assert!(ran.outcome.stops_git);
    assert_unchanged(&fixture.path, &before);
    assert_eq!(
        fixture.git(&["status", "--porcelain=v2", "--branch"]),
        status
    );
    assert_eq!(
        fixture
            .git(&["worktree", "list", "--porcelain"])
            .matches("worktree ")
            .count(),
        1
    );
    assert_eq!(fixture.read("README.md"), "edited\n");
}

#[test]
fn test_cleans_up_when_the_hook_cannot_start() {
    let (fixture, dir) = repository();
    let target = fixture.path.join(".git/hooks/pre-commit");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, "no interpreter line\n").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();
    let before = files_under(&fixture.path);

    let outcome = run(dir.path(), &fixture, "pre-commit", HookMode::Test, "");

    assert!(outcome.is_err() || outcome.unwrap().outcome.exit_code != Some(0));
    assert_unchanged(&fixture.path, &before);
    assert_eq!(
        fixture
            .git(&["worktree", "list", "--porcelain"])
            .matches("worktree ")
            .count(),
        1
    );
}

#[test]
fn test_does_not_run_other_hooks_while_creating_the_worktree() {
    let (fixture, dir) = repository();
    let marker = fixture.sibling("post-checkout-ran");
    install(
        &fixture,
        "post-checkout",
        &format!("touch {}", marker.display()),
        true,
    );
    install(&fixture, "pre-commit", "exit 0", true);

    approved_run(dir.path(), &fixture, "pre-commit", HookMode::Test, "");

    assert!(!marker.exists());
}

#[test]
fn test_needs_a_commit_to_copy() {
    let fixture = Fixture::init();
    fixture.identity();
    let dir = tempfile::tempdir().unwrap();
    install(&fixture, "pre-commit", "exit 0", true);
    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();

    let refused = run(dir.path(), &fixture, "pre-commit", HookMode::Test, "").err();

    assert!(refused.unwrap().to_string().contains("temporary worktree"));
    assert!(!fixture.path.join(".git/worktrees").exists());
}

fn assert_unchanged(root: &Path, before: &BTreeMap<String, Vec<u8>>) {
    let after = files_under(root);
    let changed: Vec<&String> = before
        .keys()
        .chain(after.keys())
        .filter(|key| before.get(*key) != after.get(*key))
        .collect();
    assert!(changed.is_empty(), "the repository changed: {changed:?}");
}

fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .output()
        .unwrap()
        .status
        .success()
}

#[test]
fn stop_kills_the_hook_and_everything_it_started() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "sleep 30 &\necho $!\nwait", true);
    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();
    let cancel = CancelToken::new();
    let seen = Arc::new(Mutex::new(String::new()));
    let watcher = {
        let (cancel, seen) = (cancel.clone(), Arc::clone(&seen));
        thread::spawn(move || {
            while seen.lock().unwrap().is_empty() {
                thread::sleep(Duration::from_millis(20));
            }
            cancel.cancel();
        })
    };
    let started = Instant::now();

    let outcome = run_hook(
        dir.path(),
        &fixture.path,
        "pre-commit",
        HookMode::Run,
        "",
        HOOK_LIMIT,
        &cancel,
        &mut |_, text| seen.lock().unwrap().push_str(text),
    )
    .unwrap();
    watcher.join().unwrap();

    assert_eq!(outcome.end, HookEnd::Stopped);
    assert!(!outcome.stops_git);
    assert!(started.elapsed() < Duration::from_secs(10));
    let pid = seen.lock().unwrap().trim().to_owned();
    thread::sleep(Duration::from_millis(200));
    assert!(!alive(&pid), "the background child {pid} survived Stop");
}

#[test]
fn stops_a_hook_that_outlives_the_time_limit_and_cleans_up_its_test_worktree() {
    let (fixture, dir) = repository();
    install(&fixture, "pre-commit", "sleep 30", true);
    hook_approve(dir.path(), &fixture.path, "pre-commit").unwrap();
    let before = files_under(&fixture.path);
    let started = Instant::now();

    let outcome = run_hook(
        dir.path(),
        &fixture.path,
        "pre-commit",
        HookMode::Test,
        "",
        Duration::from_millis(400),
        &CancelToken::new(),
        &mut |_, _| {},
    )
    .unwrap();

    assert_eq!(outcome.end, HookEnd::TimedOut);
    assert_eq!(outcome.exit_code, None);
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_unchanged(&fixture.path, &before);
    assert_eq!(HOOK_LIMIT, Duration::from_secs(120));
}
