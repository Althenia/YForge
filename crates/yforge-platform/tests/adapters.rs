mod common;

use common::{HttpFake, Recorded, Reply};
use serde_json::{json, Value};
use yforge_core::{CoreError, CreatePull, ErrorKind, PlatformKind, PrState, RepoRef};
use yforge_platform::{Client, PlatformError, PrFilter};

fn repo() -> RepoRef {
    RepoRef {
        owner: "owner".to_owned(),
        repo: "widget".to_owned(),
    }
}

fn input() -> CreatePull {
    CreatePull {
        draft: false,
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
        "html_url": "https://github.example/owner/widget/pull/7"
    })
}

#[tokio::test]
async fn github_and_gitlab_surface_drafts_and_send_draft_creation() {
    for kind in [PlatformKind::GitHub, PlatformKind::GitLab] {
        let fake = HttpFake::start(move |_| {
            let mut pull = match kind {
                PlatformKind::GitHub => github_pull("open", Value::Null, Value::Null),
                _ => gitlab_request("opened", "unchecked"),
            };
            pull["draft"] = json!(true);
            Reply::ok(&pull.to_string())
        });
        let mut draft = input();
        draft.draft = true;
        let pull = client(&fake, kind).create(&repo(), &draft).await.unwrap();
        assert!(pull.draft);
        let body = json_of(&fake.requests()[0]);
        if kind == PlatformKind::GitHub {
            assert_eq!(body["draft"], true);
        } else {
            assert_eq!(body["title"], "Draft: Add thing");
        }
    }
}

#[tokio::test]
async fn old_bitbucket_data_center_refuses_drafts_before_posting() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"version":"8.17.0"}"#));
    let mut draft = input();
    draft.draft = true;
    let failure = client(&fake, PlatformKind::Bitbucket)
        .create(&repo(), &draft)
        .await
        .unwrap_err();
    assert_eq!(kind_of(failure), ErrorKind::Unsupported);
    assert_eq!(fake.requests().len(), 1);
    assert_eq!(fake.requests()[0].method, "GET");
}

#[tokio::test]
async fn github_checks_combine_check_runs_and_commit_statuses_without_listing_files() {
    let fake = HttpFake::start(|request| {
        let response = if request.path.contains("/check-runs") {
            json!({"total_count":3,"check_runs":[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"failure"},{"status":"in_progress","conclusion":null}]})
        } else if request.path.contains("/status?") {
            json!({"total_count":1,"statuses":[{"state":"success"}]})
        } else {
            let mut pull = github_pull("open", Value::Null, Value::Null);
            pull["head"]["sha"] = json!("abcdef1234");
            pull
        };
        Reply::ok(&response.to_string())
    });
    let summary = client(&fake, PlatformKind::GitHub)
        .checks(&repo(), 7)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (
            summary.passing,
            summary.failing,
            summary.pending,
            summary.capped
        ),
        (2, 1, 1, false)
    );
    assert_eq!(fake.requests().len(), 3);
    assert!(fake
        .requests()
        .iter()
        .all(|request| !request.path.contains("/files")));
}

#[tokio::test]
async fn data_center_drafts_use_supported_versions_and_checks_use_head_build_stats() {
    let fake = HttpFake::start(|request| {
        let response = if request.path.ends_with("application-properties") {
            json!({"version":"8.18.0"})
        } else if request.path.contains("/build-status/") {
            json!({"successful":2,"failed":1,"inProgress":3})
        } else {
            let mut pull = data_center_pull("OPEN");
            pull["draft"] = json!(true);
            pull["fromRef"]["latestCommit"] = json!("abcdef1234");
            pull
        };
        Reply::ok(&response.to_string())
    });
    let api = client(&fake, PlatformKind::Bitbucket);
    let mut draft = input();
    draft.draft = true;
    assert!(api.create(&repo(), &draft).await.unwrap().draft);
    assert_eq!(json_of(&fake.requests()[1])["draft"], true);
    let checks = api.checks(&repo(), 5).await.unwrap().unwrap();
    assert_eq!((checks.passing, checks.failing, checks.pending), (2, 1, 3));
    assert_eq!(
        fake.requests()[3].path,
        "/rest/build-status/1.0/commits/stats/abcdef1234"
    );
}

