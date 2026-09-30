mod activity;
mod askpass;
mod branch;
mod clone;
mod commit;
mod config;
mod conflict;
mod diff;
mod error;
mod git;
mod graph;
mod integrate;
mod layout;
mod model;
mod operation;
mod refs;
mod repo;
mod stage;
mod stash;
mod status;
mod store;
mod sync;
mod tag;
mod undo;
mod watch;

pub use activity::{collect as collect_activity, redact, ActivityEntry, CommandRecord, UndoStatus};
pub use askpass::{AuthHandler, AuthKind, AuthPrompt, AuthReply};
pub use branch::{
    branch_delete_preview, check_branch_name, checkout, create_branch, delete_branch, rename_branch,
};
pub use clone::{clone_repository, init_repository};
pub use commit::{amend_info, commit, commit_details, commit_file_diff};
pub use config::{
    add_remote, edit_remote, list_remotes, read_identity, remove_remote, write_identity,
    ConfigSource, ConfigValue, Identity, IdentityField, RemoteInfo,
};
pub use conflict::{conflict_file, conflict_reset, conflict_resolve, conflict_take_side};
pub use diff::diff_file;
pub use error::{CoreError, ErrorKind, ErrorPayload};
pub use git::{ensure_supported, git_version, CancelToken, GitVersion};
pub use graph::{graph_page, search_commits};
pub use integrate::{cherry_pick, fast_forward, integration_preview, merge, rebase, reset, revert};
pub use model::{
    AheadBehind, AmendInfo, AppInfo, AuthPromptEvent, Author, AutoStash, CarriedEdge, ChangeArea,
    ChangeCounts, CheckoutOutcome, CheckoutTarget, CommitBrief, CommitDetails, CommitFile,
    ConflictFile, ConflictSegment, ConflictSide, ConflictSides, DiffHunk, DiffLine, DiffLineKind,
    FileChange, FileDiff, FileStatus, ForceLease, ForcePushPlan, GraphEdge, GraphPage, GraphRef,
    GraphRow, Head, IntegrationPreview, MergeMode, NodeKind, Operation, OperationDetail,
    OperationOutcome, OperationProgress, OperationStep, PullMode, PullOutcome, RefKind,
    RepoChanged, RepoSnapshot, ResetMode, RevisionRange, SearchResult, Signature, StashEntry,
    StashRestore, Upstream, Worktree,
};
pub use operation::{mark_resolved, operation_abort, operation_continue, operation_skip};
pub use repo::repo_snapshot;
pub use stage::{
    discard_files, discard_hunk, stage_all, stage_files, stage_hunk, unstage_all, unstage_files,
    unstage_hunk,
};
pub use stash::{stash_apply, stash_drop, stash_pop, stash_push};
pub use store::{
    add_recent, load_recents, load_repo_settings, load_session, load_settings, recent_status,
    remove_recent, save_repo_settings, save_session, save_settings, AppSettings, Density,
    RecentRepo, RecentStatus, RepoSettings, TabSession, Theme,
};
pub use sync::{fetch, publish, pull, push, push_force, push_plan, Progress};
pub use tag::{create_tag, delete_remote_tag, delete_tag, push_tag};
pub use undo::{
    branch_snapshot, capture_state, head_ref, plan_branch_create, plan_branch_delete,
    plan_checkout, plan_commit, plan_discard, plan_integration, plan_reset, plan_stash_restore,
    snapshot_files, undo, BranchSnapshot, HeadRef, Planned, RepoState, SnapshotFile, UndoAction,
    UndoPlan,
};
pub use watch::{watch_repo, RepoWatcher};

pub fn app_info(app_version: &str) -> Result<AppInfo, CoreError> {
    Ok(AppInfo {
        app_version: app_version.to_owned(),
        git_version: ensure_supported()?.text,
    })
}
