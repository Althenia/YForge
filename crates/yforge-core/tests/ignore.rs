mod common;

use common::Fixture;
use yforge_core::{ignore_paths, repo_snapshot, ChangeArea, ErrorKind};

fn repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("tracked.txt", "t\n", "First");
    repo
}

fn gitignore(repo: &Fixture) -> String {
    repo.read(".gitignore")
}

#[test]
fn creates_the_gitignore_with_one_root_relative_pattern_per_file() {
    let repo = repository();
    repo.write("build/out.log", "x\n");
    repo.write("notes.txt", "n\n");

    ignore_paths(
        &repo.path,
        &["build/out.log".into(), "notes.txt".into()],
        false,
    )
    .unwrap();

    assert_eq!(gitignore(&repo), "/build/out.log\n/notes.txt\n");
    let files: Vec<_> = repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect();
    assert_eq!(
        files,
        vec![(".gitignore".to_owned(), ChangeArea::Untracked)]
    );
}

#[test]
fn appends_after_a_final_line_without_a_newline_and_keeps_existing_lines() {
    let repo = repository();
    repo.write(".gitignore", "target");

    ignore_paths(&repo.path, &["a.log".into()], false).unwrap();

    assert_eq!(gitignore(&repo), "target\n/a.log\n");
}

#[test]
fn skips_patterns_already_listed_and_duplicates_in_the_request() {
    let repo = repository();
    repo.write(".gitignore", "/a.log\r\n");

    ignore_paths(
        &repo.path,
        &["a.log".into(), "b.log".into(), "b.log".into()],
        false,
    )
    .unwrap();

    assert_eq!(gitignore(&repo), "/a.log\r\n/b.log\n");
    ignore_paths(&repo.path, &["a.log".into(), "b.log".into()], false).unwrap();
    assert_eq!(gitignore(&repo), "/a.log\r\n/b.log\n");
}

#[test]
fn escapes_characters_that_gitignore_reads_as_pattern_syntax() {
    let repo = repository();

    ignore_paths(
        &repo.path,
        &[
            "#hash.txt".into(),
            "!bang.txt".into(),
            "star*.txt".into(),
            "what?.txt".into(),
            "[set].txt".into(),
            "back\\slash".into(),
            "trail ".into(),
        ],
        false,
    )
    .unwrap();

    assert_eq!(
        gitignore(&repo),
        "/#hash.txt\n/!bang.txt\n/star\\*.txt\n/what\\?.txt\n/\\[set].txt\n/back\\\\slash\n/trail\\ \n"
    );
    for name in ["star*.txt", "[set].txt", "trail ", "starX.txt", "s.txt"] {
        repo.write(name, "x\n");
    }
    let visible = repo.git(&["ls-files", "-z", "--others", "--exclude-standard"]);
    let mut visible: Vec<&str> = visible
        .split('\0')
        .filter(|name| !name.is_empty())
        .collect();
    visible.sort_unstable();
    assert_eq!(visible, vec![".gitignore", "s.txt", "starX.txt"]);
}

#[test]
fn leaves_a_tracked_file_tracked_unless_untracking_was_confirmed() {
    let repo = repository();

    ignore_paths(&repo.path, &["tracked.txt".into()], false).unwrap();

    assert_eq!(repo.git(&["ls-files"]), "tracked.txt");
    assert_eq!(repo.read("tracked.txt"), "t\n");
}

#[test]
fn untracks_a_tracked_file_when_confirmed_and_keeps_it_on_disk() {
    let repo = repository();
    repo.write("tracked.txt", "edited\n");
    repo.git(&["add", "tracked.txt"]);
    repo.write("tracked.txt", "edited again\n");
    repo.write("loose.txt", "l\n");

    ignore_paths(
        &repo.path,
        &["tracked.txt".into(), "loose.txt".into()],
        true,
    )
    .unwrap();

    assert_eq!(repo.git(&["ls-files"]), "");
    assert_eq!(repo.read("tracked.txt"), "edited again\n");
    assert_eq!(repo.read("loose.txt"), "l\n");
    assert_eq!(gitignore(&repo), "/tracked.txt\n/loose.txt\n");
    let mut files: Vec<_> = repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect();
    files.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(
        files,
        vec![
            (".gitignore".to_owned(), ChangeArea::Untracked),
            ("tracked.txt".to_owned(), ChangeArea::Staged)
        ]
    );
}

#[test]
fn rejects_empty_escaping_and_line_break_paths_without_writing() {
    let repo = repository();
    for files in [
        vec![],
        vec!["../outside".to_owned()],
        vec!["two\nlines".to_owned()],
    ] {
        let error = ignore_paths(&repo.path, &files, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
    assert!(!repo.path.join(".gitignore").exists());
}
