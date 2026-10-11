import type { LabelGroup } from "../graph/refLabels";
import type { IconName } from "../iconNames";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import { statusIcon, statusWord } from "./changes";
import { client, IpcError } from "../ipc/client";
import type { PlatformKind } from "../ipc/bindings/PlatformKind";
import type { PrFile } from "../ipc/bindings/PrFile";
import type { PrState } from "../ipc/bindings/PrState";
import type { PullChecks } from "../ipc/bindings/PullChecks";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import type { ConfirmCopy } from "./confirmCopy";

export type PlatformCard = { kind: PlatformKind; title: string; icon: IconName; hostPlaceholder: string };

export const PLATFORM_CARDS: readonly PlatformCard[] = [
  { kind: "github", title: "GitHub", icon: "github", hostPlaceholder: "github.com" },
  { kind: "gitlab", title: "GitLab", icon: "gitlab", hostPlaceholder: "gitlab.com" },
  { kind: "bitbucket", title: "Bitbucket", icon: "bitbucket", hostPlaceholder: "bitbucket.org" },
];

export const cardOfPlatform = (kind: PlatformKind): PlatformCard => PLATFORM_CARDS.find((card) => card.kind === kind) as PlatformCard;

export type ConnectionDraft = { kind: PlatformKind; host: string; name: string; token: string; insecureTls: boolean };

export type ConnectionProblems = { host?: string; name?: string; token?: string };

export type ConnectionProblem = keyof ConnectionProblems;

/// The field labels the core validates, in the order the form shows them.
export const CONNECTION_FIELDS: readonly ConnectionProblem[] = ["host", "name", "token"];

/// Asks the core which problem (if any) a field has, so the form and the save agree.
export async function connectionFieldProblem(field: ConnectionProblem, value: string): Promise<string | undefined> {
  return (await client.connectionFieldProblem(field, value)) ?? undefined;
}

export type PlatformFailure = { message: string; action?: "edit_connection" };

export function platformFailure(failure: unknown): PlatformFailure {
  if (!(failure instanceof IpcError)) return { message: failure instanceof Error ? failure.message : String(failure) };
  switch (failure.kind) {
    case "auth_failed":
      return { message: failure.message, action: "edit_connection" };
    case "storage_failed":
      return { message: `YForge could not use its saved connections or the macOS Keychain: ${failure.message}` };
    default:
      return { message: failure.message };
  }
}

export type PrStateView = { label: string; tone: "ok" | "info" | "danger"; icon: IconName };

export function prStateView(state: PrState): PrStateView {
  switch (state) {
    case "open":
      return { label: "Open", tone: "ok", icon: "pullrequest" };
    case "merged":
      return { label: "Merged", tone: "info", icon: "merge" };
    case "closed":
      return { label: "Closed", tone: "danger", icon: "close" };
  }
}

export type MergeabilityView = { label: string; tone: "ok" | "info" | "attention" | "muted"; detail?: string };

export function mergeabilityView(pull: PullRequest): MergeabilityView {
  if (pull.state === "merged") return { label: "Already merged", tone: "info" };
  if (pull.state === "closed") return { label: "Closed without merging", tone: "muted" };
  if (pull.mergeable === true) return { label: "Can be merged", tone: "ok" };
  if (pull.mergeable === false) return { label: "Cannot be merged yet", tone: "attention", detail: "The platform reports conflicts or a blocked merge." };
  return { label: "—", tone: "muted", detail: "The platform has not reported whether this can be merged." };
}

export const fileStatus = (status: string): FileStatus => status === "removed" ? "deleted" : Object.hasOwn(statusIcon, status) ? status as FileStatus : "modified";

export const fileWord = (status: string): string => statusWord[fileStatus(status)];

export const fileBadgeClass = (status: string): string => `st-${fileStatus(status)}`;

export const epochSeconds = (timestamp: string): number => Math.floor(Date.parse(timestamp) / 1000);

