mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;

use common::Fixture;
use yforge_core::{
    operation_abort, operation_continue, rebase_interactive, rebase_plan, recompose_apply,
    recompose_preview, repo_snapshot, squash_commits, ErrorKind, Operation, OperationOutcome,
    RebaseOutcome, RebaseStep, RecomposeChange, RecomposeGroup, RecomposePreview,
};

struct Linear {
    repo: Fixture,
    base: String,
    shas: Vec<String>,
}

fn linear() -> Linear {
    let repo = Fixture::init();
    repo.identity();
    let base = repo.commit("a.txt", "base\n", "Base");
    let shas = vec![
        repo.commit("f1.txt", "one\n", "First"),
        repo.commit("f2.txt", "two\n", "Second"),
        repo.commit("f3.txt", "three\n", "Third"),
    ];
    Linear { repo, base, shas }
}

fn subjects(repo: &Fixture) -> Vec<String> {
    repo.git(&["log", "--format=%s"])
        .lines()
        .map(str::to_owned)
        .collect()
}

fn pick(sha: &str) -> RebaseStep {
    RebaseStep::Pick {
        sha: sha.to_owned(),
    }
}

fn reword(sha: &str, message: &str) -> RebaseStep {
    RebaseStep::Reword {
        sha: sha.to_owned(),
        message: message.to_owned(),
    }
}

fn squash(sha: &str, message: &str) -> RebaseStep {
    RebaseStep::Squash {
        sha: sha.to_owned(),
        message: message.to_owned(),
    }
}

fn fixup(sha: &str) -> RebaseStep {
    RebaseStep::Fixup {
        sha: sha.to_owned(),
    }
}

fn drop_step(sha: &str) -> RebaseStep {
    RebaseStep::Drop {
        sha: sha.to_owned(),
    }
}

fn edit(sha: &str) -> RebaseStep {
    RebaseStep::Edit {
        sha: sha.to_owned(),
    }
}

fn invalid_kind<T: std::fmt::Debug>(result: Result<T, yforge_core::CoreError>) -> ErrorKind {
    result.expect_err("the call is refused").kind()
}

#[test]
fn the_plan_lists_the_range_oldest_first_with_authors_and_flags() {
    let Linear { repo, base, shas } = linear();

    let plan = rebase_plan(&repo.path, &base[..10]).unwrap();

    assert_eq!(plan.base, base);
    let listed: Vec<&str> = plan.commits.iter().map(|todo| todo.sha.as_str()).collect();
    assert_eq!(listed, shas.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(plan.commits[0].summary, "First");
    assert_eq!(plan.commits[0].author.name, "Yui Lin");
    assert_eq!(plan.commits[0].author.initials, "YL");
    assert!(plan
        .commits
        .iter()
        .all(|todo| !todo.is_merge && !todo.pushed));
    assert!(!plan.pushed);
}

#[test]
fn the_plan_flags_merges_and_pushed_commits() {
    let Linear { repo, base, shas } = linear();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["switch", "-q", "-c", "topic", &shas[0]]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"]);
    let local = repo.commit("f4.txt", "four\n", "Fourth");

    let plan = rebase_plan(&repo.path, &base).unwrap();

    assert!(plan.pushed);
    let pushed: Vec<(&str, bool)> = plan
        .commits
        .iter()
        .map(|todo| (todo.summary.as_str(), todo.pushed))
        .collect();
    assert!(pushed.contains(&("First", true)));
    assert!(pushed.contains(&("Third", true)));
    assert!(pushed.contains(&("Topic", false)));
    assert!(pushed.contains(&("Merge topic", false)));
    assert!(pushed.contains(&("Fourth", false)));
    assert!(plan
        .commits
        .iter()
        .any(|todo| todo.is_merge && todo.summary == "Merge topic"));
    assert_eq!(plan.commits.last().unwrap().sha, local);
}

#[test]
fn the_plan_needs_an_ancestor_base_and_at_least_one_commit() {
    let Linear { repo, shas, .. } = linear();
    repo.git(&["switch", "-q", "-c", "side", &shas[0]]);
    let side = repo.commit("s.txt", "s\n", "Side");
    repo.git(&["switch", "-q", "main"]);

    assert_eq!(
        invalid_kind(rebase_plan(&repo.path, &shas[2])),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        invalid_kind(rebase_plan(&repo.path, &side)),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        invalid_kind(rebase_plan(&repo.path, "not-a-sha")),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn steps_reorder_the_commits() {
    let Linear { repo, base, shas } = linear();

    let result = rebase_interactive(
        &repo.path,
        &base,
        &[pick(&shas[2]), pick(&shas[0]), pick(&shas[1])],
    )
    .unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Completed);
    assert!(!result.pushed && !result.dropped_all);
    assert_eq!(subjects(&repo), ["Second", "First", "Third", "Base"]);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn reword_replaces_the_message_exactly_and_keeps_the_content() {
    let Linear { repo, base, shas } = linear();
    let message = "Reworded héllo\n\nBody with \"quotes\", $HOME, `ticks`, \\ and %s.";

    let result = rebase_interactive(
        &repo.path,
        &base,
        &[pick(&shas[0]), reword(&shas[1], message), pick(&shas[2])],
    )
    .unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Completed);
    assert_eq!(repo.git(&["log", "-1", "--format=%B", "HEAD~1"]), message);
    assert_eq!(
        subjects(&repo),
        ["Third", "Reworded héllo", "First", "Base"]
    );
    assert_eq!(repo.read("f2.txt"), "two\n");
}

#[test]
fn squash_combines_a_run_into_one_commit_with_the_given_message() {
    let Linear { repo, base, shas } = linear();

    let result = rebase_interactive(
        &repo.path,
        &base,
        &[
            pick(&shas[0]),
            squash(&shas[1], "Combined message"),
            squash(&shas[2], "Combined message"),
        ],
    )
    .unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Completed);
    assert_eq!(subjects(&repo), ["Combined message", "Base"]);
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD"]),
        "f1.txt\nf2.txt\nf3.txt"
    );
}

