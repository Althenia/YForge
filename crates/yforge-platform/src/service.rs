use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use yforge_ai::SecretStore;
use yforge_core::{
    list_remotes, load_recents, platform_connection_add, platform_connection_remove,
    platform_connection_save_meta, platform_connection_update, platform_connections_list,
    CancelToken, CreatePull, HttpsCredential, LaunchpadPulls, MatchedRepo, PlatformAuthMethod,
    PlatformConnection, PlatformKind, PlatformOAuthMethod, PlatformOAuthStage, PrDetail, PullList,
    PullRequest, RepoRef,
};

use crate::adapter::PrFilter;
use crate::client::Client;
use crate::error::{PlatformError, Result};
use crate::oauth::{self, OAuthEndpoints, OAuthRecord};
use crate::url::parse_remote;

const NAME_LIMIT: usize = 80;
type ChecksKey = (String, String, String, i64);
type ChecksEntry = (Instant, Option<yforge_core::PullChecks>);

#[derive(Clone, PartialEq, Eq)]
pub struct NewConnection {
    pub kind: PlatformKind,
    pub host: String,
    pub name: String,
    pub token: String,
    pub insecure_tls: bool,
}

impl std::fmt::Debug for NewConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NewConnection")
            .field("kind", &self.kind)
            .field("host", &self.host)
            .field("name", &self.name)
            .field("token", &"<redacted>")
            .field("insecure_tls", &self.insecure_tls)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct NewOAuthConnection {
    pub existing_id: Option<String>,
    pub kind: PlatformKind,
    pub host: String,
    pub name: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    pub insecure_tls: bool,
}

impl std::fmt::Debug for NewOAuthConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NewOAuthConnection")
            .field("existing_id", &self.existing_id)
            .field("kind", &self.kind)
            .field("host", &self.host)
            .field("name", &self.name)
            .field("client_id", &self.client_id)
            .field(
                "client_secret",
                &self.client_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("insecure_tls", &self.insecure_tls)
            .finish()
    }
}

pub struct PlatformService {
    pub(crate) secrets: Arc<dyn SecretStore>,
    checks: Mutex<HashMap<ChecksKey, ChecksEntry>>,
    endpoints: OAuthEndpoints,
}

/// The problem the form must show with a field, or `None` when the value is acceptable.
///
/// The rules live here, next to the ones the service enforces when it saves, so the
/// form and the save can never disagree.
pub fn connection_field_problem(field: &str, value: &str) -> Option<String> {
    let outcome = match field {
        "host" => valid_host(value).map(|_| ()),
        "name" => valid_name(value).map(|_| ()),
        "token" => valid_token(value).map(|_| ()),
        "client_id" => valid_client_id(value).map(|_| ()),
        _ => return Some(format!("unknown field `{field}`")),
    };
    outcome.err().map(|error| error.detail())
}

pub fn oauth_field_problem(field: &str, value: &str) -> Option<String> {
    let outcome = match field {
        "host" => valid_host(value).map(|_| ()),
        "name" => valid_name(value).map(|_| ()),
        "client_id" => valid_client_id(value).map(|_| ()),
        _ => return Some(format!("unknown field `{field}`")),
    };
    outcome.err().map(|error| error.detail())
}

fn account(id: &str) -> String {
    format!("platform.{id}")
}

fn oauth_account(id: &str) -> String {
    format!("platform.oauth.{id}")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn valid_client_id(text: &str) -> Result<String> {
    let client_id = text.trim();
    if client_id.is_empty() {
        return Err(PlatformError::invalid("the client ID is required"));
    }
    Ok(client_id.to_owned())
}

pub(crate) fn valid_host(text: &str) -> Result<String> {
    let host = text.trim().to_ascii_lowercase();
    let (name, port) = match host.rsplit_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host.as_str(), None),
    };
    let name_ok = !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    let port_ok = port.is_none_or(|port| port.parse::<u16>().is_ok());
    if !name_ok || !port_ok {
        return Err(PlatformError::invalid(
            "enter the host only, such as github.com or git.example.com:8443, without https:// or a path",
        ));
    }
    Ok(host)
}

fn valid_name(text: &str) -> Result<String> {
    let name = text.trim();
    if name.is_empty() || name.chars().count() > NAME_LIMIT {
        return Err(PlatformError::invalid(format!(
            "the connection name must be 1 to {NAME_LIMIT} characters"
        )));
    }
    Ok(name.to_owned())
}

