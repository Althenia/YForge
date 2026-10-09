mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::Fixture;
use yforge_core::{
    create_worktree, integrate_worktree, list_worktrees, remove_worktree, repo_snapshot, stage_all,
    suggest_worktree_path, ChangeArea, ErrorKind, Operation, WorktreeIntegration,
};

fn ready() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "Base");
    repo
}

fn add(repo: &Fixture, branch: &str) -> PathBuf {
    let path = repo.sibling(&format!("repo-{branch}"));
    create_worktree(&repo.path, branch, true, None, &path).unwrap();
    path
}

#[test]
fn suggests_a_path_beside_the_repository_named_after_the_repository_and_branch() {
    let repo = ready();

    let suggested = suggest_worktree_path(&repo.path, "feature/login").unwrap();

    assert_eq!(
        PathBuf::from(&suggested),
        repo.sibling("repo-feature-login")
    );
    assert_eq!(
        suggest_worktree_path(&repo.path, "  ").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn creates_a_worktree_on_a_new_branch_at_a_start_point_or_on_an_existing_branch() {
    let repo = ready();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "Second");
    let fresh = repo.sibling("fresh");
    let from_start = repo.sibling("from-start");
    let existing = repo.sibling("existing");
    repo.git(&["branch", "old"]);

    create_worktree(&repo.path, "fresh", true, None, &fresh).unwrap();
    create_worktree(&repo.path, "early", true, Some(&first), &from_start).unwrap();
    create_worktree(&repo.path, "old", false, None, &existing).unwrap();

    assert_eq!(repo.run_in(&fresh, &["branch", "--show-current"]), "fresh");
    assert_eq!(repo.run_in(&from_start, &["rev-parse", "HEAD"]), first);
    assert_eq!(repo.run_in(&existing, &["branch", "--show-current"]), "old");
    assert!(fresh.join("b.txt").is_file() && !from_start.join("b.txt").exists());
}

#[test]
fn refuses_bad_names_taken_branches_and_occupied_destinations_without_creating_anything() {
    let repo = ready();
    let taken = add(&repo, "taken");
    let occupied = repo.sibling("occupied");
    fs::create_dir(&occupied).unwrap();
    fs::write(occupied.join("file"), "x").unwrap();
    let attempts: Vec<(&str, bool, PathBuf)> = vec![
        ("bad name", true, repo.sibling("one")),
        ("main", true, repo.sibling("two")),
        ("missing", false, repo.sibling("three")),
        ("taken", false, repo.sibling("four")),
        ("fresh", true, occupied.clone()),
        ("fresh", true, PathBuf::from("relative/dir")),
    ];

    for (branch, create, destination) in attempts {
        let error = create_worktree(&repo.path, branch, create, None, &destination).unwrap_err();
        assert_eq!(
            error.kind(),
            ErrorKind::InvalidRequest,
            "{branch} {destination:?}"
        );
    }

    assert_eq!(list_worktrees(&repo.path).unwrap().len(), 2);
    assert!(taken.is_dir());
    assert!(!repo.sibling("one").exists() && !repo.sibling("four").exists());
}

#[test]
fn lists_every_worktree_with_branch_head_dirty_locked_and_prunable() {
    let repo = ready();
    let clean = add(&repo, "clean");
    let dirty = add(&repo, "dirty");
    let locked = add(&repo, "locked");
    let gone = add(&repo, "gone");
    fs::write(dirty.join("a.txt"), "edited\n").unwrap();
    repo.git(&["worktree", "lock", locked.to_str().unwrap()]);
    fs::remove_dir_all(&gone).unwrap();
    let head = repo.git(&["rev-parse", "HEAD"]);

    let listed = list_worktrees(&repo.path).unwrap();

    let named = |branch: &str| {
        listed
            .iter()
            .find(|entry| entry.branch.as_deref() == Some(branch))
            .unwrap_or_else(|| panic!("no worktree for {branch}"))
    };
    assert_eq!(listed.len(), 5);
    let main = named("main");
    assert!(main.current && !main.dirty && !main.locked && !main.prunable);
    assert_eq!(main.head.as_deref(), Some(head.as_str()));
    assert!(!named("clean").dirty && !named("clean").current);
    assert_eq!(
        Path::new(&named("clean").path),
        clean.canonicalize().unwrap()
    );
    assert!(named("dirty").dirty);
    assert!(named("locked").locked && !named("locked").dirty);
    assert!(named("gone").prunable && !named("gone").dirty);
    repo.write("untracked.txt", "u\n");
    assert!(named_dirty(&repo, "main"));
}

fn named_dirty(repo: &Fixture, branch: &str) -> bool {
    list_worktrees(&repo.path)
        .unwrap()
        .iter()
        .find(|entry| entry.branch.as_deref() == Some(branch))
        .unwrap()
        .dirty
}

#[test]
fn removes_a_clean_worktree_but_keeps_its_branch() {
    let repo = ready();
    let path = add(&repo, "feature");

    remove_worktree(&repo.path, path.to_str().unwrap(), false).unwrap();

    assert!(!path.exists());
    assert_eq!(list_worktrees(&repo.path).unwrap().len(), 1);
    assert!(repo
        .git(&["branch", "--list", "feature"])
        .contains("feature"));
}

#[test]
fn removing_a_dirty_worktree_is_refused_with_a_typed_reason_unless_forced() {
    let repo = ready();
    let path = add(&repo, "feature");
    fs::write(path.join("a.txt"), "edited\n").unwrap();
    fs::write(path.join("new.txt"), "n\n").unwrap();

    let error = remove_worktree(&repo.path, path.to_str().unwrap(), false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::WorktreeDirty);
    assert!(path.join("new.txt").is_file());

    remove_worktree(&repo.path, path.to_str().unwrap(), true).unwrap();
    assert!(!path.exists());
}

#[test]
fn refuses_to_remove_the_main_the_current_or_a_locked_worktree() {
    let repo = ready();
    let linked = add(&repo, "linked");
    let locked = add(&repo, "locked");
    repo.git(&["worktree", "lock", locked.to_str().unwrap()]);

    for (from, target) in [
        (&repo.path, repo.path.to_str().unwrap()),
        (&linked, linked.to_str().unwrap()),
        (&linked, repo.path.to_str().unwrap()),
        (&repo.path, locked.to_str().unwrap()),
        (&repo.path, "/no/such/worktree"),
    ] {
        let error = remove_worktree(from, target, true).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{target}");
    }
    assert!(linked.is_dir() && locked.is_dir());
}

#[test]
fn removes_a_worktree_whose_directory_is_already_gone() {
    let repo = ready();
    let path = add(&repo, "gone");
    fs::remove_dir_all(&path).unwrap();

    remove_worktree(&repo.path, path.to_str().unwrap(), false).unwrap();

    assert_eq!(list_worktrees(&repo.path).unwrap().len(), 1);
}

fn scenario() -> (Fixture, PathBuf) {
    let repo = ready();
    let path = add(&repo, "feat");
    repo.commit("main.txt", "m1\n", "Main one");
    repo.commit_in(&path, "f1.txt", "f1\n", "Feature one");
    repo.commit_in(&path, "f2.txt", "f2\n", "Feature two");
    repo.commit("main2.txt", "m2\n", "Main two");
    (repo, path)
}

fn graph(repo: &Fixture) -> String {
    repo.git(&["log", "--graph", "--format=%s", "main", "feat"])
}

fn parent_counts(repo: &Fixture) -> Vec<usize> {
    repo.git(&["log", "--format=%P", "main"])
        .lines()
        .map(|line| line.split_whitespace().count())
        .collect()
}

#[test]
fn integrating_rebases_then_fast_forwards_exactly_like_the_terminal_commands() {
    let (repo, path) = scenario();
    let (terminal, terminal_path) = scenario();
    terminal.run_in(&terminal_path, &["rebase", "main"]);
    terminal.git(&["merge", "--ff-only", "feat"]);

    let outcome = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", false).unwrap();

    let tip = repo.git(&["rev-parse", "main"]);
    assert_eq!(
        outcome,
        WorktreeIntegration::Integrated {
            target_sha: tip.clone(),
            cleaned_up: false
        }
    );
    assert_eq!(repo.git(&["rev-parse", "feat"]), tip);
    assert_eq!(graph(&repo), graph(&terminal));
    assert_eq!(
        repo.git(&["rev-parse", "main^{tree}"]),
        terminal.git(&["rev-parse", "main^{tree}"])
    );
    assert_eq!(repo.git(&["rev-list", "--count", "main"]), "5");
    assert!(parent_counts(&repo).iter().all(|parents| *parents <= 1));
    assert_eq!(repo.git(&["rev-list", "--merges", "--count", "main"]), "0");
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert!(path.is_dir());
}

#[test]
fn integrating_with_cleanup_removes_the_worktree_and_deletes_its_branch() {
    let (repo, path) = scenario();
    let (terminal, terminal_path) = scenario();
    terminal.run_in(&terminal_path, &["rebase", "main"]);
    terminal.git(&["merge", "--ff-only", "feat"]);
    terminal.git(&["worktree", "remove", terminal_path.to_str().unwrap()]);
    terminal.git(&["branch", "-d", "feat"]);

    let outcome = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", true).unwrap();

    assert!(matches!(
        outcome,
        WorktreeIntegration::Integrated {
            cleaned_up: true,
            ..
        }
    ));
    assert!(!path.exists());
    assert_eq!(repo.git(&["branch", "--list", "feat"]), "");
    assert_eq!(list_worktrees(&repo.path).unwrap().len(), 1);
    assert_eq!(
        repo.git(&["log", "--graph", "--format=%s", "main"]),
        terminal.git(&["log", "--graph", "--format=%s", "main"])
    );
    assert_eq!(
        repo.git(&["branch", "--list"]),
        terminal.git(&["branch", "--list"])
    );
}

#[test]
fn a_rebase_conflict_leaves_the_worktree_in_the_rebase_state_and_can_be_finished_later() {
    let repo = ready();
    let path = add(&repo, "feat");
    repo.commit("a.txt", "main side\n", "Main edit");
    repo.commit_in(&path, "a.txt", "feature side\n", "Feature edit");
    let main_before = repo.git(&["rev-parse", "main"]);

    let outcome = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", true).unwrap();

    assert_eq!(
        outcome,
        WorktreeIntegration::Conflicts {
            worktree: path.canonicalize().unwrap().display().to_string()
        }
    );
    assert_eq!(
        repo_snapshot(&path).unwrap().operation,
        Some(Operation::Rebase)
    );
    assert_eq!(repo.git(&["rev-parse", "main"]), main_before);
    assert!(path.is_dir());

    let again = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", true).unwrap_err();
    assert_eq!(again.kind(), ErrorKind::OperationInProgress);

    fs::write(path.join("a.txt"), "resolved\n").unwrap();
    repo.run_in(&path, &["add", "a.txt"]);
    repo.run_in(&path, &["-c", "core.editor=true", "rebase", "--continue"]);
    let done = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", true).unwrap();

    assert!(matches!(
        done,
        WorktreeIntegration::Integrated {
            cleaned_up: true,
            ..
        }
    ));
    assert_eq!(repo.read("a.txt"), "resolved\n");
    assert_eq!(repo.git(&["rev-list", "--merges", "--count", "main"]), "0");
}

#[test]
fn integration_refuses_unsafe_starting_points_and_changes_nothing() {
    let (repo, path) = scenario();
    let main_before = repo.git(&["rev-parse", "main"]);
    let feat_before = repo.git(&["rev-parse", "feat"]);
    let worktree = path.to_str().unwrap();

    fs::write(path.join("a.txt"), "dirty\n").unwrap();
    let dirty = integrate_worktree(&repo.path, worktree, "main", false).unwrap_err();
    assert_eq!(dirty.kind(), ErrorKind::WorktreeDirty);
    repo.run_in(&path, &["checkout", "--", "a.txt"]);

    for (target, from) in [
        ("feat", worktree),
        ("missing", worktree),
        ("main", "/no/such/tree"),
    ] {
        let error = integrate_worktree(&repo.path, from, target, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{target} {from}");
    }
    repo.git(&["branch", "elsewhere"]);
    let unchecked = integrate_worktree(&repo.path, worktree, "elsewhere", false).unwrap_err();
    assert_eq!(unchecked.kind(), ErrorKind::InvalidRequest);
    repo.run_in(&path, &["switch", "-q", "--detach"]);
    let detached = integrate_worktree(&repo.path, worktree, "main", false).unwrap_err();
    assert_eq!(detached.kind(), ErrorKind::InvalidRequest);

    assert_eq!(repo.git(&["rev-parse", "main"]), main_before);
    assert_eq!(repo.git(&["rev-parse", "feat"]), feat_before);
}

#[test]
fn integration_is_refused_while_the_target_worktree_has_an_operation_in_progress() {
    let (repo, path) = scenario();
    repo.git(&["switch", "-q", "-c", "side"]);
    repo.commit("s.txt", "s\n", "Side");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "--no-commit", "--no-ff", "side"]);

    let error = integrate_worktree(&repo.path, path.to_str().unwrap(), "main", false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::OperationInProgress);
}

