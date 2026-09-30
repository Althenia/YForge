mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{
    add_active, chatgpt_tokens, commit_context, jwt, provider_input, store_tokens, Harness,
    HttpFake, Recorded, Reply, GOOD,
};
use reqwest::Url;
use serde_json::{json, Value};
use yforge_ai::{Ai, Endpoints, Limits};
use yforge_core::{
    AiFeature, AiSignInMethod, AiSignInStage, AuthMode, CancelToken, CoreError, ProviderKind,
    ProviderStatus,
};

type Stages = Arc<Mutex<Vec<AiSignInStage>>>;

fn collector() -> (Stages, impl Fn(AiSignInStage) + Send + Sync + Clone) {
    let seen: Stages = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (seen, move |stage| sink.lock().unwrap().push(stage))
}

fn token_reply(access: &str, refresh: Option<&str>, id_token: Option<&str>) -> String {
    json!({
        "access_token": access,
        "refresh_token": refresh,
        "id_token": id_token,
        "expires_in": 3600,
    })
    .to_string()
}

fn form(request: &Recorded) -> Vec<(String, String)> {
    Url::parse(&format!("http://x/?{}", request.body))
        .unwrap()
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect()
}

fn field(pairs: &[(String, String)], name: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

fn auth_endpoints(fake: &HttpFake) -> Endpoints {
    Endpoints {
        openai_auth: fake.root.clone(),
        callback_port: 0,
        ..Endpoints::default()
    }
}

async fn chatgpt_provider(h: &Harness, ai: &Ai) -> String {
    add_active(
        h,
        ai,
        provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "ChatGPT"),
        "gpt-5.5",
    )
    .await
}

fn stored_tokens(h: &Harness, id: &str) -> Value {
    let text = yforge_ai::SecretStore::get(&*h.secrets, &format!("{id}:oauth"))
        .unwrap()
        .expect("tokens are stored");
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn the_headless_flow_shows_the_code_polls_until_approved_and_stores_the_tokens() {
    let h = Harness::new();
    let id_token = jwt(&json!({"chatgpt_account_id": "acct-9"}));
    let polls = Arc::new(AtomicUsize::new(0));
    let counter = polls.clone();
    let fake = HttpFake::start(move |request| match request.path.as_str() {
        "/api/accounts/deviceauth/usercode" => Reply::ok(
            &json!({"device_auth_id": "dev-1", "user_code": "ABCD-1234", "interval": "0"})
                .to_string(),
        ),
        "/api/accounts/deviceauth/token" if counter.fetch_add(1, Ordering::SeqCst) < 2 => {
            Reply::status(403, "pending")
        }
        "/api/accounts/deviceauth/token" => Reply::ok(
            &json!({"authorization_code": "auth-1", "code_verifier": "ver-1"}).to_string(),
        ),
        "/oauth/token" => Reply::ok(&token_reply("acc-1", Some("ref-1"), Some(&id_token))),
        other => panic!("unexpected {other}"),
    });
    let ai = h.ai_at(auth_endpoints(&fake));
    let id = chatgpt_provider(&h, &ai).await;
    let (seen, sink) = collector();

    let status = ai
        .sign_in(
            h.dir(),
            &id,
            AiSignInMethod::DeviceCode,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap();

    assert_eq!(status, ProviderStatus::Ready);
    assert_eq!(
        *seen.lock().unwrap(),
        [
            AiSignInStage::DeviceCode {
                url: format!("{}/codex/device", fake.root),
                code: "ABCD-1234".to_owned()
            },
            AiSignInStage::Completed {
                status: ProviderStatus::Ready
            }
        ]
    );
    let requests = fake.requests();
    assert_eq!(polls.load(Ordering::SeqCst), 3);
    assert_eq!(
        serde_json::from_str::<Value>(&requests[0].body).unwrap(),
        json!({"client_id": "app_EMoamEEZ73f0CkXaXp7hrann"})
    );
    assert_eq!(
        serde_json::from_str::<Value>(&requests[1].body).unwrap(),
        json!({"device_auth_id": "dev-1", "user_code": "ABCD-1234"})
    );
    let exchange = requests.last().unwrap();
    assert_eq!(
        exchange.header("content-type"),
        Some("application/x-www-form-urlencoded")
    );
    let pairs = form(exchange);
    assert_eq!(
        field(&pairs, "grant_type").as_deref(),
        Some("authorization_code")
    );
    assert_eq!(field(&pairs, "code").as_deref(), Some("auth-1"));
    assert_eq!(field(&pairs, "code_verifier").as_deref(), Some("ver-1"));
    assert_eq!(
        field(&pairs, "redirect_uri"),
        Some(format!("{}/deviceauth/callback", fake.root))
    );
    assert_eq!(
        field(&pairs, "client_id").as_deref(),
        Some("app_EMoamEEZ73f0CkXaXp7hrann")
    );
    let tokens = stored_tokens(&h, &id);
    assert_eq!(tokens["access"], "acc-1");
    assert_eq!(tokens["refresh"], "ref-1");
    assert_eq!(tokens["account_id"], "acct-9");
    let listed = ai.list(h.dir()).await.unwrap();
    assert_eq!(listed[0].status, ProviderStatus::Ready);
}

#[tokio::test]
async fn a_failing_device_poll_stops_the_flow_without_storing_anything() {
    let h = Harness::new();
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/api/accounts/deviceauth/usercode" => {
            Reply::ok(&json!({"device_auth_id": "d", "user_code": "C", "interval": 0}).to_string())
        }
        _ => Reply::status(500, "boom"),
    });
    let ai = h.ai_at(auth_endpoints(&fake));
    let id = chatgpt_provider(&h, &ai).await;
    let (_, sink) = collector();

    let error = ai
        .sign_in(
            h.dir(),
            &id,
            AiSignInMethod::DeviceCode,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();

    assert!(matches!(CoreError::from(error), CoreError::AiFailed { .. }));
    assert!(h.secrets.accounts().is_empty());
}

