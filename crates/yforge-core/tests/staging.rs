mod common;

use common::Fixture;
use yforge_core::{
    diff_file, discard_files, discard_hunk, repo_snapshot, stage_all, stage_files, stage_hunk,
    unstage_all, unstage_files, unstage_hunk, ChangeArea, ErrorKind,
};

fn areas(repo: &Fixture) -> Vec<(String, ChangeArea)> {
    repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect()
}

fn dirty_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "1\n", "First");
    repo.commit("gone.txt", "bye\n", "Second");
    repo.write("a.txt", "2\n");
    repo.write("new.txt", "n\n");
    std::fs::remove_file(repo.path.join("gone.txt")).unwrap();
    repo
}

fn two_hunk_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("f.txt", &[]);
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.numbered(
        "f.txt",
        &[(2, "second line changed"), (28, "line 28 changed")],
    );
    repo
}

#[test]
fn stages_and_unstages_modified_untracked_and_deleted_files() {
    let repo = dirty_repository();

    stage_files(
        &repo.path,
        &["a.txt".into(), "new.txt".into(), "gone.txt".into()],
    )
    .unwrap();

    let staged = areas(&repo);
    assert!(staged.iter().all(|(_, area)| *area == ChangeArea::Staged));
    assert_eq!(staged.len(), 3);

    unstage_files(&repo.path, &["a.txt".into(), "gone.txt".into()]).unwrap();

    let mixed = areas(&repo);
    assert!(mixed.contains(&("a.txt".into(), ChangeArea::Unstaged)));
    assert!(mixed.contains(&("gone.txt".into(), ChangeArea::Unstaged)));
    assert!(mixed.contains(&("new.txt".into(), ChangeArea::Staged)));
}

#[test]
fn stages_and_unstages_everything_including_a_first_commit_index() {
    let repo = dirty_repository();

    stage_all(&repo.path).unwrap();
    assert!(areas(&repo)
        .iter()
        .all(|(_, area)| *area == ChangeArea::Staged));

    unstage_all(&repo.path).unwrap();
    assert!(areas(&repo)
        .iter()
        .all(|(_, area)| *area != ChangeArea::Staged));

    let unborn = Fixture::init();
    unborn.write("first.txt", "x\n");
    stage_all(&unborn.path).unwrap();
    assert_eq!(
        areas(&unborn),
        vec![("first.txt".into(), ChangeArea::Staged)]
    );
    unstage_all(&unborn.path).unwrap();
    assert_eq!(
        areas(&unborn),
        vec![("first.txt".into(), ChangeArea::Untracked)]
    );
}

#[test]
fn refuses_to_stage_everything_while_files_are_conflicted() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("c.txt", "base\n", "Base");
    repo.git(&["checkout", "-q", "-b", "side"]);
    repo.commit("c.txt", "side\n", "Side");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("c.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "side"]);

    let error = stage_all(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(areas(&repo).contains(&("c.txt".into(), ChangeArea::Conflicted)));
}

#[test]
fn discards_tracked_changes_and_removes_untracked_files_only_when_listed() {
    let repo = dirty_repository();
    repo.write("keep-untracked.txt", "stay\n");

    discard_files(
        &repo.path,
        &["a.txt".into(), "gone.txt".into(), "new.txt".into()],
    )
    .unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert_eq!(repo.read("gone.txt"), "bye\n");
    assert!(!repo.path.join("new.txt").exists());
    assert_eq!(repo.read("keep-untracked.txt"), "stay\n");
    assert_eq!(
        areas(&repo),
        vec![("keep-untracked.txt".into(), ChangeArea::Untracked)]
    );
}

#[test]
fn discard_keeps_staged_content_and_rejects_files_without_a_discardable_change() {
    let repo = dirty_repository();
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "3\n");

    discard_files(&repo.path, &["a.txt".into()]).unwrap();
    assert_eq!(repo.read("a.txt"), "2\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "2");

    let error = discard_files(&repo.path, &["a.txt".into()]).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "2\n");
}

#[test]
fn rejects_empty_and_escaping_paths_before_running_git() {
    let repo = dirty_repository();
    for files in [
        vec![],
        vec!["../outside".to_owned()],
        vec!["/etc/hosts".to_owned()],
    ] {
        assert_eq!(
            stage_files(&repo.path, &files).unwrap_err().kind(),
            ErrorKind::InvalidRequest
        );
    }
}

#[test]
fn stages_one_hunk_and_leaves_the_others_unstaged() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged).unwrap();
    assert_eq!(diff.hunks.len(), 2);

    stage_hunk(&repo.path, "f.txt", &diff.hunks[0]).unwrap();

    let staged = repo.git(&["diff", "--cached"]);
    assert!(staged.contains("+second line changed"));
    assert!(!staged.contains("line 28 changed"));
    let unstaged = repo.git(&["diff"]);
    assert!(unstaged.contains("+line 28 changed"));
    assert!(!unstaged.contains("second line changed"));
    assert_eq!(
        repo.read("f.txt").lines().nth(1),
        Some("second line changed")
    );
    assert!(areas(&repo).contains(&("f.txt".into(), ChangeArea::Staged)));
    assert!(areas(&repo).contains(&("f.txt".into(), ChangeArea::Unstaged)));
}

#[test]
fn unstages_one_staged_hunk_and_keeps_the_other_staged() {
    let repo = two_hunk_repository();
    repo.git(&["add", "f.txt"]);
    let staged = diff_file(&repo.path, "f.txt", ChangeArea::Staged).unwrap();
    assert_eq!(staged.hunks.len(), 2);

    unstage_hunk(&repo.path, "f.txt", &staged.hunks[1]).unwrap();

    let cached = repo.git(&["diff", "--cached"]);
    assert!(cached.contains("+second line changed"));
    assert!(!cached.contains("line 28 changed"));
    assert!(repo.git(&["diff"]).contains("+line 28 changed"));
}

#[test]
fn discards_one_hunk_from_the_working_tree_only() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged).unwrap();

    discard_hunk(&repo.path, "f.txt", &diff.hunks[1]).unwrap();

    let contents = repo.read("f.txt");
    assert!(contents.contains("second line changed"));
    assert!(contents.contains("line 28\n"));
    assert!(!contents.contains("line 28 changed"));
    assert_eq!(repo.git(&["diff", "--cached"]), "");
}

#[test]
fn refuses_a_stale_hunk_without_touching_the_index_or_the_file() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged).unwrap();
    repo.numbered("f.txt", &[(2, "edited again"), (28, "line 28 changed")]);
    let before = repo.read("f.txt");

    for outcome in [
        stage_hunk(&repo.path, "f.txt", &diff.hunks[0]),
        discard_hunk(&repo.path, "f.txt", &diff.hunks[0]),
        unstage_hunk(&repo.path, "f.txt", &diff.hunks[0]),
    ] {
        let error = outcome.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::StaleHunk);
    }

    assert_eq!(repo.git(&["diff", "--cached"]), "");
    assert_eq!(repo.read("f.txt"), before);
}
