mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::sync::OnceLock;

use common::Fixture;
use yforge_core::{lfs_initialize, lfs_status, lfs_track, lfs_untrack, ErrorKind};

const FAKE_LFS: &str = r#"#!/bin/sh
if [ -e "$(git rev-parse --git-dir)/lfs-missing" ]; then
  echo "git: 'lfs' is not a git command." >&2
  exit 1
fi
case "$1" in
  version) echo "git-lfs/3.5.1 (Test; darwin arm64)" ;;
  install)
    git config --local filter.lfs.clean "git-lfs clean -- %f"
    git config --local filter.lfs.smudge "git-lfs smudge -- %f"
    git config --local filter.lfs.process "git-lfs filter-process"
    git config --local filter.lfs.required true
    ;;
  *) exit 2 ;;
esac
"#;

fn install_fake_git_lfs() {
    static INSTALLED: OnceLock<tempfile::TempDir> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("git-lfs");
        fs::write(&program, FAKE_LFS).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut entries = vec![dir.path().to_path_buf()];
        entries.extend(std::env::split_paths(&path));
        std::env::set_var("PATH", std::env::join_paths(entries).unwrap());
        dir
    });
}

fn repository() -> Fixture {
    install_fake_git_lfs();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo
}

fn without_lfs(repo: &Fixture) {
    fs::write(repo.path.join(".git/lfs-missing"), "").unwrap();
}

#[test]
fn reports_the_version_and_that_the_repository_is_not_initialized_yet() {
    let repo = repository();

    let status = lfs_status(&repo.path).unwrap();

    assert!(status.installed && !status.initialized);
    assert_eq!(status.version.as_deref(), Some("3.5.1"));
    assert!(status.patterns.is_empty());
}

#[test]
fn reports_that_git_lfs_is_not_installed_and_refuses_every_action() {
    let repo = repository();
    without_lfs(&repo);

    let status = lfs_status(&repo.path).unwrap();
    assert!(!status.installed);
    assert_eq!(status.version, None);

    for refused in [
        lfs_initialize(&repo.path),
        lfs_track(&repo.path, "*.psd"),
        lfs_untrack(&repo.path, "*.psd"),
    ] {
        assert_eq!(refused.unwrap_err().to_string(), "Git LFS is not installed");
    }
    assert!(!repo.path.join(".gitattributes").exists());
}

#[test]
fn initializing_installs_the_hooks_for_this_repository_only() {
    let repo = repository();

    lfs_initialize(&repo.path).unwrap();

    assert!(lfs_status(&repo.path).unwrap().initialized);
    assert_eq!(
        repo.git(&["config", "--local", "filter.lfs.required"]),
        "true"
    );
}

#[test]
fn tracking_and_untracking_edit_gitattributes_and_leave_the_change_unstaged() {
    let repo = repository();
    repo.write(".gitattributes", "*.txt text");

    lfs_track(&repo.path, "*.psd").unwrap();
    lfs_track(&repo.path, " assets/** ").unwrap();

    assert_eq!(
        repo.read(".gitattributes"),
        "*.txt text\n*.psd filter=lfs diff=lfs merge=lfs -text\nassets/** filter=lfs diff=lfs merge=lfs -text\n"
    );
    assert_eq!(
        lfs_status(&repo.path).unwrap().patterns,
        ["*.psd", "assets/**"]
    );
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert!(repo
        .git(&["status", "--porcelain"])
        .contains("?? .gitattributes"));

    lfs_untrack(&repo.path, "*.psd").unwrap();

    assert_eq!(
        repo.read(".gitattributes"),
        "*.txt text\nassets/** filter=lfs diff=lfs merge=lfs -text\n"
    );
    assert_eq!(lfs_status(&repo.path).unwrap().patterns, ["assets/**"]);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
}

#[test]
fn a_tracked_change_to_gitattributes_stays_unstaged() {
    let repo = repository();
    repo.commit(".gitattributes", "*.txt text\n", "Attributes");

    lfs_track(&repo.path, "*.bin").unwrap();

    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert_eq!(repo.git(&["diff", "--name-only"]), ".gitattributes");
}

#[test]
fn rejects_unusable_or_repeated_patterns() {
    let repo = repository();
    lfs_track(&repo.path, "*.psd").unwrap();

    for (outcome, expected) in [
        (lfs_track(&repo.path, "  "), ErrorKind::InvalidRequest),
        (
            lfs_track(&repo.path, "two words"),
            ErrorKind::InvalidRequest,
        ),
        (lfs_track(&repo.path, "#comment"), ErrorKind::InvalidRequest),
        (lfs_track(&repo.path, "*.psd"), ErrorKind::InvalidRequest),
        (lfs_untrack(&repo.path, "*.zip"), ErrorKind::InvalidRequest),
    ] {
        assert_eq!(outcome.unwrap_err().kind(), expected);
    }
    assert_eq!(lfs_status(&repo.path).unwrap().patterns, ["*.psd"]);
}
