mod common;

use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard, PoisonError};

use common::{Fixture, Vault};
use yforge_core::{
    clone_repository, default_key_path, fetch, generate_ssh_key, git_host_add, git_host_problem,
    git_host_remove, git_host_update, git_hosts_list, public_key_text, remote_address,
    save_repo_settings, save_settings, ssh_plan, url_identity, AppSettings, CancelToken,
    CloneOptions, GitHost, GitHostDraft, GitHostProblem, IdentitySource, RemoteAddress,
    RepoSettings, SshPlan, Transport,
};

static ENVIRONMENT: Mutex<()> = Mutex::new(());

fn address(url: &str) -> Option<(Transport, String)> {
    remote_address(url).map(|RemoteAddress { transport, host }| (transport, host))
}

fn private_key(dir: &Path, name: &str) -> String {
    let path = dir.join(name);
    fs::write(
        &path,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
    )
    .unwrap();
    path.display().to_string()
}

fn draft(host: &str, key: Option<&str>, user: Option<&str>) -> GitHostDraft {
    GitHostDraft {
        host: host.to_owned(),
        ssh_key_path: key.map(str::to_owned),
        https_user: user.map(str::to_owned),
    }
}

fn host(host: &str, key: Option<&str>, user: Option<&str>) -> GitHost {
    GitHost {
        id: host.to_owned(),
        host: host.to_owned(),
        ssh_key_path: key.map(str::to_owned),
        https_user: user.map(str::to_owned),
        ..GitHost::default()
    }
}

#[test]
fn remote_addresses_are_read_from_scp_ssh_and_https_urls() {
    let ssh = |host: &str| Some((Transport::Ssh, host.to_owned()));
    let https = |host: &str| Some((Transport::Https, host.to_owned()));
    assert_eq!(
        address("git@gitlab.corp-a.com:team/app.git"),
        ssh("gitlab.corp-a.com")
    );
    assert_eq!(
        address("gitlab.corp-a.com:team/app.git"),
        ssh("gitlab.corp-a.com")
    );
    assert_eq!(address("  git@GitHub.com:me/lab.git \n"), ssh("github.com"));
    assert_eq!(
        address("ssh://git@gitlab.corp-b.com:2222/payments/ledger.git"),
        ssh("gitlab.corp-b.com:2222")
    );
    assert_eq!(
        address("ssh://gitlab.corp-b.com/payments/ledger.git"),
        ssh("gitlab.corp-b.com")
    );
    assert_eq!(address("ssh://git@[::1]:2200/x.git"), ssh("[::1]:2200"));
    assert_eq!(address("git@[::1]:x.git"), ssh("[::1]"));
    assert_eq!(
        address("https://gitlab.corp-a.com/platform/api.git"),
        https("gitlab.corp-a.com")
    );
    assert_eq!(
        address("https://you:s3cret@gitlab.corp-a.com:8443/platform/api.git"),
        https("gitlab.corp-a.com:8443")
    );
    assert_eq!(
        address("http://127.0.0.1:8080/repo.git"),
        https("127.0.0.1:8080")
    );
    assert_eq!(address("HTTPS://Example.TEST"), https("example.test"));
}

#[test]
fn addresses_without_a_remote_host_have_no_address() {
    for url in [
        "",
        "   ",
        "/srv/git/repo.git",
        "./repo",
        "../repo.git",
        "~/repo",
        "file:///srv/git/repo.git",
        "https://",
        "https:///path",
        "ssh://git@:22/x.git",
        "ssh://git@host:notaport/x.git",
        "ssh://git@host:70000/x.git",
        "plain",
    ] {
        assert_eq!(address(url), None, "{url:?}");
    }
}

#[test]
fn the_git_protocol_names_a_host_but_uses_no_identity() {
    assert_eq!(
        address("git://example.test/repo.git"),
        Some((Transport::Other, "example.test".to_owned()))
    );
}

