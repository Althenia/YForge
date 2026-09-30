use std::path::Path;
use std::sync::Arc;

use yforge_ai::{Ai, MemoryStore, SecretStore};
use yforge_core::{
    ai_choose, commit_context, AiFeature, AuthMode, CancelToken, CoreError, ProviderInput,
    ProviderKind,
};

const SAMPLE: &str = "/tmp/yforge-gk-lab/sample";

fn seed_chatgpt_tokens(secrets: &MemoryStore, id: &str) -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    let Ok(text) = std::fs::read_to_string(Path::new(&home).join(".codex/auth.json")) else {
        return false;
    };
    let Ok(file) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let field = |name: &str| {
        file.pointer(&format!("/tokens/{name}"))
            .and_then(|v| v.as_str())
    };
    let (Some(access), Some(refresh)) = (field("access_token"), field("refresh_token")) else {
        return false;
    };
    let tokens = serde_json::json!({
        "access": access,
        "refresh": refresh,
        "expires_at": 0,
        "account_id": field("account_id"),
    });
    secrets
        .set(&format!("{id}:oauth"), &tokens.to_string())
        .is_ok()
}

async fn try_provider(kind: ProviderKind, model: &str, copy: &Path) {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    let secrets = Arc::new(MemoryStore::default());
    let ai = Ai::new(secrets.clone());
    let added = ai
        .add(
            data.path(),
            ProviderInput {
                kind,
                auth_mode: AuthMode::Subscription,
                name: kind.label().to_owned(),
                base_url: None,
                api_key: None,
            },
        )
        .await
        .unwrap();
    if kind == ProviderKind::Chatgpt && !seed_chatgpt_tokens(&secrets, &added.config.id) {
        println!("ChatGPT: no ~/.codex/auth.json tokens to seed");
        return;
    }
    ai_choose(data.path(), Some(&added.config.id), Some(model)).unwrap();
    let selection = ai
        .resolve(data.path(), AiFeature::GenerateCommit)
        .await
        .unwrap();
    let context = commit_context(copy).unwrap();
    match ai
        .commit_message(&selection, &context, &CancelToken::new())
        .await
    {
        Ok(draft) => println!(
            "{}: ok, summary {} chars, trimmed {}",
            kind.label(),
            draft.summary.chars().count(),
            draft.summary_trimmed
        ),
        Err(error) => {
            let core = CoreError::from(error);
            println!("{}: {:?}: {core}", kind.label(), core.kind());
        }
    }
}

#[tokio::test]
#[ignore = "calls the ChatGPT codex backend and Claude with the signed-in profiles on this machine"]
async fn the_subscription_backends_draft_a_commit_message_for_a_copy_of_the_sample_repository() {
    let scratch = tempfile::tempdir().unwrap();
    let copy = scratch.path().join("sample");
    let status = std::process::Command::new("cp")
        .args(["-R", SAMPLE])
        .arg(&copy)
        .status()
        .unwrap();
    assert!(status.success());
    let chatgpt_model = std::env::var("YFORGE_LIVE_CHATGPT_MODEL").unwrap_or_default();
    let claude_model = std::env::var("YFORGE_LIVE_CLAUDE_MODEL").unwrap_or_default();
    try_provider(ProviderKind::Chatgpt, &chatgpt_model, &copy).await;
    try_provider(ProviderKind::Claude, &claude_model, &copy).await;
}
