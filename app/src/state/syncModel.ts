import { relativeAge } from "../format";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { PullOutcome } from "../ipc/bindings/PullOutcome";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { MenuEntry } from "./refMenu";
import { SHORTCUTS } from "./shortcuts";

export const FRESH_SECONDS = 15 * 60;

export type NextStep = "pull" | "push";

export type OperationResult = { outcome: string; next: NextStep | undefined };

export type SyncState =
  | { kind: "idle" }
  | { kind: "running"; id: string; label: string; phase: string | undefined; percent: number | null; cancellable: boolean }
  | ({ kind: "done"; baseline: string } & OperationResult)
  | { kind: "failed"; message: string; hint: string; fix: AuthFix };

export function refsKey(snapshot: RepoSnapshot): string {
  const head = snapshot.head;
  const counts = snapshot.upstream?.ahead_behind;
  return [head.kind, head.kind === "branch" ? head.name : "", head.kind === "unborn" ? head.branch : head.sha, snapshot.upstream?.name ?? "", counts?.ahead ?? "", counts?.behind ?? "", snapshot.operation ?? ""].join("|");
}

const tracked = (snapshot: RepoSnapshot) => {
  const counts = snapshot.upstream?.ahead_behind;
  return snapshot.head.kind === "branch" && snapshot.upstream != null && counts != null ? { branch: snapshot.head.name, upstream: snapshot.upstream.name, ...counts } : undefined;
};

const commits = (count: number, adjective = "") => `${count.toLocaleString("en-US")} ${adjective}commit${count === 1 ? "" : "s"}`;

export function nextStepOf(snapshot: RepoSnapshot): NextStep | undefined {
  const state = tracked(snapshot);
  if (state === undefined) return undefined;
  return state.behind > 0 ? "pull" : state.ahead > 0 ? "push" : undefined;
}

export function fetchedCommits(before: RepoSnapshot, after: RepoSnapshot): number {
  const state = tracked(after);
  if (state === undefined) return 0;
  const earlier = tracked(before);
  const known = earlier !== undefined && earlier.branch === state.branch && earlier.upstream === state.upstream ? earlier.behind : 0;
  return Math.max(0, state.behind - known);
}

export function fetchResult(before: RepoSnapshot, after: RepoSnapshot, prune: boolean): OperationResult {
  const state = tracked(after);
  if (state === undefined) return { outcome: prune ? "Fetched and pruned all remotes" : "Fetched all remotes", next: undefined };
  const fresh = fetchedCommits(before, after);
  return { outcome: fresh === 0 ? `No new commits on ${state.upstream}` : `${commits(fresh, "new ")} on ${state.upstream}`, next: state.behind > 0 ? "pull" : undefined };
}

export function pushResult(verb: "Pushed" | "Force pushed" | "Published", after: RepoSnapshot, destination?: string): OperationResult {
  const branch = after.head.kind === "branch" ? after.head.name : "HEAD";
  return { outcome: `${verb} ${branch} to ${destination ?? after.upstream?.name ?? "its remote"}`, next: undefined };
}

export function pullResult(outcome: PullOutcome, after: RepoSnapshot): OperationResult | undefined {
  const state = tracked(after);
  if (outcome === "conflicts" || state === undefined) return undefined;
  const next = state.ahead > 0 ? "push" : undefined;
  return outcome === "updated" ? { outcome: `Updated ${state.branch} from ${state.upstream}`, next } : { outcome: `${state.branch} is up to date with ${state.upstream}`, next };
}

export type Freshness = { tone: "fresh" | "stale" | "never"; text: string };

export function freshness(lastFetch: number | null, now: number, hasRemotes: boolean): Freshness | undefined {
  if (!hasRemotes) return undefined;
  if (lastFetch === null) return { tone: "never", text: "Never fetched" };
  const age = Math.max(0, now - lastFetch);
  const text = age < 60 ? "Fetched just now" : `Fetched ${relativeAge(lastFetch, now)} ago`;
  return { tone: age <= FRESH_SECONDS ? "fresh" : "stale", text };
}

export const pullModes: ReadonlyArray<{ mode: PullMode; label: string }> = [
  { mode: "fast_forward_only", label: "Pull: fast-forward only" },
  { mode: "fast_forward_or_merge", label: "Pull: fast-forward, merge if needed" },
  { mode: "rebase", label: "Pull: rebase" },
];

export const DEFAULT_PULL_MODE: PullMode = "fast_forward_or_merge";

export function isDiverged(snapshot: Pick<RepoSnapshot, "upstream">): boolean {
  const counts = snapshot.upstream?.ahead_behind;
  return counts != null && counts.ahead > 0 && counts.behind > 0;
}

export const OFFLINE_REASON = "You are offline";

export const DIVERGED_PUSH_REASON = "This branch has diverged. Force push with lease is in the status strip.";