#[test]
fn host_problems_follow_the_rules_the_store_enforces() {
    let host_problem = |value: &str| git_host_problem("host", value).map(|problem| problem.title);
    assert_eq!(host_problem("gitlab.corp-a.com"), None);
    assert_eq!(host_problem(" GitLab.Corp-B.com:2222 "), None);
    assert_eq!(host_problem("[::1]:22"), None);
    assert_eq!(
        host_problem("   "),
        Some("Enter the host name, such as gitlab.corp-a.com".to_owned())
    );
    for bad in [
        "https://gitlab.corp-a.com",
        "git@gitlab.corp-a.com",
        "gitlab.corp-a.com/team",
        "gitlab corp",
        "gitlab.corp-a.com:",
        "gitlab.corp-a.com:abc",
        "gitlab.corp-a.com:0",
        "gitlab.corp-a.com:65536",
        ":22",
    ] {
        assert_eq!(
            host_problem(bad),
            Some(
                "Enter only the host name and an optional port, such as gitlab.corp-b.com:2222"
                    .to_owned()
            ),
            "{bad:?}"
        );
    }
    assert!(git_host_problem("user", "x").is_none());
}

#[test]
fn key_problems_refuse_public_keys_and_files_that_are_not_private_keys() {
    let dir = tempfile::tempdir().unwrap();
    let key = private_key(dir.path(), "id_corp_b");
    let public = dir.path().join("id_corp_b.pub");
    fs::write(&public, "ssh-ed25519 AAAAC3Nza me@laptop\n").unwrap();
    let disguised = dir.path().join("id_disguised");
    fs::write(&disguised, "ssh-ed25519 AAAAC3Nza me@laptop\n").unwrap();
    let notes = dir.path().join("notes.txt");
    fs::write(&notes, "dear diary\n").unwrap();
    let problem = |value: &str| {
        git_host_problem("ssh_key", value).map(|problem| (problem.title, problem.detail))
    };

    assert_eq!(problem(&key), None);
    assert_eq!(problem(""), None);
    assert_eq!(
        problem(&public.display().to_string()),
        Some((
            "That is a public key".to_owned(),
            Some("Choose the private key file (usually the same name without .pub). Nothing was saved.".to_owned())
        ))
    );
    assert_eq!(
        problem(&disguised.display().to_string()).map(|found| found.0),
        Some("That is a public key".to_owned())
    );
    assert_eq!(
        problem(&notes.display().to_string()),
        Some((
            "That is not an SSH private key".to_owned(),
            Some(
                "Choose a private key file, such as ~/.ssh/id_ed25519. Nothing was saved."
                    .to_owned()
            )
        ))
    );
    assert_eq!(
        problem(&dir.path().join("missing").display().to_string()).map(|found| found.0),
        Some("That key file does not exist".to_owned())
    );
    assert_eq!(
        problem("keys/id_corp_b").map(|found| found.0),
        Some("Use the full path of the key file".to_owned())
    );
    assert_eq!(
        problem(&dir.path().display().to_string()).map(|found| found.0),
        Some("That key file does not exist".to_owned())
    );
}

#[test]
fn identities_are_stored_in_creation_order_with_a_normalised_host_and_no_duplicates() {
    let data = tempfile::tempdir().unwrap();
    let keys = tempfile::tempdir().unwrap();
    let key = private_key(keys.path(), "id_corp_a");
    assert!(git_hosts_list(data.path()).unwrap().is_empty());

    let corp_a = git_host_add(
        data.path(),
        &draft(" GitLab.Corp-A.com ", Some(&key), Some(" you ")),
    )
    .unwrap();
    assert_eq!(corp_a.host, "gitlab.corp-a.com");
    assert_eq!(corp_a.ssh_key_path.as_deref(), Some(key.as_str()));
    assert_eq!(corp_a.https_user.as_deref(), Some("you"));
    let github = git_host_add(data.path(), &draft("github.com", None, Some("   "))).unwrap();
    assert_eq!((github.ssh_key_path, github.https_user), (None, None));
    let ported = git_host_add(data.path(), &draft("gitlab.corp-a.com:2222", None, None)).unwrap();

    let listed = git_hosts_list(data.path()).unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|entry| entry.host.as_str())
            .collect::<Vec<_>>(),
        ["gitlab.corp-a.com", "github.com", "gitlab.corp-a.com:2222"]
    );
    assert_ne!(corp_a.id, ported.id);

    let duplicate = git_host_add(data.path(), &draft("GITHUB.com", None, None)).unwrap_err();
    assert!(duplicate.to_string().contains("github.com"), "{duplicate}");
    assert_eq!(git_hosts_list(data.path()).unwrap().len(), 3);
}

