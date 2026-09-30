import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { RepoUiPrefsStore } from "../state/repoUiPrefs";
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

function mount(selection: Selection | undefined = undefined, shape: RepoSnapshot = snapshot, uiPrefs: RepoUiPrefsStore = testUiPrefs()) {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    openRefMenu: (...args: unknown[]) => calls.push(["ref-menu", ...args]),
    openStashMenu: (...args: unknown[]) => calls.push(["stash-menu", ...args]),
    checkoutRef: (...args: unknown[]) => calls.push(["checkout", ...args]),
    deleteBranches: (...args: unknown[]) => calls.push(["delete-branches", ...args]),
    dropStashes: (...args: unknown[]) => calls.push(["drop-stashes", ...args]),
    fetchAll: (...args: unknown[]) => calls.push(["fetch-all", ...args]),
  } as unknown as RepoActions;
  const selected = vi.fn();
  const worktrees = {
    open: (...args: unknown[]) => calls.push(["open-worktree", ...args]),
    openTerminal: (...args: unknown[]) => calls.push(["terminal", ...args]),
    integrate: (...args: unknown[]) => calls.push(["integrate", ...args]),
    remove: (...args: unknown[]) => calls.push(["remove", ...args]),
    removeMany: (...args: unknown[]) => calls.push(["remove-many", ...args]),
    openCreate: () => calls.push(["create"]),
  } as unknown as WorktreeActions;
  const mounted = mountWithApp(() => (
    <Sidebar snapshot={shape} actions={actions} worktrees={worktrees} uiPrefs={uiPrefs} selection={selection} onSelectStash={selected} onOpenPanel={(panel) => calls.push(["panel", panel])} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls, selected, uiPrefs };
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

const section = (host: ParentNode, title: string) => host.querySelector<HTMLElement>(`section[aria-label="${title}"]`) as HTMLElement;
const countOf = (host: ParentNode, title: string) => section(host, title).querySelector(".count")?.textContent;
const headerOf = (host: ParentNode, title: string) => section(host, title).querySelector<HTMLButtonElement>("button.sec-title") as HTMLButtonElement;
const navIds = (host: ParentNode, title: string) => [...section(host, title).querySelectorAll("[data-nav]")].map((row) => row.getAttribute("data-nav"));
const filterInput = (host: ParentNode) => host.querySelector<HTMLInputElement>('input[aria-label="Filter sidebar"]') as HTMLInputElement;
const row = (host: ParentNode, id: string) => host.querySelector<HTMLElement>(`[data-nav="${id}"]`) as HTMLElement;
const click = (element: HTMLElement, init: MouseEventInit = {}) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const ctrlClick = (element: HTMLElement) => click(element, { ctrlKey: true });
const shiftClick = (element: HTMLElement) => click(element, { shiftKey: true });
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
const rightClick = (element: HTMLElement) => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 5, clientY: 6 }));

describe("sidebar section collapse", () => {
  it("gives every section a chevron header that reports its state and hides the rows but keeps the count", async () => {
    const { host } = mount();
    const header = headerOf(host, "Branches");
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(header.querySelector(".sec-chevron")).not.toBeNull();

    header.click();
    await flush();

    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(navIds(host, "Branches")).toEqual([]);
    expect(countOf(host, "Branches")).toBe("3");
    expect(section(host, "Branches").querySelector(".sec-title")?.textContent).toContain("Branches");
    for (const title of ["Changes", "Branches", "Remotes", "Tags", "Stashes", "Worktrees", "Recovery"]) expect(headerOf(host, title).getAttribute("aria-expanded")).not.toBeNull();
  });

  it("saves the collapsed section in the repository's preferences and restores it on the next mount", async () => {
    const first = mount();
    headerOf(first.host, "Tags").click();
    await flush();
    const saved = first.uiPrefs.prefs();
    expect(saved.collapsed_folders).toEqual(["@section:tags"]);
    dispose?.();

    const second = mount(undefined, snapshot, testUiPrefs(saved));

    expect(headerOf(second.host, "Tags").getAttribute("aria-expanded")).toBe("false");
    expect(navIds(second.host, "Tags")).toEqual([]);
    expect(headerOf(second.host, "Branches").getAttribute("aria-expanded")).toBe("true");
    headerOf(second.host, "Tags").click();
    await flush();
    expect(second.uiPrefs.prefs().collapsed_folders).toEqual([]);
  });

  it("keeps the section's buttons working next to the chevron header", () => {
    const { host, calls } = mount();

    (section(host, "Worktrees").querySelector('button[aria-label="Create worktree"], button[data-tip="Create worktree"]') as HTMLButtonElement).click();

    expect(calls).toEqual([["create"]]);
  });
});

