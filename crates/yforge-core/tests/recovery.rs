mod common;

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::Fixture;
use yforge_core::{
    checkout, delete_branch, diff_file, discard_files, discard_hunk, discard_lines, graph_page,
    lost_commits, push, push_force, push_plan, push_to, rebase_interactive, recompose_apply,
    reflog_list, reflog_refs, remove_worktree, repo_snapshot, reset, search_commits,
    snapshot_changed_files, snapshot_delete, snapshot_restore_all, snapshot_restore_files,
    snapshots_list, squash_commits, stash_drop, stash_push, CancelToken, ChangeArea,
    CheckoutTarget, ErrorKind, FileStatus, GraphVisibility, LostKind, RebaseStep, RecomposeChange,
    RecomposeGroup, ResetMode,
};

const MINUTE: Duration = Duration::from_secs(60);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis()
}

fn repo() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo
}

fn head(repo: &Fixture) -> String {
    repo.git(&["rev-parse", "HEAD"])
}

fn plant_ref(repo: &Fixture, name: &str) {
    let head = head(repo);
    repo.git(&["update-ref", name, &head]);
}

fn plant_foreign_snapshot_ref(repo: &Fixture, message: &str) -> String {
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);
    let head = head(repo);
    let commit = repo.git(&["commit-tree", &tree, "-p", &head, "-m", message]);
    let name = format!("refs/yforge/snapshots/{}-manual", now_ms());
    repo.git(&["update-ref", &name, &commit]);
    name
}

fn actions(repo: &Fixture) -> Vec<String> {
    snapshots_list(&repo.path)
        .unwrap()
        .into_iter()
        .map(|info| info.action)
        .collect()
}

fn only_snapshot(repo: &Fixture, action: &str) -> String {
    let listed = snapshots_list(&repo.path).unwrap();
    assert_eq!(listed.len(), 1, "expected one snapshot, got {listed:?}");
    assert_eq!(listed[0].action, action);
    listed[0].reference.clone()
}

fn block_snapshots(repo: &Fixture) {
    fs::write(repo.path.join(".git/refs/yforge"), "not a folder").expect("block");
}

fn kind<T: std::fmt::Debug>(result: Result<T, yforge_core::CoreError>) -> ErrorKind {
    result.expect_err("expected an error").kind()
}

fn delete_loose_object(repo: &Fixture, sha: &str) {
    let path = repo
        .path
        .join(".git/objects")
        .join(&sha[..2])
        .join(&sha[2..]);
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("chmod");
    fs::remove_file(path).expect("remove object");
}

#[test]
fn snapshot_refs_never_appear_in_the_graph_search_or_ref_lists() {
    let repo = repo();
    let before = graph_page(&repo.path, 0, 50, &GraphVisibility::All).unwrap();
    plant_foreign_snapshot_ref(&repo, "hidden marker snapshot");

    let after = graph_page(&repo.path, 0, 50, &GraphVisibility::All).unwrap();
    let snapshot = repo_snapshot(&repo.path).unwrap();

    assert_eq!(after.total, before.total);
    assert!(after.rows.iter().all(|row| row
        .refs
        .iter()
        .all(|reference| !reference.name.contains("yforge"))));
    assert!(after
        .rows
        .iter()
        .all(|row| !row.summary.contains("hidden marker")));
    assert!(
        search_commits(&repo.path, "hidden marker", &GraphVisibility::All)
            .unwrap()
            .rows
            .is_empty()
    );
    assert!(snapshot
        .branches
        .iter()
        .chain(&snapshot.remote_branches)
        .chain(&snapshot.tags)
        .all(|name| !name.contains("yforge")));
}

#[test]
fn reflog_lists_head_newest_first_with_parsed_actions_selectors_and_summaries() {
    let repo = repo();
    let first = head(&repo);
    repo.git(&["switch", "-q", "-c", "feat"]);
    let second = repo.commit("b.txt", "b\n", "Add b");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge feat", "feat"]);
    let merged = head(&repo);
    repo.write("a.txt", "amended\n");
    repo.git(&["commit", "-q", "--amend", "-a", "-m", "Merge feat amended"]);
    repo.git(&["reset", "-q", "--hard", &first]);
    repo.git(&["cherry-pick", &second]);

    let entries = reflog_list(&repo.path, "HEAD", None, 50).unwrap();

    let actions: Vec<&str> = entries.iter().map(|entry| entry.action.as_str()).collect();
    assert_eq!(
        actions,
        [
            "cherry-pick",
            "reset",
            "commit (amend)",
            "merge",
            "checkout",
            "commit",
            "checkout",
            "commit (initial)"
        ]
    );
    assert_eq!(entries[0].selector, "HEAD@{0}");
    assert_eq!(entries[7].selector, "HEAD@{7}");
    assert_eq!(entries[0].sha, head(&repo));
    assert_eq!(entries[0].previous_sha.as_deref(), Some(first.as_str()));
    assert_eq!(entries[0].summary, "Add b");
    assert_eq!(entries[0].message, "cherry-pick: Add b");
    assert_eq!(entries[3].sha, merged);
    assert_eq!(entries[3].previous_sha.as_deref(), Some(first.as_str()));
    assert_eq!(entries[7].previous_sha, None);
    assert!(entries.iter().all(|entry| entry.exists));
    assert!(entries[0].time > entries[7].time);
}

