use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Once, OnceLock};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow};
use yforge_ai::{Ai, MemoryStore};
use yforge_core::{HostCredentials, MemoryHostCredentials};
use yforge_platform::{GitHostAuth, GitHostRegistrations, PlatformService};

struct Capture(Mutex<Vec<String>>);

impl log::Log for Capture {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        self.0
            .lock()
            .unwrap()
            .push(format!("{} {}", record.target(), record.args()));
    }

    fn flush(&self) {}
}

fn logs() -> &'static Capture {
    static CAPTURE: OnceLock<&'static Capture> = OnceLock::new();
    CAPTURE.get_or_init(|| {
        let capture: &'static Capture = Box::leak(Box::new(Capture(Mutex::new(Vec::new()))));
        log::set_logger(capture).unwrap();
        log::set_max_level(log::LevelFilter::Trace);
        capture
    })
}

fn isolate() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_TERMINAL_PROMPT", "0");
    });
    logs();
}

fn base64(bytes: &[u8], url_safe: bool) -> String {
    let alphabet: &[u8; 64] = if url_safe {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    } else {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    };
    let mut text = String::new();
    for chunk in bytes.chunks(3) {
        let value = chunk.iter().enumerate().fold(0_u32, |acc, (i, byte)| {
            acc | (u32::from(*byte) << (16 - 8 * i))
        });
        for i in 0..4 {
            if i <= chunk.len() {
                text.push(char::from(
                    alphabet[((value >> (18 - 6 * i)) & 63) as usize],
                ));
            } else if !url_safe {
                text.push('=');
            }
        }
    }
    text
}

fn s256(verifier: &str) -> String {
    let output = Command::new("sh")
        .arg("-c")
        .arg("printf %s \"$0\" | openssl dgst -sha256 -binary")
        .arg(verifier)
        .output()
        .unwrap();
    assert!(output.status.success());
    base64(&output.stdout, true)
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap();
                out.push(u8::from_str_radix(hex, 16).unwrap());
                index += 3;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).unwrap()
}

fn pairs(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| (decode(key), decode(value)))
        .collect()
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    authorization: Option<String>,
    form: HashMap<String, String>,
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut data = Vec::new();
    let mut chunk = [0_u8; 4096];
    let end = loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..read]);
        if let Some(position) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
    };
    let head = String::from_utf8_lossy(&data[..end]).into_owned();
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    let method = start.next()?.to_owned();
    let target = start.next()?.to_owned();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    let header = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let length: usize = header("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    while data.len() < end + length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
    }
    assert_eq!(header("cookie"), None, "a cookie reached the provider");
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    Some(Request {
        method,
        path: path.to_owned(),
        query: pairs(query),
        authorization: header("authorization"),
        form: pairs(&String::from_utf8_lossy(&data[end..])),
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Flavor {
    GitLab,
    GitHub,
    Gitea,
}

impl Flavor {
    fn name(self) -> &'static str {
        match self {
            Self::GitLab => "gitlab",
            Self::GitHub => "github",
            Self::Gitea => "gitea",
        }
    }

    fn client_id(self) -> String {
        format!("yforge-public-{}", self.name())
    }

    fn login(self) -> String {
        format!("yui-{}", self.name())
    }

    fn authorize_path(self) -> &'static str {
        match self {
            Self::GitLab => "/oauth/authorize",
            Self::Gitea | Self::GitHub => "/login/oauth/authorize",
        }
    }

    fn token_path(self) -> &'static str {
        match self {
            Self::GitLab => "/oauth/token",
            Self::Gitea | Self::GitHub => "/login/oauth/access_token",
        }
    }

    fn device_path(self) -> &'static str {
        match self {
            Self::GitLab => "/oauth/authorize_device",
            Self::Gitea | Self::GitHub => "/login/device/code",
        }
    }

    fn user_path(self) -> &'static str {
        match self {
            Self::GitLab => "/api/v4/user",
            Self::GitHub => "/api/v3/user",
            Self::Gitea => "/api/v1/user",
        }
    }
}

