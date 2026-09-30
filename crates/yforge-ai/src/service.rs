use std::fmt;
use std::path::Path;
use std::sync::Arc;

use yforge_core::{
    ai_active_provider, ai_feature_config, ai_feature_config_reset, ai_feature_config_set,
    ai_feature_configs, ai_provider, ai_provider_add, ai_provider_delete, ai_provider_edit,
    ai_provider_key_flag, ai_providers, AiFeature, AiFeatureConfig, AiFeatureSummary,
    AiSignInMethod, AiSignInStage, ApiKeyChange, AuthMode, CancelToken, CommitContext, CommitDraft,
    ConflictFile, ConflictProposal, CoreError, ModelInfo, ProviderConfig, ProviderInput,
    ProviderKind, ProviderStatus, ProviderSummary, ProviderUpdate, RecomposePreview,
    RecomposeProposal,
};

use crate::endpoints::Endpoints;
use crate::error::{AiError, Result};
use crate::http::{status_of, validate_base_url};
use crate::limits::Limits;
use crate::prompt::{default_template, render, validate_template};
use crate::providers::{self, Access, Connection};
use crate::secret::{oauth_account, SecretStore, CLAUDE_CODE_SERVICE};
use crate::{chatgpt, claude_code, commit, conflict, recompose};

const NAME_LIMIT: usize = 80;

pub struct Selection {
    pub config: ProviderConfig,
    pub model: String,
    template: String,
    connection: Connection,
}

impl fmt::Debug for Selection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Selection")
            .field("config", &self.config)
            .field("model", &self.model)
            .finish_non_exhaustive()
    }
}

pub struct Ai {
    secrets: Arc<dyn SecretStore>,
    claude_code: Arc<dyn SecretStore>,
    limits: Limits,
    endpoints: Endpoints,
}

struct Normalized {
    name: String,
    base_url: Option<String>,
}

fn blank_to_none(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|text| !text.is_empty())
}

