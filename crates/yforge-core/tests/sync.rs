mod common;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use common::Fixture;
use yforge_core::{
    fetch, pull, push, push_force, push_plan, repo_snapshot, CancelToken, ErrorKind, Head,
    Operation, Progress, PullMode, PullOutcome,
};

struct Pair {
    repo: Fixture,
    remote: PathBuf,
    other: PathBuf,
}

fn pair() -> Pair {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let other = repo.clone_of(&remote, "other");
    Pair {
        repo,
        remote,
        other,
    }
}

fn no_progress() -> impl FnMut(Progress) {
    |_| {}
}

fn remote_head(pair: &Pair, branch: &str) -> String {
    pair.repo.run_in(
        &pair.remote,
        &["rev-parse", &format!("refs/heads/{branch}")],
    )
}

fn fetch_now(pair: &Pair) {
    fetch(
        &pair.repo.path,
        false,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();
}

#[test]
fn fetch_updates_remote_tracking_refs_reports_progress_and_records_freshness() {
    let pair = pair();
    let pushed = pair
        .repo
        .commit_in(&pair.other, "b.txt", "b\n", "Remote work");
    pair.repo.run_in(&pair.other, &["push", "-q"]);
    assert_eq!(repo_snapshot(&pair.repo.path).unwrap().last_fetch, None);
    let mut events = Vec::new();

    fetch(
        &pair.repo.path,
        false,
        &CancelToken::new(),
        &mut |progress| events.push(progress),
    )
    .unwrap();

    assert_eq!(pair.repo.git(&["rev-parse", "origin/main"]), pushed);
    assert!(events.iter().any(|event| event.phase == "Fetching origin"));
    assert!(
        events
            .iter()
            .any(|event| event.percent.is_some_and(|percent| percent <= 100)),
        "{events:?}"
    );
    let snapshot = repo_snapshot(&pair.repo.path).unwrap();
    assert!(snapshot.last_fetch.is_some());
    assert_eq!(snapshot.upstream.unwrap().ahead_behind.unwrap().behind, 1);
}

#[test]
fn fetch_prunes_deleted_remote_branches_only_when_asked() {
    let pair = pair();
    pair.repo
        .run_in(&pair.other, &["push", "-q", "origin", "main:gone"]);
    fetch_now(&pair);
    assert!(pair.repo.git(&["branch", "-r"]).contains("origin/gone"));
    pair.repo
        .run_in(&pair.other, &["push", "-q", "origin", "--delete", "gone"]);

    fetch_now(&pair);
    assert!(pair.repo.git(&["branch", "-r"]).contains("origin/gone"));
    fetch(
        &pair.repo.path,
        true,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();
    assert!(!pair.repo.git(&["branch", "-r"]).contains("origin/gone"));
}

#[test]
fn fetch_without_remotes_is_an_invalid_request() {
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");

    let error = fetch(&repo.path, false, &CancelToken::new(), &mut no_progress()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn pull_fast_forwards_and_reports_up_to_date() {
    let pair = pair();
    let pushed = pair
        .repo
        .commit_in(&pair.other, "b.txt", "b\n", "Remote work");
    pair.repo.run_in(&pair.other, &["push", "-q"]);

    for expected in [PullOutcome::Updated, PullOutcome::UpToDate] {
        let outcome = pull(
            &pair.repo.path,
            PullMode::FastForwardOnly,
            &CancelToken::new(),
            &mut no_progress(),
        )
        .unwrap();
        assert_eq!(outcome, expected);
    }
    assert_eq!(pair.repo.git(&["rev-parse", "HEAD"]), pushed);
}

fn diverge(pair: &Pair, local_file: &str, remote_file: &str) {
    pair.repo
        .commit_in(&pair.other, remote_file, "remote\n", "Remote work");
    pair.repo.run_in(&pair.other, &["push", "-q"]);
    pair.repo.commit(local_file, "local\n", "Local work");
}

#[test]
fn fast_forward_only_pull_refuses_a_diverged_branch() {
    let pair = pair();
    diverge(&pair, "local.txt", "remote.txt");
    let before = pair.repo.git(&["rev-parse", "HEAD"]);

    let error = pull(
        &pair.repo.path,
        PullMode::FastForwardOnly,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::NotFastForward);
    assert_eq!(pair.repo.git(&["rev-parse", "HEAD"]), before);
    assert!(repo_snapshot(&pair.repo.path).unwrap().operation.is_none());
}

#[test]
fn merge_pull_creates_a_merge_commit_for_a_diverged_branch() {
    let pair = pair();
    diverge(&pair, "local.txt", "remote.txt");

    let outcome = pull(
        &pair.repo.path,
        PullMode::FastForwardOrMerge,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();

    assert_eq!(outcome, PullOutcome::Updated);
    assert_eq!(
        pair.repo
            .git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split(' ')
            .count(),
        3
    );
    assert_eq!(
        (pair.repo.read("local.txt"), pair.repo.read("remote.txt")),
        ("local\n".into(), "remote\n".into())
    );
}

#[test]
fn rebase_pull_replays_local_commits_on_top_of_the_upstream() {
    let pair = pair();
    diverge(&pair, "local.txt", "remote.txt");

    let outcome = pull(
        &pair.repo.path,
        PullMode::Rebase,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();

    assert_eq!(outcome, PullOutcome::Updated);
    assert_eq!(
        pair.repo
            .git(&["rev-list", "--parents", "-n", "1", "HEAD"])
            .split(' ')
            .count(),
        2
    );
    assert_eq!(
        pair.repo.git(&["log", "-2", "--format=%s"]),
        "Local work\nRemote work"
    );
    let snapshot = repo_snapshot(&pair.repo.path).unwrap();
    assert!(snapshot.operation.is_none());
    assert_eq!(snapshot.upstream.unwrap().ahead_behind.unwrap().ahead, 1);
}

#[test]
fn a_conflicting_merge_pull_lands_in_the_merge_state() {
    let pair = pair();
    diverge(&pair, "a.txt", "a.txt");

    let outcome = pull(
        &pair.repo.path,
        PullMode::FastForwardOrMerge,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();

    assert_eq!(outcome, PullOutcome::Conflicts);
    let snapshot = repo_snapshot(&pair.repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Merge));
    assert_eq!(snapshot.counts.conflicted, 1);
    assert_eq!(
        snapshot.operation_detail.unwrap().incoming.as_deref(),
        Some("origin/main")
    );
}

#[test]
fn a_conflicting_rebase_pull_lands_in_the_rebase_state() {
    let pair = pair();
    diverge(&pair, "a.txt", "a.txt");

    let outcome = pull(
        &pair.repo.path,
        PullMode::Rebase,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();

    assert_eq!(outcome, PullOutcome::Conflicts);
    let snapshot = repo_snapshot(&pair.repo.path).unwrap();
    assert_eq!(snapshot.operation, Some(Operation::Rebase));
    assert_eq!(snapshot.counts.conflicted, 1);
    assert!(matches!(snapshot.head, Head::Detached { .. }));
}

#[test]
fn pull_needs_a_branch_with_an_upstream() {
    let pair = pair();
    pair.repo.git(&["switch", "-q", "-c", "local-only"]);

    let error = pull(
        &pair.repo.path,
        PullMode::FastForwardOrMerge,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);

    pair.repo.git(&["checkout", "-q", "--detach"]);
    let error = pull(
        &pair.repo.path,
        PullMode::FastForwardOrMerge,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn push_creates_the_remote_branch_and_sets_the_upstream_on_first_push() {
    let pair = pair();
    pair.repo.git(&["switch", "-q", "-c", "feature/new"]);
    let sha = pair.repo.commit("f.txt", "f\n", "Feature");
    let mut events = Vec::new();

    push(&pair.repo.path, &CancelToken::new(), &mut |progress| {
        events.push(progress)
    })
    .unwrap();

    assert_eq!(remote_head(&pair, "feature/new"), sha);
    let snapshot = repo_snapshot(&pair.repo.path).unwrap();
    assert_eq!(snapshot.upstream.unwrap().name, "origin/feature/new");
    assert!(
        events.iter().any(|event| event.percent.is_some()),
        "{events:?}"
    );
}

#[test]
fn push_sends_new_commits_to_the_tracked_branch() {
    let pair = pair();
    let sha = pair.repo.commit("b.txt", "b\n", "Local work");

    push(&pair.repo.path, &CancelToken::new(), &mut no_progress()).unwrap();

    assert_eq!(remote_head(&pair, "main"), sha);
    assert_eq!(
        repo_snapshot(&pair.repo.path)
            .unwrap()
            .upstream
            .unwrap()
            .ahead_behind
            .unwrap()
            .ahead,
        0
    );
}

#[test]
fn push_rejected_as_non_fast_forward_is_a_typed_error() {
    let pair = pair();
    diverge(&pair, "local.txt", "remote.txt");
    let remote_before = remote_head(&pair, "main");

    let error = push(&pair.repo.path, &CancelToken::new(), &mut no_progress()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::PushRejected);
    assert_eq!(remote_head(&pair, "main"), remote_before);
}

fn rewrite(pair: &Pair) -> String {
    pair.repo.commit("b.txt", "first\n", "Original work");
    pair.repo.git(&["push", "-q"]);
    pair.repo.write("b.txt", "rewritten\n");
    pair.repo.git(&["add", "b.txt"]);
    pair.repo
        .git(&["commit", "-q", "--amend", "-m", "Rewritten work"]);
    pair.repo.git(&["rev-parse", "HEAD"])
}

#[test]
fn a_force_push_plan_lists_the_remote_commits_that_would_be_replaced() {
    let pair = pair();
    let remote_tip = pair.repo.commit("b.txt", "first\n", "Original work");
    pair.repo.git(&["push", "-q"]);
    pair.repo
        .git(&["commit", "-q", "--amend", "-m", "Rewritten work"]);

    let plan = push_plan(&pair.repo.path).unwrap();

    assert_eq!(plan.upstream, "origin/main");
    assert_eq!(plan.lease.remote, "origin");
    assert_eq!(plan.lease.branch, "main");
    assert_eq!(plan.lease.remote_ref, "refs/heads/main");
    assert_eq!(plan.lease.expected_sha, remote_tip);
    assert_eq!(plan.replaced.len(), 1);
    assert_eq!(plan.replaced[0].sha, remote_tip);
    assert_eq!(plan.replaced[0].summary, "Original work");
}

#[test]
fn a_force_push_plan_needs_remote_commits_to_replace() {
    let pair = pair();
    pair.repo.commit("b.txt", "b\n", "Local work");

    let error = push_plan(&pair.repo.path).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn force_with_lease_replaces_the_remote_branch_after_a_rewrite() {
    let pair = pair();
    let rewritten = rewrite(&pair);
    let plan = push_plan(&pair.repo.path).unwrap();
    assert_eq!(
        push(&pair.repo.path, &CancelToken::new(), &mut no_progress())
            .unwrap_err()
            .kind(),
        ErrorKind::PushRejected
    );

    push_force(
        &pair.repo.path,
        &plan.lease,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap();

    assert_eq!(remote_head(&pair, "main"), rewritten);
}

#[test]
fn force_with_lease_is_rejected_when_the_remote_moved_after_the_plan() {
    let pair = pair();
    rewrite(&pair);
    let plan = push_plan(&pair.repo.path).unwrap();
    pair.repo
        .run_in(&pair.other, &["pull", "-q", "--no-rebase"]);
    let moved = pair
        .repo
        .commit_in(&pair.other, "c.txt", "c\n", "Someone else's work");
    pair.repo.run_in(&pair.other, &["push", "-q"]);

    let error = push_force(
        &pair.repo.path,
        &plan.lease,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::PushRejected);
    assert_eq!(remote_head(&pair, "main"), moved);
}

#[test]
fn force_with_lease_validates_the_lease_before_running_git() {
    let pair = pair();
    rewrite(&pair);
    let plan = push_plan(&pair.repo.path).unwrap();
    let cases = [
        yforge_core::ForceLease {
            remote: "elsewhere".into(),
            ..plan.lease.clone()
        },
        yforge_core::ForceLease {
            branch: "ghost".into(),
            ..plan.lease.clone()
        },
        yforge_core::ForceLease {
            remote_ref: "refs/tags/v1".into(),
            ..plan.lease.clone()
        },
        yforge_core::ForceLease {
            expected_sha: "--force".into(),
            ..plan.lease.clone()
        },
    ];
    for lease in cases {
        let error = push_force(
            &pair.repo.path,
            &lease,
            &CancelToken::new(),
            &mut no_progress(),
        )
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidRequest, "{lease:?}");
    }
}

#[test]
fn a_cancelled_token_stops_the_operation_before_it_changes_anything() {
    let pair = pair();
    let pushed = pair
        .repo
        .commit_in(&pair.other, "b.txt", "b\n", "Remote work");
    pair.repo.run_in(&pair.other, &["push", "-q"]);
    let cancel = CancelToken::new();
    cancel.cancel();

    let error = fetch(&pair.repo.path, false, &cancel, &mut no_progress()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled);
    assert_ne!(pair.repo.git(&["rev-parse", "origin/main"]), pushed);
}

#[cfg(unix)]
#[test]
fn cancelling_a_running_fetch_kills_it_and_returns_promptly() {
    use std::os::unix::fs::PermissionsExt;

    let pair = pair();
    let script = pair.repo.sibling("slow-upload-pack.sh");
    std::fs::write(&script, "#!/bin/sh\nsleep 5\nexec git-upload-pack \"$@\"\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    pair.repo.git(&[
        "config",
        "remote.origin.uploadpack",
        script.to_str().unwrap(),
    ]);
    let cancel = CancelToken::new();
    let stopper = cancel.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(400));
        stopper.cancel();
    });
    let started = Instant::now();

    let error = fetch(&pair.repo.path, false, &cancel, &mut no_progress()).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled);
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "{:?}",
        started.elapsed()
    );
}

fn unauthorized_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = [0_u8; 4096];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    });
    port
}

fn point_origin_at(repo: &Fixture, url: &str) {
    repo.git(&["remote", "set-url", "origin", url]);
}

#[test]
fn a_credential_challenge_maps_to_an_authentication_error_naming_the_remote() {
    let pair = pair();
    let url = format!("http://127.0.0.1:{}/private.git", unauthorized_server());
    point_origin_at(&pair.repo, &url);
    let tokens = || CancelToken::new();

    let fetched = fetch(&pair.repo.path, false, &tokens(), &mut no_progress()).unwrap_err();
    let pulled = pull(
        &pair.repo.path,
        PullMode::FastForwardOrMerge,
        &tokens(),
        &mut no_progress(),
    )
    .unwrap_err();
    pair.repo.commit("b.txt", "b\n", "Local work");
    let pushed = push(&pair.repo.path, &tokens(), &mut no_progress()).unwrap_err();

    for error in [fetched, pulled, pushed] {
        assert_eq!(error.kind(), ErrorKind::AuthFailed, "{error:?}");
        assert_eq!(error.to_string(), "Authentication failed for origin");
    }
}

#[test]
fn an_unreachable_remote_is_a_plain_git_failure_not_an_authentication_error() {
    let pair = pair();
    point_origin_at(&pair.repo, "http://127.0.0.1:1/none.git");

    let error = fetch(
        &pair.repo.path,
        false,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
}

#[test]
fn an_invalid_remote_path_is_a_plain_git_failure() {
    let pair = pair();
    point_origin_at(
        &pair.repo,
        Path::new("/nonexistent/yforge/remote.git")
            .to_str()
            .unwrap(),
    );

    let error = fetch(
        &pair.repo.path,
        false,
        &CancelToken::new(),
        &mut no_progress(),
    )
    .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed);
}
