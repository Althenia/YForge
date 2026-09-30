mod common;

use common::Fixture;
use yforge_core::{
    cherry_pick, fast_forward, integration_preview, mark_resolved, merge, operation_continue,
    rebase, repo_snapshot, reset, revert, ErrorKind, MergeMode, Operation, OperationOutcome,
    ResetMode,
};

fn diverged() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("b.txt", "topic\n", "Topic work");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("c.txt", "main\n", "Main work");
    repo
}

fn ahead() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("b.txt", "one\n", "Topic one");
    repo.commit("b.txt", "two\n", "Topic two");
    repo.git(&["switch", "-q", "main"]);
    repo
}

fn conflicting() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main edit");
    repo
}

fn parents(repo: &Fixture) -> usize {
    repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"])
        .split(' ')
        .count()
        - 1
}

#[test]
fn the_preview_counts_and_lists_both_sides_and_detects_fast_forwards() {
    let repo = ahead();

    let preview = integration_preview(&repo.path, None, "topic").unwrap();

    assert!(preview.fast_forward);
    assert_eq!(preview.incoming.count, 2);
    assert_eq!(preview.incoming.commits[0].summary, "Topic two");
    assert_eq!(preview.outgoing.count, 0);

    repo.commit("c.txt", "main\n", "Main work");
    let diverged = integration_preview(&repo.path, None, "topic").unwrap();
    assert!(!diverged.fast_forward);
    assert_eq!(diverged.outgoing.count, 1);
    assert_eq!(diverged.outgoing.commits[0].summary, "Main work");
}

#[test]
fn the_preview_can_compare_two_named_branches_and_rejects_unknown_revisions() {
    let repo = ahead();

    let preview = integration_preview(&repo.path, Some("main"), "topic").unwrap();

    assert_eq!(preview.incoming.count, 2);
    assert_eq!(
        integration_preview(&repo.path, None, "nope")
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn a_fast_forward_merge_moves_the_branch_without_a_merge_commit() {
    let repo = ahead();
    let tip = repo.git(&["rev-parse", "topic"]);

    let outcome = merge(&repo.path, "topic", MergeMode::FastForward).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), tip);
}

#[test]
fn a_merge_commit_is_created_when_asked_even_if_a_fast_forward_is_possible() {
    let repo = ahead();

    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();

    assert_eq!(parents(&repo), 2);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s"]),
        "Merge branch 'topic'"
    );
}

#[test]
fn a_branch_that_shares_its_name_with_a_tag_is_still_merged_by_branch() {
    let repo = ahead();
    repo.git(&["tag", "topic", "main"]);

    merge(&repo.path, "topic", MergeMode::FastForward).unwrap();

    assert_eq!(
        repo.git(&["rev-parse", "HEAD"]),
        repo.git(&["rev-parse", "refs/heads/topic"])
    );
}

#[test]
fn a_fast_forward_only_merge_is_refused_when_the_branches_diverged() {
    let repo = diverged();
    let before = repo.git(&["rev-parse", "HEAD"]);

    let error = merge(&repo.path, "topic", MergeMode::FastForward).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::NotFastForward);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
}

#[test]
fn a_diverged_merge_commit_joins_both_histories() {
    let repo = diverged();

    let outcome = merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(parents(&repo), 2);
    assert_eq!(repo.read("b.txt"), "topic\n");
}

#[test]
fn a_conflicting_merge_stops_in_the_operation_state_and_completes_after_resolution() {
    let repo = conflicting();

    let outcome = merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();

    assert_eq!(outcome, OperationOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Merge));
    assert_eq!(snapshot.counts.conflicted, 1);
    repo.write("a.txt", "both\n");
    mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap();
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert_eq!(parents(&repo), 2);
}

#[test]
fn merging_with_overlapping_local_changes_is_a_local_changes_error() {
    let repo = conflicting();
    repo.write("a.txt", "dirty\n");

    let error = merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::LocalChanges);
}

