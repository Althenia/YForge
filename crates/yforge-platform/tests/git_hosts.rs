mod common;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{HttpFake, Recorded, Reply};
use reqwest::Url;
use serde_json::json;
use yforge_core::{
    git_host_add, git_host_update, ssh_plan, CancelToken, CoreError, GitHost, GitHostDraft,
    GitHostMethodNote, GitHostProvider, GitHostSignIn, GitHostSignInMethod, HostCredentials,
    IdentitySource, MemoryHostCredentials, PlatformOAuthStage,
};
use yforge_platform::{
    sign_in_options, GitHostAuth, GitHostCredential, GitHostEndpoints, GitHostRegistration,
    GitHostRegistrations, PlatformError,
};

type Stages = Arc<Mutex<Vec<PlatformOAuthStage>>>;

struct Harness {
    data: tempfile::TempDir,
    store: Arc<MemoryHostCredentials>,
    auth: Arc<GitHostAuth>,
}

impl Harness {
    fn new(endpoints: GitHostEndpoints, registrations: &str) -> Self {
        let data = tempfile::tempdir().unwrap();
        yforge_core::start_storage(data.path()).unwrap();
        let store = Arc::new(MemoryHostCredentials::default());
        Self {
            auth: Arc::new(GitHostAuth::with_endpoints(
                store.clone(),
                GitHostRegistrations::parse(registrations).unwrap(),
                endpoints,
            )),
            data,
            store,
        }
    }

    fn dir(&self) -> &Path {
        self.data.path()
    }

    fn host(&self, name: &str) -> GitHost {
        git_host_add(
            self.dir(),
            &GitHostDraft {
                host: name.to_owned(),
                ssh_key_path: None,
                https_user: None,
            },
        )
        .unwrap()
    }

    fn stored(&self, id: &str) -> Option<GitHostCredential> {
        self.store
            .get(id)
            .unwrap()
            .map(|text| serde_json::from_str(&text).unwrap())
    }
}

fn collector() -> (Stages, impl Fn(PlatformOAuthStage) + Send + Sync + Clone) {
    let seen: Stages = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    (seen, move |stage| sink.lock().unwrap().push(stage))
}

