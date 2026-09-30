use rusqlite::Connection;
use yforge_core::{
    repo_ui_prefs_load, repo_ui_prefs_save, start_storage, ColumnPref, ErrorKind, GraphColumn,
    GraphVisibility, RefKind, RefSelector, RepoUiPrefs,
};

const REPO: &str = "/work/alpha";

fn column(column: GraphColumn, visible: bool, width: Option<u32>) -> ColumnPref {
    ColumnPref {
        column,
        visible,
        width,
    }
}

fn sample() -> RepoUiPrefs {
    RepoUiPrefs {
        columns: vec![
            column(GraphColumn::Refs, true, Some(220)),
            column(GraphColumn::Author, true, Some(120)),
            column(GraphColumn::Sha, false, None),
        ],
        collapsed_folders: vec!["local:feature".to_owned(), "remote:origin".to_owned()],
        branch_visibility: GraphVisibility::Refs {
            refs: vec![RefSelector {
                name: "main".to_owned(),
                kind: RefKind::LocalBranch,
            }],
        },
    }
}

fn database(dir: &std::path::Path) -> Connection {
    Connection::open(dir.join("yforge.db")).unwrap()
}

#[test]
fn a_repository_without_stored_preferences_gets_the_defaults() {
    let dir = tempfile::tempdir().unwrap();

    let prefs = repo_ui_prefs_load(dir.path(), REPO).unwrap();

    assert_eq!(prefs, RepoUiPrefs::default());
    assert!(prefs.columns.is_empty());
    assert!(prefs.collapsed_folders.is_empty());
    assert_eq!(prefs.branch_visibility, GraphVisibility::All);
}

#[test]
fn preferences_round_trip_per_repository_and_saving_replaces_the_previous_value() {
    let dir = tempfile::tempdir().unwrap();
    repo_ui_prefs_save(dir.path(), REPO, &sample()).unwrap();

    let other = RepoUiPrefs {
        branch_visibility: GraphVisibility::CurrentAndUpstream,
        ..RepoUiPrefs::default()
    };
    repo_ui_prefs_save(dir.path(), "/work/beta", &other).unwrap();
    let replacement = RepoUiPrefs {
        collapsed_folders: vec!["local:fix".to_owned()],
        ..RepoUiPrefs::default()
    };

    assert_eq!(repo_ui_prefs_load(dir.path(), REPO).unwrap(), sample());
    assert_eq!(repo_ui_prefs_load(dir.path(), "/work/beta").unwrap(), other);
    repo_ui_prefs_save(dir.path(), REPO, &replacement).unwrap();
    assert_eq!(repo_ui_prefs_load(dir.path(), REPO).unwrap(), replacement);
    assert_eq!(repo_ui_prefs_load(dir.path(), "/work/beta").unwrap(), other);
}

#[test]
fn invalid_preferences_are_refused_and_leave_the_stored_value_untouched() {
    let dir = tempfile::tempdir().unwrap();
    repo_ui_prefs_save(dir.path(), REPO, &sample()).unwrap();
    let selector = |name: &str| RefSelector {
        name: name.to_owned(),
        kind: RefKind::Tag,
    };
    let invalid = vec![
        RepoUiPrefs {
            columns: vec![
                column(GraphColumn::Date, true, None),
                column(GraphColumn::Date, false, None),
            ],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            columns: vec![column(GraphColumn::Refs, false, None)],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            columns: vec![column(GraphColumn::Sha, true, Some(23))],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            columns: vec![column(GraphColumn::Sha, true, Some(2001))],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            collapsed_folders: vec![String::new()],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            collapsed_folders: vec!["a".to_owned(), "a".to_owned()],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            collapsed_folders: vec!["x".repeat(1025)],
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            collapsed_folders: (0..5001).map(|number| format!("f{number}")).collect(),
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            branch_visibility: GraphVisibility::Refs {
                refs: vec![selector("  ")],
            },
            ..RepoUiPrefs::default()
        },
        RepoUiPrefs {
            branch_visibility: GraphVisibility::Refs {
                refs: vec![selector("v1"), selector("v1")],
            },
            ..RepoUiPrefs::default()
        },
    ];

    for prefs in invalid {
        let error = repo_ui_prefs_save(dir.path(), REPO, &prefs).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{prefs:?}");
    }
    assert_eq!(repo_ui_prefs_load(dir.path(), REPO).unwrap(), sample());
    assert_eq!(
        repo_ui_prefs_save(dir.path(), " ", &sample())
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn a_stored_blob_that_does_not_match_the_typed_struct_is_a_storage_error() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    for blob in [
        "not json",
        r#"{"unknown":1}"#,
        r#"{"columns":[{"column":"nope","visible":true}]}"#,
    ] {
        database(dir.path())
            .execute(
                "INSERT OR REPLACE INTO repo_ui_prefs (repository, prefs, updated_at) VALUES (?1, ?2, 0)",
                [REPO, blob],
            )
            .unwrap();

        let error = repo_ui_prefs_load(dir.path(), REPO).unwrap_err();

        assert_eq!(error.kind(), ErrorKind::StorageFailed, "{blob}");
        assert!(error.to_string().contains("yforge.db"), "{blob}");
    }
}

#[test]
fn a_blob_with_missing_fields_takes_the_defaults_for_them() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    database(dir.path())
        .execute(
            "INSERT INTO repo_ui_prefs (repository, prefs, updated_at) VALUES (?1, '{}', 0)",
            [REPO],
        )
        .unwrap();

    assert_eq!(
        repo_ui_prefs_load(dir.path(), REPO).unwrap(),
        RepoUiPrefs::default()
    );
}
