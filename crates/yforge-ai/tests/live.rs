use std::path::Path;
use std::sync::Arc;

use yforge_ai::{Ai, MemoryStore};
use yforge_core::{ai_choose, commit_context, CancelToken, CoreError, ProviderInput, ProviderKind};

const SAMPLE: &str = "/tmp/yforge-gk-lab/sample";

async fn try_provider(kind: ProviderKind, copy: &Path) {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    let ai = Ai::new(Arc::new(MemoryStore::default()));
    let added = ai
        .add(
            data.path(),
            ProviderInput {
                kind,
                name: kind.label().to_owned(),
                base_url: None,
                executable_path: None,
                api_key: None,
            },
        )
        .await
        .unwrap();
    println!("{}: status {:?}", kind.label(), added.status);
    ai_choose(data.path(), Some(&added.config.id), None).unwrap();
    let selection = ai.resolve(data.path()).await.unwrap();
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
#[ignore = "calls the installed codex and claude CLIs with the signed-in profiles"]
async fn the_installed_clis_draft_a_commit_message_for_a_copy_of_the_sample_repository() {
    let scratch = tempfile::tempdir().unwrap();
    let copy = scratch.path().join("sample");
    let status = std::process::Command::new("cp")
        .args(["-R", SAMPLE])
        .arg(&copy)
        .status()
        .unwrap();
    assert!(status.success());
    for kind in [ProviderKind::Chatgpt, ProviderKind::ClaudeCode] {
        try_provider(kind, &copy).await;
    }
}
