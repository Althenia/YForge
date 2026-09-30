mod common;

use std::fs;

use common::Fixture;
use yforge_core::{
    branch_snapshot, capture_state, cherry_pick, commit, create_branch, delete_branch,
    discard_files, discard_hunk, head_ref, merge, plan_branch_create, plan_branch_delete,
    plan_checkout, plan_commit, plan_discard, plan_integration, plan_reset, plan_stash_restore,
    rebase, reset, revert, snapshot_files, stash_apply, stash_pop, undo, CheckoutTarget, ErrorKind,
    MergeMode, Planned, ResetMode, UndoAction,
};

fn repo() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo
}

fn action(planned: Planned) -> UndoAction {
    match planned {
        Planned::Available(plan) => plan.action,
        Planned::Unavailable(reason) => panic!("expected an undo plan, got: {reason}"),
    }
}

fn reason(planned: Planned) -> String {
    match planned {
        Planned::Unavailable(reason) => reason,
        Planned::Available(plan) => panic!("expected no undo plan, got: {}", plan.scope),
    }
}

fn head(repo: &Fixture) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

#[test]
fn undoing_a_commit_soft_resets_to_the_previous_head_and_keeps_the_changes_staged() {
    let repo = repo();
    let first = head(&repo);
    repo.write("a.txt", "two\n");
    repo.git(&["add", "a.txt"]);
    let before = capture_state(&repo.path).unwrap();
    commit(&repo.path, "Second", "", false).unwrap();
    let after = capture_state(&repo.path).unwrap();

    let plan = action(plan_commit(&before, &after, false));
    let message = undo(&repo.path, &plan).unwrap();

    assert_eq!(head(&repo), first);
    assert_eq!(repo.git(&["status", "--porcelain"]), "M  a.txt");
    assert_eq!(repo.read("a.txt"), "two\n");
    assert!(message.contains("main"));
}

#[test]
fn undoing_an_amend_restores_the_original_commit_with_the_amended_changes_staged() {
    let repo = repo();
    repo.commit("b.txt", "b\n", "Second");
    let original = head(&repo);
    repo.write("b.txt", "b2\n");
    repo.git(&["add", "b.txt"]);
    let before = capture_state(&repo.path).unwrap();
    commit(&repo.path, "Second, amended", "", true).unwrap();
    let after = capture_state(&repo.path).unwrap();

    undo(&repo.path, &action(plan_commit(&before, &after, true))).unwrap();

    assert_eq!(head(&repo), original);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Second");
    assert_eq!(repo.git(&["status", "--porcelain"]), "M  b.txt");
}

#[test]
fn a_first_commit_and_a_moved_head_have_no_commit_undo() {
    let repo = Fixture::init();
    repo.identity();
    repo.write("a.txt", "one\n");
    repo.git(&["add", "a.txt"]);
    let before = capture_state(&repo.path).unwrap();
    commit(&repo.path, "First", "", false).unwrap();
    let after = capture_state(&repo.path).unwrap();
    assert!(reason(plan_commit(&before, &after, false)).contains("first commit"));

    repo.commit("b.txt", "b\n", "Second");
    let mid = capture_state(&repo.path).unwrap();
    repo.write("b.txt", "b2\n");
    repo.git(&["add", "b.txt"]);
    commit(&repo.path, "Third", "", false).unwrap();
    let plan = action(plan_commit(
        &mid,
        &capture_state(&repo.path).unwrap(),
        false,
    ));
    repo.commit("c.txt", "c\n", "Fourth");
    let moved = head(&repo);

    let error = undo(&repo.path, &plan).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(head(&repo), moved);
}

