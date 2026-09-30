mod common;

use common::Fixture;
use yforge_core::{
    graph_page, search_commits, ErrorKind, GraphVisibility, NodeKind, RefKind, RefSelector,
};

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

    let page = graph_page(&history.repo.path, 0, 100, &GraphVisibility::All).unwrap();

    assert_eq!(page.total, 5);
    assert_eq!(page.rows.len(), 5);
    let (merge_index, merge) = row_of(&page, &history.merge);
    assert_eq!(merge_index, 1);
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
    assert_eq!(base_index, 4);
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

    let all = graph_page(&history.repo.path, 0, 100, &GraphVisibility::All).unwrap();
    let middle = graph_page(&history.repo.path, 2, 2, &GraphVisibility::All).unwrap();
    let past_end = graph_page(&history.repo.path, 10, 5, &GraphVisibility::All).unwrap();
    let empty = graph_page(&history.repo.path, 0, 0, &GraphVisibility::All).unwrap();

    assert_eq!(middle.total, 5);
    assert_eq!(middle.rows, all.rows[2..4].to_vec());
    assert_eq!(all.rows[1].kind, NodeKind::Merge);
    let carried: Vec<_> = middle
        .carried
        .iter()
        .filter(|carried| carried.row == 1)
        .map(|carried| (carried.row, carried.column, carried.kind, carried.edge))
        .collect();
    let expected: Vec<_> = all.rows[1]
        .edges
        .iter()
        .map(|edge| (1, 0, NodeKind::Merge, *edge))
        .collect();
    assert_eq!(carried, expected);
    let last = graph_page(&history.repo.path, 4, 10, &GraphVisibility::All).unwrap();
    assert!(last
        .carried
        .iter()
        .all(|carried| carried.edge.parent_row == Some(4)));
    assert_eq!(last.carried.len(), 2);
    assert_eq!(past_end.total, 5);
    assert!(past_end.rows.is_empty());
    assert_eq!(empty.total, 5);
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

    let page = graph_page(&repo.path, 0, 100, &GraphVisibility::All).unwrap();

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
fn clean_tree_has_a_clean_changes_row_above_head() {
    let history = merged_history();

    let page = graph_page(&history.repo.path, 0, 100, &GraphVisibility::All).unwrap();

    assert_eq!(page.total, 5);
    let clean = &page.rows[0];
    assert_eq!(clean.kind, NodeKind::CleanChanges);
    assert_eq!(clean.sha, None);
    assert_eq!(clean.summary, "Working tree clean");
    assert_eq!(clean.parents, vec![history.merge.clone()]);
    assert_eq!(clean.author, None);
    assert_eq!(clean.time, None);
    assert!(clean.refs.is_empty());
    let (merge_index, merge) = row_of(&page, &history.merge);
    assert_eq!(clean.edges[0].parent_row, Some(merge_index as u32));
    assert_eq!(clean.column, merge.column);
    assert!(page.rows.iter().all(|row| row.kind != NodeKind::Changes));
}

#[test]
fn the_working_tree_row_switches_between_clean_and_changes_as_the_tree_changes() {
    let history = merged_history();
    let path = &history.repo.path;
    let kind = || graph_page(path, 0, 1, &GraphVisibility::All).unwrap().rows[0].kind;

    assert_eq!(kind(), NodeKind::CleanChanges);
    history.repo.write("a.txt", "edited\n");
    assert_eq!(kind(), NodeKind::Changes);
    history.repo.git(&["checkout", "--", "a.txt"]);
    assert_eq!(kind(), NodeKind::CleanChanges);
}

#[test]
fn detached_head_has_no_checked_out_label() {
    let history = merged_history();
    history
        .repo
        .git(&["checkout", "-q", "--detach", &history.base]);

    let page = graph_page(&history.repo.path, 0, 100, &GraphVisibility::All).unwrap();

    assert!(page
        .rows
        .iter()
        .flat_map(|row| row.refs.iter())
        .all(|label| !label.is_head));
}

