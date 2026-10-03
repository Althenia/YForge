use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::RecomposeGroup;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Chatgpt,
    Claude,
    Openrouter,
    OpenaiCompatible,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chatgpt => "chatgpt",
            Self::Claude => "claude",
            Self::Openrouter => "openrouter",
            Self::OpenaiCompatible => "openai_compatible",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        [
            Self::Chatgpt,
            Self::Claude,
            Self::Openrouter,
            Self::OpenaiCompatible,
        ]
        .into_iter()
        .find(|kind| kind.as_str() == text)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Chatgpt => "ChatGPT",
            Self::Claude => "Claude",
            Self::Openrouter => "OpenRouter",
            Self::OpenaiCompatible => "OpenAI-compatible",
        }
    }

    pub fn supports_subscription(self) -> bool {
        matches!(self, Self::Chatgpt | Self::Claude)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    #[default]
    ApiKey,
    Subscription,
}

impl AuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ApiKey => "api_key",
            Self::Subscription => "subscription",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        [Self::ApiKey, Self::Subscription]
            .into_iter()
            .find(|mode| mode.as_str() == text)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ProviderConfig {
    pub id: String,
    pub kind: ProviderKind,
    pub auth_mode: AuthMode,
    pub name: String,
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    pub has_api_key: bool,
    pub created_at: i64,
}

#[derive(Clone, PartialEq, Eq, Deserialize, TS)]
pub struct ProviderInput {
    pub kind: ProviderKind,
    #[serde(default)]
    pub auth_mode: AuthMode,
    pub name: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub api_key: Option<String>,
}

impl fmt::Debug for ProviderInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProviderInput")
            .field("kind", &self.kind)
            .field("auth_mode", &self.auth_mode)
            .field("name", &self.name)
            .field("base_url", &self.base_url)
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
    pub auth_mode: AuthMode,
    pub name: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub base_url: Option<String>,
    pub api_key: ApiKeyChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProviderStatus {
    Ready,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    #[ts(optional = nullable)]
    pub context_window: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AiFeature {
    GenerateCommit,
    Recompose,
    ConflictFix,
    ExplainChanges,
    ExplainCommit,
    ComposeCommits,
    StashMessage,
}

impl AiFeature {
    pub const ALL: [Self; 7] = [
        Self::GenerateCommit,
        Self::Recompose,
        Self::ConflictFix,
        Self::ExplainChanges,
        Self::ExplainCommit,
        Self::ComposeCommits,
        Self::StashMessage,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::GenerateCommit => "generate_commit",
            Self::Recompose => "recompose",
            Self::ConflictFix => "conflict_fix",
            Self::ExplainChanges => "explain_changes",
            Self::ExplainCommit => "explain_commit",
            Self::ComposeCommits => "compose_commits",
            Self::StashMessage => "stash_message",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|feature| feature.as_str() == text)
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::GenerateCommit => "Generate commit message",
            Self::Recompose => "Propose with AI in Recompose",
            Self::ConflictFix => "Propose conflict resolution",
            Self::ExplainChanges => "Explain changes",
            Self::ExplainCommit => "Explain commit",
            Self::ComposeCommits => "Compose commits",
            Self::StashMessage => "Generate stash message",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AiFeatureConfig {
    pub feature: AiFeature,
    pub provider_id: String,
    pub model_id: String,
    pub prompt_template: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct AiFeatureSummary {
    pub feature: AiFeature,
    #[ts(optional = nullable)]
    pub config: Option<AiFeatureConfig>,
    pub enabled: bool,
    pub available: bool,
    pub default_prompt_template: String,
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
    Browser { url: String },
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ExplanationItem {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct Explanation {
    pub items: Vec<ExplanationItem>,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ComposeGroup {
    pub message: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ComposeProposal {
    pub groups: Vec<ComposeGroup>,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct StashDraft {
    pub summary: String,
    pub description: String,
    pub excluded: Vec<String>,
    pub truncated: Vec<String>,
}
