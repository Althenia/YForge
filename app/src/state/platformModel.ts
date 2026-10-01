import type { IconName } from "../iconNames";
import { client, IpcError } from "../ipc/client";
import type { PlatformKind } from "../ipc/bindings/PlatformKind";
import type { PrFile } from "../ipc/bindings/PrFile";
import type { PrState } from "../ipc/bindings/PrState";
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

const FILE_LETTERS: Record<string, string> = { added: "A", modified: "M", removed: "D", renamed: "R" };

export const fileLetter = (status: string): string => FILE_LETTERS[status] ?? "M";

const FILE_WORDS: Record<string, string> = { added: "Added", modified: "Modified", removed: "Deleted", renamed: "Renamed" };

export const fileWord = (status: string): string => FILE_WORDS[status] ?? "Modified";

const FILE_BADGES: Record<string, string> = { added: "st-added", modified: "st-modified", removed: "st-deleted", renamed: "st-renamed" };

export const fileBadgeClass = (status: string): string => FILE_BADGES[status] ?? "st-modified";

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
