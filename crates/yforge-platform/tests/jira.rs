mod common;

use std::sync::Arc;

use common::{HttpFake, Recorded, Reply};
use yforge_ai::{MemoryStore, SecretStore};
use yforge_core::{
    jira_connection_add, jira_connections_list, CoreError, ErrorKind, JiraKind, JiraProject,
    JiraStatusCategory,
};
use yforge_platform::{jira_field_problem, NewJiraConnection, PlatformError, PlatformService};

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

fn kind_of(error: PlatformError) -> ErrorKind {
    CoreError::from(error).kind()
}

fn decoded(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' {
            out.push(u8::from_str_radix(&path[at + 1..at + 3], 16).unwrap());
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }
    String::from_utf8(out).unwrap()
}

fn cloud_route(request: &Recorded) -> Reply {
    let path = decoded(&request.path);
    if path.starts_with("/rest/api/3/myself") {
        Reply::ok(r#"{"displayName":"Sam Lee","accountId":"a1"}"#)
    } else if path.starts_with("/rest/api/3/project/search") && path.contains("startAt=0") {
        Reply::ok(r#"{"values":[{"key":"ABC","name":"Accounts"}],"isLast":false}"#)
    } else if path.starts_with("/rest/api/3/project/search") {
        Reply::ok(r#"{"values":[{"key":"WEB","name":"Website"}],"isLast":true}"#)
    } else {
        Reply::status(404, "{}")
    }
}

fn server_route(request: &Recorded) -> Reply {
    let path = decoded(&request.path);
    if path.starts_with("/jira/rest/api/2/myself") {
        Reply::ok(r#"{"displayName":"you","name":"vk"}"#)
    } else if path.starts_with("/jira/rest/api/2/project") {
        Reply::ok(r#"[{"key":"OPS","name":"Operations"},{"key":"PAY","name":"Payments"}]"#)
    } else {
        Reply::status(404, "{}")
    }
}

fn cloud_input(fake: &HttpFake) -> NewJiraConnection {
    NewJiraConnection {
        kind: JiraKind::Cloud,
        site: format!("http://{}", fake.host),
        email: Some("you@example.com".to_owned()),
        token: "tok-secret".to_owned(),
    }
}

fn server_input(fake: &HttpFake) -> NewJiraConnection {
    NewJiraConnection {
        kind: JiraKind::DataCenter,
        site: format!("http://{}/jira/", fake.host),
        email: None,
        token: "pat-secret".to_owned(),
    }
}

fn issue_json(key: &str, summary: &str, status: &str, category: &str) -> String {
    format!(
        r#"{{"key":"{key}","fields":{{"summary":"{summary}","status":{{"name":"{status}","statusCategory":{{"key":"{category}"}}}},"issuetype":{{"name":"Story"}},"project":{{"key":"{}"}},"assignee":{{"displayName":"you"}},"updated":"2026-10-01T09:30:00.000+0000"}}}}"#,
        key.split('-').next().unwrap()
    )
}

fn only_reads(fake: &HttpFake) {
    assert!(fake
        .requests()
        .iter()
        .all(|request| request.method == "GET"));
}

#[tokio::test]
async fn a_cloud_site_connects_with_basic_auth_and_keeps_the_name_and_every_project_page() {
    let h = harness();
    let fake = HttpFake::start(cloud_route);

    let added = h
        .service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap();

    assert_eq!(added.display_name, "Sam Lee");
    assert_eq!(added.email.as_deref(), Some("you@example.com"));
    assert_eq!(added.site, format!("http://{}", fake.host));
    assert_eq!(
        added.projects,
        [
            JiraProject {
                key: "ABC".to_owned(),
                name: "Accounts".to_owned()
            },
            JiraProject {
                key: "WEB".to_owned(),
                name: "Website".to_owned()
            },
        ]
    );
    assert_eq!(
        jira_connections_list(h.data.path()).unwrap(),
        std::slice::from_ref(&added)
    );
    assert_eq!(
        h.secrets
            .get(&format!("jira.{}", added.id))
            .unwrap()
            .as_deref(),
        Some("tok-secret")
    );
    let requests = fake.requests();
    assert!(requests
        .iter()
        .all(|request| request.header("authorization")
            == Some("Basic eW91QGV4YW1wbGUuY29tOnRvay1zZWNyZXQ=")));
    only_reads(&fake);
}

#[tokio::test]
async fn a_data_center_site_connects_with_a_bearer_token_under_its_context_path() {
    let h = harness();
    let fake = HttpFake::start(server_route);

    let added = h
        .service
        .jira_add(h.data.path(), server_input(&fake))
        .await
        .unwrap();

    assert_eq!(added.kind, JiraKind::DataCenter);
    assert_eq!(added.email, None);
    assert_eq!(added.site, format!("http://{}/jira", fake.host));
    assert_eq!(added.display_name, "you");
    assert_eq!(added.projects.len(), 2);
    assert!(fake
        .requests()
        .iter()
        .all(|request| request.header("authorization") == Some("Bearer pat-secret")));
    only_reads(&fake);
}

#[tokio::test]
async fn a_refused_token_stores_nothing_and_reports_authentication_failed() {
    let h = harness();
    let fake = HttpFake::start(|_| {
        Reply::status(401, r#"{"errorMessages":["token tok-secret expired"]}"#)
    });

    let error = h
        .service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Authentication failed for {}", fake.host)
    );
    assert_eq!(kind_of(error), ErrorKind::AuthFailed);
    assert!(jira_connections_list(h.data.path()).unwrap().is_empty());
}

#[tokio::test]
async fn jira_error_messages_are_reported_without_the_token() {
    let h = harness();
    let fake = HttpFake::start(|_| {
        Reply::status(
            500,
            r#"{"errorMessages":["boom for tok-secret"],"errors":{}}"#,
        )
    });

    let error = h
        .service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap_err();

    let text = error.to_string();
    assert!(text.contains("HTTP 500: boom for <redacted>"), "{text}");
}

#[tokio::test]
async fn testing_reports_the_display_name_and_refreshes_the_stored_projects() {
    let h = harness();
    let fake = HttpFake::start(server_route);
    let added = h
        .service
        .jira_add(h.data.path(), server_input(&fake))
        .await
        .unwrap();
    yforge_core::jira_connection_update(h.data.path(), &added.id, "stale", &[]).unwrap();

    let name = h.service.jira_test(h.data.path(), &added.id).await.unwrap();

    assert_eq!(name, "you");
    let stored = jira_connections_list(h.data.path()).unwrap();
    assert_eq!(stored[0].display_name, "you");
    assert_eq!(stored[0].projects.len(), 2);
    assert_eq!(
        kind_of(
            h.service
                .jira_test(h.data.path(), "missing")
                .await
                .unwrap_err()
        ),
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn a_connection_without_a_stored_token_reports_auth_failed() {
    let h = harness();
    let fake = HttpFake::start(server_route);
    let added = h
        .service
        .jira_add(h.data.path(), server_input(&fake))
        .await
        .unwrap();
    h.secrets.delete(&format!("jira.{}", added.id)).unwrap();

    let error = h
        .service
        .jira_test(h.data.path(), &added.id)
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AuthFailed);
}

#[tokio::test]
async fn removing_a_connection_deletes_the_row_and_the_token() {
    let h = harness();
    let fake = HttpFake::start(server_route);
    let added = h
        .service
        .jira_add(h.data.path(), server_input(&fake))
        .await
        .unwrap();

    h.service.jira_remove(h.data.path(), &added.id).unwrap();

    assert!(jira_connections_list(h.data.path()).unwrap().is_empty());
    assert_eq!(h.secrets.get(&format!("jira.{}", added.id)).unwrap(), None);
    assert_eq!(
        kind_of(h.service.jira_remove(h.data.path(), &added.id).unwrap_err()),
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn my_issues_are_the_assigned_not_done_issues_of_the_site_with_status_words() {
    let h = harness();
    let body = format!(
        r#"{{"issues":[{},{},{}]}}"#,
        issue_json("OPS-9", "Proxy settings", "To Do", "new"),
        issue_json("OPS-12", "Cookie banner", "In Review", "indeterminate"),
        issue_json("PAY-1", "Refund copy", "Done", "done"),
    );
    let fake = HttpFake::start(move |request| {
        if decoded(&request.path).starts_with("/jira/rest/api/2/search") {
            Reply::ok(&body)
        } else {
            server_route(request)
        }
    });
    let added = h
        .service
        .jira_add(h.data.path(), server_input(&fake))
        .await
        .unwrap();

    let issues = h
        .service
        .jira_my_issues(h.data.path(), &added.id)
        .await
        .unwrap()
        .issues;

    let summary: Vec<(&str, &str, JiraStatusCategory)> = issues
        .iter()
        .map(|issue| {
            (
                issue.key.as_str(),
                issue.status.as_str(),
                issue.status_category,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            ("OPS-9", "To Do", JiraStatusCategory::ToDo),
            ("OPS-12", "In Review", JiraStatusCategory::InProgress),
            ("PAY-1", "Done", JiraStatusCategory::Done),
        ]
    );
    assert_eq!(issues[0].summary, "Proxy settings");
    assert_eq!(issues[0].issue_type, "Story");
    assert_eq!(issues[0].assignee.as_deref(), Some("you"));
    assert_eq!(issues[0].project, "OPS");
    assert_eq!(
        issues[0].web_url,
        format!("http://{}/jira/browse/OPS-9", fake.host)
    );
    assert_eq!(issues[0].connection_id, added.id);
    let search = fake
        .requests()
        .into_iter()
        .map(|request| decoded(&request.path))
        .find(|path| path.contains("/search"))
        .unwrap();
    assert!(
        search.contains("fields=summary,status,issuetype,project,assignee,updated"),
        "{search}"
    );
    assert!(
        search.contains(
            "jql=assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
        ),
        "{search}"
    );
    only_reads(&fake);
}

#[tokio::test]
async fn a_cloud_site_searches_through_the_enhanced_jql_endpoint() {
    let h = harness();
    let fake = HttpFake::start(|request| {
        if decoded(&request.path).starts_with("/rest/api/3/search/jql") {
            Reply::ok(&format!(
                r#"{{"issues":[{}]}}"#,
                issue_json("ABC-155", "Switcher", "In Progress", "indeterminate")
            ))
        } else {
            cloud_route(request)
        }
    });
    let added = h
        .service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap();

    let issues = h
        .service
        .jira_my_issues(h.data.path(), &added.id)
        .await
        .unwrap()
        .issues;

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].key, "ABC-155");
}

#[tokio::test]
async fn issue_lookup_asks_each_site_for_its_own_keys_and_reports_the_rest_without_details() {
    let h = harness();
    let cloud = HttpFake::start(|request| {
        let path = decoded(&request.path);
        if path.starts_with("/rest/api/3/search/jql") {
            assert!(path.contains("key in (ABC-142)"), "{path}");
            Reply::ok(&format!(
                r#"{{"issues":[{}]}}"#,
                issue_json("ABC-142", "Retry login", "Done", "done")
            ))
        } else {
            cloud_route(request)
        }
    });
    let down = HttpFake::start(server_route);
    let up = h
        .service
        .jira_add(h.data.path(), cloud_input(&cloud))
        .await
        .unwrap();
    let broken = h
        .service
        .jira_add(h.data.path(), server_input(&down))
        .await
        .unwrap();
    assert_ne!(up.id, broken.id);
    let dead = HttpFake::start(|_| Reply::status(503, "{}"));
    let revived = jira_connection_add(
        h.data.path(),
        JiraKind::DataCenter,
        &format!("http://{}", dead.host),
        None,
        "x",
        &[JiraProject {
            key: "DEAD".to_owned(),
            name: "Dead".to_owned(),
        }],
    )
    .unwrap();
    h.secrets
        .set(&format!("jira.{}", revived.id), "pat")
        .unwrap();

    let found = h
        .service
        .jira_issues(
            h.data.path(),
            &[
                "ABC-142".to_owned(),
                "DEAD-3".to_owned(),
                "NONE-1".to_owned(),
                "OPS-5".to_owned(),
            ],
        )
        .await
        .unwrap();

    assert_eq!(found.len(), 4);
    assert_eq!(found[0].key, "ABC-142");
    assert_eq!(
        found[0].issue.as_ref().map(|issue| issue.summary.as_str()),
        Some("Retry login")
    );
    assert_eq!(found[0].failure, None);
    assert_eq!(found[1].key, "DEAD-3");
    assert_eq!(found[1].issue, None);
    assert!(found[1].failure.as_deref().unwrap().contains(&dead.host));
    assert_eq!(
        (found[2].issue.is_none(), found[2].failure.is_none()),
        (true, true)
    );
    assert_eq!(found[3].key, "OPS-5");
    assert_eq!(found[3].issue, None);
    assert!(found[3].failure.is_some());
}

#[tokio::test]
async fn issue_lookup_sends_many_keys_in_bounded_requests_and_merges_the_results() {
    let h = harness();
    let fake = HttpFake::start(|request| {
        let path = decoded(&request.path);
        if path.starts_with("/rest/api/3/search/jql") {
            let keys = path
                .split_once("key in (")
                .and_then(|(_, rest)| rest.split_once(')'))
                .map(|(keys, _)| keys.to_owned())
                .unwrap();
            let issues: Vec<String> = keys
                .split(',')
                .map(|key| issue_json(key, "Found", "To Do", "new"))
                .collect();
            Reply::ok(&format!(r#"{{"issues":[{}]}}"#, issues.join(",")))
        } else {
            cloud_route(request)
        }
    });
    h.service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap();
    let keys: Vec<String> = (1..=1000).map(|number| format!("ABC-{number}")).collect();

    let found = h.service.jira_issues(h.data.path(), &keys).await.unwrap();

    assert_eq!(found.len(), 1000);
    assert!(
        found.iter().all(|lookup| lookup
            .issue
            .as_ref()
            .is_some_and(|issue| issue.key == lookup.key)),
        "every key resolves to its own issue"
    );
    let searches: Vec<usize> = fake
        .requests()
        .into_iter()
        .filter(|request| request.path.starts_with("/rest/api/3/search/jql"))
        .map(|request| request.path.len())
        .collect();
    assert!(searches.len() > 1, "{searches:?}");
    assert!(searches.iter().all(|length| *length < 4096), "{searches:?}");
}

#[test]
fn site_email_and_token_problems_are_stated_in_words() {
    for (field, value, problem) in [
        ("site", "https://your-site.atlassian.net", false),
        ("site", "jira.corp-b.internal/jira", false),
        ("site", "http://127.0.0.1:8080", false),
        ("site", "", true),
        ("site", "http://jira.example.com", true),
        ("site", "https://jira example.com", true),
        ("site", "https://jira.example.com/?x=1", true),
        ("site", "ftp://jira.example.com", true),
        ("email", "you@example.com", false),
        ("email", "you", true),
        ("email", "a@b@c", true),
        ("email", "", true),
        ("token", "abc", false),
        ("token", "   ", true),
        ("other", "x", true),
    ] {
        assert_eq!(
            jira_field_problem(field, value).is_some(),
            problem,
            "{field} {value:?}"
        );
    }
}

#[tokio::test]
async fn invalid_input_is_refused_before_anything_is_stored() {
    let h = harness();
    let fake = HttpFake::start(cloud_route);
    for input in [
        NewJiraConnection {
            email: None,
            ..cloud_input(&fake)
        },
        NewJiraConnection {
            token: " ".to_owned(),
            ..cloud_input(&fake)
        },
        NewJiraConnection {
            site: "http://jira.example.com".to_owned(),
            ..cloud_input(&fake)
        },
    ] {
        let error = h.service.jira_add(h.data.path(), input).await.unwrap_err();
        assert_eq!(kind_of(error), ErrorKind::InvalidRequest);
    }
    assert!(fake.requests().is_empty());
    assert!(jira_connections_list(h.data.path()).unwrap().is_empty());
}

#[tokio::test]
async fn an_unassigned_issue_has_no_assignee() {
    let h = harness();
    let fake = HttpFake::start(|request| {
        if decoded(&request.path).starts_with("/rest/api/3/search/jql") {
            Reply::ok(
                r#"{"issues":[{"key":"ABC-1","fields":{"summary":"s","status":{"name":"To Do","statusCategory":{"key":"new"}},"assignee":null}}]}"#,
            )
        } else {
            cloud_route(request)
        }
    });
    let added = h
        .service
        .jira_add(h.data.path(), cloud_input(&fake))
        .await
        .unwrap();

    let issues = h
        .service
        .jira_my_issues(h.data.path(), &added.id)
        .await
        .unwrap()
        .issues;

    assert_eq!(issues[0].assignee, None);
}

const CAP: usize = 1000;

fn query_value(path: &str, key: &str) -> Option<String> {
    path.split(['?', '&'])
        .find_map(|part| part.strip_prefix(&format!("{key}=")))
        .map(str::to_owned)
}

fn issues_json(range: std::ops::Range<usize>) -> String {
    range
        .map(|number| issue_json(&format!("OPS-{number}"), "Found", "To Do", "new"))
        .collect::<Vec<_>>()
        .join(",")
}

fn serve_cloud_issues(total: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let path = decoded(&request.path);
        if path.starts_with("/rest/api/3/search/jql") {
            let page: usize = query_value(&path, "nextPageToken")
                .map_or(1, |token| token.trim_start_matches('p').parse().unwrap());
            let start = ((page - 1) * 100).min(total);
            let end = (start + 100).min(total);
            let more = if end < total {
                format!(r#","nextPageToken":"p{}""#, page + 1)
            } else {
                r#","isLast":true"#.to_owned()
            };
            Reply::ok(&format!(
                r#"{{"issues":[{}]{more}}}"#,
                issues_json(start..end)
            ))
        } else {
            cloud_route(request)
        }
    })
}

fn serve_data_center_issues(total: usize) -> HttpFake {
    HttpFake::start(move |request| {
        let path = decoded(&request.path);
        if path.starts_with("/jira/rest/api/2/search") {
            let start: usize =
                query_value(&path, "startAt").map_or(0, |value| value.parse().unwrap());
            let end = (start + 100).min(total);
            Reply::ok(&format!(
                r#"{{"startAt":{start},"maxResults":100,"total":{total},"issues":[{}]}}"#,
                issues_json(start.min(total)..end)
            ))
        } else {
            server_route(request)
        }
    })
}

async fn my_issues(
    h: &Harness,
    fake: &HttpFake,
    input: fn(&HttpFake) -> NewJiraConnection,
) -> yforge_core::JiraIssueList {
    let added = h
        .service
        .jira_add(h.data.path(), input(fake))
        .await
        .unwrap();
    h.service
        .jira_my_issues(h.data.path(), &added.id)
        .await
        .unwrap()
}

fn keys(list: &yforge_core::JiraIssueList) -> Vec<String> {
    list.issues.iter().map(|issue| issue.key.clone()).collect()
}

fn expected_keys(count: usize) -> Vec<String> {
    (0..count).map(|number| format!("OPS-{number}")).collect()
}

#[tokio::test]
async fn a_cloud_site_is_read_page_by_page_through_next_page_tokens() {
    let h = harness();
    let fake = serve_cloud_issues(250);

    let list = my_issues(&h, &fake, cloud_input).await;

    assert_eq!(keys(&list), expected_keys(250));
    assert_eq!((list.total, list.capped), (Some(250), false));
    let searches = fake
        .requests()
        .iter()
        .filter(|request| request.path.contains("/search/jql"))
        .count();
    assert_eq!(searches, 3);
}

#[tokio::test]
async fn a_cloud_site_with_exactly_the_cap_is_not_capped() {
    let h = harness();
    let fake = serve_cloud_issues(CAP);

    let list = my_issues(&h, &fake, cloud_input).await;

    assert_eq!(list.issues.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1000), false));
}

#[tokio::test]
async fn a_cloud_site_over_the_cap_stops_at_the_cap_and_has_no_total() {
    let h = harness();
    let fake = serve_cloud_issues(1500);

    let list = my_issues(&h, &fake, cloud_input).await;

    assert_eq!(keys(&list), expected_keys(CAP));
    assert_eq!((list.total, list.capped), (None, true));
}

#[tokio::test]
async fn a_data_center_site_is_read_by_start_at_and_counted_from_its_total() {
    let h = harness();
    let fake = serve_data_center_issues(250);

    let list = my_issues(&h, &fake, server_input).await;

    assert_eq!(keys(&list), expected_keys(250));
    assert_eq!((list.total, list.capped), (Some(250), false));
}

#[tokio::test]
async fn a_data_center_site_with_exactly_the_cap_is_not_capped() {
    let h = harness();
    let fake = serve_data_center_issues(CAP);

    let list = my_issues(&h, &fake, server_input).await;

    assert_eq!(list.issues.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1000), false));
}

#[tokio::test]
async fn a_data_center_site_over_the_cap_keeps_its_true_total() {
    let h = harness();
    let fake = serve_data_center_issues(1500);

    let list = my_issues(&h, &fake, server_input).await;

    assert_eq!(list.issues.len(), CAP);
    assert_eq!((list.total, list.capped), (Some(1500), true));
    let searches = fake
        .requests()
        .iter()
        .filter(|request| request.path.contains("/search"))
        .count();
    assert_eq!(searches, 10);
}
