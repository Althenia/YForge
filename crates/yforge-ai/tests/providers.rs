mod common;

use common::{
    closed_port_url, configure, http_input, keyed_input, provider_input, Harness, HttpFake, Reply,
};
use yforge_core::{
    ai_provider, AiFeature, ApiKeyChange, AuthMode, CoreError, ErrorKind, ProviderInput,
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
        auth_mode: AuthMode::ApiKey,
        name: "Renamed".to_owned(),
        base_url: Some("https://example.test/v1".to_owned()),
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

    ai.remove(h.dir(), &added.config.id).await.unwrap();

    assert_eq!(h.secrets.accounts(), std::slice::from_ref(&other.config.id));
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
            ..provider_input(ProviderKind::Chatgpt, AuthMode::ApiKey, "x")
        },
        ProviderInput {
            base_url: Some("https://example.test".to_owned()),
            ..provider_input(ProviderKind::Openrouter, AuthMode::ApiKey, "x")
        },
        ProviderInput {
            api_key: Some("k".to_owned()),
            ..provider_input(ProviderKind::Claude, AuthMode::Subscription, "x")
        },
        provider_input(ProviderKind::Openrouter, AuthMode::Subscription, "x"),
        ProviderInput {
            auth_mode: AuthMode::Subscription,
            ..http_input("x", "https://example.test/v1", None)
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
        .add(
            h.dir(),
            provider_input(ProviderKind::Openrouter, AuthMode::ApiKey, "OpenRouter"),
        )
        .await
        .unwrap();
    assert_eq!(added.status, ProviderStatus::KeyMissing);
    assert_eq!(
        ai.test(h.dir(), &added.config.id).await.unwrap(),
        ProviderStatus::KeyMissing
    );
    configure(&h, &ai, &added.config.id, "m/x").await;

    let error = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap_err();

    assert_eq!(kind_of(error), ErrorKind::AiAuthRequired);
}

#[tokio::test]
async fn resolving_needs_a_saved_feature_that_is_switched_on() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(
            h.dir(),
            http_input("Local", "http://localhost:1/v1", Some("k-never-printed")),
        )
        .await
        .unwrap();
    let unset = CoreError::from(
        ai.resolve(h.dir(), AiFeature::GenerateCommit)
            .await
            .unwrap_err(),
    );
    configure(&h, &ai, &added.config.id, "llama").await;

    let selection = ai
        .resolve(h.dir(), AiFeature::GenerateCommit)
        .await
        .unwrap();
    ai.enable_feature(h.dir(), AiFeature::GenerateCommit, false)
        .await
        .unwrap();
    let off = CoreError::from(
        ai.resolve(h.dir(), AiFeature::GenerateCommit)
            .await
            .unwrap_err(),
    );

    assert_eq!(unset.kind(), ErrorKind::AiNotConfigured);
    assert_eq!(
        unset.to_string(),
        "Choose a provider and model for Generate commit message in Settings → AI"
    );
    assert_eq!(selection.model, "llama");
    assert!(!format!("{selection:?}").contains("k-never-printed"));
    assert_eq!(off.kind(), ErrorKind::AiNotConfigured);
    assert_eq!(
        off.to_string(),
        "Generate commit message is turned off in Settings → AI"
    );
}

#[tokio::test]
async fn the_provider_list_keeps_creation_order() {
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

    let listed = ai.list(h.dir()).await.unwrap();

    assert_eq!(
        listed
            .iter()
            .map(|s| s.config.id.clone())
            .collect::<Vec<_>>(),
        [one.config.id, two.config.id]
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
            .map(|m| (m.id.as_str(), m.display_name.as_str(), m.context_window))
            .collect::<Vec<_>>(),
        [
            ("alpha", "Alpha Model", None),
            ("beta", "beta", None),
            ("zeta", "zeta", None)
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
async fn keyless_chatgpt_and_claude_report_key_missing_and_signed_out_in_subscription_mode() {
    let h = Harness::new();
    let ai = h.ai();
    let mut seen = Vec::new();
    for (kind, mode) in [
        (ProviderKind::Chatgpt, AuthMode::ApiKey),
        (ProviderKind::Claude, AuthMode::ApiKey),
        (ProviderKind::Chatgpt, AuthMode::Subscription),
        (ProviderKind::Claude, AuthMode::Subscription),
    ] {
        let added = ai
            .add(h.dir(), provider_input(kind, mode, kind.label()))
            .await
            .unwrap();
        seen.push((
            added.status.clone(),
            ai.test(h.dir(), &added.config.id).await.unwrap(),
        ));
    }

    assert_eq!(
        seen,
        [
            (ProviderStatus::KeyMissing, ProviderStatus::KeyMissing),
            (ProviderStatus::KeyMissing, ProviderStatus::KeyMissing),
            (ProviderStatus::SignedOut, ProviderStatus::SignedOut),
            (ProviderStatus::SignedOut, ProviderStatus::SignedOut),
        ]
    );
}

#[tokio::test]
async fn a_key_in_the_keychain_makes_a_hosted_provider_ready_without_a_network_call() {
    let h = Harness::new();
    let ai = h.ai();

    let added = ai
        .add(
            h.dir(),
            keyed_input(ProviderKind::Claude, "Claude", "sk-ant-1"),
        )
        .await
        .unwrap();

    assert_eq!(added.status, ProviderStatus::Ready);
    assert_eq!(added.config.auth_mode, AuthMode::ApiKey);
}

#[tokio::test]
async fn switching_a_provider_to_subscription_mode_is_an_update_and_refuses_a_key() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(
            h.dir(),
            keyed_input(ProviderKind::Chatgpt, "ChatGPT", "sk-1"),
        )
        .await
        .unwrap();
    let update = |api_key| ProviderUpdate {
        id: added.config.id.clone(),
        auth_mode: AuthMode::Subscription,
        name: "ChatGPT".to_owned(),
        base_url: None,
        api_key,
    };

    let refused = ai
        .update(
            h.dir(),
            update(ApiKeyChange::Set {
                key: "sk-2".to_owned(),
            }),
        )
        .await
        .unwrap_err();
    let switched = ai
        .update(h.dir(), update(ApiKeyChange::Keep))
        .await
        .unwrap();

    assert_eq!(kind_of(refused), ErrorKind::InvalidRequest);
    assert_eq!(switched.config.auth_mode, AuthMode::Subscription);
    assert_eq!(switched.status, ProviderStatus::SignedOut);
}

#[tokio::test]
async fn removing_a_provider_also_deletes_its_oauth_tokens() {
    let h = Harness::new();
    let ai = h.ai();
    let added = ai
        .add(
            h.dir(),
            provider_input(ProviderKind::Chatgpt, AuthMode::Subscription, "ChatGPT"),
        )
        .await
        .unwrap();
    let account = format!("{}:oauth", added.config.id);
    yforge_ai::SecretStore::set(&*h.secrets, &account, "{}").unwrap();

    ai.remove(h.dir(), &added.config.id).await.unwrap();

    assert!(h.secrets.accounts().is_empty());
}
