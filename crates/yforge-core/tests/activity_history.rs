use rusqlite::Connection;
use yforge_core::{
    activity_history, append_activity, clear_activity, mark_activity_undone, ActivityEntry,
    CommandRecord, UndoStatus,
};

fn entry(repo: &str, operation: &str) -> ActivityEntry {
    ActivityEntry {
        id: 0,
        repo: repo.to_owned(),
        operation: operation.to_owned(),
        summary: format!("{operation} done"),
        started_at: 1_700_000_000,
        duration_ms: 42,
        ok: true,
        local: true,
        toast: false,
        error: None,
        commands: vec![CommandRecord {
            command: format!("git {}", operation.to_lowercase()),
            status: Some(0),
            duration_ms: 12,
            output: "out".to_owned(),
        }],
        undo: UndoStatus::Available {
            scope: "HEAD".to_owned(),
        },
    }
}

fn count(dir: &std::path::Path, table: &str) -> i64 {
    Connection::open(dir.join("yforge.db"))
        .unwrap()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn entries_persist_across_reopens_newest_first_with_commands_and_paging() {
    let dir = tempfile::tempdir().unwrap();
    let mut failed = entry("/a", "Push");
    failed.ok = false;
    failed.error = Some("rejected".to_owned());
    failed.undo = UndoStatus::Unavailable {
        reason: "Push has no safe undo".to_owned(),
    };
    let first = append_activity(dir.path(), &entry("/a", "Commit")).unwrap();
    let second = append_activity(dir.path(), &failed).unwrap();
    let third = append_activity(dir.path(), &entry("/a", "Stage")).unwrap();
    append_activity(dir.path(), &entry("/other", "Fetch")).unwrap();

    let newest = activity_history(dir.path(), "/a", None, 2).unwrap();
    let older = activity_history(dir.path(), "/a", Some(newest[1].id), 2).unwrap();

    assert_eq!(
        newest.iter().map(|e| e.id).collect::<Vec<_>>(),
        [third, second]
    );
    assert_eq!(older.iter().map(|e| e.id).collect::<Vec<_>>(), [first]);
    assert_eq!(newest[1].error.as_deref(), Some("rejected"));
    assert!(!newest[1].ok);
    assert_eq!(
        newest[1].undo,
        UndoStatus::Unavailable {
            reason: "Push has no safe undo".to_owned()
        }
    );
    assert_eq!(older[0].commands, entry("/a", "Commit").commands);
    assert_eq!(older[0].operation, "Commit");
    assert_eq!(
        activity_history(dir.path(), "/other", None, 10)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn only_the_latest_thousand_entries_per_repository_are_kept() {
    let dir = tempfile::tempdir().unwrap();
    for _ in 0..1_005 {
        append_activity(dir.path(), &entry("/busy", "Stage")).unwrap();
    }
    append_activity(dir.path(), &entry("/quiet", "Stage")).unwrap();

    let newest = activity_history(dir.path(), "/busy", None, 200).unwrap();
    let oldest: i64 = Connection::open(dir.path().join("yforge.db"))
        .unwrap()
        .query_row(
            "SELECT MIN(id) FROM activity WHERE repo = '/busy'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(count(dir.path(), "activity"), 1_001);
    assert_eq!(count(dir.path(), "activity_commands"), 1_001);
    assert_eq!((newest[0].id, oldest), (1_005, 6));
    assert_eq!(
        activity_history(dir.path(), "/quiet", None, 200)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn undone_status_persists_and_clear_removes_one_repository_or_everything() {
    let dir = tempfile::tempdir().unwrap();
    let id = append_activity(dir.path(), &entry("/a", "Commit")).unwrap();
    append_activity(dir.path(), &entry("/b", "Commit")).unwrap();

    mark_activity_undone(dir.path(), id).unwrap();
    assert_eq!(
        activity_history(dir.path(), "/a", None, 10).unwrap()[0].undo,
        UndoStatus::Undone
    );

    clear_activity(dir.path(), Some("/a")).unwrap();
    assert!(activity_history(dir.path(), "/a", None, 10)
        .unwrap()
        .is_empty());
    assert_eq!(
        activity_history(dir.path(), "/b", None, 10).unwrap().len(),
        1
    );
    clear_activity(dir.path(), None).unwrap();
    assert_eq!(count(dir.path(), "activity"), 0);
    assert_eq!(count(dir.path(), "activity_commands"), 0);
}