#[tokio::test]
async fn github_empty_checks_are_none_and_large_rollups_are_explicitly_capped() {
    for total in [0, 101] {
        let fake = HttpFake::start(move |request| {
            let response = if request.path.contains("/check-runs") {
                json!({"total_count":total,"check_runs":[]})
            } else if request.path.contains("/status?") {
                json!({"total_count":0,"statuses":[]})
            } else {
                let mut pull = github_pull("open", Value::Null, Value::Null);
                pull["head"]["sha"] = json!("abcdef1234");
                pull
            };
            Reply::ok(&response.to_string())
        });
        let result = client(&fake, PlatformKind::GitHub)
            .checks(&repo(), 7)
            .await
            .unwrap();
        if total == 0 {
            assert_eq!(result, None);
        } else {
            assert!(result.unwrap().capped);
        }
        assert_eq!(fake.requests().len(), 3);
    }
}

#[tokio::test]
async fn exactly_one_hundred_reported_github_checks_are_complete() {
    let fake = HttpFake::start(|request| {
        let response = if request.path.contains("/check-runs") {
            json!({"total_count":100,"check_runs":vec![json!({"status":"completed","conclusion":"success"});100]})
        } else if request.path.contains("/status?") {
            json!({"total_count":0,"statuses":[]})
        } else {
            let mut pull = github_pull("open", Value::Null, Value::Null);
            pull["head"]["sha"] = json!("abcdef1234");
            pull
        };
        Reply::ok(&response.to_string())
    });
    let checks = client(&fake, PlatformKind::GitHub)
        .checks(&repo(), 7)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(checks.passing, 100);
    assert!(!checks.capped);
}

fn gitlab_request(state: &str, merge_status: &str) -> Value {
    json!({
        "iid": 3, "title": "Add thing", "description": "Because.", "state": state,
        "source_branch": "feature", "target_branch": "main",
        "author": {"username": "yui"}, "created_at": "2026-09-01T10:00:00Z",
        "updated_at": "2026-09-02T10:00:00Z", "merge_status": merge_status,
        "web_url": "https://gitlab.example/owner/widget/-/merge_requests/3"
    })
}