#[test]
fn squash_uses_the_message_of_the_last_squash_in_a_run() {
    let Linear { repo, base, shas } = linear();

    rebase_interactive(
        &repo.path,
        &base,
        &[
            pick(&shas[0]),
            squash(&shas[1], "Ignored draft"),
            squash(&shas[2], "Final message"),
        ],
    )
    .unwrap();

    assert_eq!(subjects(&repo), ["Final message", "Base"]);
}

#[test]
fn fixup_keeps_the_message_of_the_commit_it_joins() {
    let Linear { repo, base, shas } = linear();

    rebase_interactive(
        &repo.path,
        &base,
        &[pick(&shas[0]), fixup(&shas[1]), pick(&shas[2])],
    )
    .unwrap();

    assert_eq!(subjects(&repo), ["Third", "First", "Base"]);
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD~1"]),
        "f1.txt\nf2.txt"
    );
}

#[test]
fn a_reworded_head_followed_by_fixups_keeps_the_reworded_message() {
    let Linear { repo, base, shas } = linear();

    rebase_interactive(
        &repo.path,
        &base,
        &[
            reword(&shas[0], "New head"),
            fixup(&shas[1]),
            fixup(&shas[2]),
        ],
    )
    .unwrap();

    assert_eq!(subjects(&repo), ["New head", "Base"]);
}

#[test]
fn drop_removes_a_commit_and_a_commit_missing_from_the_steps_is_dropped() {
    let Linear { repo, base, shas } = linear();

    rebase_interactive(
        &repo.path,
        &base,
        &[pick(&shas[0]), drop_step(&shas[1]), pick(&shas[2])],
    )
    .unwrap();
    assert_eq!(subjects(&repo), ["Third", "First", "Base"]);
    assert!(!repo.path.join("f2.txt").exists());

    let head = repo.git(&["rev-parse", "HEAD"]);
    let first = repo.git(&["rev-parse", "HEAD~1"]);
    rebase_interactive(&repo.path, &base, &[pick(&first)]).unwrap();
    assert_eq!(subjects(&repo), ["First", "Base"]);
    assert_ne!(repo.git(&["rev-parse", "HEAD"]), head);
}

