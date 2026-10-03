mod common;

use common::Fixture;
use yforge_core::tracked_files;

#[test]
fn lists_every_tracked_file_sorted_including_staged_additions_and_excluding_untracked_ones() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("b.txt", "b\n", "First");
    repo.commit("src/a.rs", "a\n", "Second");
    repo.write("staged.txt", "s\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("untracked.txt", "u\n");

    let files = tracked_files(&repo.path).unwrap();

    assert_eq!(files, ["b.txt", "src/a.rs", "staged.txt"]);
}

#[test]
fn a_repository_without_commits_has_no_tracked_files() {
    let repo = Fixture::init();

    assert!(tracked_files(&repo.path).unwrap().is_empty());
}

#[test]
fn a_folder_that_is_not_a_repository_is_refused() {
    let dir = tempfile::tempdir().unwrap();

    assert!(tracked_files(dir.path()).is_err());
}
