import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { ChangeCounts } from "../ipc/bindings/ChangeCounts";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { SyncState } from "../state/syncModel";
import { CommandBar } from "./CommandBar";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
});

const snapshot = (head: RepoSnapshot["head"]): RepoSnapshot =>
  ({ root: "/work/repo", head, upstream: null, remotes: ["origin"], worktrees: [{ path: "/work/repo", current: true }] }) as unknown as RepoSnapshot;

function mount(head: RepoSnapshot["head"]) {
  const calls: unknown[][] = [];
  const actions = { sync: () => ({ kind: "idle" }), openBranchPicker: (...args: unknown[]) => calls.push(args) } as unknown as RepoActions;
  const mounted = mountWithApp(() => (
    <CommandBar snapshot={snapshot(head)} actions={actions} undo={{ kind: "unavailable", reason: "" }} onUndo={() => undefined} onPalette={() => undefined} onSearch={() => undefined} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls };
}

describe("command bar breadcrumb", () => {
  it("opens the branch menu from the branch in the breadcrumb", () => {
    const { host, calls } = mount({ kind: "branch", name: "feature/x", sha: "a" });

    const crumb = host.querySelector<HTMLButtonElement>('button[aria-label="Branch menu: feature/x"]');
    crumb?.click();

    expect(crumb?.getAttribute("aria-haspopup")).toBe("menu");
    expect(calls).toHaveLength(1);
  });

  it("has no branch menu before the first commit", () => {
    const { host } = mount({ kind: "unborn", branch: "main" });

    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Branch menu: main"]')?.disabled).toBe(true);
  });
});

const clean: ChangeCounts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const tracked = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/work/repo",
    head: { kind: "branch", name: "main", sha: "a" },
    upstream: { name: "origin/main", ahead_behind: { ahead: 1, behind: 0 } },
    remotes: ["origin"],
    counts: clean,
    operation: null,
    worktrees: [{ path: "/work/repo", current: true }],
    ...overrides,
  }) as unknown as RepoSnapshot;

function mountActions(shape: RepoSnapshot, sync: SyncState = { kind: "idle" }) {
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
  window.dispatchEvent(new Event("resize"));
  const calls: string[] = [];
  const actions = {
    sync: () => sync,
    fetchAll: () => calls.push("fetch"),
    pullDefault: () => calls.push("pull"),
    push: () => calls.push("push"),
    publish: () => calls.push("publish"),
    openFetchMenu: () => calls.push("fetch-menu"),
    openPullMenu: () => calls.push("pull-menu"),
    openPublishMenu: () => calls.push("publish-menu"),
    openStashForm: () => calls.push("stash"),
    openBranchPicker: () => calls.push("branch-picker"),
    openCreateBranch: () => calls.push("branch"),
  } as unknown as RepoActions;
  const mounted = mountWithApp(() => (
    <CommandBar snapshot={shape} actions={actions} undo={{ kind: "unavailable", reason: "Nothing to undo" }} onUndo={() => undefined} onPalette={() => undefined} onSearch={() => undefined} />
  ));
  dispose = mounted.dispose;
  const button = (label: string) =>
    [...mounted.host.querySelectorAll<HTMLButtonElement>(".commandbar button.btn")].find((entry) => {
      const text = (entry.textContent ?? "").replace(/\s+/g, "");
      return text === label || text.startsWith(`${label}↓`) || text.startsWith(`${label}↑`);
    });
  return { ...mounted, calls, button };
}

describe("fetch, pull, and push", () => {
  it("keeps Fetch, Pull, and Push as separate controls, with the pull mode only in the caret", () => {
    const { host, button, calls } = mountActions(tracked());

    expect(host.textContent).not.toContain("Sync");
    expect(button("Fetch")?.textContent?.replace(/\s+/g, "")).toBe("Fetch");
    expect(button("Pull")?.textContent?.replace(/\s+/g, "")).toBe("Pull↓0");
    expect(button("Pull")?.classList.contains("primary")).toBe(true);
    expect(button("Push")?.textContent?.replace(/\s+/g, "")).toBe("Push↑1");
    expect(button("Pull")?.textContent).not.toMatch(/fast-forward|rebase|merge/i);

    button("Fetch")?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Fetch menu"]')?.click();
    button("Pull")?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Pull menu"]')?.click();
    button("Push")?.click();

    expect(calls).toEqual(["fetch", "fetch-menu", "pull", "pull-menu", "push"]);
    expect(host.querySelector('[role="group"][aria-label="Fetch"] button[aria-haspopup="menu"]')).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="Pull"] button[aria-haspopup="menu"]')).not.toBeNull();
    expect(button("Push")?.getAttribute("aria-haspopup")).toBeNull();
  });

  it("disables Stash when there is nothing to stash, and disables Fetch, Pull, Push, and Stash while a sync is running", () => {
    const cleanBar = mountActions(tracked());

    expect(cleanBar.button("Stash")?.disabled).toBe(true);
    expect(cleanBar.button("Stash")?.title).toBe("Nothing to stash");
    dispose?.();

    const dirty = mountActions(tracked({ counts: { ...clean, modified: 1 } }), { kind: "running", id: "op", label: "Pulling", phase: undefined, percent: null });

    expect(dirty.button("Stash")?.disabled).toBe(true);
    expect(dirty.button("Stash")?.title).toBe("A sync is running");
    expect(dirty.button("Fetch")?.disabled).toBe(true);
    expect(dirty.button("Pull")?.disabled).toBe(true);
    expect(dirty.button("Push")?.disabled).toBe(true);
    expect(dirty.host.querySelector<HTMLButtonElement>('button[aria-label="Fetch menu"]')?.disabled).toBe(true);
    expect(dirty.host.querySelector<HTMLButtonElement>('button[aria-label="Pull menu"]')?.disabled).toBe(true);
  });

  it("disables Push when the branch has diverged and leaves force push out of the toolbar", () => {
    const { button, host } = mountActions(tracked({ upstream: { name: "origin/main", ahead_behind: { ahead: 2, behind: 1 } }, counts: { ...clean, modified: 1 } }));

    expect(button("Push")?.disabled).toBe(true);
    expect(button("Push")?.title).toBe("This branch has diverged. Force push with lease is in the status strip.");
    expect(button("Pull")?.disabled).toBe(false);
    expect(button("Fetch")?.disabled).toBe(false);
    expect(button("Stash")?.disabled).toBe(false);
    expect(host.textContent).not.toContain("Force push");
  });

  it("disables Pull when the branch has no upstream and offers Publish instead of Push", () => {
    const { button } = mountActions(tracked({ upstream: null }));

    expect(button("Publish")).toBeDefined();
    expect(button("Pull")?.disabled).toBe(true);
    expect(button("Pull")?.title).toBe("No upstream branch to pull from");
    expect(button("Push")).toBeUndefined();
  });
});
