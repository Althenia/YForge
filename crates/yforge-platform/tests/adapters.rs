mod common;

use common::{HttpFake, Recorded, Reply};
use serde_json::{json, Value};
use yforge_core::{CoreError, CreatePull, ErrorKind, PlatformKind, PrState, RepoRef};
use yforge_platform::{Client, PlatformError, PrFilter};

fn repo() -> RepoRef {
    RepoRef {
        owner: "acme".to_owned(),
        repo: "widget".to_owned(),
    }
}

fn input() -> CreatePull {
    CreatePull {
        source_ref: "feature".to_owned(),
        target_ref: "main".to_owned(),
        title: "Add thing".to_owned(),
        body: "Because.".to_owned(),
    }
}

fn client(fake: &HttpFake, kind: PlatformKind) -> Client {
    Client::new(&fake.connection(kind), "tok-secret").unwrap()
}

fn json_of(request: &Recorded) -> Value {
    serde_json::from_str(&request.body).unwrap()
}

fn kind_of(error: PlatformError) -> ErrorKind {
    CoreError::from(error).kind()
}

fn assert_call(request: &Recorded, method: &str, path: &str) {
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        (method, path)
    );
    assert_eq!(request.header("authorization"), Some("Bearer tok-secret"));
}

fn github_pull(state: &str, merged_at: Value, mergeable: Value) -> Value {
    json!({
        "number": 7, "title": "Add thing", "body": null, "state": state,
        "merged_at": merged_at, "head": {"ref": "feature"}, "base": {"ref": "main"},
        "user": {"login": "yui"}, "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-02T10:00:00Z", "mergeable": mergeable,
        "html_url": "https://github.example/acme/widget/pull/7"
    })
}

fn gitlab_request(state: &str, merge_status: &str) -> Value {
    json!({
        "iid": 3, "title": "Add thing", "description": "Because.", "state": state,
        "source_branch": "feature", "target_branch": "main",
        "author": {"username": "yui"}, "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-02T10:00:00Z", "merge_status": merge_status,
        "web_url": "https://gitlab.example/acme/widget/-/merge_requests/3"
    })
}

fn data_center_pull(state: &str) -> Value {
    json!({
        "id": 5, "version": 2, "title": "Add thing", "description": "Because.", "state": state,
        "fromRef": {"id": "refs/heads/feature", "displayId": "feature"},
        "toRef": {"id": "refs/heads/main", "displayId": "main"},
        "author": {"user": {"name": "yui"}, "role": "AUTHOR"},
        "createdDate": 1788256800000_i64, "updatedDate": 1788343200000_i64,
        "links": {"self": [{"href": "https://bitbucket.example/projects/ACME/repos/widget/pull-requests/5"}]}
    })
}

#[tokio::test]
async fn github_verify_reads_the_login_with_bearer_and_accept_headers() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"login":"yui"}"#));

    let login = client(&fake, PlatformKind::GitHub).verify().await.unwrap();

    assert_eq!(login, "yui");
    let request = &fake.requests()[0];
    assert_call(request, "GET", "/api/v3/user");
    assert_eq!(
        request.header("accept"),
        Some("application/vnd.github+json")
    );
}

#[tokio::test]
async fn github_list_maps_state_authors_and_merged_pulls() {
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!([
                github_pull("open", Value::Null, Value::Null),
                github_pull("closed", json!("2026-09-03T10:00:00Z"), json!(false)),
                github_pull("closed", Value::Null, json!(false)),
            ])
            .to_string(),
        )
    });

    let pulls = client(&fake, PlatformKind::GitHub)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap();

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v3/repos/acme/widget/pulls?state=open&per_page=100",
    );
    let states: Vec<PrState> = pulls.iter().map(|pull| pull.state).collect();
    assert_eq!(states, [PrState::Open, PrState::Merged, PrState::Closed]);
    let first = &pulls[0];
    assert_eq!(
        (first.number, first.title.as_str(), first.body.as_str()),
        (7, "Add thing", "")
    );
    assert_eq!(
        (first.source_ref.as_str(), first.target_ref.as_str()),
        ("feature", "main")
    );
    assert_eq!(first.author, "yui");
    assert_eq!(first.mergeable, None);
    assert_eq!(first.web_url, "https://github.example/acme/widget/pull/7");
    assert_eq!(first.created_at, "2026-09-01T10:00:00Z");
}

