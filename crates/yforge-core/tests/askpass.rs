mod common;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Once};
use std::thread;

use common::Fixture;
use yforge_core::{
    fetch, AuthHandler, AuthKind, AuthPrompt, AuthReply, CancelToken, ErrorKind, Progress,
};

const EXPECTED: &str = "Basic eXVpOnMzY3JldA==";

fn isolate() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
    });
}

fn pkt(payload: &str) -> String {
    format!("{:04x}{payload}", payload.len() + 4)
}

fn advertisement() -> String {
    let refs = pkt("0000000000000000000000000000000000000000 capabilities^{}\0agent=test\n");
    format!("{}0000{refs}0000", pkt("# service=git-upload-pack\n"))
}

struct Server {
    port: u16,
    seen: Arc<Mutex<Vec<String>>>,
}

fn server(accept_credentials: bool) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let recorded = seen.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&chunk[..read]),
                }
            }
            let text = String::from_utf8_lossy(&request).into_owned();
            let authorization = text
                .lines()
                .find_map(|line| line.strip_prefix("Authorization: "))
                .map(str::to_owned);
            let granted = accept_credentials && authorization.as_deref() == Some(EXPECTED);
            if let Some(header) = authorization {
                recorded.lock().unwrap().push(header);
            }
            let response = if granted {
                let body = advertisement();
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-git-upload-pack-advertisement\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
            } else {
                "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"test\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned()
            };
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Server { port, seen }
}

fn executable(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

struct Setup {
    repo: Fixture,
    log: PathBuf,
}

fn setup(url: &str) -> Setup {
    isolate();
    let repo = Fixture::init();
    repo.identity();
    repo.commit("a.txt", "one\n", "First");
    let log = repo.sibling("helper.log");
    let helper = executable(
        repo.sibling("").as_path(),
        "helper.sh",
        &format!(
            "case \"$1\" in store) echo store >> {log}; cat >> {log};; erase) echo erase >> {log}; cat >> {log};; esac",
            log = log.display()
        ),
    );
    repo.git(&[
        "config",
        "credential.helper",
        &format!("!{}", helper.display()),
    ]);
    repo.git(&["remote", "add", "origin", url]);
    Setup { repo, log }
}

fn recording(replies: Vec<AuthReply>) -> (AuthHandler, Arc<Mutex<Vec<AuthPrompt>>>) {
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let remaining = Arc::new(Mutex::new(replies.into_iter()));
    let seen = prompts.clone();
    let handler: AuthHandler = Arc::new(move |prompt| {
        seen.lock().unwrap().push(prompt);
        remaining
            .lock()
            .unwrap()
            .next()
            .unwrap_or(AuthReply::Cancel)
    });
    (handler, prompts)
}

fn run_fetch(setup: &Setup, handler: AuthHandler) -> Result<(), yforge_core::CoreError> {
    let mut ignore = |_: Progress| {};
    fetch(
        &setup.repo.path,
        false,
        &CancelToken::with_auth(handler),
        &mut ignore,
    )
}

fn credentials(username: &str, secret: &str, save: bool) -> AuthReply {
    AuthReply::Credentials {
        username: Some(username.to_owned()),
        secret: secret.to_owned(),
        save,
    }
}

fn helper_log(setup: &Setup) -> String {
    fs::read_to_string(&setup.log).unwrap_or_default()
}

#[test]
fn https_credentials_round_trip_through_the_prompt_and_reach_the_server() {
    let server = server(true);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, prompts) = recording(vec![credentials("yui", "s3cret", true)]);

    run_fetch(&setup, handler).unwrap();

    let prompts = prompts.lock().unwrap();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0].kind, AuthKind::Credentials);
    assert_eq!(
        prompts[0].host.as_deref(),
        Some(format!("127.0.0.1:{}", server.port).as_str())
    );
    assert_eq!(prompts[0].username, None);
    assert!(server.seen.lock().unwrap().iter().any(|h| h == EXPECTED));
    let log = helper_log(&setup);
    assert!(log.contains("store"), "{log}");
    assert!(log.contains("username=yui\npassword=s3cret"), "{log}");
    assert!(!log.contains("erase"), "{log}");
}

#[test]
fn declining_to_save_rejects_the_credential_the_helper_just_stored() {
    let server = server(true);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, _) = recording(vec![credentials("yui", "s3cret", false)]);

    run_fetch(&setup, handler).unwrap();

    let log = helper_log(&setup);
    let erased = log.rfind("erase").expect("erase requested");
    assert!(log[erased..].contains("password=s3cret"), "{log}");
}

