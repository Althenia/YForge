use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::Manager;

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Yui Lin")
        .env("GIT_AUTHOR_EMAIL", "yui@example.test")
        .env("GIT_COMMITTER_NAME", "Yui Lin")
        .env("GIT_COMMITTER_EMAIL", "yui@example.test")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

fn key_argument(log: &Path) -> Option<String> {
    let text = fs::read_to_string(log).ok()?;
    let arguments: Vec<&str> = text.lines().collect();
    let position = arguments.iter().position(|argument| *argument == "-i")?;
    Some(arguments[position + 1].to_owned())
}

#[test]
fn network_commands_use_the_repository_key_then_the_app_key_and_keys_are_listed_from_home() {
    let scratch = tempfile::tempdir().unwrap();
    let scratch_path = scratch.path().canonicalize().unwrap();
    let home = scratch_path.join("home");
    let ssh_dir = home.join(".ssh");
    fs::create_dir_all(&ssh_dir).unwrap();
    for (name, content) in [
        ("id_ed25519", "private"),
        ("id_ed25519.pub", "ssh-ed25519 AAAA me"),
        ("id_lonely", "private"),
        ("known_hosts", "hosts"),
    ] {
        fs::write(ssh_dir.join(name), content).unwrap();
    }
    let bin = scratch_path.join("bin");
    let log = scratch_path.join("ssh-arguments");
    fs::create_dir_all(&bin).unwrap();
    let fake = bin.join("ssh");
    fs::write(
        &fake,
        format!(
            "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done > '{}'\nexit 255\n",
            log.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    std::env::set_var("HOME", &home);
    std::env::set_var(
        "PATH",
        format!(
            "{}:{}",
            bin.display(),
            std::env::var("PATH").unwrap_or_default()
        ),
    );
    std::env::remove_var("GIT_SSH_COMMAND");
    std::env::remove_var("GIT_SSH");
    let repo = scratch_path.join("repo");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(
        &repo,
        &["remote", "add", "origin", "ssh://git@example.test/repo.git"],
    );
    let app_key = scratch_path.join("id_app");
    let repo_key = scratch_path.join("id_repo");
    fs::write(&app_key, "private").unwrap();
    fs::write(&repo_key, "private").unwrap();

    let app = yforge_lib::register(mock_builder())
        .build(mock_context(noop_assets()))
        .unwrap();
    let data = tempfile::tempdir().unwrap();
    app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let call = |cmd: &str, body: Value| -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            &window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    };
    let path = repo.to_string_lossy().into_owned();
    let fetch = |id: &str| {
        let _ = fs::remove_file(&log);
        let outcome = call(
            "fetch",
            json!({ "path": path, "id": id, "prune": false, "interactive": false }),
        );
        assert!(outcome.is_err());
        key_argument(&log)
    };

    let listed = call("ssh_keys_list", json!({})).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["name"], "id_ed25519");
    assert_eq!(listed[0]["algorithm"], "ssh-ed25519");
    assert_eq!(
        listed[0]["path"],
        ssh_dir.join("id_ed25519").to_string_lossy().as_ref()
    );

    assert_eq!(fetch("none"), None);

    let mut settings = call("settings_load", json!({})).unwrap();
    settings["ssh_key_path"] = json!(app_key.to_string_lossy());
    call("settings_save", json!({ "settings": settings })).unwrap();
    assert_eq!(fetch("app"), Some(app_key.to_string_lossy().into_owned()));

    call(
        "repo_settings_save",
        json!({ "path": path, "settings": { "pull_mode": null, "ssh_key_path": repo_key.to_string_lossy() } }),
    )
    .unwrap();
    assert_eq!(fetch("repo"), Some(repo_key.to_string_lossy().into_owned()));
}
