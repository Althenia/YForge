use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    NotARepository,
    AlreadyARepository,
    GitMissing,
    GitTooOld,
    GitFailed,
    InvalidGitOutput,
    InvalidRequest,
    StaleHunk,
    CommitFailed,
    WatchFailed,
    StorageFailed,
    AuthFailed,
    Cancelled,
    LocalChanges,
    PushRejected,
    NotFastForward,
    ConflictMarkers,
    UnmergedBranch,
    WhitespaceIgnored,
    WorktreeDirty,
    BranchInWorktree,
    OperationInProgress,
    NotHead,
    MergeCommitInRange,
    SnapshotFailed,
    FileTooLarge,
    AiNotConfigured,
    AiProviderUnavailable,
    AiAuthRequired,
    AiInvalidResponse,
    AiFailed,
    AiTimeout,
    NotFound,
    ApiError,
    Network,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ErrorPayload {
    pub kind: ErrorKind,
    pub message: String,
    pub output: Option<String>,
}

impl ErrorPayload {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Internal,
            message: message.into(),
            output: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    NotARepository {
        path: String,
    },
    AlreadyARepository {
        path: String,
    },
    GitMissing,
    GitTooOld {
        found: String,
        required: String,
    },
    GitFailed {
        command: String,
        status: Option<i32>,
        stderr: String,
    },
    InvalidGitOutput {
        command: String,
        detail: String,
    },
    InvalidRequest {
        detail: String,
    },
    StaleHunk {
        file: String,
        detail: String,
    },
    CommitFailed {
        status: Option<i32>,
        output: String,
    },
    WatchFailed {
        detail: String,
    },
    StorageFailed {
        path: String,
        detail: String,
    },
    AuthFailed {
        remote: String,
        detail: String,
    },
    Cancelled,
    LocalChanges {
        detail: String,
    },
    BranchInWorktree {
        branch: String,
        worktree: String,
    },
    PushRejected {
        detail: String,
    },
    NotFastForward {
        detail: String,
    },
    ConflictMarkers {
        file: String,
    },
    UnmergedBranch {
        branch: String,
        commits: u32,
    },
    WhitespaceIgnored,
    WorktreeDirty {
        path: String,
    },
    OperationInProgress {
        operation: String,
    },
    NotHead {
        sha: String,
    },
    MergeCommitInRange {
        sha: String,
    },
    SnapshotFailed {
        action: String,
        detail: String,
    },
    FileTooLarge {
        file: String,
        size: u64,
        limit: u64,
    },
    AiNotConfigured {
        detail: String,
    },
    AiProviderUnavailable {
        provider: String,
        detail: String,
    },
    AiAuthRequired {
        provider: String,
        detail: String,
    },
    AiInvalidResponse {
        provider: String,
        reason: String,
    },
    AiFailed {
        provider: String,
        output: String,
    },
    AiTimeout {
        provider: String,
        seconds: u32,
    },
    NotFound {
        detail: String,
    },
    ApiError {
        host: String,
        status: u16,
        detail: String,
    },
    Network {
        host: String,
        detail: String,
    },
}

