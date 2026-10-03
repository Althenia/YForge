mod common;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use common::Fixture;
use yforge_core::{
    commit, create_tag, merge, signing_keys, signing_read, signing_write, CoreError, ErrorKind,
    MergeMode, SigningConfig, SigningFormat, SigningScope,
};

fn global_file() -> &'static (Mutex<()>, PathBuf) {
    static GLOBAL: OnceLock<(Mutex<()>, PathBuf)> = OnceLock::new();
    GLOBAL.get_or_init(|| {
        let file =
            std::env::temp_dir().join(format!("yforge-signing-global-{}", std::process::id()));
        fs::write(&file, "").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        (Mutex::new(()), file)
    })
}

fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn config(format: SigningFormat, key: &str, program: &str) -> SigningConfig {
    SigningConfig {
        sign_commits: true,
        sign_tags: true,
        format,
        key: key.to_owned(),
        program: program.to_owned(),
    }
}

fn ssh_key(dir: &Path) -> PathBuf {
    let key = dir.join("id_signing");
    let status = Command::new("ssh-keygen")
        .args([
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            "yui@example.test",
            "-f",
        ])
        .arg(&key)
        .status()
        .unwrap();
    assert!(status.success());
    key
}

fn repository() -> (Fixture, tempfile::TempDir) {
    global_file();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    (repo, tempfile::tempdir().unwrap())
}

