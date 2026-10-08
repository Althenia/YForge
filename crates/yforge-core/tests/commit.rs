mod common;

use common::Fixture;
use yforge_core::{
    amend_info, commit, commit_details, commit_file_diff, edit_head_message, revision_file_diff,
    stage_all, DiffLineKind, ErrorKind, FileStatus, RefKind,
};

fn ready_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "1\n", "First");
    repo
}

#[test]
fn commits_the_index_with_summary_and_description_and_returns_the_new_sha() {
    let repo = ready_repository();
    repo.write("a.txt", "2\n");
    repo.write("untouched.txt", "u\n");
    repo.git(&["add", "a.txt"]);

    let sha = commit(&repo.path, "Change a", "Explain why.\nSecond line.", false).unwrap();

    assert_eq!(sha, repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Change a");
    assert_eq!(
        repo.git(&["log", "-1", "--format=%b"]),
        "Explain why.\nSecond line."
    );
    assert_eq!(
        repo.git(&["show", "--format=", "--name-only", "HEAD"]),
        "a.txt"
    );
    assert_eq!(repo.git(&["status", "--porcelain"]), "?? untouched.txt");
}

#[test]
fn rejects_an_empty_summary_and_reports_nothing_to_commit_with_git_output() {
    let repo = ready_repository();

    assert_eq!(
        commit(&repo.path, "  ", "", false).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );

    let error = commit(&repo.path, "Nothing staged", "", false).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::CommitFailed);
    let payload = yforge_core::ErrorPayload::from(error);
    assert!(payload
        .output
        .is_some_and(|output| output.contains("nothing to commit")));
}

#[test]
fn amend_rewrites_head_with_the_new_message_and_staged_changes() {
    let repo = ready_repository();
    let original = repo.git(&["rev-parse", "HEAD"]);
    repo.write("b.txt", "b\n");
    repo.git(&["add", "b.txt"]);

    let amended = commit(&repo.path, "First, amended", "", true).unwrap();

    assert_ne!(amended, original);
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "First, amended");
    assert_eq!(
        repo.git(&["show", "--format=", "--name-only", "HEAD"]),
        "a.txt\nb.txt"
    );
}

#[cfg(unix)]
#[test]
fn a_failing_pre_commit_hook_surfaces_its_output_and_leaves_head_alone() {
    use std::os::unix::fs::PermissionsExt;
    let repo = ready_repository();
    let head = repo.git(&["rev-parse", "HEAD"]);
    let hook = repo.path.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho \"lint: trailing whitespace\"\necho \"lint: aborting\" >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    repo.write("a.txt", "2\n");
    stage_all(&repo.path).unwrap();

    let error = commit(&repo.path, "Blocked", "", false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::CommitFailed);
    let payload = yforge_core::ErrorPayload::from(error);
    assert_eq!(payload.kind, ErrorKind::CommitFailed);
    let output = payload.output.expect("hook output");
    assert!(output.contains("lint: trailing whitespace"), "{output}");
    assert!(output.contains("lint: aborting"), "{output}");
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "a.txt");
}

#[test]
fn amend_info_reports_the_head_message_and_whether_head_is_on_its_upstream() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "1\n", "Subject line");
    repo.git(&[
        "commit",
        "-q",
        "--amend",
        "-m",
        "Subject line",
        "-m",
        "Body text",
    ]);

    let local = amend_info(&repo.path).unwrap();
    assert_eq!(local.summary, "Subject line");
    assert_eq!(local.description, "Body text");
    assert_eq!(local.sha, repo.git(&["rev-parse", "HEAD"]));
    assert!(!local.pushed);

    let clone = repo.clone_to("clone");
    assert!(amend_info(&clone).unwrap().pushed);

    repo.run_in(&clone, &["config", "user.name", "Yui Lin"]);
    repo.run_in(&clone, &["config", "user.email", "yui@example.test"]);
    repo.run_in(&clone, &["config", "commit.gpgsign", "false"]);
    std::fs::write(clone.join("local.txt"), "l\n").unwrap();
    repo.run_in(&clone, &["add", "local.txt"]);
    commit(&clone, "Local only", "", false).unwrap();
    assert!(!amend_info(&clone).unwrap().pushed);
}

