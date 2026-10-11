import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActivityEntry } from "./bindings/ActivityEntry";
import type { AppSettings } from "./bindings/AppSettings";

export type LspStarted = { id: string; root_uri: string; file_uri: string; language_id: string };
export type LspEvent = { id: string; body: string };
import type { AppUiPrefs } from "./bindings/AppUiPrefs";
import type { AuthPromptEvent } from "./bindings/AuthPromptEvent";
import type { AuthReply } from "./bindings/AuthReply";
import type { CrashRecord } from "./bindings/CrashRecord";
import type { CrashReport } from "./bindings/CrashReport";
import type { Identity } from "./bindings/Identity";
import type { IdentityField } from "./bindings/IdentityField";
import type { RecentRepo } from "./bindings/RecentRepo";
import type { RedoChange } from "./bindings/RedoChange";
import type { RecentStatus } from "./bindings/RecentStatus";
import type { RemoteInfo } from "./bindings/RemoteInfo";
import type { RepoAlias } from "./bindings/RepoAlias";
import type { RepoSettings } from "./bindings/RepoSettings";
import type { RevisionRange } from "./bindings/RevisionRange";
import type { SearchResult } from "./bindings/SearchResult";
import type { TabSession } from "./bindings/TabSession";
import type { UpdateCheck } from "./bindings/UpdateCheck";
import type { UsageRecord } from "./bindings/UsageRecord";
import type { AmendInfo } from "./bindings/AmendInfo";
import type { AppInfo } from "./bindings/AppInfo";
import type { BatchOutcome } from "./bindings/BatchOutcome";
import type { ChangeArea } from "./bindings/ChangeArea";
import type { CheckoutOutcome } from "./bindings/CheckoutOutcome";
import type { CloneOptions } from "./bindings/CloneOptions";
import type { CheckoutTarget } from "./bindings/CheckoutTarget";
import type { CommitDetails } from "./bindings/CommitDetails";
import type { ConflictFile } from "./bindings/ConflictFile";
import type { ConflictSide } from "./bindings/ConflictSide";
import type { DiffHunk } from "./bindings/DiffHunk";
import type { ErrorKind } from "./bindings/ErrorKind";
import type { ErrorPayload } from "./bindings/ErrorPayload";
import type { FileDiff } from "./bindings/FileDiff";
import type { FileRevision } from "./bindings/FileRevision";
import type { BlameRun } from "./bindings/BlameRun";
import type { ForceLease } from "./bindings/ForceLease";
import type { ForcePushPlan } from "./bindings/ForcePushPlan";
import type { CliInstall } from "./bindings/CliInstall";
import type { FileAtRevision } from "./bindings/FileAtRevision";
import type { EditableFile } from "./bindings/EditableFile";
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
import type { GitHost } from "./bindings/GitHost";
import type { GitHostDraft } from "./bindings/GitHostDraft";
import type { GitHostProblem } from "./bindings/GitHostProblem";
import type { SshKey } from "./bindings/SshKey";
import type { UrlIdentity } from "./bindings/UrlIdentity";
import type { StashRestore } from "./bindings/StashRestore";
import type { StashTarget } from "./bindings/StashTarget";
import type { SwitchStash } from "./bindings/SwitchStash";
import type { Submodule } from "./bindings/Submodule";
import type { FlowFinished } from "./bindings/FlowFinished";
import type { FlowKind } from "./bindings/FlowKind";
import type { GitFlowConfig } from "./bindings/GitFlowConfig";
import type { HookList } from "./bindings/HookList";
import type { HookMode } from "./bindings/HookMode";
import type { HookOutcome } from "./bindings/HookOutcome";
import type { HookOutput } from "./bindings/HookOutput";
import type { HookScript } from "./bindings/HookScript";
import type { WorktreeStatus } from "./bindings/WorktreeStatus";
import type { WorktreeIntegration } from "./bindings/WorktreeIntegration";
import type { SnapshotInfo } from "./bindings/SnapshotInfo";
import type { SnapshotChange } from "./bindings/SnapshotChange";
import type { ReflogEntry } from "./bindings/ReflogEntry";
import type { LostCommit } from "./bindings/LostCommit";
import type { ModelInfo } from "./bindings/ModelInfo";
import type { AiFeature } from "./bindings/AiFeature";
import type { AiFeatureSummary } from "./bindings/AiFeatureSummary";
import type { AiSignInEvent } from "./bindings/AiSignInEvent";
import type { AiSignInMethod } from "./bindings/AiSignInMethod";
import type { CommitDraft } from "./bindings/CommitDraft";
import type { ConflictProposal } from "./bindings/ConflictProposal";
import type { ComposeGroup } from "./bindings/ComposeGroup";
import type { ComposeProposal } from "./bindings/ComposeProposal";
import type { Explanation } from "./bindings/Explanation";
import type { StashDraft } from "./bindings/StashDraft";
import type { ProviderInput } from "./bindings/ProviderInput";
import type { ProviderKind } from "./bindings/ProviderKind";
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
import type { CreatePull } from "./bindings/CreatePull";
import type { BranchComparison } from "./bindings/BranchComparison";
import type { MergePrediction } from "./bindings/MergePrediction";
import type { PullChecks } from "./bindings/PullChecks";
import type { PullRequestDisclosure } from "./bindings/PullRequestDisclosure";
import type { PullRequestDraft } from "./bindings/PullRequestDraft";
import type { MatchedRepo } from "./bindings/MatchedRepo";
import type { PlatformConnection } from "./bindings/PlatformConnection";
import type { PlatformKind } from "./bindings/PlatformKind";
import type { PrDetail } from "./bindings/PrDetail";
import type { PullList } from "./bindings/PullList";
import type { PullRequest } from "./bindings/PullRequest";
import type { JiraConnection } from "./bindings/JiraConnection";
import type { JiraIssueList } from "./bindings/JiraIssueList";
import type { JiraIssueLookup } from "./bindings/JiraIssueLookup";
import type { JiraKind } from "./bindings/JiraKind";
import type { LaunchpadPulls } from "./bindings/LaunchpadPulls";
import type { Wip } from "./bindings/Wip";
import type { FolderRemoved } from "./bindings/FolderRemoved";
import type { FolderScan } from "./bindings/FolderScan";
import type { ManagedRepo } from "./bindings/ManagedRepo";
import type { RepoRemoved } from "./bindings/RepoRemoved";
import type { Repositories } from "./bindings/Repositories";
import type { Rescan } from "./bindings/Rescan";
import type { ScannedFolder } from "./bindings/ScannedFolder";