#[test]
fn integration_verbs_refuse_while_an_operation_is_in_progress() {
    let repo = conflicting();
    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
    let head = repo.git(&["rev-parse", "HEAD"]);

    for error in [
        merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap_err(),
        rebase(&repo.path, "topic").unwrap_err(),
        cherry_pick(&repo.path, &head).unwrap_err(),
        revert(&repo.path, &head).unwrap_err(),
        reset(&repo.path, &head, ResetMode::Hard).unwrap_err(),
        fast_forward(&repo.path, "main", "topic").unwrap_err(),
    ] {
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
}

#[test]
fn merging_a_name_that_is_not_a_branch_is_refused() {
    let repo = ahead();
    repo.git(&["tag", "v1", "topic"]);

    assert_eq!(
        merge(&repo.path, "v1", MergeMode::FastForward)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn a_clean_rebase_replays_the_current_branch_onto_the_target() {
    let repo = diverged();
    repo.git(&["switch", "-q", "topic"]);

    let outcome = rebase(&repo.path, "main").unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(
        repo.git(&["merge-base", "main", "topic"]),
        repo.git(&["rev-parse", "main"])
    );
    assert_eq!(repo.read("c.txt"), "main\n");
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Topic work");
}

#[test]
fn a_conflicting_rebase_stops_and_continues_after_resolution() {
    let repo = conflicting();
    repo.git(&["switch", "-q", "topic"]);

    let outcome = rebase(&repo.path, "main").unwrap();

    assert_eq!(outcome, OperationOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Rebase));
    let detail = snapshot.operation_detail.unwrap();
    assert_eq!(detail.current, "main");
    assert_eq!(detail.incoming.as_deref(), Some("topic"));
    repo.write("a.txt", "resolved\n");
    mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap();
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "topic");
    assert_eq!(repo.read("a.txt"), "resolved\n");
}

#[test]
fn fast_forwarding_the_checked_out_branch_moves_it_and_the_working_tree() {
    let repo = ahead();

    fast_forward(&repo.path, "main", "topic").unwrap();

    assert_eq!(
        repo.git(&["rev-parse", "main"]),
        repo.git(&["rev-parse", "topic"])
    );
    assert_eq!(repo.read("b.txt"), "two\n");
}

#[test]
fn fast_forwarding_another_branch_moves_only_that_branch() {
    let repo = ahead();
    repo.git(&["branch", "lagging", "main"]);

    fast_forward(&repo.path, "lagging", "topic").unwrap();

    assert_eq!(
        repo.git(&["rev-parse", "lagging"]),
        repo.git(&["rev-parse", "topic"])
    );
    assert_eq!(repo.git(&["symbolic-ref", "--short", "HEAD"]), "main");
    assert!(!repo.path.join("b.txt").exists());
}

#[test]
fn fast_forward_is_refused_when_it_is_not_possible_or_already_done() {
    let repo = diverged();
    let before = repo.git(&["rev-parse", "main"]);

    let refused = fast_forward(&repo.path, "main", "topic").unwrap_err();
    let same = fast_forward(&repo.path, "main", "main").unwrap_err();

    assert_eq!(refused.kind(), ErrorKind::NotFastForward);
    assert_eq!(same.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.git(&["rev-parse", "main"]), before);
}

#[test]
fn a_clean_cherry_pick_adds_the_commit_to_the_current_branch() {
    let repo = diverged();
    let picked = repo.git(&["rev-parse", "topic"]);

    let outcome = cherry_pick(&repo.path, &picked).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Topic work");
    assert_eq!(repo.read("b.txt"), "topic\n");
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
}

#[test]
fn a_conflicting_cherry_pick_enters_the_operation_state_and_continues() {
    let repo = conflicting();
    let picked = repo.git(&["rev-parse", "topic"]);

    let outcome = cherry_pick(&repo.path, &picked).unwrap();

    assert_eq!(outcome, OperationOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::CherryPick));
    repo.write("a.txt", "picked\n");
    mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap();
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Topic edit");
}

