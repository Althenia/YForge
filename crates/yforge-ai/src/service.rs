use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use yforge_core::{
    ai_active_provider, ai_provider, ai_provider_add, ai_provider_delete, ai_provider_edit,
    ai_provider_key_flag, ai_providers, AiModel, AiSignInMethod, AiSignInStage, ApiKeyChange,
    CancelToken, CommitContext, CommitDraft, ConflictFile, ConflictProposal, CoreError,
    ProviderConfig, ProviderInput, ProviderKind, ProviderStatus, ProviderSummary, ProviderUpdate,
    RecomposePreview, RecomposeProposal,
};

use crate::discovery::{locate, Environment};
use crate::error::{AiError, Result};
use crate::http::{self, validate_base_url, Endpoint};
use crate::limits::Limits;
use crate::prompt::Prompt;
use crate::secret::SecretStore;
use crate::{cli, commit, conflict, login, recompose};

pub const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1";
const NAME_LIMIT: usize = 80;

pub struct Selection {
    pub config: ProviderConfig,
    api_key: Option<String>,
}

impl fmt::Debug for Selection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Selection")
            .field("config", &self.config)
            .field("api_key", &self.api_key.as_ref().map(|_| "<set>"))
            .finish()
    }
}

pub struct Ai {
    secrets: Arc<dyn SecretStore>,
    environment: Environment,
    limits: Limits,
    openrouter_url: String,
}

struct Normalized {
    name: String,
    base_url: Option<String>,
    executable_path: Option<String>,
}

fn blank_to_none(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|text| !text.is_empty())
}

fn normalize(
    kind: ProviderKind,
    name: &str,
    base_url: Option<&str>,
    executable_path: Option<&str>,
) -> Result<Normalized> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > NAME_LIMIT || name.chars().any(char::is_control) {
        return Err(AiError::invalid(format!(
            "the provider name must be 1 to {NAME_LIMIT} characters"
        )));
    }
    let base_url = match (kind, blank_to_none(base_url)) {
        (ProviderKind::OpenaiCompatible, Some(url)) => Some(validate_base_url(url)?),
        (ProviderKind::OpenaiCompatible, None) => {
            return Err(AiError::invalid(
                "an OpenAI-compatible provider needs a base URL",
            ))
        }
        (_, Some(_)) => {
            return Err(AiError::invalid(
                "only OpenAI-compatible providers take a base URL",
            ))
        }
        (_, None) => None,
    };
    let executable_path =
        match (kind.is_cli(), blank_to_none(executable_path)) {
            (true, Some(path)) if !Path::new(path).is_absolute() => return Err(AiError::invalid(
                "the executable path must be absolute; leave it empty to search for the command",
            )),
            (true, path) => path.map(str::to_owned),
            (false, Some(_)) => {
                return Err(AiError::invalid(
                    "only command-line providers take an executable path",
                ))
            }
            (false, None) => None,
        };
    Ok(Normalized {
        name: name.to_owned(),
        base_url,
        executable_path,
    })
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|_| AiError::Failed {
            provider: "AI".to_owned(),
            output: "a background task failed".to_owned(),
        })?
}

fn core<T>(result: std::result::Result<T, CoreError>) -> Result<T> {
    result.map_err(AiError::Core)
}