#[test]
fn amend_info_needs_a_commit_to_amend() {
    let repo = Fixture::init();

    assert_eq!(
        amend_info(&repo.path).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn commit_details_lists_metadata_refs_and_file_counts() {
    let repo = ready_repository();
    repo.write("a.txt", "1\n2\n3\n");
    repo.write("dir/b.txt", "b\n");
    repo.git(&["add", "a.txt", "dir/b.txt"]);
    repo.git(&["commit", "-q", "-m", "Second", "-m", "Body one\n\nBody two"]);
    repo.git(&["tag", "v1"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    let parent = repo.git(&["rev-parse", "HEAD^"]);

    let details = commit_details(&repo.path, &head).unwrap();

    assert_eq!(details.sha, head);
    assert_eq!(details.summary, "Second");
    assert_eq!(details.body, "Body one\n\nBody two");
    assert_eq!(details.parents, vec![parent]);
    assert_eq!(details.author.name, "Yui Lin");
    assert_eq!(details.author.email, "yui@example.test");
    assert_eq!(details.committer.name, "Yui Lin");
    assert!(details.author.time > 1_700_000_000);
    let refs: Vec<(&str, RefKind, bool)> = details
        .refs
        .iter()
        .map(|entry| (entry.name.as_str(), entry.kind, entry.is_head))
        .collect();
    assert_eq!(
        refs,
        vec![
            ("main", RefKind::LocalBranch, true),
            ("v1", RefKind::Tag, false)
        ]
    );
    let files: Vec<(&str, FileStatus, Option<u32>, Option<u32>)> = details
        .files
        .iter()
        .map(|file| {
            (
                file.path.as_str(),
                file.status,
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(
        files,
        vec![
            ("a.txt", FileStatus::Modified, Some(2), Some(0)),
            ("dir/b.txt", FileStatus::Added, Some(1), Some(0)),
        ]
    );
}

#[test]
fn commit_details_of_a_root_commit_has_no_parents_and_lists_added_files() {
    let repo = ready_repository();
    let root = repo.git(&["rev-parse", "HEAD"]);

    let details = commit_details(&repo.path, &root).unwrap();

    assert!(details.parents.is_empty());
    assert_eq!(details.files.len(), 1);
    assert_eq!(details.files[0].status, FileStatus::Added);
    let diff = commit_file_diff(&repo.path, &root, "a.txt", false).unwrap();
    assert_eq!(diff.hunks[0].lines[0].kind, DiffLineKind::Added);
    assert_eq!(diff.hunks[0].lines[0].text, "1");
}

#[test]
fn large_commit_details_ignore_worktree_paths_named_after_the_commit() {
    let repo = Fixture::init();
    repo.identity();
    let mut paths: Vec<String> = (0..1_000)
        .map(|number| format!("files/{number:04}.txt"))
        .chain(["tab\tname.txt".to_owned(), "line\nname.txt".to_owned()])
        .collect();
    paths.sort();
    for path in &paths {
        repo.write(path, "synthetic line\n");
    }
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Large synthetic root"]);
    let sha = repo.git(&["rev-parse", "HEAD"]);
    let short = &sha[..8];
    repo.write(&sha, "untracked full id\n");
    repo.write(short, "untracked short id\n");

    for revision in [sha.as_str(), short] {
        let details = commit_details(&repo.path, revision).unwrap();

        assert_eq!(details.sha, sha);
        assert_eq!(details.summary, "Large synthetic root");
        assert!(details.parents.is_empty());
        assert_eq!(details.files.len(), paths.len());
        for (file, path) in details.files.iter().zip(&paths) {
            assert_eq!(&file.path, path);
            assert_eq!(file.status, FileStatus::Added);
            assert_eq!((file.additions, file.deletions), (Some(1), Some(0)));
        }
        let diff = commit_file_diff(&repo.path, revision, &paths[999], false).unwrap();
        assert_eq!(diff.hunks[0].lines[0].text, "synthetic line");
    }
    assert_eq!(repo.read(&sha), "untracked full id\n");
    assert_eq!(repo.read(short), "untracked short id\n");
}

#[test]
fn root_commit_details_ignore_a_worktree_path_named_after_the_empty_tree() {
    let repo = ready_repository();
    let sha = repo.git(&["rev-parse", "HEAD"]);
    let empty_tree = repo.git(&["hash-object", "-t", "tree", "/dev/null"]);
    repo.write(&empty_tree, "untracked tree id\n");

    let details = commit_details(&repo.path, &sha).unwrap();

    assert_eq!(details.files.len(), 1);
    assert_eq!(details.files[0].path, "a.txt");
    assert_eq!(details.files[0].status, FileStatus::Added);
    assert_eq!(details.files[0].additions, Some(1));
    let diff = commit_file_diff(&repo.path, &sha, "a.txt", false).unwrap();
    assert_eq!(diff.hunks[0].lines[0].text, "1");
    assert_eq!(repo.read(&empty_tree), "untracked tree id\n");
}

#[test]
fn merge_commit_details_and_diff_are_taken_against_the_first_parent() {
    let repo = ready_repository();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit("feature.txt", "f\n", "Feature work");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit("main.txt", "m\n", "Main work");
    repo.git(&["merge", "--no-ff", "-q", "feature", "-m", "Merge feature"]);
    let merge = repo.git(&["rev-parse", "HEAD"]);
    let first_parent = repo.git(&["rev-parse", "HEAD^1"]);
    let second_parent = repo.git(&["rev-parse", "HEAD^2"]);

    let details = commit_details(&repo.path, &merge).unwrap();

    assert_eq!(details.parents, vec![first_parent, second_parent]);
    assert_eq!(details.summary, "Merge feature");
    let paths: Vec<&str> = details
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    assert_eq!(paths, vec!["feature.txt"]);
    let diff = commit_file_diff(&repo.path, &merge, "feature.txt", false).unwrap();
    assert_eq!(diff.hunks.len(), 1);
    assert_eq!(diff.hunks[0].lines.len(), 1);
    assert_eq!(diff.hunks[0].lines[0].text, "f");
    assert!(commit_file_diff(&repo.path, &merge, "main.txt", false)
        .unwrap()
        .hunks
        .is_empty());
}

#[test]
fn commit_details_and_diff_report_renames_with_their_source() {
    let repo = ready_repository();
    repo.numbered("big.txt", &[]);
    repo.git(&["add", "big.txt"]);
    repo.git(&["commit", "-q", "-m", "Add big"]);
    repo.git(&["mv", "big.txt", "moved.txt"]);
    repo.numbered("moved.txt", &[(5, "line five edited")]);
    repo.git(&["add", "moved.txt"]);
    repo.git(&["commit", "-q", "-m", "Move and edit"]);
    let head = repo.git(&["rev-parse", "HEAD"]);

    let details = commit_details(&repo.path, &head).unwrap();

    assert_eq!(details.files.len(), 1);
    assert_eq!(details.files[0].status, FileStatus::Renamed);
    assert_eq!(details.files[0].original_path.as_deref(), Some("big.txt"));
    assert_eq!(details.files[0].additions, Some(1));
    let diff = commit_file_diff(&repo.path, &head, "moved.txt", false).unwrap();
    assert_eq!(diff.original_path.as_deref(), Some("big.txt"));
    assert_eq!(diff.hunks.len(), 1);
}

#[test]
fn commit_details_rejects_ids_that_are_not_hexadecimal() {
    let repo = ready_repository();

    assert_eq!(
        commit_details(&repo.path, "HEAD").unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    assert_eq!(
        commit_file_diff(&repo.path, "--all", "a.txt", false)
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn editing_the_head_message_keeps_the_tree_the_index_and_the_work_tree() {
    let repo = ready_repository();
    repo.write("staged.txt", "s\n");
    repo.git(&["add", "staged.txt"]);
    repo.write("a.txt", "edited\n");
    let before = repo.git(&["rev-parse", "HEAD"]);
    let tree = repo.git(&["rev-parse", "HEAD^{tree}"]);

    let edit = edit_head_message(&repo.path, &before, "Better summary", "Why it changed.").unwrap();

    assert_ne!(edit.sha, before);
    assert!(!edit.pushed);
    assert_eq!(edit.sha, repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(repo.git(&["rev-parse", "HEAD^{tree}"]), tree);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Better summary");
    assert_eq!(repo.git(&["log", "-1", "--format=%b"]), "Why it changed.");
    assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "staged.txt");
    assert_eq!(repo.read("a.txt"), "edited\n");
}

#[test]
fn editing_a_message_that_is_not_head_is_refused_with_a_typed_reason() {
    let repo = ready_repository();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "Second");

    let error = edit_head_message(&repo.path, &first, "Nope", "").unwrap_err();

    assert_eq!(error.kind(), ErrorKind::NotHead);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Second");
}

#[test]
fn editing_the_message_during_a_merge_is_refused_with_a_typed_reason() {
    let repo = ready_repository();
    repo.git(&["switch", "-q", "-c", "side"]);
    repo.commit("side.txt", "s\n", "Side");
    repo.git(&["switch", "-q", "main"]);
    repo.commit("main.txt", "m\n", "Main");
    repo.git(&["merge", "--no-commit", "--no-ff", "side"]);
    let head = repo.git(&["rev-parse", "HEAD"]);

    let error = edit_head_message(&repo.path, &head, "Reword", "").unwrap_err();

    assert_eq!(error.kind(), ErrorKind::OperationInProgress);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Main");
}

#[test]
fn editing_the_message_needs_a_summary() {
    let repo = ready_repository();
    let head = repo.git(&["rev-parse", "HEAD"]);

    let error = edit_head_message(&repo.path, &head, "  ", "body").unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn editing_a_pushed_head_message_warns_that_published_history_was_rewritten() {
    let repo = ready_repository();
    repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let head = repo.git(&["rev-parse", "HEAD"]);

    let edit = edit_head_message(&repo.path, &head, "Reworded", "").unwrap();

    assert!(edit.pushed);
    assert_eq!(repo.git(&["log", "-1", "--format=%s"]), "Reworded");
}

#[test]
fn commit_file_diff_ignores_whitespace_only_changes_on_request() {
    let repo = ready_repository();
    repo.commit("w.txt", "one\ntwo\nthree\n", "Add w");
    repo.write("w.txt", "one\ntwo  \n   3\n");
    repo.git(&["commit", "-q", "-a", "-m", "Whitespace and a real edit"]);
    let mixed = repo.git(&["rev-parse", "HEAD"]);
    repo.write("w.txt", "  one\ntwo\n   3\n");
    repo.git(&["commit", "-q", "-a", "-m", "Whitespace only"]);
    let whitespace_only = repo.git(&["rev-parse", "HEAD"]);

    let plain = commit_file_diff(&repo.path, &whitespace_only, "w.txt", false).unwrap();
    let ignored = commit_file_diff(&repo.path, &whitespace_only, "w.txt", true).unwrap();
    let real = commit_file_diff(&repo.path, &mixed, "w.txt", true).unwrap();

    assert_eq!(plain.hunks.len(), 1);
    assert!(ignored.hunks.is_empty());
    let changed: Vec<(DiffLineKind, &str)> = real.hunks[0]
        .lines
        .iter()
        .filter(|line| line.kind != DiffLineKind::Context)
        .map(|line| (line.kind, line.text.trim()))
        .collect();
    assert_eq!(
        changed,
        vec![(DiffLineKind::Removed, "three"), (DiffLineKind::Added, "3")]
    );
}

#[test]
fn binary_commit_diffs_carry_the_size_of_each_side_that_exists() {
    let repo = ready_repository();
    repo.write("logo.png", "PNG\0\u{1}\u{2}");
    repo.git(&["add", "logo.png"]);
    repo.git(&["commit", "-q", "-m", "Add logo"]);
    let added = repo.git(&["rev-parse", "HEAD"]);
    repo.write("logo.png", "PNG\0\u{1}\u{2}\u{3}\u{4}");
    repo.git(&["commit", "-q", "-a", "-m", "Grow logo"]);
    let grown = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["rm", "-q", "logo.png"]);
    repo.git(&["commit", "-q", "-m", "Remove logo"]);
    let removed = repo.git(&["rev-parse", "HEAD"]);

    let sizes = |sha: &str| {
        let diff = commit_file_diff(&repo.path, sha, "logo.png", false).unwrap();
        assert!(diff.binary);
        (diff.old_size, diff.new_size)
    };

    assert_eq!(sizes(&added), (None, Some(6)));
    assert_eq!(sizes(&grown), (Some(6), Some(8)));
    assert_eq!(sizes(&removed), (Some(8), None));
    let text = commit_file_diff(&repo.path, &added, "a.txt", false).unwrap();
    assert_eq!((text.old_size, text.new_size), (None, None));
}

#[test]
fn a_commit_diff_over_two_megabytes_is_refused_with_its_size() {
    let repo = ready_repository();
    let big: String = (0..40_000)
        .map(|number| format!("line {number:05} {}\n", "x".repeat(50)))
        .collect();
    let sha = repo.commit("big.txt", &big, "Add big");

    let error = commit_file_diff(&repo.path, &sha, "big.txt", false).expect_err("refused");

    assert_eq!(error.kind(), ErrorKind::FileTooLarge, "{error:?}");
}

#[test]
fn revision_file_diff_shows_a_file_between_two_named_revisions() {
    let repo = ready_repository();
    let base = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["checkout", "-q", "-b", "other"]);
    repo.commit("a.txt", "1\n2\n", "Second");
    repo.git(&["checkout", "-q", "-"]);

    let diff = revision_file_diff(&repo.path, &base, "other", "a.txt", false).unwrap();

    let added: Vec<&str> = diff.hunks[0]
        .lines
        .iter()
        .filter(|line| line.kind == DiffLineKind::Added)
        .map(|line| line.text.as_str())
        .collect();
    assert_eq!(added, ["2"]);
}

#[test]
fn revision_file_diff_refuses_an_unknown_revision() {
    let repo = ready_repository();

    let error = revision_file_diff(&repo.path, "HEAD", "nope", "a.txt", false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}