#[test]
fn undoing_branch_creation_deletes_it_and_switches_back_when_it_was_checked_out() {
    let repo = repo();
    let sha = head(&repo);
    let before = head_ref(&repo.path).unwrap();
    create_branch(&repo.path, "plain", None, false).unwrap();
    create_branch(&repo.path, "feature/x", None, true).unwrap();

    undo(
        &repo.path,
        &action(plan_branch_create("feature/x", &sha, &before, true)),
    )
    .unwrap();
    undo(
        &repo.path,
        &action(plan_branch_create("plain", &sha, &before, false)),
    )
    .unwrap();

    assert_eq!(repo.git(&["branch", "--format=%(refname:short)"]), "main");
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "main");
}

#[test]
fn undoing_branch_creation_is_refused_once_the_branch_has_new_commits() {
    let repo = repo();
    let sha = head(&repo);
    let before = head_ref(&repo.path).unwrap();
    create_branch(&repo.path, "topic", None, true).unwrap();
    repo.commit("t.txt", "t\n", "Topic work");

    let error = undo(
        &repo.path,
        &action(plan_branch_create("topic", &sha, &before, true)),
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(repo
        .git(&["branch", "--format=%(refname:short)"])
        .contains("topic"));
}

#[test]
fn undoing_a_branch_delete_recreates_it_at_the_recorded_sha_with_its_upstream() {
    let repo = repo();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("t.txt", "t\n", "Topic work");
    repo.git(&["push", "-q", "-u", "origin", "topic"]);
    let topic = head(&repo);
    repo.git(&["switch", "-q", "main"]);
    let snapshot = branch_snapshot(&repo.path, "topic").unwrap().unwrap();
    delete_branch(&repo.path, "topic", true).unwrap();

    undo(&repo.path, &action(plan_branch_delete("topic", &snapshot))).unwrap();

    assert_eq!(repo.git(&["rev-parse", "topic"]), topic);
    assert_eq!(
        repo.git(&["rev-parse", "--abbrev-ref", "topic@{upstream}"]),
        "origin/topic"
    );
    let again = undo(&repo.path, &action(plan_branch_delete("topic", &snapshot))).unwrap_err();
    assert_eq!(again.kind(), ErrorKind::InvalidRequest);
    drop(remote);
}

#[test]
fn undoing_a_checkout_switches_back_and_is_refused_after_head_moves_on() {
    let repo = repo();
    repo.git(&["branch", "other"]);
    let before = head_ref(&repo.path).unwrap();
    yforge_core::checkout(
        &repo.path,
        &CheckoutTarget::LocalBranch {
            name: "other".into(),
        },
        false,
    )
    .unwrap();
    let after = head_ref(&repo.path).unwrap();
    let plan = action(plan_checkout(&before, &after, false));

    undo(&repo.path, &plan).unwrap();
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "main");

    yforge_core::checkout(
        &repo.path,
        &CheckoutTarget::LocalBranch {
            name: "other".into(),
        },
        false,
    )
    .unwrap();
    repo.git(&["switch", "-q", "main"]);
    let error = undo(&repo.path, &plan).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(reason(plan_checkout(&before, &before, false)).contains("did not change"));
    assert!(reason(plan_checkout(&before, &after, true)).contains("stash"));
}

fn stashed() -> (Fixture, String) {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    repo.git(&["stash", "push", "-q", "-m", "parked"]);
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    (repo, sha)
}

#[test]
fn undoing_a_stash_pop_discards_the_applied_changes_and_restores_the_entry() {
    let (repo, sha) = stashed();
    let before = capture_state(&repo.path).unwrap();
    stash_pop(&repo.path, 0, &sha).unwrap();
    let plan = action(plan_stash_restore(&repo.path, &sha, true, &before).unwrap());

    undo(&repo.path, &plan).unwrap();

    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert_eq!(repo.git(&["rev-parse", "stash@{0}"]), sha);
}

#[test]
fn undoing_a_stash_apply_discards_the_changes_and_keeps_the_entry() {
    let (repo, sha) = stashed();
    let before = capture_state(&repo.path).unwrap();
    stash_apply(&repo.path, 0, &sha).unwrap();
    let plan = action(plan_stash_restore(&repo.path, &sha, false, &before).unwrap());

    undo(&repo.path, &plan).unwrap();

    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.git(&["stash", "list"]).lines().count(), 1);
}

