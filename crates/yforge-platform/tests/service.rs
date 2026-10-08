mod common;

use std::sync::Arc;

use common::{HttpFake, Reply, Repo};
use serde_json::json;
use yforge_ai::{MemoryStore, SecretStore};
use yforge_core::{
    platform_connection_add, platform_connections_list, CoreError, ErrorKind, PlatformKind, PrState,
};
use yforge_platform::{NewConnection, PlatformError, PlatformService, PrFilter};

struct Harness {
    data: tempfile::TempDir,
    secrets: Arc<MemoryStore>,
    service: PlatformService,
}

fn harness() -> Harness {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    let secrets = Arc::new(MemoryStore::default());
    Harness {
        data,
        service: PlatformService::new(secrets.clone()),
        secrets,
    }
}

fn input(host: &str) -> NewConnection {
    NewConnection {
        kind: PlatformKind::GitLab,
        host: host.to_owned(),
        name: "Work".to_owned(),
        token: "tok-secret".to_owned(),
        insecure_tls: false,
    }
}

fn kind_of(error: PlatformError) -> ErrorKind {
    CoreError::from(error).kind()
}

#[tokio::test]
async fn pull_checks_are_cached_and_without_a_connection_make_no_request() {
    let h = harness();
    let fake =
        HttpFake::start(|_| Reply::ok(r#"{"state":"opened","head_pipeline":{"status":"failed"}}"#));
    let repo = Repo::new();
    repo.remote("origin", &format!("http://{}/owner/widget.git", fake.host));
    let matched = h.service.match_repo(h.data.path(), &repo.path).unwrap();
    assert_eq!(
        h.service.pr_checks(matched.as_ref(), 7).await.unwrap(),
        None
    );
    assert!(fake.requests().is_empty());
    let connection = platform_connection_add(
        h.data.path(),
        PlatformKind::GitLab,
        &fake.host,
        "Work",
        false,
    )
    .unwrap();
    h.secrets
        .set(&format!("platform.{}", connection.id), "tok-secret")
        .unwrap();
    let matched = h.service.match_repo(h.data.path(), &repo.path).unwrap();
    let first = h.service.pr_checks(matched.as_ref(), 7).await.unwrap();
    let second = h.service.pr_checks(matched.as_ref(), 7).await.unwrap();
    assert_eq!(first, second);
    assert_eq!(first.unwrap().failing, 1);
    assert_eq!(fake.requests().len(), 1);
}

#[test]
fn the_first_remote_that_matches_a_connection_wins() {
    let h = harness();
    platform_connection_add(
        h.data.path(),
        PlatformKind::GitLab,
        "gitlab.example.com",
        "Lab",
        false,
    )
    .unwrap();
    let hub = platform_connection_add(
        h.data.path(),
        PlatformKind::GitHub,
        "github.com",
        "Hub",
        false,
    )
    .unwrap();
    let repo = Repo::new();
    repo.remote("backup", "/srv/git/widget.git");
    repo.remote("origin", "git@GitHub.com:owner/widget.git");
    repo.remote("mirror", "https://gitlab.example.com/other/thing.git");

    let matched = h
        .service
        .match_repo(h.data.path(), &repo.path)
        .unwrap()
        .unwrap();

    assert_eq!(matched.remote, "mirror");
    assert_eq!(matched.repo.owner, "other");
    assert_ne!(matched.connection.id, hub.id);
}

#[test]
fn remote_order_follows_git_remote_and_matches_by_host_case_insensitively() {
    let h = harness();
    let hub = platform_connection_add(
        h.data.path(),
        PlatformKind::GitHub,
        "github.com",
        "Hub",
        false,
    )
    .unwrap();
    let repo = Repo::new();
    repo.remote("origin", "git@GitHub.com:owner/widget.git");
    repo.remote("backup", "https://github.com/owner/backup.git");

    let matched = h
        .service
        .match_repo(h.data.path(), &repo.path)
        .unwrap()
        .unwrap();

    assert_eq!(matched.connection, hub);
    assert_eq!(matched.remote, "backup");
    assert_eq!(
        (matched.repo.owner.as_str(), matched.repo.repo.as_str()),
        ("owner", "backup")
    );
}

#[test]
fn no_matching_remote_is_none_not_an_error() {
    let h = harness();
    platform_connection_add(
        h.data.path(),
        PlatformKind::GitHub,
        "github.com",
        "Hub",
        false,
    )
    .unwrap();
    let repo = Repo::new();
    repo.remote("origin", "https://example.org/owner/widget.git");
    repo.remote("local", "/srv/git/widget.git");

    assert_eq!(
        h.service.match_repo(h.data.path(), &repo.path).unwrap(),
        None
    );
    assert_eq!(
        kind_of(
            h.service
                .require_repo(h.data.path(), &repo.path)
                .unwrap_err()
        ),
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn adding_a_connection_stores_the_row_and_the_token_after_a_successful_test() {
    let h = harness();
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));

    let added = h
        .service
        .add(h.data.path(), input(&fake.host))
        .await
        .unwrap();

    assert_eq!(added.host, fake.host);
    assert_eq!(
        h.service.list(h.data.path()).unwrap(),
        std::slice::from_ref(&added)
    );
    let account = format!("platform.{}", added.id);
    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&account));
    assert_eq!(
        h.secrets.get(&account).unwrap().as_deref(),
        Some("tok-secret")
    );
    assert_eq!(
        fake.requests()[0].header("authorization"),
        Some("Bearer tok-secret")
    );
    assert_eq!(
        h.service.test(h.data.path(), &added.id).await.unwrap(),
        "yui"
    );
}

