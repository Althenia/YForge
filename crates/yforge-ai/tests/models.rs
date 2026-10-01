mod common;

use common::{
    add_configured, chatgpt_tokens, claude_blob, keyed_input, provider_input, store_tokens,
    Harness, HttpFake, Reply, FAR_FUTURE,
};
use serde_json::json;
use yforge_ai::Endpoints;
use yforge_core::{AuthMode, CoreError, ModelInfo, ProviderKind};

fn info(id: &str, name: &str, window: Option<u32>) -> ModelInfo {
    ModelInfo {
        id: id.to_owned(),
        display_name: name.to_owned(),
        context_window: window,
    }
}

async fn listed(h: &Harness, ai: &yforge_ai::Ai, id: &str) -> Vec<ModelInfo> {
    ai.models(h.dir(), id).await.unwrap()
}

#[tokio::test]
async fn openai_keys_list_model_ids_from_the_models_endpoint() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(&json!({"data": [{"id": "gpt-b"}, {"id": "gpt-a"}]}).to_string())
    });
    let ai = h.ai_at(Endpoints {
        openai_api: fake.url.clone(),
        ..Endpoints::default()
    });
    let id = add_configured(
        &h,
        &ai,
        keyed_input(ProviderKind::Chatgpt, "ChatGPT", "sk-1"),
        "m",
    )
    .await;

    let models = listed(&h, &ai, &id).await;

    assert_eq!(
        models,
        [info("gpt-a", "gpt-a", None), info("gpt-b", "gpt-b", None)]
    );
    let request = &fake.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("GET", "/v1/models")
    );
    assert_eq!(request.header("authorization"), Some("Bearer sk-1"));
}

#[tokio::test]
async fn the_chatgpt_subscription_lists_codex_models_with_the_account_header() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!({"models": [
                {"slug": "gpt-5.5", "display_name": "GPT-5.5", "context_window": 272000},
                {"slug": "gpt-5.4-mini"},
                {"display_name": "no slug"}
            ]})
            .to_string(),
        )
    });
    let ai = h.ai_at(Endpoints {
        chatgpt_backend: format!("{}/backend-api/codex", fake.root),
        ..Endpoints::default()
    });
    let id = add_configured(
        &h,
        &ai,
        provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "ChatGPT"),
        "m",
    )
    .await;
    store_tokens(
        &h,
        &id,
        &chatgpt_tokens("oauth-access", FAR_FUTURE, Some("acct-7")),
    );

    let models = listed(&h, &ai, &id).await;

    assert_eq!(
        models,
        [
            info("gpt-5.4-mini", "gpt-5.4-mini", None),
            info("gpt-5.5", "GPT-5.5", Some(272_000))
        ]
    );
    let request = &fake.requests()[0];
    assert_eq!(request.method, "GET");
    assert_eq!(
        request.path,
        "/backend-api/codex/models?client_version=0.157.1"
    );
    assert_eq!(request.header("authorization"), Some("Bearer oauth-access"));
    assert_eq!(request.header("chatgpt-account-id"), Some("acct-7"));
}

#[tokio::test]
async fn anthropic_lists_models_with_a_key_and_with_claude_code_credentials() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!({"data": [
                {"id": "claude-b", "display_name": "Claude B", "max_input_tokens": 200000},
                {"id": "claude-a", "display_name": "Claude A"}
            ]})
            .to_string(),
        )
    });
    let endpoints = Endpoints {
        anthropic_api: fake.url.clone(),
        ..Endpoints::default()
    };
    let ai = h.ai_at(endpoints);
    let key = add_configured(
        &h,
        &ai,
        keyed_input(ProviderKind::Claude, "Key", "sk-ant"),
        "m",
    )
    .await;
    h.claude_code_signs_in(&claude_blob("cc-access", "cc-refresh", FAR_FUTURE));
    let sub = add_configured(
        &h,
        &ai,
        provider_input(ProviderKind::Claude, AuthMode::Subscription, "Sub"),
        "m",
    )
    .await;

    let with_key = listed(&h, &ai, &key).await;
    let with_oauth = listed(&h, &ai, &sub).await;

    let expected = [
        info("claude-a", "Claude A", None),
        info("claude-b", "Claude B", Some(200_000)),
    ];
    assert_eq!(with_key, expected);
    assert_eq!(with_oauth, expected);
    let requests = fake.requests();
    assert_eq!(requests[0].path, "/v1/models?limit=1000");
    assert_eq!(requests[0].header("x-api-key"), Some("sk-ant"));
    assert_eq!(requests[0].header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(
        requests[1].header("authorization"),
        Some("Bearer cc-access")
    );
    assert_eq!(requests[1].header("x-app"), Some("cli"));
    assert_eq!(
        requests[1].header("anthropic-beta"),
        Some("claude-code-20250219,oauth-2025-04-20")
    );
}