describe("sidebar tree connectors", () => {
  it("draws indent guides and elbows as CSS elements under branch folders, with the last child ending its line", () => {
    const { host } = mount();
    const leaf = row(host, "branch:feature/a");
    const lastFolder = row(host, "folder:local:feature/b");
    const deep = row(host, "branch:feature/b/deep");

    expect(leaf.querySelector(".tree-elbow")?.getAttribute("data-level")).toBe("0");
    expect(leaf.querySelector(".tree-elbow")?.classList.contains("last")).toBe(false);
    expect(lastFolder.querySelector(".tree-elbow")?.classList.contains("last")).toBe(true);
    expect(deep.querySelector(".tree-elbow")?.getAttribute("data-level")).toBe("1");
    expect(deep.querySelector(".tree-guide")).toBeNull();
    expect(row(host, "branch:main").querySelector(".tree-elbow, .tree-guide")).toBeNull();
    expect(host.querySelector(".tree-elbow")?.textContent).toBe("");
  });

  it("draws remote branches under their remote, with a guide that runs past a folder that has later siblings", () => {
    const { host } = mount();
    const nested = row(host, "remote:origin/feature/a");

    expect(nested.querySelector('.tree-guide[data-level="0"]')).not.toBeNull();
    expect(nested.querySelector(".tree-elbow")?.getAttribute("data-level")).toBe("1");
    expect(nested.querySelector(".tree-elbow")?.classList.contains("last")).toBe(true);
    expect(row(host, "remote:origin/main").querySelector(".tree-elbow")?.getAttribute("data-level")).toBe("0");
    expect(row(host, "folder:remote:origin").querySelector(".tree-elbow, .tree-guide")).toBeNull();
  });

  it("keeps tags and stashes flat", () => {
    const { host } = mount();

    expect(section(host, "Tags").querySelector(".tree-elbow, .tree-guide")).toBeNull();
    expect(section(host, "Stashes").querySelector(".tree-elbow, .tree-guide")).toBeNull();
  });
});

