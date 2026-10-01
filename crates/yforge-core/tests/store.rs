mod common;

use common::Fixture;
use rusqlite::Connection;
use yforge_core::{
    add_recent, list_ssh_keys, load_recents, load_repo_settings, load_session, load_settings,
    recent_status, remove_recent, save_repo_settings, save_session, save_settings, ssh_plan,
    start_storage, AppSettings, Density, ErrorKind, PullMode, RepoSettings, TabGroup,
    TabGroupColor, TabSession, Theme,
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
        gravatar_avatars: false,
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
        groups: Vec::new(),
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
    assert_eq!(status.unreadable, None);
    assert_eq!(missing.unreadable, None);
}

#[test]
fn recent_status_of_a_repository_whose_status_cannot_be_read_carries_the_reason() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.write(".git/index", "garbage");

    let status = recent_status(&repo.path);

    assert!(status.exists);
    assert!(
        status
            .unreadable
            .as_deref()
            .is_some_and(|reason| reason.contains("index file smaller than expected")),
        "{status:?}"
    );
    assert_eq!((status.branch, status.counts), (None, None));
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
    assert!(settings.gravatar_avatars);
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
            active: 1,
            groups: Vec::new(),
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
    assert_eq!(stored, 10);
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
    assert_eq!(version, 11);
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

fn tab_group(name: &str, color: TabGroupColor, collapsed: bool, tabs: &[&str]) -> TabGroup {
    TabGroup {
        name: name.to_owned(),
        color,
        collapsed,
        tabs: tabs.iter().map(|tab| (*tab).to_owned()).collect(),
    }
}

fn session_with(tabs: &[&str], active: u32, groups: Vec<TabGroup>) -> TabSession {
    TabSession {
        tabs: tabs.iter().map(|tab| (*tab).to_owned()).collect(),
        active,
        groups,
    }
}

#[test]
fn tab_groups_with_their_name_color_collapsed_state_and_members_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let session = session_with(
        &["/a", "/b", "/c", "/d", "/e"],
        3,
        vec![
            tab_group("Backend", TabGroupColor::Mint, false, &["/b", "/c"]),
            tab_group("Docs", TabGroupColor::Pink, true, &["/e"]),
        ],
    );

    save_session(dir.path(), &session).unwrap();

    assert_eq!(load_session(dir.path()).unwrap(), session);
}

#[test]
fn saving_a_new_session_replaces_the_groups_and_a_group_left_without_tabs_is_deleted() {
    let dir = tempfile::tempdir().unwrap();
    save_session(
        dir.path(),
        &session_with(
            &["/a", "/b"],
            0,
            vec![tab_group("Old", TabGroupColor::Red, false, &["/a", "/b"])],
        ),
    )
    .unwrap();

    save_session(
        dir.path(),
        &session_with(
            &["/a", "/b"],
            0,
            vec![
                tab_group("Empty", TabGroupColor::Blue, false, &[]),
                tab_group("New", TabGroupColor::Green, true, &["/b"]),
            ],
        ),
    )
    .unwrap();

    assert_eq!(
        load_session(dir.path()).unwrap().groups,
        vec![tab_group("New", TabGroupColor::Green, true, &["/b"])]
    );
    let stored: i64 = database(dir.path())
        .query_row("SELECT COUNT(*) FROM session_groups", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stored, 1);
}

#[test]
fn a_group_name_is_trimmed_and_groups_are_kept_in_tab_order() {
    let dir = tempfile::tempdir().unwrap();
    let session = session_with(
        &["/a", "/b", "/c"],
        0,
        vec![
            tab_group("Later", TabGroupColor::Red, false, &["/c"]),
            tab_group("  First  ", TabGroupColor::Blue, false, &["/b", "/a"]),
        ],
    );

    save_session(dir.path(), &session).unwrap();

    assert_eq!(
        load_session(dir.path()).unwrap().groups,
        vec![
            tab_group("First", TabGroupColor::Blue, false, &["/a", "/b"]),
            tab_group("Later", TabGroupColor::Red, false, &["/c"]),
        ]
    );
}