#[tokio::test]
async fn github_all_lists_every_state() {
    let fake = HttpFake::start(|_| Reply::ok("[]"));

    client(&fake, PlatformKind::GitHub)
        .list(&repo(), PrFilter::All)
        .await
        .unwrap();

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v3/repos/acme/widget/pulls?state=all&per_page=100",
    );
}

#[tokio::test]
async fn github_detail_joins_the_pull_and_its_files() {
    let fake = HttpFake::start(|request| {
        if request.path.contains("/files") {
            Reply::ok(
                &json!([
                    {"filename": "a.rs", "status": "added", "additions": 5, "deletions": 0},
                    {"filename": "b.rs", "status": "changed", "additions": 1, "deletions": 2}
                ])
                .to_string(),
            )
        } else {
            Reply::ok(&github_pull("open", Value::Null, json!(true)).to_string())
        }
    });

    let detail = client(&fake, PlatformKind::GitHub)
        .detail(&repo(), 7)
        .await
        .unwrap();

    let requests = fake.requests();
    assert_call(&requests[0], "GET", "/api/v3/repos/acme/widget/pulls/7");
    assert_call(
        &requests[1],
        "GET",
        "/api/v3/repos/acme/widget/pulls/7/files?per_page=100",
    );
    assert_eq!(detail.pull.mergeable, Some(true));
    let files: Vec<(&str, &str, i64, i64)> = detail
        .files
        .iter()
        .map(|file| {
            (
                file.filename.as_str(),
                file.status.as_str(),
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(files, [("a.rs", "added", 5, 0), ("b.rs", "modified", 1, 2)]);
}

#[tokio::test]
async fn github_create_posts_head_base_title_and_body() {
    let fake = HttpFake::start(|_| {
        Reply::status(
            201,
            &github_pull("open", Value::Null, Value::Null).to_string(),
        )
    });

    let created = client(&fake, PlatformKind::GitHub)
        .create(&repo(), &input())
        .await
        .unwrap();

    let request = &fake.requests()[0];
    assert_call(request, "POST", "/api/v3/repos/acme/widget/pulls");
    assert_eq!(
        json_of(request),
        json!({"title": "Add thing", "head": "feature", "base": "main", "body": "Because."})
    );
    assert_eq!(created.number, 7);
}

#[tokio::test]
async fn github_merge_puts_then_returns_the_refreshed_pull() {
    let fake = HttpFake::start(|request| {
        if request.method == "PUT" {
            Reply::ok(r#"{"merged":true,"sha":"abc","message":"ok"}"#)
        } else {
            Reply::ok(
                &github_pull("closed", json!("2026-09-03T10:00:00Z"), Value::Null).to_string(),
            )
        }
    });

    let merged = client(&fake, PlatformKind::GitHub)
        .merge(&repo(), 7)
        .await
        .unwrap();

    let requests = fake.requests();
    assert_call(
        &requests[0],
        "PUT",
        "/api/v3/repos/acme/widget/pulls/7/merge",
    );
    assert_call(&requests[1], "GET", "/api/v3/repos/acme/widget/pulls/7");
    assert_eq!(merged.state, PrState::Merged);
}

#[tokio::test]
async fn gitlab_verify_reads_the_username() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));

    let login = client(&fake, PlatformKind::GitLab).verify().await.unwrap();

    assert_eq!(login, "yui");
    let request = &fake.requests()[0];
    assert_call(request, "GET", "/api/v4/user");
    assert_eq!(request.header("accept"), Some("application/json"));
}

#[tokio::test]
async fn gitlab_list_encodes_the_project_and_maps_state_and_mergeability() {
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!([
                gitlab_request("opened", "can_merge"),
                gitlab_request("merged", "can_be_merged"),
                gitlab_request("closed", "cannot_be_merged"),
            ])
            .to_string(),
        )
    });

    let pulls = client(&fake, PlatformKind::GitLab)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap();

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v4/projects/acme%2Fwidget/merge_requests?state=opened&per_page=100",
    );
    let states: Vec<PrState> = pulls.iter().map(|pull| pull.state).collect();
    assert_eq!(states, [PrState::Open, PrState::Merged, PrState::Closed]);
    let mergeable: Vec<Option<bool>> = pulls.iter().map(|pull| pull.mergeable).collect();
    assert_eq!(mergeable, [Some(true), None, Some(false)]);
    let first = &pulls[0];
    assert_eq!((first.number, first.author.as_str()), (3, "yui"));
    assert_eq!(first.body, "Because.");
    assert_eq!(
        first.web_url,
        "https://gitlab.example/acme/widget/-/merge_requests/3"
    );
}

