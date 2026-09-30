mod common;

use common::{cli_input, closed_port_url, http_input, Harness, HttpFake, Reply};
use yforge_core::{
    ai_active_provider, ai_choose, ai_provider, ApiKeyChange, CoreError, ErrorKind, ProviderInput,
    ProviderKind, ProviderStatus, ProviderUpdate,
};

fn kind_of(error: yforge_ai::AiError) -> ErrorKind {
    CoreError::from(error).kind()
}

#[tokio::test]
async fn adding_an_http_provider_keeps_the_key_only_in_the_secret_store() {
    let h = Harness::new();
    let key = "sk-test-very-secret-1234";

    let added = h
        .ai()
        .add(
            h.dir(),
            http_input("Local", "http://127.0.0.1:9/v1/", Some(key)),
        )
        .await
        .unwrap();

    assert!(added.config.has_api_key);
    assert_eq!(
        added.config.base_url.as_deref(),
        Some("http://127.0.0.1:9/v1")
    );
    assert_eq!(added.status, ProviderStatus::Ready);
    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&added.config.id));
    for file in ["yforge.db", "yforge.db-wal"] {
        let bytes = std::fs::read(h.dir().join(file)).unwrap_or_default();
        assert!(
            !bytes
                .windows(key.len())
                .any(|window| window == key.as_bytes()),
            "{file} holds the key"
        );
    }
    let json = serde_json::to_string(&added).unwrap();
    assert!(!json.contains(key));
}

#[tokio::test]
async fn updating_changes_fields_and_the_key_and_clearing_removes_it() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), http_input("Local", "http://localhost:1/v1", None))
        .await
        .unwrap();
    assert!(!added.config.has_api_key && h.secrets.accounts().is_empty());
    let update = |key| ProviderUpdate {
        id: added.config.id.clone(),
        name: "Renamed".to_owned(),
        base_url: Some("https://example.test/v1".to_owned()),
        executable_path: None,
        api_key: key,
    };

    let set = ai
        .update(
            h.dir(),
            update(ApiKeyChange::Set {
                key: " k1 ".to_owned(),
            }),
        )
        .await
        .unwrap();
    assert!(set.config.has_api_key);
    assert_eq!(set.config.name, "Renamed");
    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&added.config.id));

    let kept = ai
        .update(h.dir(), update(ApiKeyChange::Keep))
        .await
        .unwrap();
    assert!(kept.config.has_api_key);

    let cleared = ai
        .update(h.dir(), update(ApiKeyChange::Clear))
        .await
        .unwrap();
    assert!(!cleared.config.has_api_key);
    assert!(h.secrets.accounts().is_empty());
}

#[tokio::test]
async fn removing_a_provider_deletes_its_secret_and_clears_the_active_choice() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(
            h.dir(),
            http_input("Local", "http://localhost:1/v1", Some("k")),
        )
        .await
        .unwrap();
    let other = ai
        .add(
            h.dir(),
            http_input("Other", "http://localhost:2/v1", Some("k2")),
        )
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&added.config.id), Some("m")).unwrap();

    ai.remove(h.dir(), &added.config.id).await.unwrap();

    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&other.config.id));
    assert_eq!(ai_active_provider(h.dir()).unwrap(), None);
    assert_eq!(
        ai_provider(h.dir(), &added.config.id).unwrap_err().kind(),
        ErrorKind::InvalidRequest
    );
}

#[tokio::test]
async fn invalid_provider_input_is_refused_before_anything_is_stored() {
    let h = Harness::new();
    let ai = h.ai();
    let bad: Vec<ProviderInput> = vec![
        http_input("x", "", None),
        http_input("x", "http://example.test/v1", None),
        http_input("x", "ftp://localhost/v1", None),
        http_input("x", "https://user:pw@example.test/v1", None),
        http_input("x", "https://example.test/v1?key=1", None),
        http_input("x", "not a url", None),
        http_input("   ", "https://example.test/v1", None),
        ProviderInput {
            base_url: Some("https://example.test".to_owned()),
            ..cli_input(ProviderKind::Chatgpt, "x")
        },
        ProviderInput {
            api_key: Some("k".to_owned()),
            ..cli_input(ProviderKind::ClaudeCode, "x")
        },
        ProviderInput {
            executable_path: Some("codex".to_owned()),
            ..cli_input(ProviderKind::Chatgpt, "x")
        },
        ProviderInput {
            executable_path: Some("/bin/x".to_owned()),
            ..http_input("x", "https://example.test/v1", None)
        },
        ProviderInput {
            base_url: Some("https://example.test".to_owned()),
            ..cli_input(ProviderKind::Openrouter, "x")
        },
    ];

    for input in bad {
        let error = ai.add(h.dir(), input.clone()).await.unwrap_err();
        assert_eq!(kind_of(error), ErrorKind::InvalidRequest, "{input:?}");
    }

    assert!(ai.list(h.dir()).await.unwrap().is_empty());
    assert!(h.secrets.accounts().is_empty());
}

