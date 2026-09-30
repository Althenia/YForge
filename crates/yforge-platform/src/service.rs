use std::path::Path;
use std::sync::Arc;

use yforge_ai::SecretStore;
use yforge_core::{
    list_remotes, platform_connection_add, platform_connection_remove, platform_connections_list,
    CreatePull, MatchedRepo, PlatformConnection, PlatformKind, PrDetail, PullRequest,
};

use crate::adapter::PrFilter;
use crate::client::Client;
use crate::error::{PlatformError, Result};
use crate::url::parse_remote;

const NAME_LIMIT: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewConnection {
    pub kind: PlatformKind,
    pub host: String,
    pub name: String,
    pub token: String,
    pub insecure_tls: bool,
}

pub struct PlatformService {
    secrets: Arc<dyn SecretStore>,
}

fn account(id: &str) -> String {
    format!("platform.{id}")
}

fn valid_host(text: &str) -> Result<String> {
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

fn valid_token(text: &str) -> Result<String> {
    let token = text.trim();
    if token.is_empty() {
        return Err(PlatformError::invalid("the access token is required"));
    }
    Ok(token.to_owned())
}

fn keychain(error: yforge_ai::SecretError) -> PlatformError {
    PlatformError::Keychain { detail: error.0 }
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
        Self { secrets }
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
            self.secrets.set(&secret, &token).map_err(keychain)?;
            Client::new(&connection, &token)?.verify().await
        }
        .await;
        if let Err(error) = verified {
            let _ = self.secrets.delete(&secret);
            let _ = platform_connection_remove(dir, &connection.id);
            return Err(error);
        }
        Ok(connection)
    }

    pub fn remove(&self, dir: &Path, id: &str) -> Result<()> {
        platform_connection_remove(dir, id)?;
        self.secrets.delete(&account(id)).map_err(keychain)
    }

    pub async fn test(&self, dir: &Path, id: &str) -> Result<String> {
        let connection = self
            .list(dir)?
            .into_iter()
            .find(|connection| connection.id == id)
            .ok_or_else(|| {
                PlatformError::invalid(format!("there is no platform connection `{id}`"))
            })?;
        self.client(&connection)?.verify().await
    }

    pub fn match_repo(&self, dir: &Path, path: &Path) -> Result<Option<MatchedRepo>> {
        match_repository(dir, path)
    }

    pub fn require_repo(&self, dir: &Path, path: &Path) -> Result<MatchedRepo> {
        self.match_repo(dir, path)?.ok_or_else(|| {
            PlatformError::invalid("no platform connection matches this repository's remotes")
        })
    }

    pub async fn prs_list(
        &self,
        matched: &MatchedRepo,
        filter: PrFilter,
    ) -> Result<Vec<PullRequest>> {
        self.client(&matched.connection)?
            .list(&matched.repo, filter)
            .await
    }

    pub async fn pr_detail(&self, matched: &MatchedRepo, number: i64) -> Result<PrDetail> {
        self.client(&matched.connection)?
            .detail(&matched.repo, number)
            .await
    }

    pub async fn pr_create(
        &self,
        matched: &MatchedRepo,
        input: &CreatePull,
    ) -> Result<PullRequest> {
        self.client(&matched.connection)?
            .create(&matched.repo, input)
            .await
    }

    pub async fn pr_merge(&self, matched: &MatchedRepo, number: i64) -> Result<PullRequest> {
        self.client(&matched.connection)?
            .merge(&matched.repo, number)
            .await
    }

    fn client(&self, connection: &PlatformConnection) -> Result<Client> {
        let token = self
            .secrets
            .get(&account(&connection.id))
            .map_err(keychain)?
            .ok_or_else(|| PlatformError::AuthFailed {
                host: connection.host.clone(),
                detail: "no access token is stored for this connection".to_owned(),
            })?;
        Client::new(connection, &token)
    }
}
