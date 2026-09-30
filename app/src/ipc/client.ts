import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActivityEntry } from "./bindings/ActivityEntry";
import type { AppSettings } from "./bindings/AppSettings";
import type { AppUiPrefs } from "./bindings/AppUiPrefs";
import type { AuthPromptEvent } from "./bindings/AuthPromptEvent";
import type { AuthReply } from "./bindings/AuthReply";
import type { CrashRecord } from "./bindings/CrashRecord";
import type { CrashReport } from "./bindings/CrashReport";
import type { Identity } from "./bindings/Identity";
import type { IdentityField } from "./bindings/IdentityField";
import type { RecentRepo } from "./bindings/RecentRepo";
import type { RecentStatus } from "./bindings/RecentStatus";
import type { RemoteInfo } from "./bindings/RemoteInfo";
import type { RepoSettings } from "./bindings/RepoSettings";
import type { SearchResult } from "./bindings/SearchResult";
import type { TabSession } from "./bindings/TabSession";
import type { UsageRecord } from "./bindings/UsageRecord";
import type { AmendInfo } from "./bindings/AmendInfo";
import type { AppInfo } from "./bindings/AppInfo";
import type { ChangeArea } from "./bindings/ChangeArea";
import type { CheckoutOutcome } from "./bindings/CheckoutOutcome";
import type { CheckoutTarget } from "./bindings/CheckoutTarget";
import type { CommitBrief } from "./bindings/CommitBrief";
import type { CommitDetails } from "./bindings/CommitDetails";
import type { ConflictFile } from "./bindings/ConflictFile";
import type { ConflictSide } from "./bindings/ConflictSide";
import type { DiffHunk } from "./bindings/DiffHunk";
import type { ErrorKind } from "./bindings/ErrorKind";
import type { ErrorPayload } from "./bindings/ErrorPayload";
import type { FileDiff } from "./bindings/FileDiff";
import type { ForceLease } from "./bindings/ForceLease";
import type { ForcePushPlan } from "./bindings/ForcePushPlan";
import type { CliInstall } from "./bindings/CliInstall";
import type { FileAtRevision } from "./bindings/FileAtRevision";
import type { GraphPage } from "./bindings/GraphPage";
import type { OpenPathRequested } from "./bindings/OpenPathRequested";
import type { GraphVisibility } from "./bindings/GraphVisibility";
import type { RepoUiPrefs } from "./bindings/RepoUiPrefs";
import type { StashDetails } from "./bindings/StashDetails";
import type { IntegrationPreview } from "./bindings/IntegrationPreview";
import type { MergeMode } from "./bindings/MergeMode";
import type { MessageEdit } from "./bindings/MessageEdit";
import type { OperationOutcome } from "./bindings/OperationOutcome";
import type { OperationProgress } from "./bindings/OperationProgress";
import type { PullMode } from "./bindings/PullMode";
import type { PullOutcome } from "./bindings/PullOutcome";
import type { RepoChanged } from "./bindings/RepoChanged";
import type { RepoSnapshot } from "./bindings/RepoSnapshot";
import type { ResetMode } from "./bindings/ResetMode";
import type { PullReport } from "./bindings/PullReport";
import type { PushTarget } from "./bindings/PushTarget";
import type { SshKey } from "./bindings/SshKey";
import type { StashRestore } from "./bindings/StashRestore";
import type { SwitchStash } from "./bindings/SwitchStash";
import type { WorktreeStatus } from "./bindings/WorktreeStatus";
import type { WorktreeIntegration } from "./bindings/WorktreeIntegration";
import type { SnapshotInfo } from "./bindings/SnapshotInfo";
import type { SnapshotChange } from "./bindings/SnapshotChange";
import type { ReflogEntry } from "./bindings/ReflogEntry";
import type { LostCommit } from "./bindings/LostCommit";
import type { AiModel } from "./bindings/AiModel";
import type { AiSignInEvent } from "./bindings/AiSignInEvent";
import type { AiSignInMethod } from "./bindings/AiSignInMethod";
import type { CommitDraft } from "./bindings/CommitDraft";
import type { ConflictProposal } from "./bindings/ConflictProposal";
import type { ProviderInput } from "./bindings/ProviderInput";
import type { ProviderStatus } from "./bindings/ProviderStatus";
import type { ProviderSummary } from "./bindings/ProviderSummary";
import type { ProviderUpdate } from "./bindings/ProviderUpdate";
import type { RebasePlan } from "./bindings/RebasePlan";
import type { RebaseResult } from "./bindings/RebaseResult";
import type { RebaseStep } from "./bindings/RebaseStep";
import type { RecomposeGroup } from "./bindings/RecomposeGroup";
import type { RecomposePreview } from "./bindings/RecomposePreview";
import type { RecomposeProposal } from "./bindings/RecomposeProposal";
import type { RecomposeResult } from "./bindings/RecomposeResult";

