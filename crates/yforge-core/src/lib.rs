mod activity;
mod ai;
mod ai_context;
mod askpass;
mod avatar;
mod branch;
mod cli;
mod clone;
mod commit;
mod config;
mod conflict;
mod diagnostics;
mod diff;
mod error;
mod file_view;
mod git;
mod graph;
mod history;
mod integrate;
mod layout;
mod model;
mod operation;
mod platform;
mod recovery;
mod refs;
mod repo;
mod snapshots;
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
pub use ai::{
    AiFeature, AiFeatureConfig, AiFeatureSummary, AiSignInEvent, AiSignInMethod, AiSignInStage,
    ApiKeyChange, AuthMode, CommitDraft, ConflictProposal, ConflictRegionProposal, ModelInfo,
    ProviderConfig, ProviderInput, ProviderKind, ProviderStatus, ProviderSummary, ProviderUpdate,
    RecomposeProposal,
};
pub use ai_context::{
    commit_context, cut_at_line, is_secret_file, render_hunk, status_word, CommitContext,
};
pub use askpass::{AuthHandler, AuthKind, AuthPrompt, AuthReply};
pub use avatar::{gravatar_url, initial_of, md5_hex};
pub use branch::{
    branch_delete_preview, check_branch_name, checkout, checkout_leaving_stash, create_branch,
    delete_branch, rename_branch, set_upstream,
};
pub use cli::install_cli;
pub use clone::{clone_repository, init_repository, CloneOptions};
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
pub use file_view::file_at_revision;
pub use git::{ensure_supported, git_version, CancelToken, GitVersion};
pub use graph::{graph_page, search_commits};
pub use history::{
    rebase_interactive, rebase_plan, recompose_apply, recompose_preview, squash_commits,
};
pub use integrate::{cherry_pick, fast_forward, integration_preview, merge, rebase, reset, revert};
pub use model::{
    AheadBehind, AmendInfo, AppInfo, AuthPromptEvent, Author, AutoStash, CarriedEdge, ChangeArea,
    ChangeCounts, CheckoutOutcome, CheckoutTarget, CliInstall, CommitBrief, CommitDetails,
    CommitFile, ConflictFile, ConflictSegment, ConflictSide, ConflictSides, DiffHunk, DiffLine,
    DiffLineKind, FileAtRevision, FileChange, FileDiff, FileStatus, ForceLease, ForcePushPlan,
    GraphEdge, GraphPage, GraphRef, GraphRow, GraphVisibility, Head, IntegrationPreview, MergeMode,
    MessageEdit, NodeKind, OpenPathRequested, Operation, OperationDetail, OperationOutcome,
    OperationProgress, OperationStep, PullMode, PullOutcome, PullReport, PullStash, PushTarget,
    RebaseOutcome, RebasePlan, RebaseResult, RebaseStep, RebaseTodo, RecomposeChange,
    RecomposeFile, RecomposeGroup, RecomposeHunk, RecomposePreview, RecomposeResult, RefKind,
    RefSelector, RepoChanged, RepoSnapshot, ResetMode, RevisionRange, SearchResult, Signature,
    StashDetails, StashEntry, StashFile, StashKeptReason, StashRestore, SwitchStash, Upstream,
    Worktree, WorktreeIntegration, WorktreeStatus,
};
pub use model::{LostCommit, LostKind, ReflogEntry, SnapshotChange, SnapshotInfo};
pub use operation::{mark_resolved, operation_abort, operation_continue, operation_skip};
pub use platform::{
    CreatePull, MatchedRepo, PlatformConnection, PlatformKind, PrDetail, PrFile, PrState,
    PullRequest, RepoRef,
};
pub use recovery::{lost_commits, reflog_list, reflog_refs};
pub use repo::repo_snapshot;
pub use snapshots::{
    snapshot_changed_files, snapshot_delete, snapshot_restore_all, snapshot_restore_files,
    snapshots_list,
};
pub use ssh::{list_ssh_keys, SshKey};
pub use stage::{
    discard_files, discard_hunk, discard_lines, stage_all, stage_files, stage_hunk, stage_lines,
    unstage_all, unstage_files, unstage_hunk, unstage_lines,
};
pub use stash::{
    stash_apply, stash_details, stash_drop, stash_file_diff, stash_pop, stash_push, stash_rename,
};
pub use store::{
    activity_history, add_recent, ai_active_provider, ai_choose, ai_feature_config,
    ai_feature_config_reset, ai_feature_config_set, ai_feature_configs, ai_provider,
    ai_provider_add, ai_provider_delete, ai_provider_edit, ai_provider_key_flag, ai_providers,
    app_ui_prefs_load, app_ui_prefs_save, append_activity, clear_activity, dismiss_switch_stash,
    load_recents, load_repo_settings, load_session, load_settings, mark_activity_undone,
    platform_connection_add, platform_connection_remove, platform_connections_list, recent_status,
    remove_recent, repo_ui_prefs_load, repo_ui_prefs_save, save_repo_settings, save_session,
    save_settings, ssh_key_for, switch_stashes, AppSettings, AppUiPrefs, ColumnPref, Density,
    GraphColumn, RecentRepo, RecentStatus, RepoSettings, RepoUiPrefs, TabSession, Theme,
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