#[test]
fn a_snapshot_names_the_main_repository_root_from_the_main_and_from_every_linked_worktree() {
    let repo = ready();
    let first = add(&repo, "first");
    let second = add(&repo, "second");

    let from_main = repo_snapshot(&repo.path).unwrap();
    let from_first = repo_snapshot(&first).unwrap();
    let from_nested = repo_snapshot(&second.join(".")).unwrap();

    let main = repo.path.display().to_string();
    assert_eq!(from_main.main_root, main);
    assert_eq!(from_first.main_root, main);
    assert_eq!(from_nested.main_root, main);
    assert_ne!(from_first.root, main);
    let siblings: Vec<(&str, bool)> = from_first
        .worktrees
        .iter()
        .map(|worktree| (worktree.path.as_str(), worktree.current))
        .collect();
    assert_eq!(
        siblings,
        vec![
            (main.as_str(), false),
            (first.to_str().unwrap(), true),
            (second.to_str().unwrap(), false)
        ]
    );
}

#[test]
fn a_repository_without_linked_worktrees_is_its_own_main_root() {
    let repo = ready();

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(snapshot.main_root, snapshot.root);
}

fn nested(repo: &Fixture, branch: &str) -> PathBuf {
    let path = repo.path.join(".worktrees").join(branch);
    create_worktree(&repo.path, branch, true, None, &path).unwrap();
    path
}

