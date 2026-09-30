use rusqlite::Connection;
use yforge_core::{
    ai_active_provider, ai_choose, ai_feature_config, ai_feature_config_reset,
    ai_feature_config_set, ai_feature_configs, ai_provider, ai_provider_add, ai_provider_delete,
    ai_provider_edit, ai_provider_key_flag, ai_providers, start_storage, AiFeature,
    AiFeatureConfig, AuthMode, ErrorKind, ProviderKind,
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
        AuthMode::ApiKey,
        "Local",
        Some("http://127.0.0.1:1234/v1"),
    )
    .unwrap();
    let second = ai_provider_add(
        dir.path(),
        ProviderKind::Chatgpt,
        AuthMode::Subscription,
        "ChatGPT",
        None,
    )
    .unwrap();

    assert_ne!(first.id, second.id);
    assert!(first.id.starts_with("openai_compatible-"));
    assert!(second.id.starts_with("chatgpt-"));
    let listed = ai_providers(dir.path()).unwrap();
    assert_eq!(listed, [first.clone(), second.clone()]);
    assert_eq!(second.auth_mode, AuthMode::Subscription);
    assert_eq!(first.auth_mode, AuthMode::ApiKey);
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
        AuthMode::ApiKey,
        "Local",
        Some("http://127.0.0.1:1/v1"),
    )
    .unwrap();
    ai_choose(dir.path(), Some(&added.id), Some("llama")).unwrap();

    let edited = ai_provider_edit(
        dir.path(),
        &added.id,
        AuthMode::ApiKey,
        "Renamed",
        Some("https://example.test/v1"),
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
    let one = ai_provider_add(
        dir.path(),
        ProviderKind::Claude,
        AuthMode::Subscription,
        "Claude",
        None,
    )
    .unwrap();
    let two = ai_provider_add(
        dir.path(),
        ProviderKind::Chatgpt,
        AuthMode::Subscription,
        "ChatGPT",
        None,
    )
    .unwrap();
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
    let edited = ai_provider_edit(dir.path(), "nope", AuthMode::ApiKey, "x", None).unwrap_err();
    let flagged = ai_provider_key_flag(dir.path(), "nope", true).unwrap_err();

    for error in [chosen, edited, flagged] {
        assert_eq!(error.kind(), ErrorKind::InvalidRequest);
    }
    assert_eq!(ai_active_provider(dir.path()).unwrap(), None);
}

#[test]
fn deleting_the_active_provider_clears_the_choice_and_other_providers_stay() {
    let dir = data();
    let one = ai_provider_add(
        dir.path(),
        ProviderKind::Claude,
        AuthMode::Subscription,
        "Claude",
        None,
    )
    .unwrap();
    let two = ai_provider_add(
        dir.path(),
        ProviderKind::Chatgpt,
        AuthMode::Subscription,
        "ChatGPT",
        None,
    )
    .unwrap();
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
        AuthMode::ApiKey,
        "OpenRouter",
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
            "auth_mode",
            "name",
            "base_url",
            "model",
            "has_api_key",
            "created_at"
        ]
    );
}

#[test]
fn only_chatgpt_and_claude_take_the_subscription_mode() {
    let dir = data();

    for kind in [ProviderKind::Openrouter, ProviderKind::OpenaiCompatible] {
        let added = ai_provider_add(dir.path(), kind, AuthMode::Subscription, "x", None);
        assert_eq!(added.unwrap_err().kind(), ErrorKind::InvalidRequest);
    }
    let router = ai_provider_add(
        dir.path(),
        ProviderKind::Openrouter,
        AuthMode::ApiKey,
        "OpenRouter",
        None,
    )
    .unwrap();
    let switched = ai_provider_edit(dir.path(), &router.id, AuthMode::Subscription, "x", None);
    assert_eq!(switched.unwrap_err().kind(), ErrorKind::InvalidRequest);
    let claude = ai_provider_add(
        dir.path(),
        ProviderKind::Claude,
        AuthMode::ApiKey,
        "Claude",
        None,
    )
    .unwrap();

    let edited = ai_provider_edit(
        dir.path(),
        &claude.id,
        AuthMode::Subscription,
        "Claude",
        None,
    )
    .unwrap();

    assert_eq!(edited.auth_mode, AuthMode::Subscription);
    assert_eq!(ai_providers(dir.path()).unwrap().len(), 2);
}

fn feature(feature: AiFeature, provider_id: &str, model_id: &str) -> AiFeatureConfig {
    AiFeatureConfig {
        feature,
        provider_id: provider_id.to_owned(),
        model_id: model_id.to_owned(),
        prompt_template: format!("Do {} with {{context}}", feature.as_str()),
    }
}

fn provider(dir: &std::path::Path, name: &str) -> String {
    ai_provider_add(dir, ProviderKind::Openrouter, AuthMode::ApiKey, name, None)
        .unwrap()
        .id
}

