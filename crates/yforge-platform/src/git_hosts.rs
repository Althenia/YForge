use std::fmt;
use std::path::Path;
use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use yforge_core::{
    git_hosts_list, CancelToken, CoreError, GitHost, GitHostMethodNote, GitHostProvider,
    GitHostSignIn, GitHostSignInMethod, GitHostSignInOptions, HostCredentials, HttpsCredential,
    PlatformKind, PlatformOAuthMethod, PlatformOAuthStage,
};

use crate::adapter::Adapter;
use crate::bitbucket_cloud::{BitbucketCloud, HOST as BITBUCKET_CLOUD_HOST};
use crate::bitbucket_data_center::BitbucketDataCenter;
use crate::error::{PlatformError, Result};
use crate::github::GitHub;
use crate::gitlab::GitLab;
use crate::http::{scheme_for, Http};
use crate::oauth::{self, OAuthEndpoints, OAuthRecord};

const BITBUCKET_CLOUD_API: &str = "https://api.bitbucket.org/2.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHostRegistration {
    pub provider: GitHostProvider,
    pub host: String,
    pub client_id: String,
    pub flows: Vec<GitHostSignInMethod>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitHostRegistrations(Vec<GitHostRegistration>);

fn public_flows(provider: GitHostProvider) -> &'static [GitHostSignInMethod] {
    match provider {
        GitHostProvider::Github => &[GitHostSignInMethod::Web],
        GitHostProvider::Gitlab => &[GitHostSignInMethod::OAuth, GitHostSignInMethod::Web],
        GitHostProvider::Gitea => &[GitHostSignInMethod::OAuth],
        GitHostProvider::Bitbucket => &[],
    }
}

fn parse_entry(entry: &str) -> std::result::Result<GitHostRegistration, String> {
    let parts: Vec<&str> = entry.split('|').map(str::trim).collect();
    let [provider, host, client_id, flows] = parts.as_slice() else {
        return Err(format!("`{entry}` is not provider|host|client_id|flows"));
    };
    let provider = match *provider {
        "github" => GitHostProvider::Github,
        "gitlab" => GitHostProvider::Gitlab,
        "gitea" => GitHostProvider::Gitea,
        "bitbucket" => return Err("Bitbucket has no public-client sign-in to register".to_owned()),
        other => return Err(format!("`{other}` is not a Git host provider")),
    };
    let host = host.to_ascii_lowercase();
    let host_ok = !host.is_empty()
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'));
    if !host_ok {
        return Err(format!("`{host}` is not a host name"));
    }
    if client_id.is_empty()
        || client_id
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("the client ID for {host} is empty or malformed"));
    }
    let mut chosen = Vec::new();
    for flow in flows.split(',').map(str::trim) {
        let method = match flow {
            "oauth" => GitHostSignInMethod::OAuth,
            "web" => GitHostSignInMethod::Web,
            other => return Err(format!("`{other}` is not a sign-in flow")),
        };
        if !public_flows(provider).contains(&method) {
            return Err(format!(
                "{} cannot use {flow} with a public client",
                label(provider, &host)
            ));
        }
        if !chosen.contains(&method) {
            chosen.push(method);
        }
    }
    Ok(GitHostRegistration {
        provider,
        host,
        client_id: (*client_id).to_owned(),
        flows: chosen,
    })
}

impl GitHostRegistrations {
    pub fn new(entries: Vec<GitHostRegistration>) -> Self {
        Self(entries)
    }

    pub fn parse(text: &str) -> std::result::Result<Self, String> {
        let mut entries: Vec<GitHostRegistration> = Vec::new();
        for entry in text
            .split([';', '\n'])
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
        {
            let parsed = parse_entry(entry)?;
            if entries
                .iter()
                .any(|known| known.provider == parsed.provider && known.host == parsed.host)
            {
                return Err(format!(
                    "{} on {} is registered twice",
                    label(parsed.provider, &parsed.host),
                    parsed.host
                ));
            }
            entries.push(parsed);
        }
        Ok(Self(entries))
    }