export const REPO_CHANGED_EVENT = "repo-changed";
export const OPERATION_PROGRESS_EVENT = "operation-progress";
export const AUTH_PROMPT_EVENT = "auth-prompt";
export const ACTIVITY_EVENT = "activity-recorded";
export const OPEN_PATH_REQUESTED_EVENT = "open-path-requested";
export const AI_SIGN_IN_EVENT = "ai-sign-in";

export type OpenWith = "editor" | "terminal" | "finder";

export class IpcError extends Error {
  readonly kind: ErrorKind;
  readonly output: string | null;

  constructor(payload: Pick<ErrorPayload, "kind" | "message"> & Partial<Pick<ErrorPayload, "output">>) {
    super(payload.message);
    this.name = "IpcError";
    this.kind = payload.kind;
    this.output = payload.output ?? null;
  }
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (failure) {
    if (isErrorPayload(failure)) throw new IpcError(failure);
    throw new IpcError({ kind: "internal", message: String(failure) });
  }
}

export const client = {
  appInfo: () => call<AppInfo>("app_info"),
  launchPath: () => call<string>("launch_path"),
  repoOpen: (path: string) => call<RepoSnapshot>("repo_open", { path }),
  repoGraph: (path: string, offset: number, limit: number, visibility?: GraphVisibility) =>
    call<GraphPage>("repo_graph", visibility === undefined ? { path, offset, limit } : { path, offset, limit, visibility }),
  diffFile: (path: string, file: string, area: ChangeArea, ignoreWhitespace = false) =>
    call<FileDiff>("diff_file", ignoreWhitespace ? { path, file, area, ignoreWhitespace } : { path, file, area }),
  stageFiles: (path: string, files: string[]) => call<null>("stage_files", { path, files }),
  unstageFiles: (path: string, files: string[]) => call<null>("unstage_files", { path, files }),
  stageAll: (path: string) => call<null>("stage_all", { path }),
  unstageAll: (path: string) => call<null>("unstage_all", { path }),
  discardFiles: (path: string, files: string[]) => call<null>("discard_files", { path, files }),
  stageHunk: (path: string, file: string, hunk: DiffHunk) => call<null>("stage_hunk", { path, file, hunk }),
  unstageHunk: (path: string, file: string, hunk: DiffHunk) => call<null>("unstage_hunk", { path, file, hunk }),
  discardHunk: (path: string, file: string, hunk: DiffHunk) => call<null>("discard_hunk", { path, file, hunk }),
  stageLines: (path: string, file: string, hunk: DiffHunk, lines: readonly number[]) => call<null>("stage_lines", { path, file, hunk, lines }),
  unstageLines: (path: string, file: string, hunk: DiffHunk, lines: readonly number[]) => call<null>("unstage_lines", { path, file, hunk, lines }),
  discardLines: (path: string, file: string, hunk: DiffHunk, lines: readonly number[]) => call<null>("discard_lines", { path, file, hunk, lines }),
  editHeadMessage: (path: string, sha: string, summary: string, description: string) =>
    call<MessageEdit>("edit_head_message", { path, sha, summary, description }),
  commit: (path: string, summary: string, description: string, amend: boolean) =>
    call<string>("commit", { path, summary, description, amend }),
  amendInfo: (path: string) => call<AmendInfo>("amend_info", { path }),
  commitDetails: (path: string, sha: string) => call<CommitDetails>("commit_details", { path, sha }),
  commitFileDiff: (path: string, sha: string, file: string) => call<FileDiff>("commit_file_diff", { path, sha, file }),
  checkout: (path: string, target: CheckoutTarget, stash: boolean, leaveStashed = false) =>
    call<CheckoutOutcome>("checkout", leaveStashed ? { path, target, stash, leaveStashed } : { path, target, stash }),
  checkBranchName: (path: string, name: string) => call<string>("check_branch_name", { path, name }),
  createBranch: (path: string, name: string, at: string | null, checkout: boolean) =>
    call<null>("create_branch", { path, name, at, checkout }),
  renameBranch: (path: string, from: string, to: string) => call<null>("rename_branch", { path, from, to }),
  branchDeletePreview: (path: string, name: string) => call<CommitBrief[]>("branch_delete_preview", { path, name }),
  deleteBranch: (path: string, name: string, force: boolean) => call<null>("delete_branch", { path, name, force }),
  stashPush: (path: string, message: string, untracked: boolean) => call<null>("stash_push", { path, message, untracked }),
  stashApply: (path: string, index: number, sha: string) => call<StashRestore>("stash_apply", { path, index, sha }),
  stashPop: (path: string, index: number, sha: string) => call<StashRestore>("stash_pop", { path, index, sha }),
  stashDrop: (path: string, index: number, sha: string) => call<null>("stash_drop", { path, index, sha }),
  fetch: (path: string, id: string, prune: boolean, interactive = true) =>
    call<null>("fetch", interactive ? { path, id, prune } : { path, id, prune, interactive }),
  pull: (path: string, id: string, mode: PullMode) => call<PullOutcome>("pull", { path, id, mode }),
  pullWithAutostash: (path: string, id: string, mode: PullMode) => call<PullReport>("pull_with_autostash", { path, id, mode }),
  push: (path: string, id: string) => call<null>("push", { path, id }),
  pushTo: (path: string, id: string, target: PushTarget) => call<null>("push_to", { path, id, target }),
  deleteRemoteBranch: (path: string, id: string, remote: string, name: string) => call<null>("delete_remote_branch", { path, id, remote, name }),
  setUpstream: (path: string, branch: string, upstream: string | null) => call<null>("set_upstream", { path, branch, upstream }),
  stashRename: (path: string, index: number, sha: string, message: string) => call<null>("stash_rename", { path, index, sha, message }),
  switchStashes: (path: string, branch: string) => call<SwitchStash[]>("switch_stashes", { path, branch }),
  switchStashRestore: (path: string, branch: string, sha: string) => call<StashRestore>("switch_stash_restore", { path, branch, sha }),
  switchStashDismiss: (path: string, branch: string, sha: string) => call<null>("switch_stash_dismiss", { path, branch, sha }),
  sshKeysList: () => call<SshKey[]>("ssh_keys_list"),
  worktreeList: (path: string) => call<WorktreeStatus[]>("worktree_list", { path }),
  worktreeSuggestPath: (path: string, branch: string) => call<string>("worktree_suggest_path", { path, branch }),
  worktreeCreate: (path: string, branch: string, create: boolean, start: string | null, destination: string) =>
    call<string>("worktree_create", { path, branch, create, start, destination }),
  worktreeRemove: (path: string, worktree: string, force: boolean) => call<null>("worktree_remove", { path, worktree, force }),
  worktreeIntegrate: (path: string, worktree: string, target: string, cleanup: boolean) =>
    call<WorktreeIntegration>("worktree_integrate", { path, worktree, target, cleanup }),
  reflogRefs: (path: string) => call<string[]>("reflog_refs", { path }),
  reflogList: (path: string, reference: string, before: number | null, limit: number) =>
    call<ReflogEntry[]>("reflog_list", { path, reference, before, limit }),
  lostCommits: (path: string, id?: string) => call<LostCommit[]>("lost_commits", id === undefined ? { path } : { path, id }),
  restoreAsBranch: (path: string, sha: string, name: string) => call<null>("restore_as_branch", { path, sha, name }),
  restoreCheckout: (path: string, sha: string) => call<null>("restore_checkout", { path, sha }),
  restoreReset: (path: string, sha: string, mode: ResetMode) => call<null>("restore_reset", { path, sha, mode }),
  snapshotsList: (path: string) => call<SnapshotInfo[]>("snapshots_list", { path }),
  snapshotFiles: (path: string, reference: string) => call<SnapshotChange[]>("snapshot_files", { path, reference }),
  snapshotRestoreFiles: (path: string, reference: string, files: readonly string[]) => call<string>("snapshot_restore_files", { path, reference, files }),
  snapshotRestoreAll: (path: string, reference: string, force: boolean) => call<string>("snapshot_restore_all", { path, reference, force }),
  snapshotDelete: (path: string, reference: string) => call<null>("snapshot_delete", { path, reference }),
  pushPlan: (path: string) => call<ForcePushPlan>("push_plan", { path }),
  pushForce: (path: string, id: string, lease: ForceLease) => call<null>("push_force", { path, id, lease }),
  publish: (path: string, id: string, remote: string) => call<null>("publish", { path, id, remote }),
  authRespond: (id: string, reply: AuthReply) => call<boolean>("auth_respond", { id, reply }),
  operationCancel: (id: string) => call<boolean>("operation_cancel", { id }),
  operationContinue: (path: string, message: string | null) => call<OperationOutcome>("operation_continue", { path, message }),
  operationSkip: (path: string) => call<OperationOutcome>("operation_skip", { path }),
  operationAbort: (path: string) => call<null>("operation_abort", { path }),
  markResolved: (path: string, files: string[]) => call<null>("mark_resolved", { path, files }),
  integrationPreview: (path: string, base: string | null, other: string) =>
    call<IntegrationPreview>("integration_preview", { path, base, other }),
  merge: (path: string, source: string, mode: MergeMode) => call<OperationOutcome>("merge", { path, source, mode }),
  rebase: (path: string, onto: string) => call<OperationOutcome>("rebase", { path, onto }),
  fastForward: (path: string, branch: string, target: string) => call<null>("fast_forward", { path, branch, target }),
  cherryPick: (path: string, sha: string) => call<OperationOutcome>("cherry_pick", { path, sha }),
  revert: (path: string, sha: string) => call<OperationOutcome>("revert", { path, sha }),
  reset: (path: string, target: string, mode: ResetMode) => call<null>("reset", { path, target, mode }),
  createTag: (path: string, name: string, at: string | null, message: string | null) =>
    call<null>("create_tag", { path, name, at, message }),
  deleteTag: (path: string, name: string) => call<null>("delete_tag", { path, name }),
  pushTag: (path: string, id: string, remote: string, name: string) => call<null>("push_tag", { path, id, remote, name }),
  deleteRemoteTag: (path: string, id: string, remote: string, name: string) =>
    call<null>("delete_remote_tag", { path, id, remote, name }),
  conflictFile: (path: string, file: string) => call<ConflictFile>("conflict_file", { path, file }),
  conflictResolve: (path: string, file: string, content: string) => call<null>("conflict_resolve", { path, file, content }),
  conflictTakeSide: (path: string, file: string, side: ConflictSide) => call<null>("conflict_take_side", { path, file, side }),
  conflictReset: (path: string, file: string) => call<null>("conflict_reset", { path, file }),
  rebasePlan: (path: string, base: string) => call<RebasePlan>("rebase_plan", { path, base }),
  rebaseInteractive: (path: string, base: string, steps: readonly RebaseStep[]) => call<RebaseResult>("rebase_interactive", { path, base, steps }),
  squashCommits: (path: string, shas: readonly string[], message: string) => call<RebaseResult>("squash_commits", { path, shas, message }),
  recomposePreview: (path: string, base: string) => call<RecomposePreview>("recompose_preview", { path, base }),
  recomposeApply: (path: string, base: string, groups: readonly RecomposeGroup[]) => call<RecomposeResult>("recompose_apply", { path, base, groups }),
  aiProvidersList: () => call<ProviderSummary[]>("ai_providers_list"),
  aiProviderAdd: (input: ProviderInput) => call<ProviderSummary>("ai_provider_add", { input }),
  aiProviderUpdate: (update: ProviderUpdate) => call<ProviderSummary>("ai_provider_update", { update }),
  aiProviderRemove: (id: string) => call<null>("ai_provider_remove", { id }),
  aiSetActive: (id: string | null, model: string | null) => call<null>("ai_set_active", { id, model }),
  aiProviderTest: (id: string) => call<ProviderStatus>("ai_provider_test", { id }),
  aiProviderModels: (id: string) => call<AiModel[]>("ai_provider_models", { id }),
  aiSignIn: (provider: string, id: string, method: AiSignInMethod) => call<ProviderStatus>("ai_sign_in", { provider, id, method }),
  aiGenerateCommitMessage: (path: string, id: string) => call<CommitDraft>("ai_generate_commit_message", { path, id }),
  aiProposeRecompose: (path: string, id: string, base: string) => call<RecomposeProposal>("ai_propose_recompose", { path, id, base }),
  aiProposeConflict: (path: string, id: string, file: string) => call<ConflictProposal>("ai_propose_conflict", { path, id, file }),
  searchCommits: (path: string, query: string, visibility?: GraphVisibility) =>
    call<SearchResult>("search_commits", visibility === undefined ? { path, query } : { path, query, visibility }),
  fileAtRevision: (path: string, file: string, rev: string) => call<FileAtRevision>("file_at_revision", { path, file, rev }),
  cliInstall: () => call<CliInstall>("cli_install"),
  stashDetails: (path: string, index: number, sha: string) => call<StashDetails>("stash_details", { path, index, sha }),
  stashFileDiff: (path: string, index: number, sha: string, file: string, ignoreWhitespace = false) =>
    call<FileDiff>("stash_file_diff", ignoreWhitespace ? { path, index, sha, file, ignoreWhitespace } : { path, index, sha, file }),
  repoUiPrefsLoad: (path: string) => call<RepoUiPrefs>("repo_ui_prefs_load", { path }),
  repoUiPrefsSave: (path: string, prefs: RepoUiPrefs) => call<null>("repo_ui_prefs_save", { path, prefs }),
  appUiPrefsLoad: () => call<AppUiPrefs>("app_ui_prefs_load"),
  appUiPrefsSave: (prefs: AppUiPrefs) => call<null>("app_ui_prefs_save", { prefs }),
  cloneRepo: (id: string, url: string, destination: string) => call<string>("clone_repo", { id, url, destination }),
  initRepo: (path: string) => call<string>("init_repo", { path }),
  settingsLoad: () => call<AppSettings>("settings_load"),
  settingsSave: (settings: AppSettings) => call<AppSettings>("settings_save", { settings }),
  repoSettingsLoad: (path: string) => call<RepoSettings>("repo_settings_load", { path }),
  repoSettingsSave: (path: string, settings: RepoSettings) => call<null>("repo_settings_save", { path, settings }),
  identityRead: (path: string | null) => call<Identity>("identity_read", { path }),
  identityWrite: (path: string | null, field: IdentityField, value: string | null) =>
    call<null>("identity_write", { path, field, value }),
  remotesList: (path: string) => call<RemoteInfo[]>("remotes_list", { path }),
  remoteAdd: (path: string, name: string, url: string) => call<null>("remote_add", { path, name, url }),
  remoteEdit: (path: string, name: string, newName: string, url: string) =>
    call<null>("remote_edit", { path, name, newName, url }),
  remoteRemove: (path: string, name: string) => call<null>("remote_remove", { path, name }),
  recentsList: () => call<RecentRepo[]>("recents_list"),
  recentAdd: (path: string) => call<RecentRepo[]>("recent_add", { path }),
  recentRemove: (path: string) => call<RecentRepo[]>("recent_remove", { path }),
  recentStatuses: (paths: string[]) => call<RecentStatus[]>("recent_statuses", { paths }),
  sessionLoad: () => call<TabSession>("session_load"),
  sessionSave: (session: TabSession) => call<null>("session_save", { session }),
  openPath: (path: string, with_: OpenWith) => call<null>("open_path", { path, with: with_ }),
  activityList: () => call<ActivityEntry[]>("activity_list"),
  activityClear: (repo: string | null) => call<null>("activity_clear", { repo }),
  activityHistory: (repo: string, before: number | null, limit: number) => call<ActivityEntry[]>("activity_history", { repo, before, limit }),
  crashReport: (report: CrashReport) => call<null>("crash_report", { report }),
  crashList: (before: number | null, limit: number) => call<CrashRecord[]>("crash_list", { before, limit }),
  crashExport: (path: string) => call<number>("crash_export", { path }),
  crashClear: () => call<null>("crash_clear"),
  usageList: (before: number | null, limit: number) => call<UsageRecord[]>("usage_list", { before, limit }),
  usageExport: (path: string) => call<number>("usage_export", { path }),
  usageClear: () => call<null>("usage_clear"),
  undoLast: (path: string, id: number) => call<string>("undo_last", { path, id }),
  repoWatch: (path: string) => call<null>("repo_watch", { path }),
  pickFolder: async (title: string): Promise<string | undefined> => {
    const picked = await open({ directory: true, multiple: false, title });
    return picked ?? undefined;
  },
  pickFile: async (title: string, defaultPath?: string): Promise<string | undefined> => {
    const picked = await open({ directory: false, multiple: false, title, ...(defaultPath === undefined ? {} : { defaultPath }) });
    return picked ?? undefined;
  },
  pickSavePath: async (title: string, defaultPath: string): Promise<string | undefined> => (await save({ title, defaultPath })) ?? undefined,
  homeDirectory: () => homeDir(),
  onFolderDrop: (handler: (paths: string[]) => void): Promise<UnlistenFn> =>
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") handler(event.payload.paths);
    }),
  onOperationProgress: (handler: (progress: OperationProgress) => void): Promise<UnlistenFn> =>
    listen<OperationProgress>(OPERATION_PROGRESS_EVENT, (event) => handler(event.payload)),
  onAuthPrompt: (handler: (event: AuthPromptEvent) => void): Promise<UnlistenFn> =>
    listen<AuthPromptEvent>(AUTH_PROMPT_EVENT, (event) => handler(event.payload)),
  onActivity: (handler: (entry: ActivityEntry) => void): Promise<UnlistenFn> =>
    listen<ActivityEntry>(ACTIVITY_EVENT, (event) => handler(event.payload)),
  onAiSignIn: (handler: (event: AiSignInEvent) => void): Promise<UnlistenFn> =>
    listen<AiSignInEvent>(AI_SIGN_IN_EVENT, (event) => handler(event.payload)),
  onOpenPathRequested: (handler: (request: OpenPathRequested) => void): Promise<UnlistenFn> =>
    listen<OpenPathRequested>(OPEN_PATH_REQUESTED_EVENT, (event) => handler(event.payload)),
  onRepoChanged: (handler: (change: RepoChanged) => void): Promise<UnlistenFn> =>
    listen<RepoChanged>(REPO_CHANGED_EVENT, (event) => handler(event.payload)),
};
