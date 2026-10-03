mod common;

use common::Fixture;
use yforge_core::{
    commit_tree_paths, file_blame, file_history, plan_revert_hunk, revert_hunk, snapshot_files,
    undo, ErrorKind, FileStatus, Planned,
};

fn repo() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo
}

fn head(repo: &Fixture) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

#[test]
fn history_lists_every_commit_that_changed_the_file_newest_first_following_renames() {
    let repo = repo();
    repo.commit("one.txt", "a\nb\nc\n", "Add one");
    repo.commit("one.txt", "a\nB\nc\n", "Edit one");
    repo.commit("other.txt", "x\n", "Touch another file");
    repo.git(&["mv", "one.txt", "two.txt"]);
    repo.git(&["commit", "-q", "-m", "Rename"]);
    let newest = repo.commit("two.txt", "a\nB\nC\n", "Edit two");

    let history = file_history(&repo.path, "two.txt").unwrap();

    let summaries: Vec<&str> = history.iter().map(|r| r.summary.as_str()).collect();
    assert_eq!(summaries, ["Edit two", "Rename", "Edit one", "Add one"]);
    let paths: Vec<&str> = history.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(paths, ["two.txt", "two.txt", "one.txt", "one.txt"]);
    let statuses: Vec<FileStatus> = history.iter().map(|r| r.status).collect();
    assert_eq!(
        statuses,
        [
            FileStatus::Modified,
            FileStatus::Renamed,
            FileStatus::Modified,
            FileStatus::Added
        ]
    );
    assert_eq!(history[0].sha, newest);
    assert_eq!(history[0].short, newest[..7]);
    assert_eq!(history[0].author, "Yui Lin");
    assert_eq!(history[0].email, "yui@example.test");
    assert!(history.windows(2).all(|pair| pair[0].time > pair[1].time));
}

#[test]
fn history_of_an_unknown_file_is_empty() {
    let repo = repo();
    repo.commit("a.txt", "a\n", "First");

    assert!(file_history(&repo.path, "missing.txt").unwrap().is_empty());
}

#[test]
fn blame_merges_consecutive_lines_from_one_commit_into_one_run() {
    let repo = repo();
    let base = repo.commit("f.txt", "1\n2\n3\n4\n", "Base");
    let change = repo.commit("f.txt", "1\nX\nY\n4\n", "Change the middle");

    let runs = file_blame(&repo.path, "f.txt", None).unwrap();

    let shape: Vec<(&str, u32, Vec<&str>)> = runs
        .iter()
        .map(|run| {
            (
                run.sha.as_str(),
                run.start,
                run.lines.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        shape,
        [
            (base.as_str(), 1, vec!["1"]),
            (change.as_str(), 2, vec!["X", "Y"]),
            (base.as_str(), 4, vec!["4"]),
        ]
    );
    assert_eq!(runs[1].summary, "Change the middle");
    assert_eq!(runs[1].short, change[..7]);
    assert_eq!(runs[1].author, "Yui Lin");
    assert_eq!(runs[1].email, "yui@example.test");
    assert!(runs[1].time > runs[0].time);
}

#[test]
fn blame_reads_the_requested_revision_and_ignores_the_working_tree() {
    let repo = repo();
    let base = repo.commit("f.txt", "1\n2\n", "Base");
    repo.commit("f.txt", "1\nchanged\n", "Change");
    repo.write("f.txt", "uncommitted\n");

    let runs = file_blame(&repo.path, "f.txt", Some(base.as_str())).unwrap();

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].sha, base);
    assert_eq!(runs[0].start, 1);
    assert_eq!(runs[0].lines, ["1", "2"]);
}

