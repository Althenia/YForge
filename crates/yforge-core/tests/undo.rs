mod common;

use std::fs;
use std::path::PathBuf;

use common::Fixture;
use yforge_core::{
    branch_snapshot, capture_state, cherry_pick, commit, create_branch, delete_branch,
    delete_remote_branch, discard_files, discard_hunk, head_ref, merge, plan_branch_create,
    plan_branch_delete, plan_checkout, plan_commit, plan_discard, plan_force_push,
    plan_integration, plan_remote_branch_delete, plan_reset, plan_stash_restore, plan_upstream,
    push_force, push_plan, rebase, remote_branch_sha, reset, revert, set_upstream, snapshot_files,
    stash_apply, stash_pop, undo, CancelToken, CheckoutTarget, ErrorKind, ForceLease, MergeMode,
    Planned, ResetMode, UndoAction,
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
    let hard = reason(plan_reset(&dirty_before, &after, ResetMode::Hard));
    assert!(hard.contains("uncommitted changes"));
    assert!(hard.contains("Recovery"));
    assert!(hard.contains("Safety snapshots"));
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
    let diff = yforge_core::diff_file(
        &repo.path,
        "n.txt",
        yforge_core::ChangeArea::Unstaged,
        false,
    )
    .unwrap();
    discard_hunk(&repo.path, "n.txt", &diff.hunks[0], false).unwrap();
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

struct Published {
    repo: Fixture,
    remote: PathBuf,
    original: String,
    rewritten: String,
    lease: ForceLease,
}

fn remote_head(published: &Published) -> String {
    published
        .repo
        .run_in(&published.remote, &["rev-parse", "refs/heads/main"])
}

fn force_pushed() -> (Published, Planned) {
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
    let planned = plan_force_push(&lease, &pushed.sha);
    let published = Published {
        repo,
        remote,
        original,
        rewritten,
        lease,
    };
    (published, planned)
}

#[test]
fn undoing_a_force_push_puts_the_previous_commit_back_on_the_remote_branch() {
    let (published, planned) = force_pushed();
    assert_eq!(remote_head(&published), published.rewritten);
    let Planned::Available(plan) = &planned else {
        panic!("expected an undo plan");
    };
    assert!(plan.scope.contains("origin/main"));
    assert!(plan.scope.contains(&published.original[..7]));
    assert!(plan.scope.contains(&published.rewritten[..7]));

    let message = undo(&published.repo.path, &plan.action).unwrap();

    assert_eq!(remote_head(&published), published.original);
    assert_eq!(head(&published.repo), published.rewritten);
    assert_eq!(
        published
            .repo
            .git(&["rev-parse", "refs/remotes/origin/main"]),
        published.original
    );
    assert!(message.contains("main"));
}

#[test]
fn undoing_a_force_push_is_refused_when_the_remote_moved_since_and_changes_nothing() {
    let (published, planned) = force_pushed();
    let other = published.repo.clone_of(&published.remote, "other");
    let moved = published
        .repo
        .commit_in(&other, "c.txt", "c\n", "Someone else's work");
    published.repo.run_in(&other, &["push", "-q"]);

    let error = undo(&published.repo.path, &action(planned)).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(error.to_string().contains("moved"), "{error}");
    assert!(error.to_string().contains("Nothing was changed"), "{error}");
    assert_eq!(remote_head(&published), moved);
}

#[test]
fn a_force_push_that_did_not_move_the_remote_has_no_undo() {
    let (published, _) = force_pushed();
    let pushed = head(&published.repo);

    assert!(reason(plan_force_push(
        &ForceLease {
            expected_sha: pushed.clone(),
            ..published.lease.clone()
        },
        &pushed
    ))
    .contains("did not move"));
}

fn published_topic() -> (Fixture, PathBuf, String) {
    let repo = repo();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let topic = repo.commit("t.txt", "t\n", "Topic work");
    repo.git(&["push", "-q", "origin", "main:topic"]);
    (repo, remote, topic)
}

fn delete_topic(repo: &Fixture) -> Planned {
    let recorded = remote_branch_sha(&repo.path, "origin", "topic").unwrap();
    delete_remote_branch(
        &repo.path,
        "origin",
        "topic",
        &CancelToken::new(),
        &mut |_| {},
    )
    .unwrap();
    plan_remote_branch_delete("origin", "topic", recorded)
}

#[test]
fn undoing_a_remote_branch_delete_pushes_the_recorded_commit_back_under_the_same_name() {
    let (repo, remote, topic) = published_topic();
    let planned = delete_topic(&repo);
    let Planned::Available(plan) = &planned else {
        panic!("expected an undo plan");
    };
    assert!(plan.scope.contains("origin/topic") && plan.scope.contains(&topic[..7]));
    assert_eq!(
        repo.run_in(&remote, &["for-each-ref", "refs/heads/topic"]),
        ""
    );

    let message = undo(&repo.path, &plan.action).unwrap();

    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/topic"]),
        topic
    );
    assert!(message.contains("topic"), "{message}");
}

