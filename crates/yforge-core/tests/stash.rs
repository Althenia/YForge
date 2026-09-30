mod common;

use common::Fixture;
use yforge_core::{
    repo_snapshot, stash_apply, stash_drop, stash_pop, stash_push, stash_rename, ErrorKind,
    StashRestore,
};

fn dirty() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.write("a.txt", "edited\n");
    repo
}

fn only_stash(repo: &Fixture) -> (u32, String) {
    let stashes = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(stashes.len(), 1);
    (stashes[0].index, stashes[0].sha.clone())
}

#[test]
fn stashing_saves_the_changes_with_the_message_and_cleans_the_tree() {
    let repo = dirty();

    stash_push(&repo.path, "  half done  ", false).unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.stashes.len(), 1);
    assert_eq!(snapshot.stashes[0].message, "On main: half done");
    assert_eq!(snapshot.counts.total(), 0);
    assert_eq!(repo.read("a.txt"), "one\n");
}

#[test]
fn untracked_files_are_stashed_only_when_requested() {
    let repo = dirty();
    repo.write("scratch.txt", "new\n");

    stash_push(&repo.path, "", false).unwrap();
    let after = repo_snapshot(&repo.path).unwrap();
    assert_eq!(after.counts.untracked, 1);
    assert_eq!(after.counts.modified, 0);
    assert!(after.stashes[0].message.starts_with("WIP on main"));

    repo.write("a.txt", "edited again\n");
    stash_push(&repo.path, "with untracked", true).unwrap();
    let after = repo_snapshot(&repo.path).unwrap();
    assert_eq!(after.counts.total(), 0);
    assert_eq!(after.stashes.len(), 2);
}

#[test]
fn stashing_a_clean_tree_is_an_invalid_request() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");

    let error = stash_push(&repo.path, "nothing", false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn apply_keeps_the_stash_and_pop_removes_it() {
    let repo = dirty();
    stash_push(&repo.path, "work", false).unwrap();
    let (index, sha) = only_stash(&repo);

    assert_eq!(
        stash_apply(&repo.path, index, &sha).unwrap(),
        StashRestore::Applied
    );
    assert_eq!(repo.read("a.txt"), "edited\n");
    assert_eq!(repo_snapshot(&repo.path).unwrap().stashes.len(), 1);

    repo.git(&["checkout", "--", "a.txt"]);
    assert_eq!(
        stash_pop(&repo.path, index, &sha).unwrap(),
        StashRestore::Applied
    );
    assert_eq!(repo.read("a.txt"), "edited\n");
    assert!(repo_snapshot(&repo.path).unwrap().stashes.is_empty());
}

#[test]
fn a_pop_that_conflicts_reports_conflicts_and_keeps_the_stash() {
    let repo = dirty();
    stash_push(&repo.path, "work", false).unwrap();
    let (index, sha) = only_stash(&repo);
    repo.commit("a.txt", "committed elsewhere\n", "Diverge");

    let restored = stash_pop(&repo.path, index, &sha).unwrap();

    assert_eq!(restored, StashRestore::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.counts.conflicted, 1);
    assert_eq!(snapshot.stashes.len(), 1);
}

#[test]
fn drop_removes_only_the_listed_stash() {
    let repo = dirty();
    stash_push(&repo.path, "older", false).unwrap();
    repo.write("a.txt", "newer edit\n");
    stash_push(&repo.path, "newer", false).unwrap();
    let stashes = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(stashes[0].message, "On main: newer");

    stash_drop(&repo.path, stashes[1].index, &stashes[1].sha).unwrap();

    let remaining = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].message, "On main: newer");
}

#[test]
fn a_stash_whose_position_changed_is_refused() {
    let repo = dirty();
    stash_push(&repo.path, "older", false).unwrap();
    let (index, sha) = only_stash(&repo);
    repo.write("a.txt", "newer edit\n");
    stash_push(&repo.path, "newer", false).unwrap();

    for result in [
        stash_drop(&repo.path, index, &sha),
        stash_pop(&repo.path, index, &sha).map(drop),
        stash_apply(&repo.path, index, &sha).map(drop),
    ] {
        assert_eq!(result.unwrap_err().kind(), ErrorKind::InvalidRequest);
    }
    assert_eq!(repo_snapshot(&repo.path).unwrap().stashes.len(), 2);
}

#[test]
fn renaming_a_stash_keeps_its_commit_and_moves_it_to_the_top_shifting_the_newer_entries() {
    let repo = dirty();
    stash_push(&repo.path, "older", false).unwrap();
    repo.write("a.txt", "newer edit\n");
    stash_push(&repo.path, "newer", false).unwrap();
    let before = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(
        before
            .iter()
            .map(|entry| entry.message.as_str())
            .collect::<Vec<_>>(),
        ["On main: newer", "On main: older"]
    );

    stash_rename(&repo.path, before[1].index, &before[1].sha, "  renamed  ").unwrap();

    let after = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(after.len(), 2);
    assert_eq!(
        (after[0].index, after[0].sha.as_str()),
        (0, before[1].sha.as_str())
    );
    assert_eq!(after[0].message, "On main: renamed");
    assert_eq!(
        (after[1].index, after[1].sha.as_str()),
        (1, before[0].sha.as_str())
    );
    assert_eq!(after[1].message, "On main: newer");
}

#[test]
fn renaming_the_top_stash_keeps_the_order() {
    let repo = dirty();
    stash_push(&repo.path, "only", false).unwrap();
    let (index, sha) = only_stash(&repo);

    stash_rename(&repo.path, index, &sha, "better").unwrap();

    let after = repo_snapshot(&repo.path).unwrap().stashes;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].sha, sha);
    assert_eq!(after[0].message, "On main: better");
}

#[test]
fn renaming_a_stash_that_moved_or_with_an_empty_message_changes_nothing() {
    let repo = dirty();
    stash_push(&repo.path, "older", false).unwrap();
    let (index, sha) = only_stash(&repo);
    repo.write("a.txt", "newer edit\n");
    stash_push(&repo.path, "newer", false).unwrap();
    let before = repo_snapshot(&repo.path).unwrap().stashes;

    for result in [
        stash_rename(&repo.path, index, &sha, "renamed"),
        stash_rename(&repo.path, 1, &sha, "   "),
    ] {
        assert_eq!(result.unwrap_err().kind(), ErrorKind::InvalidRequest);
    }

    assert_eq!(repo_snapshot(&repo.path).unwrap().stashes, before);
}