#[tokio::test]
async fn https_and_loopback_http_urls_are_accepted_and_trimmed() {
    let h = Harness::new();
    let ai = h.ai();
    for (url, expected) in [
        ("https://example.test/v1/", "https://example.test/v1"),
        (" http://localhost:11434/v1 ", "http://localhost:11434/v1"),
        ("http://[::1]:8080/v1", "http://[::1]:8080/v1"),
        ("http://127.0.0.1:1/v1", "http://127.0.0.1:1/v1"),
    ] {
        let added = ai.add(h.dir(), http_input("x", url, None)).await.unwrap();
        assert_eq!(added.config.base_url.as_deref(), Some(expected));
    }
}

#[tokio::test]
async fn openrouter_without_a_key_reports_key_missing_and_cannot_be_used() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Openrouter, "OpenRouter"))
        .await
        .unwrap();
    assert_eq!(added.status, ProviderStatus::KeyMissing);
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::KeyMissing
    );
    ai_choose(h.dir(), Some(&added.config.id), Some("m/x")).unwrap();

    let error = ai.resolve(h.dir()).await.unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiAuthRequired);
}

#[tokio::test]
async fn resolving_needs_an_active_provider_and_for_http_a_model() {
    let h = Harness::new();
    let ai = h.ai();
    assert_eq!(
        kind_of(ai.resolve(h.dir()).await.unwrap_err()),
        ErrorKind::AiNotConfigured
    );
    let added = ai
        .add(
            h.dir(),
            http_input("Local", "http://localhost:1/v1", Some("k-never-printed")),
        )
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&added.config.id), None).unwrap();
    assert_eq!(
        kind_of(ai.resolve(h.dir()).await.unwrap_err()),
        ErrorKind::AiNotConfigured
    );

    ai_choose(h.dir(), Some(&added.config.id), Some("llama")).unwrap();

    let selection = ai.resolve(h.dir()).await.unwrap();
    assert_eq!(selection.config.model.as_deref(), Some("llama"));
    assert!(!format!("{selection:?}").contains("k-never-printed"));
}

#[tokio::test]
async fn a_cli_provider_needs_no_model_to_be_resolved() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::ClaudeCode, "Claude"))
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&added.config.id), None).unwrap();

    assert!(ai.resolve(h.dir()).await.is_ok());
}

#[tokio::test]
async fn the_provider_list_marks_the_active_one_and_keeps_creation_order() {
    let h = Harness::new();
    let ai = h.ai();
    let one = ai
        .add(h.dir(), http_input("One", "http://localhost:1/v1", None))
        .await
        .unwrap();
    let two = ai
        .add(h.dir(), http_input("Two", "http://localhost:2/v1", None))
        .await
        .unwrap();
    ai_choose(h.dir(), Some(&two.config.id), Some("m")).unwrap();

    let listed = ai.list(h.dir()).await.unwrap();

    assert_eq!(
        listed
            .iter()
            .map(|s| (s.config.id.clone(), s.active))
            .collect::<Vec<_>>(),
        [(one.config.id, false), (two.config.id, true)]
    );
}

#[tokio::test]
async fn models_come_from_the_models_endpoint_sorted_with_the_bearer_key() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| {
        Reply::ok(
            r#"{"data":[{"id":"zeta"},{"id":"alpha","name":"Alpha Model"},{"id":"beta","name":"beta"},{"nope":1}]}"#,
        )
    });
    let ai = h.ai();
    let added = ai
        .add(h.dir(), http_input("Local", &fake.url, Some("k-123")))
        .await
        .unwrap();

    let models = ai.models(h.dir(), &added.config.id).await.unwrap();

    assert_eq!(
        models
            .iter()
            .map(|m| (m.id.as_str(), m.name.as_deref()))
            .collect::<Vec<_>>(),
        [
            ("alpha", Some("Alpha Model")),
            ("beta", None),
            ("zeta", None)
        ]
    );
    let requests = fake.requests();
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/v1/models");
    assert_eq!(requests[0].header("authorization"), Some("Bearer k-123"));
}

