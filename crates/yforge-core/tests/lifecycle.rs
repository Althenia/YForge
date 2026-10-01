mod common;

use std::fs;
use std::path::PathBuf;

use common::Fixture;
use yforge_core::{
    clone_repository, init_repository, publish, repo_snapshot, CancelToken, CloneOptions,
    ErrorKind, Head, Progress,
};

fn source() -> (Fixture, String) {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let url = format!("file://{}", remote.display());
    (repo, url)
}

/// Pushes so the bare remote's main carries the commits, for the shallow-clone cases.
fn source_with_three_commits() -> (Fixture, String) {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.commit("b.txt", "two\n", "Second");
    repo.commit("c.txt", "three\n", "Third");
    repo.git(&["push", "-q", "origin", "main"]);
    let url = format!("file://{}", remote.display());
    (repo, url)
}

#[test]
fn clone_from_a_bare_repository_reports_progress_and_returns_the_opened_root() {
    let (repo, url) = source();
    let destination = repo.sibling("nested/cloned");
    let mut phases = Vec::new();

    let root = clone_repository(
        &url,
        &destination,
        &CloneOptions::default(),
        &CancelToken::new(),
        &mut |progress: Progress| phases.push(progress.phase),
    )
    .unwrap();

    assert_eq!(
        fs::canonicalize(&root).unwrap(),
        fs::canonicalize(&destination).unwrap()
    );
    assert!(
        phases.iter().any(|phase| phase == "Receiving objects"),
        "{phases:?}"
    );
    let snapshot = repo_snapshot(&destination).unwrap();
    assert!(matches!(snapshot.head, Head::Branch { ref name, .. } if name == "main"));
    assert_eq!(snapshot.remotes, ["origin"]);
    assert_eq!(
        fs::read_to_string(destination.join("a.txt")).unwrap(),
        "one\n"
    );
}

#[test]
fn cancelling_a_clone_removes_the_partial_folder() {
    let (repo, url) = source();
    let destination = repo.sibling("cancelled");
    let token = CancelToken::new();
    token.cancel();

    let error = clone_repository(
        &url,
        &destination,
        &CloneOptions::default(),
        &token,
        &mut |_| {},
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled);
    assert!(!destination.exists());
}

#[test]
fn a_failed_clone_into_an_empty_existing_folder_leaves_the_folder_empty() {
    let (repo, _) = source();
    let destination = repo.sibling("empty-target");
    fs::create_dir(&destination).unwrap();

    let error = clone_repository(
        &format!("file://{}", repo.sibling("missing.git").display()),
        &destination,
        &CloneOptions::default(),
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed, "{error:?}");
    assert!(destination.is_dir());
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
}

#[test]
fn clone_refuses_a_non_empty_destination_and_an_unrecognised_address() {
    let (repo, url) = source();
    let destination = repo.sibling("occupied");
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep.txt"), "keep").unwrap();

    let occupied = clone_repository(
        &url,
        &destination,
        &CloneOptions::default(),
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap_err();
    let malformed = clone_repository(
        "not a url",
        &repo.sibling("x"),
        &CloneOptions::default(),
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap_err();

    assert_eq!(occupied.kind(), ErrorKind::InvalidRequest);
    assert!(occupied
        .to_string()
        .contains("already exists and is not empty"));
    assert_eq!(malformed.kind(), ErrorKind::InvalidRequest);
    assert_eq!(
        fs::read_to_string(destination.join("keep.txt")).unwrap(),
        "keep"
    );
}

#[test]
fn a_shallow_clone_carries_only_the_latest_commit_of_one_branch() {
    let (repo, url) = source_with_three_commits();
    let depth = repo.sibling("shallow");

    let root = clone_repository(
        &url,
        &depth,
        &CloneOptions {
            shallow: true,
            sparse: false,
        },
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();
    let root = PathBuf::from(root);

    assert!(
        root.join(".git/shallow").exists(),
        "root={}",
        root.display()
    );
    let commits = std::process::Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["rev-list", "--count", "HEAD"])
        .output()
        .expect("git rev-list");
    assert_eq!(String::from_utf8_lossy(&commits.stdout).trim(), "1");
    let snapshot = repo_snapshot(&root).unwrap_or_else(|error| {
        panic!(
            "snapshot of a shallow clone at {}: {error:?}",
            root.display()
        )
    });
    assert_eq!(snapshot.remotes, ["origin"]);
    assert_eq!(fs::read_to_string(root.join("c.txt")).unwrap(), "three\n");
}

#[test]
fn a_sparse_clone_leaves_the_working_tree_unchecked_out() {
    let (repo, url) = source();
    let sparse = repo.sibling("sparse");

    clone_repository(
        &url,
        &sparse,
        &CloneOptions {
            shallow: false,
            sparse: true,
        },
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();

    assert!(!sparse.join("a.txt").exists());
    let snapshot = repo_snapshot(&sparse).unwrap();
    assert!(matches!(snapshot.head, Head::Branch { ref name, .. } if name == "main"));
}

#[test]
fn clone_errors_never_echo_credentials_from_the_address() {
    let (repo, _) = source();

    let error = clone_repository(
        "https://yui:hunter2@127.0.0.1:9/repo.git",
        &repo.sibling("secret-target"),
        &CloneOptions::default(),
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap_err();

    assert!(!format!("{error:?}").contains("hunter2"), "{error:?}");
}

#[test]
fn init_creates_an_unborn_repository_on_the_default_branch() {
    let (repo, _) = source();
    let path = repo.sibling("fresh/project");

    let root = init_repository(&path, "trunk").unwrap();

    assert_eq!(
        fs::canonicalize(&root).unwrap(),
        fs::canonicalize(&path).unwrap()
    );
    let snapshot = repo_snapshot(&path).unwrap();
    assert!(matches!(snapshot.head, Head::Unborn { ref branch } if branch == "trunk"));
}

#[test]
fn init_refuses_an_existing_repository_and_an_invalid_branch_name() {
    let (repo, _) = source();
    let existing = init_repository(&repo.path, "main").unwrap_err();
    let invalid = init_repository(&repo.sibling("other"), "bad name").unwrap_err();

    assert_eq!(existing.kind(), ErrorKind::AlreadyARepository);
    assert_eq!(invalid.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn publish_pushes_the_first_commit_to_the_chosen_remote_with_an_upstream() {
    let (repo, _) = source();
    let path = repo.sibling("first");
    init_repository(&path, "main").unwrap();
    let remote = repo.sibling("chosen.git");
    repo.run_in(
        &repo.sibling(""),
        &[
            "init",
            "-q",
            "--bare",
            "-b",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    repo.run_in(&path, &["remote", "add", "decoy", "file:///nonexistent"]);
    repo.run_in(
        &path,
        &["remote", "add", "chosen", remote.to_str().unwrap()],
    );

    let before = publish(&path, "chosen", &CancelToken::new(), &mut |_| {}).unwrap_err();
    repo.commit_in(&path, "a.txt", "one\n", "First");
    publish(&path, "chosen", &CancelToken::new(), &mut |_| {}).unwrap();

    assert_eq!(before.kind(), ErrorKind::InvalidRequest);
    let snapshot = repo_snapshot(&path).unwrap();
    assert_eq!(
        snapshot.upstream.map(|upstream| upstream.name),
        Some("chosen/main".to_owned())
    );
    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/main"]),
        repo.run_in(&path, &["rev-parse", "HEAD"])
    );
}
