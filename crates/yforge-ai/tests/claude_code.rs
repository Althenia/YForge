mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use common::{
    add_active, claude_blob, commit_context, messages_reply, provider_input, store_tokens, Harness,
    HttpFake, Reply, FAR_FUTURE, GOOD,
};
use reqwest::Url;
use serde_json::{json, Value};
use yforge_ai::{Ai, Endpoints, SecretStore, CLAUDE_CODE_SERVICE};
use yforge_core::{
    AiFeature, AiSignInMethod, AiSignInStage, AuthMode, CancelToken, CoreError, ProviderKind,
    ProviderStatus,
};

async fn claude_provider(h: &Harness, ai: &Ai) -> String {
    add_active(
        h,
        ai,
        provider_input(ProviderKind::Claude, AuthMode::Subscription, "Claude"),
        "claude-x",
    )
    .await
}

fn claude_fake(refreshes: Arc<AtomicUsize>) -> HttpFake {
    HttpFake::start(move |request| match request.path.as_str() {
        "/oauth/token" => {
            refreshes.fetch_add(1, Ordering::SeqCst);
            Reply::ok(
                &json!({"access_token": "refreshed", "refresh_token": "rotated", "expires_in": 3600})
                    .to_string(),
            )
        }
        "/v1/messages" => Reply::ok(&messages_reply(GOOD)),
        other => panic!("unexpected {other}"),
    })
}

fn endpoints(fake: &HttpFake) -> Endpoints {
    Endpoints {
        anthropic_api: fake.url.clone(),
        claude_token: format!("{}/oauth/token", fake.root),
        ..Endpoints::default()
    }
}

