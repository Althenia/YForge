mod common;

use common::Fixture;
use yforge_core::{
    add_recent, load_recents, load_repo_settings, load_session, load_settings, recent_status,
    remove_recent, save_repo_settings, save_session, save_settings, AppSettings, Density,
    ErrorKind, PullMode, RepoSettings, TabSession, Theme,
};

#[test]
fn settings_default_then_persist_across_reloads() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(load_settings(dir.path()).unwrap(), AppSettings::default());

    let changed = AppSettings {
        theme: Theme::Light,
        density: Density::Compact,
        default_branch: " trunk ".to_owned(),
        pull_mode: PullMode::Rebase,
        auto_fetch_minutes: 30,
        editor_command: "code".to_owned(),
        terminal_command: "open -a iTerm".to_owned(),
    };
    save_settings(dir.path(), &changed).unwrap();

    let reloaded = load_settings(dir.path()).unwrap();
    assert_eq!(
        reloaded,
        AppSettings {
            default_branch: "trunk".to_owned(),
            ..changed
        }
    );
}

#[test]
fn invalid_settings_are_refused_and_leave_the_stored_file_alone() {
    let dir = tempfile::tempdir().unwrap();
    save_settings(dir.path(), &AppSettings::default()).unwrap();

    let branch = save_settings(
        dir.path(),
        &AppSettings {
            default_branch: "bad name".to_owned(),
            ..AppSettings::default()
        },
    )
    .unwrap_err();
    let interval = save_settings(
        dir.path(),
        &AppSettings {
            auto_fetch_minutes: 7,
            ..AppSettings::default()
        },
    )
    .unwrap_err();

    assert_eq!(branch.kind(), ErrorKind::InvalidRequest);
    assert_eq!(interval.kind(), ErrorKind::InvalidRequest);
    assert_eq!(load_settings(dir.path()).unwrap(), AppSettings::default());
}

#[test]
fn a_corrupt_settings_file_is_reported_not_replaced() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("settings.json"), "{not json").unwrap();

    let error = load_settings(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        "{not json"
    );
}

#[test]
fn recents_are_newest_first_deduplicated_and_removable() {
    let dir = tempfile::tempdir().unwrap();

    add_recent(dir.path(), "/a").unwrap();
    add_recent(dir.path(), "/b").unwrap();
    let again = add_recent(dir.path(), "/a").unwrap();
    let paths = |recents: &[yforge_core::RecentRepo]| {
        recents
            .iter()
            .map(|recent| recent.path.clone())
            .collect::<Vec<_>>()
    };

    assert_eq!(paths(&again), ["/a", "/b"]);
    assert!(again[0].opened_at > 0);
    let removed = remove_recent(dir.path(), "/a").unwrap();
    assert_eq!(paths(&removed), ["/b"]);
    assert_eq!(paths(&load_recents(dir.path()).unwrap()), ["/b"]);
}

#[test]
fn the_tab_session_and_repository_overrides_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(load_session(dir.path()).unwrap(), TabSession::default());

    let session = TabSession {
        tabs: vec!["/a".into(), "/b".into()],
        active: 1,
    };
    save_session(dir.path(), &session).unwrap();
    save_repo_settings(
        dir.path(),
        "/a",
        &RepoSettings {
            pull_mode: Some(PullMode::Rebase),
        },
    )
    .unwrap();

    assert_eq!(load_session(dir.path()).unwrap(), session);
    assert_eq!(
        load_repo_settings(dir.path(), "/a").unwrap().pull_mode,
        Some(PullMode::Rebase)
    );
    assert_eq!(
        load_repo_settings(dir.path(), "/b").unwrap(),
        RepoSettings::default()
    );
    save_repo_settings(dir.path(), "/a", &RepoSettings::default()).unwrap();
    assert_eq!(
        load_repo_settings(dir.path(), "/a").unwrap(),
        RepoSettings::default()
    );
}

#[test]
fn recent_status_summarises_a_repository_and_flags_a_missing_path() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.write("a.txt", "two\n");
    repo.write("new.txt", "n\n");

    let status = recent_status(&repo.path);
    let missing = recent_status(&repo.sibling("gone"));

    assert!(status.exists);
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(
        status
            .counts
            .map(|counts| (counts.modified, counts.untracked)),
        Some((1, 1))
    );
    assert_eq!(status.worktrees, 1);
    assert!(!missing.exists);
    assert_eq!(missing.branch, None);
}
