use thiserror::Error;
use yforge_core::CoreError;

#[derive(Debug, Error)]
pub enum AiError {
    #[error("no AI provider is ready: {detail}")]
    NotConfigured { detail: String },
    #[error("{provider} is unavailable: {detail}")]
    Unavailable { provider: String, detail: String },
    #[error("{provider} needs you to sign in or check its credentials")]
    AuthRequired { provider: String, detail: String },
    #[error("{provider} returned a response that cannot be used: {reason}")]
    InvalidResponse { provider: String, reason: String },
    #[error("{provider} failed to produce a response")]
    Failed { provider: String, output: String },
    #[error("{provider} did not answer within {seconds} seconds")]
    Timeout { provider: String, seconds: u32 },
    #[error("the operation was cancelled")]
    Cancelled,
    #[error("invalid request: {detail}")]
    Invalid { detail: String },
    #[error("the macOS Keychain refused the request: {detail}")]
    Keychain { detail: String },
    #[error(transparent)]
    Core(#[from] CoreError),
}

pub type Result<T> = std::result::Result<T, AiError>;

impl AiError {
    pub fn invalid(detail: impl Into<String>) -> Self {
        Self::Invalid {
            detail: detail.into(),
        }
    }

    /// The message a form shows for the field, without the error prefix.
    pub fn message(&self) -> String {
        match self {
            AiError::Invalid { detail } => detail.clone(),
            other => other.to_string(),
        }
    }
}

impl From<AiError> for CoreError {
    fn from(error: AiError) -> Self {
        match error {
            AiError::NotConfigured { detail } => CoreError::AiNotConfigured { detail },
            AiError::Unavailable { provider, detail } => {
                CoreError::AiProviderUnavailable { provider, detail }
            }
            AiError::AuthRequired { provider, detail } => {
                CoreError::AiAuthRequired { provider, detail }
            }
            AiError::InvalidResponse { provider, reason } => {
                CoreError::AiInvalidResponse { provider, reason }
            }
            AiError::Failed { provider, output } => CoreError::AiFailed { provider, output },
            AiError::Timeout { provider, seconds } => CoreError::AiTimeout { provider, seconds },
            AiError::Cancelled => CoreError::Cancelled,
            AiError::Invalid { detail } => CoreError::InvalidRequest { detail },
            AiError::Keychain { detail } => CoreError::StorageFailed {
                path: "macOS Keychain".to_owned(),
                detail,
            },
            AiError::Core(error) => error,
        }
    }
}
