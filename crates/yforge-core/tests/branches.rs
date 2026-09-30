mod common;

use common::Fixture;
use yforge_core::{
    branch_delete_preview, check_branch_name, checkout, create_branch, delete_branch,
    rename_branch, repo_snapshot, AutoStash, CheckoutTarget, ErrorKind, Head,
};

fn local(name: &str) -> CheckoutTarget {
    CheckoutTarget::LocalBranch { name: name.into() }
}

fn branch_head(repo: &Fixture) -> Head {
    repo_snapshot(&repo.path).unwrap().head
}

fn ready() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo
}

#[test]
fn checks_out_an_existing_local_branch() {
    let repo = ready();
    repo.git(&["branch", "feature"]);

    let outcome = checkout(&repo.path, &local("feature"), false).unwrap();

    assert_eq!(outcome.auto_stash, AutoStash::None);
    assert!(matches!(branch_head(&repo), Head::Branch { name, .. } if name == "feature"));
}

#[test]
fn checks_out_a_remote_only_branch_by_creating_its_tracking_branch() {
    let repo = ready();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "origin", "main"]);
    let other = repo.clone_of(&remote, "other");
    repo.run_in(&other, &["switch", "-q", "-c", "feature/x"]);
    repo.commit_in(&other, "x.txt", "x\n", "Feature work");
    repo.run_in(&other, &["push", "-q", "origin", "feature/x"]);
    repo.git(&["fetch", "-q", "origin"]);

    checkout(
        &repo.path,
        &CheckoutTarget::RemoteBranch {
            name: "origin/feature/x".into(),
        },
        false,
    )
    .unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name, .. } if name == "feature/x"));
    assert_eq!(snapshot.upstream.unwrap().name, "origin/feature/x");
    assert!(snapshot.branches.contains(&"feature/x".to_owned()));
    assert_eq!(repo.read("x.txt"), "x\n");
}

#[test]
fn refuses_a_remote_checkout_when_the_local_branch_already_exists() {
    let repo = ready();
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "origin", "main"]);
    repo.git(&["fetch", "-q", "origin"]);
    assert!(remote.exists());

    let error = checkout(
        &repo.path,
        &CheckoutTarget::RemoteBranch {
            name: "origin/main".into(),
        },
        false,
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn rejects_unknown_branches_tags_commits_and_remotes() {
    let repo = ready();
    for target in [
        local("missing"),
        CheckoutTarget::Tag {
            name: "nope".into(),
        },
        CheckoutTarget::Commit {
            sha: "not-hex".into(),
        },
        CheckoutTarget::Commit {
            sha: "0000000000000000000000000000000000000000".into(),
        },
        CheckoutTarget::RemoteBranch {
            name: "nowhere/main".into(),
        },
    ] {
        let error = checkout(&repo.path, &target, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{target:?}");
    }
}

#[test]
fn a_switch_that_would_overwrite_local_changes_is_a_typed_error_and_touches_nothing() {
    let repo = ready();
    repo.git(&["switch", "-q", "-c", "feature"]);
    repo.commit("a.txt", "feature\n", "Feature edit");
    repo.git(&["switch", "-q", "main"]);
    repo.write("a.txt", "local\n");

    let error = checkout(&repo.path, &local("feature"), false).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::LocalChanges);
    assert_eq!(repo.read("a.txt"), "local\n");
    assert!(matches!(branch_head(&repo), Head::Branch { name, .. } if name == "main"));
}

#[test]
fn stash_and_switch_restores_the_changes_on_the_new_branch() {
    let repo = ready();
    repo.commit("b.txt", "b\n", "Second");
    repo.git(&["switch", "-q", "-c", "feature"]);
    repo.commit("c.txt", "c\n", "Feature edit");
    repo.git(&["switch", "-q", "main"]);
    repo.write("a.txt", "local edit\n");
    repo.write("scratch.txt", "untracked\n");

    let outcome = checkout(&repo.path, &local("feature"), true).unwrap();

    assert_eq!(outcome.auto_stash, AutoStash::Restored);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name, .. } if name == "feature"));
    assert!(snapshot.stashes.is_empty());
    assert_eq!(repo.read("a.txt"), "local edit\n");
    assert_eq!(repo.read("scratch.txt"), "untracked\n");
}