#[tokio::test]
async fn cancelling_and_timing_out_end_a_pending_device_flow() {
    let h = Harness::new();
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/api/accounts/deviceauth/usercode" => Reply::ok(
            &json!({"device_auth_id": "d", "user_code": "C", "interval": "0"}).to_string(),
        ),
        _ => Reply::status(404, "pending"),
    });
    let ai = h.ai_at(auth_endpoints(&fake));
    let id = chatgpt_provider(&h, &ai).await;
    let (_, sink) = collector();
    let token = CancelToken::new();
    let stopper = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        stopper.cancel();
    });

    let cancelled = ai
        .sign_in(h.dir(), &id, AiSignInMethod::DeviceCode, &token, &sink)
        .await
        .unwrap_err();
    let short = h.ai_with(
        Limits {
            sign_in: Duration::from_millis(400),
            ..common::test_limits()
        },
        auth_endpoints(&fake),
    );
    let timed_out = short
        .sign_in(
            h.dir(),
            &id,
            AiSignInMethod::DeviceCode,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();

    assert!(matches!(CoreError::from(cancelled), CoreError::Cancelled));
    assert!(matches!(
        CoreError::from(timed_out),
        CoreError::AiTimeout { .. }
    ));
    assert!(h.secrets.accounts().is_empty());
}

async fn start_browser_flow(
    h: &Harness,
    fake: &HttpFake,
) -> (
    tokio::task::JoinHandle<Result<ProviderStatus, yforge_ai::AiError>>,
    Stages,
    String,
) {
    let ai = Arc::new(h.ai_at(auth_endpoints(fake)));
    let id = chatgpt_provider(h, &ai).await;
    let (seen, sink) = collector();
    let dir = h.dir().to_owned();
    let provider = id.clone();
    let task = tokio::spawn(async move {
        ai.sign_in(
            &dir,
            &provider,
            AiSignInMethod::Browser,
            &CancelToken::new(),
            &sink,
        )
        .await
    });
    (task, seen, id)
}

