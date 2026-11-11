use std::sync::Arc;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::Manager;
use yforge_ai::{Ai, MemoryStore};
use yforge_core::{Namespace, Secrets};
use yforge_platform::PlatformService;

#[test]
fn injected_services_expose_the_default_passphrase_store_for_binding() {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    let injected = Arc::new(MemoryStore::default());
    let app = yforge_lib::register_with(
        mock_builder(),
        Ai::new(injected.clone()),
        PlatformService::new(injected),
    )
    .build(mock_context(noop_assets()))
    .unwrap();
    app.state::<Arc<Secrets>>().bind(data.path()).unwrap();
    app.state::<yforge_lib::SshPassphrases>()
        .0
        .set("/synthetic/injected-key", "synthetic-injected-phrase")
        .unwrap();
    let reopened = Secrets::new(None);
    reopened.bind(data.path()).unwrap();
    assert_eq!(
        reopened
            .get(Namespace::SshPassphrase, "/synthetic/injected-key")
            .unwrap()
            .as_deref(),
        Some("synthetic-injected-phrase")
    );
}

#[test]
fn registered_services_share_sqlite_credentials_without_returning_them_over_ipc() {
    let data = tempfile::tempdir().unwrap();
    yforge_core::start_storage(data.path()).unwrap();
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    app.state::<Arc<Secrets>>().bind(data.path()).unwrap();
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let value = tauri::test::get_ipc_response(
        &window,
        InvokeRequest {
            cmd: "ai_provider_add".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(json!({"input": {
                "kind": "openai_compatible", "auth_mode": "api_key", "name": "Local",
                "base_url": "http://127.0.0.1:9/v1", "api_key": "synthetic-ipc-value"
            }})),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .unwrap()
    .deserialize::<Value>()
    .unwrap();
    assert!(!value.to_string().contains("synthetic-ipc-value"));
    let id = value["config"]["id"].as_str().unwrap();
    let reopened = Secrets::new(None);
    reopened.bind(data.path()).unwrap();
    assert_eq!(
        reopened.get(Namespace::Ai, id).unwrap().as_deref(),
        Some("synthetic-ipc-value")
    );

    app.state::<yforge_lib::SshPassphrases>()
        .0
        .set("/synthetic/key", "synthetic-phrase")
        .unwrap();
    assert_eq!(
        reopened
            .get(Namespace::SshPassphrase, "/synthetic/key")
            .unwrap()
            .as_deref(),
        Some("synthetic-phrase")
    );
}