#[test]
fn a_group_name_of_one_to_forty_characters_is_required() {
    let dir = tempfile::tempdir().unwrap();
    let named = |name: &str| {
        session_with(
            &["/a"],
            0,
            vec![tab_group(name, TabGroupColor::Cyan, false, &["/a"])],
        )
    };

    for refused in ["", "   ", &"x".repeat(41)] {
        let error = save_session(dir.path(), &named(refused)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{refused:?}");
    }
    save_session(dir.path(), &named(&"é".repeat(40))).unwrap();

    assert_eq!(
        load_session(dir.path()).unwrap().groups[0].name,
        "é".repeat(40)
    );
}

#[test]
fn a_group_must_hold_open_tabs_once_and_next_to_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let tabs = ["/a", "/b", "/c"];
    let refused = [
        vec![tab_group("G", TabGroupColor::Cyan, false, &["/gone"])],
        vec![
            tab_group("G", TabGroupColor::Cyan, false, &["/a", "/b"]),
            tab_group("H", TabGroupColor::Red, false, &["/b"]),
        ],
        vec![tab_group("G", TabGroupColor::Cyan, false, &["/a", "/a"])],
        vec![tab_group("G", TabGroupColor::Cyan, false, &["/a", "/c"])],
    ];

    for groups in refused {
        let error = save_session(dir.path(), &session_with(&tabs, 0, groups)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }

    assert_eq!(load_session(dir.path()).unwrap(), TabSession::default());
}

#[test]
fn a_session_saved_without_groups_still_deserializes_as_ungrouped() {
    let session: TabSession = serde_json::from_str(r#"{"tabs":["/a"],"active":0}"#).unwrap();

    assert_eq!(session.groups, Vec::<TabGroup>::new());
}

#[test]
fn a_version_seven_database_keeps_its_tabs_and_gains_groups() {
    let dir = tempfile::tempdir().unwrap();
    let connection = database(dir.path());
    for migration in [
        include_str!("../src/store/schema.sql"),
        include_str!("../src/store/switch_stashes.sql"),
        include_str!("../src/store/ai_providers.sql"),
        include_str!("../src/store/repo_ui_prefs.sql"),
        include_str!("../src/store/platform_connections.sql"),
        include_str!("../src/store/ai_v2.sql"),
        include_str!("../src/store/ai_feature_switch.sql"),
    ] {
        connection.execute_batch(migration).unwrap();
    }
    connection
        .execute_batch(
            "PRAGMA user_version = 7;
             INSERT INTO session (id, active) VALUES (1, 1);
             INSERT INTO session_tabs (position, path) VALUES (0, '/a'), (1, '/b');",
        )
        .unwrap();
    drop(connection);

    let loaded = load_session(dir.path()).unwrap();

    assert_eq!(loaded, session_with(&["/a", "/b"], 1, Vec::new()));
    let version: i64 = database(dir.path())
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 11);
    save_session(
        dir.path(),
        &session_with(
            &["/a", "/b"],
            1,
            vec![tab_group("G", TabGroupColor::Orange, false, &["/b"])],
        ),
    )
    .unwrap();
    assert_eq!(load_session(dir.path()).unwrap().groups[0].tabs, ["/b"]);
}

#[test]
fn a_version_eight_database_keeps_its_data_and_gains_jira_connections() {
    let dir = tempfile::tempdir().unwrap();
    let connection = database(dir.path());
    for migration in [
        include_str!("../src/store/schema.sql"),
        include_str!("../src/store/switch_stashes.sql"),
        include_str!("../src/store/ai_providers.sql"),
        include_str!("../src/store/repo_ui_prefs.sql"),
        include_str!("../src/store/platform_connections.sql"),
        include_str!("../src/store/ai_v2.sql"),
        include_str!("../src/store/ai_feature_switch.sql"),
        include_str!("../src/store/tab_groups.sql"),
    ] {
        connection.execute_batch(migration).unwrap();
    }
    connection
        .execute_batch(
            "PRAGMA user_version = 8;
             INSERT INTO session (id, active) VALUES (1, 0);
             INSERT INTO session_tabs (position, path) VALUES (0, '/a');
             INSERT INTO platform_connections (id, kind, host, name, insecure_tls, created_at)
             VALUES ('github-1', 'github', 'github.com', 'Home', 0, 5);",
        )
        .unwrap();
    drop(connection);

    start_storage(dir.path()).unwrap();

    assert_eq!(load_session(dir.path()).unwrap().tabs, ["/a"]);
    assert_eq!(
        yforge_core::platform_connections_list(dir.path()).unwrap()[0].id,
        "github-1"
    );
    assert!(yforge_core::jira_connections_list(dir.path())
        .unwrap()
        .is_empty());
    let version: i64 = database(dir.path())
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 11);
}

