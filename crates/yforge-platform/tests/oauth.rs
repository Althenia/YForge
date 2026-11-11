mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{HttpFake, Reply};
use reqwest::Url;
use serde_json::json;
use yforge_core::{CancelToken, CoreError, PlatformKind};
use yforge_platform::oauth::{
    git_https_username, refresh, sign_in, OAuthEndpoints, OAuthRecord, PlatformOAuthMethod,
    PlatformOAuthStage,
};
use yforge_platform::PlatformError;

type Stages = Arc<Mutex<Vec<PlatformOAuthStage>>>;

fn collector() -> (Stages, impl Fn(PlatformOAuthStage) + Send + Sync + Clone) {
    let seen: Stages = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (seen, move |stage| sink.lock().unwrap().push(stage))
}

fn record(access: &str, refresh: Option<&str>, client: &str, secret: Option<&str>) -> OAuthRecord {
    OAuthRecord {
        access_token: access.to_owned(),
        refresh_token: refresh.map(str::to_owned),
        expires_at: None,
        client_id: client.to_owned(),
        client_secret: secret.map(str::to_owned),
    }
}

async fn wait_stage(seen: &Stages) -> PlatformOAuthStage {
    for _ in 0..100 {
        if let Some(stage) = seen.lock().unwrap().first().cloned() {
            return stage;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the OAuth stage was never emitted");
}

fn query(url: &Url, name: &str) -> String {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| panic!("no {name}"))
}

#[tokio::test]
async fn github_device_flow_polls_pending_then_returns_tokens() {
    let polls = Arc::new(AtomicUsize::new(0));
    let counter = polls.clone();
    let fake = HttpFake::start(move |request| match request.path.as_str() {
        "/login/device/code" => Reply::ok(
            &json!({
                "device_code": "dev-1",
                "user_code": "USER-1",
                "verification_uri": "https://github.com/login/device",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        "/login/oauth/access_token" => {
            if counter.fetch_add(1, Ordering::SeqCst) == 0 {
                Reply::ok(r#"{"error":"authorization_pending"}"#)
            } else {
                Reply::ok(
                    &json!({
                        "access_token": "gh-access",
                        "refresh_token": "gh-refresh",
                        "expires_in": 3600
                    })
                    .to_string(),
                )
            }
        }
        other => panic!("unexpected {other}"),
    });
    let endpoints = OAuthEndpoints {
        github_base: Some(format!("http://{}", fake.host)),
        ..OAuthEndpoints::default()
    };
    let (seen, sink) = collector();

    let result = sign_in(
        PlatformKind::GitHub,
        "github.com",
        "gh-client",
        None,
        PlatformOAuthMethod::DeviceCode,
        &endpoints,
        false,
        &CancelToken::new(),
        &sink,
    )
    .await
    .unwrap();

    assert_eq!(result.access_token, "gh-access");
    assert_eq!(result.refresh_token.as_deref(), Some("gh-refresh"));
    assert_eq!(result.client_id, "gh-client");
    assert!(result.expires_at.is_some_and(|expires| expires > 0));
    assert!(!format!("{result:?}").contains("gh-access"));
    assert_eq!(polls.load(Ordering::SeqCst), 2);
    assert_eq!(
        *seen.lock().unwrap(),
        [PlatformOAuthStage::DeviceCode {
            url: "https://github.com/login/device".to_owned(),
            code: "USER-1".to_owned()
        }]
    );
    let requests = fake.requests();
    assert!(requests[0].body.contains("client_id=gh-client"));
    assert!(requests[0].body.contains("scope=repo+read%3Aorg"));
    assert!(requests[1]
        .body
        .contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
    assert!(requests[1].body.contains("device_code=dev-1"));
}

#[tokio::test]
async fn gitlab_pkce_loopback_exchanges_code_and_refresh_rotates_tokens() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/oauth/token" if request.body.contains("grant_type=refresh_token") => Reply::ok(
            &json!({
                "access_token": "gl-new",
                "refresh_token": "gl-refresh-2",
                "expires_in": 7200
            })
            .to_string(),
        ),
        "/oauth/token" => Reply::ok(
            &json!({
                "access_token": "gl-access",
                "refresh_token": "gl-refresh-1",
                "expires_in": 7200
            })
            .to_string(),
        ),
        other => panic!("unexpected {other}"),
    });
    let endpoints = OAuthEndpoints {
        gitlab_base: Some(format!("http://{}", fake.host)),
        ..OAuthEndpoints::default()
    };
    let (seen, sink) = collector();
    let flow_endpoints = endpoints.clone();
    let task = tokio::spawn(async move {
        sign_in(
            PlatformKind::GitLab,
            "gitlab.com",
            "gl-client",
            Some("gl-secret"),
            PlatformOAuthMethod::Browser,
            &flow_endpoints,
            false,
            &CancelToken::new(),
            &sink,
        )
        .await
    });
    let stage = wait_stage(&seen).await;
    let PlatformOAuthStage::Browser { url } = stage else {
        panic!("expected a browser stage");
    };
    let url = Url::parse(&url).unwrap();
    assert_eq!(url.path(), "/oauth/authorize");
    assert_eq!(query(&url, "response_type"), "code");
    assert_eq!(query(&url, "scope"), "api read_user write_repository");
    assert_eq!(query(&url, "code_challenge_method"), "S256");
    assert_eq!(query(&url, "code_challenge").len(), 43);
    let redirect = query(&url, "redirect_uri");
    let page = reqwest::get(format!(
        "{redirect}?code=code-1&state={}",
        query(&url, "state")
    ))
    .await
    .unwrap();
    assert_eq!(page.status(), 200);
    assert!(page
        .text()
        .await
        .unwrap()
        .contains("Signed in to YForge. You can close this tab."));

    let result = task.await.unwrap().unwrap();
    assert_eq!(result.access_token, "gl-access");
    assert_eq!(result.refresh_token.as_deref(), Some("gl-refresh-1"));

    let refreshed = refresh(
        PlatformKind::GitLab,
        "gitlab.com",
        &result,
        &endpoints,
        false,
        &CancelToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(refreshed.access_token, "gl-new");
    assert_eq!(refreshed.refresh_token.as_deref(), Some("gl-refresh-2"));

    let requests = fake.requests();
    let exchange = &requests[0];
    assert!(exchange.body.contains("grant_type=authorization_code"));
    assert!(exchange.body.contains("code=code-1"));
    assert!(exchange.body.contains("client_id=gl-client"));
    let verifier = exchange
        .body
        .split('&')
        .find_map(|pair| pair.strip_prefix("code_verifier="))
        .unwrap();
    assert_eq!(verifier.len(), 43);
    let rotation = &requests[1];
    assert!(rotation.body.contains("grant_type=refresh_token"));
    assert!(rotation.body.contains("refresh_token=gl-refresh-1"));
}

#[tokio::test]
async fn bitbucket_refresh_uses_basic_auth_and_returns_rotated_tokens() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/site/oauth2/access_token" => Reply::ok(
            &json!({
                "access_token": "bb-new",
                "refresh_token": "bb-refresh-2",
                "expires_in": 3600
            })
            .to_string(),
        ),
        other => panic!("unexpected {other}"),
    });
    let endpoints = OAuthEndpoints {
        bitbucket_base: Some(format!("http://{}", fake.host)),
        ..OAuthEndpoints::default()
    };
    let stored = record(
        "bb-old",
        Some("bb-refresh-1"),
        "bb-client",
        Some("bb-secret"),
    );

    let refreshed = refresh(
        PlatformKind::Bitbucket,
        "bitbucket.org",
        &stored,
        &endpoints,
        false,
        &CancelToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(refreshed.access_token, "bb-new");
    assert_eq!(refreshed.refresh_token.as_deref(), Some("bb-refresh-2"));
    let request = &fake.requests()[0];
    assert!(request
        .header("authorization")
        .is_some_and(|value| value.starts_with("Basic ")));
    assert!(request.body.contains("grant_type=refresh_token"));
    assert!(request.body.contains("refresh_token=bb-refresh-1"));
    assert!(request.body.contains("client_id=bb-client"));
}