#[test]
fn stash_undo_is_refused_when_the_tree_changed_and_unavailable_when_ambiguous() {
    let (repo, sha) = stashed();
    let before = capture_state(&repo.path).unwrap();
    stash_pop(&repo.path, 0, &sha).unwrap();
    let plan = action(plan_stash_restore(&repo.path, &sha, true, &before).unwrap());
    repo.write("a.txt", "edited after pop\n");

    let error = undo(&repo.path, &plan).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "edited after pop\n");

    repo.git(&["stash", "push", "-q", "-m", "again"]);
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    repo.write("dirty.txt", "x\n");
    repo.git(&["add", "dirty.txt"]);
    let dirty = capture_state(&repo.path).unwrap();
    assert!(
        reason(plan_stash_restore(&repo.path, &sha, false, &dirty).unwrap())
            .contains("before the restore")
    );

    repo.git(&["reset", "-q", "--hard"]);
    repo.write("new.txt", "u\n");
    repo.git(&["stash", "push", "-q", "-u", "-m", "with untracked"]);
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    let clean = capture_state(&repo.path).unwrap();
    stash_apply(&repo.path, 0, &sha).unwrap();
    assert!(
        reason(plan_stash_restore(&repo.path, &sha, false, &clean).unwrap()).contains("untracked")
    );
}

fn diverged() -> Fixture {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("m.txt", "m\n", "Main work");
    repo
}

#[test]
fn undoing_merge_rebase_reset_cherry_pick_and_revert_returns_to_the_recorded_head() {
    let repo = diverged();
    let topic = repo.git(&["rev-parse", "topic"]);
    for verb in ["merge", "cherry-pick", "revert", "reset"] {
        let before = capture_state(&repo.path).unwrap();
        let start = head(&repo);
        match verb {
            "merge" => {
                merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
            }
            "cherry-pick" => {
                cherry_pick(&repo.path, &topic).unwrap();
            }
            "revert" => {
                revert(&repo.path, &start).unwrap();
            }
            _ => {
                let parent = repo.git(&["rev-parse", "HEAD~1"]);
                reset(&repo.path, &parent, ResetMode::Hard).unwrap();
            }
        }
        let after = capture_state(&repo.path).unwrap();
        assert_ne!(head(&repo), start, "{verb} moved HEAD");
        let planned = if verb == "reset" {
            plan_reset(&before, &after, ResetMode::Hard)
        } else {
            plan_integration(verb, &before, &after, false)
        };

        undo(&repo.path, &action(planned)).unwrap();

        assert_eq!(head(&repo), start, "{verb} undone");
        assert_eq!(repo.git(&["status", "--porcelain"]), "");
    }
}

#[test]
fn undoing_a_rebase_restores_the_pre_rebase_branch() {
    let repo = diverged();
    repo.git(&["switch", "-q", "topic"]);
    let start = head(&repo);
    let before = capture_state(&repo.path).unwrap();
    rebase(&repo.path, "main").unwrap();
    let after = capture_state(&repo.path).unwrap();
    assert_ne!(head(&repo), start);

    undo(
        &repo.path,
        &action(plan_integration("rebase", &before, &after, false)),
    )
    .unwrap();

    assert_eq!(head(&repo), start);
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "topic");
}

