use std::fs;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;

#[test]
fn cli_install_writes_the_script_under_the_home_bin_directory_and_refuses_foreign_files() {
    let home = tempfile::tempdir().unwrap();
    let home_path = home.path().canonicalize().unwrap();
    std::env::set_var("HOME", &home_path);
    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build app");
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build window");
    let call = || -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            &window,
            InvokeRequest {
                cmd: "cli_install".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("url"),
                body: InvokeBody::Json(json!({})),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().expect("json response"))
    };
    let target = home_path.join(".local/bin/yforge");

    let first = call().unwrap();
    let second = call().unwrap();
    fs::write(&target, "#!/bin/sh\necho mine\n").unwrap();
    let foreign = call().unwrap_err();

    assert_eq!(
        first,
        json!({ "path": target.to_string_lossy(), "replaced": false })
    );
    assert_eq!(
        second,
        json!({ "path": target.to_string_lossy(), "replaced": true })
    );
    assert_eq!(foreign["kind"], "invalid_request");
    assert_eq!(
        fs::read_to_string(&target).unwrap(),
        "#!/bin/sh\necho mine\n"
    );
}
