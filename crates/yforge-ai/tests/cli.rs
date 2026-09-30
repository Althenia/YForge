mod common;

use std::time::{Duration, Instant};

use common::{cli_input, Harness};
use yforge_ai::{Ai, AiError, Environment, Limits, Selection};
use yforge_core::{ai_choose, CancelToken, CommitContext, CoreError, ErrorKind, ProviderKind};

fn context() -> CommitContext {
    CommitContext {
        diff: "=== a.txt (modified) ===\n@@ -1,1 +1,2 @@\n one\n+DIFF-MARKER\n".to_owned(),
        recent_subjects: vec!["Earlier subject".to_owned()],
        excluded: Vec::new(),
        truncated: Vec::new(),
    }
}

async fn select(h: &Harness, ai: &Ai, kind: ProviderKind, model: Option<&str>) -> Selection {
    let added = ai.add(h.dir(), cli_input(kind, "CLI")).await.unwrap();
    ai_choose(h.dir(), Some(&added.config.id), model).unwrap();
    ai.resolve(h.dir()).await.unwrap()
}

fn kind_of(error: AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

fn codex_exec(h: &Harness, body: &str) {
    let (args, cwd, stdin) = (h.log_path("args"), h.log_path("cwd"), h.log_path("stdin"));
    h.script(
        "codex",
        &format!(
            r#"if [ "$1" = exec ]; then
printf '%s\n' "$@" > '{args}'; pwd > '{cwd}'; cat > '{stdin}'
out=""; prev=""; for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
{body}
fi"#
        ),
    );
}

const GOOD: &str = r#"{"summary":"Add thing","description":"Because."}"#;

#[tokio::test]
async fn codex_runs_read_only_in_a_private_directory_with_the_prompt_on_stdin() {
    let h = Harness::new();
    codex_exec(
        &h,
        &format!("printf '%s' '{GOOD}' > \"$out\"; echo '{{\"type\":\"turn.completed\"}}'"),
    );
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, Some("gpt-x")).await;

    let draft = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(
        (draft.summary.as_str(), draft.description.as_str()),
        ("Add thing", "Because.")
    );
    let args: Vec<String> = h.log("args").lines().map(str::to_owned).collect();
    let cwd = h
        .log("cwd")
        .trim()
        .trim_start_matches("/private")
        .to_owned();
    assert_eq!(args[0], "exec");
    for flag in [
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
    ] {
        assert!(args.contains(&flag.to_owned()), "{flag} in {args:?}");
    }
    let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(after("-s"), "read-only");
    assert_eq!(after("--color"), "never");
    assert_eq!(after("-m"), "gpt-x");
    assert_eq!(after("-C").trim_start_matches("/private"), cwd);
    assert!(after("-o").trim_start_matches("/private").starts_with(&cwd));
    assert_eq!(args.last().unwrap(), "-");
    assert!(
        !std::path::Path::new(&cwd).exists(),
        "scratch directory was removed"
    );
    let stdin = h.log("stdin");
    assert!(stdin.contains("You write Git commit messages"));
    assert!(stdin.contains("+DIFF-MARKER"));
    assert!(stdin.contains("- Earlier subject"));
}

#[tokio::test]
async fn codex_without_a_chosen_model_or_with_default_passes_no_model_flag() {
    let h = Harness::new();
    codex_exec(&h, &format!("printf '%s' '{GOOD}' > \"$out\""));
    let ai = h.ai();
    for model in [None, Some("default"), Some("DEFAULT")] {
        let selection = select(&h, &ai, ProviderKind::Chatgpt, model).await;
        ai.commit_message(&selection, &context(), &CancelToken::new())
            .await
            .unwrap();
        assert!(!h.log("args").lines().any(|arg| arg == "-m"), "{model:?}");
    }
}

