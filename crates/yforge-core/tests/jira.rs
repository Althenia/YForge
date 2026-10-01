mod common;

use std::collections::BTreeSet;

use common::Fixture;
use rusqlite::Connection;
use yforge_core::{
    add_recent, jira_branch_name, jira_connection_add, jira_connection_remove,
    jira_connection_update, jira_connections_list, jira_issue_keys, jira_issue_keys_in,
    launchpad_wips, start_storage, ErrorKind, JiraKind, JiraProject,
};

fn data() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

fn project(key: &str, name: &str) -> JiraProject {
    JiraProject {
        key: key.to_owned(),
        name: name.to_owned(),
    }
}

fn known(keys: &[&str]) -> BTreeSet<String> {
    keys.iter().map(|key| (*key).to_owned()).collect()
}

#[test]
fn connections_round_trip_with_their_projects_in_creation_order_and_no_token_column() {
    let dir = data();
    let cloud = jira_connection_add(
        dir.path(),
        JiraKind::Cloud,
        "https://your-site.atlassian.net",
        Some("you@example.com"),
        "Sam Lee",
        &[project("ABC", "Accounts"), project("WEB", "Website")],
    )
    .unwrap();
    let server = jira_connection_add(
        dir.path(),
        JiraKind::DataCenter,
        "https://jira.corp-b.internal/jira",
        None,
        "you",
        &[project("OPS", "Operations")],
    )
    .unwrap();

    assert_ne!(cloud.id, server.id);
    assert_eq!(server.host, "jira.corp-b.internal");
    assert_eq!(server.email, None);
    assert!(cloud.created_at > 0);
    assert_eq!(
        jira_connections_list(dir.path()).unwrap(),
        [cloud.clone(), server]
    );
    let columns: Vec<String> = Connection::open(dir.path().join("yforge.db"))
        .unwrap()
        .prepare("SELECT name FROM pragma_table_info('jira_connections')")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        columns,
        [
            "seq",
            "id",
            "kind",
            "site",
            "email",
            "display_name",
            "projects",
            "created_at"
        ]
    );
}

#[test]
fn a_cloud_connection_without_an_email_and_a_server_one_with_an_email_are_refused() {
    let dir = data();
    let cloud = jira_connection_add(
        dir.path(),
        JiraKind::Cloud,
        "https://your-site.atlassian.net",
        None,
        "Sam Lee",
        &[],
    );
    let server = jira_connection_add(
        dir.path(),
        JiraKind::DataCenter,
        "https://jira.corp-b.internal",
        Some("you@example.com"),
        "v",
        &[],
    );

    assert_eq!(cloud.unwrap_err().kind(), ErrorKind::StorageFailed);
    assert_eq!(server.unwrap_err().kind(), ErrorKind::StorageFailed);
    assert!(jira_connections_list(dir.path()).unwrap().is_empty());
}

#[test]
fn update_replaces_the_display_name_and_projects_and_remove_deletes_the_row() {
    let dir = data();
    let added = jira_connection_add(
        dir.path(),
        JiraKind::DataCenter,
        "https://jira.corp-b.internal",
        None,
        "old",
        &[project("OPS", "Operations")],
    )
    .unwrap();

    jira_connection_update(dir.path(), &added.id, "new", &[project("PAY", "Payments")]).unwrap();

    let listed = jira_connections_list(dir.path()).unwrap();
    assert_eq!(listed[0].display_name, "new");
    assert_eq!(listed[0].projects, [project("PAY", "Payments")]);
    jira_connection_remove(dir.path(), &added.id).unwrap();
    assert!(jira_connections_list(dir.path()).unwrap().is_empty());
    for outcome in [
        jira_connection_remove(dir.path(), &added.id),
        jira_connection_update(dir.path(), &added.id, "x", &[]),
    ] {
        assert_eq!(outcome.unwrap_err().kind(), ErrorKind::InvalidRequest);
    }
}

#[test]
fn branch_names_are_the_key_then_lower_case_ascii_words_within_fifty_characters() {
    for (key, summary, expected) in [
        (
            "ABC-155",
            "Show the account switcher",
            "ABC-155-show-the-account-switcher",
        ),
        (
            "ABC-1",
            "  Fix: login   (retry)!! ",
            "ABC-1-fix-login-retry",
        ),
        ("ABC-1", "Café über Straße", "ABC-1-caf-ber-stra-e"),
        ("ABC-1", "日本語", "ABC-1"),
        ("ABC-1", "", "ABC-1"),
        (
            "ABC-155",
            "Show the account switcher on the login screen",
            "ABC-155-show-the-account-switcher-on-the-login",
        ),
        (
            "ABC-1",
            &"x".repeat(80),
            &format!("ABC-1-{}", "x".repeat(44)),
        ),
        (
            "ABC-1",
            "abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz",
            "ABC-1-abcdefghijklmnopqrstuvwxyz",
        ),
    ] {
        let name = jira_branch_name(key, summary);
        assert_eq!(name, expected, "{summary:?}");
        assert!(name.len() <= 50, "{name}");
    }
}

