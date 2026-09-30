use std::cell::RefCell;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

const OUTPUT_LIMIT: usize = 64 * 1024;

const QUIET: [&str; 14] = [
    "rev-parse",
    "status",
    "for-each-ref",
    "log",
    "diff",
    "show",
    "cat-file",
    "rev-list",
    "merge-base",
    "ls-files",
    "symbolic-ref",
    "hash-object",
    "credential",
    "config",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    Abort,
    AddRemote,
    AiCommitMessage,
    AiConflict,
    AiRecompose,
    Amend,
    ApplyStash,
    Checkout,
    CherryPick,
    Clone,
    Commit,
    Continue,
    CreateBranch,
    CreateTag,
    CreateWorktree,
    DeleteBranch,
    DeleteRemoteBranch,
    DeleteRemoteTag,
    DeleteTag,
    Discard,
    DiscardHunk,
    DiscardLines,
    DropStash,
    EditMessage,
    EditRemote,
    FastForward,
    Fetch,
    ForcePush,
    Initialize,
    IntegrateWorktree,
    InteractiveRebase,
    MarkResolved,
    Merge,
    PopStash,
    Publish,
    Pull,
    PullAutostash,
    Push,
    PushTag,
    PushTo,
    Rebase,
    Recompose,
    RemoveRemote,
    RemoveWorktree,
    RenameBranch,
    RenameStash,
    Reset,
    ResetConflict,
    ResolveConflict,
    Revert,
    SetIdentity,
    SetUpstream,
    Skip,
    SquashCommits,
    Stage,
    StageAll,
    StageHunk,
    StageLines,
    Stash,
    TakeSide,
    Undo,
    Unstage,
    UnstageAll,
    UnstageHunk,
    UnstageLines,
}

impl OperationKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Abort => "Abort",
            Self::AddRemote => "Add remote",
            Self::AiCommitMessage => "AI commit message",
            Self::AiConflict => "AI conflict proposal",
            Self::AiRecompose => "AI recompose proposal",
            Self::Amend => "Amend",
            Self::ApplyStash => "Apply stash",
            Self::Checkout => "Checkout",
            Self::CherryPick => "Cherry-pick",
            Self::Clone => "Clone",
            Self::Commit => "Commit",
            Self::Continue => "Continue",
            Self::CreateBranch => "Create branch",
            Self::CreateTag => "Create tag",
            Self::CreateWorktree => "Create worktree",
            Self::DeleteBranch => "Delete branch",
            Self::DeleteRemoteBranch => "Delete remote branch",
            Self::DeleteRemoteTag => "Delete remote tag",
            Self::DeleteTag => "Delete tag",
            Self::Discard => "Discard",
            Self::DiscardHunk => "Discard hunk",
            Self::DiscardLines => "Discard lines",
            Self::DropStash => "Drop stash",
            Self::EditMessage => "Edit message",
            Self::EditRemote => "Edit remote",
            Self::FastForward => "Fast-forward",
            Self::Fetch => "Fetch",
            Self::ForcePush => "Force push",
            Self::Initialize => "Initialize",
            Self::IntegrateWorktree => "Integrate worktree",
            Self::InteractiveRebase => "Interactive rebase",
            Self::MarkResolved => "Mark resolved",
            Self::Merge => "Merge",
            Self::PopStash => "Pop stash",
            Self::Publish => "Publish",
            Self::Pull => "Pull",
            Self::PullAutostash => "Pull with auto-stash",
            Self::Push => "Push",
            Self::PushTag => "Push tag",
            Self::PushTo => "Push to",
            Self::Rebase => "Rebase",
            Self::Recompose => "Recompose",
            Self::RemoveRemote => "Remove remote",
            Self::RemoveWorktree => "Remove worktree",
            Self::RenameBranch => "Rename branch",
            Self::RenameStash => "Rename stash",
            Self::Reset => "Reset",
            Self::ResetConflict => "Reset conflict",
            Self::ResolveConflict => "Resolve conflict",
            Self::Revert => "Revert",
            Self::SetIdentity => "Set identity",
            Self::SetUpstream => "Set upstream",
            Self::Skip => "Skip",
            Self::SquashCommits => "Squash commits",
            Self::Stage => "Stage",
            Self::StageAll => "Stage all",
            Self::StageHunk => "Stage hunk",
            Self::StageLines => "Stage lines",
            Self::Stash => "Stash",
            Self::TakeSide => "Take side",
            Self::Undo => "Undo",
            Self::Unstage => "Unstage",
            Self::UnstageAll => "Unstage all",
            Self::UnstageHunk => "Unstage hunk",
            Self::UnstageLines => "Unstage lines",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct CommandRecord {
    pub command: String,
    pub status: Option<i32>,
    pub duration_ms: u32,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UndoStatus {
    Available { scope: String },
    Unavailable { reason: String },
    Undone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct ActivityEntry {
    pub id: u32,
    pub repo: String,
    pub operation: String,
    pub summary: String,
    pub started_at: i64,
    pub duration_ms: u32,
    pub ok: bool,
    pub local: bool,
    pub toast: bool,
    pub error: Option<String>,
    pub commands: Vec<CommandRecord>,
    pub undo: UndoStatus,
}

thread_local! {
    static COLLECTOR: RefCell<Option<Vec<CommandRecord>>> = const { RefCell::new(None) };
}

pub fn collect<T>(task: impl FnOnce() -> T) -> (T, Vec<CommandRecord>) {
    let previous = COLLECTOR.with(|slot| slot.replace(Some(Vec::new())));
    let result = task();
    let records = COLLECTOR
        .with(|slot| slot.replace(previous))
        .unwrap_or_default();
    (result, records)
}

fn subcommand(command: &str) -> &str {
    command
        .split_whitespace()
        .skip(1)
        .find(|token| !token.starts_with('-'))
        .unwrap_or_default()
}

fn is_reading(command: &str) -> bool {
    let name = subcommand(command);
    name.is_empty() || QUIET.contains(&name) && (name != "config" || command.contains("--get"))
}

pub(crate) fn note(command: &str, status: Option<i32>, output: &str, elapsed: Duration) {
    COLLECTOR.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(records) = slot.as_mut() else {
            return;
        };
        if is_reading(command) {
            return;
        }
        let mut output = redact(output.trim());
        if output.len() > OUTPUT_LIMIT {
            let mut end = OUTPUT_LIMIT;
            while !output.is_char_boundary(end) {
                end -= 1;
            }
            output.truncate(end);
            output.push_str("\n… output truncated");
        }
        records.push(CommandRecord {
            command: redact(command),
            status,
            duration_ms: u32::try_from(elapsed.as_millis()).unwrap_or(u32::MAX),
            output,
        });
    });
}