#[test]
fn history_undo_is_refused_on_a_dirty_tree_or_a_moved_head_and_unavailable_when_unsafe() {
    let repo = diverged();
    let before = capture_state(&repo.path).unwrap();
    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
    let after = capture_state(&repo.path).unwrap();
    let plan = action(plan_integration("merge", &before, &after, false));
    repo.write("a.txt", "dirty\n");

    let dirty = undo(&repo.path, &plan).unwrap_err();
    repo.git(&["checkout", "--", "a.txt"]);
    repo.commit("later.txt", "l\n", "Later");
    let moved = undo(&repo.path, &plan).unwrap_err();

    assert_eq!(dirty.kind(), ErrorKind::LocalChanges);
    assert_eq!(moved.kind(), ErrorKind::InvalidRequest);
    assert!(reason(plan_integration("merge", &before, &after, true)).contains("conflicts"));
    assert!(reason(plan_integration("merge", &before, &before, false)).contains("did not move"));
    let dirty_before = yforge_core::RepoState {
        clean: false,
        ..before.clone()
    };
    assert!(
        reason(plan_reset(&dirty_before, &after, ResetMode::Hard)).contains("uncommitted changes")
    );
    let dirty_after = yforge_core::RepoState {
        clean: false,
        ..after.clone()
    };
    assert!(
        reason(plan_reset(&before, &dirty_after, ResetMode::Mixed)).contains("clean working tree")
    );
}

#[test]
fn an_operation_in_progress_refuses_undo() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main edit");
    let before = capture_state(&repo.path).unwrap();
    repo.git(&["switch", "-q", "topic"]);
    let topic_before = capture_state(&repo.path).unwrap();
    let outcome = rebase(&repo.path, "main").unwrap();
    assert_eq!(outcome, yforge_core::OperationOutcome::Conflicts);
    let after = capture_state(&repo.path).unwrap();
    let plan = UndoAction::ResetHard {
        branch: after.branch.clone(),
        from: after.head.clone().unwrap(),
        to: topic_before.head.clone().unwrap(),
    };

    let error = undo(&repo.path, &plan).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(error.to_string().contains("in progress"));
    assert!(before.clean);
}

#[test]
fn undoing_a_discard_restores_tracked_deleted_and_untracked_files_from_the_snapshot() {
    let repo = repo();
    repo.commit("gone.txt", "gone\n", "Add gone");
    repo.write("a.txt", "edited\n");
    fs::remove_file(repo.path.join("gone.txt")).unwrap();
    repo.write("scratch.txt", "scratch\n");
    let files = vec![
        "a.txt".to_owned(),
        "gone.txt".to_owned(),
        "scratch.txt".to_owned(),
    ];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();
    discard_files(&repo.path, &files).unwrap();
    let plan = action(plan_discard(&repo.path, snapshot).unwrap());
    assert_eq!(repo.read("a.txt"), "one\n");
    assert!(!repo.path.join("scratch.txt").exists());

    undo(&repo.path, &plan).unwrap();

    assert_eq!(repo.read("a.txt"), "edited\n");
    assert_eq!(repo.read("scratch.txt"), "scratch\n");
    assert!(!repo.path.join("gone.txt").exists());
}

#[test]
fn a_discarded_hunk_is_restored_and_undo_is_refused_after_later_edits() {
    let repo = repo();
    repo.numbered("n.txt", &[]);
    repo.git(&["add", "n.txt"]);
    repo.git(&["commit", "-q", "-m", "Numbered"]);
    repo.numbered("n.txt", &[(2, "changed")]);
    let edited = repo.read("n.txt");
    let file = vec!["n.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &file).unwrap();
    let diff =
        yforge_core::diff_file(&repo.path, "n.txt", yforge_core::ChangeArea::Unstaged).unwrap();
    discard_hunk(&repo.path, "n.txt", &diff.hunks[0]).unwrap();
    let plan = action(plan_discard(&repo.path, snapshot).unwrap());
    repo.write("n.txt", "edited again\n");

    let error = undo(&repo.path, &plan).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("n.txt"), "edited again\n");

    repo.git(&["checkout", "--", "n.txt"]);
    undo(&repo.path, &plan).unwrap();
    assert_eq!(repo.read("n.txt"), edited);
}

#[test]
fn discard_snapshots_refuse_directories() {
    let repo = repo();
    fs::create_dir(repo.path.join("dir")).unwrap();

    let error = snapshot_files(&repo.path, &["dir".to_owned()]).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}
