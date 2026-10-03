mod common;

use std::fs;

use common::Fixture;
use yforge_core::{
    changed_paths, create_file, delete_file, discard_all, file_editable, file_save, plan_discard,
    repo_snapshot, snapshot_files, undo, worktree_files, ChangeArea, ErrorKind, Planned,
};

fn repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.commit("dir/b.txt", "two\n", "Second");
    repo
}

fn areas(repo: &Fixture) -> Vec<(String, ChangeArea)> {
    repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect()
}

fn restore(planned: Planned) -> yforge_core::UndoAction {
    match planned {
        Planned::Available(plan) => plan.action,
        Planned::Unavailable(reason) => panic!("expected an undo plan, got: {reason}"),
    }
}

#[test]
fn create_file_makes_parent_folders_and_the_file_shows_as_untracked() {
    let repo = repository();

    create_file(&repo.path, "deep/er/new.txt").unwrap();

    assert_eq!(repo.read("deep/er/new.txt"), "");
    assert_eq!(
        areas(&repo),
        vec![("deep/er/new.txt".to_owned(), ChangeArea::Untracked)]
    );
}

#[test]
fn create_file_refuses_an_existing_path_with_that_reason_and_changes_nothing() {
    let repo = repository();

    let error = create_file(&repo.path, "a.txt").unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(
        error.to_string().contains("a.txt already exists"),
        "{error}"
    );
    assert_eq!(repo.read("a.txt"), "one\n");
    let folder = create_file(&repo.path, "dir").unwrap_err();
    assert!(
        folder.to_string().contains("dir already exists"),
        "{folder}"
    );
}

#[test]
fn create_file_refuses_a_path_that_runs_through_a_file_or_leaves_the_repository() {
    let repo = repository();

    let through = create_file(&repo.path, "a.txt/inner.txt").unwrap_err();
    let outside = create_file(&repo.path, "../escape.txt").unwrap_err();
    let inside_git = create_file(&repo.path, ".git/hooks/pre-commit").unwrap_err();

    assert!(through.to_string().contains("a.txt is a file"), "{through}");
    assert_eq!(outside.kind(), ErrorKind::InvalidRequest);
    assert!(inside_git.to_string().contains(".git"), "{inside_git}");
    assert_eq!(repo_snapshot(&repo.path).unwrap().files.len(), 0);
}

