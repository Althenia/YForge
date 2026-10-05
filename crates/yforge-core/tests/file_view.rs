mod common;

use std::fs;

use common::Fixture;
use yforge_core::{file_at_revision, preview_file_bytes, ErrorKind, ErrorPayload, FileAtRevision};

const LIMIT: usize = 2 * 1024 * 1024;

fn ready_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\ntwo\n", "First");
    repo
}

fn text(content: &FileAtRevision) -> (&str, u64, &str) {
    match content {
        FileAtRevision::Text { text, size, eol } => (text, *size, eol),
        FileAtRevision::Binary { .. } => panic!("expected text, got {content:?}"),
    }
}

#[test]
fn reads_a_file_at_a_commit_by_full_or_abbreviated_sha() {
    let repo = ready_repository();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.commit("a.txt", "one\ntwo\nthree\n", "Second");

    let full = file_at_revision(&repo.path, "a.txt", &first).unwrap();
    let short = file_at_revision(&repo.path, "a.txt", &first[..8]).unwrap();

    assert_eq!(text(&full), ("one\ntwo\n", 8, "\n"));
    assert_eq!(full, short);
}

#[test]
fn index_and_worktree_revisions_return_their_own_content() {
    let repo = ready_repository();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "on disk\n");
    repo.write("new.txt", "untracked\n");

    let staged = file_at_revision(&repo.path, "a.txt", ":index").unwrap();
    let worktree = file_at_revision(&repo.path, "a.txt", ":worktree").unwrap();
    let untracked = file_at_revision(&repo.path, "new.txt", ":worktree").unwrap();

    assert_eq!(text(&staged), ("staged\n", 7, "\n"));
    assert_eq!(text(&worktree), ("on disk\n", 8, "\n"));
    assert_eq!(text(&untracked), ("untracked\n", 10, "\n"));
}

#[test]
fn reports_the_majority_line_ending() {
    let repo = ready_repository();
    repo.commit("dos.txt", "a\r\nb\r\nc\n", "Add dos");
    repo.write("mixed.txt", "a\nb\nc\r\n");
    repo.write("single.txt", "no newline");

    let dos = file_at_revision(&repo.path, "dos.txt", ":worktree").unwrap();
    let mixed = file_at_revision(&repo.path, "mixed.txt", ":worktree").unwrap();
    let single = file_at_revision(&repo.path, "single.txt", ":worktree").unwrap();

    assert_eq!(text(&dos).2, "\r\n");
    assert_eq!(text(&mixed).2, "\n");
    assert_eq!(text(&single).2, "\n");
}

#[test]
fn nul_bytes_and_invalid_utf8_are_binary_with_their_size() {
    let repo = ready_repository();
    fs::write(repo.path.join("logo.png"), b"PNG\0\x01\x02").unwrap();
    fs::write(repo.path.join("latin.txt"), b"caf\xe9\n").unwrap();
    repo.git(&["add", "logo.png", "latin.txt"]);
    repo.git(&["commit", "-q", "-m", "Add binaries"]);
    let head = repo.git(&["rev-parse", "HEAD"]);

    let png = file_at_revision(&repo.path, "logo.png", &head).unwrap();
    let latin = file_at_revision(&repo.path, "latin.txt", ":worktree").unwrap();

    assert_eq!(png, FileAtRevision::Binary { size: 6 });
    assert_eq!(latin, FileAtRevision::Binary { size: 5 });
}

#[test]
fn a_file_over_two_megabytes_is_refused_with_its_size_in_every_revision() {
    let repo = ready_repository();
    fs::write(repo.path.join("big.txt"), "a".repeat(LIMIT + 1)).unwrap();
    repo.git(&["add", "big.txt"]);
    repo.git(&["commit", "-q", "-m", "Add big"]);
    let head = repo.git(&["rev-parse", "HEAD"]);

    for revision in [head.as_str(), ":index", ":worktree"] {
        let error = file_at_revision(&repo.path, "big.txt", revision).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::FileTooLarge, "{revision}");
        let payload = ErrorPayload::from(error);
        assert_eq!(payload.output.as_deref(), Some("2097153"), "{revision}");
        assert!(payload.message.contains("2097153"), "{revision}");
    }
}

#[test]
fn a_file_of_exactly_two_megabytes_is_shown() {
    let repo = ready_repository();
    fs::write(repo.path.join("edge.txt"), "a".repeat(LIMIT)).unwrap();

    let edge = file_at_revision(&repo.path, "edge.txt", ":worktree").unwrap();

    assert_eq!(text(&edge).1, LIMIT as u64);
}