describe("sidebar filter", () => {
  const typeFilter = async (host: ParentNode, value: string) => {
    filterInput(host).value = value;
    filterInput(host).dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();
  };

  it("hides rows that do not contain the text, case-insensitively, in every section, and shows matched/total counts", async () => {
    const { host } = mount();

    await typeFilter(host, "FEAT");

    expect(navIds(host, "Branches")).toEqual(["folder:local:feature", "branch:feature/a", "folder:local:feature/b", "branch:feature/b/deep"]);
    expect(navIds(host, "Remotes")).toEqual(["folder:remote:origin", "folder:origin:feature", "remote:origin/feature/a"]);
    expect(navIds(host, "Tags")).toEqual([]);
    expect(navIds(host, "Stashes")).toEqual([]);
    expect(countOf(host, "Branches")).toBe("2/3");
    expect(countOf(host, "Remotes")).toBe("1/1");
    expect(countOf(host, "Tags")).toBe("0/1");
    expect(countOf(host, "Stashes")).toBe("0/1");
    expect(countOf(host, "Changes")).toBe("0");

    await typeFilter(host, "wip");
    expect(navIds(host, "Stashes")).toEqual(["stash:s0"]);
    expect(countOf(host, "Stashes")).toBe("1/1");
    await typeFilter(host, "V1");
    expect(navIds(host, "Tags")).toEqual(["tag:v1"]);
  });

  it("matches a remote branch by its full name and a worktree by its folder or branch", async () => {
    const linked = {
      ...snapshot,
      worktrees: [
        { path: "/w/repo", head: "a", branch: "main", bare: false, locked: false, prunable: false, current: true },
        { path: "/w/repo-feature", head: "b", branch: "feature/a", bare: false, locked: false, prunable: false, current: false },
      ],
    } as unknown as RepoSnapshot;
    const { host } = mount(undefined, linked);

    await typeFilter(host, "origin/m");
    expect(navIds(host, "Remotes")).toEqual(["folder:remote:origin", "remote:origin/main"]);
    await typeFilter(host, "repo-feat");
    expect(navIds(host, "Worktrees")).toEqual(["worktree:/w/repo-feature"]);
    expect(countOf(host, "Worktrees")).toBe("1/2");
  });

  it("opens folders that hold a match even when they are collapsed, and leaves the saved collapse untouched", async () => {
    const collapsed = testUiPrefs({ columns: [], collapsed_folders: ["local:feature"], branch_visibility: { kind: "all" } });
    const { host } = mount(undefined, snapshot, collapsed);
    expect(navIds(host, "Branches")).not.toContain("branch:feature/a");

    await typeFilter(host, "feature/a");

    expect(navIds(host, "Branches")).toContain("branch:feature/a");
    await typeFilter(host, "");
    expect(navIds(host, "Branches")).not.toContain("branch:feature/a");
    expect(collapsed.prefs().collapsed_folders).toEqual(["local:feature"]);
  });

  it("clears with Escape, consuming the key, and restores every row and plain counts", async () => {
    const { host } = mount();
    await typeFilter(host, "feat");
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    filterInput(host).dispatchEvent(escape);
    await flush();

    expect(escape.defaultPrevented).toBe(true);
    expect(filterInput(host).value).toBe("");
    expect(navIds(host, "Branches")).toHaveLength(5);
    expect(countOf(host, "Branches")).toBe("3");
    expect(countOf(host, "Tags")).toBe("1");
  });

  it("does not change the inspected stash or the multi-selection", async () => {
    const { host, selected } = mount({ kind: "stash", sha: "s0" });
    ctrlClick(row(host, "branch:feature/a"));
    ctrlClick(row(host, "branch:main"));
    await flush();

    await typeFilter(host, "zzz");
    await typeFilter(host, "");

    expect(row(host, "branch:feature/a").getAttribute("aria-pressed")).toBe("true");
    expect(row(host, "branch:main").getAttribute("aria-pressed")).toBe("true");
    expect(row(host, "stash:s0").getAttribute("aria-current")).toBe("true");
    expect(selected).not.toHaveBeenCalled();
  });
});

