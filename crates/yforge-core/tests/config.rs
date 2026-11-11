mod common;

use std::sync::{Mutex, MutexGuard, OnceLock};

fn global_env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

use common::Fixture;
use yforge_core::{
    add_remote, edit_remote, list_remotes, read_identity, remove_remote, write_identity,
    ConfigSource, ErrorKind, IdentityField,
};

#[test]
fn identity_reports_the_source_and_writes_to_the_requested_scope() {
    let _env_guard = global_env_lock();
    let global = tempfile::NamedTempFile::new().unwrap();
    std::env::set_var("GIT_CONFIG_GLOBAL", global.path());
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    let repo = Fixture::init();

    let unset = read_identity(Some(&repo.path)).unwrap();
    write_identity(None, IdentityField::Name, Some("Global Yui")).unwrap();
    write_identity(None, IdentityField::Email, Some("global@example.test")).unwrap();
    write_identity(Some(&repo.path), IdentityField::Name, Some("Repo Yui")).unwrap();
    let effective = read_identity(Some(&repo.path)).unwrap();
    let global_only = read_identity(None).unwrap();
    write_identity(Some(&repo.path), IdentityField::Name, None).unwrap();
    let after_unset = read_identity(Some(&repo.path)).unwrap();
    let empty = write_identity(None, IdentityField::Name, Some("  ")).unwrap_err();

    assert_eq!(unset.name.source, ConfigSource::Unset);
    assert_eq!(unset.email.value, None);
    assert_eq!(effective.name.value.as_deref(), Some("Repo Yui"));
    assert_eq!(effective.name.source, ConfigSource::Repository);
    assert_eq!(
        effective.email.value.as_deref(),
        Some("global@example.test")
    );
    assert_eq!(effective.email.source, ConfigSource::Global);
    assert_eq!(global_only.name.value.as_deref(), Some("Global Yui"));
    assert_eq!(after_unset.name.value.as_deref(), Some("Global Yui"));
    assert_eq!(after_unset.name.source, ConfigSource::Global);
    assert_eq!(empty.kind(), ErrorKind::InvalidRequest);
    assert!(std::fs::read_to_string(global.path())
        .unwrap()
        .contains("Global Yui"));
    assert!(!repo
        .git(&["config", "--local", "--list"])
        .contains("user.name"));
}

#[test]
fn remotes_can_be_added_listed_edited_and_removed() {
    let repo = Fixture::init();
    repo.identity();

    add_remote(&repo.path, "origin", "https://example.test/a.git").unwrap();
    add_remote(&repo.path, "backup", "/srv/backup.git").unwrap();
    repo.git(&[
        "remote",
        "set-url",
        "--push",
        "backup",
        "ssh://git@example.test/b.git",
    ]);
    let listed = list_remotes(&repo.path).unwrap();
    edit_remote(
        &repo.path,
        "origin",
        "upstream",
        "git@example.test:team/a.git",
    )
    .unwrap();
    let edited = list_remotes(&repo.path).unwrap();
    remove_remote(&repo.path, "backup").unwrap();
    let removed = list_remotes(&repo.path).unwrap();

    let summary = |remotes: &[yforge_core::RemoteInfo]| {
        remotes
            .iter()
            .map(|remote| {
                (
                    remote.name.clone(),
                    remote.fetch_url.clone(),
                    remote.push_url.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        summary(&listed),
        [
            (
                "backup".to_owned(),
                "/srv/backup.git".to_owned(),
                Some("ssh://git@example.test/b.git".to_owned())
            ),
            (
                "origin".to_owned(),
                "https://example.test/a.git".to_owned(),
                None
            ),
        ]
    );
    assert_eq!(
        summary(&edited)
            .iter()
            .map(|r| r.0.as_str())
            .collect::<Vec<_>>(),
        ["backup", "upstream"]
    );
    assert_eq!(summary(&edited)[1].1, "git@example.test:team/a.git");
    assert_eq!(
        summary(&removed),
        [(
            "upstream".to_owned(),
            "git@example.test:team/a.git".to_owned(),
            None
        )]
    );
}

#[test]
fn invalid_remote_names_addresses_and_duplicates_are_rejected() {
    let repo = Fixture::init();
    add_remote(&repo.path, "origin", "https://example.test/a.git").unwrap();

    let bad_url = add_remote(&repo.path, "second", "nonsense").unwrap_err();
    let bad_name = add_remote(&repo.path, "bad name", "https://example.test/b.git").unwrap_err();
    let slash = add_remote(&repo.path, "a/b", "https://example.test/b.git").unwrap_err();
    let duplicate = add_remote(&repo.path, "origin", "https://example.test/c.git").unwrap_err();

    assert_eq!(bad_url.kind(), ErrorKind::InvalidRequest);
    assert_eq!(bad_name.kind(), ErrorKind::InvalidRequest);
    assert_eq!(slash.kind(), ErrorKind::InvalidRequest);
    assert_eq!(duplicate.kind(), ErrorKind::GitFailed);
    assert_eq!(list_remotes(&repo.path).unwrap().len(), 1);
}

#[test]
fn folder_git_configs_round_trip_and_identity_reports_folder_source() {
    let _env_guard = global_env_lock();
    let global = tempfile::NamedTempFile::new().unwrap();
    std::env::set_var("GIT_CONFIG_GLOBAL", global.path());
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    let data = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let folder_path = folder.path().canonicalize().unwrap();
    let draft = yforge_core::FolderGitConfigDraft {
        folder: folder_path.to_string_lossy().into_owned(),
        author_name: Some("Folder Yui".into()),
        author_email: Some("folder@example.test".into()),
        ssh_key_path: Some("/tmp/folder-key".into()),
        signing: yforge_core::SigningConfig {
            sign_commits: true,
            sign_tags: false,
            format: yforge_core::SigningFormat::Ssh,
            key: "/tmp/folder-key.pub".into(),
            program: String::new(),
        },
    };
    let saved = yforge_core::save_folder_git_config(data.path(), &draft).unwrap();
    assert_eq!(saved.author_name.as_deref(), Some("Folder Yui"));
    assert_eq!(saved.ssh_key_path.as_deref(), Some("/tmp/folder-key"));
    assert!(saved.config_path.contains("git-folders"));
    let listed = yforge_core::list_folder_git_configs(data.path()).unwrap();
    assert_eq!(listed, vec![saved.clone()]);
    let repo_dir = folder_path.join("repo");
    std::fs::create_dir(&repo_dir).unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_dir)
        .args(["init", "-q", "-b", "main"])
        .env("GIT_CONFIG_GLOBAL", global.path())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    let identity = read_identity(Some(&repo_dir)).unwrap();
    assert_eq!(identity.name.value.as_deref(), Some("Folder Yui"));
    assert_eq!(identity.name.source, ConfigSource::Folder);
    let folder_signing =
        yforge_core::signing_read(yforge_core::SigningScope::Folder, Some(&folder_path)).unwrap();
    assert_eq!(folder_signing, draft.signing);
    yforge_core::remove_folder_git_config(data.path(), &folder_path.to_string_lossy()).unwrap();
    assert!(yforge_core::list_folder_git_configs(data.path())
        .unwrap()
        .is_empty());
    assert!(!std::path::Path::new(&saved.config_path).exists());
}