#[test]
fn delete_file_removes_a_tracked_file_and_undo_restores_its_content() {
    let repo = repository();
    repo.write("a.txt", "edited\n");
    let files = vec!["a.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();

    delete_file(&repo.path, "a.txt").unwrap();

    assert!(!repo.path.join("a.txt").exists());
    assert_eq!(
        areas(&repo),
        vec![("a.txt".to_owned(), ChangeArea::Unstaged)]
    );
    let action = restore(plan_discard(&repo.path, snapshot).unwrap());
    undo(&repo.path, &action).unwrap();
    assert_eq!(repo.read("a.txt"), "edited\n");
}

#[test]
fn delete_file_removes_an_untracked_file_and_undo_brings_it_back() {
    let repo = repository();
    repo.write("new/untracked.txt", "fresh\n");
    let files = vec!["new/untracked.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();

    delete_file(&repo.path, "new/untracked.txt").unwrap();

    assert!(!repo.path.join("new/untracked.txt").exists());
    assert!(areas(&repo).is_empty());
    undo(
        &repo.path,
        &restore(plan_discard(&repo.path, snapshot).unwrap()),
    )
    .unwrap();
    assert_eq!(repo.read("new/untracked.txt"), "fresh\n");
}

#[test]
fn delete_file_refuses_a_missing_file_and_a_folder() {
    let repo = repository();

    let missing = delete_file(&repo.path, "nope.txt").unwrap_err();
    let folder = delete_file(&repo.path, "dir").unwrap_err();

    assert!(
        missing.to_string().contains("nope.txt is not a file"),
        "{missing}"
    );
    assert!(folder.to_string().contains("dir is not a file"), "{folder}");
    assert_eq!(repo.read("dir/b.txt"), "two\n");
}

#[test]
fn worktree_files_lists_tracked_and_untracked_files_but_not_ignored_or_deleted_ones() {
    let repo = repository();
    repo.write(".gitignore", "ignored.log\n");
    repo.write("ignored.log", "x\n");
    repo.write("zeta.txt", "z\n");
    fs::remove_file(repo.path.join("a.txt")).unwrap();

    let files = worktree_files(&repo.path).unwrap();

    assert_eq!(files, vec![".gitignore", "dir/b.txt", "zeta.txt"]);
}

#[test]
fn file_editable_returns_the_text_with_its_line_ending() {
    let repo = repository();
    repo.write("crlf.txt", "a\r\nb\r\n");

    let lf = file_editable(&repo.path, "a.txt").unwrap();
    let crlf = file_editable(&repo.path, "crlf.txt").unwrap();

    assert_eq!(
        (lf.text.as_str(), lf.eol.as_str(), lf.size),
        ("one\n", "\n", 4)
    );
    assert_eq!((crlf.eol.as_str(), crlf.size), ("\r\n", 6));
}

#[test]
fn file_editable_refuses_binary_files_with_that_reason() {
    let repo = repository();
    fs::write(repo.path.join("image.bin"), [0u8, 159, 146, 150]).unwrap();
    fs::write(repo.path.join("latin.txt"), [0xe9u8, b'\n']).unwrap();

    let nul = file_editable(&repo.path, "image.bin").unwrap_err();
    let invalid = file_editable(&repo.path, "latin.txt").unwrap_err();

    assert_eq!(nul.kind(), ErrorKind::InvalidRequest);
    assert!(
        nul.to_string().contains("image.bin is a binary file"),
        "{nul}"
    );
    assert!(
        invalid.to_string().contains("latin.txt is a binary file"),
        "{invalid}"
    );
}

#[test]
fn file_editable_refuses_files_over_one_mebibyte_but_opens_exactly_one() {
    let repo = repository();
    fs::write(repo.path.join("exact.txt"), "a".repeat(1024 * 1024)).unwrap();
    fs::write(repo.path.join("big.txt"), "a".repeat(1024 * 1024 + 1)).unwrap();

    assert_eq!(
        file_editable(&repo.path, "exact.txt").unwrap().size,
        1_048_576
    );
    let error = file_editable(&repo.path, "big.txt").unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(
        error
            .to_string()
            .contains("big.txt is 1.0 MiB, over the 1 MiB limit"),
        "{error}"
    );
}

#[test]
fn file_editable_refuses_a_file_behind_a_symbolic_link() {
    let repo = repository();
    std::os::unix::fs::symlink("a.txt", repo.path.join("link.txt")).unwrap();

    let error = file_editable(&repo.path, "link.txt").unwrap_err();

    assert!(error.to_string().contains("symbolic link"), "{error}");
}

#[test]
fn file_save_writes_the_text_keeps_the_line_ending_and_shows_in_the_changes() {
    let repo = repository();
    repo.write("crlf.txt", "a\r\nb\r\n");
    repo.git(&["add", "crlf.txt"]);
    repo.git(&["commit", "-qm", "crlf"]);

    file_save(&repo.path, "crlf.txt", "a\nchanged\nc\n", "\r\n").unwrap();
    file_save(&repo.path, "a.txt", "one\nmore\n", "\n").unwrap();

    assert_eq!(repo.read("crlf.txt"), "a\r\nchanged\r\nc\r\n");
    assert_eq!(repo.read("a.txt"), "one\nmore\n");
    assert_eq!(
        areas(&repo),
        vec![
            ("a.txt".to_owned(), ChangeArea::Unstaged),
            ("crlf.txt".to_owned(), ChangeArea::Unstaged)
        ]
    );
}

#[test]
fn file_save_refuses_a_file_that_no_longer_exists() {
    let repo = repository();

    let error = file_save(&repo.path, "gone.txt", "x\n", "\n").unwrap_err();

    assert!(
        error.to_string().contains("gone.txt is not a file"),
        "{error}"
    );
    assert!(!repo.path.join("gone.txt").exists());
}

#[test]
fn discard_all_restores_index_and_work_tree_to_head_and_removes_untracked_files() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "staged then edited\n");
    repo.write("dir/b.txt", "unstaged\n");
    repo.write("brand/new.txt", "untracked\n");
    repo.write("added.txt", "added\n");
    repo.git(&["add", "added.txt"]);
    repo.git(&["mv", "dir/b.txt", "moved.txt"]);

    discard_all(&repo.path).unwrap();

    assert_eq!(repo.read("a.txt"), "one\n");
    assert_eq!(repo.read("dir/b.txt"), "two\n");
    assert!(!repo.path.join("brand").exists());
    assert!(!repo.path.join("added.txt").exists());
    assert!(!repo.path.join("moved.txt").exists());
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discard_all_keeps_ignored_files() {
    let repo = repository();
    repo.write(".gitignore", "ignored.log\n");
    repo.git(&["add", ".gitignore"]);
    repo.git(&["commit", "-qm", "ignore"]);
    repo.write("ignored.log", "keep\n");
    repo.write("a.txt", "edited\n");

    discard_all(&repo.path).unwrap();

    assert_eq!(repo.read("ignored.log"), "keep\n");
}

#[test]
fn discard_all_works_before_the_first_commit() {
    let repo = Fixture::init();
    repo.identity();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("b.txt", "untracked\n");

    discard_all(&repo.path).unwrap();

    assert!(!repo.path.join("a.txt").exists());
    assert!(!repo.path.join("b.txt").exists());
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn discard_all_refuses_while_an_operation_is_in_progress_and_changes_nothing() {
    let repo = repository();
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.commit("a.txt", "topic\n", "Topic");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "topic"]);
    let before = repo.git(&["status", "--porcelain"]);

    let error = discard_all(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(error.to_string().contains("merge"), "{error}");
    assert_eq!(repo.git(&["status", "--porcelain"]), before);
}

#[test]
fn discard_all_undo_restores_every_changed_file_including_untracked_ones() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "staged then edited\n");
    repo.write("brand/new.txt", "untracked\n");
    repo.git(&["mv", "dir/b.txt", "moved.txt"]);
    repo.write("moved.txt", "moved and edited\n");
    let files = changed_paths(&repo.path).unwrap();
    let snapshot = snapshot_files(&repo.path, &files).unwrap();

    discard_all(&repo.path).unwrap();
    let action = restore(plan_discard(&repo.path, snapshot).unwrap());
    undo(&repo.path, &action).unwrap();

    assert_eq!(repo.read("a.txt"), "staged then edited\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "staged");
    assert_eq!(repo.read("brand/new.txt"), "untracked\n");
    assert_eq!(repo.read("moved.txt"), "moved and edited\n");
    assert!(!repo.path.join("dir/b.txt").exists());
}

#[test]
fn changed_paths_lists_each_path_once_with_rename_origins() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "again\n");
    repo.git(&["mv", "dir/b.txt", "moved.txt"]);
    repo.write("new.txt", "n\n");

    let mut files = changed_paths(&repo.path).unwrap();
    files.sort();

    assert_eq!(files, vec!["a.txt", "dir/b.txt", "moved.txt", "new.txt"]);
}
