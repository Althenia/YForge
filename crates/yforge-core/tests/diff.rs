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

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, false).unwrap();

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

    let staged = diff_file(&repo.path, "a.txt", ChangeArea::Staged, false).unwrap();
    let unstaged = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, false).unwrap();

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

    let diff = diff_file(&repo.path, "renamed.txt", ChangeArea::Staged, false).unwrap();

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

    let diff = diff_file(&repo.path, "notes/todo.md", ChangeArea::Untracked, false).unwrap();

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

    let diff = diff_file(&repo.path, "empty.txt", ChangeArea::Untracked, false).unwrap();

    assert!(!diff.binary);
    assert!(diff.hunks.is_empty());
}

#[test]
fn binary_files_are_detected_untracked_and_tracked() {
    let repo = ready_repository();
    repo.write("logo.png", "PNG\0\u{1}\u{2}");
    let untracked = diff_file(&repo.path, "logo.png", ChangeArea::Untracked, false).unwrap();
    assert!(untracked.binary);
    assert!(untracked.hunks.is_empty());

    repo.git(&["add", "logo.png"]);
    repo.git(&["commit", "-q", "-m", "Add logo"]);
    repo.write("logo.png", "PNG\0\u{3}\u{4}");
    let tracked = diff_file(&repo.path, "logo.png", ChangeArea::Unstaged, false).unwrap();
    assert!(tracked.binary);
    assert!(tracked.hunks.is_empty());
}

#[test]
fn binary_diffs_carry_the_byte_size_of_each_side_in_every_area() {
    let repo = ready_repository();
    repo.write("logo.png", "PNG\0\u{1}\u{2}");
    let untracked = diff_file(&repo.path, "logo.png", ChangeArea::Untracked, false).unwrap();
    assert_eq!((untracked.old_size, untracked.new_size), (None, Some(6)));

    repo.git(&["add", "logo.png"]);
    let added = diff_file(&repo.path, "logo.png", ChangeArea::Staged, false).unwrap();
    assert_eq!((added.old_size, added.new_size), (None, Some(6)));

    repo.git(&["commit", "-q", "-m", "Add logo"]);
    repo.write("logo.png", "PNG\0\u{3}\u{4}\u{5}");
    let unstaged = diff_file(&repo.path, "logo.png", ChangeArea::Unstaged, false).unwrap();
    assert_eq!((unstaged.old_size, unstaged.new_size), (Some(6), Some(7)));

    repo.git(&["add", "logo.png"]);
    repo.write("logo.png", "PNG\0");
    let staged = diff_file(&repo.path, "logo.png", ChangeArea::Staged, false).unwrap();
    assert_eq!((staged.old_size, staged.new_size), (Some(6), Some(7)));

    std::fs::remove_file(repo.path.join("logo.png")).unwrap();
    let deleted = diff_file(&repo.path, "logo.png", ChangeArea::Unstaged, false).unwrap();
    assert_eq!((deleted.old_size, deleted.new_size), (Some(7), None));
}

#[test]
fn text_diffs_carry_no_sizes() {
    let repo = ready_repository();
    repo.write("a.txt", "one\n2\nthree\n");

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, false).unwrap();

    assert!(!diff.binary);
    assert_eq!((diff.old_size, diff.new_size), (None, None));
}

#[test]
fn marks_lines_without_a_trailing_newline() {
    let repo = ready_repository();
    repo.write("a.txt", "one\ntwo\nthree");

    let diff = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, false).unwrap();

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
        diff_file(&repo.path, "a.txt", ChangeArea::Conflicted, false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        diff_file(&repo.path, "../a.txt", ChangeArea::Untracked, false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn ignore_whitespace_hides_whitespace_only_changes_and_keeps_real_ones() {
    let repo = ready_repository();
    repo.write("a.txt", "one\ntwo  \n   three\n");

    let plain = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, false).unwrap();
    let ignored = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, true).unwrap();
    assert_eq!(plain.hunks.len(), 1);
    assert!(ignored.hunks.is_empty());

    repo.write("a.txt", "one\ntwo  \n   3\n");
    let mixed = diff_file(&repo.path, "a.txt", ChangeArea::Unstaged, true).unwrap();
    let changed: Vec<(DiffLineKind, &str)> = mixed.hunks[0]
        .lines
        .iter()
        .filter(|line| line.kind != DiffLineKind::Context)
        .map(|line| (line.kind, line.text.trim()))
        .collect();
    assert_eq!(
        changed,
        vec![(DiffLineKind::Removed, "three"), (DiffLineKind::Added, "3")]
    );
}

fn oversized_text() -> String {
    (0..40_000)
        .map(|number| format!("line {number:05} {}\n", "x".repeat(50)))
        .collect()
}

#[test]
fn a_diff_over_two_megabytes_is_refused_with_its_size_in_every_area() {
    let repo = ready_repository();
    repo.write("a.txt", &oversized_text());
    repo.write("new.txt", &oversized_text());

    for (file, area) in [
        ("a.txt", ChangeArea::Unstaged),
        ("new.txt", ChangeArea::Untracked),
    ] {
        let error = diff_file(&repo.path, file, area, false).expect_err("refused");
        assert_eq!(error.kind(), ErrorKind::FileTooLarge, "{file}: {error:?}");
        assert!(
            yforge_core::ErrorPayload::from(error)
                .output
                .is_some_and(|size| size.parse::<u64>().is_ok_and(|size| size > 2 * 1024 * 1024)),
            "{file}"
        );
    }
    repo.git(&["add", "a.txt"]);
    let staged = diff_file(&repo.path, "a.txt", ChangeArea::Staged, false).expect_err("refused");
    assert_eq!(staged.kind(), ErrorKind::FileTooLarge);
}