import type { DiffToolSource } from "./bindings/DiffToolSource";
import type { ExternalToolsStatus } from "./bindings/ExternalToolsStatus";
import type { LfsStatus } from "./bindings/LfsStatus";
import type { Profile } from "./bindings/Profile";
import type { ProfileDraft } from "./bindings/ProfileDraft";
import type { ProfileList } from "./bindings/ProfileList";
import type { SigningConfig } from "./bindings/SigningConfig";
import type { SigningKey } from "./bindings/SigningKey";
import type { SigningScope } from "./bindings/SigningScope";
import type { ToolChoices } from "./bindings/ToolChoices";
import type { ToolsDetected } from "./bindings/ToolsDetected";

export const REPO_CHANGED_EVENT = "repo-changed";
export const MENU_ACTION_EVENT = "menu-action";
export const OPERATION_PROGRESS_EVENT = "operation-progress";
export const HOOK_OUTPUT_EVENT = "hook-output";
export const AUTH_PROMPT_EVENT = "auth-prompt";
export const ACTIVITY_EVENT = "activity-recorded";
export const REDO_EVENT = "redo-changed";
export const OPEN_PATH_REQUESTED_EVENT = "open-path-requested";
export const AI_SIGN_IN_EVENT = "ai-sign-in";

export type OpenWith = "editor" | "terminal" | "finder";

export type PrListState = "open" | "all";

export class IpcError extends Error {
  readonly kind: ErrorKind;
  readonly output: string | null;
  readonly command: string | undefined;

  constructor(payload: Pick<ErrorPayload, "kind" | "message"> & Partial<Pick<ErrorPayload, "output">>, command?: string) {
    super(payload.message);
    this.name = "IpcError";
    this.kind = payload.kind;
    this.output = payload.output ?? null;
    this.command = command;
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
    if (isErrorPayload(failure)) throw new IpcError(failure, command);
    throw new IpcError({ kind: "internal", message: String(failure) }, command);
  }
}