#[test]
fn rejected_credentials_fail_as_an_authentication_error_and_are_not_saved() {
    let server = server(false);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, prompts) = recording(vec![credentials("yui", "wrong", true)]);

    let error = run_fetch(&setup, handler).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::AuthFailed, "{error:?}");
    assert_eq!(prompts.lock().unwrap().len(), 1);
    assert!(!helper_log(&setup).contains("store"));
}

#[test]
fn cancelling_the_prompt_cancels_the_operation() {
    let server = server(false);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, prompts) = recording(vec![AuthReply::Cancel]);

    let error = run_fetch(&setup, handler).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled, "{error:?}");
    assert_eq!(prompts.lock().unwrap().len(), 1);
}

#[test]
fn an_unanswered_prompt_fails_as_an_authentication_error() {
    let server = server(false);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, _) = recording(vec![AuthReply::TimedOut]);

    let error = run_fetch(&setup, handler).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::AuthFailed, "{error:?}");
}

#[test]
fn secrets_never_appear_in_the_recorded_command_lines_or_output() {
    let server = server(true);
    let setup = setup(&format!("http://127.0.0.1:{}/repo.git", server.port));
    let (handler, _) = recording(vec![credentials("yui", "s3cret", true)]);

    let (result, records) = yforge_core::collect_activity(|| run_fetch(&setup, handler));

    result.unwrap();
    assert!(!records.is_empty());
    let text = format!("{records:?}");
    assert!(!text.contains("s3cret"), "{text}");
}

fn fake_ssh(setup: &Setup, prompt: &str, prompt_kind: &str) -> PathBuf {
    let captured = setup.repo.sibling("ssh-answer");
    let prompt_file = setup.repo.sibling("ssh-prompt");
    fs::write(&prompt_file, prompt).unwrap();
    let script = executable(
        setup.repo.sibling("").as_path(),
        "ssh.sh",
        &format!(
            "answer=$(SSH_ASKPASS_PROMPT={prompt_kind} \"$SSH_ASKPASS\" \"$(cat {prompt})\") || exit 255\nprintf '%s' \"$answer\" > {out}\nexit 255",
            prompt = prompt_file.display(),
            out = captured.display()
        ),
    );
    setup.repo.git(&["config", "ssh.variant", "simple"]);
    setup
        .repo
        .git(&["config", "core.sshCommand", script.to_str().unwrap()]);
    captured
}

#[test]
fn an_ssh_passphrase_prompt_round_trips_through_ssh_askpass() {
    let setup = setup("ssh://git@example.test/repo.git");
    let answer = fake_ssh(&setup, "Enter passphrase for key '/k/id': ", "none");
    let (handler, prompts) = recording(vec![credentials("", "open sesame", false)]);

    let error = run_fetch(&setup, handler).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::GitFailed, "{error:?}");
    assert_eq!(fs::read_to_string(answer).unwrap(), "open sesame");
    let prompts = prompts.lock().unwrap();
    assert_eq!(prompts[0].kind, AuthKind::Passphrase);
    assert!(prompts[0].message.contains("/k/id"));
}

#[test]
fn an_unknown_host_key_prompt_shows_the_fingerprint_and_trust_answers_yes() {
    let setup = setup("ssh://git@example.test/repo.git");
    let prompt = "The authenticity of host 'example.test (192.0.2.1)' can't be established.\nED25519 key fingerprint is SHA256:abc123.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";
    let answer = fake_ssh(&setup, prompt, "confirm");
    let (handler, prompts) = recording(vec![AuthReply::Trust]);

    run_fetch(&setup, handler).unwrap_err();

    assert_eq!(fs::read_to_string(answer).unwrap(), "yes");
    let prompts = prompts.lock().unwrap();
    assert_eq!(prompts[0].kind, AuthKind::HostKey);
    assert_eq!(prompts[0].host.as_deref(), Some("example.test"));
    assert_eq!(prompts[0].fingerprint.as_deref(), Some("SHA256:abc123"));
}

#[test]
fn declining_a_host_key_cancels_the_operation() {
    let setup = setup("ssh://git@example.test/repo.git");
    fake_ssh(
        &setup,
        "Are you sure you want to continue connecting (yes/no)? ",
        "confirm",
    );
    let (handler, _) = recording(vec![AuthReply::Cancel]);

    let error = run_fetch(&setup, handler).unwrap_err();

    assert_eq!(error.kind(), ErrorKind::Cancelled, "{error:?}");
}
