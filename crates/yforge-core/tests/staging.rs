mod common;

use common::Fixture;
use yforge_core::{
    diff_file, discard_files, discard_hunk, discard_lines, repo_snapshot, stage_all, stage_files,
    stage_hunk, stage_lines, unstage_all, unstage_files, unstage_hunk, unstage_lines, ChangeArea,
    DiffHunk, DiffLineKind, ErrorKind,
};

fn areas(repo: &Fixture) -> Vec<(String, ChangeArea)> {
    repo_snapshot(&repo.path)
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.area))
        .collect()
}

fn dirty_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "1\n", "First");
    repo.commit("gone.txt", "bye\n", "Second");
    repo.write("a.txt", "2\n");
    repo.write("new.txt", "n\n");
    std::fs::remove_file(repo.path.join("gone.txt")).unwrap();
    repo
}

fn two_hunk_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("f.txt", &[]);
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.numbered(
        "f.txt",
        &[(2, "second line changed"), (28, "line 28 changed")],
    );
    repo
}

#[test]
fn stages_and_unstages_modified_untracked_and_deleted_files() {
    let repo = dirty_repository();

    stage_files(
        &repo.path,
        &["a.txt".into(), "new.txt".into(), "gone.txt".into()],
    )
    .unwrap();

    let staged = areas(&repo);
    assert!(staged.iter().all(|(_, area)| *area == ChangeArea::Staged));
    assert_eq!(staged.len(), 3);

    unstage_files(&repo.path, &["a.txt".into(), "gone.txt".into()]).unwrap();

    let mixed = areas(&repo);
    assert!(mixed.contains(&("a.txt".into(), ChangeArea::Unstaged)));
    assert!(mixed.contains(&("gone.txt".into(), ChangeArea::Unstaged)));
    assert!(mixed.contains(&("new.txt".into(), ChangeArea::Staged)));
}

#[test]
fn stages_and_unstages_everything_including_a_first_commit_index() {
    let repo = dirty_repository();

    stage_all(&repo.path).unwrap();
    assert!(areas(&repo)
        .iter()
        .all(|(_, area)| *area == ChangeArea::Staged));

    unstage_all(&repo.path).unwrap();
    assert!(areas(&repo)
        .iter()
        .all(|(_, area)| *area != ChangeArea::Staged));

    let unborn = Fixture::init();
    unborn.write("first.txt", "x\n");
    stage_all(&unborn.path).unwrap();
    assert_eq!(
        areas(&unborn),
        vec![("first.txt".into(), ChangeArea::Staged)]
    );
    unstage_all(&unborn.path).unwrap();
    assert_eq!(
        areas(&unborn),
        vec![("first.txt".into(), ChangeArea::Untracked)]
    );
}

#[test]
fn refuses_to_stage_everything_while_files_are_conflicted() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("c.txt", "base\n", "Base");
    repo.git(&["checkout", "-q", "-b", "side"]);
    repo.commit("c.txt", "side\n", "Side");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("c.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "side"]);

    let error = stage_all(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(areas(&repo).contains(&("c.txt".into(), ChangeArea::Conflicted)));
}

#[test]
fn discards_tracked_changes_and_removes_untracked_files_only_when_listed() {
    let repo = dirty_repository();
    repo.write("keep-untracked.txt", "stay\n");

    discard_files(
        &repo.path,
        &["a.txt".into(), "gone.txt".into(), "new.txt".into()],
    )
    .unwrap();

    assert_eq!(repo.read("a.txt"), "1\n");
    assert_eq!(repo.read("gone.txt"), "bye\n");
    assert!(!repo.path.join("new.txt").exists());
    assert_eq!(repo.read("keep-untracked.txt"), "stay\n");
    assert_eq!(
        areas(&repo),
        vec![("keep-untracked.txt".into(), ChangeArea::Untracked)]
    );
}

#[test]
fn discard_keeps_staged_content_and_rejects_files_without_a_discardable_change() {
    let repo = dirty_repository();
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "3\n");

    discard_files(&repo.path, &["a.txt".into()]).unwrap();
    assert_eq!(repo.read("a.txt"), "2\n");
    assert_eq!(repo.git(&["show", ":a.txt"]), "2");

    let error = discard_files(&repo.path, &["a.txt".into()]).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "2\n");
}