#[test]
fn unborn_repository_has_an_empty_graph_until_the_tree_is_dirty() {
    let repo = Fixture::init();
    assert_eq!(
        graph_page(&repo.path, 0, 10, &GraphVisibility::All)
            .unwrap()
            .total,
        0
    );

    repo.write("draft.txt", "x\n");
    let page = graph_page(&repo.path, 0, 10, &GraphVisibility::All).unwrap();

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

    let page = graph_page(&clone, 0, 10, &GraphVisibility::All).unwrap();

    let labels: Vec<(&str, RefKind, bool)> = page.rows[1]
        .refs
        .iter()
        .map(|label| (label.name.as_str(), label.kind, label.is_head))
        .collect();
    assert_eq!(page.rows[1].sha.as_deref(), Some(tip.as_str()));
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
        graph_page(dir.path(), 0, 10, &GraphVisibility::All)
            .unwrap_err()
            .kind(),
        ErrorKind::NotARepository
    );
}

struct Divergent {
    repo: Fixture,
    base: String,
    local: String,
    upstream: String,
    feature: String,
}

fn divergent_history() -> Divergent {
    let repo = Fixture::init();
    repo.identity();
    let base = repo.commit("a.txt", "a\n", "Base commit");
    repo.git(&["tag", "v1"]);
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    let feature = repo.commit("f.txt", "f\n", "Feature work");
    repo.git(&["tag", "v-feature"]);
    repo.git(&["checkout", "-q", "main"]);
    let local = repo.commit("m.txt", "m\n", "Local work");
    let other = repo.clone_of(&remote, "other");
    let upstream = repo.commit_in(&other, "u.txt", "u\n", "Upstream work");
    repo.run_in(&other, &["push", "-q", "origin", "main"]);
    repo.git(&["fetch", "-q", "origin"]);
    Divergent {
        repo,
        base,
        local,
        upstream,
        feature,
    }
}

fn summaries(page: &yforge_core::GraphPage) -> Vec<&str> {
    page.rows.iter().map(|row| row.summary.as_str()).collect()
}

fn labels(page: &yforge_core::GraphPage) -> Vec<&str> {
    let mut names: Vec<&str> = page
        .rows
        .iter()
        .flat_map(|row| row.refs.iter())
        .map(|label| label.name.as_str())
        .collect();
    names.sort_unstable();
    names
}

fn widest_lane(page: &yforge_core::GraphPage) -> u32 {
    page.rows
        .iter()
        .flat_map(|row| row.edges.iter().map(|edge| edge.lane).chain([row.column]))
        .max()
        .unwrap_or(0)
}

#[test]
fn current_and_upstream_lays_out_only_the_checked_out_branch_its_upstream_and_their_tags() {
    let history = divergent_history();
    let path = &history.repo.path;

    let all = graph_page(path, 0, 100, &GraphVisibility::All).unwrap();
    let current = graph_page(path, 0, 100, &GraphVisibility::CurrentAndUpstream).unwrap();

    assert_eq!(all.total, 5);
    assert_eq!(widest_lane(&all), 2);
    assert_eq!(current.total, 4);
    let mut shown: Vec<&str> = current
        .rows
        .iter()
        .filter_map(|row| row.sha.as_deref())
        .collect();
    shown.sort_unstable();
    let mut expected = vec![
        history.base.as_str(),
        history.local.as_str(),
        history.upstream.as_str(),
    ];
    expected.sort_unstable();
    assert_eq!(shown, expected);
    assert!(!summaries(&current).contains(&"Feature work"));
    assert_eq!(labels(&current), vec!["main", "origin/main", "v1"]);
    assert_eq!(widest_lane(&current), 1);
    let (_, local) = row_of(&current, &history.local);
    let (_, upstream) = row_of(&current, &history.upstream);
    assert_ne!(local.column, upstream.column);
    assert!(current.rows[0].kind == NodeKind::CleanChanges);
}

#[test]
fn switching_the_visibility_recomputes_the_layout_for_the_same_repository_state() {
    let history = divergent_history();
    let path = &history.repo.path;

    let first = graph_page(path, 0, 100, &GraphVisibility::All).unwrap();
    let filtered = graph_page(path, 0, 100, &GraphVisibility::CurrentAndUpstream).unwrap();
    let again = graph_page(path, 0, 100, &GraphVisibility::All).unwrap();

    assert_ne!(first.total, filtered.total);
    assert_eq!(first, again);
}

