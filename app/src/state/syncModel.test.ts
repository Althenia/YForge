import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { authFailure, AUTH_HINT, DEFAULT_PULL_MODE, freshness, FRESH_SECONDS, isDiverged, pullModes, runningText, syncMenu } from "./syncModel";
import type { MenuEntry } from "./refMenu";

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    head: { kind: "branch", name: "main", sha: "a" },
    upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
    remotes: ["origin"],
    operation: null,
    ...overrides,
  }) as RepoSnapshot;

const reasons = (entries: MenuEntry[]) =>
  Object.fromEntries(entries.flatMap((entry) => (entry.kind === "item" ? [[entry.id, entry.disabledReason]] : [])));

describe("fetch freshness", () => {
  const now = 1_000_000;

  it("has no chip without remotes and reports a repository that was never fetched", () => {
    expect(freshness(null, now, false)).toBeUndefined();
    expect(freshness(null, now, true)).toEqual({ tone: "never", text: "Never fetched" });
  });

  it("is fresh up to the freshness window and stale after it", () => {
    expect(freshness(now - 30, now, true)).toEqual({ tone: "fresh", text: "Fetched just now" });
    expect(freshness(now - 5 * 60, now, true)).toEqual({ tone: "fresh", text: "Fetched 5m ago" });
    expect(freshness(now - FRESH_SECONDS, now, true)?.tone).toBe("fresh");
    expect(freshness(now - FRESH_SECONDS - 1, now, true)?.tone).toBe("stale");
    expect(freshness(now - 3 * 3600, now, true)?.text).toBe("Fetched 3h ago");
  });
});

describe("sync menu", () => {
  it("lists the entries of specimen 06 with fast-forward-or-merge marked as the default", () => {
    const entries = syncMenu(snapshot(), false);

    expect(entries.map((entry) => (entry.kind === "separator" ? "-" : entry.id))).toEqual([
      "fetch",
      "-",
      "pull:fast_forward_only",
      "pull:fast_forward_or_merge",
      "pull:rebase",
      "-",
      "push",
      "push_to",
      "set_upstream",
    ]);
    const defaults = entries.filter((entry) => entry.kind === "item" && entry.note === "default");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toMatchObject({ id: `pull:${DEFAULT_PULL_MODE}` });
    expect(pullModes.map((entry) => entry.mode)).toEqual(["fast_forward_only", "fast_forward_or_merge", "rebase"]);
  });

  it("enables fetch, pull, and push on a tracked branch and disables the out-of-scope entries", () => {
    const state = reasons(syncMenu(snapshot(), false));

    expect(state.fetch).toBeUndefined();
    expect(state["pull:rebase"]).toBeUndefined();
    expect(state.push).toBeUndefined();
    expect(state.push_to).toBe("Not available yet");
    expect(state.set_upstream).toBe("Not available yet");
  });

  it("allows the first push of a branch without an upstream but not a pull", () => {
    const entries = syncMenu(snapshot({ upstream: null }), false);
    const state = reasons(entries);

    expect(state["pull:fast_forward_only"]).toBe("No upstream branch to pull from");
    expect(state.push).toBeUndefined();
    expect(entries.find((entry) => entry.kind === "item" && entry.id === "push")).toMatchObject({ label: ["Push and set upstream"] });
  });

  it("disables everything that needs a branch or a remote with the reason", () => {
    const detached = reasons(syncMenu(snapshot({ head: { kind: "detached", sha: "a" }, upstream: null }), false));
    const none = reasons(syncMenu(snapshot({ remotes: [], upstream: null }), false));

    expect(detached.push).toBe("Check out a branch to push");
    expect(detached["pull:rebase"]).toBe("Check out a branch to pull");
    expect(none.fetch).toBe("This repository has no remotes");
    expect(none.push).toBe("This repository has no remotes");
  });

  it("disables sync while another sync runs or an operation is in progress", () => {
    expect(reasons(syncMenu(snapshot(), true)).fetch).toBe("Another sync is running");
    expect(reasons(syncMenu(snapshot({ operation: "merge" }), false)).push).toBe("Finish the operation in progress first");
  });
});

describe("diverged branches", () => {
  it("is diverged only when both ahead and behind are positive", () => {
    const counts = (ahead: number, behind: number) => snapshot({ upstream: { name: "o/m", ahead_behind: { ahead, behind } } });
    expect(isDiverged(counts(2, 1))).toBe(true);
    expect(isDiverged(counts(2, 0))).toBe(false);
    expect(isDiverged(counts(0, 3))).toBe(false);
    expect(isDiverged(snapshot({ upstream: null }))).toBe(false);
    expect(isDiverged(snapshot({ upstream: { name: "o/m", ahead_behind: null } }))).toBe(false);
  });
});

describe("authentication failure copy", () => {
  it("names the remote and gives the next action", () => {
    expect(authFailure("Authentication failed for origin")).toEqual({ text: "auth failed for origin", hint: AUTH_HINT });
    expect(authFailure("something else").text).toBe("auth failed for the remote");
  });
});

describe("running sync text", () => {
  const running = (phase: string | undefined, percent: number | null) => ({ kind: "running" as const, id: "op", label: "Fetching", phase, percent });

  it("shows the label alone before any progress and does not repeat it when the phase starts with it", () => {
    expect(runningText(running(undefined, null))).toBe("Fetching");
    expect(runningText(running("Fetching origin", null))).toBe("Fetching origin");
  });

  it("appends the git phase and its percentage", () => {
    expect(runningText(running("Receiving objects", 42))).toBe("Fetching · Receiving objects 42%");
    expect(runningText(running("Fetching origin", 0))).toBe("Fetching origin 0%");
  });
});

describe("sync menu icons", () => {
  it("marks fetch, every pull mode, and push with their transfer glyphs", () => {
    const icons = syncMenu(snapshot(), false).flatMap((entry) => (entry.kind === "item" ? [[entry.id, entry.icon]] : []));

    expect(icons.filter(([id]) => id === "fetch" || id === "push" || String(id).startsWith("pull:"))).toEqual([
      ["fetch", "fetch"],
      ["pull:fast_forward_only", "pull"],
      ["pull:fast_forward_or_merge", "pull"],
      ["pull:rebase", "pull"],
      ["push", "push"],
    ]);
  });
});