#[tokio::test]
async fn an_endpoint_without_a_key_gets_no_authorization_header() {
    let h = Harness::new();
    let fake = HttpFake::start(|_| Reply::ok(r#"{"data":[]}"#));
    let ai = h.ai();
    let added = ai
        .add(h.dir(), http_input("Local", &fake.url, None))
        .await
        .unwrap();

    ai.models(h.dir(), &added.config.id).await.unwrap();

    assert_eq!(fake.requests()[0].header("authorization"), None);
}

#[tokio::test]
async fn cli_providers_list_no_models() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "ChatGPT"))
        .await
        .unwrap();

    assert!(ai
        .models(h.dir(), &added.config.id)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn testing_a_connection_maps_each_outcome_to_a_status() {
    let h = Harness::new();
    let ai = h.ai();
    type Check = fn(&ProviderStatus) -> bool;
    let cases: Vec<(Reply, Check)> = vec![
        (Reply::ok(r#"{"data":[]}"#), |s| *s == ProviderStatus::Ready),
        (
            Reply::status(401, r#"{"error":{"message":"bad key"}}"#),
            |s| *s == ProviderStatus::KeyRejected,
        ),
        (Reply::status(403, "no"), |s| {
            *s == ProviderStatus::KeyRejected
        }),
        (Reply::status(404, "missing"), |s| {
            matches!(s, ProviderStatus::CheckFailed { .. })
        }),
        (Reply::ok("not json"), |s| {
            matches!(s, ProviderStatus::CheckFailed { .. })
        }),
    ];
    for (reply, check) in cases {
        let cell = std::sync::Mutex::new(Some(reply));
        let fake = HttpFake::start(move |_| {
            cell.lock()
                .unwrap()
                .take()
                .unwrap_or(Reply::status(500, ""))
        });
        let added = ai
            .add(h.dir(), http_input("Local", &fake.url, Some("k")))
            .await
            .unwrap();
        let status = ai.test(h.dir(), &added.config.id).await.unwrap();
        assert!(check(&status), "{status:?}");
    }
    let closed = ai
        .add(h.dir(), http_input("Closed", &closed_port_url(), None))
        .await
        .unwrap();
    assert!(matches!(
        ai.test(h.dir(), &closed.config.id).await.unwrap(),
        ProviderStatus::Unreachable { .. }
    ));
}

#[tokio::test]
async fn codex_status_follows_its_login_status_command() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::Chatgpt, "ChatGPT"))
        .await
        .unwrap();
    assert_eq!(added.status, ProviderStatus::NotInstalled);

    h.script(
        "codex",
        r#"[ "$1 $2" = "login status" ] && { echo "Logged in using ChatGPT"; exit 0; }; exit 9"#,
    );
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::Ready
    );

    h.script("codex", r#"echo "Not logged in" >&2; exit 1"#);
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::SignedOut
    );

    h.script("codex", r#"echo "boom: config broken" >&2; exit 2"#);
    match ai.test(h.dir(), &added.config.id).await.unwrap() {
        ProviderStatus::CheckFailed { message } => assert!(message.contains("config broken")),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn claude_status_reads_only_the_logged_in_flag() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(h.dir(), cli_input(ProviderKind::ClaudeCode, "Claude"))
        .await
        .unwrap();
    let args = h.log_path("status-args");

    h.script(
        "claude",
        &format!(
            r#"echo "$@" > '{args}'; echo '{{"loggedIn": true, "email": "someone@example.test"}}'"#
        ),
    );
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::Ready
    );
    assert_eq!(h.log("status-args").trim(), "auth status --json");

    h.script("claude", r#"echo '{"loggedIn": false}'; exit 1"#);
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::SignedOut
    );

    h.script("claude", r#"echo "garbled"; exit 3"#);
    assert!(matches!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::CheckFailed { .. }
    ));
}

#[tokio::test]
async fn an_explicit_executable_path_overrides_discovery_and_a_bad_one_is_reported() {
    let h = Harness::new();
    let ai = h.ai();
    let other = tempfile::tempdir().unwrap();
    let custom = other.path().join("my-codex");
    std::fs::write(&custom, "#!/bin/sh\necho Logged in\nexit 0\n").unwrap();
    std::fs::set_permissions(&custom, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let added = ai
        .add(
            h.dir(),
            ProviderInput {
                executable_path: Some(custom.display().to_string()),
                ..cli_input(ProviderKind::Chatgpt, "ChatGPT")
            },
        )
        .await
        .unwrap();
    assert_eq!(added.status, ProviderStatus::Ready);

    std::fs::remove_file(&custom).unwrap();

    assert!(matches!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::CheckFailed { .. }
    ));
}
