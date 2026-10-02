import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StripNotice } from "../state/repoActions";
import type { RepoActions } from "../state/repoActions";
import type { SyncState } from "../state/syncModel";
import { StateStrip } from "./StateStrip";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "feature", sha: "a".repeat(40) },
    upstream: { name: "origin/feature", ahead_behind: { ahead: 2, behind: 1 } },
    counts,
    files: [],
    operation: null,
    operation_detail: null,
    last_fetch: Math.floor(Date.now() / 1000) - 120,
    branches: ["feature"],
    remote_branches: [],
    remotes: ["origin"],
    tags: [],
    stashes: [],
    worktrees: [
      { path: "/r", head: "a", branch: "feature", bare: false, locked: false, prunable: false, current: true },
      { path: "/r-wt", head: "b", branch: "topic", bare: false, locked: false, prunable: false, current: false },
    ],
    ...overrides,
  }) as unknown as RepoSnapshot;

type Setup = { shape?: RepoSnapshot; sync?: SyncState; notices?: StripNotice[]; online?: boolean; paused?: string };

function mount({ shape = snapshot(), sync = { kind: "idle" }, notices = [], online = true, paused }: Setup = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push([name, ...args]);
  const [current, setNotices] = createSignal(notices);
  const actions = {
    sync: () => sync,
    autoFetchPause: () => paused,
    notices: current,
    dismissNotice: (id: string) => {
      calls.push(["dismiss", id]);
      setNotices((list) => list.filter((notice) => notice.id !== id));
    },
    openBranchPicker: record("branch-picker"),
    openPullMenu: record("pull-menu"),
    openCreateBranchAt: record("create-branch-at"),
    fetchAll: record("fetch"),
    retrySync: record("retry"),
    dismissSync: record("dismiss-sync"),
    cancelSync: record("cancel"),
    operationBusy: () => false,
  } as unknown as RepoActions;
  const openChanges = vi.fn();
  const revealHead = vi.fn();
  const openWorktrees = vi.fn();
  const mounted = mountWithApp(() => <StateStrip snapshot={shape} actions={actions} online={online} onOpenChanges={openChanges} onRevealHead={revealHead} onResolve={() => undefined} onOpenWorktrees={openWorktrees} />);
  dispose = mounted.dispose;
  const openSettings = vi.fn();
  mounted.app.openSettings = openSettings;
  return { ...mounted, calls, openChanges, revealHead, openSettings, openWorktrees };
}

const button = (host: ParentNode, name: RegExp) => [...host.querySelectorAll("button")].find((entry) => name.test(entry.getAttribute("aria-label") ?? entry.textContent ?? "")) as HTMLButtonElement;

describe("state strip chips", () => {
  it("reveals HEAD in the graph from the HEAD chip", () => {
    const { host, revealHead } = mount();

    button(host, /^Reveal HEAD/).click();

    expect(revealHead).toHaveBeenCalledOnce();
  });

  it("opens the branch menu from the branch and upstream chip", () => {
    const { host, calls } = mount();

    button(host, /^Branch menu/).click();

    expect(calls.map((call) => call[0])).toEqual(["branch-picker"]);
  });

  it("opens the pull menu from the ahead and behind chip, which states diverged in text", () => {
    const { host, calls } = mount();
    const pull = button(host, /^Pull menu/);

    expect(pull.textContent).toContain("↑2");
    expect(pull.textContent).toContain("↓1");
    expect(pull.textContent).toContain("diverged");
    pull.click();

    expect(calls.map((call) => call[0])).toEqual(["pull-menu"]);
  });

  it("opens the Changes inspector from the Changes chip", () => {
    const { host, openChanges } = mount();

    button(host, /Changes/).click();

    expect(openChanges).toHaveBeenCalledOnce();
  });

  it("fetches now from the fetched chip, and disables it while offline with the reason", () => {
    const { host, calls } = mount();
    button(host, /^Fetched .* Fetch now/).click();
    expect(calls.map((call) => call[0])).toEqual(["fetch"]);
    dispose?.();
    document.body.innerHTML = "";

    const offline = mount({ online: false });
    const chip = button(offline.host, /^Fetched .* Fetch now/);
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe("You are offline");
  });

  it("reads Auto-fetch paused with the reason in text when an automatic fetch failed, and retries the fetch when activated", () => {
    const { host, calls } = mount({ paused: "Authentication failed for origin" });
    const chip = button(host, /^Auto-fetch paused/);

    expect(chip.textContent).toContain("Auto-fetch paused: Authentication failed for origin");
    expect(chip.classList.contains("chip-attention")).toBe(true);
    expect(chip.disabled).toBe(false);
    expect([...host.querySelectorAll("button")].some((entry) => /^Fetched /.test(entry.textContent ?? ""))).toBe(false);
    chip.click();

    expect(calls.map((call) => call[0])).toEqual(["fetch"]);
  });

  it("shows the Offline chip and a disabled fetched chip instead of the paused text while offline", () => {
    const { host } = mount({ paused: "Authentication failed for origin", online: false });

    expect(host.textContent).toContain("Offline");
    expect(host.textContent).not.toContain("Auto-fetch paused");
    const chip = button(host, /^Fetched .* Fetch now/);
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe("You are offline");
  });

  it("ages the fetched chip from fresh to stale as the clock ticks, without a new snapshot", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      const { host } = mount({ shape: snapshot({ last_fetch: Math.floor(Date.now() / 1000) - 5 }) });
      const chip = () => button(host, /^Fetched .* Fetch now/);
      expect(chip().textContent).toContain("Fetched just now");
      expect(chip().classList.contains("chip-success")).toBe(true);

      vi.advanceTimersByTime(3 * 60 * 60 * 1000);
      await flush();

      expect(chip().textContent).toContain("Fetched 3h ago");
      expect(chip().classList.contains("chip-attention")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says detached HEAD at the short id and offers only the HEAD chip", () => {
    const { host } = mount({ shape: snapshot({ head: { kind: "detached", sha: "1a2b3c4d5e6f".padEnd(40, "0") }, upstream: null }) });

    expect(host.textContent).toContain("detached at 1a2b3c4");
    expect(button(host, /^Reveal HEAD/).getAttribute("aria-label")).toBe("Reveal HEAD in the graph: detached at 1a2b3c4");
    expect(button(host, /^Branch menu/)).toBeUndefined();
  });

  it("offers Create branch here only on a detached HEAD and opens the form at that commit", () => {
    const sha = "1a2b3c4d5e6f".padEnd(40, "0");
    const detached = mount({ shape: snapshot({ head: { kind: "detached", sha }, upstream: null }) });

    button(detached.host, /^Create branch here/).click();

    expect(detached.calls).toEqual([["create-branch-at", sha, expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) })]]);
    detached.dispose();
    document.body.innerHTML = "";

    const attached = mount();
    expect(button(attached.host, /^Create branch here/)).toBeUndefined();
  });

  it("names the missing upstream and still opens the branch menu, where Set upstream lives", () => {
    const { host, calls } = mount({ shape: snapshot({ upstream: null }) });

    const chip = button(host, /^Branch menu/);
    expect(chip.textContent).toContain("no upstream");
    chip.click();
    expect(calls.map((call) => call[0])).toEqual(["branch-picker"]);
  });

  it("shows an offline chip in text only while offline", () => {
    expect(mount({ online: false }).host.textContent).toContain("Offline");
    dispose?.();
    document.body.innerHTML = "";
    expect(mount().host.textContent).not.toContain("Offline");
  });
});