#[test]
fn stash_and_switch_reports_conflicts_and_keeps_the_stash() {
    let repo = ready();
    repo.git(&["switch", "-q", "-c", "feature"]);
    repo.commit("a.txt", "feature\n", "Feature edit");
    repo.git(&["switch", "-q", "main"]);
    repo.write("a.txt", "local\n");

    let outcome = checkout(&repo.path, &local("feature"), true).unwrap();

    assert_eq!(outcome.auto_stash, AutoStash::Conflicts);
    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name, .. } if name == "feature"));
    assert_eq!(snapshot.stashes.len(), 1);
    assert_eq!(snapshot.counts.conflicted, 1);
}

#[test]
fn stashing_a_clean_tree_switches_without_creating_a_stash() {
    let repo = ready();
    repo.git(&["branch", "feature"]);

    let outcome = checkout(&repo.path, &local("feature"), true).unwrap();

    assert_eq!(outcome.auto_stash, AutoStash::None);
    assert!(repo_snapshot(&repo.path).unwrap().stashes.is_empty());
}

#[test]
fn a_failed_switch_restores_the_auto_stash_and_reports_the_failure() {
    let repo = ready();
    repo.git(&["branch", "occupied"]);
    let worktree = repo.sibling("occupied-tree");
    repo.git(&[
        "worktree",
        "add",
        "-q",
        worktree.to_str().unwrap(),
        "occupied",
    ]);
    repo.write("a.txt", "local\n");

    let error = checkout(&repo.path, &local("occupied"), true).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
    assert_eq!(repo.read("a.txt"), "local\n");
    assert!(repo_snapshot(&repo.path).unwrap().stashes.is_empty());
}

#[test]
fn detached_checkouts_of_tags_and_commits_refuse_a_dirty_tree() {
    let repo = ready();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "v1"]);
    repo.commit("b.txt", "b\n", "Second");
    repo.write("a.txt", "dirty\n");

    for target in [
        CheckoutTarget::Tag { name: "v1".into() },
        CheckoutTarget::Commit { sha: first },
    ] {
        let error = checkout(&repo.path, &target, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::LocalChanges, "{target:?}");
    }
    assert!(matches!(branch_head(&repo), Head::Branch { .. }));
    assert_eq!(repo.read("a.txt"), "dirty\n");
}

#[test]
fn detaches_at_a_tag_or_commit_and_restores_stashed_changes() {
    let repo = ready();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "v1"]);
    repo.commit("b.txt", "b\n", "Second");
    let second = repo.git(&["rev-parse", "HEAD"]);
    repo.write("a.txt", "dirty\n");

    let outcome = checkout(&repo.path, &CheckoutTarget::Tag { name: "v1".into() }, true).unwrap();
    assert_eq!(outcome.auto_stash, AutoStash::Restored);
    assert_eq!(branch_head(&repo), Head::Detached { sha: first });
    assert_eq!(repo.read("a.txt"), "dirty\n");

    repo.git(&["checkout", "--", "a.txt"]);
    checkout(
        &repo.path,
        &CheckoutTarget::Commit {
            sha: second.clone(),
        },
        false,
    )
    .unwrap();
    assert_eq!(branch_head(&repo), Head::Detached { sha: second });
}

#[test]
fn creates_a_branch_at_head_and_checks_it_out() {
    let repo = ready();

    create_branch(&repo.path, "feature/new", None, true).unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name, .. } if name == "feature/new"));
    assert!(snapshot.branches.contains(&"main".to_owned()));
}

#[test]
fn creates_a_branch_at_a_selected_commit_without_checking_it_out() {
    let repo = ready();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.commit("b.txt", "b\n", "Second");

    create_branch(&repo.path, "old", Some(&first), false).unwrap();

    assert_eq!(repo.git(&["rev-parse", "old"]), first);
    assert!(matches!(branch_head(&repo), Head::Branch { name, .. } if name == "main"));
}

