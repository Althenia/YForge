mod common;

use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use common::Fixture;
use yforge_core::{watch_repo, RepoWatcher};

const EVENT_TIMEOUT: Duration = Duration::from_secs(10);
const QUIET_CHECK: Duration = Duration::from_millis(1500);

fn watched(repo: &Fixture) -> (RepoWatcher, Receiver<()>) {
    let (sender, receiver) = mpsc::channel();
    let watcher = watch_repo(&repo.path, move || {
        let _ = sender.send(());
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(600));
    while receiver.try_recv().is_ok() {}
    (watcher, receiver)
}

fn ready_repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    repo.write(".gitignore", "build/\n*.log\n");
    repo.commit("a.txt", "1\n", "First");
    repo.git(&["add", ".gitignore"]);
    repo.git(&["commit", "-q", "-m", "Ignore build output"]);
    repo
}

#[test]
fn reports_a_working_tree_edit_once_after_the_burst_settles() {
    let repo = ready_repository();
    let (_watcher, events) = watched(&repo);

    repo.write("a.txt", "2\n");
    repo.write("b.txt", "new\n");

    events.recv_timeout(EVENT_TIMEOUT).expect("change event");
    assert!(
        events.recv_timeout(QUIET_CHECK).is_err(),
        "burst was not coalesced"
    );
}

#[test]
fn ignored_files_and_git_internals_do_not_report_changes() {
    let repo = ready_repository();
    let (_watcher, events) = watched(&repo);

    repo.write("build/out.bin", "x\n");
    repo.write("debug.log", "x\n");
    assert!(
        events.recv_timeout(QUIET_CHECK).is_err(),
        "ignored file reported"
    );

    repo.write("a.txt", "changed\n");
    events
        .recv_timeout(EVENT_TIMEOUT)
        .expect("tracked change event");
}

#[test]
fn reports_an_index_only_change() {
    let repo = ready_repository();
    repo.write("a.txt", "2\n");
    let (_watcher, events) = watched(&repo);

    repo.git(&["add", "a.txt"]);

    events.recv_timeout(EVENT_TIMEOUT).expect("index event");
}

#[test]
fn reports_a_ref_only_change() {
    let repo = ready_repository();
    let (_watcher, events) = watched(&repo);

    repo.git(&["branch", "topic"]);

    events.recv_timeout(EVENT_TIMEOUT).expect("ref event");
}

#[test]
fn reports_a_head_only_change() {
    let repo = ready_repository();
    repo.git(&["branch", "topic"]);
    let (_watcher, events) = watched(&repo);

    repo.git(&["symbolic-ref", "HEAD", "refs/heads/topic"]);

    events.recv_timeout(EVENT_TIMEOUT).expect("HEAD event");
}

#[test]
fn stops_reporting_after_the_watcher_is_dropped() {
    let repo = ready_repository();
    let (watcher, events) = watched(&repo);
    drop(watcher);

    repo.write("a.txt", "2\n");

    assert!(events.recv_timeout(QUIET_CHECK).is_err());
}