fn data_center_pull(state: &str) -> Value {
    json!({
        "id": 5, "version": 2, "title": "Add thing", "description": "Because.", "state": state,
        "fromRef": {"id": "refs/heads/feature", "displayId": "feature"},
        "toRef": {"id": "refs/heads/main", "displayId": "main"},
        "author": {"user": {"name": "yui"}, "role": "AUTHOR"},
        "createdDate": 1788256800000_i64, "updatedDate": 1788343200000_i64,
        "links": {"self": [{"href": "https://bitbucket.example/projects/OWNER/repos/widget/pull-requests/5"}]}
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
        .unwrap()
        .pulls;

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v3/repos/owner/widget/pulls?state=open&per_page=100&page=1",
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
    assert_eq!(first.web_url, "https://github.example/owner/widget/pull/7");
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
        "/api/v3/repos/owner/widget/pulls?state=all&per_page=100&page=1",
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
    assert_call(&requests[0], "GET", "/api/v3/repos/owner/widget/pulls/7");
    assert_call(
        &requests[1],
        "GET",
        "/api/v3/repos/owner/widget/pulls/7/files?per_page=100&page=1",
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
    assert_call(request, "POST", "/api/v3/repos/owner/widget/pulls");
    assert_eq!(
        json_of(request),
        json!({"title": "Add thing", "head": "feature", "base": "main", "body": "Because.", "draft": false})
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
        "/api/v3/repos/owner/widget/pulls/7/merge",
    );
    assert_call(&requests[1], "GET", "/api/v3/repos/owner/widget/pulls/7");
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
        .unwrap()
        .pulls;

    assert_call(
        &fake.requests()[0],
        "GET",
        "/api/v4/projects/owner%2Fwidget/merge_requests?state=opened&per_page=100&page=1",
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
        "https://gitlab.example/owner/widget/-/merge_requests/3"
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
        "/api/v4/projects/owner%2Fwidget/merge_requests/3",
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
        "/api/v4/projects/owner%2Fwidget/merge_requests",
    );
    assert_eq!(
        json_of(&requests[0]),
        json!({"source_branch": "feature", "target_branch": "main",
               "title": "Add thing", "description": "Because."})
    );
    assert_call(
        &requests[1],
        "PUT",
        "/api/v4/projects/owner%2Fwidget/merge_requests/3/merge",
    );
    assert_eq!(
        (created.state, merged.state),
        (PrState::Open, PrState::Merged)
    );
}

const DC_PULLS: &str = "/rest/api/1.0/projects/owner/repos/widget/pull-requests";

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

    let pulls = bitbucket.list(&repo(), PrFilter::Open).await.unwrap().pulls;
    bitbucket.list(&repo(), PrFilter::All).await.unwrap();

    let requests = fake.requests();
    assert_call(
        &requests[0],
        "GET",
        &format!("{DC_PULLS}?state=OPEN&limit=100&start=0"),
    );
    assert_call(
        &requests[1],
        "GET",
        &format!("{DC_PULLS}?state=ALL&limit=100&start=0"),
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
        "https://bitbucket.example/projects/OWNER/repos/widget/pull-requests/5"
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
    let repository = json!({"slug": "widget", "project": {"key": "owner"}});
    assert_eq!(
        json_of(&requests[0]),
        json!({"title": "Add thing", "description": "Because.", "draft": false,
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
        "No pull request #9 found in owner/widget on Bitbucket"
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
            format!("No {label} repository found for owner/widget")
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

fn mine_summary(
    pulls: &[yforge_core::LaunchpadPull],
) -> Vec<(String, i64, yforge_core::PullRole, bool)> {
    pulls
        .iter()
        .map(|pull| {
            (
                format!("{}/{}", pull.repo.owner, pull.repo.repo),
                pull.pull.number,
                pull.role,
                pull.draft,
            )
        })
        .collect()
}

#[tokio::test]
async fn github_mine_searches_authored_and_review_requested_then_reads_each_pull_for_its_branches()
{
    use yforge_core::PullRole::{Authored, ReviewRequested};
    let fake = HttpFake::start(|request| {
        let path = request.path.as_str();
        if path.starts_with("/api/v3/search/issues") && path.contains("author%3A%40me") {
            Reply::ok(
                r#"{"items":[{"number":7,"repository_url":"http://x/api/v3/repos/owner/widget"}]}"#,
            )
        } else if path.starts_with("/api/v3/search/issues")
            && path.contains("review-requested%3A%40me")
        {
            Reply::ok(
                r#"{"items":[{"number":9,"repository_url":"http://x/api/v3/repos/owner/other"},{"number":7,"repository_url":"http://x/api/v3/repos/owner/widget"}]}"#,
            )
        } else if path == "/api/v3/repos/owner/widget/pulls/7" {
            Reply::ok(&github_pull("open", Value::Null, json!(true)).to_string())
        } else if path == "/api/v3/repos/owner/other/pulls/9" {
            let mut pull = github_pull("open", Value::Null, Value::Null);
            pull["number"] = json!(9);
            pull["draft"] = json!(true);
            pull["updated_at"] = json!("2026-09-03T10:00:00Z");
            Reply::ok(&pull.to_string())
        } else {
            Reply::status(404, "{}")
        }
    });

    let pulls = client(&fake, PlatformKind::GitHub)
        .mine()
        .await
        .unwrap()
        .pulls;

    assert_eq!(
        mine_summary(&pulls),
        [
            ("owner/other".to_owned(), 9, ReviewRequested, true),
            ("owner/widget".to_owned(), 7, Authored, false),
        ]
    );
    assert_eq!(pulls[1].pull.source_ref, "feature");
    assert_eq!(
        pulls[1].pull.web_url,
        "https://github.example/owner/widget/pull/7"
    );
    assert_eq!(pulls[0].connection_id, "test-connection");
    assert!(fake
        .requests()
        .iter()
        .all(|request| request.method == "GET"));
}

#[tokio::test]
async fn gitlab_mine_lists_created_and_reviewer_requests_with_the_project_from_the_web_address() {
    use yforge_core::PullRole::{Authored, ReviewRequested};
    let fake = HttpFake::start(|request| {
        let path = request.path.as_str();
        if path == "/api/v4/user" {
            return Reply::ok(r#"{"username":"yui"}"#);
        }
        let mut one = gitlab_request("opened", "can_be_merged");
        if path.contains("scope=created_by_me") {
            one["iid"] = json!(3);
            one["draft"] = json!(true);
            Reply::ok(&json!([one]).to_string())
        } else if path.contains("reviewer_username=yui") {
            one["iid"] = json!(4);
            one["web_url"] = json!("https://gitlab.example/platform/sub/api/-/merge_requests/4");
            one["updated_at"] = json!("2026-09-04T10:00:00Z");
            Reply::ok(&json!([one]).to_string())
        } else {
            Reply::status(404, "{}")
        }
    });

    let pulls = client(&fake, PlatformKind::GitLab)
        .mine()
        .await
        .unwrap()
        .pulls;

    assert_eq!(
        mine_summary(&pulls),
        [
            ("platform/sub/api".to_owned(), 4, ReviewRequested, false),
            ("owner/widget".to_owned(), 3, Authored, true),
        ]
    );
    let paths: Vec<String> = fake
        .requests()
        .into_iter()
        .map(|request| request.path)
        .collect();
    assert!(paths
        .iter()
        .any(|path| path.starts_with("/api/v4/merge_requests?state=opened&scope=created_by_me")));
    assert!(paths
        .iter()
        .any(|path| path.contains("reviewer_username=yui")));
}

#[tokio::test]
async fn data_center_mine_reads_the_dashboard_by_role() {
    use yforge_core::PullRole::{Authored, ReviewRequested};
    let pull = |id: i64, draft: bool| {
        json!({
            "id": id, "version": 1, "title": "Add thing", "description": null, "state": "OPEN",
            "draft": draft,
            "fromRef": {"displayId": "feature"},
            "toRef": {"displayId": "main", "repository": {"slug": "widget", "project": {"key": "OWNER"}}},
            "author": {"user": {"name": "yui"}}, "createdDate": 1788256800000_i64,
            "updatedDate": 1788256800000_i64,
            "links": {"self": [{"href": "https://bb.example/projects/OWNER/repos/widget/pull-requests/1"}]}
        })
    };
    let fake = HttpFake::start(move |request| {
        if request.path.contains("role=AUTHOR") {
            Reply::ok(&json!({"values": [pull(1, true)]}).to_string())
        } else if request.path.contains("role=REVIEWER") {
            Reply::ok(&json!({"values": [pull(2, false)]}).to_string())
        } else {
            Reply::status(404, "{}")
        }
    });

    let pulls = client(&fake, PlatformKind::Bitbucket)
        .mine()
        .await
        .unwrap()
        .pulls;

    let mut summary = mine_summary(&pulls);
    summary.sort_by_key(|entry| entry.1);
    assert_eq!(
        summary,
        [
            ("OWNER/widget".to_owned(), 1, Authored, true),
            ("OWNER/widget".to_owned(), 2, ReviewRequested, false),
        ]
    );
    for request in fake.requests() {
        assert!(request
            .path
            .starts_with("/rest/api/1.0/dashboard/pull-requests?state=OPEN&"));
    }
}

#[tokio::test]
async fn a_pull_that_is_both_authored_and_review_requested_is_listed_once_as_authored() {
    use yforge_core::PullRole::Authored;
    let fake = HttpFake::start(|request| {
        let pull = json!({
            "id": 1, "version": 1, "title": "Add thing", "description": null, "state": "OPEN",
            "fromRef": {"displayId": "feature"},
            "toRef": {"displayId": "main", "repository": {"slug": "widget", "project": {"key": "OWNER"}}},
            "author": {"user": {"name": "yui"}}, "createdDate": 0, "updatedDate": 0,
            "links": {"self": [{"href": "https://bb.example/1"}]}
        });
        if request.path.contains("dashboard") {
            Reply::ok(&json!({"values": [pull]}).to_string())
        } else {
            Reply::status(404, "{}")
        }
    });

    let pulls = client(&fake, PlatformKind::Bitbucket)
        .mine()
        .await
        .unwrap()
        .pulls;

    assert_eq!(
        mine_summary(&pulls),
        [("OWNER/widget".to_owned(), 1, Authored, false)]
    );
}

#[tokio::test]
async fn mine_reports_a_refused_token_as_authentication_failed() {
    let fake = HttpFake::start(|_| Reply::status(401, "{}"));

    let error = client(&fake, PlatformKind::GitHub)
        .mine()
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AuthFailed);
}

const CAP: usize = 1000;

fn query(path: &str, key: &str) -> Option<usize> {
    path.split(['?', '&'])
        .find_map(|part| part.strip_prefix(&format!("{key}=")))
        .and_then(|value| value.parse().ok())
}

fn window(total: usize, page: usize, size: usize) -> std::ops::Range<usize> {
    let start = (page - 1) * size;
    start.min(total)..(start + size).min(total)
}

fn numbers(pulls: &[yforge_core::PullRequest]) -> Vec<i64> {
    pulls.iter().map(|pull| pull.number).collect()
}

fn github_numbered(number: usize) -> Value {
    let mut pull = github_pull("open", Value::Null, Value::Null);
    pull["number"] = json!(number);
    pull
}

fn serve_github_pulls(total: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let page = query(&request.path, "page").unwrap();
        let pulls: Vec<Value> = window(total, page, 100).map(github_numbered).collect();
        Reply::ok(&json!(pulls).to_string())
    })
}

async fn github_list(fake: &HttpFake) -> yforge_core::PullList {
    client(fake, PlatformKind::GitHub)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap()
}

#[tokio::test]
async fn github_list_follows_the_pages_to_the_end_and_counts_every_pull() {
    let fake = serve_github_pulls(250);

    let list = github_list(&fake).await;

    assert_eq!(fake.requests().len(), 3);
    assert_eq!(numbers(&list.pulls), (0..250).collect::<Vec<i64>>());
    assert_eq!((list.total, list.capped), (Some(250), false));
}

#[tokio::test]
async fn github_list_of_exactly_the_cap_is_complete_and_not_capped() {
    let fake = serve_github_pulls(CAP);

    let list = github_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1000), false));
}

#[tokio::test]
async fn github_list_over_the_cap_stops_at_the_cap_and_says_it_has_no_total() {
    let fake = serve_github_pulls(1500);

    let list = github_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!(numbers(&list.pulls)[CAP - 1], 999);
    assert_eq!((list.total, list.capped), (None, true));
    assert_eq!(fake.requests().len(), 11);
}

fn serve_github_files(changed: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let path = request.path.as_str();
        if path.contains("/files") {
            let page = query(path, "page").unwrap();
            let files: Vec<Value> = window(changed, page, 100)
                .map(|number| {
                    json!({"filename": format!("f{number}.rs"), "status": "modified",
                           "additions": 1, "deletions": 0})
                })
                .collect();
            Reply::ok(&json!(files).to_string())
        } else {
            let mut pull = github_numbered(7);
            pull["changed_files"] = json!(changed);
            Reply::ok(&pull.to_string())
        }
    })
}