#[test]
fn an_explicit_ref_list_shows_only_those_refs_and_the_changes_row_keeps_its_head_parent() {
    let history = divergent_history();
    let path = &history.repo.path;
    let visibility = GraphVisibility::Refs {
        refs: vec![
            RefSelector {
                name: "feature".into(),
                kind: RefKind::LocalBranch,
            },
            RefSelector {
                name: "gone".into(),
                kind: RefKind::LocalBranch,
            },
        ],
    };

    let page = graph_page(path, 0, 100, &visibility).unwrap();

    assert_eq!(summaries(&page)[1..], ["Feature work", "Base commit"]);
    assert_eq!(labels(&page), vec!["feature"]);
    assert!(page
        .rows
        .iter()
        .flat_map(|row| row.refs.iter())
        .all(|label| !label.is_head));
    assert_eq!(page.rows[0].kind, NodeKind::CleanChanges);
    assert_eq!(page.rows[0].parents, vec![history.local.clone()]);
    assert_eq!(page.rows[0].edges[0].parent_row, None);
    let (_, feature) = row_of(&page, &history.feature);
    let (_, base) = row_of(&page, &history.base);
    assert_eq!(feature.column, base.column);
    assert_ne!(feature.column, page.rows[0].column);
}

#[test]
fn an_explicit_tag_selector_shows_that_tag_and_an_empty_list_shows_only_the_changes_row() {
    let history = divergent_history();
    let path = &history.repo.path;
    let tag = GraphVisibility::Refs {
        refs: vec![RefSelector {
            name: "v-feature".into(),
            kind: RefKind::Tag,
        }],
    };

    let tagged = graph_page(path, 0, 100, &tag).unwrap();
    let nothing = graph_page(path, 0, 100, &GraphVisibility::Refs { refs: Vec::new() }).unwrap();

    assert_eq!(labels(&tagged), vec!["v-feature"]);
    assert_eq!(summaries(&tagged)[1..], ["Feature work", "Base commit"]);
    assert_eq!(nothing.total, 1);
    assert_eq!(nothing.rows[0].kind, NodeKind::CleanChanges);
}

#[test]
fn a_detached_head_shows_its_own_history_under_current_and_upstream() {
    let history = divergent_history();
    history
        .repo
        .git(&["checkout", "-q", "--detach", &history.base]);

    let page = graph_page(
        &history.repo.path,
        0,
        100,
        &GraphVisibility::CurrentAndUpstream,
    )
    .unwrap();

    assert_eq!(page.total, 2);
    assert_eq!(page.rows[1].sha.as_deref(), Some(history.base.as_str()));
}

#[test]
fn stashes_of_hidden_branches_are_left_out_of_a_filtered_graph() {
    let history = divergent_history();
    let repo = &history.repo;
    repo.git(&["checkout", "-q", "feature"]);
    repo.write("f.txt", "parked on feature\n");
    repo.git(&["stash", "push", "-q", "-m", "feature stash"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("m.txt", "parked on main\n");
    repo.git(&["stash", "push", "-q", "-m", "main stash"]);

    let all = graph_page(&repo.path, 0, 100, &GraphVisibility::All).unwrap();
    let current = graph_page(&repo.path, 0, 100, &GraphVisibility::CurrentAndUpstream).unwrap();

    let stash_summaries = |page: &yforge_core::GraphPage| -> Vec<String> {
        page.rows
            .iter()
            .filter(|row| row.kind == NodeKind::Stash)
            .map(|row| row.summary.clone())
            .collect()
    };
    assert_eq!(stash_summaries(&all).len(), 2);
    let kept = stash_summaries(&current);
    assert_eq!(kept.len(), 1);
    assert!(kept[0].contains("main stash"));
}

#[test]
fn search_rows_index_the_filtered_graph_the_same_visibility_renders() {
    let history = divergent_history();
    let path = &history.repo.path;
    let visibility = GraphVisibility::CurrentAndUpstream;

    let hidden = search_commits(path, "Feature work", &visibility).unwrap();
    let shown = search_commits(path, "Upstream work", &visibility).unwrap();
    let everywhere = search_commits(path, "Feature work", &GraphVisibility::All).unwrap();

    assert!(hidden.rows.is_empty());
    assert_eq!(hidden.total, 3);
    assert_eq!(everywhere.rows.len(), 1);
    assert_eq!(everywhere.total, 4);
    let page = graph_page(path, 0, 100, &visibility).unwrap();
    assert_eq!(shown.rows.len(), 1);
    assert_eq!(
        page.rows[shown.rows[0] as usize].sha.as_deref(),
        Some(history.upstream.as_str())
    );
}
