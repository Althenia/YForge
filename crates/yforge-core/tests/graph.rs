mod common;

use common::Fixture;
use yforge_core::{graph_page, ErrorKind, NodeKind, RefKind};

struct History {
    repo: Fixture,
    base: String,
    main_tip: String,
    feature_tip: String,
    merge: String,
}

fn merged_history() -> History {
    let repo = Fixture::init();
    let base = repo.commit("a.txt", "a\n", "Base commit");
    repo.git(&["tag", "-a", "v1", "-m", "release one"]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    let feature_tip = repo.commit("feature.txt", "f\n", "Feature work");
    repo.git(&["checkout", "-q", "main"]);
    let main_tip = repo.commit("main.txt", "m\n", "Main work");
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge feature", "feature"]);
    let merge = repo.git(&["rev-parse", "HEAD"]);
    History {
        repo,
        base,
        main_tip,
        feature_tip,
        merge,
    }
}

fn row_of<'a>(page: &'a yforge_core::GraphPage, sha: &str) -> (usize, &'a yforge_core::GraphRow) {
    page.rows
        .iter()
        .enumerate()
        .find(|(_, row)| row.sha.as_deref() == Some(sha))
        .expect("row for sha")
}

#[test]
fn merge_history_has_merge_row_lanes_and_refs() {
    let history = merged_history();

    let page = graph_page(&history.repo.path, 0, 100).unwrap();

    assert_eq!(page.total, 4);
    assert_eq!(page.rows.len(), 4);
    let (merge_index, merge) = row_of(&page, &history.merge);
    assert_eq!(merge_index, 0);
    assert_eq!(merge.kind, NodeKind::Merge);
    assert_eq!(merge.summary, "Merge feature");
    assert_eq!(
        merge.parents,
        vec![history.main_tip.clone(), history.feature_tip.clone()]
    );
    assert_eq!(merge.column, 0);
    assert_eq!(merge.edges.len(), 2);
    assert_eq!(merge.edges[0].lane, 0);
    assert_eq!(merge.edges[1].lane, 1);
    assert_eq!(
        merge.author.as_ref().map(|author| author.initials.as_str()),
        Some("YL")
    );
    let head_labels: Vec<(&str, RefKind, bool)> = merge
        .refs
        .iter()
        .map(|label| (label.name.as_str(), label.kind, label.is_head))
        .collect();
    assert_eq!(head_labels, vec![("main", RefKind::LocalBranch, true)]);

    let (main_index, main_row) = row_of(&page, &history.main_tip);
    let (feature_index, feature_row) = row_of(&page, &history.feature_tip);
    let (base_index, base_row) = row_of(&page, &history.base);
    assert_eq!(main_row.column, 0);
    assert_eq!(feature_row.column, 1);
    assert_eq!(base_row.column, 0);
    assert_eq!(base_index, 3);
    assert_eq!(merge.edges[0].parent_row, Some(main_index as u32));
    assert_eq!(merge.edges[1].parent_row, Some(feature_index as u32));
    assert_eq!(feature_row.edges[0].lane, 1);
    assert_eq!(feature_row.edges[0].parent_row, Some(base_index as u32));
    assert_eq!(feature_row.edges[0].parent_column, Some(0));
    assert!(base_row.edges.is_empty());

    let feature_labels: Vec<&str> = feature_row
        .refs
        .iter()
        .map(|label| label.name.as_str())
        .collect();
    assert_eq!(feature_labels, vec!["feature"]);
    assert!(!feature_row.refs[0].is_head);
    assert_eq!(base_row.refs.len(), 1);
    assert_eq!(base_row.refs[0].name, "v1");
    assert_eq!(base_row.refs[0].kind, RefKind::Tag);
}

#[test]
fn pages_are_windows_of_one_consistent_layout() {
    let history = merged_history();

    let all = graph_page(&history.repo.path, 0, 100).unwrap();
    let middle = graph_page(&history.repo.path, 1, 2).unwrap();
    let past_end = graph_page(&history.repo.path, 10, 5).unwrap();
    let empty = graph_page(&history.repo.path, 0, 0).unwrap();

    assert_eq!(middle.total, 4);
    assert_eq!(middle.rows, all.rows[1..3].to_vec());
    assert!(all.carried.is_empty());
    let merge = &all.rows[0];
    let carried: Vec<_> = middle
        .carried
        .iter()
        .map(|carried| (carried.row, carried.column, carried.kind, carried.edge))
        .collect();
    let expected: Vec<_> = merge
        .edges
        .iter()
        .map(|edge| (0, 0, NodeKind::Merge, *edge))
        .collect();
    assert_eq!(carried, expected);
    let last = graph_page(&history.repo.path, 3, 10).unwrap();
    assert!(last
        .carried
        .iter()
        .all(|carried| carried.edge.parent_row == Some(3)));
    assert_eq!(last.carried.len(), 2);
    assert_eq!(past_end.total, 4);
    assert!(past_end.rows.is_empty());
    assert_eq!(empty.total, 4);
    assert!(empty.rows.is_empty());
}

