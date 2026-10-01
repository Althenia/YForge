use thiserror::Error;
use yforge_core::CoreError;

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("Authentication failed for {host}")]
    AuthFailed { host: String, detail: String },
    #[error("{detail}")]
    NotFound { detail: String },
    #[error("{host} answered with HTTP {status}: {detail}")]
    Api {
        host: String,
        status: u16,
        detail: String,
    },
    #[error("Could not reach {host}: {detail}")]
    Network { host: String, detail: String },
    #[error("invalid request: {detail}")]
    Invalid { detail: String },
    #[error("the macOS Keychain refused the request: {detail}")]
    Keychain { detail: String },
    #[error(transparent)]
    Core(#[from] CoreError),
}

pub type Result<T> = std::result::Result<T, PlatformError>;

impl PlatformError {
    pub fn invalid(detail: impl Into<String>) -> Self {
        Self::Invalid {
            detail: detail.into(),
        }
    }

    /// The message a form shows for the field, without the error prefix.
    pub fn detail(&self) -> String {
        match self {
            PlatformError::Invalid { detail } => detail.clone(),
            other => other.to_string(),
        }
    }
}

impl From<PlatformError> for CoreError {
    fn from(error: PlatformError) -> Self {
        match error {
            PlatformError::AuthFailed { host, detail } => CoreError::AuthFailed {
                remote: host,
                detail,
            },
            PlatformError::NotFound { detail } => CoreError::NotFound { detail },
            PlatformError::Api {
                host,
                status,
                detail,
            } => CoreError::ApiError {
                host,
                status,
                detail,
            },
            PlatformError::Network { host, detail } => CoreError::Network { host, detail },
            PlatformError::Invalid { detail } => CoreError::InvalidRequest { detail },
            PlatformError::Keychain { detail } => CoreError::StorageFailed {
                path: "macOS Keychain".to_owned(),
                detail,
            },
            PlatformError::Core(error) => error,
        }
    }
}