#[test]
fn reflog_parses_rebase_and_branch_creation_actions() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "feat"]);
    repo.commit("b.txt", "b\n", "Feature work");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("c.txt", "c\n", "Main work");
    repo.git(&["switch", "-q", "feat"]);
    repo.git(&["rebase", "-q", "main"]);

    let head_actions: Vec<String> = reflog_list(&repo.path, "HEAD", None, 50)
        .unwrap()
        .into_iter()
        .map(|entry| entry.action)
        .collect();
    let branch_actions: Vec<String> = reflog_list(&repo.path, "refs/heads/feat", None, 50)
        .unwrap()
        .into_iter()
        .map(|entry| entry.action)
        .collect();

    assert!(
        head_actions
            .iter()
            .filter(|action| *action == "rebase")
            .count()
            >= 3
    );
    assert_eq!(branch_actions, ["rebase", "commit", "branch"]);
    let branch = reflog_list(&repo.path, "refs/heads/feat", None, 50).unwrap();
    assert_eq!(branch[0].selector, "feat@{0}");
}

#[test]
fn reflog_pages_with_a_cursor_and_clamps_the_limit() {
    let repo = repo();
    for step in 0..5 {
        repo.commit("a.txt", &format!("{step}\n"), &format!("Step {step}"));
    }

    let first = reflog_list(&repo.path, "HEAD", None, 4).unwrap();
    let second = reflog_list(&repo.path, "HEAD", Some(first[3].index), 4).unwrap();
    let past_the_end = reflog_list(&repo.path, "HEAD", Some(5), 4).unwrap();
    let everything = reflog_list(&repo.path, "HEAD", None, 1000).unwrap();

    assert_eq!(
        first.iter().map(|e| e.index).collect::<Vec<_>>(),
        [0, 1, 2, 3]
    );
    assert_eq!(second.iter().map(|e| e.index).collect::<Vec<_>>(), [4, 5]);
    assert!(past_the_end.is_empty());
    assert_eq!(everything.len(), 6);
    assert_eq!(reflog_list(&repo.path, "HEAD", None, 0).unwrap().len(), 1);
}

#[test]
fn reflog_only_accepts_head_and_existing_local_branches() {
    let repo = repo();
    repo.git(&["tag", "v1"]);

    for reference in [
        "refs/tags/v1",
        "refs/remotes/origin/main",
        "main",
        "refs/heads/missing",
        "refs/heads/",
        "refs/yforge/snapshots/1-x",
    ] {
        assert_eq!(
            kind(reflog_list(&repo.path, reference, None, 10)),
            ErrorKind::InvalidRequest,
            "{reference}"
        );
    }
}

#[test]
fn reflog_marks_entries_whose_commit_is_gone() {
    let repo = repo();
    let doomed = repo.commit("a.txt", "two\n", "Doomed");
    repo.git(&["reset", "-q", "--hard", "HEAD~1"]);
    delete_loose_object(&repo, &doomed);

    let entries = reflog_list(&repo.path, "HEAD", None, 10).unwrap();

    let gone = entries.iter().find(|entry| entry.sha == doomed).unwrap();
    assert!(!gone.exists);
    assert_eq!(gone.summary, "");
    assert!(entries.iter().any(|entry| entry.exists));
}

#[test]
fn reflog_refs_lists_head_then_branches_that_have_a_reflog() {
    let repo = repo();
    repo.git(&["branch", "zeta"]);
    repo.git(&["switch", "-q", "-c", "feature/x"]);
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["branch", "-D", "zeta"]);

    let refs = reflog_refs(&repo.path).unwrap();

    assert_eq!(refs, ["HEAD", "refs/heads/feature/x", "refs/heads/main"]);
}

#[test]
fn reflog_of_an_unborn_repository_is_empty() {
    let repo = Fixture::init();
    assert!(reflog_refs(&repo.path).unwrap().is_empty());
    assert!(reflog_list(&repo.path, "HEAD", None, 10)
        .unwrap()
        .is_empty());
}

fn lost(repo: &Fixture) -> Vec<yforge_core::LostCommit> {
    lost_commits(&repo.path, &CancelToken::new(), MINUTE).unwrap()
}

#[test]
fn lost_commits_after_a_deleted_branch_are_listed_newest_first() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "doomed"]);
    let older = repo.commit("b.txt", "b\n", "Older work");
    let newer = repo.commit("c.txt", "c\n", "Newer work");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["branch", "-D", "doomed"]);
    repo.git(&["reflog", "expire", "--expire=now", "--all"]);

    let found = lost(&repo);

    let shas: Vec<&str> = found.iter().map(|commit| commit.sha.as_str()).collect();
    assert_eq!(shas, [newer.as_str(), older.as_str()]);
    assert_eq!(found[0].summary, "Newer work");
    assert_eq!(found[0].author, "Yui Lin");
    assert_eq!(found[0].kind, LostKind::Commit);
    assert!(found[0].time > found[1].time);
}