#[tokio::test]
async fn a_codex_auth_failure_is_ai_auth_required_with_the_cli_message() {
    let h = Harness::new();
    let message = "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
    codex_exec(&h, &format!(
        "echo '{{\"type\":\"error\",\"message\":\"{message}\"}}'; echo '{{\"type\":\"turn.failed\",\"error\":{{\"message\":\"{message}\"}}}}'; echo 'ERROR noisy log line with request id' >&2; exit 1"
    ));
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiAuthRequired { detail, .. } => {
            assert!(detail.contains("refresh token was revoked"));
            assert!(!detail.contains("noisy log line"));
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_codex_failure_keeps_sanitized_output_and_no_secrets() {
    let h = Harness::new();
    codex_exec(&h, "printf 'model overloaded\\nAuthorization: Bearer abc123\\nkey sk-live-0123456789\\n' >&2; exit 1");
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    match CoreError::from(error) {
        CoreError::AiFailed { output, .. } => {
            assert!(output.contains("model overloaded"));
            assert!(!output.contains("abc123") && !output.contains("sk-live"));
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn codex_finishing_without_a_message_or_with_bad_json_is_reported() {
    let h = Harness::new();
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    codex_exec(&h, "exit 0");
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiFailed);

    codex_exec(&h, "printf '%s' 'I cannot help with that' > \"$out\"");
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiInvalidResponse);
}

#[tokio::test]
async fn a_missing_cli_is_provider_unavailable() {
    let h = Harness::new();
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiProviderUnavailable);
}

#[tokio::test]
async fn a_slow_cli_times_out_and_is_killed() {
    let h = Harness::new();
    let pid = h.log_path("pid");
    codex_exec(&h, &format!("echo $$ > '{pid}'; exec sleep 30"));
    let ai = h.ai_with(Limits {
        completion: Duration::from_millis(700),
        ..Limits::default()
    });
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    let started = Instant::now();
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiTimeout);
    assert!(started.elapsed() < Duration::from_secs(10));
    common::assert_stopped(&h.log("pid")).await;
}

#[tokio::test]
async fn cancelling_stops_the_cli_and_returns_cancelled() {
    let h = Harness::new();
    let pid = h.log_path("pid");
    codex_exec(&h, &format!("echo $$ > '{pid}'; exec sleep 30"));
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;
    let token = CancelToken::new();
    let stopper = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        stopper.cancel();
    });

    let started = Instant::now();
    let error = ai
        .commit_message(&selection, &context(), &token)
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(10));
    common::assert_stopped(&h.log("pid")).await;
}

#[tokio::test]
async fn a_token_cancelled_before_the_call_never_starts_the_cli() {
    let h = Harness::new();
    let ran = h.log_path("ran");
    codex_exec(&h, &format!("echo yes > '{ran}'"));
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;
    let token = CancelToken::new();
    token.cancel();

    let error = ai
        .commit_message(&selection, &context(), &token)
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::Cancelled);
    assert_eq!(h.log("ran"), "");
}

fn claude_print(h: &Harness, body: &str) {
    let (args, cwd, stdin) = (h.log_path("args"), h.log_path("cwd"), h.log_path("stdin"));
    h.script(
        "claude",
        &format!("printf '%s\\n' \"$@\" > '{args}'; pwd > '{cwd}'; cat > '{stdin}'\n{body}"),
    );
}

fn claude_json(result: &str) -> String {
    let payload = serde_json::json!({"type": "result", "is_error": false, "result": result});
    format!("echo '{}'", payload.to_string().replace('\'', "'\\''"))
}

#[tokio::test]
async fn claude_runs_with_tools_disabled_the_system_prompt_as_an_argument_and_the_user_prompt_on_stdin(
) {
    let h = Harness::new();
    claude_print(&h, &claude_json(GOOD));
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::ClaudeCode, Some("opus")).await;

    let draft = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(draft.summary, "Add thing");
    let args: Vec<String> = h.log("args").lines().map(str::to_owned).collect();
    let after = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    for flag in [
        "-p",
        "--safe-mode",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--disable-slash-commands",
    ] {
        assert!(args.contains(&flag.to_owned()), "{flag} in {args:?}");
    }
    assert_eq!(after("--output-format"), "json");
    assert_eq!(after("--tools"), "");
    assert_eq!(after("--model"), "opus");
    assert!(after("--system-prompt").contains("You write Git commit messages"));
    let stdin = h.log("stdin");
    assert!(stdin.contains("+DIFF-MARKER"));
    assert!(!stdin.contains("You write Git commit messages"));
    let cwd = h.log("cwd").trim().to_owned();
    assert!(!std::path::Path::new(&cwd).exists());
}