#[test]
fn an_empty_step_list_drops_every_commit_and_says_so() {
    let Linear { repo, base, .. } = linear();

    let result = rebase_interactive(&repo.path, &base, &[]).unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Completed);
    assert!(result.dropped_all);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), base);
    assert_eq!(subjects(&repo), ["Base"]);
}

#[test]
fn edit_stops_with_the_commit_named_and_continue_resumes() {
    let Linear { repo, base, shas } = linear();

    let result = rebase_interactive(
        &repo.path,
        &base,
        &[pick(&shas[0]), edit(&shas[1]), pick(&shas[2])],
    )
    .unwrap();

    assert_eq!(result.outcome, RebaseOutcome::StoppedToEdit);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Rebase));
    let detail = snapshot.operation_detail.unwrap();
    assert_eq!(detail.stopped_edit, Some(repo.git(&["rev-parse", "HEAD"])));
    assert_eq!(subjects(&repo), ["Second", "First", "Base"]);

    repo.write("extra.txt", "extra\n");
    repo.git(&["add", "extra.txt"]);
    repo.git(&["commit", "-q", "--amend", "--no-edit"]);
    let outcome = operation_continue(&repo.path, None).unwrap();

    assert_eq!(outcome, OperationOutcome::Completed);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, None);
    assert_eq!(subjects(&repo), ["Third", "Second", "First", "Base"]);
    assert_eq!(repo.read("extra.txt"), "extra\n");
}

#[test]
fn a_conflicting_reorder_stops_in_the_normal_rebase_state_and_abort_restores_history() {
    let repo = Fixture::init();
    repo.identity();
    let base = repo.commit("a.txt", "base\n", "Base");
    let first = repo.commit("a.txt", "one\n", "One");
    let second = repo.commit("a.txt", "two\n", "Two");
    let before = repo.git(&["rev-parse", "HEAD"]);

    let result = rebase_interactive(&repo.path, &base, &[pick(&second), pick(&first)]).unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Rebase));
    assert_eq!(snapshot.counts.conflicted, 1);
    assert_eq!(snapshot.operation_detail.unwrap().stopped_edit, None);

    operation_abort(&repo.path).unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn a_merge_commit_in_the_range_is_refused_and_nothing_changes() {
    let Linear { repo, base, shas } = linear();
    repo.git(&["switch", "-q", "-c", "topic", &shas[0]]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"]);
    let before = repo.git(&["rev-parse", "HEAD"]);

    let error = rebase_interactive(&repo.path, &base, &[pick(&shas[0])]).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::MergeCommitInRange);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
    assert_eq!(
        invalid_kind(squash_commits(
            &repo.path,
            &[shas[0].clone(), shas[1].clone()],
            "Squashed"
        )),
        ErrorKind::MergeCommitInRange
    );
}

#[test]
fn invalid_step_lists_are_refused_before_git_runs() {
    let Linear { repo, base, shas } = linear();
    let before = repo.git(&["rev-parse", "HEAD"]);
    let refused = |steps: Vec<RebaseStep>| {
        let error = rebase_interactive(&repo.path, &base, &steps).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{error}");
        assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
        assert_eq!(repo_snapshot(&repo.path).unwrap().operation, None);
    };

    refused(vec![squash(&shas[0], "Message"), pick(&shas[1])]);
    refused(vec![fixup(&shas[0]), pick(&shas[1])]);
    refused(vec![drop_step(&shas[0]), fixup(&shas[1]), pick(&shas[2])]);
    refused(vec![pick(&shas[0]), pick(&base)]);
    refused(vec![pick("deadbeef")]);
    refused(vec![pick("zzzz")]);
    refused(vec![pick(&shas[0]), pick(&shas[0])]);
    refused(vec![pick(&shas[0]), reword(&shas[1], "  \n")]);
    refused(vec![pick(&shas[0]), squash(&shas[1], "")]);
}

