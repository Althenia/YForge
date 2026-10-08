mod common;

use common::Fixture;
use yforge_core::{
    repo_snapshot, repository_root, AheadBehind, ChangeArea, ChangeCounts, ErrorKind, FileStatus,
    Head, Operation,
};

#[test]
fn clean_repository_reports_branch_head_refs_and_no_changes() {
    let repo = Fixture::init();
    repo.commit("a.txt", "one\n", "First");
    let head = repo.commit("b.txt", "two\n", "Second");
    repo.git(&["tag", "v1"]);
    repo.git(&["branch", "feature/x"]);

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.root, repo.path.display().to_string());
    assert_eq!(
        snapshot.head,
        Head::Branch {
            name: "main".into(),
            sha: head
        }
    );
    assert_eq!(snapshot.upstream, None);
    assert_eq!(snapshot.counts, ChangeCounts::default());
    assert!(snapshot.files.is_empty());
    assert_eq!(snapshot.operation, None);
    assert_eq!(snapshot.branches, vec!["feature/x", "main"]);
    assert_eq!(snapshot.tags, vec!["v1"]);
    assert!(snapshot.remotes.is_empty());
    assert!(snapshot.stashes.is_empty());
    assert_eq!(snapshot.worktrees.len(), 1);
    assert!(snapshot.worktrees[0].current);
    assert_eq!(snapshot.worktrees[0].branch.as_deref(), Some("main"));
}

#[test]
fn snapshot_resolves_the_root_from_a_subdirectory() {
    let repo = Fixture::init();
    repo.commit("src/lib.txt", "x\n", "First");

    let snapshot = repo_snapshot(&repo.path.join("src")).unwrap();

    assert_eq!(snapshot.root, repo.path.display().to_string());
}

#[test]
fn dirty_repository_lists_staged_unstaged_and_untracked_files() {
    let repo = Fixture::init();
    repo.commit("tracked.txt", "1\n", "First");
    repo.commit("renamed-from.txt", "keep\n", "Second");
    repo.commit("both.txt", "1\n", "Third");
    repo.write("staged new.txt", "n\n");
    repo.git(&["add", "--", "staged new.txt"]);
    repo.write("tracked.txt", "2\n");
    repo.write("both.txt", "2\n");
    repo.git(&["add", "--", "both.txt"]);
    repo.write("both.txt", "3\n");
    repo.git(&["mv", "renamed-from.txt", "renamed-to.txt"]);
    repo.write("dir/untracked.txt", "u\n");

    let snapshot = repo_snapshot(&repo.path).unwrap();

    let files: Vec<(&str, ChangeArea, FileStatus)> = snapshot
        .files
        .iter()
        .map(|file| (file.path.as_str(), file.area, file.status))
        .collect();
    assert!(files.contains(&("staged new.txt", ChangeArea::Staged, FileStatus::Added)));
    assert!(files.contains(&("tracked.txt", ChangeArea::Unstaged, FileStatus::Modified)));
    assert!(files.contains(&("both.txt", ChangeArea::Staged, FileStatus::Modified)));
    assert!(files.contains(&("both.txt", ChangeArea::Unstaged, FileStatus::Modified)));
    assert!(files.contains(&("renamed-to.txt", ChangeArea::Staged, FileStatus::Renamed)));
    assert!(files.contains(&(
        "dir/untracked.txt",
        ChangeArea::Untracked,
        FileStatus::Untracked
    )));
    let renamed = snapshot
        .files
        .iter()
        .find(|file| file.path == "renamed-to.txt")
        .unwrap();
    assert_eq!(renamed.original_path.as_deref(), Some("renamed-from.txt"));
    assert_eq!(
        snapshot.counts,
        ChangeCounts {
            modified: 2,
            added: 1,
            deleted: 0,
            renamed: 1,
            untracked: 1,
            conflicted: 0,
        }
    );
    assert_eq!(snapshot.operation, None);
}

#[test]
fn repository_mid_merge_reports_the_operation_and_conflicted_files() {
    let repo = Fixture::init();
    repo.commit("f.txt", "base\n", "Base");
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit("f.txt", "topic\n", "Topic edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("f.txt", "main\n", "Main edit");
    repo.git_expecting_conflict(&["merge", "topic"]);

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.operation, Some(Operation::Merge));
    assert_eq!(snapshot.counts.conflicted, 1);
    assert_eq!(snapshot.files.len(), 1);
    assert_eq!(snapshot.files[0].path, "f.txt");
    assert_eq!(snapshot.files[0].area, ChangeArea::Conflicted);
    assert_eq!(snapshot.files[0].status, FileStatus::Conflicted);
}