#[derive(Default)]
struct Provider {
    codes: Mutex<HashMap<String, (String, String)>>,
    devices: Mutex<HashMap<String, usize>>,
    tokens: Mutex<Vec<String>>,
    secrets: Mutex<Vec<String>>,
    sequence: AtomicUsize,
}

struct Mock {
    host: String,
    provider: Arc<Provider>,
}

impl Mock {
    fn secrets(&self) -> Vec<String> {
        self.provider.secrets.lock().unwrap().clone()
    }
}

fn reply(stream: &mut TcpStream, status: &str, extra: &str, body: &str) {
    let text = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(text.as_bytes());
}

fn serve(flavor: Flavor, provider: &Provider, request: Request, stream: &mut TcpStream) {
    let next = || provider.sequence.fetch_add(1, Ordering::SeqCst);
    let remember = |secret: String| {
        provider.secrets.lock().unwrap().push(secret.clone());
        secret
    };
    let issue = || {
        let n = next();
        let access = remember(format!("synthetic-{}-access-{n}", flavor.name()));
        let refresh = remember(format!("synthetic-{}-refresh-{n}", flavor.name()));
        provider.tokens.lock().unwrap().push(access.clone());
        json!({ "access_token": access, "refresh_token": refresh, "token_type": "bearer", "expires_in": 7200 })
            .to_string()
    };
    let path = request.path.as_str();
    if request.method == "GET" && path == flavor.authorize_path() {
        let query = &request.query;
        let valid = query.get("client_id") == Some(&flavor.client_id())
            && query.get("response_type").map(String::as_str) == Some("code")
            && query.get("code_challenge_method").map(String::as_str) == Some("S256")
            && query
                .get("code_challenge")
                .is_some_and(|value| value.len() == 43)
            && query.get("state").is_some_and(|value| !value.is_empty())
            && !query.contains_key("client_secret");
        let Some(redirect) = query.get("redirect_uri").filter(|_| valid) else {
            return reply(
                stream,
                "400 Bad Request",
                "",
                r#"{"error":"invalid_request"}"#,
            );
        };
        let code = remember(format!("synthetic-{}-code-{}", flavor.name(), next()));
        provider.codes.lock().unwrap().insert(
            code.clone(),
            (query["code_challenge"].clone(), redirect.clone()),
        );
        let location = format!("{redirect}?code={code}&state={}", query["state"]);
        return reply(
            stream,
            "302 Found",
            &format!("Location: {location}\r\n"),
            "",
        );
    }
    if request.method == "POST" && path == flavor.device_path() {
        if request.form.get("client_id") != Some(&flavor.client_id()) {
            return reply(
                stream,
                "401 Unauthorized",
                "",
                r#"{"error":"invalid_client"}"#,
            );
        }
        let device = remember(format!("synthetic-{}-device-{}", flavor.name(), next()));
        provider.devices.lock().unwrap().insert(device.clone(), 0);
        let mut body = json!({
            "device_code": device,
            "user_code": "ABCD-1234",
            "verification_uri": "http://provider.example/device",
            "interval": 0,
            "expires_in": 60
        });
        if flavor == Flavor::GitLab {
            body["verification_uri_complete"] =
                json!("http://provider.example/device?user_code=ABCD-1234");
        }
        return reply(stream, "200 OK", "", &body.to_string());
    }
    if request.method == "POST" && path == flavor.token_path() {
        let form = &request.form;
        if form.contains_key("client_secret") || form.get("client_id") != Some(&flavor.client_id())
        {
            return reply(
                stream,
                "401 Unauthorized",
                "",
                r#"{"error":"invalid_client"}"#,
            );
        }
        match form.get("grant_type").map(String::as_str) {
            Some("authorization_code") => {
                let known = form
                    .get("code")
                    .and_then(|code| provider.codes.lock().unwrap().remove(code));
                let verifier = form.get("code_verifier").cloned().unwrap_or_default();
                provider.secrets.lock().unwrap().push(verifier.clone());
                let granted = known.is_some_and(|(challenge, redirect)| {
                    s256(&verifier) == challenge && form.get("redirect_uri") == Some(&redirect)
                });
                if !granted {
                    return reply(
                        stream,
                        "400 Bad Request",
                        "",
                        r#"{"error":"invalid_grant"}"#,
                    );
                }
                return reply(stream, "200 OK", "", &issue());
            }
            Some("urn:ietf:params:oauth:grant-type:device_code") => {
                let polls = form.get("device_code").and_then(|device| {
                    let mut devices = provider.devices.lock().unwrap();
                    let polls = devices.get_mut(device)?;
                    *polls += 1;
                    Some(*polls)
                });
                return match polls {
                    None => reply(
                        stream,
                        "400 Bad Request",
                        "",
                        r#"{"error":"invalid_grant"}"#,
                    ),
                    Some(1) => reply(
                        stream,
                        "400 Bad Request",
                        "",
                        r#"{"error":"authorization_pending"}"#,
                    ),
                    Some(_) => reply(stream, "200 OK", "", &issue()),
                };
            }
            _ => {
                return reply(
                    stream,
                    "400 Bad Request",
                    "",
                    r#"{"error":"unsupported_grant_type"}"#,
                )
            }
        }
    }
    if request.method == "GET" && path == flavor.user_path() {
        let token = request
            .authorization
            .as_deref()
            .and_then(|value| value.strip_prefix("Bearer "))
            .unwrap_or_default();
        let known = token == "synthetic-pat"
            || provider
                .tokens
                .lock()
                .unwrap()
                .iter()
                .any(|issued| issued == token);
        if !known {
            return reply(
                stream,
                "401 Unauthorized",
                "",
                r#"{"message":"401 Unauthorized"}"#,
            );
        }
        let field = if flavor == Flavor::GitLab {
            "username"
        } else {
            "login"
        };
        let body = format!(r#"{{"{field}":"{}"}}"#, flavor.login());
        return reply(stream, "200 OK", "", &body);
    }
    reply(stream, "404 Not Found", "", "{}");
}

fn mock(flavor: Flavor) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let host = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let provider = Arc::new(Provider::default());
    let shared = provider.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let provider = shared.clone();
            std::thread::spawn(move || {
                if let Some(request) = read_request(&mut stream) {
                    serve(flavor, &provider, request, &mut stream);
                }
            });
        }
    });
    Mock { host, provider }
}

