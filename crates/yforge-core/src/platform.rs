use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum PlatformKind {
    #[serde(rename = "github")]
    GitHub,
    #[serde(rename = "gitlab")]
    GitLab,
    #[serde(rename = "bitbucket")]
    Bitbucket,
}

impl PlatformKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GitHub => "github",
            Self::GitLab => "gitlab",
            Self::Bitbucket => "bitbucket",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        [Self::GitHub, Self::GitLab, Self::Bitbucket]
            .into_iter()
            .find(|kind| kind.as_str() == text)
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::GitHub => "GitHub",
            Self::GitLab => "GitLab",
            Self::Bitbucket => "Bitbucket",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PlatformConnection {
    pub id: String,
    pub kind: PlatformKind,
    pub host: String,
    pub name: String,
    pub insecure_tls: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PrState {
    Open,
    Merged,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PullRequest {
    pub number: i64,
    pub title: String,
    pub body: String,
    pub state: PrState,
    pub source_ref: String,
    pub target_ref: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub mergeable: Option<bool>,
    pub web_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PrFile {
    pub filename: String,
    pub status: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PrDetail {
    pub pull: PullRequest,
    pub files: Vec<PrFile>,
    pub files_total: Option<u32>,
    pub files_capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PullList {
    pub pulls: Vec<PullRequest>,
    pub total: Option<u32>,
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CreatePull {
    pub source_ref: String,
    pub target_ref: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MatchedRepo {
    pub connection: PlatformConnection,
    pub remote: String,
    pub repo: RepoRef,
}
