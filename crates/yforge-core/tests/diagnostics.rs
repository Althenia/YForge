use rusqlite::Connection;
use yforge_core::{
    clear_crashes, delete_usage, export_crashes, export_usage, list_crashes, list_usage,
    record_crash, record_panic, record_usage, save_settings, start_storage, AppSettings,
    CrashOrigin, CrashReport, ErrorKind, NewCrash, OperationKind, ProviderKind, Redactor,
    UsageEvent,
};

const VERSION: &str = "9.9.9";

fn diagnostics(dir: &std::path::Path) -> Connection {
    Connection::open(dir.join("diagnostics.db")).unwrap()
}

fn report(message: &str) -> NewCrash {
    CrashReport {
        kind: "error".to_owned(),
        message: message.to_owned(),
        stack: Some("at render (app.js:1:1)".to_owned()),
        view: Some("/graph".to_owned()),
    }
    .into()
}

fn none() -> Redactor {
    Redactor::new(None, &[])
}

fn opt_in(dir: &std::path::Path, opted: bool) {
    save_settings(
        dir,
        &AppSettings {
            telemetry_opt_in: opted,
            ..AppSettings::default()
        },
    )
    .unwrap();
}

fn event(kind: OperationKind) -> UsageEvent {
    UsageEvent {
        kind,
        ok: false,
        error_kind: Some(ErrorKind::PushRejected),
        duration_ms: 250,
        count: 3,
        correlation_id: 7,
        provider: None,
        model: None,
    }
}

#[test]
fn crashes_are_stored_with_environment_fields_and_listed_newest_first_in_pages() {
    let dir = tempfile::tempdir().unwrap();
    for number in 0..3 {
        record_crash(
            dir.path(),
            VERSION,
            &none(),
            &report(&format!("boom {number}")),
        )
        .unwrap();
    }

    let newest = list_crashes(dir.path(), None, 2).unwrap();
    let older = list_crashes(dir.path(), Some(newest[1].id), 2).unwrap();

    assert_eq!(
        newest
            .iter()
            .map(|c| c.message.as_str())
            .collect::<Vec<_>>(),
        ["boom 2", "boom 1"]
    );
    assert_eq!(older.len(), 1);
    let crash = &newest[0];
    assert_eq!(crash.origin, CrashOrigin::Frontend);
    assert_eq!(crash.kind, "error");
    assert_eq!(crash.app_version, VERSION);
    assert_eq!(crash.os, std::env::consts::OS);
    assert_eq!(crash.arch, std::env::consts::ARCH);
    assert_eq!(crash.stack.as_deref(), Some("at render (app.js:1:1)"));
    assert_eq!(crash.view.as_deref(), Some("/graph"));
    assert!(crash.occurred_at > 0);
}

#[test]
fn a_panic_record_keeps_thread_location_and_backtrace() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    let crash = NewCrash {
        origin: CrashOrigin::Rust,
        kind: "panic".to_owned(),
        thread: Some("worker".to_owned()),
        message: "index out of bounds".to_owned(),
        location: Some("src/lib.rs:10:5".to_owned()),
        stack: Some("0: frame".to_owned()),
        view: None,
    };

    record_panic(dir.path(), VERSION, &none(), &crash).unwrap();

    let stored = &list_crashes(dir.path(), None, 10).unwrap()[0];
    assert_eq!(stored.origin, CrashOrigin::Rust);
    assert_eq!(stored.thread.as_deref(), Some("worker"));
    assert_eq!(stored.location.as_deref(), Some("src/lib.rs:10:5"));
    assert_eq!(stored.stack.as_deref(), Some("0: frame"));
}

#[test]
fn a_panic_record_fails_fast_when_the_database_is_missing_its_schema() {
    let dir = tempfile::tempdir().unwrap();

    let error = record_panic(dir.path(), VERSION, &none(), &report("x")).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::StorageFailed);
}

#[test]
fn redaction_strips_userinfo_secret_lines_home_and_repository_paths() {
    let redactor = Redactor::new(
        Some("/Users/yui"),
        &[
            "/Users/yui/work/app".to_owned(),
            "/srv/repos/tools/".to_owned(),
        ],
    );

    assert_eq!(
        redactor.redact("clone https://yui:tok3n@example.test/a.git failed"),
        "clone https://***@example.test/a.git failed"
    );
    assert_eq!(
        redactor.redact("at /Users/yui/work/app/src/main.rs:3 and /Users/yui/.config/x"),
        "at <repository>/src/main.rs:3 and ~/.config/x"
    );
    assert_eq!(
        redactor.redact("opened /srv/repos/tools"),
        "opened <repository>"
    );
    assert_eq!(
        redactor.redact("/Users/yui2/keep and /srv/repos/toolshed"),
        "/Users/yui2/keep and /srv/repos/toolshed"
    );
    assert_eq!(
        redactor.redact("failed with password=hunter2 in call\nnext"),
        "***\nnext"
    );
    assert_eq!(redactor.redact("Authorization: Bearer abc"), "***");
}