export function changeTotals(files: readonly PrFile[]): { additions: number; deletions: number } {
  return files.reduce((total, file) => ({ additions: total.additions + file.additions, deletions: total.deletions + file.deletions }), { additions: 0, deletions: 0 });
}

export function mergeCopy(pull: PullRequest, platform: string): ConfirmCopy {
  return {
    title: `Merge pull request #${pull.number}?`,
    ...(pull.mergeable === false ? { lead: `${platform} reports conflicts or a blocked merge, so the merge may be refused.` } : {}),
    names: [pull.title],
    consequences: [
      `Merges ${pull.source_ref} into ${pull.target_ref} on ${platform}. The merge happens on the server and cannot be undone from YForge.`,
      "YForge then fetches all remotes so your remote-tracking branches catch up. Your local branches are not changed.",
    ],
    confirmLabel: "Merge pull request",
    neutral: true,
  };
}

export function defaultTarget(remoteBranches: readonly string[], remote: string): string | undefined {
  const names = remoteBranches.filter((name) => name.startsWith(`${remote}/`)).map((name) => name.slice(remote.length + 1)).filter((name) => name !== "HEAD");
  return names.find((name) => name === "main") ?? names.find((name) => name === "master") ?? names[0];
}

export type PullDraft = { source: string; target: string; title: string; body: string };

export type PullProblems = { source?: string; target?: string; title?: string };

export function pullProblems(draft: PullDraft): PullProblems {
  const problems: PullProblems = {};
  if (draft.source === "") problems.source = "Choose the branch to merge";
  if (draft.target === "") problems.target = "Choose the branch to merge into";
  else if (draft.target === draft.source) problems.target = "Choose a different target branch";
  if (draft.title.trim() === "") problems.title = "Enter a title";
  return problems;
}

export type PullLookup = { remote: string; byBranch: ReadonlyMap<string, PullRequest> };

export function pullLookup(remote: string, pulls: readonly PullRequest[]): PullLookup {
  const byBranch = new Map<string, PullRequest>();
  for (const pull of pulls) if (pull.state === "open" && !byBranch.has(pull.source_ref)) byBranch.set(pull.source_ref, pull);
  return { remote, byBranch };
}

export const pullOfLocal = (lookup: PullLookup | undefined, branch: string): PullRequest | undefined => lookup?.byBranch.get(branch);

export function pullOfRemote(lookup: PullLookup | undefined, remoteBranch: string): PullRequest | undefined {
  const prefix = lookup === undefined ? undefined : `${lookup.remote}/`;
  return prefix !== undefined && remoteBranch.startsWith(prefix) ? lookup?.byBranch.get(remoteBranch.slice(prefix.length)) : undefined;
}

export type ChecksState = PullChecks | null | "loading" | "unavailable";

function checksText(checks: ChecksState): string {
  if (checks === "loading" || checks === "unavailable") return `checks ${checks}`;
  if (checks === null) return "no checks";
  const counts = (["passing", "failing", "pending"] as const).filter((word) => checks[word] > 0).map((word) => `${checks[word]} ${word}`);
  if (counts.length === 0) return "no checks";
  return `checks: ${counts.join(", ")}${checks.capped ? ", more not counted" : ""}`;
}

export function pullBadgeName(pull: PullRequest, checks: ChecksState): string {
  return `Pull request #${pull.number}: ${pull.title} · ${pull.draft ? "Draft" : "Open"} · ${pull.source_ref} → ${pull.target_ref} · ${checksText(checks)}`;
}

export function pullOfGroup(lookup: PullLookup | undefined, group: LabelGroup): PullRequest | undefined {
  if (group.tag) return undefined;
  if (group.local) return pullOfLocal(lookup, group.name);
  return group.remoteRef === undefined ? undefined : pullOfRemote(lookup, group.remoteRef);
}

export const COMPOSE_NEEDS_PLATFORM = "Connect this repository's platform in Settings → Platforms to compose a pull request";