#[tokio::test]
async fn gitlab_detail_takes_files_from_the_changes_array() {
    let fake = HttpFake::start(|_| {
        let mut request = gitlab_request("opened", "can_merge");
        request["changes"] = json!([
            {"new_path": "a.rs", "new_file": true, "renamed_file": false, "deleted_file": false,
             "diff": "@@ -0,0 +1,2 @@\n+one\n+two\n"},
            {"new_path": "b.rs", "new_file": false, "renamed_file": false, "deleted_file": true,
             "diff": "@@ -1,2 +0,0 @@\n-one\n--two\n"},
            {"new_path": "c.rs", "new_file": false, "renamed_file": true, "deleted_file": false,
             "diff": ""},
            {"new_path": "d.rs", "new_file": false, "renamed_file": false, "deleted_file": false,
             "diff": "@@ -1 +1 @@\n-old\n+new\n context\n"}
        ]);
        Reply::ok(&request.to_string())
    });

    let detail = client(&fake, PlatformKind::GitLab)
        .detail(&repo(), 3)
        .await
        .unwrap();

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v4/projects/acme%2Fwidget/merge_requests/3",
    );
    let files: Vec<(&str, &str, i64, i64)> = detail
        .files
        .iter()
        .map(|file| {
            (
                file.filename.as_str(),
                file.status.as_str(),
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(
        files,
        [
            ("a.rs", "added", 2, 0),
            ("b.rs", "removed", 0, 2),
            ("c.rs", "renamed", 0, 0),
            ("d.rs", "modified", 1, 1),
        ]
    );
}

#[tokio::test]
async fn gitlab_detail_without_changes_has_no_files() {
    let fake = HttpFake::start(|_| Reply::ok(&gitlab_request("opened", "can_merge").to_string()));

    let detail = client(&fake, PlatformKind::GitLab)
        .detail(&repo(), 3)
        .await
        .unwrap();

    assert!(detail.files.is_empty());
    assert_eq!(detail.pull.number, 3);
}

#[tokio::test]
async fn gitlab_create_and_merge_use_merge_request_endpoints() {
    let fake = HttpFake::start(|request| {
        Reply::ok(
            &gitlab_request(
                if request.method == "PUT" {
                    "merged"
                } else {
                    "opened"
                },
                "can_merge",
            )
            .to_string(),
        )
    });
    let gitlab = client(&fake, PlatformKind::GitLab);

    let created = gitlab.create(&repo(), &input()).await.unwrap();
    let merged = gitlab.merge(&repo(), 3).await.unwrap();

    let requests = fake.requests();
    assert_call(
        &requests[0],
        "POST",
        "/api/v4/projects/acme%2Fwidget/merge_requests",
    );
    assert_eq!(
        json_of(&requests[0]),
        json!({"source_branch": "feature", "target_branch": "main",
               "title": "Add thing", "description": "Because."})
    );
    assert_call(
        &requests[1],
        "PUT",
        "/api/v4/projects/acme%2Fwidget/merge_requests/3/merge",
    );
    assert_eq!(
        (created.state, merged.state),
        (PrState::Open, PrState::Merged)
    );
}

const DC_PULLS: &str = "/rest/api/1.0/projects/acme/repos/widget/pull-requests";

#[tokio::test]
async fn data_center_verify_reads_the_username_from_the_response_header() {
    let fake =
        HttpFake::start(|_| Reply::ok(r#"{"version":"9.4.0"}"#).header("X-AUSERNAME", "yui"));

    let login = client(&fake, PlatformKind::Bitbucket)
        .verify()
        .await
        .unwrap();

    assert_eq!(login, "yui");
    assert_call(
        &fake.requests()[0],
        "GET",
        "/rest/api/1.0/application-properties",
    );
}

#[tokio::test]
async fn data_center_verify_without_an_authenticated_user_is_auth_failed() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"version":"9.4.0"}"#));

    let error = client(&fake, PlatformKind::Bitbucket)
        .verify()
        .await
        .unwrap_err();

    let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
    assert_eq!(payload.kind, ErrorKind::AuthFailed);
    assert_eq!(
        payload.message,
        format!("Authentication failed for {}", fake.host)
    );
}

#[tokio::test]
async fn data_center_list_maps_states_authors_refs_and_timestamps() {
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!({"values": [
                data_center_pull("OPEN"), data_center_pull("MERGED"), data_center_pull("DECLINED")
            ]})
            .to_string(),
        )
    });
    let bitbucket = client(&fake, PlatformKind::Bitbucket);

    let pulls = bitbucket.list(&repo(), PrFilter::Open).await.unwrap();
    bitbucket.list(&repo(), PrFilter::All).await.unwrap();

    let requests = fake.requests();
    assert_call(
        &requests[0],
        "GET",
        &format!("{DC_PULLS}?state=OPEN&limit=100"),
    );
    assert_call(
        &requests[1],
        "GET",
        &format!("{DC_PULLS}?state=ALL&limit=100"),
    );
    let states: Vec<PrState> = pulls.iter().map(|pull| pull.state).collect();
    assert_eq!(states, [PrState::Open, PrState::Merged, PrState::Closed]);
    let mergeable: Vec<Option<bool>> = pulls.iter().map(|pull| pull.mergeable).collect();
    assert_eq!(mergeable, [Some(true), Some(false), Some(false)]);
    let first = &pulls[0];
    assert_eq!(
        (first.number, first.title.as_str(), first.body.as_str()),
        (5, "Add thing", "Because.")
    );
    assert_eq!(first.author, "yui");
    assert_eq!(
        (first.source_ref.as_str(), first.target_ref.as_str()),
        ("feature", "main")
    );
    assert_eq!(first.created_at, "2026-09-01T10:00:00Z");
    assert_eq!(first.updated_at, "2026-09-02T10:00:00Z");
    assert_eq!(
        first.web_url,
        "https://bitbucket.example/projects/ACME/repos/widget/pull-requests/5"
    );
}

