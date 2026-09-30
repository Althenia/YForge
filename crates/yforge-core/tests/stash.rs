mod common;

use common::Fixture;
use yforge_core::{
    repo_snapshot, stash_apply, stash_details, stash_drop, stash_file_diff, stash_pop, stash_push,
    stash_rename, DiffLineKind, ErrorKind, FileStatus, StashRestore,
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

fn summary(details: &yforge_core::StashDetails) -> Vec<(&str, FileStatus, bool)> {
    details
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.status, file.untracked))
        .collect()
}

#[test]
fn stash_details_list_the_tracked_changes_against_the_stash_base() {
    let repo = dirty();
    repo.write("b.txt", "new\n");
    repo.git(&["add", "b.txt"]);
    stash_push(&repo.path, "half done", false).unwrap();
    let (index, sha) = only_stash(&repo);
    let base = repo.git(&["rev-parse", "HEAD"]);

    let details = stash_details(&repo.path, index, &sha).unwrap();

    assert_eq!(details.sha, sha);
    assert_eq!(details.index, index);
    assert_eq!(details.message, "On main: half done");
    assert_eq!(details.base_sha.as_deref(), Some(base.as_str()));
    assert_eq!(details.untracked_sha, None);
    assert_eq!(
        summary(&details),
        vec![
            ("a.txt", FileStatus::Modified, false),
            ("b.txt", FileStatus::Added, false)
        ]
    );
    assert_eq!(
        (details.files[0].additions, details.files[0].deletions),
        (Some(1), Some(1))
    );
}

#[test]
fn stash_details_of_an_untracked_stash_include_the_untracked_files() {
    let repo = dirty();
    repo.write("u.txt", "loose\n");
    repo.write("dir/v.txt", "nested\n");
    stash_push(&repo.path, "with untracked", true).unwrap();
    let (index, sha) = only_stash(&repo);

    let details = stash_details(&repo.path, index, &sha).unwrap();

    assert!(details.untracked_sha.is_some());
    assert_eq!(
        summary(&details),
        vec![
            ("a.txt", FileStatus::Modified, false),
            ("dir/v.txt", FileStatus::Added, true),
            ("u.txt", FileStatus::Added, true)
        ]
    );
    assert_eq!(details.files[2].additions, Some(1));
}

#[test]
fn a_stash_of_only_untracked_files_lists_only_those_files() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.write("u.txt", "loose\n");
    stash_push(&repo.path, "", true).unwrap();
    let (index, sha) = only_stash(&repo);

    let details = stash_details(&repo.path, index, &sha).unwrap();

    assert_eq!(summary(&details), vec![("u.txt", FileStatus::Added, true)]);
}

#[test]
fn stash_file_diffs_cover_tracked_and_untracked_files() {
    let repo = dirty();
    repo.write("u.txt", "loose\n");
    std::fs::write(repo.path.join("logo.png"), b"PNG\0\x01").unwrap();
    stash_push(&repo.path, "with untracked", true).unwrap();
    let (index, sha) = only_stash(&repo);

    let tracked = stash_file_diff(&repo.path, index, &sha, "a.txt", false).unwrap();
    let untracked = stash_file_diff(&repo.path, index, &sha, "u.txt", false).unwrap();
    let binary = stash_file_diff(&repo.path, index, &sha, "logo.png", false).unwrap();

    let kinds = |diff: &yforge_core::FileDiff| -> Vec<(DiffLineKind, String)> {
        diff.hunks[0]
            .lines
            .iter()
            .map(|line| (line.kind, line.text.clone()))
            .collect()
    };
    assert_eq!(
        kinds(&tracked),
        vec![
            (DiffLineKind::Removed, "one".to_owned()),
            (DiffLineKind::Added, "edited".to_owned())
        ]
    );
    assert_eq!(
        kinds(&untracked),
        vec![(DiffLineKind::Added, "loose".to_owned())]
    );
    assert!(binary.binary);
    assert_eq!((binary.old_size, binary.new_size), (None, Some(5)));
}

#[test]
fn stash_file_diffs_can_ignore_whitespace() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("w.txt", "one\ntwo\n", "First");
    repo.write("w.txt", "one  \n  two\n");
    stash_push(&repo.path, "spaces", false).unwrap();
    let (index, sha) = only_stash(&repo);

    let plain = stash_file_diff(&repo.path, index, &sha, "w.txt", false).unwrap();
    let ignored = stash_file_diff(&repo.path, index, &sha, "w.txt", true).unwrap();

    assert_eq!(plain.hunks.len(), 1);
    assert!(ignored.hunks.is_empty());
}

#[test]
fn stash_inspection_refuses_a_moved_entry_and_files_outside_the_stash() {
    let repo = dirty();
    stash_push(&repo.path, "one", false).unwrap();
    let (index, sha) = only_stash(&repo);
    repo.write("a.txt", "again\n");
    stash_push(&repo.path, "two", false).unwrap();

    assert_eq!(
        stash_details(&repo.path, index, &sha).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        stash_file_diff(&repo.path, index, &sha, "a.txt", false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
    let current = repo_snapshot(&repo.path).unwrap().stashes[0].sha.clone();
    assert_eq!(
        stash_file_diff(&repo.path, 0, &current, "untouched.txt", false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        stash_file_diff(&repo.path, 0, &current, "../a.txt", false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}