#[test]
fn a_rewrite_is_refused_while_another_operation_is_in_progress() {
    let repo = Fixture::init();
    repo.identity();
    let base = repo.commit("a.txt", "base\n", "Base");
    let first = repo.commit("a.txt", "one\n", "One");
    repo.commit("a.txt", "two\n", "Two");
    repo.git(&["switch", "-q", "-c", "other", &base]);
    repo.commit("a.txt", "other\n", "Other");
    repo.git(&["switch", "-q", "main"]);
    repo.git_expecting_conflict(&["merge", "other"]);

    let error = rebase_interactive(&repo.path, &base, &[pick(&first)]).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::OperationInProgress);
    assert_eq!(
        invalid_kind(squash_commits(&repo.path, &[first.clone(), first], "M")),
        ErrorKind::OperationInProgress
    );
    assert_eq!(
        invalid_kind(recompose_apply(&repo.path, &base, &[])),
        ErrorKind::OperationInProgress
    );
}

#[test]
fn a_rewrite_reports_whether_pushed_commits_were_rewritten() {
    let Linear { repo, base, shas } = linear();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let local = repo.commit("f4.txt", "four\n", "Fourth");

    let only_local =
        rebase_interactive(&repo.path, &shas[2], &[reword(&local, "Local reword")]).unwrap();
    assert!(!only_local.pushed);
    assert_eq!(subjects(&repo)[0], "Local reword");

    let head = repo.git(&["rev-parse", "HEAD"]);
    let through_pushed = rebase_interactive(
        &repo.path,
        &base,
        &[
            reword(&shas[0], "First reworded"),
            pick(&shas[1]),
            pick(&shas[2]),
            pick(&head),
        ],
    )
    .unwrap();
    assert!(through_pushed.pushed);
    assert_eq!(subjects(&repo)[3], "First reworded");
}

#[test]
fn squash_commits_merges_a_contiguous_range_ending_below_head() {
    let Linear { repo, shas, .. } = linear();
    let fourth = repo.commit("f4.txt", "four\n", "Fourth");

    let result = squash_commits(
        &repo.path,
        &[shas[2].clone(), shas[1].clone()],
        "Second and third",
    )
    .unwrap();

    assert_eq!(result.outcome, RebaseOutcome::Completed);
    assert_eq!(
        subjects(&repo),
        ["Fourth", "Second and third", "First", "Base"]
    );
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD~1"]),
        "f2.txt\nf3.txt"
    );
    assert_ne!(repo.git(&["rev-parse", "HEAD"]), fourth);
    assert_eq!(repo.read("f4.txt"), "four\n");
}

#[test]
fn squash_commits_refuses_gaps_singletons_unknown_commits_and_a_blank_message() {
    let Linear { repo, shas, .. } = linear();
    let before = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["switch", "-q", "-c", "side", &shas[0]]);
    let side = repo.commit("s.txt", "s\n", "Side");
    repo.git(&["switch", "-q", "main"]);

    let refused = |shas: &[String], message: &str| {
        let error = squash_commits(&repo.path, shas, message).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{error}");
        assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
    };

    refused(&[shas[0].clone(), shas[2].clone()], "Gap");
    refused(&[shas[1].clone()], "Single");
    refused(&[shas[1].clone(), shas[1].clone()], "Twice");
    refused(&[shas[1].clone(), shas[2].clone()], " ");
    refused(&[shas[1].clone(), side], "Elsewhere");
    refused(&[shas[1].clone(), "deadbeef".to_owned()], "Unknown");
    let root = repo.git(&["rev-list", "--max-parents=0", "HEAD"]);
    refused(&[root, shas[0].clone()], "From the root");
}

struct Regroup {
    repo: Fixture,
    base: String,
    head: String,
}