    pub fn from_build() -> std::result::Result<Self, String> {
        Self::parse(option_env!("YFORGE_GIT_HOST_REGISTRATIONS").unwrap_or_default())
    }

    pub fn client_id(
        &self,
        provider: GitHostProvider,
        host: &str,
        method: GitHostSignInMethod,
    ) -> Option<&str> {
        self.0
            .iter()
            .find(|entry| {
                entry.provider == provider
                    && entry.host.eq_ignore_ascii_case(host)
                    && entry.flows.contains(&method)
            })
            .map(|entry| entry.client_id.as_str())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GitHostEndpoints {
    pub oauth: OAuthEndpoints,
    pub github_api_base: Option<String>,
    pub bitbucket_api_base: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHostCredential {
    pub host: String,
    pub provider: GitHostProvider,
    pub method: GitHostSignInMethod,
    pub login: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub client_id: Option<String>,
}

impl fmt::Debug for GitHostCredential {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GitHostCredential")
            .field("host", &self.host)
            .field("provider", &self.provider)
            .field("method", &self.method)
            .field("login", &self.login)
            .field("access_token", &"<redacted>")
            .field(
                "refresh_token",
                &self.refresh_token.as_ref().map(|_| "<redacted>"),
            )
            .field("expires_at", &self.expires_at)
            .field("client_id", &self.client_id)
            .finish()
    }
}

impl GitHostCredential {
    fn oauth_record(&self) -> OAuthRecord {
        OAuthRecord {
            access_token: self.access_token.clone(),
            refresh_token: self.refresh_token.clone(),
            expires_at: self.expires_at,
            client_id: self.client_id.clone().unwrap_or_default(),
            client_secret: None,
        }
    }

    fn sign_in(&self) -> GitHostSignIn {
        GitHostSignIn {
            provider: self.provider,
            method: self.method,
            login: self.login.clone(),
        }
    }

    fn git_user(&self) -> String {
        match self.provider {
            GitHostProvider::Github => "x-access-token".to_owned(),
            GitHostProvider::Gitlab => "oauth2".to_owned(),
            GitHostProvider::Bitbucket if is_cloud(&self.host) => {
                "x-bitbucket-api-token-auth".to_owned()
            }
            GitHostProvider::Bitbucket | GitHostProvider::Gitea => self.login.clone(),
        }
    }
}

fn is_cloud(host: &str) -> bool {
    host.eq_ignore_ascii_case(BITBUCKET_CLOUD_HOST)
}

fn label(provider: GitHostProvider, host: &str) -> &'static str {
    match provider {
        GitHostProvider::Github => "GitHub",
        GitHostProvider::Gitlab => "GitLab",
        GitHostProvider::Bitbucket if is_cloud(host) => "Bitbucket Cloud",
        GitHostProvider::Bitbucket => "Bitbucket Data Center",
        GitHostProvider::Gitea => "Gitea",
    }
}

fn flow_name(method: GitHostSignInMethod) -> &'static str {
    match method {
        GitHostSignInMethod::OAuth => "OAuth sign-in",
        GitHostSignInMethod::Web => "Web sign-in",
        GitHostSignInMethod::Token => "token sign-in",
    }
}

fn impossible(provider: GitHostProvider, host: &str, method: GitHostSignInMethod) -> String {
    match (provider, method) {
        (GitHostProvider::Github, _) => {
            "GitHub OAuth needs a client secret, which YForge never ships; use Web sign-in or Token."
                .to_owned()
        }
        (GitHostProvider::Bitbucket, GitHostSignInMethod::OAuth) if is_cloud(host) => {
            "Bitbucket Cloud OAuth needs a client secret, which YForge never ships.".to_owned()
        }
        (GitHostProvider::Bitbucket, GitHostSignInMethod::OAuth) => {
            "Bitbucket Data Center signs in with an HTTP access token only.".to_owned()
        }
        (provider, _) => format!("{} has no Web sign-in; use {}.", label(provider, host), match provider {
            GitHostProvider::Gitea => "OAuth or Token",
            _ => "Token",
        }),
    }
}

