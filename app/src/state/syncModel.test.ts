import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { authFailure, authFix, AUTH_HINT, DEFAULT_PULL_MODE, fetchMenu, freshness, FRESH_SECONDS, isDiverged, OFFLINE_REASON, pullMenu, pullModes, runningText, syncMenu } from "./syncModel";
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

describe("fetch and pull menus", () => {
  it("keeps the fetch caret to fetch and prune, and the pull caret to the three modes", () => {
    const fetched = fetchMenu(snapshot(), false);
    const pulled = pullMenu(snapshot(), false);

    expect(fetched.map((entry) => entry.kind === "item" ? entry.id : "-")).toEqual(["fetch", "fetch_prune"]);
    expect(pulled.map((entry) => entry.kind === "item" ? entry.id : "-")).toEqual(["pull:fast_forward_only", "pull:fast_forward_or_merge", "pull:rebase"]);
    expect(pulled.find((entry) => entry.kind === "item" && entry.note === "default")).toMatchObject({ id: `pull:${DEFAULT_PULL_MODE}` });
    for (const entries of [fetched, pulled]) {
      expect(entries.some((entry) => entry.kind === "item" && (entry.id === "push" || entry.id === "push_to" || entry.id === "set_upstream"))).toBe(false);
    }
  });
});

describe("sync menu", () => {
  it("lists the entries of specimen 06 with fast-forward-or-merge marked as the default", () => {
    const entries = syncMenu(snapshot(), false);

    expect(entries.map((entry) => (entry.kind === "separator" ? "-" : entry.id))).toEqual([
      "fetch",
      "fetch_prune",
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

  it("enables fetch, prune, pull, push, Push to…, and set upstream on a tracked branch", () => {
    const state = reasons(syncMenu(snapshot(), false));

    for (const id of ["fetch", "fetch_prune", "pull:rebase", "push", "push_to", "set_upstream"]) expect(state[id]).toBeUndefined();
  });

  it("shows the shortcut of each command that has one: fetch, the default pull mode, and push", () => {
    const shortcuts = Object.fromEntries(syncMenu(snapshot(), false).flatMap((entry) => (entry.kind === "item" ? [[entry.id, entry.shortcut]] : [])));

    expect(shortcuts.fetch).toBe("⌘⇧F");
    expect(shortcuts[`pull:${DEFAULT_PULL_MODE}`]).toBe("⌘⇧L");
    expect(shortcuts["pull:rebase"]).toBeUndefined();
    expect(shortcuts.push).toBe("⌘⇧P");
    expect(shortcuts.fetch_prune).toBeUndefined();
  });

  it("explains how prune differs from a plain fetch", () => {
    const prune = syncMenu(snapshot(), false).find((entry) => entry.kind === "item" && entry.id === "fetch_prune");
    expect(prune).toMatchObject({ label: ["Fetch all and prune"], note: "removes deleted remote branches" });
  });

  it("disables the network entries with a reason while the machine is offline", () => {
    const state = reasons(syncMenu(snapshot(), false, DEFAULT_PULL_MODE, true));

    for (const id of ["fetch", "fetch_prune", "pull:rebase", "push", "push_to"]) expect(state[id]).toBe(OFFLINE_REASON);
    expect(state.set_upstream).toBeUndefined();
  });

  it("sets an upstream only for a checked-out branch and needs a remote to push to", () => {
    expect(reasons(syncMenu(snapshot({ head: { kind: "detached", sha: "a" } }), false)).set_upstream).toBe("Check out a branch to set its upstream");
    expect(reasons(syncMenu(snapshot({ remotes: [] }), false)).push_to).toBe("This repository has no remotes");
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
    expect(authFailure("Authentication failed for origin")).toEqual({ text: "auth failed for origin", hint: AUTH_HINT, remote: "origin" });
    expect(authFailure("something else")).toEqual({ text: "auth failed for the remote", hint: AUTH_HINT, remote: undefined });
  });

  it("sends an SSH remote to the SSH key setting and any other remote to the repository's remotes", () => {
    const ssh = { section: "git", label: "Choose an SSH key" };
    expect(authFix("git@github.com:o/r.git")).toEqual(ssh);
    expect(authFix("ssh://git@host/o/r.git")).toEqual(ssh);
    const https = { section: "repository", label: "Check the remote" };
    expect(authFix("https://github.com/o/r.git")).toEqual(https);
    expect(authFix(undefined)).toEqual(https);
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