fn untracked_paths(repo: &Fixture) -> Vec<String> {
    repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .filter(|change| change.area == ChangeArea::Untracked)
        .map(|change| change.path)
        .collect()
}

#[test]
fn a_linked_worktree_inside_the_repository_is_not_an_untracked_change() {
    let repo = ready();
    nested(&repo, "feature");
    nested(&repo, "feature-two");
    repo.write("notes.txt", "loose\n");

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(untracked_paths(&repo), vec!["notes.txt".to_owned()]);
    assert_eq!(snapshot.counts.untracked, 1);
    assert_eq!(snapshot.worktrees.len(), 3);
}

#[test]
fn a_linked_worktree_inside_the_repository_leaves_a_clean_repository_clean() {
    let repo = ready();
    nested(&repo, "feature");

    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert!(snapshot.files.is_empty());
    assert_eq!(snapshot.counts.total(), 0);
}

#[test]
fn files_in_an_ordinary_directory_that_shares_a_worktree_name_prefix_stay_untracked() {
    let repo = ready();
    nested(&repo, "feature");
    repo.write(".worktrees/feature-notes/todo.txt", "x\n");

    assert_eq!(
        untracked_paths(&repo),
        vec![".worktrees/feature-notes/todo.txt".to_owned()]
    );
}

#[test]
fn stage_all_does_not_stage_a_linked_worktree_inside_the_repository() {
    let repo = ready();
    nested(&repo, "feature");
    repo.write("notes.txt", "loose\n");

    stage_all(&repo.path).unwrap();

    let staged: Vec<String> = repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .filter(|change| change.area == ChangeArea::Staged)
        .map(|change| change.path)
        .collect();
    assert_eq!(staged, vec!["notes.txt".to_owned()]);
    assert!(!repo.git(&["ls-files", "--stage"]).contains("160000"));
}

#[test]
fn a_linked_worktree_opened_as_the_repository_shows_its_own_changes_only() {
    let repo = ready();
    let linked = nested(&repo, "feature");
    fs::write(linked.join("inside.txt"), "x\n").unwrap();

    let snapshot = repo_snapshot(&linked).unwrap();

    let untracked: Vec<_> = snapshot
        .files
        .iter()
        .filter(|change| change.area == ChangeArea::Untracked)
        .map(|change| change.path.as_str())
        .collect();
    assert_eq!(untracked, vec!["inside.txt"]);
}
