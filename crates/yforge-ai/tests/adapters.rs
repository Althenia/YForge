mod common;

use common::{
    add_active, chatgpt_tokens, claude_blob, commit_context, keyed_input, messages_reply,
    provider_input, responses_reply, sse, store_tokens, Harness, HttpFake, Recorded, Reply,
    FAR_FUTURE, GOOD,
};
use serde_json::{json, Value};
use yforge_ai::{Ai, AiError, Endpoints};
use yforge_core::{AiFeature, AuthMode, CancelToken, CoreError, ErrorKind, ProviderKind};

fn kind_of(error: AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

async fn draft_summary(h: &Harness, ai: &Ai) -> Result<String, AiError> {
    let selection = ai.resolve(h.dir(), AiFeature::GenerateCommit).await?;
    ai.commit_message(&selection, &commit_context(), &CancelToken::new())
        .await
        .map(|draft| draft.summary)
}

fn body(request: &Recorded) -> Value {
    serde_json::from_str(&request.body).unwrap()
}

#[tokio::test]
async fn chatgpt_with_an_api_key_posts_to_the_responses_api_and_joins_the_streamed_text() {
    let h = Harness::new();
    let (first, second) = GOOD.split_at(20);
    let payload = sse(&[
        json!({"type": "response.created", "response": {}}),
        json!({"type": "response.output_text.delta", "delta": first}),
        json!({"type": "response.output_text.delta", "delta": second}),
        json!({"type": "response.completed", "response": {"output": []}}),
    ]);
    let fake = HttpFake::start(move |_| Reply::ok(&payload));
    let ai = h.ai_at(Endpoints {
        openai_api: fake.url.clone(),
        ..Endpoints::default()
    });
    add_active(
        &h,
        &ai,
        keyed_input(ProviderKind::Chatgpt, "ChatGPT", "sk-openai"),
        "gpt-x",
    )
    .await;

    let summary = draft_summary(&h, &ai).await.unwrap();

    assert_eq!(summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/v1/responses")
    );
    assert_eq!(request.header("authorization"), Some("Bearer sk-openai"));
    assert_eq!(request.header("chatgpt-account-id"), None);
    let sent = body(request);
    assert_eq!(sent["model"], "gpt-x");
    assert_eq!(sent["stream"], true);
    assert_eq!(sent["store"], false);
    assert!(sent["instructions"]
        .as_str()
        .unwrap()
        .contains("You write Git commit messages"));
    assert_eq!(sent["input"][0]["role"], "user");
    assert_eq!(sent["input"][0]["content"][0]["type"], "input_text");
    assert!(sent["input"][0]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("+DIFF-MARKER"));
}

#[tokio::test]
async fn chatgpt_with_a_subscription_posts_to_the_codex_backend_with_the_account_header() {
    let h = Harness::new();
    let payload = sse(&[
        json!({"type": "response.completed", "response": {"output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "content": [{"type": "output_text", "text": GOOD}]}
        ]}}),
    ]);
    let fake = HttpFake::start(move |_| Reply::ok(&payload));
    let ai = h.ai_at(Endpoints {
        chatgpt_backend: format!("{}/backend-api/codex", fake.root),
        ..Endpoints::default()
    });
    let id = add_active(
        &h,
        &ai,
        provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "ChatGPT"),
        "gpt-5.5",
    )
    .await;
    store_tokens(
        &h,
        &id,
        &chatgpt_tokens("oauth-access", FAR_FUTURE, Some("acct-42")),
    );

    let summary = draft_summary(&h, &ai).await.unwrap();

    assert_eq!(summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/backend-api/codex/responses")
    );
    assert_eq!(request.header("authorization"), Some("Bearer oauth-access"));
    assert_eq!(request.header("chatgpt-account-id"), Some("acct-42"));
    assert_eq!(body(request)["model"], "gpt-5.5");
}

