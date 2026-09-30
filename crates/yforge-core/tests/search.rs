mod common;

use common::Fixture;
use yforge_core::{graph_page, search_commits, GraphVisibility};

fn history() -> (Fixture, Vec<String>) {
    let repo = Fixture::init();
    repo.identity();
    let first = repo.commit("a.txt", "1\n", "Add greeting");
    repo.write("b.txt", "2\n");
    repo.git(&["add", "b.txt"]);
    repo.git(&[
        "commit",
        "-q",
        "--author=Bo Ray <bo@example.test>",
        "-m",
        "Fix parser",
        "-m",
        "Handles the Greeting edge case",
    ]);
    let second = repo.git(&["rev-parse", "HEAD"]);
    let third = repo.commit("c.txt", "3\n", "Tidy docs");
    (repo, vec![first, second, third])
}

#[test]
fn matches_message_body_sha_and_author_case_insensitively_as_graph_row_indexes_below_the_clean_row()
{
    let (repo, shas) = history();

    let by_message = search_commits(&repo.path, "GREETING", &GraphVisibility::All).unwrap();
    let by_author = search_commits(&repo.path, "bo ray", &GraphVisibility::All).unwrap();
    let by_email = search_commits(&repo.path, "bo@example", &GraphVisibility::All).unwrap();
    let by_sha = search_commits(&repo.path, &shas[2][..8], &GraphVisibility::All).unwrap();
    let none = search_commits(&repo.path, "no such text", &GraphVisibility::All).unwrap();

    assert_eq!(by_message.rows, [2, 3]);
    assert_eq!(by_author.rows, [2]);
    assert_eq!(by_email.rows, [2]);
    assert_eq!(by_sha.rows, [1]);
    assert!(none.rows.is_empty());
    assert_eq!(none.total, 3);
    let page = graph_page(&repo.path, 0, 10, &GraphVisibility::All).unwrap();
    for row in &by_message.rows {
        let sha = page.rows[*row as usize].sha.as_deref().unwrap();
        assert!(sha == shas[0] || sha == shas[1]);
    }
}

#[test]
fn scope_prefixes_restrict_the_fields_searched() {
    let (repo, shas) = history();

    let author_only = search_commits(&repo.path, "author:yui", &GraphVisibility::All).unwrap();
    let author_miss = search_commits(&repo.path, "author:greeting", &GraphVisibility::All).unwrap();
    let sha_only = search_commits(
        &repo.path,
        &format!("sha:{}", &shas[0][..7]),
        &GraphVisibility::All,
    )
    .unwrap();
    let sha_miss = search_commits(&repo.path, "sha:greeting", &GraphVisibility::All).unwrap();

    assert_eq!(author_only.rows, [1, 3]);
    assert!(author_miss.rows.is_empty());
    assert_eq!(sha_only.rows, [3]);
    assert!(sha_miss.rows.is_empty());
}

#[test]
fn an_empty_query_matches_nothing_and_rows_shift_below_the_changes_row() {
    let (repo, _) = history();
    repo.write("dirty.txt", "x\n");

    let empty = search_commits(&repo.path, "  ", &GraphVisibility::All).unwrap();
    let tidy = search_commits(&repo.path, "tidy", &GraphVisibility::All).unwrap();

    assert!(empty.rows.is_empty());
    assert_eq!(empty.total, 3);
    assert_eq!(tidy.rows, [1]);
}

#[test]
fn stash_rows_are_searchable_by_their_message() {
    let (repo, _) = history();
    repo.write("a.txt", "changed\n");
    repo.git(&["stash", "push", "-m", "parked experiment"]);

    let found = search_commits(&repo.path, "parked", &GraphVisibility::All).unwrap();

    assert_eq!(found.rows.len(), 1);
    let page = graph_page(&repo.path, 0, 10, &GraphVisibility::All).unwrap();
    assert_eq!(
        page.rows[found.rows[0] as usize].summary,
        "On main: parked experiment"
    );
}
