mod common;

use std::fs;
use std::path::Path;

use common::Fixture;
use yforge_core::{
    patch_affected, patch_apply, patch_create, plan_discard, snapshot_files, undo, ErrorKind,
    Planned,
};

const BINARY_ONE: [u8; 6] = [0, 1, 2, 255, 254, 10];
const BINARY_TWO: [u8; 6] = [0, 9, 8, 255, 7, 10];
const BINARY_NEW: [u8; 5] = [0, 5, 5, 200, 1];

fn repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\ntwo\nthree\n", "First");
    repo.commit("gone.txt", "bye\n", "Second");
    repo.commit("old.txt", "renamed\n", "Third");
    fs::write(repo.path.join("data.bin"), BINARY_ONE).unwrap();
    repo.git(&["add", "data.bin"]);
    repo.git(&["commit", "-qm", "binary"]);
    repo
}

fn changed(repo: &Fixture) {
    repo.write("a.txt", "one\nTWO\nthree\n");
    fs::remove_file(repo.path.join("gone.txt")).unwrap();
    repo.git(&["mv", "old.txt", "new.txt"]);
    fs::write(repo.path.join("data.bin"), BINARY_TWO).unwrap();
    repo.write("fresh/untracked.txt", "untracked\n");
    fs::write(repo.path.join("fresh.bin"), BINARY_NEW).unwrap();
}

fn status(repo: &Fixture) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .expect("git status runs");
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

fn clone_at_head(repo: &Fixture) -> Fixture {
    let other = Fixture::init();
    other.identity();
    other.git(&["fetch", "-q", repo.path.to_str().unwrap(), "main"]);
    other.git(&["reset", "-q", "--hard", "FETCH_HEAD"]);
    other
}

fn restore(planned: Planned) -> yforge_core::UndoAction {
    match planned {
        Planned::Available(plan) => plan.action,
        Planned::Unavailable(reason) => panic!("expected an undo plan, got: {reason}"),
    }
}

#[test]
fn a_patch_of_the_working_directory_applies_elsewhere_with_binary_and_untracked_files() {
    let repo = repository();
    changed(&repo);
    let destination = repo.sibling("all.patch");

    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    patch_apply(&other.path, &destination).unwrap();

    assert_eq!(other.read("a.txt"), "one\nTWO\nthree\n");
    assert!(!other.path.join("gone.txt").exists());
    assert!(!other.path.join("old.txt").exists());
    assert_eq!(other.read("new.txt"), "renamed\n");
    assert_eq!(other.read("fresh/untracked.txt"), "untracked\n");
    assert_eq!(fs::read(other.path.join("data.bin")).unwrap(), BINARY_TWO);
    assert_eq!(fs::read(other.path.join("fresh.bin")).unwrap(), BINARY_NEW);
    assert_eq!(
        fs::read_to_string(&destination)
            .unwrap()
            .matches("GIT binary patch")
            .count(),
        2
    );
}

#[test]
fn creating_a_patch_leaves_the_repository_and_its_index_untouched() {
    let repo = repository();
    changed(&repo);
    let before = status(&repo);
    let destination = repo.sibling("untouched.patch");

    patch_create(&repo.path, None, &destination).unwrap();

    assert_eq!(status(&repo), before);
    assert!(!repo.path.join(".git/yforge-patch-index-0").exists());
}