#[test]
fn repository_mid_cherry_pick_reports_the_operation() {
    let repo = Fixture::init();
    repo.commit("f.txt", "base\n", "Base");
    repo.git(&["checkout", "-q", "-b", "topic"]);
    let picked = repo.commit("f.txt", "topic\n", "Topic edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("f.txt", "main\n", "Main edit");
    repo.git_expecting_conflict(&["cherry-pick", &picked]);

    assert_eq!(
        repo_snapshot(&repo.path).unwrap().operation,
        Some(Operation::CherryPick)
    );
}

#[test]
fn repository_mid_revert_reports_the_operation_and_the_reverted_commit() {
    let repo = Fixture::init();
    repo.commit("f.txt", "base\n", "Base");
    let reverted = repo.commit("f.txt", "topic\n", "Topic edit");
    repo.commit("f.txt", "later\n", "Later edit");
    repo.git_expecting_conflict(&["revert", "--no-edit", &reverted]);

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.operation, Some(Operation::Revert));
    assert_eq!(snapshot.counts.conflicted, 1);
    assert_eq!(
        snapshot.operation_detail.unwrap().incoming,
        Some(format!("{} Topic edit", &reverted[..7]))
    );
}

#[test]
fn repository_mid_bisect_reports_the_operation_until_it_is_reset() {
    let repo = Fixture::init();
    let first = repo.commit("f.txt", "1\n", "One");
    repo.commit("f.txt", "2\n", "Two");
    repo.commit("f.txt", "3\n", "Three");
    repo.commit("f.txt", "4\n", "Four");
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);

    repo.git(&["bisect", "start"]);
    repo.git(&["bisect", "bad", "HEAD"]);
    repo.git(&["bisect", "good", &first]);

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Bisect));
    assert_eq!(snapshot.operation_detail.unwrap().current, "main");

    repo.git(&["bisect", "reset"]);
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
}

fn conflicting_topic(repo: &Fixture) -> Vec<String> {
    repo.commit("f.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    let picked = vec![
        repo.commit("f.txt", "topic one\n", "Topic one"),
        repo.commit("g.txt", "topic two\n", "Topic two"),
        repo.commit("h.txt", "topic three\n", "Topic three"),
    ];
    repo.git(&["switch", "-q", "main"]);
    repo.commit("f.txt", "main\n", "Main edit");
    picked
}

#[test]
fn repository_mid_multi_commit_cherry_pick_reports_the_sequence_in_both_of_its_stops() {
    let repo = Fixture::init();
    repo.identity();
    let picked = conflicting_topic(&repo);
    repo.git_expecting_conflict(&["cherry-pick", &picked[0], &picked[1], &picked[2]]);

    let stopped = repo_snapshot(&repo.path).unwrap();
    assert_eq!(stopped.operation, Some(Operation::CherryPickSequence));
    assert_eq!(stopped.counts.conflicted, 1);
    assert_eq!(
        stopped.operation_detail.unwrap().incoming,
        Some(format!("{} Topic one", &picked[0][..7]))
    );

    repo.write("f.txt", "resolved\n");
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "--no-edit"]);

    let paused = repo_snapshot(&repo.path).unwrap();
    assert_eq!(paused.operation, Some(Operation::CherryPickSequence));
    assert_eq!(paused.counts.conflicted, 0);
}

#[test]
fn repository_mid_multi_commit_revert_reports_the_revert_sequence() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("f.txt", "base\n", "Base");
    let first = repo.commit("f.txt", "one\n", "One");
    let second = repo.commit("g.txt", "two\n", "Two");
    repo.commit("f.txt", "later\n", "Later");
    repo.git_expecting_conflict(&["revert", "--no-edit", &second, &first]);

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.operation, Some(Operation::RevertSequence));
}

#[test]
fn unborn_repository_reports_the_unborn_branch() {
    let repo = Fixture::init();
    repo.write("draft.txt", "x\n");

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(
        snapshot.head,
        Head::Unborn {
            branch: "main".into()
        }
    );
    assert_eq!(snapshot.counts.untracked, 1);
    assert!(snapshot.branches.is_empty());
}

#[test]
fn detached_head_reports_the_commit() {
    let repo = Fixture::init();
    let first = repo.commit("a.txt", "1\n", "First");
    repo.commit("a.txt", "2\n", "Second");
    repo.git(&["checkout", "-q", "--detach", &first]);

    assert_eq!(
        repo_snapshot(&repo.path).unwrap().head,
        Head::Detached { sha: first }
    );
}

