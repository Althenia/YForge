mod common;

use common::Fixture;
use rusqlite::Connection;
use yforge_core::{
    add_recent, list_ssh_keys, load_recents, load_repo_settings, load_session, load_settings,
    recent_status, remove_recent, save_repo_settings, save_session, save_settings, ssh_key_for,
    start_storage, AppSettings, Density, ErrorKind, PullMode, RepoSettings, TabSession, Theme,
};

fn database(dir: &std::path::Path) -> Connection {
    Connection::open(dir.join("yforge.db")).unwrap()
}

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
        telemetry_opt_in: true,
        ssh_key_path: None,
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
fn invalid_settings_are_refused_and_leave_the_stored_settings_alone() {
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
            ssh_key_path: None,
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

fn write_legacy_files(dir: &std::path::Path) {
    std::fs::write(
        dir.join("settings.json"),
        r#"{"theme":"dark","density":"compact","default_branch":"trunk","pull_mode":"rebase","auto_fetch_minutes":10,"editor_command":"code","terminal_command":"tmux"}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("repositories.json"),
        r#"{"/a":{"pull_mode":"rebase"}}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("recents.json"),
        r#"[{"path":"/b","opened_at":200},{"path":"/a","opened_at":100}]"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("session.json"),
        r#"{"tabs":["/a","/b"],"active":1}"#,
    )
    .unwrap();
}

const LEGACY_FILES: [&str; 4] = [
    "settings.json",
    "repositories.json",
    "recents.json",
    "session.json",
];

#[test]
fn legacy_json_files_are_imported_once_and_deleted_after_the_commit() {
    let dir = tempfile::tempdir().unwrap();
    write_legacy_files(dir.path());

    let settings = load_settings(dir.path()).unwrap();

    assert_eq!(settings.theme, Theme::Dark);
    assert_eq!(settings.default_branch, "trunk");
    assert_eq!(settings.editor_command, "code");
    assert!(!settings.telemetry_opt_in);
    let recents = load_recents(dir.path()).unwrap();
    assert_eq!(
        recents
            .iter()
            .map(|recent| (recent.path.as_str(), recent.opened_at))
            .collect::<Vec<_>>(),
        [("/b", 200), ("/a", 100)]
    );
    assert_eq!(
        load_session(dir.path()).unwrap(),
        TabSession {
            tabs: vec!["/a".into(), "/b".into()],
            active: 1
        }
    );
    assert_eq!(
        load_repo_settings(dir.path(), "/a").unwrap().pull_mode,
        Some(PullMode::Rebase)
    );
    for name in LEGACY_FILES {
        assert!(!dir.path().join(name).exists(), "{name} should be deleted");
    }
    let stored: i64 = database(dir.path())
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stored, 9);
}

#[test]
fn a_corrupt_legacy_file_is_reported_by_name_and_nothing_is_imported_or_deleted() {
    let dir = tempfile::tempdir().unwrap();
    write_legacy_files(dir.path());
    std::fs::write(dir.path().join("recents.json"), "{not json").unwrap();

    let error = load_settings(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("recents.json"), "{error}");
    for name in LEGACY_FILES {
        assert!(dir.path().join(name).exists(), "{name} must stay in place");
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("recents.json")).unwrap(),
        "{not json"
    );
    let imported: i64 = database(dir.path())
        .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
        .unwrap();
    assert_eq!(imported, 0);
}

#[test]
fn legacy_files_stay_when_the_database_cannot_be_opened() {
    let dir = tempfile::tempdir().unwrap();
    write_legacy_files(dir.path());
    std::fs::create_dir(dir.path().join("yforge.db")).unwrap();

    let error = load_settings(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    for name in LEGACY_FILES {
        assert!(dir.path().join(name).exists(), "{name} must stay in place");
    }
}

#[test]
fn reopening_keeps_the_schema_version_data_and_wal_journal() {
    let dir = tempfile::tempdir().unwrap();
    save_settings(
        dir.path(),
        &AppSettings {
            theme: Theme::Dark,
            ..AppSettings::default()
        },
    )
    .unwrap();

    start_storage(dir.path()).unwrap();
    start_storage(dir.path()).unwrap();

    assert_eq!(load_settings(dir.path()).unwrap().theme, Theme::Dark);
    let connection = database(dir.path());
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    let journal: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 4);
    assert_eq!(journal, "wal");
}

#[test]
fn an_invalid_stored_setting_is_an_error_naming_its_key_and_unknown_keys_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    save_settings(dir.path(), &AppSettings::default()).unwrap();
    let connection = database(dir.path());
    connection
        .execute(
            "INSERT INTO settings (key, value) VALUES ('future.option', '1')",
            [],
        )
        .unwrap();
    assert_eq!(load_settings(dir.path()).unwrap(), AppSettings::default());

    connection
        .execute(
            "UPDATE settings SET value = '\"neon\"' WHERE key = 'appearance.theme'",
            [],
        )
        .unwrap();
    let error = load_settings(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("appearance.theme"), "{error}");
}

#[test]
fn a_database_from_a_newer_version_is_refused_not_recreated() {
    let dir = tempfile::tempdir().unwrap();
    save_settings(dir.path(), &AppSettings::default()).unwrap();
    database(dir.path())
        .pragma_update(None, "user_version", 99)
        .unwrap();

    let error = load_settings(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("yforge.db"), "{error}");
}