#[test]
fn a_cherry_pick_that_changes_nothing_is_reported_and_leaves_no_operation() {
    let repo = ahead();
    repo.git(&["merge", "-q", "--ff-only", "topic"]);
    let picked = repo.git(&["rev-parse", "HEAD"]);

    let error = cherry_pick(&repo.path, &picked).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
}

#[test]
fn merge_commits_cannot_be_picked_or_reverted() {
    let repo = diverged();
    repo.git(&["merge", "-q", "--no-ff", "topic"]);
    let merged = repo.git(&["rev-parse", "HEAD"]);

    assert_eq!(
        cherry_pick(&repo.path, &merged).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        revert(&repo.path, &merged).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn a_clean_revert_adds_an_inverse_commit() {
    let repo = ahead();
    repo.git(&["merge", "-q", "--ff-only", "topic"]);
    let target = repo.git(&["rev-parse", "HEAD"]);

    let outcome = revert(&repo.path, &target).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(repo.read("b.txt"), "one\n");
    assert!(repo
        .git(&["log", "-1", "--format=%s"])
        .starts_with("Revert \"Topic two\""));
}

#[test]
fn a_conflicting_revert_enters_the_operation_state_and_continues() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "One");
    let middle = repo.commit("a.txt", "two\n", "Two");
    repo.commit("a.txt", "three\n", "Three");

    let outcome = revert(&repo.path, &middle).unwrap();

    assert_eq!(outcome, OperationOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Revert));
    repo.write("a.txt", "reverted\n");
    mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap();
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert!(repo
        .git(&["log", "-1", "--format=%s"])
        .starts_with("Revert \"Two\""));
}

struct Dirty {
    repo: Fixture,
    first: String,
}

fn dirty_history() -> Dirty {
    let repo = Fixture::init();
    repo.identity();
    let first = repo.commit("a.txt", "one\n", "One");
    repo.commit("a.txt", "two\n", "Two");
    repo.write("a.txt", "three\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "four\n");
    repo.write("scratch.txt", "keep\n");
    Dirty { repo, first }
}

#[test]
fn soft_reset_moves_the_branch_and_keeps_index_and_working_tree() {
    let Dirty { repo, first } = dirty_history();

    reset(&repo.path, &first, ResetMode::Soft).unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(repo.read("a.txt"), "four\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "three");
}

#[test]
fn mixed_reset_keeps_the_working_tree_and_unstages() {
    let Dirty { repo, first } = dirty_history();

    reset(&repo.path, &first, ResetMode::Mixed).unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(repo.read("a.txt"), "four\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "one");
}

#[test]
fn hard_reset_discards_tracked_changes_and_keeps_untracked_files() {
    let Dirty { repo, first } = dirty_history();

    reset(&repo.path, &first, ResetMode::Hard).unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), first);
    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.read("scratch.txt"), "keep\n");
    assert_eq!(
        repo.git(&["status", "--porcelain", "--untracked-files=no"]),
        ""
    );
}

#[test]
fn reset_accepts_a_branch_name_and_rejects_unknown_targets() {
    let repo = ahead();
    repo.git(&["switch", "-q", "topic"]);

    reset(&repo.path, "main", ResetMode::Hard).unwrap();

    assert_eq!(
        repo.git(&["rev-parse", "topic"]),
        repo.git(&["rev-parse", "main"])
    );
    assert_eq!(
        reset(&repo.path, "nope", ResetMode::Hard)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn reset_and_preview_accept_a_full_ref_name() {
    let repo = ahead();
    repo.git(&["tag", "start", "main"]);
    repo.git(&["switch", "-q", "topic"]);

    let preview = integration_preview(&repo.path, None, "refs/tags/start").unwrap();
    reset(&repo.path, "refs/tags/start", ResetMode::Hard).unwrap();

    assert_eq!(preview.outgoing.count, 2);
    assert_eq!(
        repo.git(&["rev-parse", "HEAD"]),
        repo.git(&["rev-parse", "main"])
    );
}
