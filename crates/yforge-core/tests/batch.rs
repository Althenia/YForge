mod common;

use common::Fixture;
use yforge_core::{
    delete_branches, delete_tags, drop_stashes, repo_snapshot, stash_push, ErrorKind, StashTarget,
};

fn ready() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo
}

fn names(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

fn unmerged(repo: &Fixture, branch: &str) {
    repo.git(&["switch", "-q", "-c", branch]);
    repo.commit(&format!("{branch}.txt"), "x\n", &format!("{branch} work"));
    repo.git(&["switch", "-q", "main"]);
}

#[test]
fn deleting_branches_in_one_call_removes_each_and_names_them() {
    let repo = ready();
    for branch in ["one", "two", "three"] {
        repo.git(&["branch", branch]);
    }

    let outcome = delete_branches(&repo.path, &names(&["one", "two", "three"]), &[]).unwrap();

    assert_eq!(outcome.done, ["one", "two", "three"]);
    assert!(outcome.failed.is_empty());
    assert_eq!(repo_snapshot(&repo.path).unwrap().branches, ["main"]);
}

#[test]
fn a_refused_branch_is_reported_and_the_others_are_still_deleted() {
    let repo = ready();
    repo.git(&["branch", "merged"]);
    unmerged(&repo, "topic");
    repo.git(&["branch", "spare"]);

    let outcome = delete_branches(&repo.path, &names(&["merged", "topic", "spare"]), &[]).unwrap();

    assert_eq!(outcome.done, ["merged", "spare"]);
    assert_eq!(outcome.failed.len(), 1);
    assert_eq!(outcome.failed[0].name, "topic");
    assert!(
        outcome.failed[0].reason.contains("topic"),
        "{:?}",
        outcome.failed[0]
    );
    assert_eq!(
        repo_snapshot(&repo.path).unwrap().branches,
        ["main", "topic"]
    );
}

#[test]
fn only_the_branches_named_as_forced_lose_unmerged_commits() {
    let repo = ready();
    unmerged(&repo, "topic");
    unmerged(&repo, "other");

    let outcome =
        delete_branches(&repo.path, &names(&["topic", "other"]), &names(&["topic"])).unwrap();

    assert_eq!(outcome.done, ["topic"]);
    assert_eq!(outcome.failed[0].name, "other");
}

#[test]
fn when_every_branch_is_refused_the_first_error_is_returned() {
    let repo = ready();
    unmerged(&repo, "topic");

    let error = delete_branches(&repo.path, &names(&["topic", "ghost"]), &[]).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::UnmergedBranch);
}

#[test]
fn an_empty_selection_is_an_invalid_request() {
    let repo = ready();

    for error in [
        delete_branches(&repo.path, &[], &[]).unwrap_err(),
        delete_tags(&repo.path, &[]).unwrap_err(),
        drop_stashes(&repo.path, &[]).unwrap_err(),
    ] {
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
}

#[test]
fn deleting_tags_in_one_call_reports_the_unknown_one_and_deletes_the_rest() {
    let repo = ready();
    repo.git(&["tag", "v1"]);
    repo.git(&["tag", "v2"]);

    let outcome = delete_tags(&repo.path, &names(&["v1", "ghost", "v2"])).unwrap();

    assert_eq!(outcome.done, ["v1", "v2"]);
    assert_eq!(outcome.failed.len(), 1);
    assert_eq!(outcome.failed[0].name, "ghost");
    assert!(repo.git(&["tag", "--list"]).is_empty());
}

#[test]
fn dropping_stashes_works_from_the_highest_index_so_each_one_is_still_where_it_was_listed() {
    let repo = ready();
    for message in ["first", "second", "third"] {
        repo.write("a.txt", &format!("{message}\n"));
        stash_push(&repo.path, message, false).unwrap();
    }
    let listed = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(listed.len(), 3);
    let target = |index: usize| StashTarget {
        index: listed[index].index,
        sha: listed[index].sha.clone(),
    };

    let outcome = drop_stashes(&repo.path, &[target(0), target(2)]).unwrap();

    assert_eq!(outcome.failed.len(), 0, "{:?}", outcome.failed);
    assert_eq!(outcome.done.len(), 2);
    let remaining = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].sha, listed[1].sha);
}
