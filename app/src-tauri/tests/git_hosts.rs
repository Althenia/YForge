use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::Manager;
use yforge_ai::{Ai, MemoryStore};
use yforge_core::{CoreError, PassphraseStore};
use yforge_platform::PlatformService;

#[derive(Default)]
struct Vault {
    saved: Mutex<HashMap<String, String>>,
}

impl PassphraseStore for Vault {
    fn get(&self, key_path: &str) -> Result<Option<String>, CoreError> {
        Ok(self.saved.lock().unwrap().get(key_path).cloned())
    }

    fn set(&self, key_path: &str, passphrase: &str) -> Result<(), CoreError> {
        self.saved
            .lock()
            .unwrap()
            .insert(key_path.to_owned(), passphrase.to_owned());
        Ok(())
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
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

fn private_key(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    fs::write(
        &path,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
    )
    .unwrap();
    path.to_string_lossy().into_owned()
}

#[test]
fn host_identities_choose_the_key_for_fetch_and_clone_and_describe_the_url_for_the_dialog() {
    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().canonicalize().unwrap();
    let home = root.join("home");
    fs::create_dir_all(&home).unwrap();
    let bin = root.join("bin");
    let log = root.join("ssh-arguments");
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
    let repo = root.join("repo");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "git@gitlab.corp-a.com:team/app.git",
        ],
    );

    let secrets = Arc::new(MemoryStore::default());
    let vault = Arc::new(Vault::default());
    let app = yforge_lib::register_with_passphrases(
        mock_builder(),
        Ai::new(secrets.clone()),
        PlatformService::new(secrets),
        vault.clone(),
    )
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
    let clone = |id: &str, url: &str, folder: &str| {
        let _ = fs::remove_file(&log);
        let outcome = call(
            "clone_repo",
            json!({ "id": id, "url": url, "destination": root.join(folder), "options": { "shallow": false, "sparse": false } }),
        );
        assert!(outcome.is_err());
        key_argument(&log)
    };

    assert_eq!(call("git_hosts_list", json!({})).unwrap(), json!([]));
    let identity = |url: &str| call("git_identity_for_url", json!({ "url": url })).unwrap();
    assert_eq!(
        identity("git@gitlab.corp-a.com:team/app.git")["source"],
        "agent"
    );
    assert_eq!(identity("/srv/git/repo.git")["transport"], "other");

    let corp_a_key = private_key(&root, "id_corp_a");
    let saved = call(
        "git_host_save",
        json!({ "id": null, "draft": { "host": "GitLab.Corp-A.com", "ssh_key_path": &corp_a_key, "https_user": "you" } }),
    )
    .unwrap();
    assert_eq!(saved["host"], "gitlab.corp-a.com");
    assert_eq!(saved["has_public_key"], false);
    let listed = call("git_hosts_list", json!({})).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["id"], saved["id"]);

    assert_eq!(fetch("host"), Some(corp_a_key.clone()));
    assert_eq!(
        clone("clone-a", "git@gitlab.corp-a.com:team/other.git", "clone-a"),
        Some(corp_a_key.clone())
    );
    assert_eq!(
        clone("clone-b", "git@gitlab.corp-b.com:team/other.git", "clone-b"),
        None
    );

    let ssh = identity("git@gitlab.corp-a.com:team/app.git");
    assert_eq!(ssh["source"], "host");
    assert_eq!(ssh["host"], "gitlab.corp-a.com");
    assert_eq!(ssh["ssh_key_path"], corp_a_key.as_str());
    let https = identity("https://gitlab.corp-a.com/platform/api.git");
    assert_eq!(
        (https["transport"].clone(), https["https_user"].clone()),
        (json!("https"), json!("you"))
    );

    let repo_key = private_key(&root, "id_repo");
    call(
        "repo_settings_save",
        json!({ "path": path, "settings": { "pull_mode": null, "ssh_key_path": repo_key } }),
    )
    .unwrap();
    assert_eq!(fetch("repo"), Some(repo_key));
    call(
        "repo_settings_save",
        json!({ "path": path, "settings": { "pull_mode": null, "ssh_key_path": null } }),
    )
    .unwrap();

    let public = root.join("id_corp_a.pub");
    fs::write(&public, "ssh-ed25519 AAAA me\n").unwrap();
    let refused = call(
        "git_host_save",
        json!({ "id": saved["id"], "draft": { "host": "gitlab.corp-a.com", "ssh_key_path": public, "https_user": null } }),
    )
    .unwrap_err();
    assert!(
        refused["message"].as_str().unwrap().contains("public key"),
        "{refused}"
    );
    assert_eq!(
        call(
            "git_host_field_problem",
            json!({ "field": "ssh_key", "value": public })
        )
        .unwrap()["title"],
        "That is a public key"
    );
    assert_eq!(
        call(
            "git_host_field_problem",
            json!({ "field": "host", "value": "gitlab.corp-a.com" })
        )
        .unwrap(),
        Value::Null
    );
    assert_eq!(fetch("unchanged"), Some(corp_a_key.clone()));

    let default = call(
        "git_host_default_key_path",
        json!({ "host": "gitlab.corp-b.com:2222" }),
    )
    .unwrap();
    assert_eq!(default, "~/.ssh/yforge_gitlab.corp-b.com");
    assert_eq!(
        call(
            "git_host_field_problem",
            json!({ "field": "new_key", "value": default })
        )
        .unwrap(),
        Value::Null
    );
    let generated = call(
        "git_host_generate_key",
        json!({ "host": "gitlab.corp-b.com:2222", "keyPath": default, "passphrase": "open sesame" }),
    )
    .unwrap();
    let generated_path = home.join(".ssh/yforge_gitlab.corp-b.com");
    assert_eq!(generated, generated_path.to_string_lossy().as_ref());
    assert_eq!(
        vault.saved.lock().unwrap().clone(),
        std::collections::HashMap::from([(
            generated_path.to_string_lossy().into_owned(),
            "open sesame".to_owned()
        )])
    );
    let text = call("ssh_public_key", json!({ "path": &generated })).unwrap();
    assert!(text.as_str().unwrap().starts_with("ssh-ed25519 "));
    assert_eq!(
        call(
            "git_host_field_problem",
            json!({ "field": "new_key", "value": default })
        )
        .unwrap()["title"],
        "A file already exists there"
    );
    assert!(call(
        "git_host_generate_key",
        json!({ "host": "gitlab.corp-b.com", "keyPath": default, "passphrase": null })
    )
    .is_err());
    let lonely = private_key(&root, "id_lonely");
    assert!(call("ssh_public_key", json!({ "path": lonely })).is_err());

    call("git_host_remove", json!({ "id": saved["id"] })).unwrap();
    assert_eq!(call("git_hosts_list", json!({})).unwrap(), json!([]));
    assert_eq!(fetch("removed"), None);
    assert!(
        generated_path.is_file(),
        "removing an identity keeps key files"
    );
    assert_eq!(
        vault.saved.lock().unwrap().len(),
        1,
        "and saved passphrases"
    );
    assert!(call("git_host_remove", json!({ "id": saved["id"] })).is_err());
}
