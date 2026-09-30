import { relativeAge } from "../format";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { NOT_AVAILABLE, type MenuEntry } from "./refMenu";

export const FRESH_SECONDS = 15 * 60;

export type SyncState =
  | { kind: "idle" }
  | { kind: "running"; id: string; label: string; phase: string | undefined; percent: number | null }
  | { kind: "failed"; message: string; hint: string };

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

export function syncMenu(snapshot: RepoSnapshot, busy: boolean, defaultMode: PullMode = DEFAULT_PULL_MODE): MenuEntry[] {
  const onBranch = snapshot.head.kind === "branch";
  const operation = snapshot.operation !== null;
  const noRemotes = snapshot.remotes.length === 0;
  const blocked = (reason: string | undefined) => (busy ? "Another sync is running" : operation ? "Finish the operation in progress first" : reason);
  const fetchReason = blocked(noRemotes ? "This repository has no remotes" : undefined);
  const pullReason = blocked(!onBranch ? "Check out a branch to pull" : snapshot.upstream === null ? "No upstream branch to pull from" : undefined);
  const pushReason = blocked(!onBranch ? "Check out a branch to push" : noRemotes ? "This repository has no remotes" : undefined);
  const withReason = (reason: string | undefined) => (reason === undefined ? {} : { disabledReason: reason });
  return [
    { kind: "item", id: "fetch", label: ["Fetch all"], icon: "fetch", ...withReason(fetchReason) },
    { kind: "separator" },
    ...pullModes.map<MenuEntry>((entry) => ({
      kind: "item",
      id: `pull:${entry.mode}`,
      label: [entry.label],
      icon: "pull",
      ...(entry.mode === defaultMode ? { note: "default" } : {}),
      ...withReason(pullReason),
    })),
    { kind: "separator" },
    { kind: "item", id: "push", label: [snapshot.upstream === null && onBranch ? "Push and set upstream" : "Push"], icon: "push", ...withReason(pushReason) },
    { kind: "item", id: "push_to", label: ["Push to…"], disabledReason: NOT_AVAILABLE },
    { kind: "item", id: "set_upstream", label: ["Set upstream…"], disabledReason: NOT_AVAILABLE },
  ];
}

export const AUTH_HINT = "Check the username, token, or SSH key for this remote, then retry. You will be asked for them again.";

export function authFailure(message: string): { text: string; hint: string } {
  const remote = /^Authentication failed for (.+)$/.exec(message)?.[1];
  return { text: `auth failed for ${remote ?? "the remote"}`, hint: AUTH_HINT };
}

export function runningText(state: Extract<SyncState, { kind: "running" }>): string {
  const phase = state.phase === undefined ? state.label : state.phase.startsWith(state.label) ? state.phase : `${state.label} · ${state.phase}`;
  return state.percent === null ? phase : `${phase} ${state.percent}%`;
}
