mod common;

use std::time::{Duration, Instant};

use common::{chat_reply, closed_port_url, http_input, Harness, HttpFake, Reply};
use yforge_ai::{Ai, AiError, Limits, Selection};
use yforge_core::{
    ai_choose, CancelToken, CommitContext, CoreError, ErrorKind, ProviderInput, ProviderKind,
};

fn context() -> CommitContext {
    CommitContext {
        diff: "=== a.txt (modified) ===\n+HTTP-DIFF-MARKER\n".to_owned(),
        recent_subjects: vec!["Earlier".to_owned()],
        excluded: Vec::new(),
        truncated: Vec::new(),
    }
}

async fn select(h: &Harness, ai: &Ai, url: &str, key: Option<&str>) -> Selection {
    let added = ai
        .add(h.dir(), http_input("Endpoint", url, key))
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&added.config.id), Some("model-x")).unwrap();
    ai.resolve(h.dir()).await.unwrap()
}

fn kind_of(error: AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

const GOOD: &str = r#"{"summary":"Add thing","description":"Because."}"#;

#[tokio::test]
async fn a_completion_posts_the_fixed_prompt_with_the_bearer_key_and_parses_the_reply() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&chat_reply(GOOD)));
    let ai = h.ai();
    let selection = select(&h, &ai, &fake.url, Some("k-secret")).await;

    let draft = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(draft.summary, "Add thing");
    let request = &fake.requests()[0];
    assert_eq!(
        (request.method.as_str(), request.path.as_str()),
        ("POST", "/v1/chat/completions")
    );
    assert_eq!(request.header("authorization"), Some("Bearer k-secret"));
    let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
    assert_eq!(body["model"], "model-x");
    assert_eq!(body["stream"], false);
    assert_eq!(body["messages"][0]["role"], "system");
    assert!(body["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains("You write Git commit messages"));
    assert_eq!(body["messages"][1]["role"], "user");
    assert!(body["messages"][1]["content"]
        .as_str()
        .unwrap()
        .contains("+HTTP-DIFF-MARKER"));
}

#[tokio::test]
async fn openrouter_uses_its_own_endpoint_and_the_stored_key() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&chat_reply(GOOD)));
    let ai = h.ai().with_openrouter_url(&fake.url);
    let added = ai
        .add(
            h.dir(),
            ProviderInput {
                api_key: Some("or-key".to_owned()),
                ..common::cli_input(ProviderKind::Openrouter, "OpenRouter")
            },
        )
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&added.config.id), Some("vendor/model")).unwrap();
    let selection = ai.resolve(h.dir()).await.unwrap();

    ai.commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap();

    let request = &fake.requests()[0];
    assert_eq!(request.header("authorization"), Some("Bearer or-key"));
    assert!(request.body.contains("vendor/model"));
}

#[tokio::test]
async fn a_rejected_key_is_ai_auth_required_and_never_echoes_the_key() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::status(
            401,
            r#"{"error":{"message":"Incorrect API key provided: k-secret-123"}}"#,
        )
    });
    let ai = h.ai();
    let selection = select(&h, &ai, &fake.url, Some("k-secret-123")).await;

    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiAuthRequired { detail, .. } => {
            assert!(detail.contains("Incorrect API key"));
            assert!(!detail.contains("k-secret-123"));
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn server_errors_redirects_and_unreachable_endpoints_are_distinguished() {
    let h = Harness::new();
    let ai = h.ai();
    for (reply, expected) in [
        (
            Reply::status(500, r#"{"error":{"message":"upstream down"}}"#),
            ErrorKind::AiFailed,
        ),
        (Reply::status(429, "slow down"), ErrorKind::AiFailed),
        (Reply::status(302, ""), ErrorKind::AiFailed),
        (Reply::ok(r#"{"choices":[]}"#), ErrorKind::AiInvalidResponse),
        (Reply::ok("<html>"), ErrorKind::AiInvalidResponse),
        (Reply::ok(&chat_reply("   ")), ErrorKind::AiInvalidResponse),
        (
            Reply::ok(&chat_reply("Sure, here is a message")),
            ErrorKind::AiInvalidResponse,
        ),
    ] {
        let cell = std::sync::Mutex::new(Some(reply));
        let fake = HttpFake::start(move |_| cell.lock().unwrap().take().unwrap());
        let selection = select(&h, &ai, &fake.url, None).await;
        let error = ai
            .commit_message(&selection, &context(), &CancelToken::new())
            .await
            .unwrap_err();
        assert_eq!(kind_of(error), expected);
    }
    let selection = select(&h, &ai, &closed_port_url(), None).await;
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiProviderUnavailable);
}

#[tokio::test]
async fn a_server_error_body_is_reported_in_the_output() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::status(500, r#"{"error":{"message":"upstream down"}}"#));
    let ai = h.ai();
    let selection = select(&h, &ai, &fake.url, None).await;

    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiFailed { output, .. } => assert_eq!(output, "HTTP 500: upstream down"),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_slow_endpoint_times_out() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&chat_reply(GOOD)).delayed(Duration::from_secs(4)));
    let ai = h.ai_with(Limits {
        completion: Duration::from_millis(500),
        ..Limits::default()
    });
    let selection = select(&h, &ai, &fake.url, None).await;

    let started = Instant::now();
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiTimeout);
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[tokio::test]
async fn cancelling_abandons_the_request() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(&chat_reply(GOOD)).delayed(Duration::from_secs(5)));
    let ai = h.ai();
    let selection = select(&h, &ai, &fake.url, None).await;
    let token = CancelToken::new();
    let stopper = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        stopper.cancel();
    });

    let started = Instant::now();
    let error = ai
        .commit_message(&selection, &context(), &token)
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(3));
}
