mod chatgpt;
mod claude_code;
mod commit;
mod conflict;
mod encoding;
mod endpoints;
mod error;
mod http;
mod json;
mod limits;
mod prompt;
mod providers;
mod recompose;
mod secret;
mod service;
mod text;

pub use endpoints::Endpoints;
pub use error::{AiError, Result};
pub use limits::Limits;
pub use secret::{
    ClaudeCodeKeychain, KeychainStore, MemoryStore, SecretError, SecretStore, CLAUDE_CODE_SERVICE,
    KEYCHAIN_SERVICE,
};
pub use service::{Ai, Selection};