#[tokio::test]
async fn data_center_detail_joins_the_pull_and_counts_lines_per_file_from_the_diff() {
    let fake = HttpFake::start(|request| {
        if request.path.ends_with("/diff") {
            Reply::ok(
                &json!({"diffs": [
                    {"source": null, "destination": {"components": ["src", "a.rs"]},
                     "hunks": [{"segments": [
                        {"type": "ADDED", "lines": [{}, {}, {}, {}]}
                     ]}]},
                    {"source": {"components": ["b.rs"]}, "destination": null,
                     "hunks": [{"segments": [
                        {"type": "REMOVED", "lines": [{}, {}, {}]}
                     ]}]},
                    {"source": {"components": ["c.rs"]}, "destination": {"components": ["c.rs"]},
                     "hunks": [{"segments": [
                        {"type": "CONTEXT", "lines": [{}, {}]},
                        {"type": "REMOVED", "lines": [{}]},
                        {"type": "ADDED", "lines": [{}, {}]}
                     ]}]},
                    {"source": {"components": ["old.rs"]}, "destination": {"components": ["new.rs"]},
                     "hunks": []},
                    {"source": {"components": ["logo.png"]}, "destination": {"components": ["logo.png"]}}
                ]})
                .to_string(),
            )
        } else {
            Reply::ok(&data_center_pull("OPEN").to_string())
        }
    });

    let detail = client(&fake, PlatformKind::Bitbucket)
        .detail(&repo(), 5)
        .await
        .unwrap();

    let requests = fake.requests();
    assert_call(&requests[0], "GET", &format!("{DC_PULLS}/5"));
    assert_call(&requests[1], "GET", &format!("{DC_PULLS}/5/diff"));
    assert_eq!(detail.pull.number, 5);
    let files: Vec<(&str, &str, i64, i64)> = detail
        .files
        .iter()
        .map(|file| {
            (
                file.filename.as_str(),
                file.status.as_str(),
                file.additions,
                file.deletions,
            )
        })
        .collect();
    assert_eq!(
        files,
        [
            ("src/a.rs", "added", 4, 0),
            ("b.rs", "removed", 0, 3),
            ("c.rs", "modified", 2, 1),
            ("new.rs", "renamed", 0, 0),
            ("logo.png", "modified", 0, 0)
        ]
    );
}

#[tokio::test]
async fn data_center_create_posts_full_refs_with_the_repository() {
    let fake = HttpFake::start(|_| Reply::status(201, &data_center_pull("OPEN").to_string()));

    let created = client(&fake, PlatformKind::Bitbucket)
        .create(&repo(), &input())
        .await
        .unwrap();

    let requests = fake.requests();
    assert_call(&requests[0], "POST", DC_PULLS);
    let repository = json!({"slug": "widget", "project": {"key": "acme"}});
    assert_eq!(
        json_of(&requests[0]),
        json!({"title": "Add thing", "description": "Because.",
               "fromRef": {"id": "refs/heads/feature", "repository": repository},
               "toRef": {"id": "refs/heads/main", "repository": repository}})
    );
    assert_eq!((created.number, created.state), (5, PrState::Open));
}