#[tokio::test]
async fn claude_errors_are_classified_from_its_json_result() {
    let h = Harness::new();
    let ai = h.ai();
    let selection = select(&h, &ai, ProviderKind::ClaudeCode, None).await;
    let errored = |result: &str, extra: &str| {
        format!(
            "echo '{{\"type\":\"result\",\"is_error\":true{extra},\"result\":\"{result}\"}}'; exit 1"
        )
    };

    claude_print(&h, &errored("Invalid API key · Please run /login", ""));
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiAuthRequired);

    claude_print(&h, &errored("denied", ",\"api_error_status\":401"));
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiAuthRequired);

    claude_print(&h, &errored("Overloaded, try again", ""));
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    match CoreError::from(error) {
        CoreError::AiFailed { output, .. } => assert!(output.contains("Overloaded")),
        other => panic!("{other:?}"),
    }

    claude_print(&h, "echo 'not json at all'");
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiInvalidResponse);

    claude_print(&h, &claude_json("Sure! here is a message"));
    let error = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap_err();
    assert_eq!(kind_of(error), ErrorKind::AiInvalidResponse);
}

#[tokio::test]
async fn the_cli_is_found_through_the_login_shell_even_when_it_prints_noise() {
    let h = Harness::new();
    let hidden = tempfile::tempdir().unwrap();
    let real = hidden.path().join("codex");
    std::fs::write(&real, "#!/bin/sh\nif [ \"$1\" = exec ]; then cat >/dev/null; out=\"\"; prev=\"\"; for a in \"$@\"; do [ \"$prev\" = -o ] && out=\"$a\"; prev=\"$a\"; done; printf '%s' '{\"summary\":\"Via shell\"}' > \"$out\"; fi\n").unwrap();
    std::fs::set_permissions(&real, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let shell = h.script("fake-shell", &format!(
        "echo 'Last login: today'; echo 'profile noise'\n[ \"$1\" = -lc ] && [ \"$2\" = 'command -v codex' ] && echo '{}'",
        real.display()
    ));
    let ai = Ai::new(h.secrets.clone()).with_environment(Environment {
        shell: Some(shell),
        known_dirs: vec![],
    });
    let selection = select(&h, &ai, ProviderKind::Chatgpt, None).await;

    let draft = ai
        .commit_message(&selection, &context(), &CancelToken::new())
        .await
        .unwrap();

    assert_eq!(draft.summary, "Via shell");
}

#[tokio::test]
async fn a_hanging_login_shell_falls_back_to_the_known_locations() {
    let h = Harness::new();
    h.script("codex", "echo Logged in; exit 0");
    let shell = h.script("slow-shell", "exec sleep 30");
    let ai = Ai::new(h.secrets.clone())
        .with_environment(Environment {
            shell: Some(shell),
            known_dirs: vec![h.bin.path().to_owned()],
        })
        .with_limits(Limits {
            discovery: Duration::from_millis(400),
            ..Limits::default()
        });
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "CLI"))
        .await
        .unwrap();

    let started = Instant::now();
    let status = ai.test(h.dir(), &added.config.id).await.unwrap();

    assert_eq!(status, yforge_core::ProviderStatus::Ready);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test]
async fn a_shell_that_does_not_know_the_command_leaves_it_not_installed() {
    let h = Harness::new();
    let shell = h.script("empty-shell", "exit 1");
    let ai = Ai::new(h.secrets.clone()).with_environment(Environment {
        shell: Some(shell),
        known_dirs: vec![],
    });
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::ClaudeCode, "CLI"))
        .await
        .unwrap();

    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        yforge_core::ProviderStatus::NotInstalled
    );
}
