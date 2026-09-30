mod common;

use common::Fixture;
use yforge_core::{diff_file, ChangeArea, DiffLineKind, ErrorKind};

fn ready_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\ntwo\nthree\n", "First");
    repo
}

#[test]
fn unstaged_diff_lists_hunks_with_line_kinds_and_numbers() {
    let repo = ready_repository();
    repo.write("a.txt", "one\n2\nthree\n");

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged).unwrap();

    assert_eq!(diff.path, "a.txt");
    assert_eq!(diff.original_path, None);
    assert!(!diff.binary);
    assert_eq!(diff.hunks.len(), 1);
    let hunk = &diff.hunks[0];
    assert_eq!(
        (
            hunk.old_start,
            hunk.old_lines,
            hunk.new_start,
            hunk.new_lines
        ),
        (1, 3, 1, 3)
    );
    let lines: Vec<(DiffLineKind, Option<u32>, Option<u32>, &str)> = hunk
        .lines
        .iter()
        .map(|line| {
            (
                line.kind,
                line.old_number,
                line.new_number,
                line.text.as_str(),
            )
        })
        .collect();
    assert_eq!(
        lines,
        vec![
            (DiffLineKind::Context, Some(1), Some(1), "one"),
            (DiffLineKind::Removed, Some(2), None, "two"),
            (DiffLineKind::Added, None, Some(2), "2"),
            (DiffLineKind::Context, Some(3), Some(3), "three"),
        ]
    );
}

#[test]
fn staged_diff_shows_only_the_index_side() {
    let repo = ready_repository();
    repo.write("a.txt", "one\nstaged\nthree\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "one\nstaged\nthree\nworktree\n");

    let staged = diff_file(&repo.path, "a.txt", ChangeArea::Staged).unwrap();
    let unstaged = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged).unwrap();

    let added = |diff: &yforge_core::FileDiff| -> Vec<String> {
        diff.hunks[0]
            .lines
            .iter()
            .filter(|line| line.kind == DiffLineKind::Added)
            .map(|line| line.text.clone())
            .collect()
    };
    assert_eq!(added(&staged), vec!["staged"]);
    assert_eq!(added(&unstaged), vec!["worktree"]);
}

#[test]
fn staged_rename_reports_its_original_path() {
    let repo = ready_repository();
    repo.numbered("big.txt", &[]);
    repo.git(&["add", "big.txt"]);
    repo.git(&["commit", "-q", "-m", "Add big"]);
    repo.git(&["mv", "big.txt", "renamed.txt"]);
    repo.numbered("renamed.txt", &[(3, "line three edited")]);
    repo.git(&["add", "renamed.txt"]);

    let diff = diff_file(&repo.path, "renamed.txt", ChangeArea::Staged).unwrap();

    assert_eq!(diff.original_path.as_deref(), Some("big.txt"));
    assert_eq!(diff.hunks.len(), 1);
    assert!(diff.hunks[0]
        .lines
        .iter()
        .any(|line| line.kind == DiffLineKind::Added && line.text == "line three edited"));
}

#[test]
fn untracked_text_file_is_one_all_added_hunk() {
    let repo = ready_repository();
    repo.write("notes/todo.md", "first\nsecond\n");

    let diff = diff_file(&repo.path, "notes/todo.md", ChangeArea::Untracked).unwrap();

    assert!(!diff.binary);
    assert_eq!(diff.hunks.len(), 1);
    let hunk = &diff.hunks[0];
    assert_eq!((hunk.old_lines, hunk.new_start, hunk.new_lines), (0, 1, 2));
    assert!(hunk
        .lines
        .iter()
        .all(|line| line.kind == DiffLineKind::Added));
    assert_eq!(
        hunk.lines
            .iter()
            .map(|line| line.new_number)
            .collect::<Vec<_>>(),
        vec![Some(1), Some(2)]
    );
}

#[test]
fn untracked_empty_file_has_no_hunks() {
    let repo = ready_repository();
    repo.write("empty.txt", "");

    let diff = diff_file(&repo.path, "empty.txt", ChangeArea::Untracked).unwrap();

    assert!(!diff.binary);
    assert!(diff.hunks.is_empty());
}

#[test]
fn binary_files_are_detected_untracked_and_tracked() {
    let repo = ready_repository();
    repo.write("logo.png", "PNG\0\u{1}\u{2}");
    let untracked = diff_file(&repo.path, "logo.png", ChangeArea::Untracked).unwrap();
    assert!(untracked.binary);
    assert!(untracked.hunks.is_empty());

    repo.git(&["add", "logo.png"]);
    repo.git(&["commit", "-q", "-m", "Add logo"]);
    repo.write("logo.png", "PNG\0\u{3}\u{4}");
    let tracked = diff_file(&repo.path, "logo.png", ChangeArea::Unstaged).unwrap();
    assert!(tracked.binary);
    assert!(tracked.hunks.is_empty());
}

#[test]
fn marks_lines_without_a_trailing_newline() {
    let repo = ready_repository();
    repo.write("a.txt", "one\ntwo\nthree");

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged).unwrap();

    let flagged: Vec<&str> = diff.hunks[0]
        .lines
        .iter()
        .filter(|line| line.no_newline)
        .map(|line| line.text.as_str())
        .collect();
    assert_eq!(flagged, vec!["three"]);
}

#[test]
fn rejects_unconflicted_files_in_the_conflicted_area_and_paths_outside_the_repository() {
    let repo = ready_repository();

    assert_eq!(
        diff_file(&repo.path, "a.txt", ChangeArea::Conflicted)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        diff_file(&repo.path, "../a.txt", ChangeArea::Untracked)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}