#[test]
fn issue_keys_match_case_sensitively_inside_branches_subjects_and_titles() {
    let projects = known(&["ABC", "OPS", "A1"]);
    for (text, expected) in [
        ("fix/ABC-142-retry-login", vec!["ABC-142"]),
        ("ABC-142: Retry login (see OPS-9)", vec!["ABC-142", "OPS-9"]),
        ("ABC-142 and again ABC-142", vec!["ABC-142"]),
        ("abc-142 Abc-142", vec![]),
        ("UTF-8 handling", vec![]),
        ("XABC-142", vec![]),
        ("ABC-142abc", vec![]),
        ("ABC-", vec![]),
        ("ABC-x", vec![]),
        ("A-1", vec![]),
        ("A1-7 then feature_OPS-3_done", vec!["A1-7", "OPS-3"]),
        ("(ABC-1)[OPS-2],ABC-3.", vec!["ABC-1", "OPS-2", "ABC-3"]),
        ("", vec![]),
    ] {
        assert_eq!(jira_issue_keys(text, &projects), expected, "{text:?}");
    }
}

#[test]
fn issue_keys_in_texts_use_the_projects_of_every_connection() {
    let dir = data();
    assert_eq!(
        jira_issue_keys_in(dir.path(), &["ABC-1".to_owned()]).unwrap(),
        [Vec::<String>::new()]
    );
    jira_connection_add(
        dir.path(),
        JiraKind::Cloud,
        "https://your-site.atlassian.net",
        Some("you@example.com"),
        "Sam Lee",
        &[project("ABC", "Accounts")],
    )
    .unwrap();
    jira_connection_add(
        dir.path(),
        JiraKind::DataCenter,
        "https://jira.corp-b.internal",
        None,
        "v",
        &[project("OPS", "Operations")],
    )
    .unwrap();

    let found = jira_issue_keys_in(
        dir.path(),
        &[
            "ABC-1 OPS-2 PAY-3".to_owned(),
            "nothing".to_owned(),
            "OPS-2".to_owned(),
        ],
    )
    .unwrap();

    assert_eq!(found, [vec!["ABC-1", "OPS-2"], vec![], vec!["OPS-2"]]);
}

#[test]
fn a_recent_repository_whose_status_cannot_be_read_is_listed_with_the_reason() {
    let dir = data();
    let unreadable = Fixture::init();
    unreadable.commit("a.txt", "a", "first");
    unreadable.write(".git/index", "garbage");
    add_recent(dir.path(), &unreadable.path.display().to_string()).unwrap();

    let wips = launchpad_wips(dir.path()).unwrap();

    assert_eq!(wips.len(), 1);
    assert_eq!((wips[0].changes, wips[0].unpushed), (0, 0));
    assert!(
        wips[0]
            .unreadable
            .as_deref()
            .is_some_and(|reason| reason.contains("index file smaller than expected")),
        "{wips:?}"
    );
}

#[test]
fn wips_list_recent_repositories_with_uncommitted_or_unpushed_work_only() {
    let dir = data();
    let clean = Fixture::init();
    clean.commit("a.txt", "a", "first");
    let dirty = Fixture::init();
    dirty.commit("a.txt", "a", "first");
    dirty.write("a.txt", "changed");
    dirty.write("new.txt", "new");
    let origin = Fixture::init();
    origin.commit("a.txt", "a", "first");
    let remote = origin.add_bare_remote("origin");
    origin.git(&["push", "-q", "origin", "main"]);
    let ahead_path = origin.clone_of(&remote, "ahead");
    origin.commit_in(&ahead_path, "b.txt", "b", "unpushed");
    let behind_path = origin.clone_of(&remote, "synced");
    for path in [
        clean.path.display().to_string(),
        dirty.path.display().to_string(),
        ahead_path.display().to_string(),
        behind_path.display().to_string(),
        "/no/such/repository".to_owned(),
    ] {
        add_recent(dir.path(), &path).unwrap();
    }

    let wips = launchpad_wips(dir.path()).unwrap();

    let summary: Vec<(String, u32, u32)> = wips
        .iter()
        .map(|wip| (wip.name.clone(), wip.changes, wip.unpushed))
        .collect();
    let mut sorted = summary.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        [
            ("ahead".to_owned(), 0, 1),
            (
                dirty
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                2,
                0
            ),
        ]
    );
    assert!(wips.iter().all(|wip| wip.branch.is_some()));
}