#[tokio::test]
async fn github_files_follow_the_pages_and_the_total_is_the_pulls_changed_files() {
    let fake = serve_github_files(250);

    let detail = client(&fake, PlatformKind::GitHub)
        .detail(&repo(), 7)
        .await
        .unwrap();

    assert_eq!(detail.files.len(), 250);
    assert_eq!(detail.files[249].filename, "f249.rs");
    assert_eq!(
        (detail.files_total, detail.files_capped),
        (Some(250), false)
    );
}

#[tokio::test]
async fn github_files_over_the_cap_report_the_true_total_and_the_cap() {
    let fake = serve_github_files(2500);

    let detail = client(&fake, PlatformKind::GitHub)
        .detail(&repo(), 7)
        .await
        .unwrap();

    assert_eq!(detail.files.len(), CAP);
    assert_eq!(
        (detail.files_total, detail.files_capped),
        (Some(2500), true)
    );
    assert_eq!(fake.requests().len(), 11);
}

fn gitlab_numbered(iid: usize) -> Value {
    let mut request = gitlab_request("opened", "can_be_merged");
    request["iid"] = json!(iid);
    request
}

fn serve_gitlab_pulls(total: usize, report_total: bool) -> HttpFake {
    HttpFake::start(move |request| {
        let page = query(&request.path, "page").unwrap();
        let items: Vec<Value> = window(total, page, 100).map(gitlab_numbered).collect();
        let more = page * 100 < total;
        let reply = Reply::ok(&json!(items).to_string()).header(
            "X-Next-Page",
            &if more {
                (page + 1).to_string()
            } else {
                String::new()
            },
        );
        if report_total {
            reply.header("X-Total", &total.to_string())
        } else {
            reply
        }
    })
}