#[test]
fn rejects_empty_and_escaping_paths_before_running_git() {
    let repo = dirty_repository();
    for files in [
        vec![],
        vec!["../outside".to_owned()],
        vec!["/etc/hosts".to_owned()],
    ] {
        assert_eq!(
            stage_files(&repo.path, &files).unwrap_err().kind(),
            ErrorKind::InvalidRequest
        );
    }
}

#[test]
fn stages_one_hunk_and_leaves_the_others_unstaged() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    assert_eq!(diff.hunks.len(), 2);

    stage_hunk(&repo.path, "f.txt", &diff.hunks[0], false).unwrap();

    let staged = repo.git(&["diff", "--cached"]);
    assert!(staged.contains("+second line changed"));
    assert!(!staged.contains("line 28 changed"));
    let unstaged = repo.git(&["diff"]);
    assert!(unstaged.contains("+line 28 changed"));
    assert!(!unstaged.contains("second line changed"));
    assert_eq!(
        repo.read("f.txt").lines().nth(1),
        Some("second line changed")
    );
    assert!(areas(&repo).contains(&("f.txt".into(), ChangeArea::Staged)));
    assert!(areas(&repo).contains(&("f.txt".into(), ChangeArea::Unstaged)));
}

#[test]
fn unstages_one_staged_hunk_and_keeps_the_other_staged() {
    let repo = two_hunk_repository();
    repo.git(&["add", "f.txt"]);
    let staged = diff_file(&repo.path, "f.txt", ChangeArea::Staged, false).unwrap();
    assert_eq!(staged.hunks.len(), 2);

    unstage_hunk(&repo.path, "f.txt", &staged.hunks[1], false).unwrap();

    let cached = repo.git(&["diff", "--cached"]);
    assert!(cached.contains("+second line changed"));
    assert!(!cached.contains("line 28 changed"));
    assert!(repo.git(&["diff"]).contains("+line 28 changed"));
}

#[test]
fn discards_one_hunk_from_the_working_tree_only() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();

    discard_hunk(&repo.path, "f.txt", &diff.hunks[1], false).unwrap();

    let contents = repo.read("f.txt");
    assert!(contents.contains("second line changed"));
    assert!(contents.contains("line 28\n"));
    assert!(!contents.contains("line 28 changed"));
    assert_eq!(repo.git(&["diff", "--cached"]), "");
}

#[test]
fn refuses_a_stale_hunk_without_touching_the_index_or_the_file() {
    let repo = two_hunk_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    repo.numbered("f.txt", &[(2, "edited again"), (28, "line 28 changed")]);
    let before = repo.read("f.txt");

    for outcome in [
        stage_hunk(&repo.path, "f.txt", &diff.hunks[0], false),
        discard_hunk(&repo.path, "f.txt", &diff.hunks[0], false),
        unstage_hunk(&repo.path, "f.txt", &diff.hunks[0], false),
    ] {
        let error = outcome.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::StaleHunk);
    }

    assert_eq!(repo.git(&["diff", "--cached"]), "");
    assert_eq!(repo.read("f.txt"), before);
}

fn cluster_repository() -> (Fixture, String) {
    let repo = Fixture::init();
    repo.identity();
    repo.numbered("f.txt", &[]);
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    let base = repo.read("f.txt");
    let edited: Vec<String> = base
        .lines()
        .flat_map(|line| match line {
            "line 5" => vec!["five".to_owned()],
            "line 6" => vec!["six".to_owned()],
            "line 7" => vec!["line 7".to_owned(), "inserted".to_owned()],
            other => vec![other.to_owned()],
        })
        .collect();
    repo.write("f.txt", &format!("{}\n", edited.join("\n")));
    (repo, base)
}

