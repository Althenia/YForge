mod common;

use std::path::{Path, PathBuf};

use common::Fixture;
use yforge_core::{
    create_tag, delete_remote_tag, delete_tag, push_tag, CancelToken, ErrorKind, Progress,
};

fn none() -> impl FnMut(Progress) {
    |_| {}
}

fn with_remote() -> (Fixture, PathBuf, String) {
    let repo = Fixture::init();
    repo.identity();
    let first = repo.commit("a.txt", "one\n", "First");
    repo.commit("a.txt", "two\n", "Second");
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    (repo, remote, first)
}

fn remote_has(repo: &Fixture, remote: &Path, tag: &str) -> bool {
    !repo.run_in(remote, &["tag", "--list", tag]).is_empty()
}

#[test]
fn a_lightweight_tag_points_at_the_given_commit() {
    let (repo, _, first) = with_remote();

    create_tag(&repo.path, "v0.1", Some(&first), None).unwrap();

    assert_eq!(repo.git(&["rev-parse", "v0.1^{commit}"]), first);
    assert_eq!(repo.git(&["cat-file", "-t", "v0.1"]), "commit");
}

#[test]
fn a_tag_can_start_at_a_full_ref_name() {
    let (repo, _, first) = with_remote();
    repo.git(&["tag", "old", &first]);

    create_tag(&repo.path, "copy", Some("refs/tags/old"), None).unwrap();
    create_tag(&repo.path, "tip", Some("refs/heads/main"), None).unwrap();

    assert_eq!(repo.git(&["rev-parse", "copy^{commit}"]), first);
    assert_eq!(
        repo.git(&["rev-parse", "tip^{commit}"]),
        repo.git(&["rev-parse", "HEAD"])
    );
}

#[test]
fn an_annotated_tag_defaults_to_head_and_stores_its_message() {
    let (repo, _, _) = with_remote();

    create_tag(&repo.path, "v1.0", None, Some("  Release one  ")).unwrap();

    assert_eq!(repo.git(&["cat-file", "-t", "v1.0"]), "tag");
    assert_eq!(
        repo.git(&["rev-parse", "v1.0^{commit}"]),
        repo.git(&["rev-parse", "HEAD"])
    );
    assert_eq!(
        repo.git(&["tag", "--list", "--format=%(contents:subject)", "v1.0"]),
        "Release one"
    );
}

#[test]
fn tag_creation_rejects_bad_input_without_creating_anything() {
    let (repo, _, _) = with_remote();
    create_tag(&repo.path, "v1", None, None).unwrap();

    for (name, at, message) in [
        ("v1", None, None),
        ("", None, None),
        ("bad name", None, None),
        ("v2", None, Some("  ")),
        ("v3", Some("deadbeef"), None),
        ("v4", Some("not-a-sha"), None),
    ] {
        let error = create_tag(&repo.path, name, at, message).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{name:?}");
    }
    assert_eq!(repo.git(&["tag", "--list"]), "v1");
}

#[test]
fn pushing_a_tag_publishes_only_that_tag() {
    let (repo, remote, _) = with_remote();
    create_tag(&repo.path, "v1", None, None).unwrap();
    create_tag(&repo.path, "v2", None, None).unwrap();

    push_tag(&repo.path, "origin", "v1", &CancelToken::new(), &mut none()).unwrap();

    assert!(remote_has(&repo, &remote, "v1"));
    assert!(!remote_has(&repo, &remote, "v2"));
}

#[test]
fn pushing_needs_a_known_remote_and_an_existing_tag() {
    let (repo, _, _) = with_remote();
    create_tag(&repo.path, "v1", None, None).unwrap();

    for (remote, tag) in [("elsewhere", "v1"), ("origin", "missing")] {
        let error =
            push_tag(&repo.path, remote, tag, &CancelToken::new(), &mut none()).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
}

#[test]
fn deleting_a_local_tag_leaves_the_remote_copy() {
    let (repo, remote, _) = with_remote();
    create_tag(&repo.path, "v1", None, None).unwrap();
    push_tag(&repo.path, "origin", "v1", &CancelToken::new(), &mut none()).unwrap();

    delete_tag(&repo.path, "v1").unwrap();

    assert_eq!(repo.git(&["tag", "--list"]), "");
    assert!(remote_has(&repo, &remote, "v1"));
    assert_eq!(
        delete_tag(&repo.path, "v1").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn deleting_a_remote_tag_leaves_the_local_copy() {
    let (repo, remote, _) = with_remote();
    create_tag(&repo.path, "v1", None, None).unwrap();
    push_tag(&repo.path, "origin", "v1", &CancelToken::new(), &mut none()).unwrap();

    delete_remote_tag(&repo.path, "origin", "v1", &CancelToken::new(), &mut none()).unwrap();

    assert!(!remote_has(&repo, &remote, "v1"));
    assert_eq!(repo.git(&["tag", "--list"]), "v1");
}