fn topic_and_staged_change(repo: &Fixture) {
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.write("b.txt", "topic\n");
    repo.git(&["add", "b.txt"]);
    repo.git(&["-c", "commit.gpgSign=false", "commit", "-q", "-m", "Topic"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("c.txt", "main\n");
    repo.git(&["add", "c.txt"]);
}

#[test]
fn repository_scope_settings_are_written_to_the_repository_and_read_back() {
    let (repo, _keep) = repository();
    let wanted = config(
        SigningFormat::Ssh,
        "/keys/id_ed25519.pub",
        "/usr/bin/ssh-keygen",
    );

    signing_write(SigningScope::Repository, Some(&repo.path), &wanted).unwrap();

    assert_eq!(
        signing_read(SigningScope::Repository, Some(&repo.path)).unwrap(),
        wanted
    );
    assert_eq!(repo.git(&["config", "--local", "commit.gpgSign"]), "true");
    assert_eq!(repo.git(&["config", "--local", "tag.gpgSign"]), "true");
    assert_eq!(repo.git(&["config", "--local", "gpg.format"]), "ssh");
    assert_eq!(
        repo.git(&["config", "--local", "user.signingkey"]),
        "/keys/id_ed25519.pub"
    );
    assert_eq!(
        repo.git(&["config", "--local", "gpg.program"]),
        "/usr/bin/ssh-keygen"
    );
}

#[test]
fn global_scope_settings_go_to_the_global_file_and_an_empty_key_and_program_are_removed() {
    let (_repo, _keep) = repository();
    let (lock, file) = global_file();
    let _guard = lock.lock().unwrap();
    let wanted = config(SigningFormat::X509, "ABCD1234", "gpgsm-wrapper");

    signing_write(SigningScope::Global, None, &wanted).unwrap();
    let written = fs::read_to_string(file).unwrap();
    assert!(written.contains("gpgSign = true") && written.contains("signingkey = ABCD1234"));
    assert_eq!(signing_read(SigningScope::Global, None).unwrap(), wanted);

    signing_write(
        SigningScope::Global,
        None,
        &config(SigningFormat::Openpgp, "  ", ""),
    )
    .unwrap();
    let cleared = signing_read(SigningScope::Global, None).unwrap();
    assert_eq!((cleared.key.as_str(), cleared.program.as_str()), ("", ""));
}

#[test]
fn a_repository_scope_needs_a_repository() {
    global_file();
    let error = signing_write(
        SigningScope::Repository,
        None,
        &config(SigningFormat::Ssh, "", ""),
    )
    .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidRequest);
}

#[test]
fn commits_tags_and_merge_commits_are_signed_when_signing_is_on() {
    let (repo, keep) = repository();
    let key = ssh_key(keep.path());
    signing_write(
        SigningScope::Repository,
        Some(&repo.path),
        &config(SigningFormat::Ssh, &key.display().to_string(), ""),
    )
    .unwrap();
    topic_and_staged_change(&repo);

    let sha = commit(&repo.path, "Signed commit", "", false).unwrap();
    assert!(repo
        .git(&["cat-file", "commit", &sha])
        .contains("-----BEGIN SSH SIGNATURE-----"));

    create_tag(&repo.path, "v1", None, Some("Release one")).unwrap();
    assert!(repo
        .git(&["cat-file", "tag", "v1"])
        .contains("-----BEGIN SSH SIGNATURE-----"));
    create_tag(&repo.path, "plain", None, None).unwrap();
    assert_eq!(repo.git(&["cat-file", "-t", "plain"]), "tag");
    assert!(repo
        .git(&["cat-file", "tag", "plain"])
        .contains("-----BEGIN SSH SIGNATURE-----"));

    merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap();
    assert!(repo
        .git(&["cat-file", "commit", "HEAD"])
        .contains("-----BEGIN SSH SIGNATURE-----"));
}

#[test]
fn tags_stay_lightweight_when_tag_signing_is_off() {
    let (repo, _keep) = repository();
    signing_write(
        SigningScope::Repository,
        Some(&repo.path),
        &SigningConfig {
            sign_tags: false,
            ..config(SigningFormat::Openpgp, "", "")
        },
    )
    .unwrap();

    create_tag(&repo.path, "light", None, None).unwrap();

    assert_eq!(repo.git(&["cat-file", "-t", "light"]), "commit");
}

#[test]
fn a_signing_failure_shows_gits_message_and_leaves_nothing_committed() {
    let (repo, keep) = repository();
    let failing = script(
        keep.path(),
        "failing-gpg",
        "echo 'no secret key available' >&2\nexit 2",
    );
    signing_write(
        SigningScope::Repository,
        Some(&repo.path),
        &config(
            SigningFormat::Openpgp,
            "MISSING",
            &failing.display().to_string(),
        ),
    )
    .unwrap();
    let head = repo.git(&["rev-parse", "HEAD"]);
    topic_and_staged_change(&repo);

    let committed = commit(&repo.path, "Refused", "", false).unwrap_err();
    assert!(
        matches!(&committed, CoreError::CommitFailed { output, .. } if output.contains("failed to sign the data") && output.contains("no secret key available"))
    );
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert!(repo
        .git(&["diff", "--cached", "--name-only"])
        .contains("c.txt"));

    let tagged = create_tag(&repo.path, "v2", None, Some("Release")).unwrap_err();
    assert!(tagged.to_string().contains("no secret key available"));
    assert_eq!(repo.git(&["tag", "--list", "v2"]), "");

    repo.git(&["reset", "-q", "--hard"]);
    let merged = merge(&repo.path, "topic", MergeMode::MergeCommit).unwrap_err();
    assert!(merged.to_string().contains("no secret key available"));
    assert_eq!(repo.git(&["rev-parse", "HEAD"]), head);
    assert_eq!(repo.git(&["status", "--porcelain"]), "");
    assert!(!repo.path.join(".git/MERGE_HEAD").exists());
}

#[test]
fn lists_openpgp_secret_keys_and_ssh_public_keys() {
    let keep = tempfile::tempdir().unwrap();
    let colons = "sec:u:255:22:AAAABBBBCCCCDDDD:1700000000:::u:::scESC:::+:::23::0:\\nuid:u::::1700000000::HASH::Yui Lin <yui@example.test>::::::::::0:";
    let gpg = script(keep.path(), "fake-gpg", &format!("printf '{colons}\\n'"));
    let ssh = keep.path().join("ssh");
    fs::create_dir(&ssh).unwrap();
    fs::write(
        ssh.join("id_ed25519.pub"),
        "ssh-ed25519 AAAAC3 yui@laptop\n",
    )
    .unwrap();
    fs::write(ssh.join("known_hosts"), "github.com ssh-ed25519 AAAA\n").unwrap();

    let keys = signing_keys(&gpg.display().to_string(), &ssh);

    let described: Vec<(String, SigningFormat)> = keys
        .iter()
        .map(|key| (key.label.clone(), key.format))
        .collect();
    assert_eq!(
        described,
        vec![
            (
                "Yui Lin <yui@example.test> · AAAABBBBCCCCDDDD".to_owned(),
                SigningFormat::Openpgp
            ),
            ("id_ed25519.pub · yui@laptop".to_owned(), SigningFormat::Ssh),
        ]
    );
    assert_eq!(keys[0].id, "AAAABBBBCCCCDDDD");
    assert_eq!(keys[1].id, ssh.join("id_ed25519.pub").display().to_string());
}

#[test]
fn a_missing_gpg_program_lists_only_the_ssh_keys() {
    let keep = tempfile::tempdir().unwrap();
    assert!(signing_keys("/nonexistent/gpg", keep.path()).is_empty());
}