#[test]
fn a_reflog_entry_does_not_make_a_commit_reachable_for_the_finder() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "doomed"]);
    let work = repo.commit("b.txt", "b\n", "Only in the reflog");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["branch", "-D", "doomed"]);

    assert!(lost(&repo).iter().any(|commit| commit.sha == work));
}

#[test]
fn a_dropped_stash_is_one_stash_entry_without_its_index_or_untracked_commits() {
    let repo = repo();
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "untracked\n");
    stash_push(&repo.path, "half done", true).unwrap();
    let stash = repo.git(&["rev-parse", "stash@{0}"]);
    repo.git(&["stash", "drop", "-q"]);

    let found = lost(&repo);

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].sha, stash);
    assert_eq!(found[0].kind, LostKind::Stash);
    assert_eq!(found[0].summary, "On main: half done");
}

#[test]
fn a_lost_no_ff_merge_of_one_commit_is_a_commit_not_a_stash() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "feat"]);
    let work = repo.commit("b.txt", "b\n", "Feature");
    repo.git(&["switch", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "Merge feat", "feat"]);
    let merge = head(&repo);
    repo.git(&["reset", "-q", "--hard", "HEAD~1"]);
    repo.git(&["branch", "-D", "feat"]);

    let found = lost(&repo);

    let merged = found.iter().find(|commit| commit.sha == merge).unwrap();
    assert_eq!(merged.kind, LostKind::Commit);
    assert!(found.iter().any(|commit| commit.sha == work));
}

#[test]
fn rewritten_history_leaves_the_old_commits_lost() {
    let repo = repo();
    let first = head(&repo);
    let second = repo.commit("b.txt", "b\n", "Second");
    repo.git(&["commit", "-q", "--amend", "-m", "Second, reworded"]);
    let reworded = head(&repo);

    let shas: Vec<String> = lost(&repo).into_iter().map(|commit| commit.sha).collect();

    assert_eq!(shas, [second]);
    assert!(!shas.contains(&first) && !shas.contains(&reworded));
}

#[test]
fn a_commit_kept_alive_by_a_snapshot_is_not_reported_as_lost() {
    let (repo, _, commits) = rewrite_repo();
    squash_commits(&repo.path, &commits, "Both").unwrap();

    let shas: Vec<String> = lost(&repo).into_iter().map(|commit| commit.sha).collect();

    assert!(commits.iter().all(|sha| !shas.contains(sha)), "{shas:?}");
    let reference = only_snapshot(&repo, "squash_commits");
    assert_eq!(
        repo.git(&["rev-parse", &format!("{reference}^1")]),
        commits[1]
    );
}

#[test]
fn deleted_snapshots_do_not_show_up_as_lost_commits() {
    let repo = repo();
    repo.write("a.txt", "dirty\n");
    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();
    let reference = only_snapshot(&repo, "discard");
    snapshot_delete(&repo.path, &reference).unwrap();

    assert!(lost(&repo).is_empty());
}

