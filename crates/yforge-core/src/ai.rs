use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::RecomposeGroup;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Chatgpt,
    ClaudeCode,
    Openrouter,
    OpenaiCompatible,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chatgpt => "chatgpt",
            Self::ClaudeCode => "claude_code",
            Self::Openrouter => "openrouter",
            Self::OpenaiCompatible => "openai_compatible",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        [
            Self::Chatgpt,
            Self::ClaudeCode,
            Self::Openrouter,
            Self::OpenaiCompatible,
        ]
        .into_iter()
        .find(|kind| kind.as_str() == text)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Chatgpt => "ChatGPT",
            Self::ClaudeCode => "Claude Code",
            Self::Openrouter => "OpenRouter",
            Self::OpenaiCompatible => "OpenAI-compatible",
        }
    }

    pub fn is_cli(self) -> bool {
        matches!(self, Self::Chatgpt | Self::ClaudeCode)
    }

    pub fn takes_api_key(self) -> bool {
        !self.is_cli()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub name: String,
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    #[ts(optional = nullable)]
    pub model: Option<String>,
    #[ts(optional = nullable)]
    pub executable_path: Option<String>,
    pub has_api_key: bool,
    pub created_at: i64,
}

#[derive(Clone, PartialEq, Eq, Deserialize, TS)]
pub struct ProviderInput {
    pub kind: ProviderKind,
    pub name: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub executable_path: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub api_key: Option<String>,
}

impl fmt::Debug for ProviderInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProviderInput")
            .field("kind", &self.kind)
            .field("name", &self.name)
            .field("base_url", &self.base_url)
            .field("executable_path", &self.executable_path)
            .field("api_key", &self.api_key.as_ref().map(|_| "<set>"))
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApiKeyChange {
    Keep,
    Set { key: String },
    Clear,
}

impl fmt::Debug for ApiKeyChange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Keep => f.write_str("Keep"),
            Self::Set { .. } => f.write_str("Set(<redacted>)"),
            Self::Clear => f.write_str("Clear"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS)]
pub struct ProviderUpdate {
    pub id: String,
    pub name: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub executable_path: Option<String>,
    pub api_key: ApiKeyChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProviderStatus {
    Ready,
    NotInstalled,
    SignedOut,
    KeyMissing,
    KeyRejected,
    Unreachable { message: String },
    CheckFailed { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ProviderSummary {
    pub config: ProviderConfig,
    pub status: ProviderStatus,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AiModel {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AiSignInMethod {
    Browser,
    DeviceCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiSignInStage {
    DeviceCode { url: String, code: String },
    Completed { status: ProviderStatus },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AiSignInEvent {
    pub operation: String,
    pub provider: String,
    pub stage: AiSignInStage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommitDraft {
    pub summary: String,
    pub description: String,
    pub summary_trimmed: bool,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct RecomposeProposal {
    pub groups: Vec<RecomposeGroup>,
    pub excluded: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ConflictRegionProposal {
    pub index: u32,
    pub text: String,
    pub rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ConflictProposal {
    pub regions: Vec<ConflictRegionProposal>,
}
