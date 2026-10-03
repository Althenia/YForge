mod common;

use common::Fixture;
use yforge_core::{
    capture_state, compose_apply, plan_compose, undo, ComposeGroup, ErrorKind, Planned,
};

fn group(message: &str, files: &[&str]) -> ComposeGroup {
    ComposeGroup {
        message: message.to_owned(),
        files: files.iter().map(|file| (*file).to_owned()).collect(),
    }
}

fn mixed_changes() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.write("a.txt", "a\n");
    repo.write("b.txt", "b\n");
    repo.write("c.txt", "c\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.write("a.txt", "a edited\n");
    repo.write("b.txt", "b staged\n");
    repo.git(&["add", "b.txt"]);
    repo.write("b.txt", "b staged then edited\n");
    repo.write("c.txt", "c staged\n");
    repo.git(&["add", "c.txt"]);
    repo.write("c.txt", "c staged then edited\n");
    repo.write("d.txt", "d new\n");
    repo
}

fn head(repo: &Fixture) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn changed_in(repo: &Fixture, revision: &str) -> String {
    repo.git(&["show", "--name-only", "--format=", revision])
}

#[test]
fn each_group_becomes_one_commit_with_exactly_its_files_working_tree_content() {
    let repo = mixed_changes();
    let base = head(&repo);

    let created = compose_apply(
        &repo.path,
        &[
            group("Edit a and add d\n\nBody.", &["a.txt", "d.txt"]),
            group("Edit b", &["b.txt"]),
        ],
    )
    .unwrap();

    assert_eq!(created.len(), 2);
    assert_eq!(created[1], head(&repo));
    assert_eq!(repo.git(&["rev-parse", "HEAD~1"]), created[0]);
    assert_eq!(repo.git(&["rev-parse", "HEAD~2"]), base);
    assert_eq!(changed_in(&repo, "HEAD~1"), "a.txt\nd.txt");
    assert_eq!(changed_in(&repo, "HEAD"), "b.txt");
    assert_eq!(
        repo.git(&["log", "-1", "--format=%B", "HEAD~1"]),
        "Edit a and add d\n\nBody."
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Edit b");
    assert_eq!(repo.git(&["show", "HEAD:b.txt"]), "b staged then edited");
    assert_eq!(repo.git(&["show", "HEAD:d.txt"]), "d new");
    assert_eq!(repo.git(&["status", "--porcelain"]), "MM c.txt");
    assert_eq!(repo.git(&["show", ":c.txt"]), "c staged");
    assert_eq!(repo.read("c.txt"), "c staged then edited\n");
}

#[test]
fn undo_returns_head_to_before_the_compose_and_keeps_every_change() {
    let repo = mixed_changes();
    let base = head(&repo);
    let before = capture_state(&repo.path).unwrap();
    compose_apply(
        &repo.path,
        &[
            group("A", &["a.txt"]),
            group("B and D", &["b.txt", "d.txt"]),
        ],
    )
    .unwrap();
    let after = capture_state(&repo.path).unwrap();

    let Planned::Available(plan) = plan_compose(&before, &after, 2) else {
        panic!("compose has an undo");
    };
    assert!(plan.scope.contains("2 commits"), "{}", plan.scope);
    undo(&repo.path, &plan.action).unwrap();

    assert_eq!(head(&repo), base);
    assert_eq!(repo.read("a.txt"), "a edited\n");
    assert_eq!(repo.read("b.txt"), "b staged then edited\n");
    assert_eq!(repo.read("c.txt"), "c staged then edited\n");
    assert_eq!(repo.read("d.txt"), "d new\n");
}

#[test]
fn a_failing_commit_rolls_back_head_and_the_index() {
    let repo = mixed_changes();
    let base = head(&repo);
    let status = repo.git(&["status", "--porcelain"]);
    let hook = repo.path.join(".git/hooks/commit-msg");
    std::fs::write(
        &hook,
        "#!/bin/sh\ngrep -q Refuse \"$1\" && exit 1\nexit 0\n",
    )
    .unwrap();
    let mut permissions = std::fs::metadata(&hook).unwrap().permissions();
    std::os::unix::fs::PermissionsExt::set_mode(&mut permissions, 0o755);
    std::fs::set_permissions(&hook, permissions).unwrap();

    let error = compose_apply(
        &repo.path,
        &[group("Fine", &["a.txt"]), group("Refuse this", &["d.txt"])],
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::CommitFailed);
    assert_eq!(head(&repo), base);
    assert_eq!(repo.git(&["status", "--porcelain"]), status);
    assert_eq!(repo.git(&["show", ":b.txt"]), "b staged");
}

#[test]
fn invalid_groups_are_refused_before_anything_changes() {
    let repo = mixed_changes();
    let base = head(&repo);
    let status = repo.git(&["status", "--porcelain"]);

    for groups in [
        vec![],
        vec![group(" ", &["a.txt"])],
        vec![group("Empty", &[])],
        vec![group("A", &["a.txt"]), group("A again", &["a.txt"])],
        vec![group("Clean", &["unchanged.txt"])],
    ] {
        let error = compose_apply(&repo.path, &groups).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{groups:?}");
    }

    assert_eq!(head(&repo), base);
    assert_eq!(repo.git(&["status", "--porcelain"]), status);
}
