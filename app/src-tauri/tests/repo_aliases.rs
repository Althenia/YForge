use std::path::Path;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};

struct Session {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

fn start(data: &Path) -> Session {
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build app");
    app.manage(yforge_lib::DataDir(data.to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    Session { _app: app, window }
}

fn call(session: &Session, cmd: &str, body: Value) -> Result<Value, Value> {
    tauri::test::get_ipc_response(
        &session.window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().expect("url"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|response| response.deserialize::<Value>().expect("json response"))
}

#[test]
fn a_repository_alias_is_saved_in_the_data_directory_and_survives_a_restart() {
    let data = tempfile::tempdir().unwrap();
    let before = start(data.path());

    let saved = call(
        &before,
        "repo_alias_set",
        json!({ "path": "/work/api", "alias": "Corp A · API" }),
    )
    .unwrap();
    let after = start(data.path());

    assert_eq!(
        saved,
        json!([{ "path": "/work/api", "alias": "Corp A · API" }])
    );
    assert_eq!(call(&after, "repo_aliases_list", json!({})).unwrap(), saved);
}

#[test]
fn clearing_an_alias_removes_it_and_a_name_over_forty_characters_is_refused() {
    let data = tempfile::tempdir().unwrap();
    let session = start(data.path());
    call(
        &session,
        "repo_alias_set",
        json!({ "path": "/work/api", "alias": "API" }),
    )
    .unwrap();

    let refused = call(
        &session,
        "repo_alias_set",
        json!({ "path": "/work/api", "alias": "x".repeat(41) }),
    )
    .unwrap_err();
    let cleared = call(
        &session,
        "repo_alias_set",
        json!({ "path": "/work/api", "alias": null }),
    )
    .unwrap();

    assert_eq!(refused["kind"], "invalid_request");
    assert_eq!(cleared, json!([]));
}