impl CoreError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::NotARepository { .. } => ErrorKind::NotARepository,
            Self::AlreadyARepository { .. } => ErrorKind::AlreadyARepository,
            Self::GitMissing => ErrorKind::GitMissing,
            Self::GitTooOld { .. } => ErrorKind::GitTooOld,
            Self::GitFailed { .. } => ErrorKind::GitFailed,
            Self::InvalidGitOutput { .. } => ErrorKind::InvalidGitOutput,
            Self::InvalidRequest { .. } => ErrorKind::InvalidRequest,
            Self::StaleHunk { .. } => ErrorKind::StaleHunk,
            Self::CommitFailed { .. } => ErrorKind::CommitFailed,
            Self::WatchFailed { .. } => ErrorKind::WatchFailed,
            Self::StorageFailed { .. } => ErrorKind::StorageFailed,
            Self::AuthFailed { .. } => ErrorKind::AuthFailed,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::LocalChanges { .. } => ErrorKind::LocalChanges,
            Self::PushRejected { .. } => ErrorKind::PushRejected,
            Self::NotFastForward { .. } => ErrorKind::NotFastForward,
            Self::ConflictMarkers { .. } => ErrorKind::ConflictMarkers,
            Self::UnmergedBranch { .. } => ErrorKind::UnmergedBranch,
            Self::WhitespaceIgnored => ErrorKind::WhitespaceIgnored,
            Self::WorktreeDirty { .. } => ErrorKind::WorktreeDirty,
            Self::BranchInWorktree { .. } => ErrorKind::BranchInWorktree,
            Self::OperationInProgress { .. } => ErrorKind::OperationInProgress,
            Self::NotHead { .. } => ErrorKind::NotHead,
            Self::MergeCommitInRange { .. } => ErrorKind::MergeCommitInRange,
            Self::SnapshotFailed { .. } => ErrorKind::SnapshotFailed,
            Self::FileTooLarge { .. } => ErrorKind::FileTooLarge,
            Self::AiNotConfigured { .. } => ErrorKind::AiNotConfigured,
            Self::AiProviderUnavailable { .. } => ErrorKind::AiProviderUnavailable,
            Self::AiAuthRequired { .. } => ErrorKind::AiAuthRequired,
            Self::AiInvalidResponse { .. } => ErrorKind::AiInvalidResponse,
            Self::AiFailed { .. } => ErrorKind::AiFailed,
            Self::AiTimeout { .. } => ErrorKind::AiTimeout,
            Self::NotFound { .. } => ErrorKind::NotFound,
            Self::ApiError { .. } => ErrorKind::ApiError,
            Self::Network { .. } => ErrorKind::Network,
        }
    }

    pub(crate) fn invalid_request(detail: impl Into<String>) -> Self {
        Self::InvalidRequest {
            detail: detail.into(),
        }
    }

    pub(crate) fn invalid_output(command: &str, detail: impl Into<String>) -> Self {
        Self::InvalidGitOutput {
            command: command.to_owned(),
            detail: detail.into(),
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotARepository { path } => {
                write!(f, "{path} is not inside a Git repository")
            }
            Self::AlreadyARepository { path } => write!(f, "{path} is already a Git repository"),
            Self::GitMissing => write!(f, "The git executable was not found on PATH"),
            Self::GitTooOld { found, required } => {
                write!(
                    f,
                    "Git {found} is too old; YForge requires Git {required} or newer"
                )
            }
            Self::GitFailed {
                command,
                status,
                stderr,
            } => match status {
                Some(code) => write!(f, "`{command}` exited with status {code}: {stderr}"),
                None => write!(f, "`{command}` could not run: {stderr}"),
            },
            Self::InvalidGitOutput { command, detail } => {
                write!(f, "Unexpected output from `{command}`: {detail}")
            }
            Self::InvalidRequest { detail } => write!(f, "Invalid request: {detail}"),
            Self::StaleHunk { file, detail } => write!(
                f,
                "The changes in {file} no longer match the selected hunk: {detail}"
            ),
            Self::CommitFailed { status, .. } => match status {
                Some(code) => write!(f, "`git commit` exited with status {code}"),
                None => write!(f, "`git commit` was terminated before it finished"),
            },
            Self::WatchFailed { detail } => {
                write!(f, "Could not watch the repository for changes: {detail}")
            }
            Self::StorageFailed { path, detail } => {
                write!(f, "Could not read or write {path}: {detail}")
            }
            Self::AuthFailed { remote, .. } => write!(f, "Authentication failed for {remote}"),
            Self::Cancelled => write!(f, "The operation was cancelled"),
            Self::LocalChanges { .. } => write!(
                f,
                "Local changes would be overwritten. Commit or stash them first"
            ),
            Self::PushRejected { .. } => write!(f, "The remote rejected the push"),
            Self::NotFastForward { .. } => write!(
                f,
                "The branch cannot be fast-forwarded because it has diverged from its upstream"
            ),
            Self::ConflictMarkers { file } => {
                write!(f, "{file} still contains conflict markers")
            }
            Self::UnmergedBranch { branch, commits } => write!(
                f,
                "{branch} has {commits} {} that no other branch or tag contains",
                if *commits == 1 { "commit" } else { "commits" }
            ),
            Self::WhitespaceIgnored => write!(
                f,
                "The diff ignores whitespace, so its hunks and lines cannot be staged or discarded. Show whitespace changes first"
            ),
            Self::WorktreeDirty { path } => write!(
                f,
                "{path} has uncommitted changes. Commit, stash, or discard them first"
            ),
            Self::BranchInWorktree { branch, worktree } => write!(
                f,
                "{branch} is checked out in worktree {worktree}"
            ),
            Self::OperationInProgress { operation } => write!(
                f,
                "A {operation} is in progress. Finish or abort it first"
            ),
            Self::NotHead { sha } => write!(f, "{sha} is not the current commit (HEAD)"),
            Self::MergeCommitInRange { sha } => write!(
                f,
                "{} is a merge commit; rewriting history that contains merge commits is not supported",
                sha.chars().take(7).collect::<String>()
            ),
            Self::SnapshotFailed { action, detail } => write!(
                f,
                "Could not save a safety snapshot before {action}, so nothing was changed: {detail}"
            ),
            Self::FileTooLarge { file, size, limit } => write!(
                f,
                "{file} is {size} bytes; files over {limit} bytes are not shown"
            ),
            Self::AiNotConfigured { detail } => write!(f, "No AI provider is ready: {detail}"),
            Self::AiProviderUnavailable { provider, detail } => {
                write!(f, "{provider} is unavailable: {detail}")
            }
            Self::AiAuthRequired { provider, .. } => {
                write!(f, "{provider} needs you to sign in or check its credentials")
            }
            Self::AiInvalidResponse { provider, reason } => write!(
                f,
                "{provider} returned a response that cannot be used: {reason}"
            ),
            Self::AiFailed { provider, .. } => {
                write!(f, "{provider} failed to produce a response")
            }
            Self::AiTimeout { provider, seconds } => {
                write!(f, "{provider} did not answer within {seconds} seconds")
            }
            Self::NotFound { detail } => write!(f, "{detail}"),
            Self::ApiError {
                host,
                status,
                detail,
            } => write!(f, "{host} answered with HTTP {status}: {detail}"),
            Self::Network { host, detail } => write!(f, "Could not reach {host}: {detail}"),
        }
    }
}

impl std::error::Error for CoreError {}

impl From<CoreError> for ErrorPayload {
    fn from(error: CoreError) -> Self {
        let output = match &error {
            CoreError::CommitFailed { output, .. } => Some(output.clone()),
            CoreError::AuthFailed { detail, .. }
            | CoreError::LocalChanges { detail }
            | CoreError::PushRejected { detail }
            | CoreError::NotFastForward { detail } => Some(detail.clone()),
            CoreError::FileTooLarge { size, .. } => Some(size.to_string()),
            CoreError::AiAuthRequired { detail, .. } => {
                Some(detail.clone()).filter(|text| !text.is_empty())
            }
            CoreError::AiFailed { output, .. } => Some(output.clone()),
            _ => None,
        };
        Self {
            kind: error.kind(),
            message: error.to_string(),
            output,
        }
    }
}