describe("sidebar multi-select", () => {
  const pressed = (host: ParentNode) => [...host.querySelectorAll('[aria-pressed="true"]')].map((element) => element.getAttribute("data-nav"));

  it("toggles rows with ctrl-click without checking out or collapsing anything, and extends a range with shift-click from the anchor", async () => {
    const { host, calls } = mount();

    ctrlClick(row(host, "branch:feature/a"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/a"]);
    shiftClick(row(host, "branch:main"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/a", "branch:feature/b/deep", "branch:main"]);
    ctrlClick(row(host, "branch:feature/b/deep"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/a", "branch:main"]);

    expect(calls).toEqual([]);
  });

  it("treats a macOS ctrl-click, which arrives as a context menu on the primary button, as a toggle", async () => {
    const { host } = mount();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
    row(host, "branch:feature/a").dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(pressed(host)).toEqual(["branch:feature/a"]);
    expect(menuItems()).toEqual([]);
  });

  it("clears the selection with a plain click and keeps a single-row context menu for one row or a row outside the selection", async () => {
    const { host, calls } = mount();
    ctrlClick(row(host, "branch:feature/a"));
    ctrlClick(row(host, "branch:main"));
    await flush();

    rightClick(row(host, "branch:feature/b/deep"));
    expect(calls.map((call) => call[0])).toEqual(["ref-menu"]);

    click(row(host, "branch:feature/a"));
    await flush();
    expect(pressed(host)).toEqual([]);
  });

  it("offers Delete N branches in the menu of a selected row, blocked while the checked-out branch is selected", async () => {
    const { host, calls } = mount();
    ctrlClick(row(host, "branch:feature/a"));
    ctrlClick(row(host, "branch:feature/b/deep"));
    await flush();

    rightClick(row(host, "branch:feature/a"));
    await flush();
    expect(menuItems().map((item) => item.textContent)).toEqual(["Delete 2 branches…"]);
    menuItems()[0]?.click();
    await flush();
    expect(calls).toEqual([["delete-branches", ["feature/a", "feature/b/deep"]]]);

    expect(pressed(host)).toEqual([]);
    ctrlClick(row(host, "branch:feature/a"));
    ctrlClick(row(host, "branch:main"));
    await flush();
    rightClick(row(host, "branch:main"));
    await flush();
    expect(menuItems()[0]?.getAttribute("aria-disabled")).toBe("true");
    expect(menuItems()[0]?.getAttribute("title")).toBe("main is checked out");
  });

  it("offers Drop N stashes, Fetch N remotes, and Remove N worktrees in their sections", async () => {
    const many = {
      ...snapshot,
      remotes: ["origin", "upstream"],
      remote_branches: ["origin/main", "upstream/main"],
      stashes: [
        { index: 0, sha: "s0", base_sha: null, author_name: "Yui", message: "one", time: 0 },
        { index: 1, sha: "s1", base_sha: null, author_name: "Yui", message: "two", time: 0 },
      ],
      worktrees: [
        { path: "/w/repo", head: "a", branch: "main", bare: false, locked: false, prunable: false, current: true },
        { path: "/w/a", head: "b", branch: "a", bare: false, locked: false, prunable: false, current: false },
        { path: "/w/b", head: "c", branch: "b", bare: false, locked: false, prunable: false, current: false },
      ],
    } as unknown as RepoSnapshot;
    const { host, calls } = mount(undefined, many);
    const choose = async (target: HTMLElement, label: string) => {
      rightClick(target);
      await flush();
      expect(menuItems().map((item) => item.textContent)).toEqual([expect.stringContaining(label)]);
      menuItems()[0]?.click();
      await flush();
    };

    ctrlClick(row(host, "stash:s0"));
    shiftClick(row(host, "stash:s1"));
    await flush();
    await choose(row(host, "stash:s1"), "Drop 2 stashes…");
    ctrlClick(row(host, "folder:remote:origin"));
    ctrlClick(row(host, "folder:remote:upstream"));
    await flush();
    await choose(row(host, "folder:remote:upstream"), "Fetch 2 remotes");
    ctrlClick(row(host, "worktree:/w/a"));
    ctrlClick(row(host, "worktree:/w/b"));
    await flush();
    await choose(row(host, "worktree:/w/b"), "Remove 2 worktrees…");

    expect(calls.map((call) => call[0])).toEqual(["drop-stashes", "fetch-all", "remove-many"]);
    expect((calls[0]?.[1] as Array<{ sha: string }>).map((stash) => stash.sha)).toEqual(["s0", "s1"]);
    expect(calls[2]?.[1]).toEqual(["/w/a", "/w/b"]);
    expect(row(host, "folder:remote:origin").getAttribute("aria-expanded")).toBe("true");
  });
});