fn http_get(url: &str) -> (u16, Option<String>) {
    let rest = url.strip_prefix("http://").expect("an http URL");
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let mut stream = TcpStream::connect(authority).unwrap();
    write!(
        stream,
        "GET /{path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut text = String::new();
    let _ = stream.read_to_string(&mut text);
    let status = text
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let location = text.lines().find_map(|line| {
        line.split_once(':')
            .filter(|(name, _)| name.eq_ignore_ascii_case("location"))
            .map(|(_, value)| value.trim().to_owned())
    });
    (status, location)
}

fn browser(opened: Arc<Mutex<Vec<String>>>) -> yforge_lib::OpenUrl {
    Arc::new(move |url: &str| {
        opened.lock().unwrap().push(url.to_owned());
        if !url.contains("/authorize?") {
            return;
        }
        let url = url.to_owned();
        std::thread::spawn(move || {
            let (status, location) = http_get(&url);
            match location.filter(|_| status == 302) {
                Some(callback) => {
                    http_get(&callback);
                }
                None => {
                    let query = pairs(url.split_once('?').map_or("", |(_, query)| query));
                    http_get(&format!(
                        "{}?error=browser_failed&state={}",
                        query["redirect_uri"], query["state"]
                    ));
                }
            }
        });
    })
}

struct Harness {
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    data: tempfile::TempDir,
    store: Arc<MemoryHostCredentials>,
    events: Arc<Mutex<Vec<Value>>>,
    opened: Arc<Mutex<Vec<String>>>,
}

impl Harness {
    fn new(registrations: &str) -> Self {
        isolate();
        let secrets = Arc::new(MemoryStore::default());
        let store = Arc::new(MemoryHostCredentials::default());
        let opened = Arc::new(Mutex::new(Vec::new()));
        let app = yforge_lib::register_with_git_hosts(
            mock_builder(),
            Ai::new(secrets.clone()),
            PlatformService::new(secrets),
            GitHostAuth::new(
                store.clone(),
                GitHostRegistrations::parse(registrations).unwrap(),
            ),
            browser(opened.clone()),
        )
        .build(mock_context(noop_assets()))
        .unwrap();
        let data = tempfile::tempdir().unwrap();
        yforge_core::start_storage(data.path()).unwrap();
        app.manage(yforge_lib::DataDir(data.path().to_path_buf()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        app.listen_any("git-host-sign-in", move |event| {
            sink.lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap());
        });
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        Self {
            _app: app,
            window,
            data,
            store,
            events,
            opened,
        }
    }

    fn call(&self, cmd: &str, body: Value) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            &self.window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    }

    fn add_host(&self, host: &str) -> String {
        let saved = self
            .call(
                "git_host_save",
                json!({ "id": null, "draft": { "host": host, "ssh_key_path": null, "https_user": null } }),
            )
            .unwrap();
        saved["id"].as_str().unwrap().to_owned()
    }

    fn sign_in_of(&self, id: &str) -> Value {
        self.call("git_hosts_list", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|host| host["id"] == id)
            .unwrap()["sign_in"]
            .clone()
    }

    fn stages(&self, operation: &str) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["operation"] == operation)
            .map(|event| event["stage"]["kind"].as_str().unwrap().to_owned())
            .collect()
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

fn files_free_of(dir: &Path, secrets: &[String]) {
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

fn free_of(text: &str, secrets: &[String], place: &str) {
    for secret in secrets {
        assert!(!text.contains(secret.as_str()), "{place} leaks {secret}");
    }
}

#[test]
fn browser_and_device_sign_in_reach_the_real_loopback_and_show_the_host_signed_in() {
    let gitlab = mock(Flavor::GitLab);
    let github = mock(Flavor::GitHub);
    let gitea = mock(Flavor::Gitea);
    let h = Harness::new(&format!(
        "gitlab|{}|yforge-public-gitlab|oauth,web;github|{}|yforge-public-github|web;gitea|{}|yforge-public-gitea|oauth",
        gitlab.host, github.host, gitea.host
    ));
    let gitlab_id = h.add_host(&gitlab.host);
    let github_id = h.add_host(&github.host);
    let gitea_id = h.add_host(&gitea.host);
    let options = h
        .call(
            "git_host_sign_in_options",
            json!({ "host": gitlab.host, "provider": "gitlab" }),
        )
        .unwrap();
    assert_eq!(options["methods"], json!(["oauth", "web", "token"]));
    assert_eq!(options["unavailable"], json!([]));

    let mut replies = Vec::new();
    let cases = [
        (
            "op-gitlab-oauth",
            &gitlab_id,
            "gitlab",
            "oauth",
            "browser",
            Flavor::GitLab,
        ),
        (
            "op-gitlab-web",
            &gitlab_id,
            "gitlab",
            "web",
            "device_code",
            Flavor::GitLab,
        ),
        (
            "op-github-web",
            &github_id,
            "github",
            "web",
            "device_code",
            Flavor::GitHub,
        ),
        (
            "op-gitea-oauth",
            &gitea_id,
            "gitea",
            "oauth",
            "browser",
            Flavor::Gitea,
        ),
    ];
    for (operation, id, provider, method, first, flavor) in cases {
        let signed = h
            .call(
                "git_host_oauth_sign_in",
                json!({ "operationId": operation, "hostId": id, "provider": provider, "method": method }),
            )
            .unwrap_or_else(|error| panic!("{operation} failed: {error}"));
        let expected = json!({ "provider": provider, "method": method, "login": flavor.login() });
        assert_eq!(signed["sign_in"], expected, "{operation}");
        assert_eq!(h.sign_in_of(id), expected, "{operation}");
        assert_eq!(h.stages(operation), [first, "completed"], "{operation}");
        let record: Value =
            serde_json::from_str(&h.store.get(id).unwrap().expect("a stored sign-in")).unwrap();
        assert_eq!(record["method"], method);
        assert_eq!(record["login"], flavor.login());
        assert!(record.get("client_secret").is_none());
        replies.push(signed.to_string());
    }

    let device_links: Vec<Value> = h
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["stage"]["kind"] == "device_code")
        .map(|event| event["stage"].clone())
        .collect();
    assert_eq!(
        device_links[0],
        json!({ "kind": "device_code", "url": "http://provider.example/device?user_code=ABCD-1234", "code": "ABCD-1234" })
    );
    let opened = h.opened.lock().unwrap().clone();
    assert_eq!(opened.len(), 4);
    assert!(opened.contains(&"http://provider.example/device?user_code=ABCD-1234".to_owned()));

    let secrets: Vec<String> = [gitlab.secrets(), github.secrets(), gitea.secrets()].concat();
    assert!(secrets.iter().any(|secret| secret.contains("-code-")));
    assert!(secrets.iter().any(|secret| secret.contains("-device-")));
    assert!(secrets.iter().any(|secret| secret.contains("-access-")));
    assert!(secrets.iter().any(|secret| secret.len() == 43));
    let events = serde_json::to_string(&*h.events.lock().unwrap()).unwrap();
    free_of(&events, &secrets, "the sign-in events");
    free_of(&replies.join("\n"), &secrets, "the IPC replies");
    free_of(&opened.join("\n"), &secrets, "the opened pages");
    let logged = logs().0.lock().unwrap().join("\n");
    assert!(logged.contains("git_host_oauth_sign_in"));
    free_of(&logged, &secrets, "the log");
    files_free_of(h.data.path(), &secrets);
}

#[test]
fn a_missing_registration_is_explained_and_refused_while_token_sign_in_works() {
    let gitlab = mock(Flavor::GitLab);
    let h = Harness::new("");
    let id = h.add_host(&gitlab.host);
    let options = h
        .call(
            "git_host_sign_in_options",
            json!({ "host": gitlab.host, "provider": "gitlab" }),
        )
        .unwrap();
    let reason = format!(
        "Operator registration is not configured for OAuth sign-in on {}.",
        gitlab.host
    );
    assert_eq!(options["methods"], json!(["token"]));
    assert_eq!(
        options["unavailable"],
        json!([
            { "method": "oauth", "reason": reason },
            { "method": "web", "reason": format!("Operator registration is not configured for Web sign-in on {}.", gitlab.host) },
        ])
    );

    let refused = h
        .call(
            "git_host_oauth_sign_in",
            json!({ "operationId": "op-missing", "hostId": id, "provider": "gitlab", "method": "oauth" }),
        )
        .unwrap_err();
    assert_eq!(refused["kind"], "invalid_request");
    assert!(refused["message"].as_str().unwrap().contains(&reason));
    assert!(h.opened.lock().unwrap().is_empty());
    assert!(h.stages("op-missing").is_empty());
    assert_eq!(h.store.get(&id).unwrap(), None);

    let signed = h
        .call(
            "git_host_token_sign_in",
            json!({ "hostId": id, "provider": "gitlab", "token": "synthetic-pat" }),
        )
        .unwrap();
    assert_eq!(
        signed["sign_in"],
        json!({ "provider": "gitlab", "method": "token", "login": "yui-gitlab" })
    );
    assert_eq!(h.sign_in_of(&id), signed["sign_in"]);
}

type Seen = Arc<Mutex<Vec<(String, Option<String>)>>>;

fn git_server() -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let host = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let recorded = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Some(request) = read_request(&mut stream) else {
                continue;
            };
            recorded
                .lock()
                .unwrap()
                .push((request.path.clone(), request.authorization.clone()));
            let body = match (request.path.as_str(), request.authorization.as_deref()) {
                ("/api/v4/user", Some("Bearer synthetic-host-token")) => r#"{"username":"yui"}"#,
                ("/api/v4/user", Some("Bearer synthetic-platform-token")) => {
                    r#"{"username":"plat"}"#
                }
                ("/api/v4/user", _) => r#"{"message":"401 Unauthorized synthetic-rejected-token"}"#,
                _ => "",
            };
            let status = if body.starts_with(r#"{"username""#) {
                "200 OK"
            } else {
                "401 Unauthorized"
            };
            reply(
                &mut stream,
                status,
                "WWW-Authenticate: Basic realm=\"test\"\r\n",
                body,
            );
        }
    });
    (host, seen)
}