export function divergedPushDetail(commits: ReadonlyArray<{ sha: string; summary: string }>, count: number): string {
  const first = commits[0];
  const line = first === undefined ? undefined : `${first.sha.slice(0, 7)} ${first.summary}`;
  if (line === undefined) return count === 1 ? "1 remote commit would be replaced" : `${count.toLocaleString("en-US")} remote commits would be replaced`;
  if (count <= 1) return `${line} would be replaced`;
  return `${line} and ${(count - 1).toLocaleString("en-US")} more would be replaced`;
}

const withReason = (reason: string | undefined) => (reason === undefined ? {} : { disabledReason: reason });

function syncReasons(snapshot: RepoSnapshot, busy: boolean, offline: boolean) {
  const onBranch = snapshot.head.kind === "branch";
  const operation = snapshot.operation !== null;
  const noRemotes = snapshot.remotes.length === 0;
  const blocked = (reason: string | undefined) => (busy ? "Another sync is running" : operation ? "Finish the operation in progress first" : offline ? OFFLINE_REASON : reason);
  return {
    onBranch,
    fetch: blocked(noRemotes ? "This repository has no remotes" : undefined),
    pull: blocked(!onBranch ? "Check out a branch to pull" : snapshot.upstream === null ? "No upstream branch to pull from" : undefined),
    push: blocked(!onBranch ? "Check out a branch to push" : noRemotes ? "This repository has no remotes" : undefined),
    upstream: onBranch ? (noRemotes ? "This repository has no remotes" : undefined) : "Check out a branch to set its upstream",
  };
}

export function fetchMenu(snapshot: RepoSnapshot, busy: boolean, offline = false): MenuEntry[] {
  const reason = syncReasons(snapshot, busy, offline).fetch;
  return [
    { kind: "item", id: "fetch", label: ["Fetch all"], icon: "fetch", shortcut: SHORTCUTS.fetch, ...withReason(reason) },
    { kind: "item", id: "fetch_prune", label: ["Fetch all and prune"], icon: "fetch", note: "removes deleted remote branches", ...withReason(reason) },
  ];
}

export function pullMenu(snapshot: RepoSnapshot, busy: boolean, defaultMode: PullMode = DEFAULT_PULL_MODE, offline = false): MenuEntry[] {
  const reason = syncReasons(snapshot, busy, offline).pull;
  return pullModes.map<MenuEntry>((entry) => ({
    kind: "item",
    id: `pull:${entry.mode}`,
    label: [entry.label],
    icon: "pull",
    ...(entry.mode === defaultMode ? { note: "default", shortcut: SHORTCUTS.pull } : {}),
    ...withReason(reason),
  }));
}

export function syncMenu(snapshot: RepoSnapshot, busy: boolean, defaultMode: PullMode = DEFAULT_PULL_MODE, offline = false): MenuEntry[] {
  const reasons = syncReasons(snapshot, busy, offline);
  return [
    ...fetchMenu(snapshot, busy, offline),
    { kind: "separator" },
    ...pullMenu(snapshot, busy, defaultMode, offline),
    { kind: "separator" },
    {
      kind: "item",
      id: "push",
      label: [snapshot.upstream === null && reasons.onBranch ? "Push and set upstream" : "Push"],
      icon: "push",
      shortcut: SHORTCUTS.push,
      ...withReason(isDiverged(snapshot) && reasons.push === undefined ? DIVERGED_PUSH_REASON : reasons.push),
    },
    { kind: "item", id: "push_to", label: ["Push to…"], icon: "push", ...withReason(reasons.push) },
    { kind: "item", id: "set_upstream", label: ["Set upstream…"], ...withReason(reasons.upstream) },
  ];
}

export const AUTH_HINT = "Check the username, token, or SSH key for this remote, then retry. You will be asked for them again.";

export type AuthFix = { section: string; label: string };

export function authFailure(message: string): { text: string; hint: string; remote: string | undefined } {
  const remote = /^Authentication failed for (.+)$/.exec(message)?.[1];
  return { text: `auth failed for ${remote ?? "the remote"}`, hint: AUTH_HINT, remote };
}

export const authFix = (remoteUrl: string | undefined): AuthFix =>
  remoteUrl !== undefined && (remoteUrl.startsWith("ssh://") || /^[\w.-]+@[\w.-]+:/.test(remoteUrl))
    ? { section: "git", label: "Choose an SSH key" }
    : { section: "repository", label: "Check the remote" };

export function runningText(state: Extract<SyncState, { kind: "running" }>): string {
  const phase = state.phase === undefined ? state.label : state.phase.startsWith(state.label) ? state.phase : `${state.label} · ${state.phase}`;
  return state.percent === null ? phase : `${phase} ${state.percent}%`;
}