#[test]
fn tracking_clone_reports_upstream_ahead_behind_remotes_and_remote_branches() {
    let origin = Fixture::init();
    origin.commit("a.txt", "1\n", "First");
    let clone = origin.clone_to("clone");
    origin.commit("b.txt", "2\n", "Upstream only");
    origin.run_in(&clone, &["fetch", "-q"]);
    origin.run_in(&clone, &["config", "user.name", "Yui Lin"]);
    origin.run_in(&clone, &["config", "user.email", "yui@example.test"]);
    std::fs::write(clone.join("c.txt"), "3\n").unwrap();
    origin.run_in(&clone, &["add", "c.txt"]);
    origin.run_in(&clone, &["commit", "-q", "-m", "Local only"]);

    let snapshot = repo_snapshot(&clone).unwrap();

    let upstream = snapshot.upstream.unwrap();
    assert_eq!(upstream.name, "origin/main");
    assert_eq!(
        upstream.ahead_behind,
        Some(AheadBehind {
            ahead: 1,
            behind: 1
        })
    );
    assert_eq!(snapshot.remotes, vec!["origin"]);
    assert_eq!(snapshot.remote_branches, vec!["origin/main"]);
}

#[test]
fn linked_worktrees_are_listed_and_the_current_one_is_marked() {
    let repo = Fixture::init();
    repo.commit("a.txt", "1\n", "First");
    let linked = repo.sibling("linked");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        "-b",
        "hotfix",
        linked.to_str().unwrap(),
    ]);

    let from_main = repo_snapshot(&repo.path).unwrap();
    let from_linked = repo_snapshot(&linked).unwrap();

    assert_eq!(from_main.worktrees.len(), 2);
    let current: Vec<&str> = from_main
        .worktrees
        .iter()
        .filter(|worktree| worktree.current)
        .filter_map(|worktree| worktree.branch.as_deref())
        .collect();
    assert_eq!(current, vec!["main"]);
    let current_in_linked: Vec<&str> = from_linked
        .worktrees
        .iter()
        .filter(|worktree| worktree.current)
        .filter_map(|worktree| worktree.branch.as_deref())
        .collect();
    assert_eq!(current_in_linked, vec!["hotfix"]);
}

#[test]
fn stashes_are_listed_newest_first() {
    let repo = Fixture::init();
    repo.commit("a.txt", "1\n", "First");
    repo.write("a.txt", "2\n");
    repo.git(&["stash", "push", "-q", "-m", "older"]);
    repo.write("a.txt", "3\n");
    repo.git(&["stash", "push", "-q", "-m", "newer"]);

    let stashes = repo_snapshot(&repo.path).unwrap().stashes;

    assert_eq!(stashes.len(), 2);
    assert_eq!(stashes[0].index, 0);
    assert!(stashes[0].message.contains("newer"));
    assert!(stashes[1].message.contains("older"));
    assert!(stashes[0].base_sha.is_some());
}

#[test]
fn repository_root_resolves_a_nested_folder_and_refuses_a_folder_outside_a_repository() {
    let repo = Fixture::init();
    let nested = repo.path.join("nested/deeper");
    std::fs::create_dir_all(&nested).unwrap();
    let root = repository_root(&nested).unwrap();
    assert_eq!(
        root.canonicalize().unwrap(),
        repo.path.canonicalize().unwrap()
    );

    let outside = tempfile::tempdir().unwrap();
    let refused = repository_root(outside.path()).unwrap_err();
    assert_eq!(refused.kind(), ErrorKind::NotARepository);
}

#[test]
fn non_repository_and_missing_paths_are_typed_errors() {
    let dir = tempfile::tempdir().unwrap();

    let not_repo = repo_snapshot(dir.path()).unwrap_err();
    assert_eq!(not_repo.kind(), ErrorKind::NotARepository);

    let missing = repo_snapshot(&dir.path().join("does-not-exist")).unwrap_err();
    assert_eq!(missing.kind(), ErrorKind::NotARepository);

    let file = dir.path().join("plain.txt");
    std::fs::write(&file, "x").unwrap();
    assert_eq!(
        repo_snapshot(&file).unwrap_err().kind(),
        ErrorKind::NotARepository
    );
}

#[test]
fn paths_are_passed_as_arguments_not_through_a_shell() {
    let dir = tempfile::tempdir().unwrap();
    let hostile = dir.path().join("a b; touch pwned $(id)");
    std::fs::create_dir(&hostile).unwrap();

    let error = repo_snapshot(&hostile).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::NotARepository);
    assert!(!dir.path().join("pwned").exists());
}
