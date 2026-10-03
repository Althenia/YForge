mod activity;
mod ai;
mod ai_context;
mod askpass;
mod avatar;
mod batch;
mod branch;
mod cli;
mod clone;
mod commit;
mod compose;
mod config;
mod conflict;
mod diagnostics;
mod diff;
mod error;
mod external_tools;
mod file_history;
mod file_ops;
mod file_view;
mod git;
mod git_flow;
mod git_hosts;
mod graph;
mod history;
mod hooks;
mod ignore;
mod integrate;
mod jira;
mod launchpad;
mod layout;
mod lfs;
mod maintenance;
mod model;
mod operation;
mod passphrase;
mod patch;
mod platform;
mod recovery;
mod refs;
mod repo;
mod signing;
mod snapshots;
mod sqlite;
mod ssh;
mod stage;
mod stash;
mod status;
mod store;
mod submodule;
mod sync;
mod tag;
mod tracked_files;
mod undo;
mod update;
mod watch;
mod worktree;

pub use activity::{
    collect as collect_activity, redact, ActivityEntry, CommandRecord, OperationKind, RedoChange,
    UndoStatus,
};
pub use ai::{
    AiFeature, AiFeatureConfig, AiFeatureSummary, AiSignInEvent, AiSignInMethod, AiSignInStage,
    ApiKeyChange, AuthMode, CommitDraft, ComposeGroup, ComposeProposal, ConflictProposal,
    ConflictRegionProposal, Explanation, ExplanationItem, ModelInfo, ProviderConfig, ProviderInput,
    ProviderKind, ProviderStatus, ProviderSummary, ProviderUpdate, RecomposeProposal, StashDraft,
};
pub use ai_context::{
    commit_changes_context, commit_context, cut_at_line, is_secret_file, render_hunk, status_word,
    working_changes_context, ChangesContext, CommitContext,
};
pub use askpass::{AuthHandler, AuthKind, AuthPrompt, AuthReply};
pub use avatar::{gravatar_url, initial_of, md5_hex};
pub use batch::{
    delete_branches, delete_tags, drop_stashes, BatchFailure, BatchOutcome, StashTarget,
};
pub use branch::{
    branch_delete_preview, check_branch_name, checkout, checkout_leaving_stash, create_branch,
    delete_branch, rename_branch, set_upstream,
};
pub use cli::install_cli;
pub use clone::{clone_repository, init_repository, CloneOptions};
pub use commit::{amend_info, commit, commit_details, commit_file_diff, edit_head_message};
pub use compose::compose_apply;
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
pub use external_tools::{
    default_choices, detect_tools, detect_tools_in, editor_command, launch_editor,
    open_in_diff_tool, open_in_editor, open_in_merge_tool, tools_status, validate_choices,
    DiffToolSource, ExternalToolsStatus, Probe, SystemProbe, ToolChoices, ToolEntry, ToolsDetected,
    CHOICE_CUSTOM, CHOICE_GIT_CONFIG, CHOICE_NONE, CHOICE_USE_MERGE,
};
pub use file_history::{commit_tree_paths, file_blame, file_history, revert_hunk};
pub use file_ops::{
    changed_paths, create_file, delete_file, discard_all, file_editable, file_save, worktree_files,
    EditableFile,
};
pub use file_view::file_at_revision;
pub use git::{ensure_supported, git_version, CancelToken, GitVersion};
pub use git_flow::{
    flow_finish, flow_snapshot, flow_start, git_flow_config, git_flow_init, plan_flow_finish,
    FlowFinished, FlowKind, FlowSnapshot, GitFlowConfig,
};
pub use git_hosts::{
    git_host_problem, remote_address, url_identity, GitHost, GitHostDraft, GitHostProblem,
    IdentitySource, RemoteAddress, Resolved, SshPlan, Transport, UrlIdentity,
};
pub use graph::{graph_page, search_commits};
pub use history::{
    rebase_interactive, rebase_plan, recompose_apply, recompose_preview, squash_commits,
};
pub use hooks::{
    hook_approve, hook_read, hooks_list, run_hook, HookEnd, HookEntry, HookList, HookMode,
    HookOutcome, HookOutput, HookScript, HookStream, HOOK_LIMIT,
};
pub use ignore::ignore_paths;
pub use integrate::{cherry_pick, fast_forward, integration_preview, merge, rebase, reset, revert};
pub use jira::{
    jira_branch_name, jira_issue_keys, jira_issue_keys_in, jira_site_host, JiraConnection,
    JiraIssue, JiraIssueList, JiraIssueLookup, JiraKind, JiraProject, JiraStatusCategory,
    BRANCH_NAME_LIMIT,
};
pub use launchpad::{launchpad_wips, LaunchpadPull, LaunchpadPulls, PullRole, Wip};
pub use lfs::{lfs_initialize, lfs_status, lfs_track, lfs_untrack, LfsStatus};
pub use maintenance::maintenance_run;
pub use model::{
    AheadBehind, AmendInfo, AppInfo, AuthPromptEvent, Author, AutoStash, BlameRun, CarriedEdge,
    ChangeArea, ChangeCounts, CheckoutOutcome, CheckoutTarget, CliInstall, CommitBrief,
    CommitDetails, CommitFile, ConflictFile, ConflictSegment, ConflictSide, ConflictSides,
    DiffHunk, DiffLine, DiffLineKind, FileAtRevision, FileChange, FileDiff, FileRevision,
    FileStatus, ForceLease, ForcePushPlan, GraphEdge, GraphPage, GraphRef, GraphRow,
    GraphVisibility, Head, IntegrationPreview, MergeMode, MessageEdit, NodeKind, OpenPathRequested,
    Operation, OperationDetail, OperationOutcome, OperationProgress, OperationStep, PullMode,
    PullOutcome, PullReport, PullStash, PushTarget, RebaseOutcome, RebasePlan, RebaseResult,
    RebaseStep, RebaseTodo, RecomposeChange, RecomposeFile, RecomposeGroup, RecomposeHunk,
    RecomposePreview, RecomposeResult, RefKind, RefSelector, RepoChanged, RepoSnapshot, ResetMode,
    RevisionRange, SearchResult, Signature, StashDetails, StashEntry, StashFile, StashKeptReason,
    StashRestore, Submodule, SubmoduleStatus, SwitchStash, Upstream, Worktree, WorktreeIntegration,
    WorktreeStatus,
};
pub use model::{LostCommit, LostKind, ReflogEntry, SnapshotChange, SnapshotInfo};
pub use operation::{mark_resolved, operation_abort, operation_continue, operation_skip};
pub use passphrase::{CachedPassphrases, KeychainPassphrases, PassphraseStore, PASSPHRASE_SERVICE};
pub use patch::{patch_affected, patch_apply, patch_create};
pub use platform::{
    CreatePull, MatchedRepo, PlatformConnection, PlatformKind, PrDetail, PrFile, PrState, PullList,
    PullRequest, RepoRef,
};
pub use recovery::{lost_commits, reflog_list, reflog_refs};
pub use repo::repo_snapshot;
pub use signing::{
    list_signing_keys, signing_keys, signing_read, signing_write, SigningConfig, SigningFormat,
    SigningKey, SigningScope,
};
pub use snapshots::{
    snapshot_changed_files, snapshot_delete, snapshot_restore_all, snapshot_restore_files,
    snapshots_list,
};
pub use ssh::{default_key_path, generate_ssh_key, list_ssh_keys, public_key_text, SshKey};
pub use stage::{
    discard_files, discard_hunk, discard_lines, discard_staged_files, stage_all, stage_files,
    stage_hunk, stage_lines, unstage_all, unstage_files, unstage_hunk, unstage_lines,
};
pub use stash::{
    stash_apply, stash_details, stash_drop, stash_file_diff, stash_pop, stash_push,
    stash_push_paths, stash_rename,
};
pub use store::{
    activity_history, add_recent, ai_feature_config, ai_feature_config_enable,
    ai_feature_config_reset, ai_feature_config_set, ai_feature_configs, ai_provider,
    ai_provider_add, ai_provider_delete, ai_provider_edit, ai_provider_key_flag, ai_providers,
    app_ui_prefs_load, app_ui_prefs_save, append_activity, clear_activity, dismiss_switch_stash,
    folder_scan, git_host_add, git_host_remove, git_host_update, git_hosts_list,
    jira_connection_add, jira_connection_remove, jira_connection_update, jira_connections_list,
    load_recents, load_repo_settings, load_session, load_settings, mark_activity_undone,
    platform_connection_add, platform_connection_remove, platform_connections_list, recent_status,
    remove_recent, repo_alias_problem, repo_aliases_list, repo_aliases_set, repo_ui_prefs_load,
    repo_ui_prefs_save, repositories_list, repository_remove, repository_restore,
    save_repo_settings, save_session, save_settings, scan_folder_remove, scan_folder_rescan,
    scan_folder_save, ssh_plan, switch_stashes, AppSettings, AppUiPrefs, ColumnPref, Density,
    FileListMode, FolderRemoved, FolderScan, FoundRepo, GraphColumn, ManagedRepo, RecentRepo,
    RecentStatus, RepoAlias, RepoRemoved, RepoSettings, RepoUiPrefs, Repositories, Rescan,
    ScannedFolder, TabGroup, TabGroupColor, TabSession, Theme,
};
pub use store::{
    profile_activate, profile_delete, profile_save, profile_switch, profiles_list,
    tool_choices_load, tool_choices_save, Profile, ProfileDraft, ProfileList, DEFAULT_PROFILE,
};
pub use submodule::{
    add_submodule, deinit_submodule, list_submodules, stage_submodule, update_submodule,
    update_submodules,
};
pub use sync::{
    delete_remote_branch, fetch, publish, pull, pull_autostash, push, push_force, push_plan,
    push_to, remote_branch_sha, Progress,
};
pub use tag::{create_tag, delete_remote_tag, delete_tag, push_tag};
pub use tracked_files::tracked_files;
pub use undo::{
    branch_snapshot, capture_state, head_ref, plan_branch_create, plan_branch_delete,
    plan_branches_delete, plan_checkout, plan_commit, plan_compose, plan_discard, plan_force_push,
    plan_integration, plan_redo, plan_remote_branch_delete, plan_reset, plan_revert_hunk,
    plan_stash_restore, plan_upstream, snapshot_files, undo, undo_with, BranchSnapshot, HeadRef,
    IndexChange, IndexEntry, Planned, RepoState, SnapshotFile, UndoAction, UndoPlan,
};
pub use update::UpdateCheck;
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