#[test]
fn a_version_nine_database_keeps_its_data_and_gains_git_hosts() {
    let dir = tempfile::tempdir().unwrap();
    let connection = database(dir.path());
    for migration in [
        include_str!("../src/store/schema.sql"),
        include_str!("../src/store/switch_stashes.sql"),
        include_str!("../src/store/ai_providers.sql"),
        include_str!("../src/store/repo_ui_prefs.sql"),
        include_str!("../src/store/platform_connections.sql"),
        include_str!("../src/store/ai_v2.sql"),
        include_str!("../src/store/ai_feature_switch.sql"),
        include_str!("../src/store/tab_groups.sql"),
        include_str!("../src/store/jira_connections.sql"),
    ] {
        connection.execute_batch(migration).unwrap();
    }
    connection
        .execute_batch(
            "PRAGMA user_version = 9;
             INSERT INTO session (id, active) VALUES (1, 0);
             INSERT INTO session_tabs (position, path) VALUES (0, '/a');
             INSERT INTO jira_connections (id, kind, site, email, display_name, projects, created_at)
             VALUES ('jira-1', 'cloud', 'https://your-site.atlassian.net', 'you@example.com', 'Yui', '[]', 5);",
        )
        .unwrap();
    drop(connection);

    start_storage(dir.path()).unwrap();

    assert_eq!(load_session(dir.path()).unwrap().tabs, ["/a"]);
    assert_eq!(
        yforge_core::jira_connections_list(dir.path()).unwrap()[0].id,
        "jira-1"
    );
    assert!(yforge_core::git_hosts_list(dir.path()).unwrap().is_empty());
    let host = yforge_core::git_host_add(
        dir.path(),
        &yforge_core::GitHostDraft {
            host: "github.com".to_owned(),
            ssh_key_path: None,
            https_user: Some("you".to_owned()),
        },
    )
    .unwrap();
    assert_eq!(yforge_core::git_hosts_list(dir.path()).unwrap(), [host]);
    let version: i64 = database(dir.path())
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 11);
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
    assert_eq!((kept.as_str(), version), ("kept", 11));
    assert!(!dir.path().join("yforge.db.pre-migration").exists());
}

fn key_file(dir: &std::path::Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::write(&path, "private").unwrap();
    path.display().to_string()
}

fn effective_key(dir: &std::path::Path, repository: &str) -> Option<std::path::PathBuf> {
    let plan = ssh_plan(dir, Some(repository)).unwrap();
    plan.repository_key.or(plan.app_key)
}

#[test]
fn the_repository_ssh_key_wins_over_the_app_key_and_either_can_be_cleared() {
    let dir = tempfile::tempdir().unwrap();
    let app_key = key_file(dir.path(), "id_app");
    let repo_key = key_file(dir.path(), "id_repo");
    assert_eq!(effective_key(dir.path(), "/repo"), None);

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
        effective_key(dir.path(), "/repo"),
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
        effective_key(dir.path(), "/repo"),
        Some(repo_key.clone().into())
    );
    assert_eq!(
        effective_key(dir.path(), "/other"),
        Some(app_key.clone().into())
    );

    save_repo_settings(dir.path(), "/repo", &RepoSettings::default()).unwrap();
    save_settings(dir.path(), &AppSettings::default()).unwrap();
    assert_eq!(effective_key(dir.path(), "/repo"), None);
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
