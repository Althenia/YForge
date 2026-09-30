mod common;

use common::Fixture;
use yforge_core::{
    diff_file, mark_resolved, operation_abort, operation_continue, operation_skip, repo_snapshot,
    ChangeArea, DiffLineKind, ErrorKind, Head, Operation, OperationOutcome, OperationStep,
};

const RESOLVED: &str = "resolved\n";

fn merge_conflict() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main edit");
    repo.git_expecting_conflict(&["merge", "topic"]);
    repo
}

fn rebase_conflict() -> (Fixture, String) {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.commit("b.txt", "base\n", "Base b");
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("a.txt", "topic a\n", "Topic a");
    let tip = repo.commit("b.txt", "topic b\n", "Topic b");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main a\n", "Main a");
    repo.commit("b.txt", "main b\n", "Main b");
    repo.git(&["switch", "-q", "topic"]);
    repo.git_expecting_conflict(&["rebase", "main"]);
    (repo, tip)
}

fn resolve(repo: &Fixture, file: &str) {
    repo.write(file, RESOLVED);
    mark_resolved(&repo.path, &[file.to_owned()]).unwrap();
}

#[test]
fn the_snapshot_describes_a_merge_in_progress() {
    let repo = merge_conflict();

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.operation, Some(Operation::Merge));
    assert_eq!(snapshot.counts.conflicted, 1);
    let detail = snapshot.operation_detail.unwrap();
    assert_eq!(detail.current, "main");
    assert_eq!(detail.incoming.as_deref(), Some("topic"));
    assert_eq!(detail.message, "Merge branch 'topic'");
    assert_eq!(detail.step, None);
    assert!(detail.resolved.is_empty());
}

#[test]
fn a_clean_repository_has_no_operation_detail() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");

    assert_eq!(repo_snapshot(&repo.path).unwrap().operation_detail, None);
}

#[test]
fn mark_resolved_refuses_files_that_still_contain_conflict_markers() {
    let repo = merge_conflict();
    assert!(repo.read("a.txt").contains("<<<<<<<"));

    let error = mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::ConflictMarkers);
    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 1);
}

#[test]
fn mark_resolved_stages_a_clean_file_and_lists_it_as_resolved() {
    let repo = merge_conflict();

    resolve(&repo, "a.txt");

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.counts.conflicted, 0);
    assert_eq!(snapshot.operation_detail.unwrap().resolved, vec!["a.txt"]);
}

#[test]
fn mark_resolved_only_accepts_conflicted_files_inside_the_repository() {
    let repo = merge_conflict();
    repo.write("other.txt", "x\n");

    for files in [
        vec!["other.txt".to_owned()],
        vec!["../a.txt".to_owned()],
        vec![],
    ] {
        let error = mark_resolved(&repo.path, &files).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{files:?}");
    }
}

#[test]
fn mark_resolved_stages_a_resolution_that_deletes_the_file() {
    let repo = merge_conflict();
    std::fs::remove_file(repo.path.join("a.txt")).unwrap();

    mark_resolved(&repo.path, &["a.txt".to_owned()]).unwrap();

    assert_eq!(repo_snapshot(&repo.path).unwrap().counts.conflicted, 0);
}

#[test]
fn a_merge_cannot_continue_while_files_are_conflicted() {
    let repo = merge_conflict();

    let error = operation_continue(&repo.path, Some("Merge topic")).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(
        repo_snapshot(&repo.path).unwrap().operation,
        Some(Operation::Merge)
    );
}

#[test]
fn continuing_a_resolved_merge_commits_it_with_the_given_message() {
    let repo = merge_conflict();
    resolve(&repo, "a.txt");

    let outcome = operation_continue(&repo.path, Some("  Merge topic into main  ")).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
    assert_eq!(
        repo.git(&["log", "-1", "--format=%s"]),
        "Merge topic into main"
    );
    assert_eq!(
        repo.git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split(' ')
            .count(),
        3
    );
}

#[test]
fn continuing_a_merge_without_a_message_keeps_the_default_message() {
    let repo = merge_conflict();
    resolve(&repo, "a.txt");

    operation_continue(&repo.path, None).unwrap();

    assert_eq!(
        repo.git(&["log", "-1", "--format=%s"]),
        "Merge branch 'topic'"
    );
}