#[test]
fn token_sign_in_is_used_by_git_first_and_cleared_by_rename_sign_out_and_remove() {
    let (host, seen) = git_server();
    let h = Harness::new("");

    let id = h.add_host(&host);
    assert_eq!(h.sign_in_of(&id), Value::Null);

    let rejected = h
        .call(
            "git_host_token_sign_in",
            json!({ "hostId": id, "provider": "gitlab", "token": "synthetic-rejected-token" }),
        )
        .unwrap_err();
    assert!(!rejected.to_string().contains("synthetic-rejected-token"));
    assert_eq!(h.store.get(&id).unwrap(), None);

    let token_sign_in = || {
        h.call(
            "git_host_token_sign_in",
            json!({ "hostId": id, "provider": "gitlab", "token": "synthetic-host-token" }),
        )
        .unwrap()
    };
    let expected = json!({ "provider": "gitlab", "method": "token", "login": "yui" });
    assert_eq!(token_sign_in()["sign_in"], expected);
    assert_eq!(h.sign_in_of(&id), expected);

    h.call(
        "platform_connection_add",
        json!({ "kind": "gitlab", "host": host, "name": "Work", "token": "synthetic-platform-token", "insecureTls": false }),
    )
    .unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let repo = scratch.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            &format!("http://{host}/team/app.git"),
        ],
    );
    let fetched = h.call(
        "fetch",
        json!({ "path": repo.to_string_lossy(), "id": "fetch-1", "prune": false }),
    );
    assert!(fetched.is_err());
    let basic = seen
        .lock()
        .unwrap()
        .iter()
        .filter(|(path, _)| path.starts_with("/team/app.git"))
        .find_map(|(_, authorization)| authorization.clone());
    assert_eq!(
        basic,
        Some(format!(
            "Basic {}",
            base64(b"oauth2:synthetic-host-token", false)
        ))
    );

    let save = |name: &str, user: Value| {
        h.call(
            "git_host_save",
            json!({ "id": id, "draft": { "host": name, "ssh_key_path": null, "https_user": user } }),
        )
        .unwrap()
    };
    assert_eq!(
        save("gitlab.corp.example", Value::Null)["sign_in"],
        Value::Null
    );
    assert_eq!(h.store.get(&id).unwrap(), None);
    save(&host, Value::Null);
    token_sign_in();
    assert_eq!(save(&host, json!("yui"))["sign_in"], expected);

    h.call("git_host_sign_out", json!({ "hostId": id }))
        .unwrap();
    assert_eq!(h.store.get(&id).unwrap(), None);
    assert_eq!(h.sign_in_of(&id), Value::Null);

    token_sign_in();
    h.call("git_host_remove", json!({ "id": id })).unwrap();
    assert_eq!(h.store.get(&id).unwrap(), None);
    assert_eq!(h.call("git_hosts_list", json!({})).unwrap(), json!([]));

    files_free_of(h.data.path(), &["synthetic-host-token".to_owned()]);
}