fn normalize(
    kind: ProviderKind,
    auth_mode: AuthMode,
    name: &str,
    base_url: Option<&str>,
) -> Result<Normalized> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > NAME_LIMIT || name.chars().any(char::is_control) {
        return Err(AiError::invalid(format!(
            "the provider name must be 1 to {NAME_LIMIT} characters"
        )));
    }
    if auth_mode == AuthMode::Subscription && !kind.supports_subscription() {
        return Err(AiError::invalid(format!(
            "{} takes an API key only",
            kind.label()
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
    Ok(Normalized {
        name: name.to_owned(),
        base_url,
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

fn sign_in_first(provider: &str, product: &str) -> AiError {
    AiError::AuthRequired {
        provider: provider.to_owned(),
        detail: format!("Sign in to {product} first"),
    }
}

impl Ai {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self {
            secrets,
            claude_code: Arc::new(crate::secret::ClaudeCodeKeychain),
            limits: Limits::default(),
            endpoints: Endpoints::default(),
        }
    }

    pub fn with_claude_code_store(mut self, store: Arc<dyn SecretStore>) -> Self {
        self.claude_code = store;
        self
    }

    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    pub fn with_endpoints(mut self, endpoints: Endpoints) -> Self {
        self.endpoints = endpoints;
        self
    }

    async fn secret_write(&self, account: &str, value: Option<&str>) -> Result<()> {
        let secrets = Arc::clone(&self.secrets);
        let account = account.to_owned();
        let value = value.map(str::to_owned);
        blocking(move || {
            match value {
                Some(value) => secrets.set(&account, &value),
                None => secrets.delete(&account),
            }
            .map_err(|error| AiError::Keychain { detail: error.0 })
        })
        .await
    }

    async fn secret_read(&self, account: &str) -> Result<Option<String>> {
        read_from(Arc::clone(&self.secrets), account).await
    }

    async fn find(&self, dir: &Path, id: &str) -> Result<ProviderConfig> {
        let (dir, id) = (dir.to_owned(), id.to_owned());
        blocking(move || core(ai_provider(&dir, &id))).await
    }

    fn base_url(&self, config: &ProviderConfig) -> String {
        match (config.kind, config.auth_mode) {
            (ProviderKind::Chatgpt, AuthMode::ApiKey) => self.endpoints.openai_api.clone(),
            (ProviderKind::Chatgpt, AuthMode::Subscription) => {
                self.endpoints.chatgpt_backend.clone()
            }
            (ProviderKind::Claude, _) => self.endpoints.anthropic_api.clone(),
            (ProviderKind::Openrouter, _) => self.endpoints.openrouter_api.clone(),
            (ProviderKind::OpenaiCompatible, _) => config.base_url.clone().unwrap_or_default(),
        }
    }

    async fn chatgpt_tokens(&self, config: &ProviderConfig) -> Result<Option<chatgpt::Tokens>> {
        let stored = self.secret_read(&oauth_account(&config.id)).await?;
        Ok(stored.and_then(|text| serde_json::from_str(&text).ok()))
    }

    async fn store_json<T: serde::Serialize>(
        &self,
        config: &ProviderConfig,
        value: &T,
    ) -> Result<()> {
        let text = serde_json::to_string(value).map_err(|error| AiError::Keychain {
            detail: error.to_string(),
        })?;
        self.secret_write(&oauth_account(&config.id), Some(&text))
            .await
    }

    async fn claude_credentials(
        &self,
        config: &ProviderConfig,
    ) -> Result<Option<claude_code::Credentials>> {
        let cached = self
            .secret_read(&oauth_account(&config.id))
            .await?
            .and_then(|text| serde_json::from_str(&text).ok());
        let external = read_from(Arc::clone(&self.claude_code), CLAUDE_CODE_SERVICE)
            .await?
            .and_then(|text| claude_code::parse(&text));
        Ok(claude_code::freshest(cached, external))
    }

    async fn access(&self, config: &ProviderConfig) -> Result<Access> {
        match (config.auth_mode, config.kind) {
            (AuthMode::ApiKey, kind) => {
                let key = if config.has_api_key {
                    self.secret_read(&config.id).await?
                } else {
                    None
                };
                match (key, kind) {
                    (Some(key), _) => Ok(Access::Key(key)),
                    (None, ProviderKind::OpenaiCompatible) => Ok(Access::Anonymous),
                    (None, _) => Err(AiError::AuthRequired {
                        provider: config.name.clone(),
                        detail: "no API key is stored in the Keychain".to_owned(),
                    }),
                }
            }
            (AuthMode::Subscription, ProviderKind::Chatgpt) => {
                let mut tokens = self
                    .chatgpt_tokens(config)
                    .await?
                    .ok_or_else(|| sign_in_first(&config.name, "ChatGPT"))?;
                if tokens.expired(now_ms()) {
                    tokens = chatgpt::refresh(&self.endpoints.openai_auth, &tokens, &self.limits)
                        .await?;
                    self.store_json(config, &tokens).await?;
                }
                Ok(Access::Subscription {
                    token: tokens.access,
                    account_id: tokens.account_id,
                })
            }
            (AuthMode::Subscription, ProviderKind::Claude) => {
                let mut credentials = self
                    .claude_credentials(config)
                    .await?
                    .ok_or_else(claude_code::auth_required)?;
                if credentials.expired(now_ms()) {
                    credentials = claude_code::refresh(
                        &self.endpoints.claude_token,
                        &credentials,
                        now_ms(),
                        &self.limits,
                    )
                    .await?;
                    self.store_json(config, &credentials).await?;
                }
                Ok(Access::Subscription {
                    token: credentials.access_token,
                    account_id: None,
                })
            }
            (AuthMode::Subscription, _) => Err(AiError::invalid(format!(
                "{} takes an API key only",
                config.kind.label()
            ))),
        }
    }

    async fn connection(&self, config: &ProviderConfig) -> Result<Connection> {
        Ok(Connection {
            label: config.name.clone(),
            kind: config.kind,
            mode: config.auth_mode,
            base_url: self.base_url(config),
            access: self.access(config).await?,
        })
    }

    async fn signed_in(&self, config: &ProviderConfig) -> Result<bool> {
        match config.kind {
            ProviderKind::Chatgpt => Ok(self.chatgpt_tokens(config).await?.is_some()),
            _ => Ok(self.claude_credentials(config).await?.is_some()),
        }
    }

    async fn configured_status(&self, config: &ProviderConfig) -> ProviderStatus {
        match config.auth_mode {
            AuthMode::ApiKey
                if !config.has_api_key && config.kind != ProviderKind::OpenaiCompatible =>
            {
                ProviderStatus::KeyMissing
            }
            AuthMode::ApiKey => ProviderStatus::Ready,
            AuthMode::Subscription => match self.signed_in(config).await {
                Ok(true) => ProviderStatus::Ready,
                Ok(false) => ProviderStatus::SignedOut,
                Err(error) => ProviderStatus::CheckFailed {
                    message: error.to_string(),
                },
            },
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
            let active = active.as_deref() == Some(config.id.as_str());
            summaries.push(ProviderSummary {
                config,
                status,
                active,
            });
        }
        Ok(summaries)
    }

    async fn summary_of(&self, dir: &Path, id: &str) -> Result<ProviderSummary> {
        let config = self.find(dir, id).await?;
        let owned = dir.to_owned();
        let active = blocking(move || core(ai_active_provider(&owned))).await?;
        let status = self.configured_status(&config).await;
        let active = active.as_deref() == Some(config.id.as_str());
        Ok(ProviderSummary {
            config,
            status,
            active,
        })
    }

    pub async fn add(&self, dir: &Path, input: ProviderInput) -> Result<ProviderSummary> {
        let normalized = normalize(
            input.kind,
            input.auth_mode,
            &input.name,
            input.base_url.as_deref(),
        )?;
        let key = blank_to_none(input.api_key.as_deref()).map(str::to_owned);
        if key.is_some() && input.auth_mode == AuthMode::Subscription {
            return Err(AiError::invalid("subscription providers take no API key"));
        }
        let owned = dir.to_owned();
        let (kind, auth_mode) = (input.kind, input.auth_mode);
        let config = blocking(move || {
            core(ai_provider_add(
                &owned,
                kind,
                auth_mode,
                &normalized.name,
                normalized.base_url.as_deref(),
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
            update.auth_mode,
            &update.name,
            update.base_url.as_deref(),
        )?;
        if !matches!(update.api_key, ApiKeyChange::Keep)
            && update.auth_mode == AuthMode::Subscription
        {
            return Err(AiError::invalid("subscription providers take no API key"));
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
        let auth_mode = update.auth_mode;
        blocking(move || {
            core(ai_provider_edit(
                &owned,
                &id,
                auth_mode,
                &normalized.name,
                normalized.base_url.as_deref(),
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
        self.secret_write(&config.id, None).await?;
        self.secret_write(&oauth_account(&config.id), None).await?;
        let (owned, id) = (dir.to_owned(), config.id);
        blocking(move || core(ai_provider_delete(&owned, &id))).await
    }

    pub async fn test(&self, dir: &Path, id: &str) -> Result<ProviderStatus> {
        let config = self.find(dir, id).await?;
        let subscription = config.auth_mode == AuthMode::Subscription;
        let result = match self.connection(&config).await {
            Ok(connection) => providers::models(&connection, &self.limits).await,
            Err(error) => Err(error),
        };
        Ok(match (status_of(result), subscription) {
            (ProviderStatus::KeyRejected, true) => ProviderStatus::SignedOut,
            (ProviderStatus::KeyRejected, false)
                if !config.has_api_key && config.kind != ProviderKind::OpenaiCompatible =>
            {
                ProviderStatus::KeyMissing
            }
            (status, _) => status,
        })
    }

    pub async fn models(&self, dir: &Path, id: &str) -> Result<Vec<ModelInfo>> {
        let config = self.find(dir, id).await?;
        providers::models(&self.connection(&config).await?, &self.limits).await
    }

    pub async fn feature_configs(&self, dir: &Path) -> Result<Vec<AiFeatureSummary>> {
        let owned = dir.to_owned();
        let stored = blocking(move || core(ai_feature_configs(&owned))).await?;
        Ok(AiFeature::ALL
            .into_iter()
            .map(|feature| summary_of_feature(feature, &stored))
            .collect())
    }

    pub async fn set_feature(
        &self,
        dir: &Path,
        config: AiFeatureConfig,
    ) -> Result<AiFeatureSummary> {
        validate_template(&config.prompt_template).map_err(AiError::invalid)?;
        let model_id = config.model_id.trim().to_owned();
        if model_id.is_empty() {
            return Err(AiError::invalid("choose a model"));
        }
        let provider = self.find(dir, &config.provider_id).await?;
        let offered = self.models(dir, &provider.id).await?;
        if !offered.iter().any(|model| model.id == model_id) {
            return Err(AiError::invalid(format!(
                "{} does not offer the model `{model_id}`",
                provider.name
            )));
        }
        let saved = AiFeatureConfig { model_id, ..config };
        let (owned, feature) = (dir.to_owned(), saved.feature);
        blocking(move || core(ai_feature_config_set(&owned, &saved))).await?;
        let owned = dir.to_owned();
        let stored = blocking(move || core(ai_feature_configs(&owned))).await?;
        Ok(summary_of_feature(feature, &stored))
    }

    pub async fn reset_feature(&self, dir: &Path, feature: AiFeature) -> Result<AiFeatureSummary> {
        let owned = dir.to_owned();
        blocking(move || core(ai_feature_config_reset(&owned, feature))).await?;
        Ok(summary_of_feature(feature, &[]))
    }

    pub async fn resolve(&self, dir: &Path, feature: AiFeature) -> Result<Selection> {
        let owned = dir.to_owned();
        let (configured, active) = blocking(move || {
            Ok((
                core(ai_feature_config(&owned, feature))?,
                core(ai_active_provider(&owned))?,
            ))
        })
        .await?;
        let (provider_id, model, template) = match configured {
            Some(saved) => (
                saved.provider_id,
                Some(saved.model_id),
                saved.prompt_template,
            ),
            None => {
                let Some(id) = active else {
                    return Err(AiError::NotConfigured {
                        detail: "choose an AI provider in the settings".to_owned(),
                    });
                };
                (id, None, default_template(feature).to_owned())
            }
        };
        let config = self.find(dir, &provider_id).await?;
        let model = model
            .or_else(|| config.model.clone())
            .filter(|model| !model.trim().is_empty())
            .ok_or_else(|| AiError::NotConfigured {
                detail: format!("choose a model for {}", config.name),
            })?;
        let connection = self.connection(&config).await?;
        Ok(Selection {
            config,
            model,
            template,
            connection,
        })
    }

    async fn complete(
        &self,
        selection: &Selection,
        context: &str,
        cancel: &CancelToken,
    ) -> Result<String> {
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled);
        }
        providers::complete(
            &selection.connection,
            &selection.model,
            &render(&selection.template, context),
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
            .complete(selection, &commit::context_text(context), cancel)
            .await?;
        commit::parse(&selection.config.name, &reply, context)
    }

    pub async fn recompose(
        &self,
        selection: &Selection,
        preview: &RecomposePreview,
        cancel: &CancelToken,
    ) -> Result<RecomposeProposal> {
        let built = recompose::context_text(preview);
        let reply = self.complete(selection, &built.text, cancel).await?;
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
        let context = conflict::context_text(file)?;
        let reply = self.complete(selection, &context, cancel).await?;
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
        if config.auth_mode != AuthMode::Subscription {
            return Err(AiError::invalid("only subscription providers sign in"));
        }
        match config.kind {
            ProviderKind::Chatgpt => {
                let tokens = match method {
                    AiSignInMethod::Browser => {
                        chatgpt::sign_in_browser(
                            &self.endpoints.openai_auth,
                            self.endpoints.callback_port,
                            &self.limits,
                            cancel,
                            &|url| {
                                on_stage(AiSignInStage::Browser {
                                    url: url.to_owned(),
                                })
                            },
                        )
                        .await?
                    }
                    AiSignInMethod::DeviceCode => {
                        chatgpt::sign_in_device(
                            &self.endpoints.openai_auth,
                            &self.limits,
                            cancel,
                            &|url, code| {
                                on_stage(AiSignInStage::DeviceCode {
                                    url: url.to_owned(),
                                    code: code.to_owned(),
                                });
                            },
                        )
                        .await?
                    }
                };
                self.store_json(&config, &tokens).await?;
            }
            _ => {
                self.access(&config).await?;
            }
        }
        let status = ProviderStatus::Ready;
        on_stage(AiSignInStage::Completed {
            status: status.clone(),
        });
        Ok(status)
    }
}

async fn read_from(store: Arc<dyn SecretStore>, account: &str) -> Result<Option<String>> {
    let account = account.to_owned();
    blocking(move || {
        store
            .get(&account)
            .map_err(|error| AiError::Keychain { detail: error.0 })
    })
    .await
}

fn summary_of_feature(feature: AiFeature, stored: &[AiFeatureConfig]) -> AiFeatureSummary {
    AiFeatureSummary {
        feature,
        config: stored
            .iter()
            .find(|saved| saved.feature == feature)
            .cloned(),
        default_prompt_template: default_template(feature).to_owned(),
    }
}