#[test]
fn the_finder_stops_when_cancelled_or_out_of_time_and_bounds_its_result() {
    let repo = repo();
    let cancel = CancelToken::new();
    cancel.cancel();
    assert_eq!(
        kind(lost_commits(&repo.path, &cancel, MINUTE)),
        ErrorKind::Cancelled
    );
    let error = lost_commits(&repo.path, &CancelToken::new(), Duration::ZERO).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert!(error.to_string().contains("timed out"));

    let mut stream = String::from("commit refs/heads/many\n");
    for mark in 1..=520 {
        stream.push_str(&format!(
            "mark :{mark}\ncommitter A <a@b> {} +0000\ndata 1\nx\n{}\n",
            1_700_000_000 + mark,
            if mark == 1 {
                "deleteall".to_owned()
            } else {
                format!("from :{}\ndeleteall", mark - 1)
            }
        ));
        if mark < 520 {
            stream.push_str("commit refs/heads/many\n");
        }
    }
    let mut child = Command::new("git")
        .arg("-C")
        .arg(&repo.path)
        .args(["fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .spawn()
        .expect("fast-import");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(stream.as_bytes())
        .expect("stream");
    assert!(child.wait().expect("wait").success());
    repo.git(&["branch", "-D", "many"]);

    let found = lost(&repo);

    assert_eq!(found.len(), 500);
    assert!(found.windows(2).all(|pair| pair[0].time >= pair[1].time));
}

#[test]
fn a_snapshot_records_head_the_index_and_the_working_tree_including_untracked_files() {
    let repo = repo();
    repo.write(".gitignore", "*.log\n");
    repo.git(&["add", ".gitignore"]);
    repo.git(&["commit", "-q", "-m", "Ignore logs"]);
    let base = head(&repo);
    repo.write("staged.txt", "staged only\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("a.txt", "edited\n");
    repo.write("untracked.txt", "fresh\n");
    repo.write("noise.log", "ignored\n");
    let index_before = repo.git(&["ls-files", "--stage"]);

    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();

    let reference = only_snapshot(&repo, "discard");
    let info = &snapshots_list(&repo.path).unwrap()[0];
    assert_eq!(info.head_sha.as_deref(), Some(base.as_str()));
    assert_eq!(info.branch.as_deref(), Some("main"));
    assert_eq!(info.files_changed, 3);
    assert!(info.description.contains("Discard changes in 1 file"));
    assert!(reference.starts_with("refs/yforge/snapshots/"));
    assert!(reference.ends_with("-discard"));
    assert_eq!(repo.git(&["rev-parse", &format!("{reference}^1")]), base);
    let show = |spec: String| repo.git(&["show", &spec]);
    assert_eq!(show(format!("{reference}:a.txt")), "edited");
    assert_eq!(show(format!("{reference}:untracked.txt")), "fresh");
    assert_eq!(show(format!("{reference}:staged.txt")), "staged only");
    assert!(!repo
        .git(&["ls-tree", "-r", "--name-only", &reference])
        .contains("noise.log"));
    assert_eq!(show(format!("{reference}^2:staged.txt")), "staged only");
    assert_eq!(show(format!("{reference}^2:a.txt")), "one");
    assert!(!repo
        .git(&["ls-tree", "-r", "--name-only", &format!("{reference}^2")])
        .contains("untracked.txt"));
    assert_eq!(repo.git(&["rev-parse", &format!("{reference}^2^1")]), base);
    assert_eq!(repo.git(&["ls-files", "--stage"]), index_before);
    assert_eq!(
        repo.git(&["status", "--porcelain=v1"]),
        "A  staged.txt\n?? untracked.txt"
    );
}

#[test]
fn a_snapshot_survives_conflicts_and_an_unborn_repository() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "other"]);
    repo.commit("a.txt", "other\n", "Other");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "other"]);
    repo.write("scratch.txt", "scratch\n");

    discard_files(&repo.path, &["scratch.txt".to_owned()]).unwrap();

    let reference = only_snapshot(&repo, "discard");
    assert!(repo
        .git(&["show", &format!("{reference}:a.txt")])
        .contains("<<<<<<<"));
    assert!(!repo
        .git(&["ls-tree", "-r", "--name-only", &format!("{reference}^2")])
        .contains("scratch.txt"));

    let unborn = Fixture::init();
    unborn.identity();
    unborn.write("new.txt", "x\n");
    discard_files(&unborn.path, &["new.txt".to_owned()]).unwrap();
    let reference = only_snapshot(&unborn, "discard");
    let info = &snapshots_list(&unborn.path).unwrap()[0];
    assert_eq!(info.head_sha, None);
    assert_eq!(unborn.git(&["show", &format!("{reference}:new.txt")]), "x");
}