#[tokio::test]
async fn without_claude_code_credentials_every_use_asks_to_sign_in_to_claude_code_first() {
    let h = Harness::new();
    let ai = h.ai();
    let id = claude_provider(&h, &ai).await;

    let resolved = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap_err();
    let models = ai.models(h.dir(), &id).await.unwrap_err();
    let signed_in = ai
        .sign_in(
            h.dir(),
            &id,
            AiSignInMethod::Browser,
            &CancelToken::new(),
            &|_| {},
        )
        .await
        .unwrap_err();

    for error in [resolved, models, signed_in] {
        match CoreError::from(error) {
            CoreError::AiAuthRequired { detail, .. } => {
                assert_eq!(detail, "Sign in to Claude Code first")
            }
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(
        ai.list(h.dir()).await.unwrap()[0].status,
        ProviderStatus::SignedOut
    );
}

#[tokio::test]
async fn unreadable_credentials_count_as_signed_out() {
    let h = Harness::new();
    let ai = h.ai();
    claude_provider(&h, &ai).await;
    h.claude_code_signs_in(r#"{"mcpOAuth":{"server":{}}}"#);

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
async fn signing_in_confirms_the_credentials_and_writes_nothing_to_claude_codes_store() {
    let h = Harness::new();
    let ai = h.ai();
    let id = claude_provider(&h, &ai).await;
    let blob = claude_blob("cc-access", "cc-refresh", FAR_FUTURE);
    h.claude_code_signs_in(&blob);
    let stages = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = stages.clone();

    let status = ai
        .sign_in(
            h.dir(),
            &id,
            AiSignInMethod::Browser,
            &CancelToken::new(),
            &move |stage| sink.lock().unwrap().push(stage),
        )
        .await
        .unwrap();

    assert_eq!(status, ProviderStatus::Ready);
    assert_eq!(
        *stages.lock().unwrap(),
        [AiSignInStage::Completed {
            status: ProviderStatus::Ready
        }]
    );
    assert_eq!(
        h.claude_code.get(CLAUDE_CODE_SERVICE).unwrap().as_deref(),
        Some(blob.as_str())
    );
    assert_eq!(h.claude_code.accounts(), [CLAUDE_CODE_SERVICE]);
    assert!(h.secrets.accounts().is_empty());
    assert_eq!(
        ai.list(h.dir()).await.unwrap()[0].status,
        ProviderStatus::Ready
    );
}

#[tokio::test]
async fn an_unexpired_credential_is_used_as_is_without_a_refresh() {
    let h = Harness::new();
    let refreshes = Arc::new(AtomicUsize::new(0));
    let fake = claude_fake(refreshes.clone());
    let ai = h.ai_at(endpoints(&fake));
    claude_provider(&h, &ai).await;
    h.claude_code_signs_in(&claude_blob("cc-access", "cc-refresh", FAR_FUTURE));

    let selection = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap();
    ai.commit_message(&selection, &commit_context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(refreshes.load(Ordering::SeqCst), 0);
    assert_eq!(
        fake.requests()[0].header("authorization"),
        Some("Bearer cc-access")
    );
}

#[tokio::test]
async fn an_expired_credential_is_refreshed_cached_in_yforge_and_claude_codes_store_stays_untouched(
) {
    let h = Harness::new();
    let refreshes = Arc::new(AtomicUsize::new(0));
    let fake = claude_fake(refreshes.clone());
    let ai = h.ai_at(endpoints(&fake));
    let id = claude_provider(&h, &ai).await;
    let blob = claude_blob("cc-old", "cc-refresh", 1);
    h.claude_code_signs_in(&blob);

    for _ in 0..2 {
        let selection = ai
            .resolve(h.dir(), AiFeature::GenerateCommit)
            .await
            .unwrap();
        ai.commit_message(&selection, &commit_context(), &CancelToken::new())
            .await
            .unwrap();
    }

    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    let requests = fake.requests();
    let refresh = requests.iter().find(|r| r.path == "/oauth/token").unwrap();
    assert_eq!(
        refresh.header("content-type"),
        Some("application/x-www-form-urlencoded")
    );
    let pairs: Vec<(String, String)> = Url::parse(&format!("http://x/?{}", refresh.body))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let field = |name: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    };
    assert_eq!(field("grant_type"), Some("refresh_token"));
    assert_eq!(
        field("client_id"),
        Some("9d1c250a-e61b-44d9-88ed-5944d1962f5e")
    );
    assert_eq!(field("refresh_token"), Some("cc-refresh"));
    for run in requests.iter().filter(|r| r.path == "/v1/messages") {
        assert_eq!(run.header("authorization"), Some("Bearer refreshed"));
    }
    assert_eq!(
        h.claude_code.get(CLAUDE_CODE_SERVICE).unwrap().as_deref(),
        Some(blob.as_str())
    );
    let cached: Value =
        serde_json::from_str(&h.secrets.get(&format!("{id}:oauth")).unwrap().unwrap()).unwrap();
    assert_eq!(cached["accessToken"], "refreshed");
    assert_eq!(cached["refreshToken"], "rotated");
}

#[tokio::test]
async fn a_fresher_cached_credential_wins_over_an_expired_claude_code_one() {
    let h = Harness::new();
    let refreshes = Arc::new(AtomicUsize::new(0));
    let fake = claude_fake(refreshes.clone());
    let ai = h.ai_at(endpoints(&fake));
    let id = claude_provider(&h, &ai).await;
    h.claude_code_signs_in(&claude_blob("cc-old", "cc-refresh", 1));
    store_tokens(
        &h,
        &id,
        &json!({"accessToken": "cached", "refreshToken": "c-r", "expiresAt": FAR_FUTURE})
            .to_string(),
    );

    let selection = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap();
    ai.commit_message(&selection, &commit_context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(refreshes.load(Ordering::SeqCst), 0);
    assert_eq!(
        fake.requests()[0].header("authorization"),
        Some("Bearer cached")
    );
}

#[tokio::test]
async fn a_refresh_the_server_rejects_asks_to_sign_in_to_claude_code_again() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::status(400, r#"{"error":"invalid_grant"}"#));
    let ai = h.ai_at(endpoints(&fake));
    claude_provider(&h, &ai).await;
    h.claude_code_signs_in(&claude_blob("cc-old", "cc-refresh", 1));

    let error = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiAuthRequired { detail, .. } => {
            assert!(detail.contains("sign in to Claude Code"))
        }
        other => panic!("{other:?}"),
    }
    assert!(h.secrets.accounts().is_empty());
}