async fn gitlab_list(fake: &HttpFake) -> yforge_core::PullList {
    client(fake, PlatformKind::GitLab)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap()
}

#[tokio::test]
async fn gitlab_list_follows_x_next_page_and_reports_x_total() {
    let fake = serve_gitlab_pulls(250, true);

    let list = gitlab_list(&fake).await;

    assert_eq!(fake.requests().len(), 3);
    assert_eq!(numbers(&list.pulls), (0..250).collect::<Vec<i64>>());
    assert_eq!((list.total, list.capped), (Some(250), false));
}

#[tokio::test]
async fn gitlab_list_of_exactly_the_cap_is_not_capped() {
    let fake = serve_gitlab_pulls(CAP, true);

    let list = gitlab_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1000), false));
    assert_eq!(fake.requests().len(), 10);
}

#[tokio::test]
async fn gitlab_list_over_the_cap_keeps_the_true_total_the_service_gave() {
    let fake = serve_gitlab_pulls(1500, true);

    let list = gitlab_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1500), true));
    assert_eq!(fake.requests().len(), 10);
}

#[tokio::test]
async fn gitlab_list_over_the_cap_without_an_x_total_has_no_total() {
    let fake = serve_gitlab_pulls(1500, false);

    let list = gitlab_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (None, true));
}