#[test]
fn files_that_do_not_exist_in_the_revision_are_invalid_requests() {
    let repo = ready_repository();
    repo.git(&["rm", "-q", "--cached", "a.txt"]);
    fs::create_dir(repo.path.join("dir")).unwrap();
    repo.commit("dir/inner.txt", "x\n", "Add dir");
    let head = repo.git(&["rev-parse", "HEAD"]);
    let first = repo.git(&["rev-parse", "HEAD~1"]);

    let cases = [
        ("a.txt", ":index"),
        ("missing.txt", ":worktree"),
        ("missing.txt", head.as_str()),
        ("dir", head.as_str()),
        ("dir", ":worktree"),
        ("dir/inner.txt", first.as_str()),
    ];
    for (file, revision) in cases {
        assert_eq!(
            file_at_revision(&repo.path, file, revision)
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidRequest,
            "{file} at {revision}"
        );
    }
}

#[test]
fn refuses_unsafe_paths_unknown_revisions_and_symlinks_that_leave_the_repository() {
    let repo = ready_repository();
    let outside = repo.sibling("outside.txt");
    fs::write(&outside, "secret\n").unwrap();
    std::os::unix::fs::symlink(&outside, repo.path.join("escape.txt")).unwrap();

    let refused = [
        ("../outside.txt", ":worktree"),
        ("/etc/hosts", ":worktree"),
        ("", ":worktree"),
        ("escape.txt", ":worktree"),
        ("a.txt", "HEAD"),
        ("a.txt", "--all"),
        ("a.txt", ""),
    ];
    for (file, revision) in refused {
        assert_eq!(
            file_at_revision(&repo.path, file, revision)
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidRequest,
            "{file:?} at {revision:?}"
        );
    }
}

#[test]
fn a_symlink_is_refused_even_when_it_points_inside_the_repository() {
    let repo = ready_repository();
    fs::create_dir(repo.path.join("real")).unwrap();
    fs::write(repo.path.join("real/inner.txt"), "x\n").unwrap();
    std::os::unix::fs::symlink("a.txt", repo.path.join("link.txt")).unwrap();
    std::os::unix::fs::symlink("real", repo.path.join("linked-dir")).unwrap();

    for file in ["link.txt", "linked-dir/inner.txt"] {
        assert_eq!(
            file_at_revision(&repo.path, file, ":worktree")
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidRequest,
            "{file}"
        );
    }
}

#[test]
fn a_directory_that_is_not_a_repository_is_a_typed_error() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(
        file_at_revision(dir.path(), "a.txt", ":worktree")
            .unwrap_err()
            .kind(),
        ErrorKind::NotARepository
    );
}

#[test]
fn preview_bytes_use_the_selected_revision_for_binary_assets_and_enforce_file_boundaries() {
    let repo = ready_repository();
    fs::create_dir(repo.path.join("assets")).unwrap();
    fs::write(repo.path.join("assets/logo.png"), b"old\0image").unwrap();
    repo.git(&["add", "assets/logo.png"]);
    repo.git(&["commit", "-q", "-m", "Add image"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    fs::write(repo.path.join("assets/logo.png"), b"new\0image").unwrap();

    assert_eq!(
        preview_file_bytes(&repo.path, "assets/logo.png", &head).unwrap(),
        b"old\0image"
    );
    assert_eq!(
        preview_file_bytes(&repo.path, "assets/logo.png", ":worktree").unwrap(),
        b"new\0image"
    );
    for unsafe_file in ["../a.txt", "/etc/hosts", "missing.png"] {
        assert_eq!(
            preview_file_bytes(&repo.path, unsafe_file, ":worktree")
                .unwrap_err()
                .kind(),
            ErrorKind::InvalidRequest
        );
    }
    fs::write(repo.path.join("assets/large.png"), vec![0; LIMIT + 1]).unwrap();
    assert_eq!(
        preview_file_bytes(&repo.path, "assets/large.png", ":worktree")
            .unwrap_err()
            .kind(),
        ErrorKind::FileTooLarge
    );
    std::os::unix::fs::symlink("logo.png", repo.path.join("assets/link.png")).unwrap();
    assert_eq!(
        preview_file_bytes(&repo.path, "assets/link.png", ":worktree")
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}