#[test]
fn an_invalid_identity_is_refused_and_nothing_is_saved() {
    let data = tempfile::tempdir().unwrap();
    let keys = tempfile::tempdir().unwrap();
    let public = keys.path().join("id_corp_b.pub");
    fs::write(&public, "ssh-ed25519 AAAA me\n").unwrap();

    let blank = git_host_add(data.path(), &draft("  ", None, None)).unwrap_err();
    assert!(blank.to_string().contains("Enter the host name"), "{blank}");
    let refused = git_host_add(
        data.path(),
        &draft(
            "gitlab.corp-b.com:2222",
            Some(&public.display().to_string()),
            None,
        ),
    )
    .unwrap_err();
    assert!(
        refused.to_string().contains("That is a public key"),
        "{refused}"
    );
    let injected = git_host_add(
        data.path(),
        &draft("github.com", None, Some("you\npassword=x")),
    )
    .unwrap_err();
    assert!(injected.to_string().contains("line break"), "{injected}");
    assert!(git_hosts_list(data.path()).unwrap().is_empty());
}

#[test]
fn updating_and_removing_an_identity_keeps_its_place_and_rejects_unknown_ids() {
    let data = tempfile::tempdir().unwrap();
    let keys = tempfile::tempdir().unwrap();
    let key = private_key(keys.path(), "id_corp_b");
    let first = git_host_add(data.path(), &draft("a.example", None, None)).unwrap();
    let second = git_host_add(data.path(), &draft("b.example", None, None)).unwrap();

    let renamed = git_host_update(
        data.path(),
        &first.id,
        &draft("c.example:2222", Some(&key), Some("yui")),
    )
    .unwrap();
    assert_eq!(renamed.id, first.id);
    assert_eq!(renamed.host, "c.example:2222");
    let listed = git_hosts_list(data.path()).unwrap();
    assert_eq!(listed[0], renamed);
    assert_eq!(listed[1].id, second.id);

    let taken =
        git_host_update(data.path(), &first.id, &draft("b.example", None, None)).unwrap_err();
    assert!(taken.to_string().contains("b.example"), "{taken}");
    git_host_update(data.path(), &first.id, &draft("c.example:2222", None, None)).unwrap();
    assert_eq!(git_hosts_list(data.path()).unwrap()[0].ssh_key_path, None);

    git_host_remove(data.path(), &first.id).unwrap();
    assert_eq!(git_hosts_list(data.path()).unwrap().len(), 1);
    assert!(git_host_remove(data.path(), &first.id).is_err());
    assert!(git_host_update(data.path(), "nope", &draft("d.example", None, None)).is_err());
}

#[test]
fn the_plan_resolves_repository_key_then_host_identity_then_app_key_then_the_agent() {
    let key = |name: &str| Some(PathBuf::from(format!("/keys/{name}")));
    let plan = SshPlan {
        repository_key: None,
        app_key: key("app"),
        hosts: vec![
            host("gitlab.corp-a.com", Some("/keys/corp-a"), Some("you")),
            host("gitlab.corp-b.com:2222", Some("/keys/corp-b"), None),
            host("github.com", None, Some("you")),
        ],
    };
    let source_and_key = |plan: &SshPlan, url: Option<&str>| {
        let resolved = plan.resolve(url);
        (resolved.source, resolved.key)
    };

    assert_eq!(
        source_and_key(&plan, Some("git@gitlab.corp-a.com:team/app.git")),
        (IdentitySource::Host, key("corp-a"))
    );
    assert_eq!(
        source_and_key(&plan, Some("https://gitlab.corp-a.com/team/app.git")),
        (IdentitySource::Host, key("corp-a"))
    );
    assert_eq!(
        source_and_key(&plan, Some("ssh://git@gitlab.corp-b.com:2222/p/l.git")),
        (IdentitySource::Host, key("corp-b"))
    );
    assert_eq!(
        source_and_key(&plan, Some("git@gitlab.corp-b.com:p/l.git")),
        (IdentitySource::App, key("app")),
        "a port-bound identity does not match the same host without that port"
    );
    assert_eq!(
        source_and_key(&plan, Some("git@github.com:me/lab.git")),
        (IdentitySource::Host, None),
        "a matched identity without a key uses the agent, not the app key"
    );
    assert_eq!(
        source_and_key(&plan, Some("git@unknown.example:x.git")),
        (IdentitySource::App, key("app"))
    );
    assert_eq!(
        source_and_key(&plan, None),
        (IdentitySource::App, key("app"))
    );
    assert_eq!(
        source_and_key(&plan, Some("/srv/git/repo.git")),
        (IdentitySource::App, key("app"))
    );

    let own = SshPlan {
        repository_key: key("repo"),
        ..plan.clone()
    };
    assert_eq!(
        source_and_key(&own, Some("git@gitlab.corp-a.com:team/app.git")),
        (IdentitySource::Repository, key("repo"))
    );

    let bare = SshPlan::default();
    assert_eq!(
        source_and_key(&bare, Some("git@gitlab.corp-a.com:team/app.git")),
        (IdentitySource::Agent, None)
    );
}