#[tokio::test]
async fn gitlab_files_say_when_the_service_cut_the_list_and_give_no_total_then() {
    let changes: Vec<Value> = (0..CAP)
        .map(|number| {
            json!({"new_path": format!("f{number}.rs"), "new_file": false,
                   "renamed_file": false, "deleted_file": false, "diff": ""})
        })
        .collect();
    let fake = HttpFake::start(move |_| {
        let mut request = gitlab_request("opened", "can_be_merged");
        request["changes"] = json!(changes);
        request["changes_count"] = json!("1000+");
        request["overflow"] = json!(true);
        Reply::ok(&request.to_string())
    });

    let detail = client(&fake, PlatformKind::GitLab)
        .detail(&repo(), 3)
        .await
        .unwrap();

    assert_eq!(detail.files.len(), CAP);
    assert_eq!((detail.files_total, detail.files_capped), (None, true));
}

#[tokio::test]
async fn gitlab_files_under_the_cap_are_counted_exactly() {
    let fake = HttpFake::start(|_| {
        let mut request = gitlab_request("opened", "can_be_merged");
        request["changes"] = json!([{"new_path": "a.rs", "diff": ""}]);
        request["changes_count"] = json!("1");
        Reply::ok(&request.to_string())
    });

    let detail = client(&fake, PlatformKind::GitLab)
        .detail(&repo(), 3)
        .await
        .unwrap();

    assert_eq!((detail.files_total, detail.files_capped), (Some(1), false));
}