#[test]
fn applying_leaves_the_result_unstaged_and_new_files_untracked() {
    let repo = repository();
    changed(&repo);
    let destination = repo.sibling("unstaged.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);

    patch_apply(&other.path, &destination).unwrap();

    assert_eq!(
        status(&other),
        " M a.txt\n M data.bin\n D gone.txt\n D old.txt\n?? fresh.bin\n?? fresh/untracked.txt\n?? new.txt"
    );
}

#[test]
fn a_patch_of_chosen_files_holds_only_those_files_including_untracked_ones() {
    let repo = repository();
    changed(&repo);
    let destination = repo.sibling("some.patch");

    patch_create(
        &repo.path,
        Some(&["a.txt".to_owned(), "fresh/untracked.txt".to_owned()]),
        &destination,
    )
    .unwrap();

    let other = clone_at_head(&repo);
    patch_apply(&other.path, &destination).unwrap();
    assert_eq!(status(&other), " M a.txt\n?? fresh/untracked.txt");
}

#[test]
fn a_patch_before_the_first_commit_holds_staged_and_untracked_files() {
    let repo = Fixture::init();
    repo.identity();
    repo.write("staged.txt", "s\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("loose.txt", "l\n");
    let destination = repo.sibling("unborn.patch");

    patch_create(&repo.path, None, &destination).unwrap();

    let other = Fixture::init();
    other.identity();
    patch_apply(&other.path, &destination).unwrap();
    assert_eq!(other.read("staged.txt"), "s\n");
    assert_eq!(other.read("loose.txt"), "l\n");
}

#[test]
fn a_patch_with_no_changes_is_refused_and_writes_nothing() {
    let repo = repository();
    let destination = repo.sibling("empty.patch");
    fs::write(&destination, "keep me").unwrap();

    let error = patch_create(&repo.path, None, &destination).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(
        error.to_string().contains("no changes to put in a patch"),
        "{error}"
    );
    assert_eq!(fs::read_to_string(&destination).unwrap(), "keep me");
    let listing: Vec<_> = fs::read_dir(destination.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        listing.iter().all(|name| !name.contains("yforge-partial")),
        "{listing:?}"
    );
}

#[test]
fn a_destination_that_is_not_absolute_is_refused() {
    let repo = repository();
    changed(&repo);

    let error = patch_create(&repo.path, None, Path::new("relative.patch")).unwrap_err();

    assert!(error.to_string().contains("must be absolute"), "{error}");
}

fn diverged_pair() -> (Fixture, Fixture, std::path::PathBuf) {
    let repo = repository();
    repo.write("a.txt", "one\nTWO\nthree\n");
    repo.write("extra.txt", "x\n");
    let destination = repo.sibling("conflict.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    other.write("a.txt", "one\nDIFFERENT\nthree\n");
    other.git(&["commit", "-qam", "diverge"]);
    (repo, other, destination)
}

#[test]
fn a_patch_that_would_conflict_is_refused_with_gits_message_and_nothing_changes() {
    let (_repo, other, destination) = diverged_pair();
    other.write("untouched.txt", "u\n");
    let before = status(&other);

    let error = patch_apply(&other.path, &destination).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert!(error.to_string().contains("with conflicts"), "{error}");
    assert_eq!(status(&other), before);
    assert_eq!(other.read("a.txt"), "one\nDIFFERENT\nthree\n");
    assert!(!other.path.join("extra.txt").exists());
    assert_eq!(other.git(&["ls-files", "--unmerged"]), "");
}

#[test]
fn a_patch_over_an_unstaged_edit_of_the_same_file_is_refused_and_nothing_changes() {
    let repo = repository();
    repo.write("a.txt", "one\nTWO\nthree\n");
    let destination = repo.sibling("dirty.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    other.write("a.txt", "one\ntwo\nthree\nlocal edit\n");
    let before = status(&other);

    let error = patch_apply(&other.path, &destination).unwrap_err();

    assert!(
        error.to_string().contains("does not match index"),
        "{error}"
    );
    assert_eq!(status(&other), before);
    assert_eq!(other.read("a.txt"), "one\ntwo\nthree\nlocal edit\n");
}

#[test]
fn a_patch_for_files_that_are_not_here_is_refused_and_nothing_changes() {
    let repo = repository();
    repo.write("a.txt", "one\nTWO\nthree\n");
    repo.git(&["rm", "-q", "gone.txt"]);
    let destination = repo.sibling("missing.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    other.git(&["rm", "-q", "gone.txt"]);
    other.git(&["commit", "-qm", "already gone"]);
    let before = status(&other);

    let error = patch_apply(&other.path, &destination).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert_eq!(status(&other), before);
    assert_eq!(other.read("a.txt"), "one\ntwo\nthree\n");
}

#[test]
fn a_file_that_is_not_a_patch_is_refused_with_gits_message() {
    let repo = repository();
    let not_a_patch = repo.sibling("notes.txt");
    fs::write(&not_a_patch, "just words\n").unwrap();

    let error = patch_apply(&repo.path, &not_a_patch).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert!(error.to_string().contains("No valid patches"), "{error}");
    assert_eq!(status(&repo), "");
}

#[test]
fn patch_affected_names_every_path_the_patch_touches_without_changing_anything() {
    let repo = repository();
    changed(&repo);
    let destination = repo.sibling("names.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    let before = status(&other);

    let paths = patch_affected(&other.path, &destination).unwrap();

    assert_eq!(
        paths,
        vec![
            "a.txt",
            "data.bin",
            "fresh.bin",
            "fresh/untracked.txt",
            "gone.txt",
            "new.txt",
            "old.txt"
        ]
    );
    assert_eq!(status(&other), before);
}

#[test]
fn undoing_an_applied_patch_restores_every_file_it_touched() {
    let repo = repository();
    changed(&repo);
    let destination = repo.sibling("undo.patch");
    patch_create(&repo.path, None, &destination).unwrap();
    let other = clone_at_head(&repo);
    let files = patch_affected(&other.path, &destination).unwrap();
    let snapshot = snapshot_files(&other.path, &files).unwrap();

    patch_apply(&other.path, &destination).unwrap();
    let action = restore(plan_discard(&other.path, snapshot).unwrap());
    undo(&other.path, &action).unwrap();

    assert_eq!(status(&other), "");
    assert_eq!(other.read("a.txt"), "one\ntwo\nthree\n");
    assert_eq!(other.read("gone.txt"), "bye\n");
    assert_eq!(fs::read(other.path.join("data.bin")).unwrap(), BINARY_ONE);
}