#[test]
fn the_stored_plan_combines_repository_settings_app_settings_and_identities() {
    let data = tempfile::tempdir().unwrap();
    let keys = tempfile::tempdir().unwrap();
    let app_key = private_key(keys.path(), "id_app");
    let repo_key = private_key(keys.path(), "id_repo");
    let host_key = private_key(keys.path(), "id_host");
    git_host_add(
        data.path(),
        &draft("gitlab.corp-a.com", Some(&host_key), Some("you")),
    )
    .unwrap();
    save_settings(
        data.path(),
        &AppSettings {
            ssh_key_path: Some(app_key.clone()),
            ..AppSettings::default()
        },
    )
    .unwrap();
    save_repo_settings(
        data.path(),
        "/repo",
        &RepoSettings {
            ssh_key_path: Some(repo_key.clone()),
            ..RepoSettings::default()
        },
    )
    .unwrap();

    let plan = ssh_plan(data.path(), Some("/repo")).unwrap();
    assert_eq!(plan.repository_key, Some(PathBuf::from(&repo_key)));
    assert_eq!(plan.app_key, Some(PathBuf::from(&app_key)));
    assert_eq!(plan.hosts.len(), 1);
    assert_eq!(plan.hosts[0].https_user.as_deref(), Some("you"));
    assert_eq!(
        ssh_plan(data.path(), Some("/other"))
            .unwrap()
            .repository_key,
        None
    );
    assert_eq!(ssh_plan(data.path(), None).unwrap().repository_key, None);
}

#[test]
fn the_clone_dialog_is_told_which_identity_a_url_will_use() {
    let data = tempfile::tempdir().unwrap();
    let keys = tempfile::tempdir().unwrap();
    let corp_a = private_key(keys.path(), "yforge_gitlab.corp-a.com");
    git_host_add(
        data.path(),
        &draft("gitlab.corp-a.com", Some(&corp_a), Some("you")),
    )
    .unwrap();
    git_host_add(data.path(), &draft("github.com", None, None)).unwrap();

    let ssh = url_identity(data.path(), "git@gitlab.corp-a.com:team/app.git").unwrap();
    assert_eq!(ssh.transport, Transport::Ssh);
    assert_eq!(ssh.source, IdentitySource::Host);
    assert_eq!(ssh.host.as_deref(), Some("gitlab.corp-a.com"));
    assert_eq!(ssh.ssh_key_path.as_deref(), Some(corp_a.as_str()));
    assert_eq!(ssh.https_user.as_deref(), Some("you"));

    let https = url_identity(data.path(), "https://gitlab.corp-a.com/platform/api.git").unwrap();
    assert_eq!(
        (https.transport, https.source),
        (Transport::Https, IdentitySource::Host)
    );
    assert_eq!(https.https_user.as_deref(), Some("you"));

    let keyless = url_identity(data.path(), "git@github.com:me/lab.git").unwrap();
    assert_eq!(
        (keyless.source, keyless.ssh_key_path, keyless.https_user),
        (IdentitySource::Host, None, None)
    );

    let agent = url_identity(data.path(), "git@other.example:x.git").unwrap();
    assert_eq!(
        (
            agent.transport,
            agent.source,
            agent.host,
            agent.ssh_key_path
        ),
        (Transport::Ssh, IdentitySource::Agent, None, None)
    );

    let local = url_identity(data.path(), "/srv/git/repo.git").unwrap();
    assert_eq!(
        (local.transport, local.source),
        (Transport::Other, IdentitySource::Agent)
    );

    save_settings(
        data.path(),
        &AppSettings {
            ssh_key_path: Some(corp_a.clone()),
            ..AppSettings::default()
        },
    )
    .unwrap();
    let app = url_identity(data.path(), "git@other.example:x.git").unwrap();
    assert_eq!(
        (app.source, app.ssh_key_path),
        (IdentitySource::App, Some(corp_a))
    );
}

