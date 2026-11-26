mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use common::Fixture;
use yforge_core::{
    collect_activity, commit, optional_hooks, push_to, stage_all, CancelToken, ErrorKind,
    HookOperation, OptionalHook,
};

const ORGANIZATION: &str = r#"[hook "org-scan"]
	event = pre-commit
	event = pre-push
	command = printf 'org-scan\n' >> ../runs
[hook "org-lint"]
	event = pre-commit
	command = printf 'org-lint\n' >> ../runs
[yforge]
	mandatoryHook = org-scan
	optionalHook = org-lint
"#;

fn organization_config() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let directory = Box::leak(Box::new(tempfile::tempdir().unwrap()));
        let file = directory.path().join("organization.gitconfig");
        fs::write(&file, ORGANIZATION).unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        file
    })
}

fn hook(fixture: &Fixture, name: &str, event: &str, body: &str) {
    fixture.git(&["config", "--add", &format!("hook.{name}.event"), event]);
    fixture.git(&[
        "config",
        &format!("hook.{name}.command"),
        &format!("printf '{name}\\n' >> ../runs; {body}"),
    ]);
}

fn script(fixture: &Fixture, event: &str) {
    let target = fixture.path.join(".git/hooks").join(event);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(
        &target,
        format!("#!/bin/sh\nprintf 'dir-{event}\\n' >> ../runs\n"),
    )
    .unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
}

fn policy(fixture: &Fixture, optional: &[&str], mandatory: &[&str]) {
    for name in optional {
        fixture.git(&["config", "--add", "yforge.optionalHook", name]);
    }
    for name in mandatory {
        fixture.git(&["config", "--add", "yforge.mandatoryHook", name]);
    }
}

fn repository() -> Fixture {
    organization_config();
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    hook(&fixture, "lint", "pre-commit", "true");
    hook(&fixture, "scan", "pre-commit", "true");
    hook(&fixture, "audit", "commit-msg", "true");
    hook(&fixture, "off", "pre-commit", "true");
    fixture.git(&["config", "hook.off.enabled", "false"]);
    hook(&fixture, "push-lint", "pre-push", "true");
    hook(&fixture, "push-scan", "pre-push", "true");
    script(&fixture, "pre-commit");
    script(&fixture, "pre-push");
    policy(
        &fixture,
        &["lint", "scan", "off", "push-lint", "org-scan"],
        &["scan", "push-scan"],
    );
    fixture
}

fn runs(fixture: &Fixture) -> Vec<String> {
    let mut lines: Vec<String> = fs::read_to_string(fixture.sibling("runs"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    lines.sort();
    lines
}

fn configuration(fixture: &Fixture) -> (Vec<u8>, Vec<u8>) {
    (
        fs::read(fixture.path.join(".git/config")).unwrap(),
        fs::read(organization_config()).unwrap(),
    )
}

fn names(list: &[OptionalHook]) -> Vec<(&str, Vec<&str>)> {
    list.iter()
        .map(|hook| {
            (
                hook.name.as_str(),
                hook.events.iter().map(String::as_str).collect(),
            )
        })
        .collect()
}

fn skip(list: &[&str]) -> Vec<String> {
    list.iter().map(|name| (*name).to_owned()).collect()
}

fn staged_change(fixture: &Fixture) {
    fixture.write("README.md", "two\n");
    stage_all(&fixture.path).unwrap();
}

fn publishable() -> (Fixture, PathBuf) {
    let fixture = repository();
    let remote = fixture.add_bare_remote("remote.git");
    fixture.commit("work.txt", "w\n", "Work");
    fs::remove_file(fixture.sibling("runs")).unwrap();
    (fixture, remote)
}

fn remote_head(remote: &Path, branch: &str) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(remote)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ])
        .output()
        .unwrap();
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[test]
fn lists_only_enabled_configured_hooks_that_policy_confirms_optional() {
    let fixture = repository();

    let commit_hooks = optional_hooks(&fixture.path, HookOperation::Commit).unwrap();
    let push_hooks = optional_hooks(&fixture.path, HookOperation::Push).unwrap();

    assert_eq!(
        names(&commit_hooks),
        vec![
            ("lint", vec!["pre-commit"]),
            ("org-lint", vec!["pre-commit"])
        ]
    );
    assert_eq!(names(&push_hooks), vec![("push-lint", vec!["pre-push"])]);
}

#[test]
fn a_hook_without_a_policy_entry_is_not_optional() {
    organization_config();
    let fixture = Fixture::init();
    fixture.identity();
    fixture.commit("README.md", "one\n", "init");
    hook(&fixture, "lint", "pre-commit", "true");
    script(&fixture, "pre-push");

    assert_eq!(
        names(&optional_hooks(&fixture.path, HookOperation::Commit).unwrap()),
        vec![("org-lint", vec!["pre-commit"])]
    );
    assert!(optional_hooks(&fixture.path, HookOperation::Push)
        .unwrap()
        .is_empty());
}

