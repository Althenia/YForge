mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use common::Fixture;
use yforge_core::{fetch, AuthHandler, AuthReply, CancelToken, SshPlan};

fn install_fake_ssh(bin: &Path, log: &Path) {
    fs::create_dir_all(bin).unwrap();
    let script = bin.join("ssh");
    fs::write(
        &script,
        format!(
            "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done > '{}'\nexit 255\n",
            log.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
}

fn app_key_plan(key: &Path) -> SshPlan {
    SshPlan {
        app_key: Some(key.to_path_buf()),
        ..SshPlan::default()
    }
}

fn ssh_arguments(repo: &Fixture, log: &Path, cancel: &CancelToken) -> Vec<String> {
    let _ = fs::remove_file(log);
    assert!(fetch(&repo.path, false, cancel, &mut |_| {}).is_err());
    fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn network_commands_pass_the_chosen_key_to_ssh_and_keep_the_agent_when_none_is_set() {
    let scratch = tempfile::tempdir().unwrap();
    let bin = scratch.path().join("bin");
    let log = scratch.path().join("ssh-arguments");
    install_fake_ssh(&bin, &log);
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    std::env::set_var("PATH", path);
    std::env::remove_var("GIT_SSH_COMMAND");
    std::env::remove_var("GIT_SSH");
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.git(&["remote", "add", "origin", "ssh://git@example.test/repo.git"]);
    let key_dir = scratch.path().join("my keys' dir");
    fs::create_dir_all(&key_dir).unwrap();
    let key = key_dir.join("id_work");

    let unset = ssh_arguments(&repo, &log, &CancelToken::new());
    assert!(!unset.contains(&"-i".to_owned()), "{unset:?}");
    assert!(unset.contains(&"BatchMode=yes".to_owned()), "{unset:?}");

    let chosen = ssh_arguments(
        &repo,
        &log,
        &CancelToken::new().with_ssh_plan(app_key_plan(&key)),
    );
    let position = chosen.iter().position(|argument| argument == "-i").unwrap();
    assert_eq!(chosen[position + 1], key.display().to_string());
    assert!(
        chosen.contains(&"IdentitiesOnly=yes".to_owned()),
        "{chosen:?}"
    );
    assert!(chosen.contains(&"BatchMode=yes".to_owned()), "{chosen:?}");
    assert!(
        chosen.contains(&"ssh://git@example.test/repo.git".to_owned())
            || chosen
                .iter()
                .any(|argument| argument.contains("example.test")),
        "{chosen:?}"
    );

    let handler: AuthHandler = Arc::new(|_| AuthReply::Cancel);
    let interactive = ssh_arguments(
        &repo,
        &log,
        &CancelToken::with_auth(handler).with_ssh_plan(app_key_plan(&key)),
    );
    assert!(interactive.contains(&"-i".to_owned()), "{interactive:?}");
    assert!(
        !interactive.contains(&"BatchMode=yes".to_owned()),
        "{interactive:?}"
    );
}