#[test]
fn start_storage_stops_on_a_corrupt_state_file_and_leaves_it_untouched() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("yforge.db"), vec![7_u8; 4096]).unwrap();

    let error = start_storage(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("yforge.db"), "{error}");
    assert_eq!(
        std::fs::read(dir.path().join("yforge.db")).unwrap(),
        vec![7_u8; 4096]
    );
}

#[test]
fn start_storage_migrates_an_existing_unversioned_file_without_leaving_the_safety_copy() {
    let dir = tempfile::tempdir().unwrap();
    database(dir.path())
        .execute_batch("CREATE TABLE keepsake (value TEXT); INSERT INTO keepsake VALUES ('kept');")
        .unwrap();

    start_storage(dir.path()).unwrap();

    let connection = database(dir.path());
    let kept: String = connection
        .query_row("SELECT value FROM keepsake", [], |row| row.get(0))
        .unwrap();
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!((kept.as_str(), version), ("kept", 4));
    assert!(!dir.path().join("yforge.db.pre-migration").exists());
}

fn key_file(dir: &std::path::Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, "private").unwrap();
    path.display().to_string()
}

#[test]
fn the_repository_ssh_key_wins_over_the_app_key_and_either_can_be_cleared() {
    let dir = tempfile::tempdir().unwrap();
    let app_key = key_file(dir.path(), "id_app");
    let repo_key = key_file(dir.path(), "id_repo");
    assert_eq!(ssh_key_for(dir.path(), "/repo").unwrap(), None);

    save_settings(
        dir.path(),
        &AppSettings {
            ssh_key_path: Some(app_key.clone()),
            ..AppSettings::default()
        },
    )
    .unwrap();
    assert_eq!(
        load_settings(dir.path()).unwrap().ssh_key_path,
        Some(app_key.clone())
    );
    assert_eq!(
        ssh_key_for(dir.path(), "/repo").unwrap(),
        Some(app_key.clone().into())
    );

    save_repo_settings(
        dir.path(),
        "/repo",
        &RepoSettings {
            ssh_key_path: Some(repo_key.clone()),
            ..RepoSettings::default()
        },
    )
    .unwrap();
    assert_eq!(
        load_repo_settings(dir.path(), "/repo")
            .unwrap()
            .ssh_key_path,
        Some(repo_key.clone())
    );
    assert_eq!(
        ssh_key_for(dir.path(), "/repo").unwrap(),
        Some(repo_key.into())
    );
    assert_eq!(
        ssh_key_for(dir.path(), "/other").unwrap(),
        Some(app_key.into())
    );

    save_repo_settings(dir.path(), "/repo", &RepoSettings::default()).unwrap();
    save_settings(dir.path(), &AppSettings::default()).unwrap();
    assert_eq!(ssh_key_for(dir.path(), "/repo").unwrap(), None);
}

#[test]
fn an_ssh_key_setting_must_be_an_existing_absolute_file_and_blank_means_the_agent() {
    let dir = tempfile::tempdir().unwrap();
    for bad in [
        "relative/key",
        "/no/such/key",
        &dir.path().display().to_string(),
    ] {
        let app = save_settings(
            dir.path(),
            &AppSettings {
                ssh_key_path: Some(bad.to_owned()),
                ..AppSettings::default()
            },
        );
        let repo = save_repo_settings(
            dir.path(),
            "/repo",
            &RepoSettings {
                ssh_key_path: Some(bad.to_owned()),
                ..RepoSettings::default()
            },
        );
        assert_eq!(app.unwrap_err().kind(), ErrorKind::InvalidRequest, "{bad}");
        assert_eq!(repo.unwrap_err().kind(), ErrorKind::InvalidRequest, "{bad}");
    }

    save_settings(
        dir.path(),
        &AppSettings {
            ssh_key_path: Some("  ".to_owned()),
            ..AppSettings::default()
        },
    )
    .unwrap();
    assert_eq!(load_settings(dir.path()).unwrap().ssh_key_path, None);
}

#[test]
fn lists_only_private_keys_that_have_a_public_sibling() {
    let ssh = tempfile::tempdir().unwrap();
    for (name, content) in [
        ("id_ed25519", "private"),
        ("id_ed25519.pub", "ssh-ed25519 AAAA me@host"),
        ("id_rsa", "private"),
        ("orphan.pub", "ssh-rsa BBBB x"),
        ("known_hosts", "host key"),
        ("work", "private"),
        ("work.pub", "ssh-rsa CCCC work"),
    ] {
        std::fs::write(ssh.path().join(name), content).unwrap();
    }
    std::fs::create_dir(ssh.path().join("dir")).unwrap();
    std::fs::create_dir(ssh.path().join("dir.pub")).unwrap();

    let keys = list_ssh_keys(ssh.path()).unwrap();

    let listed: Vec<(&str, &str)> = keys
        .iter()
        .map(|key| (key.name.as_str(), key.algorithm.as_str()))
        .collect();
    assert_eq!(listed, [("id_ed25519", "ssh-ed25519"), ("work", "ssh-rsa")]);
    assert_eq!(
        keys[0].path,
        ssh.path().join("id_ed25519").display().to_string()
    );
    assert!(list_ssh_keys(&ssh.path().join("missing"))
        .unwrap()
        .is_empty());
}
