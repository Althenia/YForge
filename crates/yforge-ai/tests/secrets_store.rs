use std::sync::Arc;

use yforge_ai::{Ai, CachedStore, SecretStore, SqliteSecrets};
use yforge_core::{AuthMode, Namespace, ProviderInput, ProviderKind, Secrets};

fn backing(dir: &std::path::Path) -> Arc<Secrets> {
    let secrets = Arc::new(Secrets::new(None));
    secrets.bind(dir).unwrap();
    secrets
}

#[tokio::test]
async fn providers_use_sqlite_across_service_recreation_and_remove_their_own_oauth_copy() {
    let dir = tempfile::tempdir().unwrap();
    yforge_core::start_storage(dir.path()).unwrap();
    let store = Arc::new(CachedStore::new(Arc::new(SqliteSecrets::new(backing(
        dir.path(),
    )))));
    let ai = Ai::new(store.clone());
    let added = ai
        .add(
            dir.path(),
            ProviderInput {
                kind: ProviderKind::OpenaiCompatible,
                auth_mode: AuthMode::ApiKey,
                name: "Synthetic endpoint".to_owned(),
                base_url: Some("http://127.0.0.1:9/v1".to_owned()),
                api_key: Some("synthetic-api-value".to_owned()),
            },
        )
        .await
        .unwrap();
    store
        .set(
            &format!("{}:oauth", added.config.id),
            "synthetic-oauth-value",
        )
        .unwrap();
    assert!(!serde_json::to_string(&added)
        .unwrap()
        .contains("synthetic-api-value"));

    let reopened = backing(dir.path());
    assert_eq!(
        reopened
            .get(Namespace::Ai, &added.config.id)
            .unwrap()
            .as_deref(),
        Some("synthetic-api-value")
    );
    let service = Ai::new(Arc::new(SqliteSecrets::new(reopened.clone())));
    service.remove(dir.path(), &added.config.id).await.unwrap();
    assert_eq!(reopened.get(Namespace::Ai, &added.config.id).unwrap(), None);
    assert_eq!(
        reopened
            .get(Namespace::Ai, &format!("{}:oauth", added.config.id))
            .unwrap(),
        None
    );
}

#[test]
fn an_unbound_adapter_reports_storage_failure_without_disclosing_the_input() {
    let store = SqliteSecrets::new(Arc::new(Secrets::new(None)));
    let error = store.set("a", "synthetic-sensitive-value").unwrap_err();
    assert!(!format!("{error:?} {error}").contains("synthetic-sensitive-value"));
    assert!(store.get("a").is_err());
    assert!(store.delete("a").is_err());
}
