mod common;

use common::Fixture;
use yforge_core::{
    amend_commit_context, commit_changes_context, commit_context, working_changes_context,
    ErrorKind,
};

fn staged_fixture() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First commit");
    repo.commit("b.txt", "two\n", "Second: add b");
    repo
}

#[test]
fn the_commit_context_carries_the_staged_diff_and_recent_subjects_newest_first() {
    let repo = staged_fixture();
    repo.write("a.txt", "one\nadded line\n");
    repo.write("unstaged.txt", "not staged\n");
    repo.git(&["add", "a.txt"]);

    let context = commit_context(&repo.path).unwrap();

    assert!(context.diff.contains("=== a.txt (modified) ==="));
    assert!(context.diff.contains("+added line"));
    assert!(!context.diff.contains("unstaged.txt"));
    assert_eq!(context.recent_subjects, ["Second: add b", "First commit"]);
    assert!(context.excluded.is_empty() && context.truncated.is_empty());
}

#[test]
fn amend_message_context_describes_the_resulting_commit_without_unstaged_changes() {
    let repo = staged_fixture();
    repo.write("b.txt", "two\nfrom index\n");
    repo.git(&["add", "b.txt"]);
    repo.write("b.txt", "two\nfrom index\nnot staged\n");

    let context = amend_commit_context(&repo.path).unwrap();

    assert!(context.diff.contains("=== b.txt (added) ==="));
    assert!(context.diff.contains("+from index"));
    assert!(!context.diff.contains("not staged"));
}

#[test]
fn amend_message_context_uses_head_when_nothing_is_staged() {
    let repo = staged_fixture();

    let context = amend_commit_context(&repo.path).unwrap();

    assert!(context.diff.contains("=== b.txt (added) ==="));
    assert!(context.diff.contains("+two"));
}

#[test]
fn amend_message_context_uses_the_empty_tree_for_a_root_commit() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "root\n", "Root");

    let context = amend_commit_context(&repo.path).unwrap();

    assert!(context.diff.contains("=== a.txt (added) ==="));
    assert!(context.diff.contains("+root"));
}

#[test]
fn amend_message_context_refuses_a_secret_only_result() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit(".env", "SECRET_VALUE\n", "Root");

    let error = amend_commit_context(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert!(!error.to_string().contains("SECRET_VALUE"));
}

#[test]
fn recent_subjects_are_capped_at_ten() {
    let repo = Fixture::init();
    repo.identity();
    for number in 0..12 {
        repo.commit("a.txt", &format!("{number}\n"), &format!("Commit {number}"));
    }
    repo.write("a.txt", "next\n");
    repo.git(&["add", "a.txt"]);

    let context = commit_context(&repo.path).unwrap();

    assert_eq!(context.recent_subjects.len(), 10);
    assert_eq!(context.recent_subjects[0], "Commit 11");
}

#[test]
fn a_repository_without_commits_has_no_recent_subjects() {
    let repo = Fixture::init();
    repo.write("a.txt", "one\n");
    repo.git(&["add", "a.txt"]);

    let context = commit_context(&repo.path).unwrap();

    assert!(context.recent_subjects.is_empty());
    assert!(context.diff.contains("=== a.txt (added) ==="));
}

