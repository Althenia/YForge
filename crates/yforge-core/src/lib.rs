mod activity;
mod askpass;
mod branch;
mod clone;
mod commit;
mod config;
mod conflict;
mod diagnostics;
mod diff;
mod error;
mod git;
mod graph;
mod history;
mod integrate;
mod layout;
mod model;
mod operation;
mod refs;
mod repo;
mod sqlite;
mod ssh;
mod stage;
mod stash;
mod status;
mod store;
mod sync;
mod tag;
mod undo;
mod watch;
mod worktree;

pub use activity::{
    collect as collect_activity, redact, ActivityEntry, CommandRecord, OperationKind, UndoStatus,
};
pub use askpass::{AuthHandler, AuthKind, AuthPrompt, AuthReply};
pub use branch::{
    branch_delete_preview, check_branch_name, checkout, checkout_leaving_stash, create_branch,
    delete_branch, rename_branch, set_upstream,
};
pub use clone::{clone_repository, init_repository};
pub use commit::{amend_info, commit, commit_details, commit_file_diff, edit_head_message};
pub use config::{
    add_remote, edit_remote, list_remotes, read_identity, remove_remote, write_identity,
    ConfigSource, ConfigValue, Identity, IdentityField, RemoteInfo,
};
pub use conflict::{conflict_file, conflict_reset, conflict_resolve, conflict_take_side};
pub use diagnostics::{
    clear_crashes, delete_usage, export_crashes, export_usage, list_crashes, list_usage,
    record_crash, record_panic, record_usage, CrashOrigin, CrashRecord, CrashReport, NewCrash,
    Redactor, UsageEvent, UsageRecord,
};
pub use diff::diff_file;
pub use error::{CoreError, ErrorKind, ErrorPayload};
pub use git::{ensure_supported, git_version, CancelToken, GitVersion};
pub use graph::{graph_page, search_commits};
pub use history::{
    rebase_interactive, rebase_plan, recompose_apply, recompose_preview, squash_commits,
};
pub use integrate::{cherry_pick, fast_forward, integration_preview, merge, rebase, reset, revert};
pub use model::{
    AheadBehind, AmendInfo, AppInfo, AuthPromptEvent, Author, AutoStash, CarriedEdge, ChangeArea,
    ChangeCounts, CheckoutOutcome, CheckoutTarget, CommitBrief, CommitDetails, CommitFile,
    ConflictFile, ConflictSegment, ConflictSide, ConflictSides, DiffHunk, DiffLine, DiffLineKind,
    FileChange, FileDiff, FileStatus, ForceLease, ForcePushPlan, GraphEdge, GraphPage, GraphRef,
    GraphRow, Head, IntegrationPreview, MergeMode, MessageEdit, NodeKind, Operation,
    OperationDetail, OperationOutcome, OperationProgress, OperationStep, PullMode, PullOutcome,
    PullReport, PullStash, PushTarget, RebaseOutcome, RebasePlan, RebaseResult, RebaseStep,
    RebaseTodo, RecomposeChange, RecomposeFile, RecomposeGroup, RecomposeHunk, RecomposePreview,
    RecomposeResult, RefKind, RepoChanged, RepoSnapshot, ResetMode, RevisionRange, SearchResult,
    Signature, StashEntry, StashKeptReason, StashRestore, SwitchStash, Upstream, Worktree,
    WorktreeIntegration, WorktreeStatus,
};
pub use operation::{mark_resolved, operation_abort, operation_continue, operation_skip};
pub use repo::repo_snapshot;
pub use ssh::{list_ssh_keys, SshKey};
pub use stage::{
    discard_files, discard_hunk, discard_lines, stage_all, stage_files, stage_hunk, stage_lines,
    unstage_all, unstage_files, unstage_hunk, unstage_lines,
};
pub use stash::{stash_apply, stash_drop, stash_pop, stash_push, stash_rename};
pub use store::{
    activity_history, add_recent, append_activity, clear_activity, dismiss_switch_stash,
    load_recents, load_repo_settings, load_session, load_settings, mark_activity_undone,
    recent_status, remove_recent, save_repo_settings, save_session, save_settings, ssh_key_for,
    switch_stashes, AppSettings, Density, RecentRepo, RecentStatus, RepoSettings, TabSession,
    Theme,
};
pub use sync::{
    delete_remote_branch, fetch, publish, pull, pull_autostash, push, push_force, push_plan,
    push_to, remote_branch_sha, Progress,
};
pub use tag::{create_tag, delete_remote_tag, delete_tag, push_tag};
pub use undo::{
    branch_snapshot, capture_state, head_ref, plan_branch_create, plan_branch_delete,
    plan_checkout, plan_commit, plan_discard, plan_force_push, plan_integration,
    plan_remote_branch_delete, plan_reset, plan_stash_restore, plan_upstream, snapshot_files, undo,
    undo_with, BranchSnapshot, HeadRef, Planned, RepoState, SnapshotFile, UndoAction, UndoPlan,
};
pub use watch::{watch_repo, RepoWatcher};
pub use worktree::{
    create_worktree, integrate_worktree, list_worktrees, remove_worktree, suggest_worktree_path,
};

pub fn app_info(app_version: &str) -> Result<AppInfo, CoreError> {
    Ok(AppInfo {
        app_version: app_version.to_owned(),
        git_version: ensure_supported()?.text,
    })
}

pub fn start_storage(dir: &std::path::Path) -> Result<Option<std::path::PathBuf>, CoreError> {
    store::prepare(dir)?;
    diagnostics::prepare(dir)
}