#[tokio::test]
async fn claude_with_an_api_key_posts_to_the_messages_api_with_x_api_key() {
    let h = Harness::new();
    let payload = json!({"content": [
        {"type": "thinking", "thinking": "..."},
        {"type": "text", "text": &GOOD[..20]},
        {"type": "text", "text": &GOOD[20..]},
    ]})
    .to_string();
    let fake = HttpFake::start(move |_| Reply::ok(&payload));
    let ai = h.ai_at(Endpoints {
        anthropic_api: fake.url.clone(),
        ..Endpoints::default()
    });
    add_active(
        &h,
        &ai,
        keyed_input(ProviderKind::Claude, "Claude", "sk-ant"),
        "claude-x",
    )
    .await;

    let summary = draft_summary(&h, &ai).await.unwrap();

    assert_eq!(summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/v1/messages")
    );
    assert_eq!(request.header("x-api-key"), Some("sk-ant"));
    assert_eq!(request.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(request.header("authorization"), None);
    assert_eq!(request.header("anthropic-beta"), None);
    let sent = body(request);
    assert_eq!(sent["model"], "claude-x");
    assert!(sent["max_tokens"].as_u64().unwrap() > 0);
    assert_eq!(sent["system"].as_array().unwrap().len(), 1);
    assert!(sent["system"][0]["text"]
        .as_str()
        .unwrap()
        .contains("You write Git commit messages"));
    assert_eq!(sent["messages"][0]["role"], "user");
    assert!(sent["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains("+DIFF-MARKER"));
}

#[tokio::test]
async fn claude_with_a_subscription_uses_the_oauth_bearer_beta_flags_and_the_cli_identity() {
    let h = Harness::new();
    let payload = messages_reply(GOOD);
    let fake = HttpFake::start(move |_| Reply::ok(&payload));
    let ai = h.ai_at(Endpoints {
        anthropic_api: fake.url.clone(),
        ..Endpoints::default()
    });
    h.claude_code_signs_in(&claude_blob("cc-access", "cc-refresh", FAR_FUTURE));
    add_active(
        &h,
        &ai,
        provider_input(ProviderKind::Claude, AuthMode::Subscription, "Claude"),
        "claude-x",
    )
    .await;

    let summary = draft_summary(&h, &ai).await.unwrap();

    assert_eq!(summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(request.path, "/v1/messages");
    assert_eq!(request.header("authorization"), Some("Bearer cc-access"));
    assert_eq!(request.header("x-api-key"), None);
    assert_eq!(request.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(
        request.header("anthropic-beta"),
        Some("claude-code-20250219,oauth-2025-04-20")
    );
    assert_eq!(request.header("x-app"), Some("cli"));
    let sent = body(request);
    assert_eq!(
        sent["system"][0]["text"],
        "You are Claude Code, Anthropic's official CLI for Claude."
    );
    assert!(sent["system"][1]["text"]
        .as_str()
        .unwrap()
        .contains("You write Git commit messages"));
}

#[tokio::test]
async fn openrouter_posts_chat_completions_with_the_bearer_key() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&common::chat_reply(GOOD)));
    let ai = h.ai_at(Endpoints {
        openrouter_api: fake.url.clone(),
        ..Endpoints::default()
    });
    add_active(
        &h,
        &ai,
        keyed_input(ProviderKind::Openrouter, "OpenRouter", "or-key"),
        "vendor/model",
    )
    .await;

    let summary = draft_summary(&h, &ai).await.unwrap();

    assert_eq!(summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(request.path, "/v1/chat/completions");
    assert_eq!(request.header("authorization"), Some("Bearer or-key"));
    assert_eq!(body(request)["model"], "vendor/model");
}

async fn every_backend(
    h: &Harness,
    reply: impl Fn() -> Reply + Clone + Send + Sync + 'static,
) -> Vec<(&'static str, Ai, HttpFake)> {
    let mut all = Vec::new();
    for name in [
        "chatgpt-key",
        "chatgpt-sub",
        "claude-key",
        "claude-sub",
        "openrouter",
    ] {
        let route = reply.clone();
        let fake = HttpFake::start(move |_| route());
        let ai = h.ai_at(Endpoints {
            openai_api: fake.url.clone(),
            chatgpt_backend: fake.url.clone(),
            anthropic_api: fake.url.clone(),
            openrouter_api: fake.url.clone(),
            ..Endpoints::default()
        });
        match name {
            "chatgpt-key" => {
                add_active(
                    h,
                    &ai,
                    keyed_input(ProviderKind::Chatgpt, "P", "secret-key-1"),
                    "m",
                )
                .await;
            }
            "chatgpt-sub" => {
                let id = add_active(
                    h,
                    &ai,
                    provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "P"),
                    "m",
                )
                .await;
                store_tokens(
                    h,
                    &id,
                    &chatgpt_tokens("secret-key-1", FAR_FUTURE, Some("a")),
                );
            }
            "claude-key" => {
                add_active(
                    h,
                    &ai,
                    keyed_input(ProviderKind::Claude, "P", "secret-key-1"),
                    "m",
                )
                .await;
            }
            "claude-sub" => {
                h.claude_code_signs_in(&claude_blob("secret-key-1", "r", FAR_FUTURE));
                add_active(
                    h,
                    &ai,
                    provider_input(ProviderKind::Claude, AuthMode::Subscription, "P"),
                    "m",
                )
                .await;
            }
            _ => {
                add_active(
                    h,
                    &ai,
                    keyed_input(ProviderKind::Openrouter, "P", "secret-key-1"),
                    "m",
                )
                .await;
            }
        }
        all.push((name, ai, fake));
    }
    all
}

#[tokio::test]
async fn a_401_or_403_from_any_backend_is_ai_auth_required_and_never_echoes_the_credential() {
    for status in [401, 403] {
        let h = Harness::new();
        let backends = every_backend(&h, move || {
            Reply::status(
                status,
                r#"{"error":{"message":"bad credential secret-key-1"}}"#,
            )
        })
        .await;
        for (name, ai, _fake) in backends {
            let error = draft_summary(&h, &ai).await.unwrap_err();
            match CoreError::from(error) {
                CoreError::AiAuthRequired { detail, .. } => {
                    assert!(detail.contains("bad credential"), "{name}");
                    assert!(!detail.contains("secret-key-1"), "{name}: {detail}");
                }
                other => panic!("{name}: {other:?}"),
            }
        }
    }
}

#[tokio::test]
async fn server_errors_are_ai_failed_for_every_backend() {
    let h = Harness::new();
    let backends =
        every_backend(&h, || Reply::status(500, r#"{"error":{"message":"down"}}"#)).await;
    for (name, ai, _fake) in backends {
        let error = draft_summary(&h, &ai).await.unwrap_err();
        assert_eq!(kind_of(error), ErrorKind::AiFailed, "{name}");
    }
}

#[tokio::test]
async fn unusable_replies_are_invalid_responses_and_stream_errors_are_failures() {
    let h = Harness::new();
    let cases: Vec<(ProviderKind, Reply, ErrorKind)> = vec![
        (
            ProviderKind::Chatgpt,
            Reply::ok("data: {\"type\":\"response.created\"}\n\n"),
            ErrorKind::AiInvalidResponse,
        ),
        (
            ProviderKind::Chatgpt,
            Reply::ok(&responses_reply("   ")),
            ErrorKind::AiInvalidResponse,
        ),
        (
            ProviderKind::Chatgpt,
            Reply::ok(&sse(&[
                json!({"type": "response.failed", "response": {"error": {"message": "quota"}}}),
            ])),
            ErrorKind::AiFailed,
        ),
        (
            ProviderKind::Claude,
            Reply::ok("{}"),
            ErrorKind::AiInvalidResponse,
        ),
        (
            ProviderKind::Claude,
            Reply::ok(&messages_reply("")),
            ErrorKind::AiInvalidResponse,
        ),
    ];
    for (kind, reply, expected) in cases {
        let cell = std::sync::Mutex::new(Some(reply));
        let fake = HttpFake::start(move |_| cell.lock().unwrap().take().unwrap());
        let ai = h.ai_at(Endpoints {
            openai_api: fake.url.clone(),
            anthropic_api: fake.url.clone(),
            ..Endpoints::default()
        });
        add_active(&h, &ai, keyed_input(kind, "P", "k"), "m").await;
        let error = draft_summary(&h, &ai).await.unwrap_err();
        assert_eq!(kind_of(error), expected, "{kind:?}");
    }
}

#[tokio::test]
async fn a_hosted_provider_without_a_credential_cannot_be_resolved() {
    let h = Harness::new();
    let ai = h.ai();
    for (kind, mode) in [
        (ProviderKind::Chatgpt, AuthMode::ApiKey),
        (ProviderKind::Claude, AuthMode::ApiKey),
        (ProviderKind::Chatgpt, AuthMode::Subscription),
        (ProviderKind::Claude, AuthMode::Subscription),
    ] {
        add_active(&h, &ai, provider_input(kind, mode, "P"), "m").await;
        let error = draft_summary(&h, &ai).await.unwrap_err();
        assert_eq!(
            kind_of(error),
            ErrorKind::AiAuthRequired,
            "{kind:?} {mode:?}"
        );
    }
}