impl Ai {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            secrets,
            environment: Environment::system(),
            limits: Limits::default(),
            openrouter_url: OPENROUTER_URL.to_owned(),
        }
    }

    pub fn with_environment(mut self, environment: Environment) -> Self {
        self.environment = environment;
        self
    }

    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    pub fn with_openrouter_url(mut self, url: &str) -> Self {
        self.openrouter_url = url.to_owned();
        self
    }

    async fn secret_write(&self, account: &str, key: Option<&str>) -> Result<()> {
        let secrets = Arc::clone(&self.secrets);
        let account = account.to_owned();
        let key = key.map(str::to_owned);
        blocking(move || {
            match key {
                Some(key) => secrets.set(&account, &key),
                None => secrets.delete(&account),
            }
            .map_err(|error| AiError::Keychain { detail: error.0 })
        })
        .await
    }

    async fn secret_read(&self, account: &str) -> Result<Option<String>> {
        let secrets = Arc::clone(&self.secrets);
        let account = account.to_owned();
        blocking(move || {
            secrets
                .get(&account)
                .map_err(|error| AiError::Keychain { detail: error.0 })
        })
        .await
    }

    async fn find(&self, dir: &Path, id: &str) -> Result<ProviderConfig> {
        let (dir, id) = (dir.to_owned(), id.to_owned());
        blocking(move || core(ai_provider(&dir, &id))).await
    }

    async fn binary(&self, config: &ProviderConfig) -> std::result::Result<PathBuf, String> {
        locate(
            &self.environment,
            cli::binary_name(config.kind),
            config.executable_path.as_deref(),
            self.limits.discovery,
        )
        .await
    }

    async fn cli_status(&self, config: &ProviderConfig) -> ProviderStatus {
        match self.binary(config).await {
            Ok(binary) => cli::status(config.kind, &binary, &self.limits).await,
            Err(message) if config.executable_path.is_some() => {
                ProviderStatus::CheckFailed { message }
            }
            Err(_) => ProviderStatus::NotInstalled,
        }
    }

    fn summary(config: ProviderConfig, status: ProviderStatus, active: bool) -> ProviderSummary {
        ProviderSummary {
            config,
            status,
            active,
        }
    }

    async fn configured_status(&self, config: &ProviderConfig) -> ProviderStatus {
        match config.kind {
            ProviderKind::Chatgpt | ProviderKind::ClaudeCode => self.cli_status(config).await,
            ProviderKind::Openrouter if !config.has_api_key => ProviderStatus::KeyMissing,
            ProviderKind::Openrouter | ProviderKind::OpenaiCompatible => ProviderStatus::Ready,
        }
    }

    pub async fn list(&self, dir: &Path) -> Result<Vec<ProviderSummary>> {
        let owned = dir.to_owned();
        let (configs, active) = blocking(move || {
            Ok((
                core(ai_providers(&owned))?,
                core(ai_active_provider(&owned))?,
            ))
        })
        .await?;
        let mut summaries = Vec::with_capacity(configs.len());
        for config in configs {
            let status = self.configured_status(&config).await;
            let is_active = active.as_deref() == Some(config.id.as_str());
            summaries.push(Self::summary(config, status, is_active));
        }
        Ok(summaries)
    }

    async fn summary_of(&self, dir: &Path, id: &str) -> Result<ProviderSummary> {
        let config = self.find(dir, id).await?;
        let owned = dir.to_owned();
        let active = blocking(move || core(ai_active_provider(&owned))).await?;
        let status = self.configured_status(&config).await;
        let is_active = active.as_deref() == Some(config.id.as_str());
        Ok(Self::summary(config, status, is_active))
    }

    pub async fn add(&self, dir: &Path, input: ProviderInput) -> Result<ProviderSummary> {
        let normalized = normalize(
            input.kind,
            &input.name,
            input.base_url.as_deref(),
            input.executable_path.as_deref(),
        )?;
        let key = blank_to_none(input.api_key.as_deref()).map(str::to_owned);
        if key.is_some() && !input.kind.takes_api_key() {
            return Err(AiError::invalid("command-line providers take no API key"));
        }
        let owned = dir.to_owned();
        let kind = input.kind;
        let config = blocking(move || {
            core(ai_provider_add(
                &owned,
                kind,
                &normalized.name,
                normalized.base_url.as_deref(),
                normalized.executable_path.as_deref(),
            ))
        })
        .await?;
        if let Some(key) = key {
            let stored = self.secret_write(&config.id, Some(&key)).await;
            let owned = dir.to_owned();
            let id = config.id.clone();
            let flagged = match stored {
                Ok(()) => blocking(move || core(ai_provider_key_flag(&owned, &id, true))).await,
                Err(error) => Err(error),
            };
            if let Err(error) = flagged {
                let owned = dir.to_owned();
                let id = config.id.clone();
                let _ = blocking(move || core(ai_provider_delete(&owned, &id))).await;
                let _ = self.secret_write(&config.id, None).await;
                return Err(error);
            }
        }
        self.summary_of(dir, &config.id).await
    }

    pub async fn update(&self, dir: &Path, update: ProviderUpdate) -> Result<ProviderSummary> {
        let existing = self.find(dir, &update.id).await?;
        let normalized = normalize(
            existing.kind,
            &update.name,
            update.base_url.as_deref(),
            update.executable_path.as_deref(),
        )?;
        if !matches!(update.api_key, ApiKeyChange::Keep) && !existing.kind.takes_api_key() {
            return Err(AiError::invalid("command-line providers take no API key"));
        }
        let flag = match &update.api_key {
            ApiKeyChange::Keep => None,
            ApiKeyChange::Set { key } => {
                let key = key.trim();
                if key.is_empty() {
                    return Err(AiError::invalid("the API key is empty"));
                }
                self.secret_write(&existing.id, Some(key)).await?;
                Some(true)
            }
            ApiKeyChange::Clear => {
                self.secret_write(&existing.id, None).await?;
                Some(false)
            }
        };
        let owned = dir.to_owned();
        let id = existing.id.clone();
        blocking(move || {
            core(ai_provider_edit(
                &owned,
                &id,
                &normalized.name,
                normalized.base_url.as_deref(),
                normalized.executable_path.as_deref(),
            ))?;
            match flag {
                Some(flag) => core(ai_provider_key_flag(&owned, &id, flag)),
                None => Ok(()),
            }
        })
        .await?;
        self.summary_of(dir, &existing.id).await
    }

    pub async fn remove(&self, dir: &Path, id: &str) -> Result<()> {
        let config = self.find(dir, id).await?;
        if config.kind.takes_api_key() {
            self.secret_write(&config.id, None).await?;
        }
        let (owned, id) = (dir.to_owned(), config.id);
        blocking(move || core(ai_provider_delete(&owned, &id))).await
    }

    fn endpoint<'a>(
        &'a self,
        config: &'a ProviderConfig,
        api_key: Option<&'a str>,
    ) -> Endpoint<'a> {
        Endpoint {
            label: &config.name,
            base_url: match config.kind {
                ProviderKind::Openrouter => &self.openrouter_url,
                _ => config.base_url.as_deref().unwrap_or_default(),
            },
            api_key,
        }
    }

    pub async fn test(&self, dir: &Path, id: &str) -> Result<ProviderStatus> {
        let config = self.find(dir, id).await?;
        if config.kind.is_cli() {
            return Ok(self.cli_status(&config).await);
        }
        let key = self.secret_read(&config.id).await?;
        if config.kind == ProviderKind::Openrouter && key.is_none() {
            return Ok(ProviderStatus::KeyMissing);
        }
        Ok(http::check(&self.endpoint(&config, key.as_deref()), &self.limits).await)
    }

    pub async fn models(&self, dir: &Path, id: &str) -> Result<Vec<AiModel>> {
        let config = self.find(dir, id).await?;
        if config.kind.is_cli() {
            return Ok(Vec::new());
        }
        let key = self.secret_read(&config.id).await?;
        http::models(&self.endpoint(&config, key.as_deref()), &self.limits).await
    }

    pub async fn resolve(&self, dir: &Path) -> Result<Selection> {
        let owned = dir.to_owned();
        let active = blocking(move || core(ai_active_provider(&owned))).await?;
        let Some(id) = active else {
            return Err(AiError::NotConfigured {
                detail: "choose an AI provider in the settings".to_owned(),
            });
        };
        let config = self.find(dir, &id).await?;
        if !config.kind.is_cli() && blank_to_none(config.model.as_deref()).is_none() {
            return Err(AiError::NotConfigured {
                detail: format!("choose a model for {}", config.name),
            });
        }
        let api_key = if config.kind.takes_api_key() && config.has_api_key {
            self.secret_read(&config.id).await?
        } else {
            None
        };
        if config.kind == ProviderKind::Openrouter && api_key.is_none() {
            return Err(AiError::AuthRequired {
                provider: config.name,
                detail: "no API key is stored in the Keychain".to_owned(),
            });
        }
        Ok(Selection { config, api_key })
    }

    async fn complete(
        &self,
        selection: &Selection,
        prompt: &Prompt,
        cancel: &CancelToken,
    ) -> Result<String> {
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        let config = &selection.config;
        if config.kind.is_cli() {
            let binary = self
                .binary(config)
                .await
                .map_err(|detail| AiError::Unavailable {
                    provider: config.name.clone(),
                    detail,
                })?;
            return cli::complete(
                config.kind,
                &config.name,
                &binary,
                config.model.as_deref(),
                prompt,
                &self.limits,
                cancel,
            )
            .await;
        }
        let model = blank_to_none(config.model.as_deref()).unwrap_or_default();
        http::complete(
            &self.endpoint(config, selection.api_key.as_deref()),
            model,
            prompt,
            &self.limits,
            cancel,
        )
        .await
    }

    pub async fn commit_message(
        &self,
        selection: &Selection,
        context: &CommitContext,
        cancel: &CancelToken,
    ) -> Result<CommitDraft> {
        let reply = self
            .complete(selection, &commit::prompt(context), cancel)
            .await?;
        commit::parse(&selection.config.name, &reply, context)
    }

    pub async fn recompose(
        &self,
        selection: &Selection,
        preview: &RecomposePreview,
        cancel: &CancelToken,
    ) -> Result<RecomposeProposal> {
        let built = recompose::prompt(preview);
        let reply = self.complete(selection, &built.prompt, cancel).await?;
        Ok(RecomposeProposal {
            groups: recompose::parse(&selection.config.name, &reply, preview)?,
            excluded: built.excluded,
        })
    }

    pub async fn conflict(
        &self,
        selection: &Selection,
        file: &ConflictFile,
        cancel: &CancelToken,
    ) -> Result<ConflictProposal> {
        let prompt = conflict::prompt(file)?;
        let reply = self.complete(selection, &prompt, cancel).await?;
        conflict::parse(&selection.config.name, &reply, conflict::region_count(file))
    }

    pub async fn sign_in(
        &self,
        dir: &Path,
        id: &str,
        method: AiSignInMethod,
        cancel: &CancelToken,
        on_stage: &(dyn Fn(AiSignInStage) + Send + Sync),
    ) -> Result<ProviderStatus> {
        let config = self.find(dir, id).await?;
        if !config.kind.is_cli() {
            return Err(AiError::invalid("only command-line providers sign in here"));
        }
        let binary = self
            .binary(&config)
            .await
            .map_err(|detail| AiError::Unavailable {
                provider: config.name.clone(),
                detail,
            })?;
        login::sign_in(
            config.kind,
            &config.name,
            &binary,
            method,
            &self.limits,
            cancel,
            &|url, code| {
                on_stage(AiSignInStage::DeviceCode {
                    url: url.to_owned(),
                    code: code.to_owned(),
                });
            },
        )
        .await?;
        let status = cli::status(config.kind, &binary, &self.limits).await;
        on_stage(AiSignInStage::Completed {
            status: status.clone(),
        });
        Ok(status)
    }
}