async fn authorize_url(seen: &Stages) -> Url {
    for _ in 0..100 {
        if let Some(AiSignInStage::Browser { url }) = seen.lock().unwrap().first() {
            return Url::parse(url).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the browser URL was never emitted");
}

fn query(url: &Url, name: &str) -> String {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_else(|| panic!("no {name}"))
}

#[tokio::test]
async fn the_browser_flow_listens_for_the_callback_and_exchanges_the_code_with_the_verifier() {
    let h = Harness::new();
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/oauth/token" => Reply::ok(&token_reply(
            "acc-b",
            Some("ref-b"),
            Some(&jwt(&json!({"organizations": [{"id": "org-5"}]}))),
        )),
        other => panic!("unexpected {other}"),
    });
    let (task, seen, id) = start_browser_flow(&h, &fake).await;
    let url = authorize_url(&seen).await;

    assert_eq!(url.path(), "/oauth/authorize");
    assert_eq!(query(&url, "code_challenge_method"), "S256");
    assert_eq!(query(&url, "originator"), "yforge");
    let redirect = query(&url, "redirect_uri");
    assert!(redirect.starts_with("http://localhost:") && redirect.ends_with("/auth/callback"));
    let callback = format!(
        "{}?code=code-1&state={}",
        redirect.replace("localhost", "127.0.0.1"),
        query(&url, "state")
    );
    let page = reqwest::get(&callback).await.unwrap();
    assert_eq!(page.status(), 200);
    let status = task.await.unwrap().unwrap();

    assert_eq!(status, ProviderStatus::Ready);
    let exchange = fake
        .requests()
        .into_iter()
        .find(|r| r.path == "/oauth/token")
        .unwrap();
    let pairs = form(&exchange);
    assert_eq!(
        field(&pairs, "grant_type").as_deref(),
        Some("authorization_code")
    );
    assert_eq!(field(&pairs, "code").as_deref(), Some("code-1"));
    assert_eq!(field(&pairs, "redirect_uri"), Some(redirect));
    let verifier = field(&pairs, "code_verifier").unwrap();
    assert_eq!(verifier.len(), 43);
    assert_ne!(verifier, query(&url, "code_challenge"));
    let tokens = stored_tokens(&h, &id);
    assert_eq!(tokens["account_id"], "org-5");
    assert!(matches!(
        seen.lock().unwrap().last(),
        Some(AiSignInStage::Completed {
            status: ProviderStatus::Ready
        })
    ));
}

#[tokio::test]
async fn a_callback_with_the_wrong_state_or_an_error_is_refused_and_nothing_is_exchanged() {
    for suffix in ["code=stolen&state=wrong", "error=access_denied&state=x"] {
        let h = Harness::new();
        let fake = HttpFake::start(|_| Reply::status(500, "must not be called"));
        let (task, seen, _) = start_browser_flow(&h, &fake).await;
        let url = authorize_url(&seen).await;
        let redirect = query(&url, "redirect_uri").replace("localhost", "127.0.0.1");

        let page = reqwest::get(format!("{redirect}?{suffix}")).await.unwrap();
        let error = task.await.unwrap().unwrap_err();

        assert_eq!(page.status(), 400, "{suffix}");
        assert!(
            matches!(CoreError::from(error), CoreError::AiAuthRequired { .. }),
            "{suffix}"
        );
        assert!(fake.requests().is_empty(), "{suffix}");
        assert!(h.secrets.accounts().is_empty(), "{suffix}");
    }
}

