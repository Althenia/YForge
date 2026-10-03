mod common;

use std::fs;

use common::Fixture;
use yforge_core::{
    branch_snapshot, capture_state, commit, create_branch, delete_branch, delete_remote_branch,
    discard_files, head_ref, merge, plan_branch_create, plan_branch_delete, plan_checkout,
    plan_commit, plan_discard, plan_force_push, plan_integration, plan_redo,
    plan_remote_branch_delete, plan_stash_restore, plan_upstream, push_force, push_plan,
    remote_branch_sha, set_upstream, snapshot_files, stash_pop, undo, CancelToken, CheckoutTarget,
    ErrorKind, MergeMode, Planned, UndoAction,
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

fn head(repo: &Fixture) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn tree(repo: &Fixture) -> String {
    repo.git(&["write-tree"])
}

#[test]
fn redoing_an_undone_commit_restores_the_commit_and_the_exact_tree() {
    let repo = repo();
    let first = head(&repo);
    repo.write("a.txt", "two\n");
    repo.git(&["add", "a.txt"]);
    let before = capture_state(&repo.path).unwrap();
    commit(&repo.path, "Second", "", false).unwrap();
    let after = capture_state(&repo.path).unwrap();
    let committed = head(&repo);
    let committed_tree = tree(&repo);
    let undoing = action(plan_commit(&before, &after, false));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();
    assert!(redoing.scope.starts_with("Redo"), "{}", redoing.scope);

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(head(&repo), first);
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(head(&repo), committed);
    assert_eq!(tree(&repo), committed_tree);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn redoing_a_commit_is_refused_when_the_index_changed_after_the_undo() {
    let repo = repo();
    repo.write("a.txt", "two\n");
    repo.git(&["add", "a.txt"]);
    let before = capture_state(&repo.path).unwrap();
    commit(&repo.path, "Second", "", false).unwrap();
    let after = capture_state(&repo.path).unwrap();
    let undoing = action(plan_commit(&before, &after, false));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();
    undo(&repo.path, &undoing).unwrap();
    let restaged = head(&repo);
    repo.write("b.txt", "extra\n");
    repo.git(&["add", "b.txt"]);

    let error = undo(&repo.path, &redoing.action).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(error.to_string().contains("Nothing was changed"), "{error}");
    assert_eq!(head(&repo), restaged);
}

#[test]
fn redoing_a_merge_restores_the_merge_commit_and_a_clean_tree() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("m.txt", "m\n", "Main work");
    let before = capture_state(&repo.path).unwrap();
    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
    let after = capture_state(&repo.path).unwrap();
    let merged = head(&repo);
    let merged_tree = tree(&repo);
    let undoing = action(plan_integration("merge", &before, &after, false));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_ne!(head(&repo), merged);
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(head(&repo), merged);
    assert_eq!(tree(&repo), merged_tree);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn redoing_a_hard_reset_is_refused_on_a_dirty_tree() {
    let repo = repo();
    repo.commit("b.txt", "b\n", "Second");
    let before = capture_state(&repo.path).unwrap();
    repo.commit("c.txt", "c\n", "Third");
    let after = capture_state(&repo.path).unwrap();
    let undoing = action(plan_integration("cherry-pick", &before, &after, false));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();
    undo(&repo.path, &undoing).unwrap();
    repo.write("a.txt", "dirty\n");

    let error = undo(&repo.path, &redoing.action).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::LocalChanges);
    assert_eq!(repo.read("a.txt"), "dirty\n");
}

#[test]
fn redoing_a_branch_create_recreates_the_branch_at_its_commit_and_switches_to_it() {
    let repo = repo();
    let tip = head(&repo);
    let before = head_ref(&repo.path).unwrap();
    create_branch(&repo.path, "topic", None, true).unwrap();
    let undoing = action(plan_branch_create("topic", &tip, &before, true));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert!(repo.git(&["branch", "--list", "topic"]).is_empty());
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(repo.git(&["rev-parse", "topic"]), tip);
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "topic");
}

#[test]
fn redoing_a_branch_delete_deletes_it_again_and_is_refused_after_new_commits() {
    let repo = repo();
    repo.git(&["branch", "topic"]);
    let snapshot = branch_snapshot(&repo.path, "topic").unwrap().unwrap();
    delete_branch(&repo.path, "topic", true).unwrap();
    let undoing = action(plan_branch_delete("topic", &snapshot));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(repo.git(&["rev-parse", "topic"]), snapshot.sha);
    undo(&repo.path, &redoing.action).unwrap();
    assert!(repo.git(&["branch", "--list", "topic"]).is_empty());

    undo(&repo.path, &undoing).unwrap();
    repo.git(&["switch", "-q", "topic"]);
    repo.commit("t.txt", "t\n", "Topic work");
    repo.git(&["switch", "-q", "main"]);
    let error = undo(&repo.path, &redoing.action).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn redoing_a_checkout_switches_to_the_branch_again() {
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
    let undoing = action(plan_checkout(&before, &after, false));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "main");
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "other");
}