#[test]
fn feature_configs_are_stored_per_feature_and_replaced_on_set() {
    let dir = data();
    let one = provider(dir.path(), "One");
    let two = provider(dir.path(), "Two");
    assert!(ai_feature_configs(dir.path()).unwrap().is_empty());
    assert_eq!(
        ai_feature_config(dir.path(), AiFeature::Recompose).unwrap(),
        None
    );

    ai_feature_config_set(dir.path(), &feature(AiFeature::Recompose, &one, "m1")).unwrap();
    ai_feature_config_set(dir.path(), &feature(AiFeature::GenerateCommit, &two, "m2")).unwrap();
    ai_feature_config_set(dir.path(), &feature(AiFeature::Recompose, &two, "m3")).unwrap();

    assert_eq!(
        ai_feature_config(dir.path(), AiFeature::Recompose).unwrap(),
        Some(feature(AiFeature::Recompose, &two, "m3"))
    );
    assert_eq!(
        ai_feature_configs(dir.path()).unwrap(),
        [
            feature(AiFeature::Recompose, &two, "m3"),
            feature(AiFeature::GenerateCommit, &two, "m2")
        ]
    );
}

#[test]
fn resetting_a_feature_removes_only_its_config() {
    let dir = data();
    let id = provider(dir.path(), "One");
    ai_feature_config_set(dir.path(), &feature(AiFeature::Recompose, &id, "m")).unwrap();
    ai_feature_config_set(dir.path(), &feature(AiFeature::ConflictFix, &id, "m")).unwrap();

    ai_feature_config_reset(dir.path(), AiFeature::Recompose).unwrap();
    ai_feature_config_reset(dir.path(), AiFeature::GenerateCommit).unwrap();

    assert_eq!(
        ai_feature_configs(dir.path()).unwrap(),
        [feature(AiFeature::ConflictFix, &id, "m")]
    );
}

#[test]
fn a_feature_config_needs_an_existing_provider_and_dies_with_it() {
    let dir = data();
    let id = provider(dir.path(), "One");
    let other = provider(dir.path(), "Other");

    let unknown = ai_feature_config_set(dir.path(), &feature(AiFeature::Recompose, "nope", "m"));
    assert_eq!(unknown.unwrap_err().kind(), ErrorKind::InvalidRequest);
    ai_feature_config_set(dir.path(), &feature(AiFeature::Recompose, &id, "m")).unwrap();
    ai_feature_config_set(dir.path(), &feature(AiFeature::ConflictFix, &other, "m")).unwrap();

    ai_provider_delete(dir.path(), &id).unwrap();

    assert_eq!(
        ai_feature_configs(dir.path()).unwrap(),
        [feature(AiFeature::ConflictFix, &other, "m")]
    );
}

#[test]
fn migration_six_converts_existing_providers_and_keeps_their_choices() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("yforge.db");
    let old = Connection::open(&path).unwrap();
    old.execute_batch(include_str!("../src/store/schema.sql"))
        .unwrap();
    old.execute_batch(include_str!("../src/store/switch_stashes.sql"))
        .unwrap();
    old.execute_batch(include_str!("../src/store/ai_providers.sql"))
        .unwrap();
    old.execute_batch(include_str!("../src/store/repo_ui_prefs.sql"))
        .unwrap();
    old.execute_batch(include_str!("../src/store/platform_connections.sql"))
        .unwrap();
    old.pragma_update(None, "user_version", 5).unwrap();
    old.execute_batch(
        "INSERT INTO ai_providers (id, kind, name, base_url, model, executable_path, has_api_key, created_at) VALUES
         ('claude_code-1', 'claude_code', 'Claude', NULL, 'opus', '/x/claude', 0, 10),
         ('chatgpt-1', 'chatgpt', 'ChatGPT', NULL, NULL, NULL, 0, 20),
         ('openrouter-1', 'openrouter', 'OR', NULL, 'm/x', NULL, 1, 30);",
    )
    .unwrap();
    drop(old);

    start_storage(dir.path()).unwrap();

    let listed = ai_providers(dir.path()).unwrap();
    let summary: Vec<_> = listed
        .iter()
        .map(|p| {
            (
                p.id.as_str(),
                p.kind,
                p.auth_mode,
                p.model.as_deref(),
                p.has_api_key,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                "claude_code-1",
                ProviderKind::Claude,
                AuthMode::Subscription,
                Some("opus"),
                false
            ),
            (
                "chatgpt-1",
                ProviderKind::Chatgpt,
                AuthMode::Subscription,
                None,
                false
            ),
            (
                "openrouter-1",
                ProviderKind::Openrouter,
                AuthMode::ApiKey,
                Some("m/x"),
                true
            ),
        ]
    );
    let added = provider(dir.path(), "Later");
    assert!(ai_providers(dir.path()).unwrap().len() == 4 && !added.is_empty());
}