#[test]
fn dirty_tree_adds_a_changes_row_above_head_and_stashes_add_stash_rows() {
    let history = merged_history();
    let repo = &history.repo;
    repo.write("a.txt", "stashed\n");
    repo.git(&["stash", "push", "-q", "-m", "parked work"]);
    repo.write("a.txt", "dirty\n");
    repo.write("new.txt", "n\n");

    let page = graph_page(&repo.path, 0, 100).unwrap();

    assert_eq!(page.total, 6);
    let changes = &page.rows[0];
    assert_eq!(changes.kind, NodeKind::Changes);
    assert_eq!(changes.sha, None);
    assert_eq!(changes.summary, "Changes: 1 modified, 1 untracked");
    assert_eq!(changes.parents, vec![history.merge.clone()]);
    assert_eq!(changes.author, None);
    assert_eq!(changes.time, None);
    let (merge_index, _) = row_of(&page, &history.merge);
    assert_eq!(changes.edges[0].parent_row, Some(merge_index as u32));

    let stash = page
        .rows
        .iter()
        .find(|row| row.kind == NodeKind::Stash)
        .expect("stash row");
    assert!(stash.summary.contains("parked work"));
    assert_eq!(stash.parents, vec![history.merge.clone()]);
    assert!(stash.sha.is_some());
    assert_eq!(
        page.rows
            .iter()
            .filter(|row| row.kind == NodeKind::Stash)
            .count(),
        1
    );
    let stash_index = page
        .rows
        .iter()
        .position(|row| row.kind == NodeKind::Stash)
        .unwrap();
    assert!(stash_index < merge_index);
    assert_eq!(stash.edges[0].parent_row, Some(merge_index as u32));
}

#[test]
fn clean_tree_has_no_changes_row() {
    let history = merged_history();

    let page = graph_page(&history.repo.path, 0, 100).unwrap();

    assert!(page.rows.iter().all(|row| row.kind != NodeKind::Changes));
}

#[test]
fn detached_head_has_no_checked_out_label() {
    let history = merged_history();
    history
        .repo
        .git(&["checkout", "-q", "--detach", &history.base]);

    let page = graph_page(&history.repo.path, 0, 100).unwrap();

    assert!(page
        .rows
        .iter()
        .flat_map(|row| row.refs.iter())
        .all(|label| !label.is_head));
}

#[test]
fn unborn_repository_has_an_empty_graph_until_the_tree_is_dirty() {
    let repo = Fixture::init();
    assert_eq!(graph_page(&repo.path, 0, 10).unwrap().total, 0);

    repo.write("draft.txt", "x\n");
    let page = graph_page(&repo.path, 0, 10).unwrap();

    assert_eq!(page.total, 1);
    assert_eq!(page.rows[0].kind, NodeKind::Changes);
    assert!(page.rows[0].parents.is_empty());
    assert!(page.rows[0].edges.is_empty());
}

#[test]
fn remote_and_local_branches_on_one_commit_are_both_labelled() {
    let origin = Fixture::init();
    let tip = origin.commit("a.txt", "1\n", "First");
    let clone = origin.clone_to("clone");

    let page = graph_page(&clone, 0, 10).unwrap();

    let labels: Vec<(&str, RefKind, bool)> = page.rows[0]
        .refs
        .iter()
        .map(|label| (label.name.as_str(), label.kind, label.is_head))
        .collect();
    assert_eq!(page.rows[0].sha.as_deref(), Some(tip.as_str()));
    assert_eq!(
        labels,
        vec![
            ("main", RefKind::LocalBranch, true),
            ("origin/main", RefKind::RemoteBranch, false),
        ]
    );
}

#[test]
fn non_repository_is_a_typed_error() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(
        graph_page(dir.path(), 0, 10).unwrap_err().kind(),
        ErrorKind::NotARepository
    );
}
