use yforge_core::{
    repo_alias_problem, repo_aliases_list, repo_aliases_set, start_storage, ErrorKind, RepoAlias,
};

fn alias(path: &str, name: &str) -> RepoAlias {
    RepoAlias {
        path: path.to_owned(),
        alias: name.to_owned(),
    }
}

#[test]
fn a_repository_without_an_alias_is_not_listed() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();

    assert!(repo_aliases_list(dir.path()).unwrap().is_empty());
}

#[test]
fn an_alias_is_saved_per_repository_trimmed_and_replaced_on_the_next_save() {
    let dir = tempfile::tempdir().unwrap();

    let first = repo_aliases_set(dir.path(), "/work/api", Some("  Corp A · API ")).unwrap();
    let both = repo_aliases_set(dir.path(), "/work/web", Some("Web")).unwrap();
    let renamed = repo_aliases_set(dir.path(), "/work/api", Some("Corp B")).unwrap();

    assert_eq!(first, [alias("/work/api", "Corp A · API")]);
    assert_eq!(
        both,
        [
            alias("/work/api", "Corp A · API"),
            alias("/work/web", "Web")
        ]
    );
    assert_eq!(
        renamed,
        [alias("/work/api", "Corp B"), alias("/work/web", "Web")]
    );
    assert_eq!(repo_aliases_list(dir.path()).unwrap(), renamed);
}

#[test]
fn removing_an_alias_deletes_only_that_repository_and_removing_a_missing_one_is_a_no_op() {
    let dir = tempfile::tempdir().unwrap();
    repo_aliases_set(dir.path(), "/work/api", Some("API")).unwrap();
    repo_aliases_set(dir.path(), "/work/web", Some("Web")).unwrap();

    let remaining = repo_aliases_set(dir.path(), "/work/api", None).unwrap();
    let unchanged = repo_aliases_set(dir.path(), "/work/missing", None).unwrap();

    assert_eq!(remaining, [alias("/work/web", "Web")]);
    assert_eq!(unchanged, remaining);
}

#[test]
fn an_alias_of_one_to_forty_characters_is_accepted_and_anything_else_is_refused_without_changing_the_store(
) {
    let dir = tempfile::tempdir().unwrap();
    let longest = "é".repeat(40);
    repo_aliases_set(dir.path(), "/work/api", Some(&longest)).unwrap();

    for refused in ["", "   ", &"x".repeat(41)] {
        let error = repo_aliases_set(dir.path(), "/work/api", Some(refused)).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{refused:?}");
    }

    assert_eq!(
        repo_aliases_list(dir.path()).unwrap(),
        [alias("/work/api", &longest)]
    );
    assert_eq!(repo_alias_problem(&longest), None);
    assert_eq!(repo_alias_problem(" a "), None);
    assert_eq!(repo_alias_problem("  ").as_deref(), Some("Enter an alias"));
    assert_eq!(
        repo_alias_problem(&"x".repeat(41)).as_deref(),
        Some("An alias is at most 40 characters")
    );
}

#[test]
fn an_empty_repository_path_is_refused() {
    let dir = tempfile::tempdir().unwrap();

    let error = repo_aliases_set(dir.path(), "", Some("API")).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn start_storage_creates_the_alias_table_in_a_database_that_predates_it() {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    let connection = rusqlite::Connection::open(dir.path().join("yforge.db")).unwrap();
    connection
        .execute_batch("DROP TABLE repo_aliases; PRAGMA user_version = 10;")
        .unwrap();
    drop(connection);

    start_storage(dir.path()).unwrap();

    assert!(repo_aliases_list(dir.path()).unwrap().is_empty());
}