#[test]
fn snapshots_leave_no_scratch_index_behind() {
    let repo = repo();
    repo.write("a.txt", "dirty\n");
    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();

    let leftovers: Vec<String> = fs::read_dir(repo.path.join(".git"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("yforge-snapshot-index"))
        .collect();

    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn discarding_files_takes_a_snapshot_first() {
    let repo = repo();
    repo.write("a.txt", "dirty\n");
    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();
    only_snapshot(&repo, "discard");
}

fn numbered_pair(repo: &Fixture) {
    repo.numbered("f.txt", &[]);
    repo.git(&["add", "f.txt"]);
    repo.git(&["commit", "-q", "-m", "Numbered"]);
    repo.numbered(
        "f.txt",
        &[(2, "two!"), (3, "three!"), (28, "twenty-eight!")],
    );
}

#[test]
fn discarding_a_hunk_takes_a_snapshot_first() {
    let repo = repo();
    numbered_pair(&repo);
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    discard_hunk(&repo.path, "f.txt", &diff.hunks[1], false).unwrap();
    let reference = only_snapshot(&repo, "discard_hunk");
    assert!(repo
        .git(&["show", &format!("{reference}:f.txt")])
        .contains("twenty-eight!"));
    assert!(!repo.read("f.txt").contains("twenty-eight!"));
}

#[test]
fn discarding_lines_takes_a_snapshot_first() {
    let repo = repo();
    numbered_pair(&repo);
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    let hunk = &diff.hunks[0];
    let added = hunk
        .lines
        .iter()
        .position(|line| line.text == "two!")
        .unwrap();
    discard_lines(
        &repo.path,
        "f.txt",
        hunk,
        &[u32::try_from(added).unwrap()],
        false,
    )
    .unwrap();
    only_snapshot(&repo, "discard_lines");
}

#[test]
fn a_stale_hunk_discard_takes_no_snapshot() {
    let repo = repo();
    numbered_pair(&repo);
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    repo.numbered("f.txt", &[]);
    assert_eq!(
        kind(discard_hunk(&repo.path, "f.txt", &diff.hunks[0], false)),
        ErrorKind::StaleHunk
    );
    assert!(actions(&repo).is_empty());
}

#[test]
fn a_hard_reset_takes_a_snapshot_and_soft_and_mixed_resets_do_not() {
    let repo = repo();
    let first = head(&repo);
    repo.commit("b.txt", "b\n", "Second");
    repo.write("a.txt", "uncommitted\n");
    reset(&repo.path, &first, ResetMode::Soft).unwrap();
    reset(&repo.path, &first, ResetMode::Mixed).unwrap();
    assert!(actions(&repo).is_empty());

    reset(&repo.path, &first, ResetMode::Hard).unwrap();

    let reference = only_snapshot(&repo, "reset_hard");
    assert_eq!(
        repo.git(&["show", &format!("{reference}:a.txt")]),
        "uncommitted"
    );
    assert_eq!(repo.read("a.txt"), "one\n");
}

#[test]
fn a_checkout_that_auto_stashes_takes_a_snapshot_and_a_clean_one_does_not() {
    let repo = repo();
    repo.git(&["branch", "other"]);
    checkout(
        &repo.path,
        &CheckoutTarget::LocalBranch {
            name: "other".to_owned(),
        },
        true,
    )
    .unwrap();
    assert!(actions(&repo).is_empty());
    repo.write("a.txt", "dirty\n");
    repo.write("scratch.txt", "untracked\n");

    checkout(
        &repo.path,
        &CheckoutTarget::LocalBranch {
            name: "main".to_owned(),
        },
        true,
    )
    .unwrap();

    let reference = only_snapshot(&repo, "checkout");
    assert_eq!(
        repo.git(&["show", &format!("{reference}:scratch.txt")]),
        "untracked"
    );
}

fn rewrite_repo() -> (Fixture, String, Vec<String>) {
    let repo = repo();
    let base = head(&repo);
    let second = repo.commit("b.txt", "b\n", "Second");
    let third = repo.commit("c.txt", "c\n", "Third");
    (repo, base, vec![second, third])
}

#[test]
fn an_interactive_rebase_takes_a_snapshot_first() {
    let (repo, base, commits) = rewrite_repo();
    let steps: Vec<RebaseStep> = commits
        .iter()
        .map(|sha| RebaseStep::Pick { sha: sha.clone() })
        .collect();
    rebase_interactive(&repo.path, &base, &steps).unwrap();
    let reference = only_snapshot(&repo, "interactive_rebase");
    assert_eq!(
        repo.git(&["rev-parse", &format!("{reference}^1")]),
        commits[1]
    );
}

#[test]
fn squashing_commits_takes_a_snapshot_first() {
    let (repo, _, commits) = rewrite_repo();
    squash_commits(&repo.path, &commits, "Both").unwrap();
    only_snapshot(&repo, "squash_commits");
}

#[test]
fn applying_a_recompose_takes_a_snapshot_first() {
    let (repo, base, _) = rewrite_repo();
    recompose_apply(
        &repo.path,
        &base,
        &[RecomposeGroup {
            message: "Everything".to_owned(),
            changes: vec![
                RecomposeChange::File {
                    path: "b.txt".to_owned(),
                },
                RecomposeChange::File {
                    path: "c.txt".to_owned(),
                },
            ],
        }],
    )
    .unwrap();
    only_snapshot(&repo, "recompose");
}

#[test]
fn dropping_a_stash_takes_a_snapshot_that_names_the_stash() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    stash_push(&repo.path, "keep me", false).unwrap();
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    stash_drop(&repo.path, 0, &sha).unwrap();
    let reference = only_snapshot(&repo, "drop_stash");
    let message = repo.git(&["log", "-1", "--format=%B", &reference]);
    assert!(message.contains(&format!("YForge-Subject: {sha}")));
}

#[test]
fn deleting_a_local_branch_takes_a_snapshot_that_names_its_tip() {
    let repo = repo();
    repo.git(&["switch", "-q", "-c", "feat"]);
    let tip = repo.commit("b.txt", "b\n", "Feature");
    repo.git(&["switch", "-q", "main"]);
    delete_branch(&repo.path, "feat", true).unwrap();
    let reference = only_snapshot(&repo, "delete_branch");
    let message = repo.git(&["log", "-1", "--format=%B", &reference]);
    assert!(message.contains(&format!("YForge-Subject: {tip}")));
    assert!(snapshots_list(&repo.path).unwrap()[0]
        .description
        .contains("Delete branch feat"));
}

#[test]
fn a_forced_worktree_removal_takes_a_snapshot_of_that_worktree() {
    let repo = repo();
    let path = repo.sibling("repo-side");
    yforge_core::create_worktree(&repo.path, "side", true, None, &path).unwrap();
    fs::write(path.join("a.txt"), "worktree edit\n").unwrap();
    fs::write(path.join("loose.txt"), "worktree file\n").unwrap();
    remove_worktree(&repo.path, path.to_str().unwrap(), true).unwrap();
    let reference = only_snapshot(&repo, "remove_worktree");
    assert_eq!(
        repo.git(&["show", &format!("{reference}:a.txt")]),
        "worktree edit"
    );
    assert_eq!(
        repo.git(&["show", &format!("{reference}:loose.txt")]),
        "worktree file"
    );
    let info = &snapshots_list(&repo.path).unwrap()[0];
    assert_eq!(info.branch.as_deref(), Some("side"));
}

#[test]
fn removing_a_clean_worktree_without_force_takes_no_snapshot() {
    let repo = repo();
    let path = repo.sibling("repo-side");
    yforge_core::create_worktree(&repo.path, "side", true, None, &path).unwrap();
    remove_worktree(&repo.path, path.to_str().unwrap(), false).unwrap();
    assert!(actions(&repo).is_empty());
}

#[test]
fn a_failed_snapshot_refuses_every_destructive_action_and_changes_nothing() {
    let repo = repo();
    let first = head(&repo);
    let middle = repo.commit("b.txt", "b\n", "Middle");
    let second = repo.commit("c.txt", "c\n", "Second");
    repo.git(&["branch", "spare"]);
    repo.write("a.txt", "dirty\n");
    let side = repo.sibling("repo-side");
    yforge_core::create_worktree(&repo.path, "side", true, None, &side).unwrap();
    block_snapshots(&repo);
    let status = repo.git(&["status", "--porcelain=v1"]);

    let refused = [
        kind(discard_files(&repo.path, &["a.txt".to_owned()])),
        kind(reset(&repo.path, &first, ResetMode::Hard)),
        kind(delete_branch(&repo.path, "spare", true)),
        kind(remove_worktree(&repo.path, side.to_str().unwrap(), true)),
        kind(squash_commits(
            &repo.path,
            &[middle.clone(), second.clone()],
            "x",
        )),
        kind(rebase_interactive(
            &repo.path,
            &first,
            &[RebaseStep::Drop {
                sha: second.clone(),
            }],
        )),
        kind(checkout(
            &repo.path,
            &CheckoutTarget::LocalBranch {
                name: "spare".to_owned(),
            },
            true,
        )),
    ];

    assert!(refused
        .iter()
        .all(|kind| *kind == ErrorKind::SnapshotFailed));
    assert_eq!(head(&repo), second);
    assert_eq!(repo.read("a.txt"), "dirty\n");
    assert_eq!(repo.git(&["status", "--porcelain=v1"]), status);
    assert!(repo.git(&["branch", "--list", "spare"]).contains("spare"));
    assert!(side.join("a.txt").is_file());
    assert!(repo.git(&["stash", "list"]).is_empty());
}

#[test]
fn a_failed_snapshot_refuses_dropping_a_stash_and_discarding_a_hunk() {
    let repo = repo();
    repo.write("a.txt", "stashed\n");
    stash_push(&repo.path, "keep", false).unwrap();
    let sha = repo.git(&["rev-parse", "stash@{0}"]);
    numbered_pair(&repo);
    let diff = diff_file(&repo.path, "f.txt", ChangeArea::Unstaged, false).unwrap();
    block_snapshots(&repo);

    let dropped = stash_drop(&repo.path, 0, &sha);
    let hunk = discard_hunk(&repo.path, "f.txt", &diff.hunks[0], false);
    let lines = discard_lines(&repo.path, "f.txt", &diff.hunks[0], &[1], false);

    assert_eq!(kind(dropped), ErrorKind::SnapshotFailed);
    assert_eq!(kind(hunk), ErrorKind::SnapshotFailed);
    assert_eq!(kind(lines), ErrorKind::SnapshotFailed);
    assert_eq!(repo.git(&["rev-parse", "stash@{0}"]), sha);
    assert!(repo.read("f.txt").contains("twenty-eight!"));
}

#[test]
fn snapshot_changed_files_lists_paths_against_the_head_of_the_time() {
    let repo = repo();
    repo.commit("gone.txt", "bye\n", "Add gone");
    repo.write("a.txt", "edited\n");
    fs::remove_file(repo.path.join("gone.txt")).unwrap();
    repo.write("new.txt", "new\n");
    discard_files(&repo.path, &["new.txt".to_owned()]).unwrap();
    repo.commit("later.txt", "later\n", "Moves head on");
    let reference = only_snapshot(&repo, "discard");

    let changes = snapshot_changed_files(&repo.path, &reference).unwrap();

    let listed: Vec<(&str, FileStatus)> = changes
        .iter()
        .map(|change| (change.path.as_str(), change.status))
        .collect();
    assert_eq!(
        listed,
        [
            ("a.txt", FileStatus::Modified),
            ("gone.txt", FileStatus::Deleted),
            ("new.txt", FileStatus::Added)
        ]
    );
}

fn dirty_snapshot(repo: &Fixture) -> String {
    repo.write("a.txt", "precious edit\n");
    repo.write("dir/new.txt", "precious new\n");
    repo.write("tool.sh", "#!/bin/sh\n");
    fs::set_permissions(repo.path.join("tool.sh"), fs::Permissions::from_mode(0o755)).unwrap();
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "precious edit, unstaged\n");
    reset(&repo.path, &head(repo), ResetMode::Hard).unwrap();
    let reference = only_snapshot(repo, "reset_hard");
    assert_eq!(repo.read("a.txt"), "one\n");
    reference
}