#[test]
fn stored_crashes_never_contain_secrets_home_or_repository_paths() {
    let dir = tempfile::tempdir().unwrap();
    let redactor = Redactor::new(Some("/Users/yui"), &["/Users/yui/work/app".to_owned()]);
    let crash = NewCrash {
        origin: CrashOrigin::Rust,
        kind: "panic".to_owned(),
        thread: Some("main".to_owned()),
        message: "cannot open /Users/yui/work/app via https://yui:tok3n@example.test/r.git"
            .to_owned(),
        location: Some("/Users/yui/Workspace/YForge/src/lib.rs:1:1".to_owned()),
        stack: Some("frame at /Users/yui/work/app/.git".to_owned()),
        view: Some("/repo//Users/yui/work/app".to_owned()),
    };

    record_crash(dir.path(), VERSION, &redactor, &crash).unwrap();

    let stored = &list_crashes(dir.path(), None, 1).unwrap()[0];
    assert_eq!(
        stored.message,
        "cannot open <repository> via https://***@example.test/r.git"
    );
    assert_eq!(
        stored.location.as_deref(),
        Some("~/Workspace/YForge/src/lib.rs:1:1")
    );
    assert_eq!(stored.stack.as_deref(), Some("frame at <repository>/.git"));
    assert_eq!(stored.view.as_deref(), Some("/repo/<repository>"));
    let everything = format!("{stored:?}");
    for leaked in ["tok3n", "yui:", "/Users/yui"] {
        assert!(
            !everything.contains(leaked),
            "{leaked} leaked: {everything}"
        );
    }
}

#[test]
fn crash_text_is_truncated_to_a_bounded_size() {
    let dir = tempfile::tempdir().unwrap();

    record_crash(dir.path(), VERSION, &none(), &report(&"x".repeat(200_000))).unwrap();

    let stored = &list_crashes(dir.path(), None, 1).unwrap()[0];
    assert_eq!(stored.message.len(), 64 * 1024);
}

#[test]
fn crashes_export_as_json_to_an_absolute_path_and_clear() {
    let dir = tempfile::tempdir().unwrap();
    record_crash(dir.path(), VERSION, &none(), &report("one")).unwrap();
    record_crash(dir.path(), VERSION, &none(), &report("two")).unwrap();
    let target = dir.path().join("crashes.json");

    let exported = export_crashes(dir.path(), &target).unwrap();
    let relative = export_crashes(dir.path(), std::path::Path::new("crashes.json")).unwrap_err();

    assert_eq!(exported, 2);
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
    assert_eq!(json[0]["message"], "two");
    assert_eq!(json[0]["origin"], "frontend");
    assert_eq!(json.as_array().unwrap().len(), 2);
    assert_eq!(relative.kind(), ErrorKind::InvalidRequest);
    clear_crashes(dir.path()).unwrap();
    assert!(list_crashes(dir.path(), None, 10).unwrap().is_empty());
}

#[test]
fn usage_is_not_recorded_while_telemetry_is_off() {
    let dir = tempfile::tempdir().unwrap();

    record_usage(dir.path(), VERSION, &event(OperationKind::Push)).unwrap();
    opt_in(dir.path(), false);
    record_usage(dir.path(), VERSION, &event(OperationKind::Push)).unwrap();

    assert!(list_usage(dir.path(), None, 10).unwrap().is_empty());
}

#[test]
fn ai_usage_stores_the_provider_kind_and_model_id_and_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    opt_in(dir.path(), true);
    let ai = UsageEvent {
        kind: OperationKind::AiCommitMessage,
        ok: true,
        error_kind: None,
        duration_ms: 1800,
        count: 0,
        correlation_id: 9,
        provider: Some(ProviderKind::Openrouter),
        model: Some("openai/gpt-x".to_owned()),
    };

    record_usage(dir.path(), VERSION, &ai).unwrap();

    let attrs: String = diagnostics(dir.path())
        .query_row("SELECT attrs FROM events", [], |row| row.get(0))
        .unwrap();
    let attrs: serde_json::Value = serde_json::from_str(&attrs).unwrap();
    let mut keys: Vec<&str> = attrs
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "app_version",
            "correlation_id",
            "count",
            "duration_ms",
            "error_kind",
            "model",
            "ok",
            "provider"
        ]
    );
    let record = &list_usage(dir.path(), None, 10).unwrap()[0];
    assert_eq!(record.event, OperationKind::AiCommitMessage);
    assert_eq!(record.provider, Some(ProviderKind::Openrouter));
    assert_eq!(record.model.as_deref(), Some("openai/gpt-x"));
}