pub fn sign_in_options(
    host: &str,
    provider: Option<GitHostProvider>,
    registrations: &GitHostRegistrations,
) -> GitHostSignInOptions {
    use GitHostSignInMethod::{OAuth, Token, Web};
    let host = host.trim().to_ascii_lowercase();
    let fixed = match host.as_str() {
        "github.com" => Some(GitHostProvider::Github),
        "gitlab.com" => Some(GitHostProvider::Gitlab),
        BITBUCKET_CLOUD_HOST => Some(GitHostProvider::Bitbucket),
        _ => None,
    };
    let chosen = fixed.or(provider).unwrap_or(GitHostProvider::Gitlab);
    let mut methods = Vec::new();
    let mut unavailable = Vec::new();
    for method in [OAuth, Web] {
        let reason = if !public_flows(chosen).contains(&method) {
            Some(impossible(chosen, &host, method))
        } else if registrations.client_id(chosen, &host, method).is_none() {
            Some(format!(
                "Operator registration is not configured for {} on {host}.",
                flow_name(method)
            ))
        } else {
            None
        };
        match reason {
            Some(reason) => unavailable.push(GitHostMethodNote { method, reason }),
            None => methods.push(method),
        }
    }
    methods.push(Token);
    let site = format!("{}://{host}", scheme_for(&host));
    let token_page = match chosen {
        GitHostProvider::Github => {
            format!("{site}/settings/tokens/new?description=YForge&scopes=repo,read:org")
        }
        GitHostProvider::Gitlab => format!(
            "{site}/-/user_settings/personal_access_tokens?name=YForge&scopes=api,read_user,write_repository"
        ),
        GitHostProvider::Bitbucket if is_cloud(&host) => {
            "https://id.atlassian.com/manage-profile/security/api-tokens".to_owned()
        }
        GitHostProvider::Bitbucket => format!("{site}/plugins/servlet/access-tokens/manage"),
        GitHostProvider::Gitea => format!("{site}/user/settings/applications"),
    };
    GitHostSignInOptions {
        provider: chosen,
        provider_fixed: fixed.is_some(),
        methods,
        unavailable,
        token_page,
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn stored_error(error: CoreError) -> PlatformError {
    PlatformError::Secrets {
        detail: error.to_string(),
    }
}

fn find_host(dir: &Path, id: &str) -> Result<GitHost> {
    git_hosts_list(dir)?
        .into_iter()
        .find(|host| host.id == id)
        .ok_or_else(|| PlatformError::invalid(format!("there is no host identity `{id}`")))
}

pub struct GitHostAuth {
    store: Arc<dyn HostCredentials>,
    registrations: GitHostRegistrations,
    endpoints: GitHostEndpoints,
}

impl GitHostAuth {
    pub fn new(store: Arc<dyn HostCredentials>, registrations: GitHostRegistrations) -> Self {
        Self::with_endpoints(store, registrations, GitHostEndpoints::default())
    }

    pub fn with_endpoints(
        store: Arc<dyn HostCredentials>,
        registrations: GitHostRegistrations,
        endpoints: GitHostEndpoints,
    ) -> Self {
        Self {
            store,
            registrations,
            endpoints,
        }
    }

    pub fn options(&self, host: &str, provider: Option<GitHostProvider>) -> GitHostSignInOptions {
        sign_in_options(host, provider, &self.registrations)
    }

    fn record(&self, host: &GitHost) -> Result<Option<GitHostCredential>> {
        let Some(text) = self.store.get(&host.id).map_err(stored_error)? else {
            return Ok(None);
        };
        let record: GitHostCredential =
            serde_json::from_str(&text).map_err(|_| PlatformError::Secrets {
                detail: "the saved sign-in for this host is unreadable".to_owned(),
            })?;
        Ok((record.host == host.host).then_some(record))
    }

    fn save(&self, id: &str, record: &GitHostCredential) -> Result<()> {
        let text = serde_json::to_string(record).map_err(|error| PlatformError::Secrets {
            detail: error.to_string(),
        })?;
        self.store.set(id, &text).map_err(stored_error)
    }

    pub fn status(&self, host: &GitHost) -> Result<Option<GitHostSignIn>> {
        Ok(self.record(host)?.map(|record| record.sign_in()))
    }

    pub fn with_status(&self, host: GitHost) -> Result<GitHost> {
        let sign_in = self.status(&host)?;
        Ok(GitHost { sign_in, ..host })
    }

    pub fn list(&self, dir: &Path) -> Result<Vec<GitHost>> {
        git_hosts_list(dir)?
            .into_iter()
            .map(|host| self.with_status(host))
            .collect()
    }

    pub fn token_page(
        &self,
        dir: &Path,
        host_id: &str,
        provider: GitHostProvider,
    ) -> Result<String> {
        let host = find_host(dir, host_id)?;
        Ok(self.options(&host.host, Some(provider)).token_page)
    }

    pub fn sign_out(&self, host_id: &str) -> Result<()> {
        self.store.delete(host_id).map_err(stored_error)
    }

    async fn identity(&self, provider: GitHostProvider, host: &str, token: &str) -> Result<String> {
        let site = format!("{}://{host}", scheme_for(host));
        match provider {
            GitHostProvider::Github => {
                let base = self
                    .endpoints
                    .github_api_base
                    .clone()
                    .unwrap_or_else(|| GitHub.base_url(scheme_for(host), host));
                GitHub
                    .verify(&Http::bearer(host, token, base, GitHub.accept())?)
                    .await
            }
            GitHostProvider::Gitlab => {
                let base = GitLab.base_url(scheme_for(host), host);
                GitLab
                    .verify(&Http::bearer(host, token, base, GitLab.accept())?)
                    .await
            }
            GitHostProvider::Bitbucket if is_cloud(host) => {
                let base = self
                    .endpoints
                    .bitbucket_api_base
                    .clone()
                    .unwrap_or_else(|| BITBUCKET_CLOUD_API.to_owned());
                BitbucketCloud
                    .verify(&Http::bearer(host, token, base, BitbucketCloud.accept())?)
                    .await
            }
            GitHostProvider::Bitbucket => {
                let base = BitbucketDataCenter.base_url(scheme_for(host), host);
                BitbucketDataCenter
                    .verify(&Http::bearer(
                        host,
                        token,
                        base,
                        BitbucketDataCenter.accept(),
                    )?)
                    .await
            }
            GitHostProvider::Gitea => {
                let http = Http::bearer(host, token, format!("{site}/api/v1"), "application/json")?;
                let missing = format!("No Gitea API found at {host}");
                let value = http.call(Method::GET, "/user", None, &missing).await?;
                value
                    .get("login")
                    .and_then(Value::as_str)
                    .filter(|login| !login.is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| PlatformError::Api {
                        host: host.to_owned(),
                        status: 200,
                        detail: "the user reply has no login".to_owned(),
                    })
            }
        }
    }

    pub async fn sign_in_oauth(
        &self,
        dir: &Path,
        host_id: &str,
        provider: GitHostProvider,
        method: GitHostSignInMethod,
        cancel: &CancelToken,
        on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
    ) -> Result<GitHost> {
        let host = find_host(dir, host_id)?;
        let options = self.options(&host.host, Some(provider));
        let provider = options.provider;
        if method == GitHostSignInMethod::Token {
            return Err(PlatformError::invalid(
                "paste the access token to sign in with a token",
            ));
        }
        if let Some(note) = options
            .unavailable
            .iter()
            .find(|note| note.method == method)
        {
            return Err(PlatformError::invalid(note.reason.clone()));
        }
        let client_id = self
            .registrations
            .client_id(provider, &host.host, method)
            .ok_or_else(|| {
                PlatformError::invalid(format!(
                    "Operator registration is not configured for {} on {}.",
                    flow_name(method),
                    host.host
                ))
            })?
            .to_owned();
        let name = host.host.as_str();
        let endpoints = &self.endpoints.oauth;
        let granted = match (provider, method) {
            (GitHostProvider::Github, _) => {
                oauth::github_sign_in(
                    name,
                    &client_id,
                    None,
                    PlatformOAuthMethod::DeviceCode,
                    endpoints,
                    false,
                    cancel,
                    on_stage,
                )
                .await?
            }
            (GitHostProvider::Gitlab, GitHostSignInMethod::Web) => {
                oauth::gitlab_device_sign_in(
                    name, &client_id, None, endpoints, false, cancel, on_stage,
                )
                .await?
            }
            (GitHostProvider::Gitlab, _) => {
                oauth::gitlab_sign_in(
                    name,
                    &client_id,
                    None,
                    PlatformOAuthMethod::Browser,
                    endpoints,
                    false,
                    cancel,
                    on_stage,
                )
                .await?
            }
            (GitHostProvider::Gitea, _) => {
                oauth::gitea_sign_in(name, &client_id, None, endpoints, false, cancel, on_stage)
                    .await?
            }
            (GitHostProvider::Bitbucket, _) => {
                return Err(PlatformError::invalid(impossible(provider, name, method)))
            }
        };
        let login = self.identity(provider, name, &granted.access_token).await?;
        let record = GitHostCredential {
            host: host.host.clone(),
            provider,
            method,
            login: login.clone(),
            access_token: granted.access_token,
            refresh_token: granted.refresh_token,
            expires_at: granted.expires_at,
            client_id: Some(client_id),
        };
        self.save(&host.id, &record)?;
        on_stage(PlatformOAuthStage::Completed { login });
        Ok(GitHost {
            sign_in: Some(record.sign_in()),
            ..host
        })
    }

    pub async fn sign_in_token(
        &self,
        dir: &Path,
        host_id: &str,
        provider: GitHostProvider,
        token: &str,
    ) -> Result<GitHost> {
        let host = find_host(dir, host_id)?;
        let provider = self.options(&host.host, Some(provider)).provider;
        let token = token.trim();
        if token.is_empty() {
            return Err(PlatformError::invalid("the access token is required"));
        }
        let login = self.identity(provider, &host.host, token).await?;
        let record = GitHostCredential {
            host: host.host.clone(),
            provider,
            method: GitHostSignInMethod::Token,
            login,
            access_token: token.to_owned(),
            refresh_token: None,
            expires_at: None,
            client_id: None,
        };
        self.save(&host.id, &record)?;
        Ok(GitHost {
            sign_in: Some(record.sign_in()),
            ..host
        })
    }

    async fn fresh(&self, host: &GitHost, record: GitHostCredential) -> Result<GitHostCredential> {
        let stale = record.method != GitHostSignInMethod::Token
            && record.refresh_token.is_some()
            && record.oauth_record().expired(now_ms());
        if !stale {
            return Ok(record);
        }
        let previous = record.oauth_record();
        let endpoints = &self.endpoints.oauth;
        let cancel = CancelToken::new();
        let name = host.host.as_str();
        let renewed = match record.provider {
            GitHostProvider::Github => {
                oauth::refresh(
                    PlatformKind::GitHub,
                    name,
                    &previous,
                    endpoints,
                    false,
                    &cancel,
                )
                .await?
            }
            GitHostProvider::Gitlab => {
                oauth::refresh(
                    PlatformKind::GitLab,
                    name,
                    &previous,
                    endpoints,
                    false,
                    &cancel,
                )
                .await?
            }
            GitHostProvider::Bitbucket => return Ok(record),
            GitHostProvider::Gitea => {
                oauth::refresh_gitea(name, &previous, endpoints, false, &cancel).await?
            }
        };
        let updated = GitHostCredential {
            access_token: renewed.access_token,
            refresh_token: renewed.refresh_token,
            expires_at: renewed.expires_at,
            ..record
        };
        self.save(&host.id, &updated)?;
        Ok(updated)
    }

    pub async fn https_credentials(&self, dir: &Path) -> Vec<HttpsCredential> {
        let Ok(hosts) = git_hosts_list(dir) else {
            return Vec::new();
        };
        let mut credentials = Vec::new();
        for host in &hosts {
            let Ok(Some(record)) = self.record(host) else {
                continue;
            };
            if let Ok(record) = self.fresh(host, record).await {
                credentials.push(HttpsCredential {
                    host: host.host.clone(),
                    username: record.git_user(),
                    secret: record.access_token,
                });
            }
        }
        credentials
    }
}