fn gitlab_mine_server(authored: usize, reviewing: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let path = request.path.as_str();
        if path == "/api/v4/user" {
            return Reply::ok(r#"{"username":"yui"}"#);
        }
        let (total, base) = if path.contains("scope=created_by_me") {
            (authored, 0)
        } else {
            (reviewing, 100_000)
        };
        let page = query(path, "page").unwrap();
        let items: Vec<Value> = window(total, page, 100)
            .map(|number| {
                let mut one = gitlab_numbered(base + number);
                one["updated_at"] = json!(format!("2026-09-01T10:{:02}:00Z", number % 60));
                one
            })
            .collect();
        Reply::ok(&json!(items).to_string())
            .header("X-Total", &total.to_string())
            .header(
                "X-Next-Page",
                &if page * 100 < total {
                    (page + 1).to_string()
                } else {
                    String::new()
                },
            )
    })
}

#[tokio::test]
async fn gitlab_mine_pages_each_role_and_counts_them_together() {
    let fake = gitlab_mine_server(150, 120);

    let mine = client(&fake, PlatformKind::GitLab).mine().await.unwrap();

    assert_eq!(mine.pulls.len(), 270);
    assert_eq!((mine.total, mine.capped), (Some(270), false));
}

#[tokio::test]
async fn gitlab_mine_over_the_cap_keeps_the_most_recent_and_the_true_total() {
    let fake = gitlab_mine_server(800, 700);

    let mine = client(&fake, PlatformKind::GitLab).mine().await.unwrap();

    assert_eq!(mine.pulls.len(), CAP);
    assert_eq!((mine.total, mine.capped), (Some(1500), true));
    let updated: Vec<&str> = mine
        .pulls
        .iter()
        .map(|pull| pull.pull.updated_at.as_str())
        .collect();
    assert!(updated.windows(2).all(|pair| pair[0] >= pair[1]));
}

#[tokio::test]
async fn github_mine_pages_the_search_and_takes_the_total_from_it() {
    let fake = HttpFake::start(|request| {
        let path = request.path.as_str();
        if path.starts_with("/api/v3/search/issues") {
            let authored = path.contains("author%3A%40me");
            let total = if authored { 130 } else { 0 };
            let page = query(path, "page").unwrap();
            let items: Vec<Value> = window(total, page, 100)
                .map(|number| {
                    json!({"number": number + 1,
                           "repository_url": "http://x/api/v3/repos/owner/widget"})
                })
                .collect();
            Reply::ok(&json!({"total_count": total, "items": items}).to_string())
        } else if let Some(number) = path.strip_prefix("/api/v3/repos/owner/widget/pulls/") {
            Reply::ok(&github_numbered(number.parse().unwrap()).to_string())
        } else {
            Reply::status(404, "{}")
        }
    });

    let mine = client(&fake, PlatformKind::GitHub).mine().await.unwrap();

    assert_eq!(mine.pulls.len(), 130);
    assert_eq!((mine.total, mine.capped), (Some(130), false));
}

fn dc_numbered(id: usize) -> Value {
    let mut pull = data_center_pull("OPEN");
    pull["id"] = json!(id);
    pull
}