#[test]
fn a_commit_skips_only_the_confirmed_optional_hooks_and_runs_the_rest() {
    let fixture = repository();
    staged_change(&fixture);
    let before = configuration(&fixture);

    let (result, records) = collect_activity(|| {
        commit(
            &fixture.path,
            "Skip lint",
            "",
            false,
            &skip(&["lint", "org-lint"]),
        )
    });

    let sha = result.unwrap();
    assert_eq!(sha, fixture.git(&["rev-parse", "HEAD"]));
    assert_eq!(
        runs(&fixture),
        ["audit", "dir-pre-commit", "org-scan", "scan"]
    );
    let command = records
        .iter()
        .map(|record| record.command.as_str())
        .find(|command| command.contains(" commit "))
        .expect("the commit is recorded");
    assert!(
        command
            .starts_with("git -c hook.lint.enabled=false -c hook.org-lint.enabled=false commit "),
        "{command}"
    );
    assert_eq!(configuration(&fixture), before);
    assert!(!fixture.git(&["config", "--list"]).contains("hookspath"));
}

#[test]
fn a_commit_without_skips_runs_every_hook() {
    let fixture = repository();
    staged_change(&fixture);

    commit(&fixture.path, "All hooks", "", false, &[]).unwrap();

    assert_eq!(
        runs(&fixture),
        [
            "audit",
            "dir-pre-commit",
            "lint",
            "org-lint",
            "org-scan",
            "scan"
        ]
    );
}

#[test]
fn a_failing_mandatory_hook_still_stops_a_commit_that_skips_optional_hooks() {
    let fixture = repository();
    fixture.git(&[
        "config",
        "hook.scan.command",
        "printf 'scan\\n' >> ../runs; exit 1",
    ]);
    staged_change(&fixture);
    let head = fixture.git(&["rev-parse", "HEAD"]);
    let before = configuration(&fixture);

    let error = commit(&fixture.path, "Blocked", "", false, &skip(&["lint"])).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::CommitFailed);
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert!(runs(&fixture).contains(&"scan".to_owned()));
    assert!(!runs(&fixture).contains(&"lint".to_owned()));
    assert_eq!(configuration(&fixture), before);
}

#[test]
fn refuses_to_skip_a_mandatory_or_unclassified_hook_and_runs_nothing() {
    let fixture = repository();
    staged_change(&fixture);
    let head = fixture.git(&["rev-parse", "HEAD"]);

    for name in [
        "scan",
        "audit",
        "org-scan",
        "off",
        "dir-pre-commit",
        "missing",
    ] {
        let error = commit(&fixture.path, "Refused", "", false, &skip(&[name])).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{name}");
    }

    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head);
    assert!(runs(&fixture).is_empty());
}

#[test]
fn a_push_skips_optional_pre_push_hooks_and_runs_mandatory_and_unclassified_ones() {
    let (fixture, remote) = publishable();
    let before = configuration(&fixture);

    let (result, records) = collect_activity(|| {
        push_to(
            &fixture.path,
            "origin",
            "main",
            false,
            &skip(&["push-lint"]),
            &CancelToken::new(),
            &mut |_| {},
        )
    });

    result.unwrap();
    assert_eq!(
        remote_head(&remote, "main"),
        Some(fixture.git(&["rev-parse", "HEAD"]))
    );
    assert_eq!(runs(&fixture), ["dir-pre-push", "org-scan", "push-scan"]);
    assert!(records.iter().any(|record| record
        .command
        .starts_with("git -c hook.push-lint.enabled=false push ")));
    assert_eq!(configuration(&fixture), before);
}

#[test]
fn a_failing_mandatory_pre_push_hook_still_stops_a_push_that_skips_optional_hooks() {
    let (fixture, remote) = publishable();
    fixture.git(&[
        "config",
        "hook.push-scan.command",
        "printf 'push-scan\\n' >> ../runs; exit 1",
    ]);
    let before = configuration(&fixture);

    let error = push_to(
        &fixture.path,
        "origin",
        "main",
        true,
        &skip(&["push-lint"]),
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert_eq!(remote_head(&remote, "main"), None);
    assert_eq!(runs(&fixture), ["dir-pre-push", "org-scan", "push-scan"]);
    assert_eq!(configuration(&fixture), before);
}

#[test]
fn refuses_to_skip_a_hook_that_is_not_optional_for_a_push() {
    let (fixture, remote) = publishable();

    for name in ["push-scan", "lint", "org-scan"] {
        let error = push_to(
            &fixture.path,
            "origin",
            "main",
            true,
            &skip(&[name]),
            &CancelToken::new(),
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{name}");
    }

    assert_eq!(remote_head(&remote, "main"), None);
    assert!(runs(&fixture).is_empty());
}