fn regroup() -> Regroup {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("a.txt", &[]);
    repo.write("b.txt", "b\n");
    repo.write("c.txt", "c\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    let base = repo.git(&["rev-parse", "HEAD"]);
    repo.numbered("a.txt", &[(2, "two!"), (25, "twenty-five!")]);
    repo.write("new.txt", "new\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Edit a and add new"]);
    repo.write("b.txt", "b changed\n");
    repo.git(&["rm", "-q", "c.txt"]);
    repo.git(&["commit", "-q", "-a", "-m", "Edit b and remove c"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    Regroup { repo, base, head }
}

fn file_change(path: &str) -> RecomposeChange {
    RecomposeChange::File {
        path: path.to_owned(),
    }
}

fn hunk_change(id: &str) -> RecomposeChange {
    RecomposeChange::Hunk { id: id.to_owned() }
}

fn lines_change(id: &str, lines: &[u32]) -> RecomposeChange {
    RecomposeChange::Lines {
        id: id.to_owned(),
        lines: lines.to_vec(),
    }
}

fn group(message: &str, changes: Vec<RecomposeChange>) -> RecomposeGroup {
    RecomposeGroup {
        message: message.to_owned(),
        changes,
    }
}

fn hunk_ids(preview: &RecomposePreview, path: &str) -> Vec<String> {
    preview
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap()
        .hunks
        .iter()
        .map(|hunk| hunk.id.clone())
        .collect()
}

#[test]
fn the_recompose_preview_lists_the_combined_diff_with_stable_hunk_ids() {
    let Regroup { repo, base, head } = regroup();

    let preview = recompose_preview(&repo.path, &base).unwrap();
    let again = recompose_preview(&repo.path, &base).unwrap();

    assert_eq!(preview, again);
    assert_eq!(preview.base, base);
    assert_eq!(preview.head, head);
    assert!(!preview.pushed);
    let paths: Vec<&str> = preview
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(paths, ["a.txt", "b.txt", "c.txt", "new.txt"]);
    let a = &preview.files[0];
    assert_eq!(a.hunks.len(), 2);
    assert!(!a.whole_file_only && !a.binary);
    assert_ne!(a.hunks[0].id, a.hunks[1].id);
    assert_eq!(a.hunks[0].hunk.old_start, 1);
    assert_eq!(preview.files[2].status, yforge_core::FileStatus::Deleted);
    assert_eq!(preview.files[3].status, yforge_core::FileStatus::Added);
}

fn oversized() -> Regroup {
    let repo = Fixture::init();
    repo.identity();
    repo.write("small.txt", "one\ntwo\nthree\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    let base = repo.git(&["rev-parse", "HEAD"]);
    repo.write("big.txt", &"payload line\n".repeat(200_000));
    repo.write("small.txt", "one\nTWO\nthree\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Add a big file and edit a small one"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    Regroup { repo, base, head }
}

#[test]
fn the_recompose_preview_sends_no_hunks_for_a_file_over_the_view_limit_and_says_why() {
    let Regroup { repo, base, .. } = oversized();

    let preview = recompose_preview(&repo.path, &base).unwrap();

    let big = preview
        .files
        .iter()
        .find(|file| file.path == "big.txt")
        .unwrap();
    assert!(big.hunks.is_empty());
    assert!(big.whole_file_only && !big.binary);
    let reason = big.hunks_omitted.as_deref().unwrap();
    assert!(reason.contains("2097152"), "{reason}");
    let small = preview
        .files
        .iter()
        .find(|file| file.path == "small.txt")
        .unwrap();
    assert_eq!(small.hunks.len(), 1);
    assert!(!small.whole_file_only);
    assert_eq!(small.hunks_omitted, None);
}

#[test]
fn recompose_assigns_a_file_over_the_view_limit_whole_and_keeps_the_final_tree() {
    let Regroup { repo, base, .. } = oversized();
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let small = hunk_ids(&preview, "small.txt");

    recompose_apply(
        &repo.path,
        &base,
        &[
            group("Add big", vec![file_change("big.txt")]),
            group("Edit small", vec![hunk_change(&small[0])]),
        ],
    )
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(subjects(&repo), ["Edit small", "Add big", "Base"]);
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD~1"]),
        "big.txt"
    );
}

#[test]
fn recompose_regroups_files_and_hunks_into_new_commits_with_the_same_final_tree() {
    let Regroup { repo, base, head } = regroup();
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let a = hunk_ids(&preview, "a.txt");

    let result = recompose_apply(
        &repo.path,
        &base,
        &[
            group(
                "Tweak a top",
                vec![hunk_change(&a[0]), file_change("new.txt")],
            ),
            group("Tweak a bottom", vec![hunk_change(&a[1])]),
            group(
                "Update b and drop c\n\nExplained.",
                vec![file_change("b.txt"), file_change("c.txt")],
            ),
        ],
    )
    .unwrap();

    assert_eq!(result.head, repo.git(&["rev-parse", "HEAD"]));
    assert_ne!(result.head, head);
    assert!(!result.pushed);
    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(
        subjects(&repo),
        [
            "Update b and drop c",
            "Tweak a bottom",
            "Tweak a top",
            "Base"
        ]
    );
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD~2"]),
        "a.txt\nnew.txt"
    );
    let top = repo.git(&["show", "--format=", "-U0", "HEAD~2", "--", "a.txt"]);
    assert!(top.contains("+two!") && !top.contains("twenty-five"));
    let bottom = repo.git(&["show", "--format=", "-U0", "HEAD~1"]);
    assert!(bottom.contains("+twenty-five!") && !bottom.contains("two!"));
    assert_eq!(
        repo.git(&["show", "--name-only", "--format=", "HEAD"]),
        "b.txt\nc.txt"
    );
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn recompose_splits_one_hunk_by_lines() {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("a.txt", &[]);
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    let base = repo.git(&["rev-parse", "HEAD"]);
    repo.numbered("a.txt", &[(5, "five!"), (7, "seven!")]);
    repo.git(&["commit", "-q", "-a", "-m", "Both"]);
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let ids = hunk_ids(&preview, "a.txt");
    assert_eq!(ids.len(), 1);
    let hunk = &preview.files[0].hunks[0].hunk;
    assert_eq!(hunk.lines.len(), 11);

    recompose_apply(
        &repo.path,
        &base,
        &[
            group("Line five", vec![lines_change(&ids[0], &[3, 4])]),
            group("Line seven", vec![lines_change(&ids[0], &[6, 7])]),
        ],
    )
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(subjects(&repo), ["Line seven", "Line five", "Base"]);
    let first = repo.git(&["show", "--format=", "-U0", "HEAD~1"]);
    assert!(first.contains("+five!") && !first.contains("seven!"));
    let second = repo.git(&["show", "--format=", "-U0", "HEAD"]);
    assert!(second.contains("+seven!") && !second.contains("five!"));
}

#[test]
fn recompose_splits_a_new_file_and_a_deleted_file_by_lines() {
    let repo = Fixture::init();
    repo.identity();
    repo.write("gone.txt", "g1\ng2\ng3\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    let base = repo.git(&["rev-parse", "HEAD"]);
    repo.write("fresh.txt", "n1\nn2\nn3\n");
    repo.git(&["rm", "-q", "gone.txt"]);
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Both"]);
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let fresh = hunk_ids(&preview, "fresh.txt");
    let gone = hunk_ids(&preview, "gone.txt");

    recompose_apply(
        &repo.path,
        &base,
        &[
            group(
                "Half of each",
                vec![lines_change(&fresh[0], &[0]), lines_change(&gone[0], &[0])],
            ),
            group(
                "The rest",
                vec![
                    lines_change(&fresh[0], &[1, 2]),
                    lines_change(&gone[0], &[1, 2]),
                ],
            ),
        ],
    )
    .unwrap();

    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(repo.git(&["show", "--format=", "HEAD~1:fresh.txt"]), "n1");
    assert_eq!(
        repo.git(&["show", "--format=", "HEAD~1:gone.txt"]),
        "g2\ng3"
    );
}

#[test]
fn recompose_refuses_unassigned_and_double_assigned_changes_naming_the_paths() {
    let Regroup { repo, base, head } = regroup();
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let a = hunk_ids(&preview, "a.txt");
    let refused = |groups: Vec<RecomposeGroup>| {
        let error = recompose_apply(&repo.path, &base, &groups).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{error}");
        assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
        assert_eq!(repo.git(&["status", "--porcelain"]), "");
        error.to_string()
    };

    let unassigned = refused(vec![group(
        "Some",
        vec![
            hunk_change(&a[0]),
            file_change("b.txt"),
            file_change("c.txt"),
        ],
    )]);
    assert!(
        unassigned.contains("a.txt") && unassigned.contains("new.txt"),
        "{unassigned}"
    );
    assert!(!unassigned.contains("b.txt"), "{unassigned}");

    let doubled = refused(vec![
        group("One", vec![file_change("a.txt"), file_change("new.txt")]),
        group(
            "Two",
            vec![
                hunk_change(&a[1]),
                file_change("b.txt"),
                file_change("c.txt"),
            ],
        ),
    ]);
    assert!(doubled.contains("a.txt"), "{doubled}");
    assert!(!doubled.contains("new.txt"), "{doubled}");
}

#[test]
fn recompose_refuses_malformed_groups() {
    let Regroup { repo, base, head } = regroup();
    let all: Vec<RecomposeChange> = ["a.txt", "b.txt", "c.txt", "new.txt"]
        .into_iter()
        .map(file_change)
        .collect();
    let refused = |groups: Vec<RecomposeGroup>| {
        let error = recompose_apply(&repo.path, &base, &groups).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{error}");
        assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    };

    refused(vec![]);
    refused(vec![group("  ", all.clone())]);
    refused(vec![group("Empty", vec![]), group("All", all.clone())]);
    refused(vec![group("Unknown", vec![file_change("nope.txt")])]);
    refused(vec![group("Unknown", vec![hunk_change("a.txt@9,9+9,9")])]);
    let first_hunk = recompose_preview(&repo.path, &base).unwrap().files[0].hunks[0]
        .id
        .clone();
    refused(vec![group(
        "Reaches",
        vec![lines_change(&first_hunk, &[99])],
    )]);
    refused(vec![group(
        "Context",
        vec![lines_change(&first_hunk, &[0])],
    )]);
}

#[test]
fn recompose_refuses_a_dirty_working_tree_and_a_dirty_index() {
    let Regroup { repo, base, head } = regroup();
    let groups = vec![group(
        "Everything",
        ["a.txt", "b.txt", "c.txt", "new.txt"]
            .into_iter()
            .map(file_change)
            .collect(),
    )];

    repo.write("b.txt", "dirty\n");
    let error = recompose_apply(&repo.path, &base, &groups).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::LocalChanges);
    repo.git(&["add", "b.txt"]);
    let error = recompose_apply(&repo.path, &base, &groups).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::LocalChanges);

    repo.git(&["reset", "-q", "--hard"]);
    recompose_apply(&repo.path, &base, &groups).unwrap();
    assert_ne!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(subjects(&repo), ["Everything", "Base"]);
}

#[test]
fn recompose_restores_the_recorded_head_when_a_commit_fails() {
    let Regroup { repo, base, head } = regroup();
    let hook = repo.path.join(".git/hooks/commit-msg");
    fs::write(
        &hook,
        "#!/bin/sh\nif grep -q reject \"$1\"; then echo refused by hook >&2; exit 1; fi\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let preview = recompose_preview(&repo.path, &base).unwrap();
    let a = hunk_ids(&preview, "a.txt");

    let error = recompose_apply(
        &repo.path,
        &base,
        &[
            group("Fine", vec![hunk_change(&a[0]), file_change("new.txt")]),
            group(
                "reject me",
                vec![
                    hunk_change(&a[1]),
                    file_change("b.txt"),
                    file_change("c.txt"),
                ],
            ),
        ],
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::CommitFailed);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert_eq!(repo.read("b.txt"), "b changed\n");
}

#[test]
fn recompose_reports_pushed_history_and_refuses_merges_and_empty_ranges() {
    let Regroup { repo, base, head } = regroup();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let all = |message: &str| {
        vec![group(
            message,
            ["a.txt", "b.txt", "c.txt", "new.txt"]
                .into_iter()
                .map(file_change)
                .collect(),
        )]
    };

    assert!(recompose_preview(&repo.path, &base).unwrap().pushed);
    assert_eq!(
        invalid_kind(recompose_apply(&repo.path, &head, &all("Nothing"))),
        ErrorKind::InvalidRequest
    );
    let result = recompose_apply(&repo.path, &base, &all("Squashed")).unwrap();
    assert!(result.pushed);
    assert_eq!(subjects(&repo), ["Squashed", "Base"]);

    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("t.txt", "t\n", "Topic");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("m.txt", "m\n", "Main");
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge topic", "topic"]);
    assert_eq!(
        invalid_kind(recompose_preview(&repo.path, &base)),
        ErrorKind::MergeCommitInRange
    );
    assert_eq!(
        invalid_kind(recompose_apply(&repo.path, &base, &all("Merged"))),
        ErrorKind::MergeCommitInRange
    );
}