#[test]
fn redoing_a_stash_pop_applies_it_again_with_the_same_tree_and_drops_the_entry() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    repo.git(&["stash", "push", "-q", "-m", "parked"]);
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    let before = capture_state(&repo.path).unwrap();
    stash_pop(&repo.path, 0, &sha).unwrap();
    let popped_tree = repo.git(&["stash", "create"]);
    let popped_tree = repo.git(&["rev-parse", &format!("{popped_tree}^{{tree}}")]);
    let undoing = action(plan_stash_restore(&repo.path, &sha, true, &before).unwrap());
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.git(&["rev-parse", "stash@{0}"]), sha);
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(repo.read("a.txt"), "stashed\n");
    let now = repo.git(&["stash", "create"]);
    assert_eq!(
        repo.git(&["rev-parse", &format!("{now}^{{tree}}")]),
        popped_tree
    );
    assert_eq!(repo.git(&["stash", "list"]), "");
}

#[test]
fn redoing_a_discard_discards_the_same_files_again() {
    let repo = repo();
    repo.write("a.txt", "edited\n");
    repo.write("scratch.txt", "scratch\n");
    let files = vec!["a.txt".to_owned(), "scratch.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();
    discard_files(&repo.path, &files).unwrap();
    let undoing = action(plan_discard(&repo.path, snapshot).unwrap());
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(repo.read("a.txt"), "edited\n");
    assert_eq!(repo.read("scratch.txt"), "scratch\n");
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(repo.read("a.txt"), "one\n");
    assert!(!repo.path.join("scratch.txt").exists());
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn redoing_a_discard_is_refused_after_a_later_edit() {
    let repo = repo();
    repo.write("a.txt", "edited\n");
    let files = vec!["a.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();
    discard_files(&repo.path, &files).unwrap();
    let undoing = action(plan_discard(&repo.path, snapshot).unwrap());
    let redoing = plan_redo(&repo.path, &undoing).unwrap();
    undo(&repo.path, &undoing).unwrap();
    repo.write("a.txt", "edited again\n");

    let error = undo(&repo.path, &redoing.action).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "edited again\n");
}

#[test]
fn redoing_an_upstream_change_sets_it_again() {
    let repo = repo();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "origin", "main"]);
    set_upstream(&repo.path, "main", Some("origin/main")).unwrap();
    let undoing = action(plan_upstream(
        "main",
        &None,
        &Some("origin/main".to_owned()),
    ));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert!(branch_snapshot(&repo.path, "main")
        .unwrap()
        .unwrap()
        .upstream
        .is_none());
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(
        branch_snapshot(&repo.path, "main")
            .unwrap()
            .unwrap()
            .upstream
            .as_deref(),
        Some("origin/main")
    );
}

#[test]
fn redoing_a_force_push_pushes_the_rewritten_commit_again() {
    let repo = repo();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let original = repo.commit("b.txt", "first\n", "Original work");
    repo.git(&["push", "-q"]);
    repo.git(&["commit", "-q", "--amend", "-m", "Rewritten work"]);
    let rewritten = head(&repo);
    let lease = push_plan(&repo.path).unwrap().lease;
    let pushed = branch_snapshot(&repo.path, "main").unwrap().unwrap();
    push_force(&repo.path, &lease, &CancelToken::new(), &mut |_| {}).unwrap();
    let undoing = action(plan_force_push(&lease, &pushed.sha));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/main"]),
        original
    );
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/main"]),
        rewritten
    );
}

#[test]
fn redoing_a_remote_branch_delete_deletes_the_remote_branch_again() {
    let repo = repo();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let topic = repo.commit("t.txt", "t\n", "Topic work");
    repo.git(&["push", "-q", "origin", "main:topic"]);
    let recorded = remote_branch_sha(&repo.path, "origin", "topic").unwrap();
    delete_remote_branch(
        &repo.path,
        "origin",
        "topic",
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();
    let undoing = action(plan_remote_branch_delete("origin", "topic", recorded));
    let redoing = plan_redo(&repo.path, &undoing).unwrap();

    undo(&repo.path, &undoing).unwrap();
    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/topic"]),
        topic
    );
    undo(&repo.path, &redoing.action).unwrap();

    assert_eq!(
        repo.run_in(&remote, &["for-each-ref", "refs/heads/topic"]),
        ""
    );
    fs::metadata(&remote).unwrap();
}