#[test]
fn restoring_selected_files_copies_them_back_after_snapshotting_the_current_state() {
    let repo = repo();
    let reference = dirty_snapshot(&repo);
    repo.write("a.txt", "newer work\n");

    let safety = snapshot_restore_files(
        &repo.path,
        &reference,
        &[
            "a.txt".to_owned(),
            "dir/new.txt".to_owned(),
            "tool.sh".to_owned(),
        ],
    )
    .unwrap();

    assert_eq!(repo.read("a.txt"), "precious edit, unstaged\n");
    assert_eq!(repo.read("dir/new.txt"), "precious new\n");
    assert_eq!(
        fs::metadata(repo.path.join("tool.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o111,
        0o111
    );
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
    assert_eq!(
        repo.git(&["show", &format!("{safety}:a.txt")]),
        "newer work"
    );
    assert_eq!(actions(&repo), ["restore_files", "reset_hard"]);
    snapshot_restore_files(&repo.path, &safety, &["a.txt".to_owned()]).unwrap();
    assert_eq!(repo.read("a.txt"), "newer work\n");
}

#[test]
fn restoring_files_refuses_unknown_paths_unsafe_paths_and_foreign_refs_before_changing_anything() {
    let repo = repo();
    let reference = dirty_snapshot(&repo);
    let count = snapshots_list(&repo.path).unwrap().len();
    let link_target = repo.sibling("outside");
    fs::create_dir(&link_target).unwrap();
    std::os::unix::fs::symlink(&link_target, repo.path.join("dir_link")).unwrap();

    assert_eq!(
        kind(snapshot_restore_files(
            &repo.path,
            &reference,
            &["missing.txt".to_owned()]
        )),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        kind(snapshot_restore_files(
            &repo.path,
            &reference,
            &["dir".to_owned()]
        )),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        kind(snapshot_restore_files(
            &repo.path,
            &reference,
            &["../x".to_owned()]
        )),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        kind(snapshot_restore_files(
            &repo.path,
            "refs/heads/main",
            &["a.txt".to_owned()]
        )),
        ErrorKind::InvalidRequest
    );
    assert_eq!(snapshots_list(&repo.path).unwrap().len(), count);
    assert_eq!(repo.read("a.txt"), "one\n");
}

#[test]
fn restoring_everything_puts_index_and_working_tree_back_on_the_original_head() {
    let repo = repo();
    repo.write("staged.txt", "staged\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("a.txt", "edited\n");
    repo.write("dir/new.txt", "untracked\n");
    repo.git(&["reset", "-q", "--hard", "HEAD"]);
    repo.git(&["clean", "-fdq"]);
    let planted = {
        repo.write("staged.txt", "staged\n");
        repo.git(&["add", "staged.txt"]);
        repo.write("a.txt", "edited\n");
        repo.write("dir/new.txt", "untracked\n");
        reset(&repo.path, &head(&repo), ResetMode::Hard).unwrap();
        only_snapshot(&repo, "reset_hard")
    };
    repo.write("later.txt", "written after the snapshot\n");
    repo.write("a.txt", "different\n");

    let safety = snapshot_restore_all(&repo.path, &planted, false).unwrap();

    assert_eq!(repo.read("a.txt"), "edited\n");
    assert_eq!(repo.read("dir/new.txt"), "untracked\n");
    assert_eq!(repo.read("staged.txt"), "staged\n");
    assert!(!repo.path.join("later.txt").exists());
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "staged.txt");
    assert_eq!(
        repo.git(&["status", "--porcelain=v1"]),
        "M a.txt\nA  staged.txt\n?? dir/"
    );
    assert_eq!(
        repo.git(&["show", &format!("{safety}:later.txt")]),
        "written after the snapshot"
    );
    assert_eq!(
        head(&repo),
        repo.git(&["rev-parse", &format!("{planted}^1")])
    );
}

#[test]
fn restoring_everything_refuses_a_moved_head_unless_forced_and_never_moves_head() {
    let repo = repo();
    repo.write("a.txt", "edited\n");
    reset(&repo.path, &head(&repo), ResetMode::Hard).unwrap();
    let reference = only_snapshot(&repo, "reset_hard");
    let moved = repo.commit("b.txt", "b\n", "Head moves on");
    repo.write("a.txt", "current\n");

    let refused = snapshot_restore_all(&repo.path, &reference, false);
    assert_eq!(kind(refused), ErrorKind::InvalidRequest);
    assert_eq!(repo.read("a.txt"), "current\n");
    assert_eq!(actions(&repo), ["reset_hard"]);

    let safety = snapshot_restore_all(&repo.path, &reference, true).unwrap();

    assert_eq!(repo.read("a.txt"), "edited\n");
    assert_eq!(head(&repo), moved);
    assert_eq!(actions(&repo), ["restore_snapshot", "reset_hard"]);
    assert_eq!(repo.git(&["show", &format!("{safety}:a.txt")]), "current");
}

#[test]
fn restoring_everything_refuses_while_an_operation_is_in_progress() {
    let repo = repo();
    repo.write("a.txt", "edited\n");
    reset(&repo.path, &head(&repo), ResetMode::Hard).unwrap();
    let reference = only_snapshot(&repo, "reset_hard");
    repo.git(&["switch", "-q", "-c", "other"]);
    repo.commit("a.txt", "other\n", "Other");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("a.txt", "main\n", "Main");
    repo.git_expecting_conflict(&["merge", "other"]);

    assert_eq!(
        kind(snapshot_restore_all(&repo.path, &reference, true)),
        ErrorKind::OperationInProgress
    );
}

#[test]
fn deleting_a_snapshot_removes_only_that_ref_and_rejects_anything_else() {
    let repo = repo();
    repo.write("a.txt", "one\n edit\n");
    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();
    let reference = only_snapshot(&repo, "discard");

    for bad in [
        "refs/heads/main",
        "refs/yforge/snapshots/../heads/main",
        "refs/yforge/snapshots/not-a-time",
        "refs/yforge/snapshots/1-missing",
    ] {
        assert_eq!(
            kind(snapshot_delete(&repo.path, bad)),
            ErrorKind::InvalidRequest,
            "{bad}"
        );
    }
    snapshot_delete(&repo.path, &reference).unwrap();

    assert!(snapshots_list(&repo.path).unwrap().is_empty());
    assert!(repo.git(&["branch", "--list", "main"]).contains("main"));
}

#[test]
fn opening_a_repository_prunes_snapshots_older_than_thirty_days_and_nothing_else() {
    let repo = repo();
    let day = 24 * 60 * 60 * 1000;
    let now = now_ms();
    let old = format!("refs/yforge/snapshots/{}-discard", now - 31 * day);
    let recent = format!("refs/yforge/snapshots/{}-discard", now - 29 * day);
    for name in [
        old.as_str(),
        recent.as_str(),
        "refs/yforge/other/keep",
        "refs/heads/keep",
    ] {
        plant_ref(&repo, name);
    }

    repo_snapshot(&repo.path).unwrap();

    let refs = repo.git(&["for-each-ref", "--format=%(refname)"]);
    assert!(!refs.contains(&old));
    assert!(refs.contains(&recent));
    assert!(refs.contains("refs/yforge/other/keep"));
    assert!(refs.contains("refs/heads/keep"));
}

#[test]
fn snapshots_are_capped_at_two_hundred_dropping_the_oldest_first() {
    let repo = repo();
    let now = now_ms();
    for step in 0..205_u128 {
        plant_ref(
            &repo,
            &format!("refs/yforge/snapshots/{}-discard", now - 10_000 + step),
        );
    }

    repo_snapshot(&repo.path).unwrap();

    let refs = repo.git(&[
        "for-each-ref",
        "--format=%(refname)",
        "refs/yforge/snapshots",
    ]);
    let kept: Vec<&str> = refs.lines().collect();
    assert_eq!(kept.len(), 200);
    assert!(
        kept.contains(&format!("refs/yforge/snapshots/{}-discard", now - 10_000 + 204).as_str())
    );
    assert!(!kept.contains(&format!("refs/yforge/snapshots/{}-discard", now - 10_000).as_str()));
}

#[test]
fn a_new_snapshot_keeps_the_cap_and_a_second_open_does_not_prune_again() {
    let repo = repo();
    let now = now_ms();
    for step in 0..200_u128 {
        plant_ref(
            &repo,
            &format!("refs/yforge/snapshots/{}-discard", now - 10_000 + step),
        );
    }
    repo_snapshot(&repo.path).unwrap();
    repo.write("a.txt", "dirty\n");

    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();

    let refs = repo.git(&[
        "for-each-ref",
        "--format=%(refname)",
        "refs/yforge/snapshots",
    ]);
    assert_eq!(refs.lines().count(), 200);
    assert!(!refs.contains(&format!("{}-discard", now - 10_000)));
}

#[test]
fn pushes_never_send_snapshot_refs() {
    let repo = repo();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    repo.write("a.txt", "dirty\n");
    discard_files(&repo.path, &["a.txt".to_owned()]).unwrap();
    only_snapshot(&repo, "discard");
    let token = CancelToken::new();
    let mut quiet = |_: yforge_core::Progress| {};

    repo.commit("b.txt", "b\n", "Second");
    push(&repo.path, &token, &mut quiet).unwrap();
    repo.commit("c.txt", "c\n", "Third");
    push_to(&repo.path, "origin", "topic", false, &token, &mut quiet).unwrap();
    repo.git(&["push", "-q", "origin", "HEAD:refs/heads/main"]);
    let other = repo.clone_of(&remote, "other");
    repo.commit_in(&other, "e.txt", "e\n", "Remote only");
    repo.run_in(&other, &["push", "-q", "origin", "main"]);
    repo.git(&["fetch", "-q", "origin"]);
    let plan = push_plan(&repo.path).unwrap();
    push_force(&repo.path, &plan.lease, &token, &mut quiet).unwrap();

    let remote_refs = repo.run_in(&remote, &["for-each-ref", "--format=%(refname)"]);
    assert!(!remote_refs.contains("yforge"), "{remote_refs}");
    assert!(remote_refs.contains("refs/heads/topic"));
}