#[tokio::test]
async fn openrouter_lists_names_and_context_lengths() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!({"data": [
                {"id": "vendor/big", "name": "Vendor: Big", "context_length": 1050000},
                {"id": "vendor/small", "name": "Vendor: Small", "context_length": null}
            ]})
            .to_string(),
        )
    });
    let ai = h.ai_at(Endpoints {
        openrouter_api: fake.url.clone(),
        ..Endpoints::default()
    });
    let id = add_configured(
        &h,
        &ai,
        keyed_input(ProviderKind::Openrouter, "OR", "or-key"),
        "m",
    )
    .await;

    let models = listed(&h, &ai, &id).await;

    assert_eq!(
        models,
        [
            info("vendor/big", "Vendor: Big", Some(1_050_000)),
            info("vendor/small", "Vendor: Small", None)
        ]
    );
    assert_eq!(fake.requests()[0].path, "/v1/models");
    assert_eq!(
        fake.requests()[0].header("authorization"),
        Some("Bearer or-key")
    );
}

#[tokio::test]
async fn an_openai_compatible_endpoint_lists_from_its_own_base_url() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&json!({"data": [{"id": "llama"}]}).to_string()));
    let ai = h.ai();
    let added = ai
        .add(h.dir(), common::http_input("Local", &fake.url, None))
        .await
        .unwrap();

    let models = listed(&h, &ai, &added.config.id).await;

    assert_eq!(models, [info("llama", "llama", None)]);
    assert_eq!(fake.requests()[0].path, "/v1/models");
}

#[tokio::test]
async fn an_openai_compatible_endpoint_reads_names_and_context_limits() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(
            &json!({"data": [
                {"id": "qwen", "name": "Qwen 3", "limit": {"context": 131072, "output": 8192}},
                {"id": "mistral", "context_window": 32768},
                {"id": "phi", "limit": {"input": 16384}}
            ]})
            .to_string(),
        )
    });
    let ai = h.ai();
    let added = ai
        .add(h.dir(), common::http_input("Local", &fake.url, None))
        .await
        .unwrap();

    let models = listed(&h, &ai, &added.config.id).await;

    assert_eq!(
        models,
        [
            info("mistral", "mistral", Some(32_768)),
            info("phi", "phi", Some(16_384)),
            info("qwen", "Qwen 3", Some(131_072))
        ]
    );
}

#[tokio::test]
async fn missing_credentials_are_ai_auth_required_before_any_request() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(r#"{"data":[]}"#));
    let ai = h.ai_at(Endpoints {
        openai_api: fake.url.clone(),
        anthropic_api: fake.url.clone(),
        openrouter_api: fake.url.clone(),
        chatgpt_backend: fake.url.clone(),
        ..Endpoints::default()
    });
    for (kind, mode) in [
        (ProviderKind::Chatgpt, AuthMode::ApiKey),
        (ProviderKind::Claude, AuthMode::ApiKey),
        (ProviderKind::Openrouter, AuthMode::ApiKey),
        (ProviderKind::Chatgpt, AuthMode::Subscription),
        (ProviderKind::Claude, AuthMode::Subscription),
    ] {
        let added = ai
            .add(h.dir(), provider_input(kind, mode, "P"))
            .await
            .unwrap();

        let error = ai.models(h.dir(), &added.config.id).await.unwrap_err();

        assert!(
            matches!(CoreError::from(error), CoreError::AiAuthRequired { .. }),
            "{kind:?} {mode:?}"
        );
    }
    assert!(fake.requests().is_empty());
}

#[tokio::test]
async fn a_rejected_credential_is_ai_auth_required() {
    let h = Harness::new();
    let fake =
        HttpFake::start(|_| Reply::status(401, r#"{"error":{"message":"invalid x-api-key"}}"#));
    let ai = h.ai_at(Endpoints {
        anthropic_api: fake.url.clone(),
        ..Endpoints::default()
    });
    let id = add_configured(
        &h,
        &ai,
        keyed_input(ProviderKind::Claude, "Key", "sk-ant"),
        "m",
    )
    .await;

    let error = ai.models(h.dir(), &id).await.unwrap_err();

    assert!(matches!(
        CoreError::from(error),
        CoreError::AiAuthRequired { .. }
    ));
}