fn change_indexes(hunk: &DiffHunk) -> Vec<u32> {
    (0..hunk.lines.len() as u32)
        .filter(|index| hunk.lines[*index as usize].kind != DiffLineKind::Context)
        .collect()
}

fn pick(hunk: &DiffHunk, wanted: &[(DiffLineKind, &str)]) -> Vec<u32> {
    wanted
        .iter()
        .map(|(kind, text)| {
            hunk.lines
                .iter()
                .position(|line| line.kind == *kind && line.text == *text)
                .unwrap_or_else(|| panic!("no {kind:?} line {text:?}")) as u32
        })
        .collect()
}

fn walked(hunk: &DiffHunk, selected: &[u32], keep_selected: bool) -> Vec<String> {
    let mut lines = Vec::new();
    for (index, line) in hunk.lines.iter().enumerate() {
        let chosen = selected.contains(&(index as u32));
        let present = match line.kind {
            DiffLineKind::Context => true,
            DiffLineKind::Removed => chosen != keep_selected,
            DiffLineKind::Added => chosen == keep_selected,
        };
        if present {
            lines.push(line.text.clone());
        }
    }
    lines
}

fn splice(whole: &str, start: u32, count: u32, middle: &[String]) -> String {
    let lines: Vec<&str> = whole.lines().collect();
    let from = start as usize - 1;
    let mut result: Vec<String> = lines[..from]
        .iter()
        .map(|line| (*line).to_owned())
        .collect();
    result.extend(middle.iter().cloned());
    result.extend(
        lines[from + count as usize..]
            .iter()
            .map(|line| (*line).to_owned()),
    );
    result.join("\n")
}

fn subsets(all: &[u32]) -> Vec<Vec<u32>> {
    (1_u32..1 << all.len())
        .map(|mask| {
            all.iter()
                .enumerate()
                .filter(|(position, _)| mask & (1 << position) != 0)
                .map(|(_, index)| *index)
                .collect()
        })
        .collect()
}

#[test]
fn stages_only_the_selected_lines_of_a_hunk() {
    let (repo, _) = cluster_repository();
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    assert_eq!(diff.hunks.len(), 1);
    let hunk = &diff.hunks[0];
    let selected = pick(
        hunk,
        &[
            (DiffLineKind::Removed, "line 5"),
            (DiffLineKind::Added, "five"),
        ],
    );

    stage_lines(&repo.path, "f.txt", hunk, &selected, false).unwrap();

    let staged = repo.git(&["show", ":f.txt"]);
    let staged_lines: Vec<&str> = staged.lines().collect();
    assert_eq!(&staged_lines[3..7], ["line 4", "line 6", "five", "line 7"]);
    assert!(!staged.contains("inserted"));
    let worktree = repo.read("f.txt");
    assert!(worktree.contains("six") && worktree.contains("inserted"));
    let unstaged = repo.git(&["diff"]);
    assert!(unstaged.contains("+six") && unstaged.contains("+inserted"));
    assert!(!unstaged.contains("+five"));
}

#[test]
fn every_line_selection_stages_exactly_the_selected_changes() {
    let (repo, base) = cluster_repository();
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false)
        .unwrap()
        .hunks
        .remove(0);
    for selected in subsets(&change_indexes(&hunk)) {
        stage_lines(&repo.path, "f.txt", &hunk, &selected, false).unwrap();

        let expected = splice(
            &base,
            hunk.old_start,
            hunk.old_lines,
            &walked(&hunk, &selected, true),
        );
        assert_eq!(repo.git(&["show", ":f.txt"]), expected, "{selected:?}");
        repo.git(&["reset", "-q"]);
    }
}

