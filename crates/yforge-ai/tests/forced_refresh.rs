mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use common::{
    add_configured, chatgpt_tokens, provider_input, store_tokens, Harness, HttpFake, Reply,
    FAR_FUTURE,
};
use serde_json::{json, Value};
use yforge_ai::{Ai, Endpoints, SecretStore};
use yforge_core::{AuthMode, CoreError, ProviderKind, ProviderStatus};

async fn chatgpt_provider(h: &Harness, ai: &Ai) -> String {
    add_configured(
        h,
        ai,
        provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "ChatGPT"),
        "gpt-5.5",
    )
    .await
}

fn endpoints(fake: &HttpFake) -> Endpoints {
    Endpoints {
        openai_auth: fake.root.clone(),
        chatgpt_backend: format!("{}/backend-api/codex", fake.root),
        ..Endpoints::default()
    }
}

fn token_reply(access: &str, refresh: &str) -> String {
    json!({
        "access_token": access,
        "refresh_token": refresh,
        "expires_in": 3600,
    })
    .to_string()
}

#[tokio::test]
async fn unexpired_chatgpt_token_rejected_with_401_refreshes_and_retries_models() {
    let h = Harness::new();
    let models_calls = Arc::new(AtomicUsize::new(0));
    let counter = models_calls.clone();
    let fake = HttpFake::start(move |request| match request.path.as_str() {
        "/oauth/token" => Reply::ok(&token_reply("new-access", "new-refresh")),
        path if path.starts_with("/backend-api/codex/models") => {
            counter.fetch_add(1, Ordering::SeqCst);
            if request.header("authorization") == Some("Bearer new-access") {
                Reply::ok(
                    &json!({"models": [{"slug": "gpt-5.5", "display_name": "GPT-5.5"}]})
                        .to_string(),
                )
            } else {
                Reply::status(401, r#"{"error":{"message":"token revoked"}}"#)
            }
        }
        other => panic!("unexpected {other}"),
    });
    let ai = h.ai_at(endpoints(&fake));
    let id = chatgpt_provider(&h, &ai).await;
    store_tokens(
        &h,
        &id,
        &chatgpt_tokens("old-access", FAR_FUTURE, Some("acct-1")),
    );

    let models = ai.models(h.dir(), &id).await.unwrap();

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gpt-5.5");
    assert_eq!(models_calls.load(Ordering::SeqCst), 2);
    let requests = fake.requests();
    let refreshes: Vec<_> = requests
        .iter()
        .filter(|r| r.path == "/oauth/token")
        .collect();
    assert_eq!(refreshes.len(), 1);
    assert!(refreshes[0].body.contains("grant_type=refresh_token"));
    assert!(refreshes[0].body.contains("refresh_token=refresh-1"));
    let stored = h
        .secrets
        .get(&format!("{id}:oauth"))
        .unwrap()
        .expect("refreshed tokens are stored");
    let stored: Value = serde_json::from_str(&stored).unwrap();
    assert_eq!(stored["access"], "new-access");
    assert_eq!(stored["refresh"], "new-refresh");
    assert_eq!(
        ai.list(h.dir()).await.unwrap()[0].status,
        ProviderStatus::Ready
    );
}

#[tokio::test]
async fn unexpired_chatgpt_token_rejected_and_refresh_rejected_clears_to_signed_out() {
    let h = Harness::new();
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/oauth/token" => Reply::status(400, r#"{"error":"invalid_grant"}"#),
        path if path.starts_with("/backend-api/codex/models") => {
            Reply::status(401, r#"{"error":{"message":"token revoked"}}"#)
        }
        other => panic!("unexpected {other}"),
    });
    let ai = h.ai_at(endpoints(&fake));
    let id = chatgpt_provider(&h, &ai).await;
    store_tokens(&h, &id, &chatgpt_tokens("old-access", FAR_FUTURE, None));

    let error = ai.models(h.dir(), &id).await.unwrap_err();

    assert!(matches!(
        CoreError::from(error),
        CoreError::AiAuthRequired { .. }
    ));
    assert_eq!(h.secrets.get(&format!("{id}:oauth")).unwrap(), None);
    assert_eq!(
        ai.list(h.dir()).await.unwrap()[0].status,
        ProviderStatus::SignedOut
    );
}

#[tokio::test]
async fn sign_out_clears_subscription_credentials_and_keeps_provider_and_features() {
    let h = Harness::new();
    let ai = h.ai();
    let id = chatgpt_provider(&h, &ai).await;
    store_tokens(&h, &id, &chatgpt_tokens("old-access", FAR_FUTURE, None));
    assert_eq!(
        ai.list(h.dir()).await.unwrap()[0].status,
        ProviderStatus::Ready
    );

    let status = ai.sign_out(h.dir(), &id).await.unwrap();

    assert_eq!(status, ProviderStatus::SignedOut);
    assert_eq!(h.secrets.get(&format!("{id}:oauth")).unwrap(), None);
    let listed = ai.list(h.dir()).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].config.id, id);
    assert_eq!(listed[0].status, ProviderStatus::SignedOut);
    let features = ai.feature_configs(h.dir()).await.unwrap();
    assert!(!features.is_empty());
    assert!(features.iter().all(|summary| summary
        .config
        .as_ref()
        .is_some_and(|config| config.provider_id == id)));
}
