use rusqlite::Connection;
use yforge_core::{
    platform_connection_add, platform_connection_remove, platform_connections_list, start_storage,
    ErrorKind, PlatformKind,
};

const KINDS: [PlatformKind; 3] = [
    PlatformKind::GitHub,
    PlatformKind::GitLab,
    PlatformKind::Bitbucket,
];

fn data() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

#[test]
fn connections_round_trip_in_creation_order_without_any_token_column() {
    let dir = data();
    let first = platform_connection_add(
        dir.path(),
        PlatformKind::GitLab,
        "gitlab.example.com",
        "Work",
        true,
    )
    .unwrap();
    let second = platform_connection_add(
        dir.path(),
        PlatformKind::GitHub,
        "github.com",
        "Home",
        false,
    )
    .unwrap();

    assert_ne!(first.id, second.id);
    assert!(first.id.starts_with("gitlab-") && second.id.starts_with("github-"));
    assert_eq!(
        platform_connections_list(dir.path()).unwrap(),
        [first.clone(), second]
    );
    assert!(first.insecure_tls && first.created_at > 0);
    let columns: Vec<String> = Connection::open(dir.path().join("yforge.db"))
        .unwrap()
        .prepare("SELECT name FROM pragma_table_info('platform_connections')")
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
            "host",
            "name",
            "insecure_tls",
            "created_at"
        ]
    );
}

#[test]
fn removing_a_connection_deletes_only_its_row_and_an_unknown_id_is_invalid() {
    let dir = data();
    let keep = platform_connection_add(
        dir.path(),
        PlatformKind::Bitbucket,
        "bitbucket.org",
        "A",
        false,
    )
    .unwrap();
    let drop = platform_connection_add(dir.path(), PlatformKind::GitHub, "github.com", "B", false)
        .unwrap();

    platform_connection_remove(dir.path(), &drop.id).unwrap();

    assert_eq!(platform_connections_list(dir.path()).unwrap(), [keep]);
    assert_eq!(
        platform_connection_remove(dir.path(), &drop.id)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn kinds_use_their_platform_names_on_the_wire_and_in_the_store() {
    let wire: Vec<String> = KINDS
        .into_iter()
        .map(|kind| serde_json::to_string(&kind).unwrap())
        .collect();
    assert_eq!(wire, [r#""github""#, r#""gitlab""#, r#""bitbucket""#]);
    for kind in KINDS {
        assert_eq!(
            serde_json::from_str::<PlatformKind>(&serde_json::to_string(&kind).unwrap()).unwrap(),
            kind
        );
        assert_eq!(PlatformKind::parse(kind.as_str()), Some(kind));
    }
    assert_eq!(PlatformKind::parse("git_hub"), None);

    let dir = data();
    let stored: Vec<PlatformKind> = KINDS
        .into_iter()
        .map(|kind| platform_connection_add(dir.path(), kind, "host.example", "Name", false))
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .into_iter()
        .map(|connection| connection.kind)
        .collect();
    let listed: Vec<PlatformKind> = platform_connections_list(dir.path())
        .unwrap()
        .into_iter()
        .map(|connection| connection.kind)
        .collect();
    assert_eq!(stored, KINDS);
    assert_eq!(listed, KINDS);
    let kinds: Vec<String> = Connection::open(dir.path().join("yforge.db"))
        .unwrap()
        .prepare("SELECT kind FROM platform_connections ORDER BY seq")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(kinds, ["github", "gitlab", "bitbucket"]);
}