export const client = {
  appInfo: () => call<AppInfo>("app_info"),
  launchPath: () => call<string | null>("launch_path"),
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
  discardStagedFiles: (path: string, files: string[]) => call<null>("discard_staged_files", { path, files }),
  ignorePaths: (path: string, files: string[], untrack: boolean) => call<null>("ignore_paths", { path, files, untrack }),
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
  commitFileDiff: (path: string, sha: string, file: string, ignoreWhitespace = false) =>
    call<FileDiff>("commit_file_diff", ignoreWhitespace ? { path, sha, file, ignoreWhitespace } : { path, sha, file }),
  revisionFileDiff: (path: string, base: string, head: string, file: string, ignoreWhitespace = false) =>
    call<FileDiff>("revision_file_diff", ignoreWhitespace ? { path, base, head, file, ignoreWhitespace } : { path, base, head, file }),
  fileHistory: (path: string, file: string) => call<FileRevision[]>("file_history", { path, file }),
  fileBlame: (path: string, file: string, revision: string | null) => call<BlameRun[]>("file_blame", { path, file, revision }),
  revertHunk: (path: string, sha: string, file: string, hunk: number) => call<null>("revert_hunk", { path, sha, file, hunk }),
  commitTreePaths: (path: string, sha: string) => call<string[]>("commit_tree_paths", { path, sha }),
  checkout: (path: string, target: CheckoutTarget, stash: boolean, leaveStashed = false) =>
    call<CheckoutOutcome>("checkout", leaveStashed ? { path, target, stash, leaveStashed } : { path, target, stash }),
  checkBranchName: (path: string, name: string) => call<string>("check_branch_name", { path, name }),
  createBranch: (path: string, name: string, at: string | null, checkout: boolean) =>
    call<null>("create_branch", { path, name, at, checkout }),
  renameBranch: (path: string, from: string, to: string) => call<null>("rename_branch", { path, from, to }),
  branchDeletePreview: (path: string, name: string) => call<RevisionRange>("branch_delete_preview", { path, name }),
  deleteBranches: (path: string, names: readonly string[], forced: readonly string[]) => call<BatchOutcome>("delete_branches", { path, names, forced }),
  deleteBranch: (path: string, name: string, force: boolean) => call<null>("delete_branch", { path, name, force }),
  stashPush: (path: string, message: string, untracked: boolean) => call<null>("stash_push", { path, message, untracked }),
  stashPushPaths: (path: string, message: string, untracked: boolean, paths: string[]) => call<null>("stash_push_paths", { path, message, untracked, paths }),
  stashApply: (path: string, index: number, sha: string) => call<StashRestore>("stash_apply", { path, index, sha }),
  stashPop: (path: string, index: number, sha: string) => call<StashRestore>("stash_pop", { path, index, sha }),
  stashDrop: (path: string, index: number, sha: string) => call<null>("stash_drop", { path, index, sha }),
  dropStashes: (path: string, targets: readonly StashTarget[]) => call<BatchOutcome>("drop_stashes", { path, targets }),
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
  sshPublicKey: (path: string) => call<string>("ssh_public_key", { path }),
  gitHostsList: () => call<GitHost[]>("git_hosts_list"),
  gitHostSave: (id: string | null, draft: GitHostDraft) => call<GitHost>("git_host_save", { id, draft }),
  gitHostRemove: (id: string) => call<null>("git_host_remove", { id }),
  gitHostFieldProblem: (field: "host" | "ssh_key" | "new_key", value: string) => call<GitHostProblem | null>("git_host_field_problem", { field, value }),
  gitHostDefaultKeyPath: (host: string) => call<string>("git_host_default_key_path", { host }),
  gitHostGenerateKey: (host: string, keyPath: string, passphrase: string | null) => call<string>("git_host_generate_key", { host, keyPath, passphrase }),
  gitIdentityForUrl: (url: string) => call<UrlIdentity>("git_identity_for_url", { url }),
  submoduleList: (path: string) => call<Submodule[]>("submodule_list", { path }),
  submoduleAdd: (path: string, url: string, submodulePath: string, branch: string | null) =>
    call<null>("submodule_add", { path, url, submodulePath, branch }),
  submoduleUpdate: (path: string, submodulePath: string | null) => call<null>("submodule_update", { path, submodulePath }),
  submoduleDeinit: (path: string, submodulePath: string) => call<null>("submodule_deinit", { path, submodulePath }),
  submoduleStage: (path: string, submodulePath: string) => call<null>("submodule_stage", { path, submodulePath }),
  hooksList: (path: string) => call<HookList>("hooks_list", { path }),
  hookRead: (path: string, name: string) => call<HookScript>("hook_read", { path, name }),
  hookApprove: (path: string, name: string) => call<null>("hook_approve", { path, name }),
  hookRun: (path: string, id: string, name: string, mode: HookMode, message: string) => call<HookOutcome>("hook_run", { path, id, name, mode, message }),
  gitFlowConfig: (path: string) => call<GitFlowConfig | null>("git_flow_config", { path }),
  gitFlowInit: (path: string, config: GitFlowConfig) => call<null>("git_flow_init", { path, config }),
  gitFlowStart: (path: string, kind: FlowKind, name: string) => call<string>("git_flow_start", { path, kind, name }),
  gitFlowFinish: (path: string) => call<FlowFinished>("git_flow_finish", { path }),
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
  publish: (path: string, id: string, remote: string, branch?: string) => call<null>("publish", branch === undefined ? { path, id, remote } : { path, id, remote, branch }),
  authRespond: (id: string, reply: AuthReply) => call<boolean>("auth_respond", { id, reply }),
  operationCancel: (id: string) => call<boolean>("operation_cancel", { id }),
  operationContinue: (path: string, message: string | null) => call<OperationOutcome>("operation_continue", { path, message }),
  operationSkip: (path: string) => call<OperationOutcome>("operation_skip", { path }),
  operationAbort: (path: string) => call<null>("operation_abort", { path }),
  markResolved: (path: string, files: string[]) => call<null>("mark_resolved", { path, files }),
  integrationPreview: (path: string, base: string | null, other: string) =>
    call<IntegrationPreview>("integration_preview", { path, base, other }),
  incomingCommits: (path: string) => call<string[]>("incoming_commits", { path }),
  merge: (path: string, source: string, mode: MergeMode) => call<OperationOutcome>("merge", { path, source, mode }),
  rebase: (path: string, onto: string) => call<OperationOutcome>("rebase", { path, onto }),
  fastForward: (path: string, branch: string, target: string) => call<null>("fast_forward", { path, branch, target }),
  cherryPick: (path: string, sha: string) => call<OperationOutcome>("cherry_pick", { path, sha }),
  revert: (path: string, sha: string) => call<OperationOutcome>("revert", { path, sha }),
  reset: (path: string, target: string, mode: ResetMode) => call<null>("reset", { path, target, mode }),
  createTag: (path: string, name: string, at: string | null, message: string | null) =>
    call<null>("create_tag", { path, name, at, message }),
  deleteTag: (path: string, name: string) => call<null>("delete_tag", { path, name }),
  deleteTags: (path: string, names: readonly string[]) => call<BatchOutcome>("delete_tags", { path, names }),
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
  aiProviderTest: (id: string) => call<ProviderStatus>("ai_provider_test", { id }),
  aiProviderModels: (id: string) => call<ModelInfo[]>("ai_models", { providerId: id }),
  aiFeatureConfigList: () => call<AiFeatureSummary[]>("ai_feature_config_list"),
  aiFeatureConfigSet: (feature: AiFeature, providerId: string, modelId: string, promptTemplate: string) =>
    call<AiFeatureSummary>("ai_feature_config_set", { feature, providerId, modelId, promptTemplate }),
  aiFeatureConfigEnable: (feature: AiFeature, enabled: boolean) => call<AiFeatureSummary>("ai_feature_config_enable", { feature, enabled }),
  aiFeatureConfigReset: (feature: AiFeature) => call<AiFeatureSummary>("ai_feature_config_reset", { feature }),
  aiSignIn: (provider: string, id: string, method: AiSignInMethod) => call<ProviderStatus>("ai_sign_in", { provider, id, method }),
  aiGenerateCommitMessage: (path: string, id: string) => call<CommitDraft>("ai_generate_commit_message", { path, id }),
  aiGenerateAmendMessage: (path: string, id: string) => call<CommitDraft>("ai_generate_amend_message", { path, id }),
  lspStart: (path: string, file: string) => call<LspStarted>("lsp_start", { path, file }),
  lspSend: (id: string, body: string) => call<null>("lsp_send", { id, body }),
  lspStop: (id: string) => call<null>("lsp_stop", { id }),
  aiProposeRecompose: (path: string, id: string, base: string) => call<RecomposeProposal>("ai_propose_recompose", { path, id, base }),
  aiProposeConflict: (path: string, id: string, file: string) => call<ConflictProposal>("ai_propose_conflict", { path, id, file }),
  aiExplainChanges: (path: string, id: string) => call<Explanation>("ai_explain_changes", { path, id }),
  aiExplainCommit: (path: string, id: string, sha: string) => call<Explanation>("ai_explain_commit", { path, id, sha }),
  aiComposeCommits: (path: string, id: string) => call<ComposeProposal>("ai_compose_commits", { path, id }),
  composeApply: (path: string, groups: readonly ComposeGroup[]) => call<string[]>("compose_apply", { path, groups }),
  aiStashMessage: (path: string, id: string) => call<StashDraft>("ai_stash_message", { path, id }),
  aiPullRequestContext: (path: string, source: string, target: string) => call<PullRequestDisclosure>("ai_pull_request_context", { path, source, target }),
  aiComposePullRequest: (path: string, id: string, source: string, target: string, template: string) => call<PullRequestDraft>("ai_compose_pull_request", { path, id, source, target, template }),
  branchComparison: (path: string, source: string, target: string) => call<BranchComparison>("branch_comparison", { path, source, target }),
  mergePrediction: (path: string, id: string, ours: string, theirs: string) => call<MergePrediction>("merge_prediction", { path, id, ours, theirs }),
  pullRequestTemplate: (path: string) => call<string | null>("pull_request_template", { path }),
  platformConnectionsList: () => call<PlatformConnection[]>("platform_connections_list"),
  platformConnectionAdd: (kind: PlatformKind, host: string, name: string, token: string, insecureTls: boolean) =>
    call<PlatformConnection>("platform_connection_add", { kind, host, name, token, insecureTls }),
  platformConnectionRemove: (id: string) => call<null>("platform_connection_remove", { id }),
  platformConnectionTest: (id: string) => call<string>("platform_connection_test", { id }),
  platformRepoMatch: (path: string) => call<MatchedRepo | null>("platform_repo_match", { path }),
  platformPrsList: (path: string, state: PrListState) => call<PullList>("platform_prs_list", { path, state }),
  platformPrDetail: (path: string, number: number) => call<PrDetail>("platform_pr_detail", { path, number }),
  platformPrChecks: (path: string, number: number) => call<PullChecks | null>("platform_pr_checks", { path, number }),
  platformPrCreate: (path: string, input: CreatePull) => call<PullRequest>("platform_pr_create", { path, input }),
  platformPrMerge: (path: string, number: number) => call<PullRequest>("platform_pr_merge", { path, number }),
  platformMyPulls: (id: string) => call<LaunchpadPulls>("platform_my_pulls", { id }),
  launchpadWips: () => call<Wip[]>("launchpad_wips"),
  jiraConnectionsList: () => call<JiraConnection[]>("jira_connections_list"),
  jiraConnectionAdd: (kind: JiraKind, site: string, email: string | null, token: string) =>
    call<JiraConnection>("jira_connection_add", { kind, site, email, token }),
  jiraConnectionRemove: (id: string) => call<null>("jira_connection_remove", { id }),
  jiraConnectionTest: (id: string) => call<string>("jira_connection_test", { id }),
  jiraFieldProblem: (field: string, value: string) => call<string | null>("jira_field_problem", { field, value }),
  jiraMyIssues: (id: string) => call<JiraIssueList>("jira_my_issues", { id }),
  jiraIssuesLookup: (keys: string[]) => call<JiraIssueLookup[]>("jira_issues_lookup", { keys }),
  jiraIssueKeys: (texts: string[]) => call<string[][]>("jira_issue_keys", { texts }),
  jiraBranchName: (key: string, summary: string) => call<string>("jira_branch_name", { key, summary }),
  searchCommits: (path: string, query: string, visibility?: GraphVisibility) =>
    call<SearchResult>("search_commits", visibility === undefined ? { path, query } : { path, query, visibility }),
  fileAtRevision: (path: string, file: string, rev: string) => call<FileAtRevision>("file_at_revision", { path, file, rev }),
  previewStart: (path: string, file: string, rev: string) => call<[string, string]>("preview_start", { path, file, rev }),
  previewStop: (id: string) => call<void>("preview_stop", { id }),
  worktreeFiles: (path: string) => call<string[]>("worktree_files", { path }),
  fileEditable: (path: string, file: string) => call<EditableFile>("file_editable", { path, file }),
  fileCreate: (path: string, file: string) => call<null>("file_create", { path, file }),
  fileSave: (path: string, file: string, text: string, eol: string) => call<null>("file_save", { path, file, text, eol }),
  fileDelete: (path: string, file: string) => call<null>("file_delete", { path, file }),
  discardAll: (path: string) => call<null>("discard_all", { path }),
  patchCreate: (path: string, files: string[] | null, destination: string) => call<null>("patch_create", { path, files, destination }),
  patchApply: (path: string, patch: string) => call<null>("patch_apply", { path, patch }),
  maintenanceRun: (path: string, id: string) => call<null>("maintenance_run", { path, id }),
  cliInstall: () => call<CliInstall>("cli_install"),
  stashDetails: (path: string, index: number, sha: string) => call<StashDetails>("stash_details", { path, index, sha }),
  stashFileDiff: (path: string, index: number, sha: string, file: string, ignoreWhitespace = false) =>
    call<FileDiff>("stash_file_diff", ignoreWhitespace ? { path, index, sha, file, ignoreWhitespace } : { path, index, sha, file }),
  repoUiPrefsLoad: (path: string) => call<RepoUiPrefs>("repo_ui_prefs_load", { path }),
  repoUiPrefsSave: (path: string, prefs: RepoUiPrefs) => call<null>("repo_ui_prefs_save", { path, prefs }),
  appUiPrefsLoad: () => call<AppUiPrefs>("app_ui_prefs_load"),
  appUiPrefsSave: (prefs: AppUiPrefs) => call<null>("app_ui_prefs_save", { prefs }),
  cloneRepo: (id: string, url: string, destination: string, options: CloneOptions) =>
    call<string>("clone_repo", { id, url, destination, options }),
  initRepo: (path: string) => call<string>("init_repo", { path }),
  settingsLoad: () => call<AppSettings>("settings_load"),
  settingsSave: (settings: AppSettings) => call<AppSettings>("settings_save", { settings }),
  repoSettingsLoad: (path: string) => call<RepoSettings>("repo_settings_load", { path }),
  repoSettingsSave: (path: string, settings: RepoSettings) => call<null>("repo_settings_save", { path, settings }),
  identityRead: (path: string | null) => call<Identity>("identity_read", { path }),
  avatarUrl: (email: string) => call<string | null>("avatar_url", { email }),
  avatarInitial: (name: string) => call<string>("avatar_initial", { name }),
  providerFieldProblem: (kind: ProviderKind, field: string, value: string) =>
    call<string | null>("provider_field_problem", { kind, field, value }),
  connectionFieldProblem: (field: string, value: string) =>
    call<string | null>("connection_field_problem", { field, value }),
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
  repositoriesList: () => call<Repositories>("repositories_list"),
  folderScan: (root: string, depth: number) => call<FolderScan>("folder_scan", { root, depth }),
  scanFolderSave: (folder: ScannedFolder) => call<Repositories>("scan_folder_save", { folder }),
  scanFolderRescan: (root: string) => call<Rescan>("scan_folder_rescan", { root }),
  scanFolderRemove: (root: string) => call<FolderRemoved>("scan_folder_remove", { root }),
  repositoryRemove: (path: string) => call<RepoRemoved>("repository_remove", { path }),
  repositoryRestore: (repo: ManagedRepo) => call<Repositories>("repository_restore", { repo }),
  sessionLoad: () => call<TabSession>("session_load"),
  sessionSave: (session: TabSession) => call<null>("session_save", { session }),
  repoAliasesList: () => call<RepoAlias[]>("repo_aliases_list"),
  repoAliasSet: (path: string, alias: string | null) => call<RepoAlias[]>("repo_alias_set", { path, alias }),
  updateCheck: () => call<UpdateCheck>("update_check"),
  updateInstall: () => call<null>("update_install"),
  menuUpdate: (enabled: Record<string, boolean>, checked: Record<string, boolean>) => call<null>("menu_update", { enabled, checked }),
  openPath: (path: string, with_: OpenWith) => call<null>("open_path", { path, with: with_ }),
  externalToolsLoad: () => call<ToolChoices>("external_tools_load"),
  externalToolsSave: (choices: ToolChoices) => call<ToolChoices>("external_tools_save", { choices }),
  externalToolsDetected: (path: string | null) => call<ToolsDetected>("external_tools_detected", { path }),
  externalToolsStatus: (path: string | null) => call<ExternalToolsStatus>("external_tools_status", { path }),
  openInEditor: (path: string, file: string | null) => call<null>("open_in_editor", { path, file }),
  openInDiffTool: (path: string, file: string, source: DiffToolSource) => call<null>("open_in_diff_tool", { path, file, source }),
  openInMergeTool: (path: string, file: string) => call<null>("open_in_merge_tool", { path, file }),
  profiles: () => call<ProfileList>("profiles_list"),
  profileSave: (id: string | null, draft: ProfileDraft) => call<Profile>("profile_save", { id, draft }),
  profileDelete: (id: string) => call<null>("profile_delete", { id }),
  profileSwitch: (id: string) => call<null>("profile_switch", { id }),
  lfsStatus: (path: string) => call<LfsStatus>("lfs_status", { path }),
  lfsInitialize: (path: string) => call<null>("lfs_initialize", { path }),
  lfsTrack: (path: string, pattern: string) => call<null>("lfs_track", { path, pattern }),
  lfsUntrack: (path: string, pattern: string) => call<null>("lfs_untrack", { path, pattern }),
  signingRead: (scope: SigningScope, path: string | null) => call<SigningConfig>("signing_read", { scope, path }),
  signingWrite: (scope: SigningScope, path: string | null, config: SigningConfig) => call<null>("signing_write", { scope, path, config }),
  signingKeys: (program: string) => call<SigningKey[]>("signing_keys", { program }),
  openUrl: (url: string): void => {
    if (!/^https?:\/\//i.test(url)) throw new IpcError({ kind: "invalid_request", message: `${url} is not an http or https address` });
    window.open(url, "_blank", "noopener,noreferrer");
  },
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
  redo: (path: string) => call<string>("redo_last", { path }),
  trackedFiles: (path: string) => call<string[]>("tracked_files", { path }),
  setZoom: (factor: number): Promise<void> => getCurrentWebview().setZoom(factor),
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
  onLspMessage: (handler: (message: LspEvent) => void): Promise<UnlistenFn> =>
    listen<LspEvent>("lsp-message", (event) => handler(event.payload)),
  onLspError: (handler: (message: LspEvent) => void): Promise<UnlistenFn> =>
    listen<LspEvent>("lsp-error", (event) => handler(event.payload)),
  onHookOutput: (handler: (output: HookOutput) => void): Promise<UnlistenFn> =>
    listen<HookOutput>(HOOK_OUTPUT_EVENT, (event) => handler(event.payload)),
  onAuthPrompt: (handler: (event: AuthPromptEvent) => void): Promise<UnlistenFn> =>
    listen<AuthPromptEvent>(AUTH_PROMPT_EVENT, (event) => handler(event.payload)),
  onActivity: (handler: (entry: ActivityEntry) => void): Promise<UnlistenFn> =>
    listen<ActivityEntry>(ACTIVITY_EVENT, (event) => handler(event.payload)),
  onRedoChanged: (handler: (change: RedoChange) => void): Promise<UnlistenFn> =>
    listen<RedoChange>(REDO_EVENT, (event) => handler(event.payload)),
  onAiSignIn: (handler: (event: AiSignInEvent) => void): Promise<UnlistenFn> =>
    listen<AiSignInEvent>(AI_SIGN_IN_EVENT, (event) => handler(event.payload)),
  onOpenPathRequested: (handler: (request: OpenPathRequested) => void): Promise<UnlistenFn> =>
    listen<OpenPathRequested>(OPEN_PATH_REQUESTED_EVENT, (event) => handler(event.payload)),
  onMenuAction: (handler: (id: string) => void): Promise<UnlistenFn> => listen<string>(MENU_ACTION_EVENT, (event) => handler(event.payload)),
  onRepoChanged: (handler: (change: RepoChanged) => void): Promise<UnlistenFn> =>
    listen<RepoChanged>(REPO_CHANGED_EVENT, (event) => handler(event.payload)),
};