#[tokio::test]
async fn a_failed_token_test_rolls_back_the_row_and_the_keychain_entry() {
    let h = harness();
    let fake = HttpFake::start(|_| Reply::status(401, r#"{"message":"Bad credentials"}"#));

    let error = h
        .service
        .add(h.data.path(), input(&fake.host))
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AuthFailed);
    assert!(platform_connections_list(h.data.path()).unwrap().is_empty());
    assert!(h.secrets.accounts().is_empty());
}

#[tokio::test]
async fn invalid_input_is_refused_before_anything_is_stored() {
    let h = harness();
    let cases = [
        NewConnection {
            host: "https://github.com".into(),
            ..input("x")
        },
        NewConnection {
            host: "github.com/owner".into(),
            ..input("x")
        },
        NewConnection {
            host: " ".into(),
            ..input("x")
        },
        NewConnection {
            host: "host:notaport".into(),
            ..input("x")
        },
        NewConnection {
            name: "  ".into(),
            ..input("github.com")
        },
        NewConnection {
            name: "n".repeat(81),
            ..input("github.com")
        },
        NewConnection {
            token: "  ".into(),
            ..input("github.com")
        },
    ];

    for case in cases {
        let error = h
            .service
            .add(h.data.path(), case.clone())
            .await
            .unwrap_err();
        assert_eq!(kind_of(error), ErrorKind::InvalidRequest, "{case:?}");
    }

    assert!(platform_connections_list(h.data.path()).unwrap().is_empty());
    assert!(h.secrets.accounts().is_empty());
}

#[tokio::test]
async fn removing_a_connection_deletes_the_row_and_the_token() {
    let h = harness();
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));
    let added = h
        .service
        .add(h.data.path(), input(&fake.host))
        .await
        .unwrap();

    h.service.remove(h.data.path(), &added.id).unwrap();

    assert!(h.service.list(h.data.path()).unwrap().is_empty());
    assert!(h.secrets.accounts().is_empty());
    assert_eq!(
        kind_of(h.service.remove(h.data.path(), &added.id).unwrap_err()),
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn a_connection_without_a_stored_token_reports_auth_failed() {
    let h = harness();
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));
    let added = h
        .service
        .add(h.data.path(), input(&fake.host))
        .await
        .unwrap();
    h.secrets.delete(&format!("platform.{}", added.id)).unwrap();

    let error = h.service.test(h.data.path(), &added.id).await.unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AuthFailed);
}

