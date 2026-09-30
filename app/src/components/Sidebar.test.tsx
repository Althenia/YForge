import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import type { WorktreeActions } from "../state/worktreeActions";
import { Sidebar } from "./Sidebar";
import { flush, mountWithApp, testUiPrefs } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot = {
  root: "/r",
  head: { kind: "branch", name: "main", sha: "a" },
  upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
  counts,
  branches: ["feature/a", "feature/b/deep", "main"],
  remote_branches: ["origin/feature/a", "origin/main"],
  remotes: ["origin"],
  tags: ["v1"],
  stashes: [{ index: 0, sha: "s0", base_sha: null, author_name: "Yui", message: "On main: wip", time: 0 }],
  worktrees: [],
} as unknown as RepoSnapshot;

function mount(selection: Selection | undefined = undefined, shape: RepoSnapshot = snapshot) {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    openRefMenu: (...args: unknown[]) => calls.push(["ref-menu", ...args]),
    openStashMenu: (...args: unknown[]) => calls.push(["stash-menu", ...args]),
    checkoutRef: (...args: unknown[]) => calls.push(["checkout", ...args]),
  } as unknown as RepoActions;
  const selected = vi.fn();
  const uiPrefs = testUiPrefs();
  const worktrees = {
    open: (...args: unknown[]) => calls.push(["open-worktree", ...args]),
    openTerminal: (...args: unknown[]) => calls.push(["terminal", ...args]),
    integrate: (...args: unknown[]) => calls.push(["integrate", ...args]),
    remove: (...args: unknown[]) => calls.push(["remove", ...args]),
    openCreate: () => calls.push(["create"]),
  } as unknown as WorktreeActions;
  const mounted = mountWithApp(() => (
    <Sidebar snapshot={shape} actions={actions} worktrees={worktrees} uiPrefs={uiPrefs} selection={selection} onSelectStash={selected} onOpenPanel={(panel) => calls.push(["panel", panel])} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls, selected };
}

const names = (host: ParentNode) => [...host.querySelectorAll('[data-nav]')].map((row) => row.getAttribute("aria-label"));
const folder = (host: ParentNode, label: string) => host.querySelector<HTMLElement>(`[aria-label^="${label}"]`) as HTMLElement;

describe("sidebar branch tree", () => {
  it("groups slash-separated branch names into folders with their branch counts", () => {
    const { host } = mount();

    expect(names(host.querySelector('section[aria-label="Branches"]') as HTMLElement)).toEqual([
      "Folder feature, 2 branches, expanded",
      "Branch feature/a",
      "Folder feature/b, 1 branch, expanded",
      "Branch feature/b/deep",
      "Branch main, checked out",
    ]);
    expect(host.querySelector('[aria-label="Branch feature/b/deep"] .name')?.textContent).toBe("deep");
  });

  it("collapses and expands a folder with a click, Enter, and the arrow keys, and reports the state", async () => {
    const { host } = mount();

    folder(host, "Folder feature,").click();
    await flush();
    expect(names(host)).not.toContain("Branch feature/a");
    expect(folder(host, "Folder feature,").getAttribute("aria-expanded")).toBe("false");

    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(names(host)).toContain("Branch feature/a");
    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await flush();
    expect(names(host)).not.toContain("Branch feature/a");
    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(names(host)).toContain("Branch feature/a");
  });

  it("keeps each remote's folders separate from the local ones", async () => {
    const { host } = mount();

    expect(names(host)).toContain("Remote branch origin/feature/a");
    folder(host, "Remote origin,").click();
    await flush();
    expect(names(host)).not.toContain("Remote branch origin/feature/a");
    expect(names(host)).toContain("Branch feature/a");
  });

  it("opens the branch menu from the keyboard and checks a branch out on Enter", () => {
    const { host, calls } = mount();
    const row = host.querySelector<HTMLElement>('[aria-label="Branch feature/a"]') as HTMLElement;

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(calls.map((call) => call[0])).toEqual(["ref-menu", "checkout"]);
  });
});

describe("sidebar stashes", () => {
  it("inspects a stash on click and marks the inspected one", async () => {
    const { host, selected } = mount({ kind: "stash", sha: "s0" });
    const row = host.querySelector<HTMLElement>('[aria-label^="Stash 0"]') as HTMLElement;

    row.click();

    expect(selected).toHaveBeenCalledWith("s0");
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});

describe("sidebar worktrees and recovery", () => {
  const linked = {
    ...snapshot,
    worktrees: [
      { path: "/w/repo", head: "a", branch: "main", bare: false, locked: false, prunable: false, current: true },
      { path: "/w/repo-feature", head: "b", branch: "feature/a", bare: false, locked: false, prunable: false, current: false },
    ],
  } as unknown as RepoSnapshot;
  const row = (host: ParentNode, path: string) => host.querySelector<HTMLElement>(`[data-nav="worktree:${path}"]`) as HTMLElement;

  it("opens a worktree as a tab on click and Enter, except the one already open", () => {
    const { host, calls } = mount(undefined, linked);

    row(host, "/w/repo-feature").click();
    row(host, "/w/repo-feature").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    row(host, "/w/repo").click();

    expect(calls).toEqual([["open-worktree", "/w/repo-feature"], ["open-worktree", "/w/repo-feature"]]);
    expect(row(host, "/w/repo").getAttribute("aria-current")).toBe("true");
    expect(row(host, "/w/repo-feature").getAttribute("aria-label")).toBe("Worktree repo-feature, branch feature/a");
  });

  it("offers open, open in terminal, integrate, and remove from the worktree's menu", async () => {
    const { host, calls } = mount(undefined, linked);

    row(host, "/w/repo-feature").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
    await flush();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.querySelector(".label-text")?.textContent)).toEqual(["Open as tab", "Open in terminal", "Integrate into another worktree…", "Remove worktree…"]);
    items[1]?.click();
    expect(calls).toEqual([["terminal", "/w/repo-feature"]]);

    row(host, "/w/repo-feature").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
    await flush();
    (document.querySelectorAll<HTMLElement>('[role="menuitem"]')[2] as HTMLElement).click();
    expect(calls.at(-1)).toEqual(["integrate", "/w/repo-feature"]);
  });

  it("disables Open as tab for the open worktree with the reason", async () => {
    const { host } = mount(undefined, linked);

    row(host, "/w/repo").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
    await flush();

    const open = document.querySelector('[role="menuitem"]') as HTMLElement;
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(open.getAttribute("title")).toBe("This worktree is open here");
  });

  it("creates a worktree from the section header and opens the Worktrees panel from its title", () => {
    const { host, calls } = mount(undefined, linked);

    host.querySelector<HTMLButtonElement>('button[aria-label="Create worktree"]')?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Show worktrees"]')?.click();

    expect(calls).toEqual([["create"], ["panel", "worktrees"]]);
  });

  it("opens each recovery source from the Recovery section", () => {
    const { host, calls } = mount();

    const section = host.querySelector('section[aria-label="Recovery"]') as HTMLElement;
    const rows = [...section.querySelectorAll<HTMLElement>('[role="button"]')];
    expect(rows.map((entry) => entry.getAttribute("aria-label"))).toEqual(["Reflog", "Lost commits", "Safety snapshots"]);
    rows.forEach((entry) => entry.click());

    expect(calls).toEqual([["panel", "reflog"], ["panel", "lost"], ["panel", "snapshots"]]);
  });
});