pub(crate) fn valid_token(text: &str) -> Result<String> {
    let token = text.trim();
    if token.is_empty() {
        return Err(PlatformError::invalid("the access token is required"));
    }
    Ok(token.to_owned())
}

pub(crate) fn secret_error(error: yforge_ai::SecretError) -> PlatformError {
    PlatformError::Secrets { detail: error.0 }
}

fn match_repository(dir: &Path, path: &Path) -> Result<Option<MatchedRepo>> {
    let connections = platform_connections_list(dir)?;
    if connections.is_empty() {
        return Ok(None);
    }
    for remote in list_remotes(path)? {
        let Some((host, repo)) = parse_remote(&remote.fetch_url) else {
            continue;
        };
        if let Some(connection) = connections
            .iter()
            .find(|connection| connection.host.eq_ignore_ascii_case(&host))
        {
            return Ok(Some(MatchedRepo {
                connection: connection.clone(),
                remote: remote.name,
                repo,
            }));
        }
    }
    Ok(None)
}

impl PlatformService {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self::with_endpoints(secrets, OAuthEndpoints::default())
    }

    pub fn with_endpoints(secrets: Arc<dyn SecretStore>, endpoints: OAuthEndpoints) -> Self {
        Self {
            secrets,
            checks: Mutex::default(),
            endpoints,
        }
    }

    pub fn list(&self, dir: &Path) -> Result<Vec<PlatformConnection>> {
        Ok(platform_connections_list(dir)?)
    }

    pub async fn add(&self, dir: &Path, input: NewConnection) -> Result<PlatformConnection> {
        let host = valid_host(&input.host)?;
        let name = valid_name(&input.name)?;
        let token = valid_token(&input.token)?;
        let connection =
            platform_connection_add(dir, input.kind, &host, &name, input.insecure_tls)?;
        let secret = account(&connection.id);
        let verified = async {
            self.secrets.set(&secret, &token).map_err(secret_error)?;
            Client::new(&connection, &token)?.verify().await
        }
        .await;
        let login = match verified {
            Ok(login) => login,
            Err(error) => {
                let _ = self.secrets.delete(&secret);
                let _ = platform_connection_remove(dir, &connection.id);
                return Err(error);
            }
        };
        Ok(platform_connection_save_meta(
            dir,
            &connection.id,
            PlatformAuthMethod::Token,
            None,
            Some(&login),
        )?)
    }

    pub fn remove(&self, dir: &Path, id: &str) -> Result<()> {
        platform_connection_remove(dir, id)?;
        self.secrets.delete(&account(id)).map_err(secret_error)?;
        self.secrets
            .delete(&oauth_account(id))
            .map_err(secret_error)
    }

    fn persist_oauth(&self, id: &str, record: &OAuthRecord) -> Result<()> {
        let stored = serde_json::to_string(record).map_err(|error| PlatformError::Secrets {
            detail: error.to_string(),
        })?;
        self.secrets
            .set(&oauth_account(id), &stored)
            .map_err(secret_error)?;
        self.secrets
            .set(&account(id), &record.access_token)
            .map_err(secret_error)
    }

    fn stored_oauth(&self, id: &str) -> Result<Option<OAuthRecord>> {
        let Some(stored) = self.secrets.get(&oauth_account(id)).map_err(secret_error)? else {
            return Ok(None);
        };
        serde_json::from_str(&stored)
            .map(Some)
            .map_err(|error| PlatformError::Secrets {
                detail: format!("stored OAuth credentials are unreadable: {error}"),
            })
    }

    async fn refresh_oauth(
        &self,
        connection: &PlatformConnection,
        record: &OAuthRecord,
    ) -> Result<OAuthRecord> {
        let fresh = oauth::refresh(
            connection.kind,
            &connection.host,
            record,
            &self.endpoints,
            connection.insecure_tls,
            &CancelToken::new(),
        )
        .await?;
        self.persist_oauth(&connection.id, &fresh)?;
        Ok(fresh)
    }

    pub async fn sign_in_oauth(
        &self,
        dir: &Path,
        input: NewOAuthConnection,
        method: PlatformOAuthMethod,
        cancel: &CancelToken,
        on_stage: &(dyn Fn(PlatformOAuthStage) + Send + Sync),
    ) -> Result<PlatformConnection> {
        let host = valid_host(&input.host)?;
        let name = valid_name(&input.name)?;
        let client_id = valid_client_id(&input.client_id)?;
        let client_secret = input
            .client_secret
            .as_deref()
            .map(str::trim)
            .filter(|secret| !secret.is_empty());
        if let Some(existing_id) = &input.existing_id {
            self.connection(dir, existing_id)?;
        }
        let record = oauth::sign_in(
            input.kind,
            &host,
            &client_id,
            client_secret,
            method,
            &self.endpoints,
            input.insecure_tls,
            cancel,
            on_stage,
        )
        .await?;
        let candidate = PlatformConnection {
            id: input
                .existing_id
                .clone()
                .unwrap_or_else(|| "pending".to_owned()),
            kind: input.kind,
            host: host.clone(),
            name: name.clone(),
            insecure_tls: input.insecure_tls,
            created_at: 0,
            auth_method: PlatformAuthMethod::OAuth,
            oauth_client_id: Some(client_id.clone()),
            login: None,
        };
        let login = Client::new(&candidate, &record.access_token)?
            .verify()
            .await?;
        on_stage(PlatformOAuthStage::Completed {
            login: login.clone(),
        });
        if let Some(existing_id) = &input.existing_id {
            let updated = platform_connection_update(
                dir,
                existing_id,
                input.kind,
                &host,
                &name,
                input.insecure_tls,
                PlatformAuthMethod::OAuth,
                Some(&client_id),
                Some(&login),
            )?;
            self.persist_oauth(&updated.id, &record)?;
            return Ok(updated);
        }
        let connection =
            platform_connection_add(dir, input.kind, &host, &name, input.insecure_tls)?;
        let saved = platform_connection_save_meta(
            dir,
            &connection.id,
            PlatformAuthMethod::OAuth,
            Some(&client_id),
            Some(&login),
        )?;
        if let Err(error) = self.persist_oauth(&saved.id, &record) {
            let _ = self.secrets.delete(&account(&saved.id));
            let _ = self.secrets.delete(&oauth_account(&saved.id));
            let _ = platform_connection_remove(dir, &saved.id);
            return Err(error);
        }
        Ok(saved)
    }

    async fn access_token_for(&self, connection: &PlatformConnection) -> Result<String> {
        let stored = self.stored_oauth(&connection.id)?;
        if connection.auth_method == PlatformAuthMethod::OAuth || stored.is_some() {
            let record = stored.ok_or_else(|| PlatformError::AuthFailed {
                host: connection.host.clone(),
                detail: "no OAuth credentials are stored for this connection".to_owned(),
            })?;
            if record.expired(now_ms()) && record.refresh_token.is_some() {
                let fresh = self.refresh_oauth(connection, &record).await?;
                return Ok(fresh.access_token);
            }
            return Ok(record.access_token);
        }
        self.secrets
            .get(&account(&connection.id))
            .map_err(secret_error)?
            .ok_or_else(|| PlatformError::AuthFailed {
                host: connection.host.clone(),
                detail: "no access token is stored for this connection".to_owned(),
            })
    }

    pub async fn https_credentials(&self, dir: &Path) -> Vec<HttpsCredential> {
        let Ok(connections) = platform_connections_list(dir) else {
            return Vec::new();
        };
        let mut credentials = Vec::new();
        for connection in &connections {
            if let Ok(token) = self.access_token_for(connection).await {
                credentials.push(HttpsCredential {
                    host: connection.host.clone(),
                    username: oauth::git_https_username(
                        connection.kind,
                        &connection.host,
                        connection.login.as_deref(),
                    ),
                    secret: token,
                });
            }
        }
        credentials
    }

    pub async fn test(&self, dir: &Path, id: &str) -> Result<String> {
        let connection = self.connection(dir, id)?;
        match self.client(&connection).await?.verify().await {
            Ok(login) => Ok(login),
            Err(error) => {
                let record = if matches!(error, PlatformError::AuthFailed { .. }) {
                    self.stored_oauth(&connection.id)?
                } else {
                    None
                };
                match record {
                    Some(record) if record.refresh_token.is_some() => {
                        let fresh = self.refresh_oauth(&connection, &record).await?;
                        Client::new(&connection, &fresh.access_token)?
                            .verify()
                            .await
                    }
                    _ => Err(error),
                }
            }
        }
    }

    /// The open pull requests of the user on one connection, without local paths.
    pub async fn my_pulls(&self, dir: &Path, id: &str) -> Result<LaunchpadPulls> {
        let connection = self.connection(dir, id)?;
        self.client(&connection).await?.mine().await
    }

    /// Fills in the recent repository each pull request belongs to, by matching its
    /// repository to the remotes of the recent repositories.
    pub fn locate_pulls(
        &self,
        dir: &Path,
        id: &str,
        mut found: LaunchpadPulls,
    ) -> Result<LaunchpadPulls> {
        let connection = self.connection(dir, id)?;
        let mut local: Vec<(String, RepoRef)> = Vec::new();
        for recent in load_recents(dir)? {
            let Ok(remotes) = list_remotes(Path::new(&recent.path)) else {
                continue;
            };
            for remote in remotes {
                match parse_remote(&remote.fetch_url) {
                    Some((host, repo)) if host.eq_ignore_ascii_case(&connection.host) => {
                        local.push((recent.path.clone(), repo));
                    }
                    _ => {}
                }
            }
        }
        for pull in &mut found.pulls {
            pull.local_path = local
                .iter()
                .find(|(_, repo)| {
                    repo.owner.eq_ignore_ascii_case(&pull.repo.owner)
                        && repo.repo.eq_ignore_ascii_case(&pull.repo.repo)
                })
                .map(|(path, _)| path.clone());
        }
        Ok(found)
    }

    fn connection(&self, dir: &Path, id: &str) -> Result<PlatformConnection> {
        self.list(dir)?
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| {
                PlatformError::invalid(format!("there is no platform connection `{id}`"))
            })
    }

    pub fn match_repo(&self, dir: &Path, path: &Path) -> Result<Option<MatchedRepo>> {
        match_repository(dir, path)
    }

    pub fn require_repo(&self, dir: &Path, path: &Path) -> Result<MatchedRepo> {
        self.match_repo(dir, path)?.ok_or_else(|| {
            PlatformError::invalid("no platform connection matches this repository's remotes")
        })
    }

    pub async fn prs_list(&self, matched: &MatchedRepo, filter: PrFilter) -> Result<PullList> {
        self.client(&matched.connection)
            .await?
            .list(&matched.repo, filter)
            .await
    }

    pub async fn pr_detail(&self, matched: &MatchedRepo, number: i64) -> Result<PrDetail> {
        self.client(&matched.connection)
            .await?
            .detail(&matched.repo, number)
            .await
    }

    pub async fn pr_checks(
        &self,
        matched: Option<&MatchedRepo>,
        number: i64,
    ) -> Result<Option<yforge_core::PullChecks>> {
        let Some(matched) = matched else {
            return Ok(None);
        };
        let key = (
            matched.connection.id.clone(),
            matched.repo.owner.clone(),
            matched.repo.repo.clone(),
            number,
        );
        {
            let cache = self
                .checks
                .lock()
                .map_err(|_| PlatformError::invalid("checks cache is unavailable"))?;
            if let Some((when, summary)) = cache.get(&key) {
                if when.elapsed() < Duration::from_secs(30) {
                    return Ok(summary.clone());
                }
            }
        }
        let summary = self
            .client(&matched.connection)
            .await?
            .checks(&matched.repo, number)
            .await?;
        let mut cache = self
            .checks
            .lock()
            .map_err(|_| PlatformError::invalid("checks cache is unavailable"))?;
        if cache.len() >= 256 {
            cache.clear();
        }
        cache.insert(key, (Instant::now(), summary.clone()));
        Ok(summary)
    }

    pub async fn pr_create(
        &self,
        matched: &MatchedRepo,
        input: &CreatePull,
    ) -> Result<PullRequest> {
        self.client(&matched.connection)
            .await?
            .create(&matched.repo, input)
            .await
    }

    pub async fn pr_merge(&self, matched: &MatchedRepo, number: i64) -> Result<PullRequest> {
        self.client(&matched.connection)
            .await?
            .merge(&matched.repo, number)
            .await
    }

    async fn client(&self, connection: &PlatformConnection) -> Result<Client> {
        let token = self.access_token_for(connection).await?;
        Client::new(connection, &token)
    }
}