fn environment() -> MutexGuard<'static, ()> {
    ENVIRONMENT.lock().unwrap_or_else(PoisonError::into_inner)
}

fn install_fake_ssh(bin: &Path, log: &Path) {
    fs::create_dir_all(bin).unwrap();
    let script = bin.join("ssh");
    fs::write(
        &script,
        format!(
            "#!/bin/sh\nfor argument in \"$@\"; do printf '%s\\n' \"$argument\"; done >> '{}'\nprintf -- '--\\n' >> '{}'\nexit 255\n",
            log.display(),
            log.display()
        ),
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
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
}

fn invocations(log: &Path) -> Vec<Vec<String>> {
    let text = fs::read_to_string(log).unwrap_or_default();
    let mut calls = vec![Vec::new()];
    for line in text.lines() {
        if line == "--" {
            calls.push(Vec::new());
        } else {
            calls.last_mut().unwrap().push(line.to_owned());
        }
    }
    calls.retain(|call| !call.is_empty());
    calls
}

fn key_of(call: &[String]) -> Option<String> {
    let at = call.iter().position(|argument| argument == "-i")?;
    Some(call[at + 1].clone())
}

fn plan() -> SshPlan {
    SshPlan {
        repository_key: None,
        app_key: Some(PathBuf::from("/keys/app")),
        hosts: vec![
            host("corp-a.example", Some("/keys/corp-a"), None),
            host("corp-b.example:2222", Some("/keys/corp-b"), None),
            host("agent.example", None, None),
        ],
    }
}

#[test]
fn every_remote_of_a_fetch_uses_the_identity_of_its_own_host() {
    let _env = environment();
    let scratch = tempfile::tempdir().unwrap();
    let log = scratch.path().join("ssh-arguments");
    install_fake_ssh(&scratch.path().join("bin"), &log);
    let token = CancelToken::new().with_ssh_plan(plan());
    let mut ignore = |_: yforge_core::Progress| {};
    let upstream = Fixture::init();
    upstream.identity();
    upstream.commit("a.txt", "one\n", "First");

    for (url, expected) in [
        ("git@corp-a.example:team/app.git", Some("/keys/corp-a")),
        (
            "ssh://git@corp-b.example:2222/pay/ledger.git",
            Some("/keys/corp-b"),
        ),
        ("git@agent.example:x/y.git", None),
        ("git@unmatched.example:x/y.git", Some("/keys/app")),
    ] {
        let _ = fs::remove_file(&log);
        let repo = Fixture::init();
        repo.git(&[
            "remote",
            "add",
            "a-local",
            &upstream.path.display().to_string(),
        ]);
        repo.git(&["remote", "add", "b-ssh", url]);

        assert!(
            fetch(&repo.path, false, &token, &mut ignore).is_err(),
            "{url}"
        );

        let calls = invocations(&log);
        assert_eq!(
            calls.len(),
            1,
            "{url}: only the ssh remote reaches ssh: {calls:?}"
        );
        assert_eq!(key_of(&calls[0]).as_deref(), expected, "{url}");
        assert_eq!(
            calls[0].contains(&"IdentitiesOnly=yes".to_owned()),
            expected.is_some(),
            "{url}: {calls:?}"
        );
    }
}

#[test]
fn the_repository_key_overrides_the_identity_of_a_matching_host() {
    let _env = environment();
    let scratch = tempfile::tempdir().unwrap();
    let log = scratch.path().join("ssh-arguments");
    install_fake_ssh(&scratch.path().join("bin"), &log);
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    repo.git(&["remote", "add", "origin", "git@corp-a.example:team/app.git"]);
    let own = SshPlan {
        repository_key: Some(PathBuf::from("/keys/repo")),
        ..plan()
    };
    let mut ignore = |_: yforge_core::Progress| {};

    assert!(fetch(
        &repo.path,
        false,
        &CancelToken::new().with_ssh_plan(own),
        &mut ignore
    )
    .is_err());

    assert_eq!(key_of(&invocations(&log)[0]).as_deref(), Some("/keys/repo"));
}

#[test]
fn a_clone_uses_the_identity_of_the_url_host_and_the_app_key_for_unknown_hosts() {
    let _env = environment();
    let scratch = tempfile::tempdir().unwrap();
    let log = scratch.path().join("ssh-arguments");
    install_fake_ssh(&scratch.path().join("bin"), &log);
    let token = CancelToken::new().with_ssh_plan(plan());
    let mut ignore = |_: yforge_core::Progress| {};

    for (url, expected) in [
        ("git@corp-a.example:team/app.git", Some("/keys/corp-a")),
        (
            "ssh://git@corp-b.example:2222/pay/ledger.git",
            Some("/keys/corp-b"),
        ),
        ("git@agent.example:x/y.git", None),
        ("git@unmatched.example:x/y.git", Some("/keys/app")),
    ] {
        let _ = fs::remove_file(&log);
        let destination = scratch.path().join("clones").join(url.len().to_string());
        let outcome = clone_repository(
            url,
            &destination,
            &CloneOptions::default(),
            &token,
            &mut ignore,
        );
        assert!(outcome.is_err(), "{url}");
        let calls = invocations(&log);
        assert_eq!(calls.len(), 1, "{url}: {calls:?}");
        assert_eq!(key_of(&calls[0]).as_deref(), expected, "{url}");
        assert!(
            !destination.exists(),
            "a failed clone leaves nothing behind"
        );
    }
}

fn unlocks(key: &Path, passphrase: &str) -> bool {
    Command::new("ssh-keygen")
        .args(["-y", "-P", passphrase, "-f"])
        .arg(key)
        .output()
        .unwrap()
        .status
        .success()
}

#[test]
fn the_default_key_path_is_named_after_the_host_without_its_port() {
    assert_eq!(
        default_key_path("gitlab.corp-b.com:2222").unwrap(),
        "~/.ssh/yforge_gitlab.corp-b.com"
    );
    assert_eq!(
        default_key_path(" GitHub.com ").unwrap(),
        "~/.ssh/yforge_github.com"
    );
    assert_eq!(default_key_path("[::1]:22").unwrap(), "~/.ssh/yforge____1");
    assert!(default_key_path("not a host").is_err());
}

#[test]
fn a_new_key_path_is_refused_when_a_file_exists_there_or_the_parent_is_not_a_folder() {
    let dir = tempfile::tempdir().unwrap();
    let existing = private_key(dir.path(), "id_taken");
    let only_pub = dir.path().join("id_half");
    fs::write(public_key_of(&only_pub), "ssh-ed25519 AAAA me\n").unwrap();
    let file_parent = dir.path().join("id_taken").join("child");
    let problem = |value: &str| git_host_problem("new_key", value);
    let title = |value: &str| problem(value).map(|found| found.title);

    assert_eq!(
        problem(&dir.path().join("fresh").display().to_string()),
        None
    );
    assert_eq!(
        problem(
            &dir.path()
                .join("deeper/missing/fresh")
                .display()
                .to_string()
        ),
        None,
        "missing folders are created"
    );
    assert_eq!(
        problem(&existing),
        Some(GitHostProblem {
            title: "A file already exists there".to_owned(),
            detail: Some("YForge never overwrites a key. Choose another path, or pick that file with Choose key file…".to_owned()),
        })
    );
    assert_eq!(
        title(&only_pub.display().to_string()).as_deref(),
        Some("A file already exists there")
    );
    assert_eq!(
        title(&file_parent.display().to_string()).as_deref(),
        Some("The parent of that path is not a folder")
    );
    assert_eq!(
        title(&dir.path().display().to_string()).as_deref(),
        Some("A file already exists there")
    );
    assert_eq!(
        title("").as_deref(),
        Some("Enter where to write the key, such as ~/.ssh/yforge_gitlab.corp-a.com")
    );
    assert_eq!(
        title("keys/id").as_deref(),
        Some("Use the full path of the key file")
    );
    assert_eq!(
        title(&dir.path().join("fresh.pub").display().to_string()).as_deref(),
        Some("Name the private key, without .pub")
    );
}

fn public_key_of(key: &Path) -> PathBuf {
    PathBuf::from(format!("{}.pub", key.display()))
}

#[test]
fn a_generated_key_is_an_ed25519_pair_at_the_chosen_path_that_is_never_overwritten() {
    let ssh_dir = tempfile::tempdir().unwrap().keep().join(".ssh");
    let vault = Vault::default();
    let target = ssh_dir.join("yforge_gitlab.corp-b.com");

    let plain = generate_ssh_key(
        "gitlab.corp-b.com:2222",
        &target.display().to_string(),
        None,
        &vault,
    )
    .unwrap();

    assert_eq!(plain, target);
    assert_eq!(
        fs::metadata(&plain).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(&ssh_dir).unwrap().permissions().mode() & 0o777,
        0o700
    );
    let public = public_key_text(&plain).unwrap();
    assert!(public.starts_with("ssh-ed25519 "), "{public}");
    assert!(!public.ends_with('\n'));
    assert!(public.ends_with("yforge@gitlab.corp-b.com"), "{public}");
    assert!(unlocks(&plain, ""), "no passphrase was set");
    assert!(vault.saved.lock().unwrap().is_empty());

    let again = generate_ssh_key(
        "gitlab.corp-b.com",
        &target.display().to_string(),
        Some("x"),
        &vault,
    )
    .unwrap_err();
    assert!(
        again.to_string().contains("yforge_gitlab.corp-b.com"),
        "{again}"
    );
    assert_eq!(public_key_text(&plain).unwrap(), public);
    assert!(vault.saved.lock().unwrap().is_empty());
}

#[test]
fn a_passphrase_protects_the_key_and_is_saved_in_the_keychain_under_the_absolute_key_path() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::default();
    let target = dir.path().join("keys/yforge_github.com");

    let key = generate_ssh_key(
        "github.com",
        &target.display().to_string(),
        Some("s3cret pass phrase"),
        &vault,
    )
    .unwrap();

    assert!(!unlocks(&key, "wrong"));
    assert!(unlocks(&key, "s3cret pass phrase"));
    assert_eq!(
        vault.saved.lock().unwrap().clone(),
        HashMap::from([(key.display().to_string(), "s3cret pass phrase".to_owned())])
    );
    assert_eq!(fs::read_dir(dir.path().join("keys")).unwrap().count(), 2);
}

