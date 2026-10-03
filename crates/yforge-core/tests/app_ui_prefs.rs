use rusqlite::Connection;
use yforge_core::{
    app_ui_prefs_load, app_ui_prefs_save, load_settings, start_storage, AppUiPrefs, ErrorKind,
    FileListMode,
};

fn sample() -> AppUiPrefs {
    AppUiPrefs {
        palette_recents: vec!["tab.new".to_owned(), "repo.fetch".to_owned()],
        last_parent_folder: Some("/Users/dev/code".to_owned()),
        file_list_mode: FileListMode::Path,
        ..AppUiPrefs::default()
    }
}

fn database(dir: &std::path::Path) -> Connection {
    Connection::open(dir.join("yforge.db")).unwrap()
}

#[test]
fn without_stored_preferences_the_defaults_are_empty() {
    let dir = tempfile::tempdir().unwrap();

    let prefs = app_ui_prefs_load(dir.path()).unwrap();

    assert_eq!(prefs, AppUiPrefs::default());
    assert!(prefs.palette_recents.is_empty());
    assert_eq!(prefs.last_parent_folder, None);
}

#[test]
fn preferences_round_trip_and_saving_replaces_the_previous_value() {
    let dir = tempfile::tempdir().unwrap();
    app_ui_prefs_save(dir.path(), &sample()).unwrap();
    assert_eq!(app_ui_prefs_load(dir.path()).unwrap(), sample());

    let replacement = AppUiPrefs {
        palette_recents: vec!["branch.create".to_owned()],
        last_parent_folder: None,
        file_list_mode: FileListMode::Tree,
        ..AppUiPrefs::default()
    };
    app_ui_prefs_save(dir.path(), &replacement).unwrap();

    assert_eq!(app_ui_prefs_load(dir.path()).unwrap(), replacement);
}

#[test]
fn saving_interface_preferences_leaves_the_application_settings_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let before = load_settings(dir.path()).unwrap();

    app_ui_prefs_save(dir.path(), &sample()).unwrap();

    assert_eq!(load_settings(dir.path()).unwrap(), before);
}

#[test]
fn invalid_preferences_are_refused_and_leave_the_stored_value_untouched() {
    let dir = tempfile::tempdir().unwrap();
    app_ui_prefs_save(dir.path(), &sample()).unwrap();
    let recents = |palette_recents: Vec<String>| AppUiPrefs {
        palette_recents,
        last_parent_folder: None,
        file_list_mode: FileListMode::Path,
        ..AppUiPrefs::default()
    };
    let invalid = vec![
        recents(vec![String::new()]),
        recents(vec!["  ".to_owned()]),
        recents(vec!["a".to_owned(), "a".to_owned()]),
        recents(vec!["x".repeat(1025)]),
        recents((0..9).map(|number| format!("command.{number}")).collect()),
        AppUiPrefs {
            palette_recents: Vec::new(),
            last_parent_folder: Some(" ".to_owned()),
            file_list_mode: FileListMode::Path,
            ..AppUiPrefs::default()
        },
        AppUiPrefs {
            palette_recents: Vec::new(),
            last_parent_folder: Some("y".repeat(4097)),
            file_list_mode: FileListMode::Path,
            ..AppUiPrefs::default()
        },
        AppUiPrefs {
            zoom_percent: 120,
            ..AppUiPrefs::default()
        },
        AppUiPrefs {
            zoom_percent: 0,
            ..AppUiPrefs::default()
        },
    ];

    for prefs in invalid {
        let error = app_ui_prefs_save(dir.path(), &prefs).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{prefs:?}");
    }

    assert_eq!(app_ui_prefs_load(dir.path()).unwrap(), sample());
}

#[test]
fn a_stored_value_of_the_wrong_shape_is_a_storage_error_naming_the_database() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    database(dir.path())
        .execute(
            "INSERT INTO settings (key, value) VALUES ('ui.palette_recents', '\"nope\"')",
            [],
        )
        .unwrap();

    let error = app_ui_prefs_load(dir.path()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
    assert!(error.to_string().contains("yforge.db"));
}

#[test]
fn preferences_saved_before_the_file_list_mode_existed_load_as_path() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    database(dir.path())
        .execute_batch(
            "INSERT INTO settings (key, value) VALUES ('ui.palette_recents', '[\"tab.new\"]');
             INSERT INTO settings (key, value) VALUES ('ui.last_parent_folder', '\"/Users/dev\"');",
        )
        .unwrap();

    let prefs = app_ui_prefs_load(dir.path()).unwrap();

    assert_eq!(prefs.palette_recents, ["tab.new"]);
    assert_eq!(prefs.file_list_mode, FileListMode::Path);
    let from_ipc: AppUiPrefs =
        serde_json::from_str(r#"{"palette_recents":[],"last_parent_folder":null}"#).unwrap();
    assert_eq!(from_ipc.file_list_mode, FileListMode::Path);
}

#[test]
fn a_saved_tree_file_list_mode_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let tree = AppUiPrefs {
        file_list_mode: FileListMode::Tree,
        ..sample()
    };

    app_ui_prefs_save(dir.path(), &tree).unwrap();

    assert_eq!(app_ui_prefs_load(dir.path()).unwrap(), tree);
    assert_eq!(
        serde_json::to_value(FileListMode::Tree).unwrap(),
        serde_json::json!("tree")
    );
}

#[test]
fn the_view_preferences_default_to_full_size_shown_panels_and_highlighting_on() {
    let prefs = AppUiPrefs::default();

    assert_eq!(prefs.zoom_percent, 100);
    assert!(!prefs.sidebar_hidden);
    assert!(!prefs.inspector_hidden);
    assert!(prefs.syntax_highlighting);
    let from_ipc: AppUiPrefs =
        serde_json::from_str(r#"{"palette_recents":[],"last_parent_folder":null}"#).unwrap();
    assert_eq!(from_ipc, AppUiPrefs::default());
}

#[test]
fn every_zoom_step_and_the_layout_and_highlighting_choices_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    for step in [80, 90, 100, 110, 125, 140, 150, 175, 200] {
        let prefs = AppUiPrefs {
            zoom_percent: step,
            sidebar_hidden: step % 20 == 0,
            inspector_hidden: step % 10 == 0,
            syntax_highlighting: step % 25 != 0,
            ..sample()
        };

        app_ui_prefs_save(dir.path(), &prefs).unwrap();

        assert_eq!(app_ui_prefs_load(dir.path()).unwrap(), prefs, "{step}");
    }
}