#[tokio::test]
async fn pull_requests_are_listed_through_the_connection_matched_by_the_remote() {
    let h = harness();
    let fake = HttpFake::start(|request| {
        if request.path.ends_with("/user") {
            Reply::ok(r#"{"username":"yui"}"#)
        } else {
            Reply::ok(
                &json!([{
                    "iid": 3, "title": "Add thing", "description": "", "state": "opened",
                    "source_branch": "feature", "target_branch": "main",
                    "author": {"username": "yui"}, "created_at": "2026-09-01T10:00:00Z",
                    "updated_at": "2026-09-02T10:00:00Z", "merge_status": "can_merge",
                    "web_url": "https://x/3"
                }])
                .to_string(),
            )
        }
    });
    h.service
        .add(h.data.path(), input(&fake.host))
        .await
        .unwrap();
    let repo = Repo::new();
    repo.remote("origin", &format!("http://{}/owner/widget.git", fake.host));
    let matched = h.service.require_repo(h.data.path(), &repo.path).unwrap();

    let pulls = h
        .service
        .prs_list(&matched, PrFilter::Open)
        .await
        .unwrap()
        .pulls;

    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0].state, PrState::Open);
    let last = fake.requests().pop().unwrap();
    assert_eq!(
        last.path,
        "/api/v4/projects/owner%2Fwidget/merge_requests?state=opened&per_page=100&page=1"
    );
}

#[tokio::test]
async fn my_pulls_come_back_with_the_recent_repository_whose_remote_matches() {
    let h = harness();
    let fake = HttpFake::start(|request| {
        let path = request.path.as_str();
        if path == "/api/v4/user" {
            Reply::ok(r#"{"username":"yui"}"#)
        } else if path.contains("scope=created_by_me") {
            Reply::ok(
                &json!([
                    {"iid": 3, "title": "Local", "description": "", "state": "opened",
                     "source_branch": "f", "target_branch": "main", "author": {"username": "yui"},
                     "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-02T10:00:00Z",
                     "merge_status": "can_be_merged", "web_url": "https://x.example/owner/widget/-/merge_requests/3"},
                    {"iid": 4, "title": "Remote only", "description": "", "state": "opened",
                     "source_branch": "g", "target_branch": "main", "author": {"username": "yui"},
                     "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-01T10:00:00Z",
                     "merge_status": "can_be_merged", "web_url": "https://x.example/owner/elsewhere/-/merge_requests/4"}
                ])
                .to_string(),
            )
        } else {
            Reply::ok("[]")
        }
    });
    let connection = platform_connection_add(
        h.data.path(),
        PlatformKind::GitLab,
        &fake.host,
        "Lab",
        false,
    )
    .unwrap();
    let repo = Repo::new();
    repo.remote("origin", &format!("https://{}/Owner/Widget.git", fake.host));
    yforge_core::add_recent(h.data.path(), &repo.path.display().to_string()).unwrap();
    h.secrets
        .set(&format!("platform.{}", connection.id), "tok")
        .unwrap();

    let pulls = h
        .service
        .my_pulls(h.data.path(), &connection.id)
        .await
        .unwrap();
    let located = h
        .service
        .locate_pulls(h.data.path(), &connection.id, pulls)
        .unwrap();

    let paths: Vec<(i64, Option<String>)> = located
        .pulls
        .iter()
        .map(|pull| (pull.pull.number, pull.local_path.clone()))
        .collect();
    assert_eq!(
        paths,
        [(3, Some(repo.path.display().to_string())), (4, None)]
    );
    assert_eq!(
        kind_of(
            h.service
                .my_pulls(h.data.path(), "missing")
                .await
                .unwrap_err()
        ),
        ErrorKind::InvalidRequest
    );
}