describe("worktree chip", () => {
  it("counts the worktrees and those with changes, and opens the Worktrees panel", async () => {
    mockIPC((cmd) =>
      cmd === "worktree_list"
        ? [
            { path: "/r", head: "a", branch: "feature", bare: false, locked: false, prunable: false, current: true, dirty: false },
            { path: "/r-wt", head: "b", branch: "topic", bare: false, locked: true, prunable: false, current: false, dirty: true },
          ]
        : null,
    );
    const { host, openWorktrees } = mount();
    await flush(60);

    const chip = button(host, /worktrees/);
    expect(chip.textContent).toContain("2 worktrees · 1 with changes");
    chip.click();

    expect(openWorktrees).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"][aria-label="Worktrees"]')).toBeNull();
  });
});

describe("authentication failure", () => {
  const failed: SyncState = { kind: "failed", message: "auth failed for origin", hint: "Check credentials", fix: { section: "git", label: "Choose an SSH key" } };

  it("offers Fix, which opens the settings section that holds the credential", () => {
    const { host, openSettings } = mount({ sync: failed });

    button(host, /^Fix/).click();

    expect(openSettings).toHaveBeenCalledWith("git");
    expect(button(host, /^Fix/).title).toBe("Choose an SSH key");
  });
});

describe("strip notices", () => {
  it("shows a notice with its detail and actions, runs an action, and dismisses it", async () => {
    const run = vi.fn();
    const { host, calls } = mount({ notices: [{ id: "n1", text: "Your changes are kept in stash@{0}", detail: "Git could not restore them.", actions: [{ label: "Apply", run }] }] });

    expect(host.textContent).toContain("Your changes are kept in stash@{0}");
    expect(host.textContent).toContain("Git could not restore them.");
    button(host, /^Apply$/).click();
    expect(run).toHaveBeenCalledOnce();
    button(host, /^Dismiss/).click();
    await flush();

    expect(calls).toContainEqual(["dismiss", "n1"]);
    expect(host.textContent).not.toContain("kept in stash");
  });

  it("keeps the notice visible while a merge or rebase banner replaces the chips", () => {
    const { host } = mount({ shape: snapshot({ operation: "merge", operation_detail: { current: "main", incoming: "feature", message: null, step: null, resolved: [], stopped_edit: null } as never }), notices: [{ id: "n1", text: "Your changes are kept in stash@{0}", actions: [] }] });

    expect(host.querySelector(".op-bar")).not.toBeNull();
    expect(host.textContent).toContain("Your changes are kept in stash@{0}");
  });

  it("says a rebase stopped to edit a commit, names it, and offers Continue without Resolve", () => {
    const { host } = mount({ shape: snapshot({ operation: "rebase", operation_detail: { current: "main", incoming: "feature", message: "", step: { current: 2, total: 3 }, resolved: [], stopped_edit: "abcdef0123456789" } as never }) });

    const bar = host.querySelector(".op-bar")?.textContent ?? "";
    expect(bar).toContain("Stopped to edit abcdef0");
    expect(bar).toContain("amend the commit or change files, then continue");
    const labels = [...host.querySelectorAll(".op-bar button")].map((entry) => entry.textContent?.trim());
    expect(labels).toEqual(["Continue", "Skip", "Abort"]);
    expect((host.querySelector(".op-bar button") as HTMLButtonElement).disabled).toBe(false);
  });
});