#[test]
fn opted_in_usage_stores_only_the_allowed_fields() {
    let dir = tempfile::tempdir().unwrap();
    opt_in(dir.path(), true);

    record_usage(dir.path(), VERSION, &event(OperationKind::ForcePush)).unwrap();

    let (kind, schema, attrs): (String, i64, String) = diagnostics(dir.path())
        .query_row(
            "SELECT kind, schema_version, attrs FROM events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    let attrs: serde_json::Value = serde_json::from_str(&attrs).unwrap();
    let mut keys: Vec<&str> = attrs
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!((kind.as_str(), schema), ("force_push", 1));
    assert_eq!(
        keys,
        [
            "app_version",
            "correlation_id",
            "count",
            "duration_ms",
            "error_kind",
            "ok"
        ]
    );
    assert_eq!(attrs["error_kind"], "push_rejected");
    let record = &list_usage(dir.path(), None, 10).unwrap()[0];
    assert_eq!(record.event, OperationKind::ForcePush);
    assert_eq!(
        (
            record.ok,
            record.duration_ms,
            record.count,
            record.correlation_id
        ),
        (false, 250, 3, 7)
    );
    assert_eq!(record.app_version, VERSION);
}

#[test]
fn turning_telemetry_off_deletes_every_usage_event() {
    let dir = tempfile::tempdir().unwrap();
    opt_in(dir.path(), true);
    record_usage(dir.path(), VERSION, &event(OperationKind::Fetch)).unwrap();
    assert_eq!(list_usage(dir.path(), None, 10).unwrap().len(), 1);

    opt_in(dir.path(), false);

    assert!(list_usage(dir.path(), None, 10).unwrap().is_empty());
}

#[test]
fn usage_lists_in_pages_skips_unknown_kinds_and_newer_schemas_exports_and_deletes() {
    let dir = tempfile::tempdir().unwrap();
    opt_in(dir.path(), true);
    record_usage(dir.path(), VERSION, &event(OperationKind::Commit)).unwrap();
    record_usage(dir.path(), VERSION, &event(OperationKind::Merge)).unwrap();
    let attrs = r#"{"app_version":"9","ok":true,"error_kind":null,"duration_ms":1,"count":1,"correlation_id":1}"#;
    diagnostics(dir.path())
        .execute_batch(&format!(
            "INSERT INTO events (occurred_at, kind, schema_version, attrs) VALUES
               (1, 'from_the_future', 1, '{attrs}'),
               (1, 'commit', 2, '{attrs}')"
        ))
        .unwrap();
    record_usage(dir.path(), VERSION, &event(OperationKind::Rebase)).unwrap();

    let first = list_usage(dir.path(), None, 2).unwrap();
    let second = list_usage(dir.path(), Some(first[1].id), 2).unwrap();
    let target = dir.path().join("usage.json");
    let exported = export_usage(dir.path(), &target).unwrap();

    assert_eq!(
        first.iter().map(|r| r.event).collect::<Vec<_>>(),
        [OperationKind::Rebase, OperationKind::Merge]
    );
    assert_eq!(
        second.iter().map(|r| r.event).collect::<Vec<_>>(),
        [OperationKind::Commit]
    );
    assert_eq!(exported, 3);
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
    assert_eq!(json.as_array().unwrap().len(), 3);
    assert_eq!(json[0]["event"], "rebase");
    delete_usage(dir.path()).unwrap();
    assert!(list_usage(dir.path(), None, 10).unwrap().is_empty());
}

#[test]
fn startup_prunes_crashes_and_usage_by_age_and_row_count() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    let connection = diagnostics(dir.path());
    let now: i64 = connection
        .query_row("SELECT CAST(strftime('%s', 'now') AS INTEGER)", [], |row| {
            row.get(0)
        })
        .unwrap();
    let day = 24 * 60 * 60;
    connection
        .execute_batch(&format!(
            "INSERT INTO crashes (occurred_at, origin, kind, app_version, os, arch, message)
               VALUES ({old}, 'rust', 'panic', '1', 'os', 'arch', 'stale');
             INSERT INTO events (occurred_at, kind, schema_version, attrs)
               VALUES ({old}, 'commit', 1, '{{}}');
             WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 510)
               INSERT INTO crashes (occurred_at, origin, kind, app_version, os, arch, message)
               SELECT {now}, 'rust', 'panic', '1', 'os', 'arch', 'fresh ' || i FROM n;
             WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10010)
               INSERT INTO events (occurred_at, kind, schema_version, attrs)
               SELECT {now}, 'commit', 1, '{{}}' FROM n;",
            old = now - 91 * day,
        ))
        .unwrap();
    let count = |table: &str| -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    };
    assert_eq!((count("crashes"), count("events")), (511, 10_011));

    start_storage(dir.path()).unwrap();

    assert_eq!((count("crashes"), count("events")), (500, 10_000));
    let stale: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM crashes WHERE message = 'stale'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stale, 0);
}

#[test]
fn a_corrupt_diagnostics_file_is_moved_aside_and_recreated() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("diagnostics.db"), vec![7_u8; 4096]).unwrap();

    let moved = start_storage(dir.path()).unwrap().expect("moved aside");

    assert_eq!(std::fs::read(&moved).unwrap(), vec![7_u8; 4096]);
    assert!(moved
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("diagnostics.db.corrupt-"));
    record_crash(dir.path(), VERSION, &none(), &report("after")).unwrap();
    assert_eq!(list_crashes(dir.path(), None, 10).unwrap().len(), 1);
}
