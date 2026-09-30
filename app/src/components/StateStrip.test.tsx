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

type Setup = { shape?: RepoSnapshot; sync?: SyncState; notices?: StripNotice[]; online?: boolean };

function mount({ shape = snapshot(), sync = { kind: "idle" }, notices = [], online = true }: Setup = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push([name, ...args]);
  const [current, setNotices] = createSignal(notices);
  const actions = {
    sync: () => sync,
    notices: current,
    dismissNotice: (id: string) => {
      calls.push(["dismiss", id]);
      setNotices((list) => list.filter((notice) => notice.id !== id));
    },
    openBranchPicker: record("branch-picker"),
    openSyncMenu: record("sync-menu"),
    fetchAll: record("fetch"),
    retrySync: record("retry"),
    dismissSync: record("dismiss-sync"),
    cancelSync: record("cancel"),
    operationBusy: () => false,
  } as unknown as RepoActions;
  const openChanges = vi.fn();
  const revealHead = vi.fn();
  const mounted = mountWithApp(() => <StateStrip snapshot={shape} actions={actions} online={online} onOpenChanges={openChanges} onRevealHead={revealHead} onResolve={() => undefined} />);
  dispose = mounted.dispose;
  const openSettings = vi.fn();
  mounted.app.openSettings = openSettings;
  return { ...mounted, calls, openChanges, revealHead, openSettings };
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

  it("opens the sync menu from the ahead and behind chip, which states diverged in text", () => {
    const { host, calls } = mount();
    const sync = button(host, /^Sync menu/);

    expect(sync.textContent).toContain("↑2");
    expect(sync.textContent).toContain("↓1");
    expect(sync.textContent).toContain("diverged");
    sync.click();

    expect(calls.map((call) => call[0])).toEqual(["sync-menu"]);
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

  it("says detached HEAD at the short id and offers only the HEAD chip", () => {
    const { host } = mount({ shape: snapshot({ head: { kind: "detached", sha: "1a2b3c4d5e6f".padEnd(40, "0") }, upstream: null }) });

    expect(host.textContent).toContain("detached at 1a2b3c4");
    expect(button(host, /^Reveal HEAD/).getAttribute("aria-label")).toBe("Reveal HEAD in the graph: detached at 1a2b3c4");
    expect(button(host, /^Branch menu/)).toBeUndefined();
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
  it("counts the worktrees, and lists them with their branch and which have changes", async () => {
    mockIPC((cmd) =>
      cmd === "worktree_list"
        ? [
            { path: "/r", head: "a", branch: "feature", bare: false, locked: false, prunable: false, current: true, dirty: false },
            { path: "/r-wt", head: "b", branch: "topic", bare: false, locked: true, prunable: false, current: false, dirty: true },
          ]
        : null,
    );
    const { host } = mount();
    await flush(60);

    const chip = button(host, /worktrees/);
    expect(chip.textContent).toContain("2 worktrees · 1 with changes");
    chip.click();
    await flush();

    const dialog = document.querySelector('[role="dialog"][aria-label="Worktrees"]') as HTMLElement;
    const rows = [...dialog.querySelectorAll("li")].map((row) => [...row.children].map((child) => child.textContent).filter((text) => text !== "").join(" "));
    expect(rows).toEqual(["feature /r current", "topic /r-wt changes locked"]);
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
});