#[test]
fn nothing_staged_is_an_invalid_request() {
    let repo = staged_fixture();
    repo.write("a.txt", "edited\n");

    let error = commit_context(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn secret_files_are_withheld_and_reported() {
    let repo = staged_fixture();
    repo.write("a.txt", "one\nmore\n");
    repo.write(".env", "TOKEN=hunter2\n");
    repo.write("certs/server.pem", "-----BEGIN KEY-----\n");
    repo.git(&["add", "a.txt", ".env", "certs/server.pem"]);

    let context = commit_context(&repo.path).unwrap();

    assert_eq!(context.excluded, [".env", "certs/server.pem"]);
    assert!(!context.diff.contains("hunter2"));
    assert!(!context.diff.contains("BEGIN KEY"));
    assert!(context
        .diff
        .contains("=== .env (added, content withheld: secret file) ==="));
    assert!(context.diff.contains("+more"));
}

#[test]
fn staging_only_secret_files_is_refused() {
    let repo = staged_fixture();
    repo.write(".env.local", "TOKEN=hunter2\n");
    repo.git(&["add", ".env.local"]);

    let error = commit_context(&repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn binary_files_are_listed_by_name_only() {
    let repo = staged_fixture();
    std::fs::write(repo.path.join("logo.bin"), [0_u8, 159, 146, 150, 0, 1]).unwrap();
    repo.git(&["add", "logo.bin"]);

    let context = commit_context(&repo.path).unwrap();

    assert!(context
        .diff
        .contains("=== logo.bin (added, binary: content not shown) ==="));
    assert!(!context.diff.contains("@@"));
}

#[test]
fn a_renamed_file_names_its_origin() {
    let repo = staged_fixture();
    repo.git(&["mv", "b.txt", "renamed.txt"]);

    let context = commit_context(&repo.path).unwrap();

    assert!(context
        .diff
        .contains("=== renamed.txt (renamed from b.txt) ==="));
}

#[test]
fn oversized_diffs_are_cut_per_file_and_in_total_and_each_cut_or_omitted_file_is_named() {
    let repo = staged_fixture();
    let big = |tag: &str| {
        (0..3000)
            .map(|line| format!("{tag} line {line} with padding to add up\n"))
            .collect::<String>()
    };
    for name in ["big1.txt", "big2.txt", "big3.txt", "big4.txt"] {
        repo.write(name, &big(name));
    }
    repo.write("small.txt", "tiny\n");
    repo.git(&["add", "."]);

    let context = commit_context(&repo.path).unwrap();

    assert!(
        context.diff.len() <= 60 * 1024 + 512,
        "{}",
        context.diff.len()
    );
    assert_eq!(
        context.truncated,
        ["big1.txt", "big2.txt", "big3.txt", "big4.txt", "small.txt"]
    );
    assert!(context.diff.contains("[diff truncated:"));
    assert!(context.diff.contains("[diff omitted: size budget reached]"));
    assert!(context.diff.contains("=== small.txt (added) ==="));
}

#[test]
fn a_staged_diff_over_the_diff_view_limit_is_still_cut_to_the_context_budget() {
    let repo = staged_fixture();
    let huge: String = (0..40_000)
        .map(|line| format!("line {line:05} {}\n", "x".repeat(50)))
        .collect();
    repo.write("huge.txt", &huge);
    repo.git(&["add", "huge.txt"]);

    let context = commit_context(&repo.path).unwrap();

    assert_eq!(context.truncated, ["huge.txt"]);
    assert!(context.diff.contains("[diff truncated:"));
}

#[test]
fn the_working_changes_context_covers_staged_unstaged_and_untracked_files_once_each() {
    let repo = staged_fixture();
    repo.write("a.txt", "one\nstaged line\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "one\nstaged line\nunstaged line\n");
    repo.write("b.txt", "two\nmore\n");
    repo.write("new.txt", "brand new\n");
    repo.write(".env", "TOKEN=hunter2\n");

    let context = working_changes_context(&repo.path).unwrap();

    assert_eq!(context.files, [".env", "a.txt", "b.txt", "new.txt"]);
    assert_eq!(context.message, None);
    assert_eq!(context.diff.matches("=== a.txt").count(), 1);
    assert!(context.diff.contains("+staged line\n+unstaged line"));
    assert!(context.diff.contains("=== b.txt (modified) ==="));
    assert!(context.diff.contains("=== new.txt (untracked) ==="));
    assert!(context.diff.contains("+brand new"));
    assert_eq!(context.excluded, [".env"]);
    assert!(context
        .diff
        .contains("=== .env (untracked, content withheld: secret file) ==="));
    assert!(!context.diff.contains("hunter2"));
    assert!(context.truncated.is_empty());
}

#[test]
fn the_working_changes_context_includes_staged_renames_and_deletions() {
    let repo = staged_fixture();
    repo.git(&["mv", "b.txt", "renamed.txt"]);
    std::fs::remove_file(repo.path.join("a.txt")).unwrap();

    let context = working_changes_context(&repo.path).unwrap();

    assert_eq!(context.files, ["a.txt", "renamed.txt"]);
    assert!(context.diff.contains("=== a.txt (deleted) ==="));
    assert!(context.diff.contains("-one"));
    assert!(context
        .diff
        .contains("=== renamed.txt (renamed from b.txt) ==="));
}

#[test]
fn a_clean_or_secret_only_working_tree_is_refused() {
    let repo = staged_fixture();
    assert_eq!(
        working_changes_context(&repo.path).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
    repo.write(".env", "TOKEN=hunter2\n");
    assert_eq!(
        working_changes_context(&repo.path).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn the_commit_changes_context_carries_its_message_and_its_diff_against_the_first_parent() {
    let repo = staged_fixture();
    repo.write("a.txt", "one\nfrom the commit\n");
    repo.write("certs/server.pem", "-----BEGIN KEY-----\n");
    repo.git(&["add", "."]);
    repo.git(&["commit", "-q", "-m", "Explain me", "-m", "Body text."]);
    let sha = repo.git(&["rev-parse", "HEAD"]);
    repo.write("a.txt", "working tree only\n");

    let context = commit_changes_context(&repo.path, &sha).unwrap();

    assert_eq!(context.message.as_deref(), Some("Explain me\n\nBody text."));
    assert_eq!(context.files, ["a.txt", "certs/server.pem"]);
    assert!(context.diff.contains("=== a.txt (modified) ==="));
    assert!(context.diff.contains("+from the commit"));
    assert!(!context.diff.contains("working tree only"));
    assert_eq!(context.excluded, ["certs/server.pem"]);
    assert!(!context.diff.contains("BEGIN KEY"));
}

#[test]
fn the_first_commit_is_explained_against_an_empty_tree() {
    let repo = Fixture::init();
    repo.identity();
    let sha = repo.commit("a.txt", "first\n", "Start");

    let context = commit_changes_context(&repo.path, &sha).unwrap();

    assert_eq!(context.files, ["a.txt"]);
    assert!(context.diff.contains("=== a.txt (added) ==="));
    assert!(context.diff.contains("+first"));
}
