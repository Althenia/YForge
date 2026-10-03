use std::path::Path;
use std::process::Command;

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

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

#[test]
fn submodules_are_added_listed_updated_and_deinitialized_through_commands() {
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "protocol.file.allow");
    std::env::set_var("GIT_CONFIG_VALUE_0", "always");
    let data = tempfile::tempdir().unwrap();
    let session = start(data.path());
    let scratch = tempfile::tempdir().unwrap();
    let parent = scratch.path().join("parent");
    let child = scratch.path().join("child");
    git(scratch.path(), &["init", "-q", "child"]);
    git(scratch.path(), &["init", "-q", "parent"]);
    std::fs::write(child.join("lib.txt"), "core\n").unwrap();
    git(&child, &["add", "--", "lib.txt"]);
    git(&child, &["commit", "-q", "-m", "core"]);
    let head = git(&child, &["rev-parse", "HEAD"]);
    git(&parent, &["config", "protocol.file.allow", "always"]);
    std::fs::write(parent.join("README.md"), "parent\n").unwrap();
    git(&parent, &["add", "--", "README.md"]);
    git(&parent, &["commit", "-q", "-m", "parent"]);

    let refused = call(
        &session,
        "submodule_add",
        json!({ "path": parent.to_string_lossy(), "url": "", "submodulePath": "vendor/icons", "branch": null }),
    )
        .unwrap_err();
    assert_eq!(refused["kind"], "invalid_request");
    assert!(refused["message"].as_str().unwrap().contains("Enter a URL"));

    call(
        &session,
        "submodule_add",
        json!({ "path": parent.to_string_lossy(), "url": child.to_string_lossy(), "submodulePath": "vendor/icons", "branch": null }),
    )
        .unwrap();

    let listed = call(
        &session,
        "submodule_list",
        json!({ "path": parent.to_string_lossy() }),
    )
    .unwrap();
    let added = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == "vendor/icons")
        .unwrap();
    assert_eq!(added["status"], "current");
    assert_eq!(added["recorded"], head);
    assert_eq!(added["checked_out"], head);
    assert!(added["branch"].is_null());

    call(
        &session,
        "submodule_stage",
        json!({ "path": parent.to_string_lossy(), "submodulePath": "vendor/icons" }),
    )
    .unwrap();
    call(
        &session,
        "submodule_update",
        json!({ "path": parent.to_string_lossy(), "submodulePath": null }),
    )
    .unwrap();

    call(
        &session,
        "submodule_deinit",
        json!({ "path": parent.to_string_lossy(), "submodulePath": "vendor/icons" }),
    )
    .unwrap();
    let removed = call(
        &session,
        "submodule_list",
        json!({ "path": parent.to_string_lossy() }),
    )
    .unwrap();
    let gone = removed
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == "vendor/icons")
        .unwrap();
    assert_eq!(gone["status"], "uninitialized");
    assert!(gone["checked_out"].is_null());
    assert!(!std::fs::exists(parent.join("vendor/icons/lib.txt")).unwrap());

    call(
        &session,
        "submodule_update",
        json!({ "path": parent.to_string_lossy(), "submodulePath": "vendor/icons" }),
    )
    .unwrap();
    let back = call(
        &session,
        "submodule_list",
        json!({ "path": parent.to_string_lossy() }),
    )
    .unwrap();
    let again = back
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["path"] == "vendor/icons")
        .unwrap();
    assert_eq!(again["status"], "current");
    assert_eq!(again["checked_out"], head);
}