#[tokio::test]
async fn data_center_merge_reads_the_version_then_posts_it() {
    let fake = HttpFake::start(|request| {
        Reply::ok(
            &data_center_pull(if request.method == "POST" {
                "MERGED"
            } else {
                "OPEN"
            })
            .to_string(),
        )
    });

    let merged = client(&fake, PlatformKind::Bitbucket)
        .merge(&repo(), 5)
        .await
        .unwrap();

    let requests = fake.requests();
    assert_call(&requests[0], "GET", &format!("{DC_PULLS}/5"));
    assert_call(
        &requests[1],
        "POST",
        &format!("{DC_PULLS}/5/merge?version=2"),
    );
    assert_eq!(merged.state, PrState::Merged);
}

#[tokio::test]
async fn data_center_unauthorized_and_missing_pull_map_to_their_error_kinds() {
    let rejected =
        HttpFake::start(|_| Reply::status(401, r#"{"errors":[{"message":"Bad token"}]}"#));
    let error = client(&rejected, PlatformKind::Bitbucket)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap_err();
    let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
    assert_eq!(payload.kind, ErrorKind::AuthFailed);
    assert_eq!(payload.output.as_deref(), Some("Bad token"));

    let missing = HttpFake::start(|_| Reply::status(404, r#"{"errors":[]}"#));
    let error = client(&missing, PlatformKind::Bitbucket)
        .detail(&repo(), 9)
        .await
        .unwrap_err();
    let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
    assert_eq!(payload.kind, ErrorKind::NotFound);
    assert_eq!(
        payload.message,
        "No pull request #9 found in acme/widget on Bitbucket"
    );
}

#[tokio::test]
async fn unauthorized_and_forbidden_map_to_auth_failed_naming_the_host_without_the_token() {
    for status in [401, 403] {
        let fake = HttpFake::start(move |_| {
            Reply::status(status, r#"{"message":"Bad credentials tok-secret"}"#)
        });

        let error = client(&fake, PlatformKind::GitHub)
            .list(&repo(), PrFilter::Open)
            .await
            .unwrap_err();

        let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
        assert_eq!(payload.kind, ErrorKind::AuthFailed);
        assert_eq!(
            payload.message,
            format!("Authentication failed for {}", fake.host)
        );
        assert_eq!(
            payload.output.as_deref(),
            Some("Bad credentials <redacted>")
        );
    }
}

#[tokio::test]
async fn not_found_names_the_platform_and_repository() {
    for (kind, label) in [
        (PlatformKind::GitHub, "GitHub"),
        (PlatformKind::GitLab, "GitLab"),
        (PlatformKind::Bitbucket, "Bitbucket"),
    ] {
        let fake = HttpFake::start(|_| Reply::status(404, r#"{"message":"Not Found"}"#));

        let error = client(&fake, kind)
            .list(&repo(), PrFilter::Open)
            .await
            .unwrap_err();

        let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
        assert_eq!(payload.kind, ErrorKind::NotFound);
        assert_eq!(
            payload.message,
            format!("No {label} repository found for acme/widget")
        );
    }
}

#[tokio::test]
async fn other_failures_are_api_errors_with_status_and_platform_message() {
    let fake = HttpFake::start(|_| Reply::status(422, r#"{"message":"Validation Failed"}"#));

    let error = client(&fake, PlatformKind::GitHub)
        .create(&repo(), &input())
        .await
        .unwrap_err();

    let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
    assert_eq!(payload.kind, ErrorKind::ApiError);
    assert_eq!(
        payload.message,
        format!("{} answered with HTTP 422: Validation Failed", fake.host)
    );
}

#[tokio::test]
async fn an_unreachable_host_is_a_network_error_naming_the_host() {
    let fake = HttpFake::start(|_| Reply::ok("{}"));
    let connection = fake.connection(PlatformKind::GitLab);
    drop(fake);

    let error = Client::new(&connection, "t")
        .unwrap()
        .verify()
        .await
        .unwrap_err();

    let payload = yforge_core::ErrorPayload::from(CoreError::from(error));
    assert_eq!(payload.kind, ErrorKind::Network);
    assert!(payload.message.contains(&connection.host));
}

#[tokio::test]
async fn a_malformed_success_body_is_an_api_error_not_a_panic() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"unexpected":true}"#));

    let error = client(&fake, PlatformKind::GitHub)
        .verify()
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::ApiError);
}
