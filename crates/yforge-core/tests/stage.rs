mod common;

use common::Fixture;
use yforge_core::{
    discard_files, discard_staged_files, plan_discard, plan_redo, repo_snapshot, snapshot_files,
    snapshots_list, undo, ChangeArea, ErrorKind, Planned,
};

fn areas(repo: &Fixture) -> Vec<(String, ChangeArea)> {
    repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect()
}

fn repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "1\n", "First");
    repo.commit("b.txt", "1\n", "Second");
    repo.commit("gone.txt", "bye\n", "Third");
    repo
}

#[test]
fn discarding_staged_files_restores_index_and_work_tree_from_head() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "staged then edited\n");
    repo.write("b.txt", "kept\n");
    repo.git(&["rm", "--quiet", "gone.txt"]);

    discard_staged_files(&repo.path, &["a.txt".into(), "gone.txt".into()]).unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert_eq!(repo.read("gone.txt"), "bye\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "1");
    assert_eq!(areas(&repo), vec![("b.txt".into(), ChangeArea::Unstaged)]);
    assert_eq!(repo.read("b.txt"), "kept\n");
}

#[test]
fn discarding_a_staged_new_file_removes_it_from_the_index_and_the_disk() {
    let repo = repository();
    repo.write("new.txt", "n\n");
    repo.git(&["add", "new.txt"]);

    discard_staged_files(&repo.path, &["new.txt".into()]).unwrap();

    assert!(!repo.path.join("new.txt").exists());
    assert!(areas(&repo).is_empty());
}

#[test]
fn discarding_a_staged_rename_restores_the_original_and_removes_the_new_name() {
    let repo = repository();
    repo.git(&["mv", "a.txt", "renamed.txt"]);

    discard_staged_files(&repo.path, &["renamed.txt".into(), "a.txt".into()]).unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert!(!repo.path.join("renamed.txt").exists());
    assert!(areas(&repo).is_empty());
}

#[test]
fn discarding_staged_files_before_the_first_commit_removes_them() {
    let repo = Fixture::init();
    repo.identity();
    repo.write("first.txt", "f\n");
    repo.git(&["add", "first.txt"]);

    discard_staged_files(&repo.path, &["first.txt".into()]).unwrap();

    assert!(!repo.path.join("first.txt").exists());
    assert!(areas(&repo).is_empty());
}

#[test]
fn discarding_a_mixed_selection_deletes_untracked_files_and_leaves_the_rest() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("loose.txt", "x\n");
    repo.write("other.txt", "y\n");

    discard_staged_files(&repo.path, &["a.txt".into(), "loose.txt".into()]).unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert!(!repo.path.join("loose.txt").exists());
    assert_eq!(repo.read("other.txt"), "y\n");
    assert_eq!(
        areas(&repo),
        vec![("other.txt".into(), ChangeArea::Untracked)]
    );
}

#[test]
fn discarding_staged_files_rejects_files_without_a_staged_or_untracked_change_and_changes_nothing()
{
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("b.txt", "unstaged only\n");

    let error = discard_staged_files(&repo.path, &["a.txt".into(), "b.txt".into()]).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "staged\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "staged");
    assert_eq!(repo.read("b.txt"), "unstaged only\n");
}

#[test]
fn discarding_staged_files_rejects_empty_and_escaping_paths() {
    let repo = repository();
    for files in [vec![], vec!["../outside".to_owned()], vec![String::new()]] {
        let error = discard_staged_files(&repo.path, &files).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
}

fn discard_with_undo_plan(repo: &Fixture, files: &[String]) -> yforge_core::UndoAction {
    let snapshot = snapshot_files(&repo.path, files).unwrap();
    discard_staged_files(&repo.path, files).unwrap();
    let Planned::Available(plan) = plan_discard(&repo.path, snapshot).unwrap() else {
        panic!("expected an undo plan");
    };
    plan.action
}

#[test]
fn discarding_staged_files_takes_a_snapshot_first() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    let before = snapshots_list(&repo.path).unwrap().len();

    discard_staged_files(&repo.path, &["a.txt".into()]).unwrap();

    assert_eq!(snapshots_list(&repo.path).unwrap().len(), before + 1);
}

#[test]
fn undo_restores_the_staged_version_and_the_different_work_tree_version() {
    let repo = repository();
    repo.write("a.txt", "A staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "B edited\n");
    let staged_entry = repo.git(&["ls-files", "--stage", "a.txt"]);

    let action = discard_with_undo_plan(&repo, &["a.txt".into()]);
    assert_eq!(repo.read("a.txt"), "1\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "1");

    undo(&repo.path, &action).unwrap();

    assert_eq!(repo.git(&["ls-files", "--stage", "a.txt"]), staged_entry);
    assert_eq!(repo.git(&["show", ":a.txt"]), "A staged");
    assert_eq!(repo.read("a.txt"), "B edited\n");
    assert_eq!(
        areas(&repo),
        vec![
            ("a.txt".into(), ChangeArea::Staged),
            ("a.txt".into(), ChangeArea::Unstaged)
        ]
    );
}

#[test]
fn undo_restores_a_staged_new_file_into_the_index_and_the_disk() {
    let repo = repository();
    repo.write("new.txt", "n\n");
    repo.git(&["add", "new.txt"]);
    let staged_entry = repo.git(&["ls-files", "--stage", "new.txt"]);

    let action = discard_with_undo_plan(&repo, &["new.txt".into()]);
    assert!(!repo.path.join("new.txt").exists());
    assert_eq!(repo.git(&["ls-files", "--stage", "new.txt"]), "");

    undo(&repo.path, &action).unwrap();

    assert_eq!(repo.read("new.txt"), "n\n");
    assert_eq!(repo.git(&["ls-files", "--stage", "new.txt"]), staged_entry);
    assert_eq!(areas(&repo), vec![("new.txt".into(), ChangeArea::Staged)]);
}

#[test]
fn undo_restores_a_staged_deletion_and_a_staged_rename() {
    let repo = repository();
    repo.git(&["rm", "--quiet", "gone.txt"]);
    repo.git(&["mv", "a.txt", "renamed.txt"]);
    let files: Vec<String> = ["gone.txt", "renamed.txt", "a.txt"].map(Into::into).into();
    let expected = areas(&repo);

    let action = discard_with_undo_plan(&repo, &files);
    assert!(areas(&repo).is_empty());

    undo(&repo.path, &action).unwrap();

    assert!(!repo.path.join("gone.txt").exists());
    assert_eq!(repo.read("renamed.txt"), "1\n");
    assert!(!repo.path.join("a.txt").exists());
    assert_eq!(areas(&repo), expected);
}

#[test]
fn undo_is_refused_when_the_index_changed_after_the_discard() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    let action = discard_with_undo_plan(&repo, &["a.txt".into()]);
    repo.write("a.txt", "later\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "1\n");

    let error = undo(&repo.path, &action).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.git(&["show", ":a.txt"]), "later");
}

#[test]
fn redoing_a_staged_discard_removes_the_staged_and_work_tree_changes_again() {
    let repo = repository();
    repo.write("a.txt", "A staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "B edited\n");
    let action = discard_with_undo_plan(&repo, &["a.txt".into()]);
    let redo = plan_redo(&repo.path, &action).unwrap();
    undo(&repo.path, &action).unwrap();

    undo(&repo.path, &redo.action).unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "1");
}

#[test]
fn discarding_unstaged_files_still_keeps_their_staged_content() {
    let repo = repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "edited\n");

    discard_files(&repo.path, &["a.txt".into()]).unwrap();

    assert_eq!(repo.read("a.txt"), "staged\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "staged");
}
