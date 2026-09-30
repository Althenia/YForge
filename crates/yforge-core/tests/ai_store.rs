use rusqlite::Connection;
use yforge_core::{
    ai_active_provider, ai_choose, ai_provider, ai_provider_add, ai_provider_delete,
    ai_provider_edit, ai_provider_key_flag, ai_providers, start_storage, ErrorKind, ProviderKind,
};

fn data() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    start_storage(dir.path()).unwrap();
    dir
}

#[test]
fn providers_keep_non_secret_config_in_creation_order() {
    let dir = data();
    let first = ai_provider_add(
        dir.path(),
        ProviderKind::OpenaiCompatible,
        "Local",
        Some("http://127.0.0.1:1234/v1"),
        None,
    )
    .unwrap();
    let second = ai_provider_add(
        dir.path(),
        ProviderKind::Chatgpt,
        "ChatGPT",
        None,
        Some("/opt/bin/codex"),
    )
    .unwrap();

    assert_ne!(first.id, second.id);
    assert!(first.id.starts_with("openai_compatible-"));
    assert!(second.id.starts_with("chatgpt-"));
    let listed = ai_providers(dir.path()).unwrap();
    assert_eq!(listed, [first.clone(), second.clone()]);
    assert_eq!(second.executable_path.as_deref(), Some("/opt/bin/codex"));
    assert_eq!(first.base_url.as_deref(), Some("http://127.0.0.1:1234/v1"));
    assert!(!first.has_api_key && first.model.is_none());
    assert!(first.created_at > 0);
}

#[test]
fn editing_changes_the_fields_but_not_the_kind_model_or_creation_time() {
    let dir = data();
    let added = ai_provider_add(
        dir.path(),
        ProviderKind::OpenaiCompatible,
        "Local",
        Some("http://127.0.0.1:1/v1"),
        None,
    )
    .unwrap();
    ai_choose(dir.path(), Some(&added.id), Some("llama")).unwrap();

    let edited = ai_provider_edit(
        dir.path(),
        &added.id,
        "Renamed",
        Some("https://example.test/v1"),
        None,
    )
    .unwrap();
    ai_provider_key_flag(dir.path(), &added.id, true).unwrap();

    assert_eq!(edited.name, "Renamed");
    assert_eq!(edited.base_url.as_deref(), Some("https://example.test/v1"));
    assert_eq!(edited.kind, ProviderKind::OpenaiCompatible);
    assert_eq!(edited.model.as_deref(), Some("llama"));
    assert_eq!(edited.created_at, added.created_at);
    assert!(ai_provider(dir.path(), &added.id).unwrap().has_api_key);
}

#[test]
fn choosing_a_provider_records_it_as_active_with_its_trimmed_model() {
    let dir = data();
    let one = ai_provider_add(dir.path(), ProviderKind::ClaudeCode, "Claude", None, None).unwrap();
    let two = ai_provider_add(dir.path(), ProviderKind::Chatgpt, "ChatGPT", None, None).unwrap();
    assert_eq!(ai_active_provider(dir.path()).unwrap(), None);

    ai_choose(dir.path(), Some(&one.id), Some("  opus ")).unwrap();
    assert_eq!(
        ai_active_provider(dir.path()).unwrap(),
        Some(one.id.clone())
    );
    assert_eq!(
        ai_provider(dir.path(), &one.id).unwrap().model.as_deref(),
        Some("opus")
    );

    ai_choose(dir.path(), Some(&two.id), Some("  ")).unwrap();
    assert_eq!(
        ai_active_provider(dir.path()).unwrap(),
        Some(two.id.clone())
    );
    assert_eq!(ai_provider(dir.path(), &two.id).unwrap().model, None);

    ai_choose(dir.path(), None, None).unwrap();
    assert_eq!(ai_active_provider(dir.path()).unwrap(), None);
}

#[test]
fn choosing_or_editing_an_unknown_provider_is_an_invalid_request() {
    let dir = data();

    let chosen = ai_choose(dir.path(), Some("nope"), None).unwrap_err();
    let edited = ai_provider_edit(dir.path(), "nope", "x", None, None).unwrap_err();
    let flagged = ai_provider_key_flag(dir.path(), "nope", true).unwrap_err();

    for error in [chosen, edited, flagged] {
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
    assert_eq!(ai_active_provider(dir.path()).unwrap(), None);
}

#[test]
fn deleting_the_active_provider_clears_the_choice_and_other_providers_stay() {
    let dir = data();
    let one = ai_provider_add(dir.path(), ProviderKind::ClaudeCode, "Claude", None, None).unwrap();
    let two = ai_provider_add(dir.path(), ProviderKind::Chatgpt, "ChatGPT", None, None).unwrap();
    ai_choose(dir.path(), Some(&one.id), None).unwrap();

    ai_provider_delete(dir.path(), &two.id).unwrap();
    assert_eq!(
        ai_active_provider(dir.path()).unwrap(),
        Some(one.id.clone())
    );
    ai_provider_delete(dir.path(), &one.id).unwrap();

    assert_eq!(ai_active_provider(dir.path()).unwrap(), None);
    assert!(ai_providers(dir.path()).unwrap().is_empty());
    assert_eq!(
        ai_provider_delete(dir.path(), &one.id).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[test]
fn the_database_holds_no_column_that_could_carry_a_key() {
    let dir = data();
    ai_provider_add(
        dir.path(),
        ProviderKind::Openrouter,
        "OpenRouter",
        None,
        None,
    )
    .unwrap();

    let conn = Connection::open(dir.path().join("yforge.db")).unwrap();
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('ai_providers') ORDER BY cid")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(
        columns,
        [
            "seq",
            "id",
            "kind",
            "name",
            "base_url",
            "model",
            "executable_path",
            "has_api_key",
            "created_at"
        ]
    );
}