#[tokio::test]
async fn github_device_flow_stops_when_cancelled() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/login/device/code" => Reply::ok(
            &json!({
                "device_code": "dev-1",
                "user_code": "USER-1",
                "verification_uri": "https://github.com/login/device",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        "/login/oauth/access_token" => Reply::ok(r#"{"error":"authorization_pending"}"#),
        other => panic!("unexpected {other}"),
    });
    let endpoints = OAuthEndpoints {
        github_base: Some(format!("http://{}", fake.host)),
        ..OAuthEndpoints::default()
    };
    let (seen, sink) = collector();
    let cancel = CancelToken::new();
    let stopper = cancel.clone();
    let task = tokio::spawn(async move {
        sign_in(
            PlatformKind::GitHub,
            "github.com",
            "gh-client",
            None,
            PlatformOAuthMethod::DeviceCode,
            &endpoints,
            false,
            &cancel,
            &sink,
        )
        .await
    });
    wait_stage(&seen).await;
    stopper.cancel();

    let error = task.await.unwrap().unwrap_err();
    assert!(matches!(error, PlatformError::Core(CoreError::Cancelled)));
}

#[tokio::test]
async fn bitbucket_data_center_oauth_is_rejected_without_a_request() {
    let error = sign_in(
        PlatformKind::Bitbucket,
        "bitbucket.example.com",
        "bb-client",
        Some("bb-secret"),
        PlatformOAuthMethod::Browser,
        &OAuthEndpoints::default(),
        false,
        &CancelToken::new(),
        &|_| {},
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.detail(),
        "Bitbucket Data Center uses personal access tokens; paste an HTTP access token instead"
    );
}

#[test]
fn git_https_username_maps_each_platform() {
    assert_eq!(
        git_https_username(PlatformKind::GitHub, "github.com", Some("yui")),
        "x-access-token"
    );
    assert_eq!(
        git_https_username(PlatformKind::GitHub, "ghe.example.com", None),
        "x-access-token"
    );
    assert_eq!(
        git_https_username(PlatformKind::GitLab, "gitlab.com", Some("yui")),
        "oauth2"
    );
    assert_eq!(
        git_https_username(PlatformKind::Bitbucket, "bitbucket.org", Some("yui")),
        "x-token-auth"
    );
    assert_eq!(
        git_https_username(
            PlatformKind::Bitbucket,
            "bitbucket.example.com",
            Some("yui")
        ),
        "yui"
    );
    assert_eq!(
        git_https_username(PlatformKind::Bitbucket, "bitbucket.example.com", Some("  ")),
        "x-token-auth"
    );
    assert_eq!(
        git_https_username(PlatformKind::Bitbucket, "bitbucket.example.com", None),
        "x-token-auth"
    );
}

#[test]
fn oauth_record_expiry_uses_a_one_minute_buffer() {
    let mut stored = record("access", None, "client", None);
    stored.expires_at = Some(120_000);
    assert!(!stored.expired(59_999));
    assert!(stored.expired(60_000));
    stored.expires_at = None;
    assert!(!stored.expired(i64::MAX));
}