async fn first_stage(seen: &Stages) -> PlatformOAuthStage {
    for _ in 0..200 {
        if let Some(stage) = seen.lock().unwrap().first().cloned() {
            return stage;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("no sign-in stage was emitted");
}

fn query(url: &Url, name: &str) -> Option<String> {
    url.query_pairs()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn form(body: &str, name: &str) -> Option<String> {
    Url::parse(&format!("http://x/?{body}"))
        .ok()
        .and_then(|url| query(&url, name))
}

fn s256(verifier: &str) -> String {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg("printf %s \"$0\" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='")
        .arg(verifier)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

fn no_cookies(requests: &[Recorded]) {
    assert!(requests
        .iter()
        .all(|request| request.header("cookie").is_none()));
}

fn files_free_of(dir: &Path, secrets: &[&str]) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files_free_of(&path, secrets);
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        for secret in secrets {
            assert!(
                !bytes
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes()),
                "{} contains a secret",
                path.display()
            );
        }
    }
}

fn leak_free(error: &PlatformError, secrets: &[&str]) {
    let texts = [error.to_string(), format!("{error:?}"), error.detail()];
    for text in texts {
        for secret in secrets {
            assert!(!text.contains(secret), "{text} leaks a secret");
        }
    }
}

fn token_reply(access: &str, refresh: Option<&str>, expires_in: Option<i64>) -> Reply {
    let mut body = json!({ "access_token": access, "token_type": "bearer" });
    if let Some(refresh) = refresh {
        body["refresh_token"] = json!(refresh);
    }
    if let Some(seconds) = expires_in {
        body["expires_in"] = json!(seconds);
    }
    Reply::ok(&body.to_string())
}

fn note(method: GitHostSignInMethod, reason: &str) -> GitHostMethodNote {
    GitHostMethodNote {
        method,
        reason: reason.to_owned(),
    }
}

#[test]
fn registrations_parse_public_client_entries_and_reject_the_rest() {
    let parsed = GitHostRegistrations::parse(
        " github|github.com|gh-public|web ;\ngitlab|GitLab.com|gl-public|oauth,web\n\ngitea|code.corp.example|gt-public|oauth;",
    )
    .unwrap();
    assert_eq!(
        parsed,
        GitHostRegistrations::new(vec![
            GitHostRegistration {
                provider: GitHostProvider::Github,
                host: "github.com".to_owned(),
                client_id: "gh-public".to_owned(),
                flows: vec![GitHostSignInMethod::Web],
            },
            GitHostRegistration {
                provider: GitHostProvider::Gitlab,
                host: "gitlab.com".to_owned(),
                client_id: "gl-public".to_owned(),
                flows: vec![GitHostSignInMethod::OAuth, GitHostSignInMethod::Web],
            },
            GitHostRegistration {
                provider: GitHostProvider::Gitea,
                host: "code.corp.example".to_owned(),
                client_id: "gt-public".to_owned(),
                flows: vec![GitHostSignInMethod::OAuth],
            },
        ])
    );
    assert_eq!(
        GitHostRegistrations::parse("").unwrap(),
        GitHostRegistrations::default()
    );
    for bad in [
        "github|github.com|gh-public|oauth",
        "gitea|code.corp.example|gt|web",
        "bitbucket|bitbucket.org|bb|oauth",
        "gitlab|gitlab.com||oauth",
        "gitlab|gitlab.com|gl|token",
        "gitlab|gitlab.com|gl",
        "gitlab|https://gitlab.com|gl|oauth",
        "forgejo|code.example|id|oauth",
        "gitlab|gitlab.com|a|oauth;gitlab|gitlab.com|b|web",
    ] {
        assert!(
            GitHostRegistrations::parse(bad).is_err(),
            "{bad} was accepted"
        );
    }
    assert!(GitHostRegistrations::from_build().is_ok());
}

#[test]
fn sign_in_options_offer_only_registered_public_flows_and_say_why_others_are_missing() {
    use GitHostSignInMethod::{OAuth, Token, Web};
    let none = GitHostRegistrations::default();
    let all = GitHostRegistrations::parse(
        "github|github.com|gh|web;gitlab|gitlab.com|gl|oauth,web;gitea|code.corp.example|gt|oauth",
    )
    .unwrap();

    let github = sign_in_options("github.com", Some(GitHostProvider::Gitlab), &all);
    assert_eq!(github.provider, GitHostProvider::Github);
    assert!(github.provider_fixed);
    assert_eq!(github.methods, [Web, Token]);
    assert_eq!(
        github.unavailable,
        [note(
            OAuth,
            "GitHub OAuth needs a client secret, which YForge never ships; use Web sign-in or Token."
        )]
    );
    assert_eq!(
        github.token_page,
        "https://github.com/settings/tokens/new?description=YForge&scopes=repo,read:org"
    );
    let bare = sign_in_options("github.com", None, &none);
    assert_eq!(bare.methods, [Token]);
    assert_eq!(
        bare.unavailable[1],
        note(
            Web,
            "Operator registration is not configured for Web sign-in on github.com."
        )
    );

    let gitlab = sign_in_options("gitlab.com", None, &all);
    assert_eq!(gitlab.provider, GitHostProvider::Gitlab);
    assert_eq!(gitlab.methods, [OAuth, Web, Token]);
    assert!(gitlab.unavailable.is_empty());
    assert_eq!(
        gitlab.token_page,
        "https://gitlab.com/-/user_settings/personal_access_tokens?name=YForge&scopes=api,read_user,write_repository"
    );
    let other_gitlab = sign_in_options("gitlab.corp.example", Some(GitHostProvider::Gitlab), &all);
    assert!(!other_gitlab.provider_fixed);
    assert_eq!(other_gitlab.methods, [Token]);
    assert_eq!(
        other_gitlab.unavailable,
        [
            note(
                OAuth,
                "Operator registration is not configured for OAuth sign-in on gitlab.corp.example."
            ),
            note(
                Web,
                "Operator registration is not configured for Web sign-in on gitlab.corp.example."
            ),
        ]
    );

    let cloud = sign_in_options("bitbucket.org", Some(GitHostProvider::Github), &all);
    assert_eq!(cloud.provider, GitHostProvider::Bitbucket);
    assert!(cloud.provider_fixed);
    assert_eq!(cloud.methods, [Token]);
    assert_eq!(
        cloud.unavailable,
        [
            note(
                OAuth,
                "Bitbucket Cloud OAuth needs a client secret, which YForge never ships."
            ),
            note(Web, "Bitbucket Cloud has no Web sign-in; use Token."),
        ]
    );
    assert_eq!(
        cloud.token_page,
        "https://id.atlassian.com/manage-profile/security/api-tokens"
    );

    let data_center = sign_in_options("git.corp.example", Some(GitHostProvider::Bitbucket), &all);
    assert!(!data_center.provider_fixed);
    assert_eq!(data_center.methods, [Token]);
    assert_eq!(
        data_center.unavailable,
        [
            note(
                OAuth,
                "Bitbucket Data Center signs in with an HTTP access token only."
            ),
            note(Web, "Bitbucket Data Center has no Web sign-in; use Token."),
        ]
    );
    assert_eq!(
        data_center.token_page,
        "https://git.corp.example/plugins/servlet/access-tokens/manage"
    );

    let gitea = sign_in_options("code.corp.example", Some(GitHostProvider::Gitea), &all);
    assert_eq!(gitea.methods, [OAuth, Token]);
    assert_eq!(
        gitea.unavailable,
        [note(Web, "Gitea has no Web sign-in; use OAuth or Token.")]
    );
    assert_eq!(
        gitea.token_page,
        "https://code.corp.example/user/settings/applications"
    );

    let enterprise = sign_in_options("ghe.corp.example", Some(GitHostProvider::Github), &all);
    assert_eq!(
        enterprise.token_page,
        "https://ghe.corp.example/settings/tokens/new?description=YForge&scopes=repo,read:org"
    );
    let unknown = sign_in_options("git.corp.example", None, &none);
    assert_eq!(unknown.provider, GitHostProvider::Gitlab);
    assert!(!unknown.provider_fixed);
    let loopback = sign_in_options("127.0.0.1:8080", Some(GitHostProvider::Gitea), &none);
    assert_eq!(
        loopback.token_page,
        "http://127.0.0.1:8080/user/settings/applications"
    );
}

fn registered(provider: &str, host: &str, flows: &str) -> String {
    format!("{provider}|{host}|synthetic-client|{flows}")
}

struct BrowserCase {
    provider: GitHostProvider,
    name: &'static str,
    token_path: &'static str,
    user_path: &'static str,
    user_body: &'static str,
}

async fn browser_sign_in(case: BrowserCase) {
    let user_path = case.user_path;
    let user_body = case.user_body;
    let token_path = case.token_path;
    let fake = HttpFake::start(move |request| {
        if request.path == token_path {
            token_reply("synthetic-access", Some("synthetic-refresh"), Some(3600))
        } else if request.path == user_path {
            Reply::ok(user_body)
        } else {
            Reply::status(404, "{}")
        }
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered(case.name, &fake.host, "oauth"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();
    let auth = h.auth.clone();
    let dir = h.dir().to_path_buf();
    let id = host.id.clone();
    let provider = case.provider;
    let task = tokio::spawn(async move {
        auth.sign_in_oauth(
            &dir,
            &id,
            provider,
            GitHostSignInMethod::OAuth,
            &CancelToken::new(),
            &sink,
        )
        .await
    });
    let PlatformOAuthStage::Browser { url } = first_stage(&seen).await else {
        panic!("expected the browser stage");
    };
    let url = Url::parse(&url).unwrap();
    assert_eq!(
        query(&url, "client_id").as_deref(),
        Some("synthetic-client")
    );
    assert_eq!(query(&url, "client_secret"), None);
    assert_eq!(query(&url, "response_type").as_deref(), Some("code"));
    let redirect = query(&url, "redirect_uri").unwrap();
    assert!(redirect.starts_with("http://127.0.0.1:"));
    assert!(redirect.ends_with("/oauth/callback"));
    let state = query(&url, "state").unwrap();
    assert_eq!(
        query(&url, "code_challenge_method").as_deref(),
        Some("S256")
    );
    let challenge = query(&url, "code_challenge").unwrap();
    assert_eq!(challenge.len(), 43);
    let page = reqwest::get(format!("{redirect}?code=synthetic-code&state={state}"))
        .await
        .unwrap();
    assert_eq!(page.status(), 200);

    let signed = task.await.unwrap().unwrap();
    assert_eq!(
        signed.sign_in,
        Some(GitHostSignIn {
            provider: case.provider,
            method: GitHostSignInMethod::OAuth,
            login: "yui".to_owned(),
        })
    );
    let requests = fake.requests();
    no_cookies(&requests);
    let exchange = requests
        .iter()
        .find(|request| request.path == token_path)
        .unwrap();
    assert_eq!(
        form(&exchange.body, "code").as_deref(),
        Some("synthetic-code")
    );
    assert_eq!(form(&exchange.body, "redirect_uri"), Some(redirect));
    assert_eq!(form(&exchange.body, "client_secret"), None);
    assert_eq!(exchange.header("authorization"), None);
    let verifier = form(&exchange.body, "code_verifier").unwrap();
    assert_eq!(s256(&verifier), challenge);
    let identity = requests
        .iter()
        .find(|request| request.path == user_path)
        .unwrap();
    assert_eq!(
        identity.header("authorization"),
        Some("Bearer synthetic-access")
    );
    let stored = h.stored(&host.id).unwrap();
    assert_eq!(stored.access_token, "synthetic-access");
    assert_eq!(stored.refresh_token.as_deref(), Some("synthetic-refresh"));
    assert_eq!(stored.client_id.as_deref(), Some("synthetic-client"));
    assert_eq!(stored.login, "yui");
    assert_eq!(stored.host, host.host);
    assert_eq!(
        seen.lock().unwrap().last(),
        Some(&PlatformOAuthStage::Completed {
            login: "yui".to_owned()
        })
    );
    let stages = format!("{:?}", seen.lock().unwrap());
    for secret in [
        "synthetic-access",
        "synthetic-refresh",
        "synthetic-code",
        &verifier,
    ] {
        assert!(!stages.contains(secret));
    }
    files_free_of(
        h.dir(),
        &["synthetic-access", "synthetic-refresh", &verifier],
    );
}

#[tokio::test]
async fn gitlab_oauth_uses_a_public_pkce_client_on_the_loopback() {
    browser_sign_in(BrowserCase {
        provider: GitHostProvider::Gitlab,
        name: "gitlab",
        token_path: "/oauth/token",
        user_path: "/api/v4/user",
        user_body: r#"{"username":"yui"}"#,
    })
    .await;
}

#[tokio::test]
async fn gitea_oauth_uses_a_public_pkce_client_on_the_loopback() {
    browser_sign_in(BrowserCase {
        provider: GitHostProvider::Gitea,
        name: "gitea",
        token_path: "/login/oauth/access_token",
        user_path: "/api/v1/user",
        user_body: r#"{"login":"yui"}"#,
    })
    .await;
}

#[tokio::test]
async fn a_callback_with_the_wrong_state_is_rejected_and_nothing_is_stored() {
    let fake = HttpFake::start(|_| token_reply("synthetic-access", None, None));
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("gitea", &fake.host, "oauth"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();
    let (auth, dir, id) = (h.auth.clone(), h.dir().to_path_buf(), host.id.clone());
    let task = tokio::spawn(async move {
        auth.sign_in_oauth(
            &dir,
            &id,
            GitHostProvider::Gitea,
            GitHostSignInMethod::OAuth,
            &CancelToken::new(),
            &sink,
        )
        .await
    });
    let PlatformOAuthStage::Browser { url } = first_stage(&seen).await else {
        panic!("expected the browser stage");
    };
    let url = Url::parse(&url).unwrap();
    let redirect = query(&url, "redirect_uri").unwrap();
    let page = reqwest::get(format!("{redirect}?code=synthetic-code&state=forged"))
        .await
        .unwrap();
    assert_eq!(page.status(), 400);

    let error = task.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("Authentication failed"));
    assert!(format!("{error:?}").contains("invalid state"));
    leak_free(&error, &["synthetic-code"]);
    assert!(fake.requests().is_empty());
    assert!(h.stored(&host.id).is_none());
}

#[tokio::test]
async fn github_device_sign_in_polls_until_granted_and_shows_the_code() {
    let polls = Arc::new(AtomicUsize::new(0));
    let counter = polls.clone();
    let fake = HttpFake::start(move |request| match request.path.as_str() {
        "/login/device/code" => Reply::ok(
            &json!({
                "device_code": "synthetic-device",
                "user_code": "WDJB-MJHT",
                "verification_uri": "https://github.com/login/device",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        "/login/oauth/access_token" if counter.fetch_add(1, Ordering::SeqCst) == 0 => {
            Reply::ok(r#"{"error":"authorization_pending"}"#)
        }
        "/login/oauth/access_token" => token_reply("synthetic-access", None, None),
        "/api/v3/user" => Reply::ok(r#"{"login":"yui"}"#),
        other => panic!("unexpected {other}"),
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("github", &fake.host, "web"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();

    let signed = h
        .auth
        .sign_in_oauth(
            h.dir(),
            &host.id,
            GitHostProvider::Github,
            GitHostSignInMethod::Web,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap();

    assert_eq!(
        signed
            .sign_in
            .map(|sign_in| (sign_in.method, sign_in.login)),
        Some((GitHostSignInMethod::Web, "yui".to_owned()))
    );
    assert_eq!(
        *seen.lock().unwrap(),
        [
            PlatformOAuthStage::DeviceCode {
                url: "https://github.com/login/device".to_owned(),
                code: "WDJB-MJHT".to_owned(),
            },
            PlatformOAuthStage::Completed {
                login: "yui".to_owned()
            },
        ]
    );
    assert_eq!(polls.load(Ordering::SeqCst), 2);
    let requests = fake.requests();
    no_cookies(&requests);
    assert_eq!(
        form(&requests[0].body, "client_id").as_deref(),
        Some("synthetic-client")
    );
    assert_eq!(
        form(&requests[1].body, "grant_type").as_deref(),
        Some("urn:ietf:params:oauth:grant-type:device_code")
    );
    assert_eq!(h.stored(&host.id).unwrap().access_token, "synthetic-access");
}

#[tokio::test]
async fn gitlab_device_sign_in_prefers_the_complete_link_and_slows_down_when_asked() {
    let polls = Arc::new(AtomicUsize::new(0));
    let counter = polls.clone();
    let fake = HttpFake::start(move |request| {
        match request.path.as_str() {
        "/oauth/authorize_device" => Reply::ok(
            &json!({
                "device_code": "synthetic-device",
                "user_code": "GLDC-0001",
                "verification_uri": "https://gitlab.corp.example/oauth/device",
                "verification_uri_complete": "https://gitlab.corp.example/oauth/device?user_code=GLDC-0001",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        "/oauth/token" => match counter.fetch_add(1, Ordering::SeqCst) {
            0 => Reply::status(400, r#"{"error":"authorization_pending"}"#),
            1 => Reply::status(400, r#"{"error":"slow_down"}"#),
            _ => token_reply("synthetic-access", Some("synthetic-refresh"), Some(7200)),
        },
        "/api/v4/user" => Reply::ok(r#"{"username":"yui"}"#),
        other => panic!("unexpected {other}"),
    }
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("gitlab", &fake.host, "web"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();

    let signed = h
        .auth
        .sign_in_oauth(
            h.dir(),
            &host.id,
            GitHostProvider::Gitlab,
            GitHostSignInMethod::Web,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap();

    assert_eq!(signed.sign_in.unwrap().login, "yui");
    assert_eq!(
        seen.lock().unwrap()[0],
        PlatformOAuthStage::DeviceCode {
            url: "https://gitlab.corp.example/oauth/device?user_code=GLDC-0001".to_owned(),
            code: "GLDC-0001".to_owned(),
        }
    );
    assert_eq!(polls.load(Ordering::SeqCst), 3);
    let requests = fake.requests();
    assert_eq!(
        form(&requests[0].body, "scope").as_deref(),
        Some("api read_user write_repository")
    );
    let poll = &requests[1];
    assert_eq!(
        form(&poll.body, "grant_type").as_deref(),
        Some("urn:ietf:params:oauth:grant-type:device_code")
    );
    assert_eq!(
        form(&poll.body, "device_code").as_deref(),
        Some("synthetic-device")
    );
    let stored = h.stored(&host.id).unwrap();
    assert_eq!(stored.refresh_token.as_deref(), Some("synthetic-refresh"));
    assert!(stored.expires_at.is_some());
}

#[tokio::test]
async fn a_cancelled_device_sign_in_stops_and_stores_nothing() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/login/device/code" => Reply::ok(
            &json!({
                "device_code": "synthetic-device",
                "user_code": "WDJB-MJHT",
                "verification_uri": "https://github.com/login/device",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        _ => Reply::ok(r#"{"error":"authorization_pending"}"#),
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("github", &fake.host, "web"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();
    let cancel = CancelToken::new();
    let stopper = cancel.clone();
    let (auth, dir, id) = (h.auth.clone(), h.dir().to_path_buf(), host.id.clone());
    let task = tokio::spawn(async move {
        auth.sign_in_oauth(
            &dir,
            &id,
            GitHostProvider::Github,
            GitHostSignInMethod::Web,
            &cancel,
            &sink,
        )
        .await
    });
    first_stage(&seen).await;
    stopper.cancel();

    let error = task.await.unwrap().unwrap_err();
    assert!(matches!(error, PlatformError::Core(CoreError::Cancelled)));
    assert!(h.stored(&host.id).is_none());
}

#[tokio::test]
async fn a_grant_whose_identity_check_fails_stores_nothing_and_leaks_nothing() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/login/device/code" => Reply::ok(
            &json!({
                "device_code": "synthetic-device",
                "user_code": "WDJB-MJHT",
                "verification_uri": "https://github.com/login/device",
                "interval": 0,
                "expires_in": 60
            })
            .to_string(),
        ),
        "/login/oauth/access_token" => token_reply("synthetic-access", None, None),
        _ => Reply::status(401, r#"{"message":"Bad credentials synthetic-access"}"#),
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("github", &fake.host, "web"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();

    let error = h
        .auth
        .sign_in_oauth(
            h.dir(),
            &host.id,
            GitHostProvider::Github,
            GitHostSignInMethod::Web,
            &CancelToken::new(),
            &sink,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PlatformError::AuthFailed { .. }));
    leak_free(&error, &["synthetic-access", "synthetic-device"]);
    assert!(h.stored(&host.id).is_none());
    assert!(!seen
        .lock()
        .unwrap()
        .iter()
        .any(|stage| matches!(stage, PlatformOAuthStage::Completed { .. })));
}

#[tokio::test]
async fn a_failed_code_exchange_does_not_echo_the_code() {
    let fake = HttpFake::start(|_| {
        Reply::status(
            400,
            r#"{"error":"invalid_grant","error_description":"code synthetic-code is bad"}"#,
        )
    });
    let h = Harness::new(
        GitHostEndpoints::default(),
        &registered("gitlab", &fake.host, "oauth"),
    );
    let host = h.host(&fake.host);
    let (seen, sink) = collector();
    let (auth, dir, id) = (h.auth.clone(), h.dir().to_path_buf(), host.id.clone());
    let task = tokio::spawn(async move {
        auth.sign_in_oauth(
            &dir,
            &id,
            GitHostProvider::Gitlab,
            GitHostSignInMethod::OAuth,
            &CancelToken::new(),
            &sink,
        )
        .await
    });
    let PlatformOAuthStage::Browser { url } = first_stage(&seen).await else {
        panic!("expected the browser stage");
    };
    let url = Url::parse(&url).unwrap();
    let redirect = query(&url, "redirect_uri").unwrap();
    let state = query(&url, "state").unwrap();
    reqwest::get(format!("{redirect}?code=synthetic-code&state={state}"))
        .await
        .unwrap();

    let error = task.await.unwrap().unwrap_err();
    leak_free(&error, &["synthetic-code"]);
    assert!(h.stored(&host.id).is_none());
}

#[tokio::test]
async fn unavailable_methods_are_refused_with_their_reason_before_any_request() {
    let h = Harness::new(
        GitHostEndpoints::default(),
        "gitlab|gitlab.corp.example|synthetic-client|web",
    );
    let cloud = h.host("bitbucket.org");
    let data_center = h.host("git.corp.example");
    let gitea = h.host("code.corp.example");
    let github = h.host("ghe.corp.example");
    let gitlab = h.host("gitlab.corp.example");
    let attempt = |id: String, provider, method| {
        let auth = h.auth.clone();
        let dir = h.dir().to_path_buf();
        async move {
            auth.sign_in_oauth(&dir, &id, provider, method, &CancelToken::new(), &|_| {})
                .await
                .unwrap_err()
                .detail()
        }
    };
    use GitHostSignInMethod::{OAuth, Token, Web};

    assert_eq!(
        attempt(cloud.id.clone(), GitHostProvider::Bitbucket, OAuth).await,
        "Bitbucket Cloud OAuth needs a client secret, which YForge never ships."
    );
    assert_eq!(
        attempt(cloud.id, GitHostProvider::Bitbucket, Web).await,
        "Bitbucket Cloud has no Web sign-in; use Token."
    );
    assert_eq!(
        attempt(data_center.id.clone(), GitHostProvider::Bitbucket, OAuth).await,
        "Bitbucket Data Center signs in with an HTTP access token only."
    );
    assert_eq!(
        attempt(gitea.id.clone(), GitHostProvider::Gitea, Web).await,
        "Gitea has no Web sign-in; use OAuth or Token."
    );
    assert_eq!(
        attempt(gitea.id, GitHostProvider::Gitea, OAuth).await,
        "Operator registration is not configured for OAuth sign-in on code.corp.example."
    );
    assert_eq!(
        attempt(github.id.clone(), GitHostProvider::Github, OAuth).await,
        "GitHub OAuth needs a client secret, which YForge never ships; use Web sign-in or Token."
    );
    assert_eq!(
        attempt(github.id, GitHostProvider::Github, Web).await,
        "Operator registration is not configured for Web sign-in on ghe.corp.example."
    );
    assert_eq!(
        attempt(gitlab.id.clone(), GitHostProvider::Gitlab, OAuth).await,
        "Operator registration is not configured for OAuth sign-in on gitlab.corp.example."
    );
    assert_eq!(
        attempt(data_center.id, GitHostProvider::Gitlab, Token).await,
        "paste the access token to sign in with a token"
    );
}

struct TokenCase {
    provider: GitHostProvider,
    host: Option<&'static str>,
    user_path: &'static str,
    reply: fn() -> Reply,
    git_user: &'static str,
}

async fn token_sign_in(case: TokenCase) {
    let user_path = case.user_path;
    let reply = case.reply;
    let fake = HttpFake::start(move |request| {
        if request.path == user_path {
            reply()
        } else {
            Reply::status(404, "{}")
        }
    });
    let endpoints = GitHostEndpoints {
        bitbucket_api_base: Some(format!("http://{}/2.0", fake.host)),
        ..GitHostEndpoints::default()
    };
    let h = Harness::new(endpoints, "");
    let host = h.host(case.host.unwrap_or(&fake.host));

    let signed = h
        .auth
        .sign_in_token(h.dir(), &host.id, case.provider, "  synthetic-token  ")
        .await
        .unwrap();

    assert_eq!(
        signed.sign_in,
        Some(GitHostSignIn {
            provider: case.provider,
            method: GitHostSignInMethod::Token,
            login: "yui".to_owned(),
        })
    );
    let requests = fake.requests();
    no_cookies(&requests);
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].header("authorization"),
        Some("Bearer synthetic-token")
    );
    let credentials = h.auth.https_credentials(h.dir()).await;
    assert_eq!(credentials.len(), 1);
    assert_eq!(credentials[0].host, host.host);
    assert_eq!(credentials[0].username, case.git_user);
    assert_eq!(credentials[0].secret, "synthetic-token");
    assert_eq!(h.auth.list(h.dir()).unwrap()[0].sign_in, signed.sign_in);
    files_free_of(h.dir(), &["synthetic-token"]);
}

#[tokio::test]
async fn github_token_sign_in_validates_with_the_user_endpoint() {
    token_sign_in(TokenCase {
        provider: GitHostProvider::Github,
        host: None,
        user_path: "/api/v3/user",
        reply: || Reply::ok(r#"{"login":"yui"}"#),
        git_user: "x-access-token",
    })
    .await;
}

#[tokio::test]
async fn gitlab_token_sign_in_validates_with_the_user_endpoint() {
    token_sign_in(TokenCase {
        provider: GitHostProvider::Gitlab,
        host: None,
        user_path: "/api/v4/user",
        reply: || Reply::ok(r#"{"username":"yui"}"#),
        git_user: "oauth2",
    })
    .await;
}

#[tokio::test]
async fn bitbucket_cloud_token_sign_in_validates_an_api_token() {
    token_sign_in(TokenCase {
        provider: GitHostProvider::Bitbucket,
        host: Some("bitbucket.org"),
        user_path: "/2.0/user",
        reply: || Reply::ok(r#"{"username":"yui"}"#),
        git_user: "x-bitbucket-api-token-auth",
    })
    .await;
}

#[tokio::test]
async fn bitbucket_data_center_token_sign_in_reads_the_user_header() {
    token_sign_in(TokenCase {
        provider: GitHostProvider::Bitbucket,
        host: None,
        user_path: "/rest/api/1.0/application-properties",
        reply: || Reply::ok(r#"{"version":"9.0"}"#).header("X-AUSERNAME", "yui"),
        git_user: "yui",
    })
    .await;
}

#[tokio::test]
async fn gitea_token_sign_in_validates_with_the_user_endpoint() {
    token_sign_in(TokenCase {
        provider: GitHostProvider::Gitea,
        host: None,
        user_path: "/api/v1/user",
        reply: || Reply::ok(r#"{"login":"yui"}"#),
        git_user: "yui",
    })
    .await;
}

#[tokio::test]
async fn a_rejected_token_stores_nothing_and_the_error_omits_it() {
    let fake = HttpFake::start(|_| {
        Reply::status(401, r#"{"message":"401 Unauthorized: synthetic-token"}"#)
    });
    let h = Harness::new(GitHostEndpoints::default(), "");
    let host = h.host(&fake.host);

    let error = h
        .auth
        .sign_in_token(
            h.dir(),
            &host.id,
            GitHostProvider::Gitlab,
            "synthetic-token",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, PlatformError::AuthFailed { .. }));
    leak_free(&error, &["synthetic-token"]);
    assert!(h.stored(&host.id).is_none());
    assert_eq!(h.auth.list(h.dir()).unwrap()[0].sign_in, None);
}

#[tokio::test]
async fn renaming_a_host_signs_it_out_and_sign_out_deletes_the_record() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));
    let h = Harness::new(GitHostEndpoints::default(), "");
    let host = h.host(&fake.host);
    h.auth
        .sign_in_token(
            h.dir(),
            &host.id,
            GitHostProvider::Gitlab,
            "synthetic-token",
        )
        .await
        .unwrap();
    assert!(h.auth.list(h.dir()).unwrap()[0].sign_in.is_some());

    git_host_update(
        h.dir(),
        &host.id,
        &GitHostDraft {
            host: "gitlab.corp.example".to_owned(),
            ssh_key_path: None,
            https_user: None,
        },
    )
    .unwrap();
    assert_eq!(h.auth.list(h.dir()).unwrap()[0].sign_in, None);
    assert!(h.auth.https_credentials(h.dir()).await.is_empty());

    h.auth.sign_out(&host.id).unwrap();
    assert!(h.stored(&host.id).is_none());
    h.auth.sign_out(&host.id).unwrap();
}

fn seed(h: &Harness, host: &GitHost, provider: GitHostProvider, expires_at: i64) {
    let record = GitHostCredential {
        host: host.host.clone(),
        provider,
        method: GitHostSignInMethod::OAuth,
        login: "yui".to_owned(),
        access_token: "synthetic-old".to_owned(),
        refresh_token: Some("synthetic-refresh".to_owned()),
        expires_at: Some(expires_at),
        client_id: Some("synthetic-client".to_owned()),
    };
    h.store
        .set(&host.id, &serde_json::to_string(&record).unwrap())
        .unwrap();
}

#[tokio::test]
async fn expired_tokens_are_refreshed_and_saved_before_git_uses_them() {
    let fake = HttpFake::start(|request| match request.path.as_str() {
        "/oauth/token" => token_reply(
            "synthetic-gitlab-new",
            Some("synthetic-refresh-2"),
            Some(7200),
        ),
        "/login/oauth/access_token" => token_reply("synthetic-gitea-new", None, Some(3600)),
        other => panic!("unexpected {other}"),
    });
    let gitea_fake = HttpFake::start(|request| match request.path.as_str() {
        "/login/oauth/access_token" => token_reply("synthetic-gitea-new", None, Some(3600)),
        other => panic!("unexpected {other}"),
    });
    let h = Harness::new(GitHostEndpoints::default(), "");
    let gitlab = h.host(&fake.host);
    let gitea = h.host(&gitea_fake.host);
    seed(&h, &gitlab, GitHostProvider::Gitlab, 1_000);
    seed(&h, &gitea, GitHostProvider::Gitea, 1_000);

    let mut credentials = h.auth.https_credentials(h.dir()).await;
    credentials.sort_by(|a, b| a.secret.cmp(&b.secret));

    assert_eq!(
        credentials
            .iter()
            .map(|credential| (credential.username.as_str(), credential.secret.as_str()))
            .collect::<Vec<_>>(),
        [
            ("yui", "synthetic-gitea-new"),
            ("oauth2", "synthetic-gitlab-new")
        ]
    );
    let refreshed = h.stored(&gitlab.id).unwrap();
    assert_eq!(refreshed.access_token, "synthetic-gitlab-new");
    assert_eq!(
        refreshed.refresh_token.as_deref(),
        Some("synthetic-refresh-2")
    );
    assert!(refreshed.expires_at.unwrap() > 1_000);
    let gitea_record = h.stored(&gitea.id).unwrap();
    assert_eq!(gitea_record.access_token, "synthetic-gitea-new");
    assert_eq!(
        gitea_record.refresh_token.as_deref(),
        Some("synthetic-refresh")
    );
    let request = &fake.requests()[0];
    assert_eq!(
        form(&request.body, "grant_type").as_deref(),
        Some("refresh_token")
    );
    assert_eq!(
        form(&request.body, "refresh_token").as_deref(),
        Some("synthetic-refresh")
    );
    let gitea_request = &gitea_fake.requests()[0];
    assert_eq!(
        form(&gitea_request.body, "grant_type").as_deref(),
        Some("refresh_token")
    );
    assert_eq!(
        form(&gitea_request.body, "client_id").as_deref(),
        Some("synthetic-client")
    );
}

#[tokio::test]
async fn a_signed_in_host_keeps_its_ssh_key_for_ssh_remotes() {
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));
    let h = Harness::new(GitHostEndpoints::default(), "");
    let key = h.dir().join("id_host");
    std::fs::write(
        &key,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
    )
    .unwrap();
    let host = git_host_add(
        h.dir(),
        &GitHostDraft {
            host: "127.0.0.1".to_owned(),
            ssh_key_path: Some(key.display().to_string()),
            https_user: None,
        },
    )
    .unwrap();
    let api = h.host(&fake.host);
    h.auth
        .sign_in_token(h.dir(), &api.id, GitHostProvider::Gitlab, "synthetic-token")
        .await
        .unwrap();
    seed(&h, &host, GitHostProvider::Gitlab, i64::MAX);

    let mut plan = ssh_plan(h.dir(), None).unwrap();
    plan.https_credentials = h.auth.https_credentials(h.dir()).await;

    let ssh = plan.resolve(Some("git@127.0.0.1:team/app.git"));
    assert_eq!(ssh.source, IdentitySource::Host);
    assert_eq!(ssh.key, Some(key.clone()));
    assert_eq!(
        plan.https_credential("127.0.0.1")
            .map(|credential| credential.secret.as_str()),
        Some("synthetic-old")
    );
    assert_eq!(
        plan.https_credential(&fake.host)
            .map(|credential| credential.secret.as_str()),
        Some("synthetic-token")
    );
    let listed = h.auth.list(h.dir()).unwrap();
    let keyed = listed.iter().find(|entry| entry.id == host.id).unwrap();
    assert_eq!(keyed.ssh_key_path, Some(key.display().to_string()));
    assert!(keyed.sign_in.is_some());
}

#[test]
fn debug_output_never_shows_a_credential() {
    let record = GitHostCredential {
        host: "gitlab.com".to_owned(),
        provider: GitHostProvider::Gitlab,
        method: GitHostSignInMethod::OAuth,
        login: "yui".to_owned(),
        access_token: "synthetic-access".to_owned(),
        refresh_token: Some("synthetic-refresh".to_owned()),
        expires_at: Some(1),
        client_id: Some("synthetic-client".to_owned()),
    };
    let text = format!("{record:?}");
    for secret in ["synthetic-access", "synthetic-refresh"] {
        assert!(!text.contains(secret));
    }
    assert!(text.contains("yui"));
}

#[derive(Default)]
struct LegacyItems {
    items: Mutex<std::collections::BTreeMap<(String, String), String>>,
    touched: Mutex<Vec<String>>,
}

struct Legacy(Arc<LegacyItems>);

impl yforge_core::LegacyKeychain for Legacy {
    fn accounts(&self, service: &str) -> Result<Vec<String>, CoreError> {
        self.0.touched.lock().unwrap().push(service.to_owned());
        Ok(self
            .0
            .items
            .lock()
            .unwrap()
            .keys()
            .filter(|(owner, _)| owner == service)
            .map(|(_, account)| account.clone())
            .collect())
    }

    fn read(&self, service: &str, account: &str) -> Result<Option<String>, CoreError> {
        self.0.touched.lock().unwrap().push(service.to_owned());
        Ok(self
            .0
            .items
            .lock()
            .unwrap()
            .get(&(service.to_owned(), account.to_owned()))
            .cloned())
    }

    fn delete(&self, service: &str, account: &str) -> Result<(), CoreError> {
        self.0.touched.lock().unwrap().push(service.to_owned());
        self.0
            .items
            .lock()
            .unwrap()
            .remove(&(service.to_owned(), account.to_owned()));
        Ok(())
    }
}

fn sqlite(dir: &Path, sql: &str) -> String {
    let output = std::process::Command::new("sqlite3")
        .arg(dir.join("yforge.db"))
        .arg(sql)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "sqlite3: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn a_host_from_an_older_database_signs_in_without_touching_legacy_secrets_or_its_ssh_key() {
    use yforge_core::{Namespace, Secrets, GIT_HOSTS_SERVICE};
    let fake = HttpFake::start(|_| Reply::ok(r#"{"username":"yui"}"#));
    let h = Harness::new(GitHostEndpoints::default(), "");
    let key = h.dir().join("id_legacy");
    std::fs::write(
        &key,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
    )
    .unwrap();
    let host = git_host_add(
        h.dir(),
        &GitHostDraft {
            host: fake.host.clone(),
            ssh_key_path: Some(key.display().to_string()),
            https_user: Some("yui".to_owned()),
        },
    )
    .unwrap();
    sqlite(
        h.dir(),
        "DROP TABLE secret_cleanup; DROP TABLE secrets; ALTER TABLE platform_connections DROP COLUMN login; ALTER TABLE platform_connections DROP COLUMN oauth_client_id; ALTER TABLE platform_connections DROP COLUMN auth_method; PRAGMA user_version = 16;",
    );
    assert_eq!(sqlite(h.dir(), "PRAGMA user_version;"), "16");
    yforge_core::start_storage(h.dir()).unwrap();
    assert_eq!(
        sqlite(
            h.dir(),
            "SELECT host || '|' || ssh_key_path FROM git_hosts;"
        ),
        format!("{}|{}", fake.host, key.display())
    );

    let signed = h
        .auth
        .sign_in_token(
            h.dir(),
            &host.id,
            GitHostProvider::Gitlab,
            "synthetic-legacy-token",
        )
        .await
        .unwrap();
    assert_eq!(signed.ssh_key_path, Some(key.display().to_string()));

    let legacy = Arc::new(LegacyItems::default());
    for (service, account, value) in [
        (Namespace::Ai.service(), "provider-1", "synthetic-ai-key"),
        (
            Namespace::SshPassphrase.service(),
            "/keys/id_one",
            "synthetic-phrase",
        ),
        (
            GIT_HOSTS_SERVICE,
            host.id.as_str(),
            "synthetic-keychain-record",
        ),
    ] {
        legacy
            .items
            .lock()
            .unwrap()
            .insert((service.to_owned(), account.to_owned()), value.to_owned());
    }
    let secrets = Secrets::new(Some(Box::new(Legacy(legacy.clone()))));
    secrets.bind(h.dir()).unwrap();
    assert_eq!(
        secrets.get(Namespace::Ai, "provider-1").unwrap().as_deref(),
        Some("synthetic-ai-key")
    );

    assert!(legacy
        .touched
        .lock()
        .unwrap()
        .iter()
        .all(|service| service != GIT_HOSTS_SERVICE));
    assert_eq!(
        legacy
            .items
            .lock()
            .unwrap()
            .keys()
            .map(|(service, _)| service.as_str())
            .collect::<Vec<_>>(),
        [GIT_HOSTS_SERVICE]
    );
    assert_eq!(
        sqlite(h.dir(), "SELECT group_concat(namespace, ',') FROM secrets;"),
        "ai,ssh_passphrase"
    );
    let stored = h.stored(&host.id).unwrap();
    assert_eq!(stored.access_token, "synthetic-legacy-token");
    let listed = h.auth.list(h.dir()).unwrap();
    let entry = listed.iter().find(|entry| entry.id == host.id).unwrap();
    assert_eq!(
        entry.sign_in,
        Some(GitHostSignIn {
            provider: GitHostProvider::Gitlab,
            method: GitHostSignInMethod::Token,
            login: "yui".to_owned(),
        })
    );
    assert_eq!(entry.ssh_key_path, Some(key.display().to_string()));
    assert_eq!(entry.https_user.as_deref(), Some("yui"));
    files_free_of(h.dir(), &["synthetic-legacy-token"]);
}
