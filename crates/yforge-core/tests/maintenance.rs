mod common;

use common::Fixture;
use yforge_core::{maintenance_run, CancelToken, ErrorKind};

fn repository() -> Fixture {
    let repo = Fixture::init();
    repo.identity();
    for number in 1..=5 {
        repo.commit("a.txt", &format!("{number}\n"), &format!("Commit {number}"));
    }
    repo
}

fn loose_objects(repo: &Fixture) -> u32 {
    repo.git(&["count-objects", "-v"])
        .lines()
        .find_map(|line| line.strip_prefix("count: "))
        .and_then(|count| count.parse().ok())
        .expect("count-objects reports count")
}

#[test]
fn maintenance_packs_loose_objects_writes_the_commit_graph_and_reports_progress() {
    let repo = repository();
    assert!(loose_objects(&repo) > 0);
    let mut phases = Vec::new();

    maintenance_run(&repo.path, &CancelToken::new(), &mut |progress| {
        phases.push(progress.phase)
    })
    .unwrap();

    assert_eq!(loose_objects(&repo), 0);
    assert!(
        repo.path.join(".git/objects/info/commit-graph").exists()
            || repo.path.join(".git/objects/info/commit-graphs").exists()
    );
    assert_eq!(
        phases.first().map(String::as_str),
        Some("Running repository maintenance")
    );
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "5");
    assert_eq!(repo.git(&["fsck", "--no-progress"]), "");
}

#[test]
fn a_cancelled_maintenance_run_reports_cancellation() {
    let repo = repository();
    let token = CancelToken::new();
    token.cancel();

    let error = maintenance_run(&repo.path, &token, &mut |_| {}).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled);
}

#[test]
fn maintenance_outside_a_repository_is_refused() {
    let directory = tempfile::tempdir().unwrap();

    let error = maintenance_run(directory.path(), &CancelToken::new(), &mut |_| {}).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::NotARepository);
}