fn two_hunk_commit(repo: &Fixture) -> String {
    repo.numbered("n.txt", &[]);
    repo.git(&["add", "n.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.numbered("n.txt", &[(3, "three"), (25, "twenty-five")]);
    repo.git(&["commit", "-q", "-am", "Two edits"]);
    head(repo)
}

fn line(repo: &Fixture, file: &str, number: usize) -> String {
    repo.read(file).lines().nth(number - 1).unwrap().to_owned()
}

#[test]
fn reverting_a_hunk_puts_its_reverse_change_in_the_working_tree_as_unstaged() {
    let repo = repo();
    let sha = two_hunk_commit(&repo);

    revert_hunk(&repo.path, &sha, "n.txt", 1).unwrap();

    assert_eq!(line(&repo, "n.txt", 25), "line 25");
    assert_eq!(line(&repo, "n.txt", 3), "three");
    assert_eq!(repo.git(&["status", "--porcelain"]), "M n.txt");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert_eq!(head(&repo), sha);
}

#[test]
fn reverting_a_hunk_of_a_renamed_file_keeps_the_new_name() {
    let repo = repo();
    repo.numbered("n.txt", &[]);
    repo.git(&["add", "n.txt"]);
    repo.git(&["commit", "-q", "-m", "Base"]);
    repo.git(&["mv", "n.txt", "m.txt"]);
    repo.numbered("m.txt", &[(25, "twenty-five")]);
    repo.git(&["commit", "-q", "-am", "Rename and edit"]);
    let sha = head(&repo);

    revert_hunk(&repo.path, &sha, "m.txt", 0).unwrap();

    assert_eq!(line(&repo, "m.txt", 25), "line 25");
    assert!(!repo.path.join("n.txt").exists());
    assert_eq!(repo.git(&["status", "--porcelain"]), "M m.txt");
}

#[test]
fn a_hunk_that_changed_again_is_refused_and_nothing_changes() {
    let repo = repo();
    let sha = two_hunk_commit(&repo);
    repo.numbered("n.txt", &[(3, "three"), (25, "twenty-five again")]);
    repo.git(&["commit", "-q", "-am", "Again"]);
    let before = repo.read("n.txt");

    let error = revert_hunk(&repo.path, &sha, "n.txt", 1).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "This hunk changed again after {}, so it cannot be reverted. Nothing was changed.",
            &sha[..7]
        )
    );
    assert_eq!(error.kind(), ErrorKind::StaleHunk);
    assert_eq!(repo.read("n.txt"), before);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn a_hunk_index_past_the_end_is_an_invalid_request() {
    let repo = repo();
    let sha = two_hunk_commit(&repo);

    let error = revert_hunk(&repo.path, &sha, "n.txt", 2).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn undoing_a_reverted_hunk_restores_the_file_from_its_snapshot() {
    let repo = repo();
    let sha = two_hunk_commit(&repo);
    let files = vec!["n.txt".to_owned()];
    let snapshot = snapshot_files(&repo.path, &files).unwrap();
    revert_hunk(&repo.path, &sha, "n.txt", 0).unwrap();

    let Planned::Available(plan) = plan_revert_hunk(&repo.path, snapshot).unwrap() else {
        panic!("a reverted hunk has an undo");
    };
    assert!(plan.scope.starts_with("Undo revert hunk"), "{}", plan.scope);
    undo(&repo.path, &plan.action).unwrap();

    assert_eq!(line(&repo, "n.txt", 3), "three");
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
}

#[test]
fn a_commit_tree_lists_every_file_path_sorted() {
    let repo = repo();
    repo.commit("z.txt", "z\n", "Add z");
    repo.commit("src/b c.rs", "b\n", "Add b c");
    repo.commit("a.txt", "a\n", "Add a");
    let sha = head(&repo);
    repo.git(&["rm", "-q", "z.txt"]);
    repo.git(&["commit", "-q", "-m", "Remove z"]);

    assert_eq!(
        commit_tree_paths(&repo.path, &sha).unwrap(),
        ["a.txt", "src/b c.rs", "z.txt"]
    );
    assert_eq!(
        commit_tree_paths(&repo.path, &head(&repo)).unwrap(),
        ["a.txt", "src/b c.rs"]
    );
    assert_eq!(
        commit_tree_paths(&repo.path, "HEAD").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}