#[tokio::test]
async fn unrelated_requests_to_the_callback_port_do_not_end_the_flow() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&token_reply("acc", Some("ref"), None)));
    let (task, seen, _) = start_browser_flow(&h, &fake).await;
    let url = authorize_url(&seen).await;
    let redirect = query(&url, "redirect_uri").replace("localhost", "127.0.0.1");
    let root = redirect.trim_end_matches("/auth/callback");

    let stray = reqwest::get(format!("{root}/favicon.ico")).await.unwrap();
    assert_eq!(stray.status(), 404);
    assert!(!task.is_finished());
    reqwest::get(format!("{redirect}?code=c&state={}", query(&url, "state")))
        .await
        .unwrap();

    assert_eq!(task.await.unwrap().unwrap(), ProviderStatus::Ready);
}

async fn expired_provider(h: &Harness, ai: &Ai, account: Option<&str>) -> String {
    let id = chatgpt_provider(h, ai).await;
    store_tokens(h, &id, &chatgpt_tokens("old-access", 1, account));
    id
}

fn complete_fake() -> HttpFake {
    let refreshes = Arc::new(AtomicUsize::new(0));
    HttpFake::start(move |request| match request.path.as_str() {
        "/oauth/token" => {
            refreshes.fetch_add(1, Ordering::SeqCst);
            Reply::ok(&token_reply("new-access", Some("new-refresh"), None))
        }
        "/backend-api/codex/responses" => Reply::ok(&common::responses_reply(GOOD)),
        other => panic!("unexpected {other}"),
    })
}

#[tokio::test]
async fn expired_tokens_are_refreshed_once_kept_and_used_for_the_request() {
    let h = Harness::new();
    let fake = complete_fake();
    let ai = h.ai_at(Endpoints {
        chatgpt_backend: format!("{}/backend-api/codex", fake.root),
        ..auth_endpoints(&fake)
    });
    let id = expired_provider(&h, &ai, Some("acct-keep")).await;

    for _ in 0..2 {
        let selection = ai
            .resolve(h.dir(), AiFeature::GenerateCommit)
            .await
            .unwrap();
        ai.commit_message(&selection, &commit_context(), &CancelToken::new())
            .await
            .unwrap();
    }

    let requests = fake.requests();
    let refreshes: Vec<_> = requests
        .iter()
        .filter(|r| r.path == "/oauth/token")
        .collect();
    assert_eq!(refreshes.len(), 1);
    let pairs = form(refreshes[0]);
    assert_eq!(
        field(&pairs, "grant_type").as_deref(),
        Some("refresh_token")
    );
    assert_eq!(field(&pairs, "refresh_token").as_deref(), Some("refresh-1"));
    assert_eq!(
        field(&pairs, "client_id").as_deref(),
        Some("app_EMoamEEZ73f0CkXaXp7hrann")
    );
    let runs: Vec<_> = requests
        .iter()
        .filter(|r| r.path.ends_with("/responses"))
        .collect();
    assert_eq!(runs.len(), 2);
    for run in runs {
        assert_eq!(run.header("authorization"), Some("Bearer new-access"));
        assert_eq!(run.header("chatgpt-account-id"), Some("acct-keep"));
    }
    let tokens = stored_tokens(&h, &id);
    assert_eq!(tokens["refresh"], "new-refresh");
    assert_eq!(tokens["account_id"], "acct-keep");
}

#[tokio::test]
async fn a_refresh_the_server_rejects_asks_for_a_new_sign_in() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::status(401, r#"{"error":"refresh_token_reused"}"#));
    let ai = h.ai_at(auth_endpoints(&fake));
    expired_provider(&h, &ai, None).await;

    let error = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap_err();

    assert!(matches!(
        CoreError::from(error),
        CoreError::AiAuthRequired { .. }
    ));
}

#[tokio::test]
async fn a_refresh_reply_without_a_new_refresh_token_keeps_the_old_one() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&token_reply("fresh", None, None)));
    let ai = h.ai_at(auth_endpoints(&fake));
    let id = expired_provider(&h, &ai, Some("acct")).await;

    ai.resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap();

    let tokens = stored_tokens(&h, &id);
    assert_eq!(
        (tokens["access"].as_str(), tokens["refresh"].as_str()),
        (Some("fresh"), Some("refresh-1"))
    );
}