#[test]
fn a_blank_passphrase_means_none_and_leaves_the_keychain_alone() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault::default();

    let key = generate_ssh_key(
        "blank.example",
        &dir.path().join("k").display().to_string(),
        Some(""),
        &vault,
    )
    .unwrap();

    assert!(unlocks(&key, ""));
    assert!(vault.saved.lock().unwrap().is_empty());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn a_keychain_that_refuses_the_passphrase_leaves_no_key_behind() {
    let dir = tempfile::tempdir().unwrap();
    let vault = Vault {
        refuse: true,
        ..Vault::default()
    };

    let error = generate_ssh_key(
        "locked.example",
        &dir.path().join("k").display().to_string(),
        Some("pw"),
        &vault,
    )
    .unwrap_err();

    assert!(
        error.to_string().contains("the Keychain is locked"),
        "{error}"
    );
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn the_public_key_text_is_missing_when_the_pub_file_is_gone() {
    let dir = tempfile::tempdir().unwrap();
    let key = private_key(dir.path(), "id_lonely");
    let missing = public_key_text(Path::new(&key)).unwrap_err();
    assert!(missing.to_string().contains("id_lonely.pub"), "{missing}");
}

#[test]
fn the_listing_shows_the_kind_and_fingerprint_of_keys_that_have_a_public_half() {
    let data = tempfile::tempdir().unwrap();
    let ssh_dir = tempfile::tempdir().unwrap();
    let generated = generate_ssh_key(
        "kind.example",
        &ssh_dir
            .path()
            .join("yforge_kind.example")
            .display()
            .to_string(),
        None,
        &Vault::default(),
    )
    .unwrap();
    let bare = private_key(ssh_dir.path(), "id_bare");
    git_host_add(
        data.path(),
        &draft("kind.example", Some(&generated.display().to_string()), None),
    )
    .unwrap();
    git_host_add(data.path(), &draft("bare.example", Some(&bare), None)).unwrap();
    git_host_add(data.path(), &draft("agent.example", None, None)).unwrap();

    let listed = git_hosts_list(data.path()).unwrap();
    assert_eq!(listed[0].key_kind.as_deref(), Some("ed25519"));
    assert!(listed[0]
        .key_fingerprint
        .as_deref()
        .is_some_and(|text| text.starts_with("SHA256:")));
    assert!(listed[0].has_public_key);
    assert_eq!(
        (
            listed[1].key_kind.clone(),
            listed[1].key_fingerprint.clone(),
            listed[1].has_public_key
        ),
        (None, None, false)
    );
    assert_eq!(
        (listed[2].key_kind.clone(), listed[2].has_public_key),
        (None, false)
    );
}