fn serve_dc_pulls(total: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let start = query(&request.path, "start").unwrap();
        let end = (start + 100).min(total);
        let values: Vec<Value> = (start.min(total)..end).map(dc_numbered).collect();
        let mut page = json!({"values": values, "isLastPage": end >= total});
        if end < total {
            page["nextPageStart"] = json!(end);
        }
        Reply::ok(&page.to_string())
    })
}

async fn dc_list(fake: &HttpFake) -> yforge_core::PullList {
    client(fake, PlatformKind::Bitbucket)
        .list(&repo(), PrFilter::Open)
        .await
        .unwrap()
}

#[tokio::test]
async fn data_center_list_follows_next_page_start_until_the_last_page() {
    let fake = serve_dc_pulls(250);

    let list = dc_list(&fake).await;

    assert_eq!(fake.requests().len(), 3);
    assert_eq!(numbers(&list.pulls), (0..250).collect::<Vec<i64>>());
    assert_eq!((list.total, list.capped), (Some(250), false));
}

#[tokio::test]
async fn data_center_list_of_exactly_the_cap_is_not_capped() {
    let fake = serve_dc_pulls(CAP);

    let list = dc_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1000), false));
}

#[tokio::test]
async fn data_center_list_over_the_cap_has_no_total_because_the_service_gives_none() {
    let fake = serve_dc_pulls(1500);

    let list = dc_list(&fake).await;

    assert_eq!(list.pulls.len(), CAP);
    assert_eq!((list.total, list.capped), (None, true));
}

fn dc_diff(count: usize, truncated: bool) -> Value {
    let diffs: Vec<Value> = (0..count)
        .map(|number| {
            json!({"source": null, "destination": {"components": [format!("f{number}.rs")]},
                   "hunks": []})
        })
        .collect();
    json!({"diffs": diffs, "truncated": truncated})
}

#[tokio::test]
async fn data_center_files_are_counted_unless_the_service_truncated_the_diff() {
    for (count, truncated, expected) in [
        (3, false, (Some(3), false)),
        (CAP, false, (Some(1000), false)),
        (1200, false, (None, true)),
        (40, true, (None, true)),
    ] {
        let fake = HttpFake::start(move |request| {
            if request.path.ends_with("/diff") {
                Reply::ok(&dc_diff(count, truncated).to_string())
            } else {
                Reply::ok(&data_center_pull("OPEN").to_string())
            }
        });

        let detail = client(&fake, PlatformKind::Bitbucket)
            .detail(&repo(), 5)
            .await
            .unwrap();

        assert_eq!(detail.files.len(), count.min(CAP), "{count} {truncated}");
        assert_eq!((detail.files_total, detail.files_capped), expected);
    }
}

#[tokio::test]
async fn data_center_mine_pages_each_role() {
    let pull = |id: usize| {
        json!({
            "id": id, "version": 1, "title": "Add thing", "description": null, "state": "OPEN",
            "fromRef": {"displayId": "feature"},
            "toRef": {"displayId": "main", "repository": {"slug": "widget", "project": {"key": "OWNER"}}},
            "author": {"user": {"name": "yui"}}, "createdDate": 1788256800000_i64,
            "updatedDate": 1788256800000_i64,
            "links": {"self": [{"href": "https://bb.example/projects/OWNER/repos/widget/pull-requests/1"}]}
        })
    };
    let fake = HttpFake::start(move |request| {
        let (total, base) = if request.path.contains("role=AUTHOR") {
            (130, 0)
        } else {
            (0, 1000)
        };
        let start = query(&request.path, "start").unwrap();
        let end = (start + 100).min(total);
        let values: Vec<Value> = (start.min(total)..end).map(|n| pull(base + n)).collect();
        let mut page = json!({"values": values, "isLastPage": end >= total});
        if end < total {
            page["nextPageStart"] = json!(end);
        }
        Reply::ok(&page.to_string())
    });

    let mine = client(&fake, PlatformKind::Bitbucket).mine().await.unwrap();

    assert_eq!(mine.pulls.len(), 130);
    assert_eq!((mine.total, mine.capped), (Some(130), false));
}