#[test]
fn undoing_a_remote_branch_delete_is_refused_when_the_name_exists_again() {
    let (repo, remote, _) = published_topic();
    let planned = delete_topic(&repo);
    let other = repo.clone_of(&remote, "other");
    repo.run_in(&other, &["switch", "-q", "-c", "topic"]);
    let recreated = repo.commit_in(&other, "n.txt", "n\n", "New topic");
    repo.run_in(&other, &["push", "-q", "origin", "topic"]);

    let error = undo(&repo.path, &action(planned)).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(error.to_string().contains("exists again"), "{error}");
    assert!(error.to_string().contains("Nothing was changed"), "{error}");
    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/topic"]),
        recreated
    );
}

#[test]
fn a_remote_branch_delete_of_an_unknown_tip_has_no_undo() {
    assert!(reason(plan_remote_branch_delete("origin", "topic", None)).contains("topic"));
}

fn upstream_of(repo: &Fixture, branch: &str) -> String {
    repo.git(&[
        "for-each-ref",
        "--format=%(upstream:short)",
        &format!("refs/heads/{branch}"),
    ])
}

fn upstream_snapshot(repo: &Fixture, branch: &str) -> Option<String> {
    branch_snapshot(&repo.path, branch)
        .unwrap()
        .unwrap()
        .upstream
}

#[test]
fn undoing_set_upstream_restores_the_previous_upstream_or_none() {
    let repo = repo();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["branch", "feature"]);
    repo.git(&["push", "-q", "origin", "feature"]);

    let none_before = upstream_snapshot(&repo, "feature");
    set_upstream(&repo.path, "feature", Some("origin/feature")).unwrap();
    let plan = action(plan_upstream(
        "feature",
        &none_before,
        &upstream_snapshot(&repo, "feature"),
    ));
    undo(&repo.path, &plan).unwrap();
    assert_eq!(upstream_of(&repo, "feature"), "");

    set_upstream(&repo.path, "feature", Some("origin/main")).unwrap();
    let before = upstream_snapshot(&repo, "feature");
    set_upstream(&repo.path, "feature", None).unwrap();
    let plan = action(plan_upstream(
        "feature",
        &before,
        &upstream_snapshot(&repo, "feature"),
    ));
    undo(&repo.path, &plan).unwrap();
    assert_eq!(upstream_of(&repo, "feature"), "origin/main");
}

#[test]
fn undoing_set_upstream_is_refused_when_the_upstream_changed_since() {
    let repo = repo();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["branch", "feature"]);
    repo.git(&["push", "-q", "origin", "feature"]);
    set_upstream(&repo.path, "feature", Some("origin/feature")).unwrap();
    let plan = action(plan_upstream(
        "feature",
        &None,
        &upstream_snapshot(&repo, "feature"),
    ));
    set_upstream(&repo.path, "feature", Some("origin/main")).unwrap();

    let error = undo(&repo.path, &plan).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(upstream_of(&repo, "feature"), "origin/main");
}

#[test]
fn a_set_upstream_that_changed_nothing_has_no_undo() {
    let same = Some("origin/main".to_owned());
    assert!(reason(plan_upstream("main", &same, &same)).contains("did not change"));
}