#[test]
fn creates_a_branch_at_a_full_ref_name() {
    let repo = ready();
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "v1"]);
    repo.commit("b.txt", "b\n", "Second");

    create_branch(&repo.path, "from-tag", Some("refs/tags/v1"), false).unwrap();

    assert_eq!(repo.git(&["rev-parse", "from-tag"]), first);
    for start in ["refs/heads/missing", "--orphan", "main"] {
        let error = create_branch(&repo.path, "other", Some(start), false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{start}");
    }
}

#[test]
fn rejects_invalid_and_duplicate_branch_names_and_unknown_start_points() {
    let repo = ready();
    for name in [
        "",
        "has space",
        "-lead",
        "a..b",
        "end.lock",
        "@{-1}",
        "main",
    ] {
        let error = create_branch(&repo.path, name, None, false).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{name:?}");
    }
    let error = create_branch(
        &repo.path,
        "x",
        Some("0000000000000000000000000000000000000000"),
        false,
    )
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    assert_eq!(repo_snapshot(&repo.path).unwrap().branches, vec!["main"]);
}

#[test]
fn check_branch_name_returns_valid_names_and_rejects_the_rest() {
    let repo = ready();

    assert_eq!(
        check_branch_name(&repo.path, "feature/ok-1").unwrap(),
        "feature/ok-1"
    );
    assert_eq!(
        check_branch_name(&repo.path, "bad name")
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn renames_a_local_branch_and_keeps_the_checked_out_state() {
    let repo = ready();
    repo.git(&["switch", "-q", "-c", "old-name"]);

    rename_branch(&repo.path, "old-name", "new/name").unwrap();

    let snapshot = repo_snapshot(&repo.path).unwrap();
    assert!(matches!(&snapshot.head, Head::Branch { name, .. } if name == "new/name"));
    assert!(!snapshot.branches.contains(&"old-name".to_owned()));
    for (from, to) in [("missing", "x"), ("main", "new/name"), ("main", "bad name")] {
        let error = rename_branch(&repo.path, from, to).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{from} -> {to}");
    }
}

#[test]
fn deletes_a_merged_branch_without_confirmation() {
    let repo = ready();
    repo.git(&["branch", "merged"]);

    assert!(branch_delete_preview(&repo.path, "merged")
        .unwrap()
        .is_empty());
    delete_branch(&repo.path, "merged", false).unwrap();

    assert_eq!(repo_snapshot(&repo.path).unwrap().branches, vec!["main"]);
}

#[test]
fn an_unmerged_branch_needs_force_and_the_preview_names_the_commits_lost() {
    let repo = ready();
    repo.git(&["switch", "-q", "-c", "topic"]);
    let first = repo.commit("t1.txt", "1\n", "Topic one");
    let second = repo.commit("t2.txt", "2\n", "Topic two");
    repo.git(&["switch", "-q", "main"]);

    let preview = branch_delete_preview(&repo.path, "topic").unwrap();
    assert_eq!(
        preview
            .iter()
            .map(|commit| (commit.sha.as_str(), commit.summary.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (second.as_str(), "Topic two"),
            (first.as_str(), "Topic one")
        ]
    );
    let refused = delete_branch(&repo.path, "topic", false).unwrap_err();
    assert_eq!(refused.kind(), ErrorKind::UnmergedBranch);
    assert!(repo_snapshot(&repo.path)
        .unwrap()
        .branches
        .contains(&"topic".to_owned()));

    delete_branch(&repo.path, "topic", true).unwrap();
    assert_eq!(repo_snapshot(&repo.path).unwrap().branches, vec!["main"]);
}

#[test]
fn commits_kept_by_another_branch_or_a_tag_are_not_lost() {
    let repo = ready();
    repo.git(&["switch", "-q", "-c", "topic"]);
    repo.commit("t1.txt", "1\n", "Topic one");
    repo.git(&["tag", "keep"]);
    repo.git(&["switch", "-q", "main"]);

    assert!(branch_delete_preview(&repo.path, "topic")
        .unwrap()
        .is_empty());
    delete_branch(&repo.path, "topic", false).unwrap();
}

#[test]
fn refuses_to_delete_the_checked_out_branch_or_an_unknown_one() {
    let repo = ready();

    for name in ["main", "ghost"] {
        let error = delete_branch(&repo.path, name, true).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{name}");
    }
}