fn redact_userinfo(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        let (head, tail) = rest.split_at(at + 3);
        redacted.push_str(head);
        let authority_end = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(tail.len());
        match tail[..authority_end].rfind('@') {
            Some(marker) => {
                redacted.push_str("***@");
                rest = &tail[marker + 1..];
            }
            None => rest = tail,
        }
    }
    redacted.push_str(rest);
    redacted
}

const SECRET_MARKERS: [&str; 3] = ["password=", "authorization:", "extraheader="];

pub(crate) fn redact_embedded(text: &str) -> String {
    redact_userinfo(text)
        .lines()
        .map(|line| {
            let lowered = line.to_lowercase();
            if SECRET_MARKERS.iter().any(|marker| lowered.contains(marker)) {
                "***".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn redact(text: &str) -> String {
    redact_userinfo(text)
        .lines()
        .map(|line| {
            let lowered = line.trim_start().to_lowercase();
            if lowered.starts_with("password=")
                || lowered.starts_with("authorization:")
                || lowered.contains("extraheader=")
            {
                "***".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_url_credentials_and_secret_lines() {
        assert_eq!(
            redact("git clone https://yui:tok3n@example.test/a.git dest"),
            "git clone https://***@example.test/a.git dest"
        );
        assert_eq!(
            redact("fatal: unable to access 'https://tok3n@example.test/a.git/': 401"),
            "fatal: unable to access 'https://***@example.test/a.git/': 401"
        );
        assert_eq!(
            redact("username=yui\npassword=hunter2"),
            "username=yui\n***"
        );
        assert_eq!(redact("git fetch origin"), "git fetch origin");
    }

    #[test]
    fn collects_mutating_commands_and_skips_read_only_ones() {
        let (_, records) = collect(|| {
            note("git --version", Some(0), "git version 2", Duration::ZERO);
            note("git rev-parse HEAD", Some(0), "abc", Duration::ZERO);
            note("git config --get user.name", Some(0), "yui", Duration::ZERO);
            note(
                "git commit -m x",
                Some(0),
                "[main abc] x",
                Duration::from_millis(12),
            );
            note("git config user.name yui", Some(0), "", Duration::ZERO);
        });
        let commands: Vec<&str> = records.iter().map(|r| r.command.as_str()).collect();
        assert_eq!(commands, ["git commit -m x", "git config user.name yui"]);
        assert_eq!(records[0].duration_ms, 12);
    }

    #[test]
    fn notes_outside_a_collection_are_dropped() {
        note("git commit -m x", Some(0), "", Duration::ZERO);
        let (_, records) = collect(|| ());
        assert!(records.is_empty());
    }
}