#[test]
fn every_line_selection_unstages_exactly_the_selected_changes() {
    let (repo, _) = cluster_repository();
    let edited = repo.read("f.txt");
    repo.git(&["add", "f.txt"]);
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Staged, false)
        .unwrap()
        .hunks
        .remove(0);
    for selected in subsets(&change_indexes(&hunk)) {
        unstage_lines(&repo.path, "f.txt", &hunk, &selected, false).unwrap();

        let expected = splice(
            &edited,
            hunk.new_start,
            hunk.new_lines,
            &walked(&hunk, &selected, false),
        );
        assert_eq!(repo.git(&["show", ":f.txt"]), expected, "{selected:?}");
        assert_eq!(repo.read("f.txt"), edited);
        repo.git(&["add", "f.txt"]);
    }
}

#[test]
fn every_line_selection_discards_exactly_the_selected_changes_from_the_work_tree() {
    let (repo, _) = cluster_repository();
    let edited = repo.read("f.txt");
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false)
        .unwrap()
        .hunks
        .remove(0);
    for selected in subsets(&change_indexes(&hunk)) {
        discard_lines(&repo.path, "f.txt", &hunk, &selected, false).unwrap();

        let expected = splice(
            &edited,
            hunk.new_start,
            hunk.new_lines,
            &walked(&hunk, &selected, false),
        );
        assert_eq!(repo.read("f.txt").trim_end(), expected, "{selected:?}");
        assert_eq!(repo.git(&["diff", "--cached"]), "");
        repo.write("f.txt", &edited);
    }
}

#[test]
fn refuses_a_stale_line_selection_without_touching_anything() {
    let (repo, _) = cluster_repository();
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false)
        .unwrap()
        .hunks
        .remove(0);
    let selected = pick(&hunk, &[(DiffLineKind::Added, "five")]);
    repo.write("f.txt", "changed underneath\n");
    let before = repo.read("f.txt");

    for outcome in [
        stage_lines(&repo.path, "f.txt", &hunk, &selected, false),
        discard_lines(&repo.path, "f.txt", &hunk, &selected, false),
        unstage_lines(&repo.path, "f.txt", &hunk, &selected, false),
    ] {
        assert_eq!(outcome.unwrap_err().kind(), ErrorKind::StaleHunk);
    }

    assert_eq!(repo.git(&["diff", "--cached"]), "");
    assert_eq!(repo.read("f.txt"), before);
}

#[test]
fn rejects_selections_without_a_changed_line_or_outside_the_hunk() {
    let (repo, _) = cluster_repository();
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false)
        .unwrap()
        .hunks
        .remove(0);
    let context = hunk
        .lines
        .iter()
        .position(|line| line.kind == DiffLineKind::Context)
        .unwrap() as u32;

    for selected in [vec![], vec![context], vec![hunk.lines.len() as u32]] {
        let error = stage_lines(&repo.path, "f.txt", &hunk, &selected, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{selected:?}");
    }
    assert_eq!(repo.git(&["diff", "--cached"]), "");
}

#[test]
fn refuses_to_stage_from_a_whitespace_ignored_view() {
    let (repo, _) = cluster_repository();
    let hunk = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false)
        .unwrap()
        .hunks
        .remove(0);
    let selected = change_indexes(&hunk);
    let before = repo.read("f.txt");

    for outcome in [
        stage_hunk(&repo.path, "f.txt", &hunk, true),
        unstage_hunk(&repo.path, "f.txt", &hunk, true),
        discard_hunk(&repo.path, "f.txt", &hunk, true),
        stage_lines(&repo.path, "f.txt", &hunk, &selected, true),
        unstage_lines(&repo.path, "f.txt", &hunk, &selected, true),
        discard_lines(&repo.path, "f.txt", &hunk, &selected, true),
    ] {
        assert_eq!(outcome.unwrap_err().kind(), ErrorKind::WhitespaceIgnored);
    }

    assert_eq!(repo.git(&["diff", "--cached"]), "");
    assert_eq!(repo.read("f.txt"), before);
}
