mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use common::{cli_input, http_input, Harness};
use yforge_ai::AiError;
use yforge_core::{
    AiSignInMethod, AiSignInStage, CancelToken, CoreError, ErrorKind, ProviderKind, ProviderStatus,
};

const DEVICE_OUTPUT: &str = r#"printf 'Welcome to Codex [v\033[90m0.154.0\033[0m]\n'
printf '1. Open this link\n   \033[94mhttps://auth.example.test/codex/device\033[0m\n'
printf '2. Enter this one-time code\n   \033[94mABCD-EFGHI\033[0m\n'"#;

fn collector() -> (
    Arc<Mutex<Vec<AiSignInStage>>>,
    impl Fn(AiSignInStage) + Send + Sync,
) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (seen, move |stage| sink.lock().unwrap().push(stage))
}

#[tokio::test]
async fn device_code_sign_in_reports_the_code_then_completes_with_the_new_status() {
    let h = Harness::new();
    let gate = h.log_path("go");
    let args = h.log_path("args");
    h.script(
        "codex",
        &format!(
            r#"if [ "$1 $2" = "login status" ]; then echo "Logged in using ChatGPT"; exit 0; fi
printf '%s\n' "$@" > '{args}'
{DEVICE_OUTPUT}
while [ ! -f '{gate}' ]; do sleep 0.1; done
exit 0"#
        ),
    );
    let ai = Arc::new(h.ai());
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "ChatGPT"))
        .await
        .unwrap();
    let (seen, sink) = collector();
    let dir = h.dir().to_owned();
    let id = added.config.id.clone();
    let task = tokio::spawn({
        let ai = ai.clone();
        async move {
            ai.sign_in(
                &dir,
                &id,
                AiSignInMethod::DeviceCode,
                &CancelToken::new(),
                &sink,
            )
            .await
        }
    });

    let deadline = Instant::now() + Duration::from_secs(10);
    while seen.lock().unwrap().is_empty() {
        assert!(Instant::now() < deadline, "no device code event");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(
        seen.lock().unwrap().clone(),
        [AiSignInStage::DeviceCode {
            url: "https://auth.example.test/codex/device".to_owned(),
            code: "ABCD-EFGHI".to_owned()
        }]
    );
    assert!(!task.is_finished(), "still waiting for the user");
    std::fs::write(&gate, "").unwrap();
    let status = task.await.unwrap().unwrap();

    assert_eq!(status, ProviderStatus::Ready);
    assert_eq!(h.log("args").trim(), "login\n--device-auth");
    assert_eq!(
        seen.lock().unwrap().last().unwrap(),
        &AiSignInStage::Completed {
            status: ProviderStatus::Ready
        }
    );
}

#[tokio::test]
async fn browser_sign_in_runs_the_plain_login_commands_and_emits_no_device_code() {
    let h = Harness::new();
    let args = h.log_path("args");
    h.script(
        "codex",
        &format!(
            r#"if [ "$1 $2" = "login status" ]; then exit 0; fi
printf '%s\n' "$@" > '{args}'; {DEVICE_OUTPUT}; exit 0"#
        ),
    );
    h.script(
        "claude",
        &format!(
            r#"if [ "$1 $2" = "auth status" ]; then echo '{{"loggedIn": true}}'; exit 0; fi
printf '%s\n' "$@" > '{args}'; exit 0"#
        ),
    );
    let ai = h.ai();
    for (kind, expected) in [
        (ProviderKind::Chatgpt, "login"),
        (ProviderKind::ClaudeCode, "auth\nlogin"),
    ] {
        let added = ai.add(h.dir(), cli_input(kind, "CLI")).await.unwrap();
        let (seen, sink) = collector();

        let status = ai
            .sign_in(
                h.dir(),
                &added.config.id,
                AiSignInMethod::Browser,
                &CancelToken::new(),
                &sink,
            )
            .await
            .unwrap();

        assert_eq!(status, ProviderStatus::Ready);
        assert_eq!(h.log("args").trim(), expected);
        assert_eq!(
            seen.lock().unwrap().clone(),
            [AiSignInStage::Completed {
                status: ProviderStatus::Ready
            }]
        );
    }
}

#[tokio::test]
async fn cancelling_a_sign_in_stops_the_login_process() {
    let h = Harness::new();
    let pid = h.log_path("pid");
    h.script("codex", &format!("[ \"$1\" = status ] || [ \"$2\" = status ] && exit 0\necho $$ > '{pid}'\n{DEVICE_OUTPUT}\nexec sleep 30"));
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "ChatGPT"))
        .await
        .unwrap();
    let token = CancelToken::new();
    let stopper = token.clone();
    let sink = move |stage: AiSignInStage| {
        if matches!(stage, AiSignInStage::DeviceCode { .. }) {
            stopper.cancel();
        }
    };

    let error = ai
        .sign_in(
            h.dir(),
            &added.config.id,
            AiSignInMethod::DeviceCode,
            &token,
            &sink,
        )
        .await
        .unwrap_err();

    assert_eq!(CoreError::from(error).kind(), ErrorKind::Cancelled);
    common::assert_stopped(&h.log("pid")).await;
}

#[tokio::test]
async fn a_failing_login_reports_its_sanitized_output() {
    let h = Harness::new();
    h.script("codex", "echo 'login server unreachable' >&2; exit 1");
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "ChatGPT"))
        .await
        .unwrap();
    let (seen, sink) = collector();

    let error = ai
        .sign_in(
            h.dir(),
            &added.config.id,
            AiSignInMethod::Browser,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiFailed { output, .. } => assert!(output.contains("login server unreachable")),
        other => panic!("{other:?}"),
    }
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unsupported_sign_ins_are_invalid_requests() {
    let h = Harness::new();
    h.script("claude", "exit 0");
    let ai = h.ai();
    let claude = ai
        .add(h.dir(), cli_input(ProviderKind::ClaudeCode, "Claude"))
        .await
        .unwrap();
    let http = ai
        .add(h.dir(), http_input("Local", "http://localhost:1/v1", None))
        .await
        .unwrap();
    let (_, sink) = collector();

    let device = ai
        .sign_in(
            h.dir(),
            &claude.config.id,
            AiSignInMethod::DeviceCode,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();
    let remote = ai
        .sign_in(
            h.dir(),
            &http.config.id,
            AiSignInMethod::Browser,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();

    for error in [device, remote] {
        assert!(matches!(error, AiError::Invalid { .. }));
    }
}
