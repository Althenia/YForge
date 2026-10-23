#![cfg(target_os = "macos")]

mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use common::Fixture;
use yforge_core::{adopt_login_shell_path, push, CancelToken};

fn executable(path: &Path, script: &str) {
    fs::write(path, script).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn a_hook_finds_tools_on_the_login_shell_path_when_the_app_starts_with_a_bare_path() {
    let tools = tempfile::tempdir().unwrap();
    let launcher_only = tempfile::tempdir().unwrap();
    executable(&tools.path().join("hook-tool"), "#!/bin/sh\nexit 0\n");
    let shell = tools.path().join("login-shell");
    executable(
        &shell,
        &format!(
            "#!/bin/sh\necho 'Welcome back'\nPATH=\"{}:$PATH\"\nexport PATH\neval \"$2\"\n",
            tools.path().display()
        ),
    );
    std::env::set_var("SHELL", &shell);
    std::env::set_var(
        "PATH",
        std::env::join_paths([
            Path::new("/usr/bin"),
            Path::new("/bin"),
            launcher_only.path(),
        ])
        .unwrap(),
    );

    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let remote = repo.add_bare_remote("origin.git");
    repo.git(&["push", "-q", "-u", "origin", "main"]);
    let hooks = repo.sibling("hooks");
    fs::create_dir(&hooks).unwrap();
    executable(&hooks.join("pre-push"), "#!/bin/sh\nhook-tool\n");
    repo.git(&["config", "core.hooksPath", hooks.to_str().unwrap()]);
    let head = repo.commit("a.txt", "two\n", "Second");

    adopt_login_shell_path().unwrap();
    push(&repo.path, &CancelToken::new(), &mut |_| {}).unwrap();

    let path = std::env::var_os("PATH").unwrap();
    let entries: Vec<_> = std::env::split_paths(&path).collect();
    assert_eq!(
        entries.first().map(|entry| entry.as_path()),
        Some(tools.path())
    );
    assert!(entries.iter().any(|entry| entry == launcher_only.path()));
    assert_eq!(
        repo.run_in(&remote, &["rev-parse", "refs/heads/main"]),
        head
    );
}