#[test]
fn a_blank_merge_message_is_refused() {
    let repo = merge_conflict();
    resolve(&repo, "a.txt");

    let error = operation_continue(&repo.path, Some("   ")).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn aborting_a_merge_restores_the_pre_merge_state() {
    let repo = merge_conflict();

    operation_abort(&repo.path).unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, None);
    assert_eq!(snapshot.counts.total(), 0);
    assert_eq!(repo.read("a.txt"), "main\n");
}

#[test]
fn operations_need_an_operation_in_progress() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");

    assert_eq!(
        operation_continue(&repo.path, None).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        operation_skip(&repo.path).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        operation_abort(&repo.path).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn the_snapshot_reports_the_rebase_step_and_branch() {
    let (repo, _) = rebase_conflict();

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.operation, Some(Operation::Rebase));
    assert!(matches!(snapshot.head, Head::Detached { .. }));
    let detail = snapshot.operation_detail.unwrap();
    assert_eq!(detail.incoming.as_deref(), Some("topic"));
    assert_eq!(
        detail.step,
        Some(OperationStep {
            current: 1,
            total: 2
        })
    );
}

#[test]
fn continuing_a_rebase_advances_to_the_next_conflicting_step_then_completes() {
    let (repo, _) = rebase_conflict();
    resolve(&repo, "a.txt");

    let advanced = operation_continue(&repo.path, None).unwrap();

    assert_eq!(advanced, OperationOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(
        snapshot.operation_detail.unwrap().step,
        Some(OperationStep {
            current: 2,
            total: 2
        })
    );
    assert_eq!(snapshot.counts.conflicted, 1);

    resolve(&repo, "b.txt");
    let finished = operation_continue(&repo.path, None).unwrap();

    assert_eq!(finished, OperationOutcome::Completed);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, None);
    assert!(matches!(snapshot.head, Head::Branch { ref name, .. } if name == "topic"));
    assert_eq!(
        repo.git(&["log", "-3", "--format=%s"]),
        "Topic b\nTopic a\nMain b"
    );
}

#[test]
fn skipping_rebase_steps_drops_their_commits() {
    let (repo, _) = rebase_conflict();

    let first = operation_skip(&repo.path).unwrap();
    assert_eq!(first, OperationOutcome::Conflicts);
    let second = operation_skip(&repo.path).unwrap();

    assert_eq!(second, OperationOutcome::Completed);
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Main b");
}

#[test]
fn aborting_a_rebase_returns_to_the_original_branch_tip() {
    let (repo, tip) = rebase_conflict();

    operation_abort(&repo.path).unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, None);
    assert_eq!(
        snapshot.head,
        Head::Branch {
            name: "topic".into(),
            sha: tip
        }
    );
}

#[test]
fn only_a_rebase_can_skip() {
    let repo = merge_conflict();

    let error = operation_skip(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn cherry_pick_and_revert_conflicts_can_continue_or_abort() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "base\n", "Base");
    repo.git(&["switch", "-q", "-c", "topic"]);
    let picked = repo.commit("a.txt", "topic\n", "Topic edit");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main edit");
    repo.git_expecting_conflict(&["cherry-pick", &picked]);

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::CherryPick));
    assert_eq!(
        snapshot.operation_detail.unwrap().incoming,
        Some(format!("{} Topic edit", &picked[..7]))
    );
    resolve(&repo, "a.txt");
    assert_eq!(
        operation_continue(&repo.path, None).unwrap(),
        OperationOutcome::Completed
    );
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Topic edit");

    let to_revert = repo.git(&["rev-parse", "HEAD~1"]);
    repo.commit("a.txt", "later\n", "Later edit");
    repo.git_expecting_conflict(&["revert", "--no-edit", &to_revert]);
    assert_eq!(
        repo_snapshot(&repo.path).unwrap().operation,
        Some(Operation::Revert)
    );
    operation_abort(&repo.path).unwrap();
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
    assert_eq!(repo.read("a.txt"), "later\n");
}

#[test]
fn a_conflicted_file_shows_its_working_tree_content_with_markers_as_a_diff() {
    let repo = merge_conflict();

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Conflicted).unwrap();

    assert!(!diff.binary);
    let added: Vec<&str> = diff.hunks[0]
        .lines
        .iter()
        .filter(|line| line.kind == DiffLineKind::Added)
        .map(|line| line.text.as_str())
        .collect();
    assert_eq!(added.first().copied(), Some("<<<<<<< HEAD"));
    assert!(added.contains(&">>>>>>> topic"));
}
