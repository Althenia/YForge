import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { RepoUiPrefsStore } from "../state/repoUiPrefs";
import type { Selection } from "../state/selection";
import type { WorktreeActions } from "../state/worktreeActions";
import { Sidebar } from "./Sidebar";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { JiraIssueList } from "../ipc/bindings/JiraIssueList";
import { createIssueChips, createJiraIssues, type JiraSidebar } from "../state/jiraIssues";
import { flush, mountWithApp, testUiPrefs } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubScrollLayout({ viewport: 600, row: 32, total: 20_000 });
  vi.stubGlobal("innerWidth", 1440);
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
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
  stashes: [{ index: 0, sha: "s0", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: wip", time: 0 }],
  worktrees: [],
} as unknown as RepoSnapshot;

function mount(selection: Selection | undefined = undefined, shape: RepoSnapshot = snapshot, uiPrefs: RepoUiPrefsStore = testUiPrefs(), jira?: (calls: Array<[string, ...unknown[]]>) => JiraSidebar, commitMessage?: () => string) {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    openRefMenu: (...args: unknown[]) => calls.push(["ref-menu", ...args]),
    openStashMenu: (...args: unknown[]) => calls.push(["stash-menu", ...args]),
    activateRef: (...args: unknown[]) => calls.push(["activate", ...args]),
    deleteBranches: (...args: unknown[]) => calls.push(["delete-branches", ...args]),
    deleteTags: (...args: unknown[]) => calls.push(["delete-tags", ...args]),
    dropStashes: (...args: unknown[]) => calls.push(["drop-stashes", ...args]),
    fetchAll: (...args: unknown[]) => calls.push(["fetch-all", ...args]),
    openCreateBranchFromIssue: (...args: unknown[]) => calls.push(["branch-from-issue", ...args]),
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
  const mounted = mountWithApp(() => {
    const issues = jira?.(calls);
    return <Sidebar snapshot={shape} actions={actions} worktrees={worktrees} uiPrefs={uiPrefs} selection={selection} onSelectStash={selected} onOpenPanel={(panel) => calls.push(["panel", panel])} jira={issues} commitMessage={commitMessage} />;
  });
  dispose = mounted.dispose;
  return { ...mounted, calls, selected, uiPrefs };
}

const names = (host: ParentNode) => [...host.querySelectorAll('[data-nav]')].map((row) => row.getAttribute("aria-label"));
const folder = (host: ParentNode, label: string) => host.querySelector<HTMLElement>(`[aria-label^="${label}"]`) as HTMLElement;

describe("sidebar branch tree", () => {
  it("uses named object glyphs in the compact rail and opens and closes the same sidebar", async () => {
    vi.stubGlobal("innerWidth", 960);
    Element.prototype.scrollIntoView = () => undefined;
    const { host } = mount();
    const sidebar = host.querySelector(".sidebar")!;
    expect(sidebar.classList.contains("compact")).toBe(true);
    const branches = host.querySelector<HTMLButtonElement>('.sidebar-rail [aria-label="Show Branches"]');
    expect(branches?.querySelector("svg")?.getAttribute("data-icon")).toBe("branch");
    branches?.click();
    await flush();
    expect(sidebar.classList.contains("expanded")).toBe(true);
    host.querySelector<HTMLButtonElement>('[aria-label="Close repository sidebar"]')?.click();
    expect(sidebar.classList.contains("expanded")).toBe(false);
    expect(document.activeElement).toBe(branches);
    branches?.click();
    await flush();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    host.querySelector('.sec-title')?.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(sidebar.classList.contains("expanded")).toBe(false);
    expect(document.activeElement).toBe(branches);
  });
  it("omits repeated folder counts until selected while retaining them in accessible names", async () => {
    const { host } = mount();
    const row = folder(host, "Remote origin,");
    expect(row.getAttribute("aria-label")).toContain("2 branches");
    expect(row.querySelector(".meta")).toBeNull();
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    await flush();
    expect(row.querySelector(".meta")?.textContent).toBe("2 branches");
  });
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

    expect(calls.map((call) => call[0])).toEqual(["ref-menu", "activate"]);
  });

  it("activates origin/main by double-click and Enter without mutating it on a single click", () => {
    const { host, calls } = mount();
    const branch = host.querySelector<HTMLElement>('[aria-label="Remote branch origin/main"]');
    expect(branch).not.toBeNull();
    branch?.click();
    expect(calls).toEqual([]);
    branch?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    branch?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(calls.map((call) => call[0])).toEqual(["activate", "activate"]);
    for (const call of calls) {
      expect(call[1]).toEqual({ kind: "remote_branch", name: "origin/main", startPoint: "refs/remotes/origin/main" });
      expect(call[2]).toEqual(expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }));
    }
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
const metaClick = (element: HTMLElement) => click(element, { metaKey: true });
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
    for (const title of ["Branches", "Remotes", "Tags", "Stashes", "Worktrees", "Recovery"]) expect(headerOf(host, title).getAttribute("aria-expanded")).not.toBeNull();
    expect(host.querySelector('section[aria-label="Changes"]')).toBeNull();
    const order = [...host.querySelectorAll("button.sec-title")].map((button) => button.textContent?.trim());
    expect(order.slice(0, 5)).toEqual(["Branches", "Remotes", "Worktrees", "Tags", "Stashes"]);
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
  const levels = (element: Element | undefined) => [...(element?.querySelectorAll(".tree-guide") ?? [])].map((guide) => guide.getAttribute("data-level"));

  it("draws one straight vertical guide per level and no elbows", () => {
    const { host } = mount();

    expect(host.querySelector(".tree-elbow")).toBeNull();
    expect(levels(row(host, "branch:main"))).toEqual(["0"]);
    expect(levels(row(host, "branch:feature/a"))).toEqual(["0", "1"]);
    expect(levels(row(host, "folder:local:feature/b"))).toEqual(["0", "1"]);
    expect(levels(row(host, "branch:feature/b/deep"))).toEqual(["0", "1", "2"]);
    expect(row(host, "branch:main").querySelector(".tree-guide")?.textContent).toBe("");
  });

  it("draws remote branches one level under their remote", () => {
    const { host } = mount();

    expect(levels(row(host, "folder:remote:origin"))).toEqual(["0"]);
    expect(levels(row(host, "remote:origin/main"))).toEqual(["0", "1"]);
    expect(levels(row(host, "remote:origin/feature/a"))).toEqual(["0", "1", "2"]);
  });

  it("draws every section's rows as tree children, the last row included", () => {
    const { host } = mount();

    for (const title of ["Branches", "Remotes", "Tags", "Stashes"]) {
      const rows = [...section(host, title).querySelectorAll("[data-nav]")];
      expect(rows.length, title).toBeGreaterThan(0);
      expect(rows.every((entry) => levels(entry)[0] === "0"), title).toBe(true);
    }
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

  it("treats a macOS ctrl-click, which arrives as a context menu, as a toggle with either button number", async () => {
    for (const button of [0, 2]) {
      const { host, dispose } = mount();

      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ctrlKey: true, button });
      row(host, "branch:feature/a").dispatchEvent(event);
      await flush();

      expect(event.defaultPrevented).toBe(true);
      expect(pressed(host)).toEqual(["branch:feature/a"]);
      expect(menuItems()).toEqual([]);
      dispose();
    }
  });

  it("extends from the anchor when a shift-click follows a ctrl-click, so a range needs no plain click first", async () => {
    const { host } = mount();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ctrlKey: true, button: 2 });
    row(host, "branch:feature/a").dispatchEvent(event);
    await flush();
    shiftClick(row(host, "branch:main"));
    await flush();

    expect(pressed(host)).toEqual(["branch:feature/a", "branch:feature/b/deep", "branch:main"]);
  });

  it("selects only the clicked row with a plain click, so a shift-click extends from it and a cmd-click adds to it", async () => {
    const { host, calls } = mount();
    click(row(host, "branch:feature/a"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/a"]);
    shiftClick(row(host, "branch:main"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/a", "branch:feature/b/deep", "branch:main"]);

    click(row(host, "branch:feature/b/deep"));
    metaClick(row(host, "branch:main"));
    await flush();
    expect(pressed(host)).toEqual(["branch:feature/b/deep", "branch:main"]);

    rightClick(row(host, "branch:feature/a"));
    expect(calls.map((call) => call[0])).toEqual(["ref-menu"]);
  });

  it("offers Delete N tags in the menu of a selected tag", async () => {
    const tagged = { ...snapshot, tags: ["v1.0", "v1.1", "v2.0"] } as RepoSnapshot;
    const { host, calls } = mount(undefined, tagged);
    click(row(host, "tag:v1.0"));
    shiftClick(row(host, "tag:v1.1"));
    metaClick(row(host, "tag:v2.0"));
    await flush();

    rightClick(row(host, "tag:v2.0"));
    await flush();
    expect(menuItems().map((item) => item.textContent)).toEqual(["Delete 3 tags…"]);
    menuItems()[0]?.click();
    await flush();

    expect(calls).toEqual([["delete-tags", ["v1.0", "v1.1", "v2.0"]]]);
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
        { index: 0, sha: "s0", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "one", time: 0 },
        { index: 1, sha: "s1", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "two", time: 0 },
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

const site = (overrides: Partial<JiraConnection> = {}): JiraConnection => ({
  id: "j1",
  kind: "cloud",
  site: "https://your-site.atlassian.net",
  host: "your-site.atlassian.net",
  email: "you@example.com",
  display_name: "Sam Lee",
  projects: [{ key: "ABC", name: "Accounts" }],
  created_at: 1,
  ...overrides,
});

const issue = (overrides: Partial<JiraIssue> = {}): JiraIssue => ({
  key: "ABC-155",
  summary: "Show the account switcher on the login screen",
  status: "In Progress",
  status_category: "in_progress",
  issue_type: "Story",
  project: "ABC",
  assignee: "Sam Lee",
  updated_at: "2026-10-01T09:30:00.000+0000",
  web_url: "https://your-site.atlassian.net/browse/ABC-155",
  connection_id: "j1",
  ...overrides,
});

function mountJira(connections: JiraConnection[], issues: Record<string, JiraIssue[] | { kind: string; message: string } | JiraIssueList>, shape: RepoSnapshot = snapshot, selection: Selection | undefined = undefined) {
  mockIPC(
    (cmd, args) => {
      if (cmd === "jira_connections_list") return connections;
      if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map((text) => text.match(/ABC-\d+/g) ?? []);
      if (cmd === "jira_issues_lookup") return (args as { keys: string[] }).keys.map((key) => ({ key, issue: issue({ key, summary: "Retry login" }), failure: null }));
      if (cmd === "jira_my_issues") {
        const found = issues[(args as { id: string }).id] ?? [];
        if ("issues" in found) return found;
        if (!Array.isArray(found)) throw { kind: found.kind, message: found.message, output: null };
        return { issues: found, total: found.length, capped: false };
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  return mount(selection, shape, testUiPrefs(), (calls) => ({
    state: createJiraIssues(),
    chips: createIssueChips(() => shape.branches),
    openSettings: () => calls.push(["jira-settings"]),
    select: (key) => calls.push(["jira-select", key]),
    openInBrowser: (target) => calls.push(["jira-open", target.web_url]),
  }));
}

const issuesSection = (host: ParentNode) => host.querySelector('section[aria-label="Jira issues"]') as HTMLElement | null;

describe("sidebar Jira issues", () => {
  it("counts the true total and says the list is capped, per site, when a site returned only the first 1,000", async () => {
    const { host } = mountJira([site()], { j1: { issues: [issue()], total: 1500, capped: true } });
    await flush(60);

    const section = issuesSection(host) as HTMLElement;
    expect(section.querySelector(".count")?.textContent).toBe("1500");
    expect(section.textContent).toContain("your-site.atlassian.net: Showing 1,000 of 1,500");
  });

  it("is absent without a Jira connection", async () => {
    const { host } = mountJira([], {});
    await flush(40);

    expect(issuesSection(host)).toBeNull();
  });

  it("lists each assigned issue with its key in mono, summary, status word, and icon actions named with the key", async () => {
    const { host, calls } = mountJira([site()], { j1: [issue(), issue({ key: "ABC-9", summary: "Cookie banner copy", status: "To Do", status_category: "todo" })] });
    await flush(60);

    const section = issuesSection(host) as HTMLElement;
    expect(section.querySelector(".count")?.textContent).toBe("2");
    expect(names(section)).toEqual(["ABC-155 Show the account switcher on the login screen, In Progress", "ABC-9 Cookie banner copy, To Do"]);
    const row = section.querySelector('[data-nav="issue:ABC-155"]') as HTMLElement;
    expect(row.querySelector(".pull-number")?.textContent).toBe("ABC-155");
    expect(row.querySelector(".chip")?.textContent).toBe("In Progress");
    row.querySelector<HTMLButtonElement>('button[aria-label="Create branch from ABC-155"]')?.click();
    row.querySelector<HTMLButtonElement>('button[aria-label="Open ABC-155 in browser"]')?.click();
    expect(calls.find((call) => call[0] === "branch-from-issue")?.[1]).toMatchObject({ key: "ABC-155" });
    expect(calls).toContainEqual(["jira-open", "https://your-site.atlassian.net/browse/ABC-155"]);
  });

  it("offers the same actions in the row menu opened from the keyboard", async () => {
    const { host, calls } = mountJira([site()], { j1: [issue()] });
    await flush(60);
    const row = host.querySelector('[data-nav="issue:ABC-155"]') as HTMLElement;

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    await flush();

    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Create branch from ABC-155…", "Open in browser"]);
    (document.querySelectorAll('[role="menuitem"]')[0] as HTMLElement).click();
    await flush();
    expect(calls.some((call) => call[0] === "branch-from-issue")).toBe(true);
  });

  it("opens the issue inspector when a row is clicked or activated with Enter, and marks the open one", async () => {
    const { host, calls } = mountJira([site()], { j1: [issue()] }, snapshot, { kind: "issue", key: "ABC-155" });
    await flush(60);
    const row = host.querySelector('[data-nav="issue:ABC-155"]') as HTMLElement;

    row.click();
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(calls.filter((call) => call[0] === "jira-select")).toEqual([["jira-select", "ABC-155"], ["jira-select", "ABC-155"]]);
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
  });

  it("says no open issues are assigned as text when the list is empty", async () => {
    const { host } = mountJira([site()], { j1: [] });
    await flush(60);

    expect(issuesSection(host)?.textContent).toContain("No open issues assigned to you");
  });

  it("states a failing site in text, keeps the issues of the other sites, and offers Retry and Edit connection for a refused token", async () => {
    const { host, calls } = mountJira([site(), site({ id: "j2", host: "jira.corp-b.internal", kind: "data_center", email: null })], {
      j1: [issue()],
      j2: { kind: "auth_failed", message: "Authentication failed for jira.corp-b.internal" },
    });
    await flush(80);

    const section = issuesSection(host) as HTMLElement;
    expect(names(section)).toHaveLength(1);
    const alert = section.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Authentication failed for jira.corp-b.internal");
    [...alert.querySelectorAll("button")].find((button) => button.textContent === "Edit connection")?.click();
    expect(calls).toContainEqual(["jira-settings"]);
    expect([...alert.querySelectorAll("button")].map((button) => button.textContent)).toContain("Retry");
  });

  it("is narrowed by the sidebar filter", async () => {
    const { host } = mountJira([site()], { j1: [issue(), issue({ key: "ABC-9", summary: "Cookie banner copy" })] });
    await flush(60);
    const filter = host.querySelector<HTMLInputElement>('input[type="text"]') as HTMLInputElement;

    filter.value = "cookie";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();

    expect(names(issuesSection(host) as HTMLElement)).toEqual(["ABC-9 Cookie banner copy, In Progress"]);
  });

  it("marks an issue key in a branch name with a chip that carries the summary and status", async () => {
    const shape = { ...snapshot, branches: ["fix/ABC-142-retry-login", "main"] } as RepoSnapshot;
    const { host } = mountJira([site()], { j1: [] }, shape);
    await flush(80);

    const row = host.querySelector('[data-nav="branch:fix/ABC-142-retry-login"]') as HTMLElement;
    const chip = row.querySelector(".chip.key") as HTMLElement;
    expect(chip.textContent).toBe("ABC-142");
    expect(chip.querySelector(".mono")).not.toBeNull();
    expect(chip.getAttribute("data-tip")).toBe("ABC-142 · Retry login · In Progress");
    expect(host.querySelector('[data-nav="branch:main"] .chip.key')).toBeNull();
  });
});

describe("sidebar with thousands of refs", () => {
  const TOTAL = 5000;
  const pad = (index: number) => String(index).padStart(4, "0");
  const many = {
    ...snapshot,
    branches: Array.from({ length: TOTAL }, (_, index) => `b-${pad(index)}`),
    remote_branches: Array.from({ length: TOTAL }, (_, index) => `origin/r-${pad(index)}`),
    tags: Array.from({ length: TOTAL }, (_, index) => `t-${pad(index)}`),
    stashes: [],
  } as unknown as RepoSnapshot;
  const press = (element: Element, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const focusedId = () => document.activeElement?.getAttribute("data-nav");

  it("renders only the rows in view in the branch, remote branch, and tag lists", async () => {
    const { host } = mount(undefined, many);
    await flush(60);

    for (const title of ["Branches", "Remotes", "Tags"]) expect(navIds(host, title).length).toBeLessThan(60);
    expect(navIds(host, "Branches")[0]).toBe("branch:b-0000");
    expect(countOf(host, "Branches")).toBe(String(TOTAL));
  });

  it("steps with ↓ through every branch, then to the remote folder and its first branch", async () => {
    const { host } = mount(undefined, many);
    await flush(60);
    (row(host, "branch:b-0000") as HTMLElement).focus();
    expect(focusedId()).toBe("branch:b-0000");

    for (let step = 0; step < TOTAL - 1; step += 1) {
      const current = document.activeElement as HTMLElement;
      press(current, "ArrowDown");
      for (let wait = 0; wait < 40 && document.activeElement === current; wait += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(focusedId()).toBe(`branch:b-${pad(TOTAL - 1)}`);
    expect(navIds(host, "Branches").length).toBeLessThan(60);

    press(document.activeElement as HTMLElement, "ArrowDown");
    await flush(60);
    expect(focusedId()).toBe("folder:remote:origin");
    press(document.activeElement as HTMLElement, "ArrowDown");
    await flush(60);
    expect(focusedId()).toBe("remote:origin/r-0000");
    press(document.activeElement as HTMLElement, "ArrowUp");
    await flush(60);
    expect(focusedId()).toBe("folder:remote:origin");
  }, 120_000);

  it("keeps the focus on a branch row through 300 ↓ presses when the rows measure taller than the estimate", async () => {
    const { host } = mount(undefined, many);
    await flush(60);
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const measured = rect.call(this);
      return this.hasAttribute("data-nav") ? { ...measured, height: 31, bottom: measured.top + 31 } : measured;
    };
    (row(host, "branch:b-0000") as HTMLElement).focus();

    for (let step = 1; step <= 300; step += 1) {
      const current = document.activeElement as HTMLElement;
      press(current, "ArrowDown");
      for (let wait = 0; wait < 40 && document.activeElement === current; wait += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(focusedId(), `after ${step} presses`).toBe(`branch:b-${pad(step)}`);
    }
  }, 60_000);

  it("extends a selection from the first branch to the last across rows that are not rendered", async () => {
    const { host, calls } = mount(undefined, many);
    await flush(60);
    click(row(host, "branch:b-0000"));
    (host.querySelector(".sidebar-body") as HTMLElement).scrollTop = TOTAL * 32;
    await flush(80);
    await flush(80);

    shiftClick(row(host, `branch:b-${pad(TOTAL - 1)}`));
    await flush();
    rightClick(row(host, `branch:b-${pad(TOTAL - 1)}`));
    await flush();
    expect(menuItems().map((item) => item.textContent)).toEqual([`Delete ${TOTAL} branches…`]);
    menuItems()[0]?.click();
    await flush();

    const sent = calls.find((call) => call[0] === "delete-branches")?.[1] as string[];
    expect(sent).toHaveLength(TOTAL);
    expect(sent[0]).toBe("b-0000");
    expect(sent[TOTAL - 1]).toBe(`b-${pad(TOTAL - 1)}`);
  });
});

type IpcCall = { cmd: string; args: Record<string, unknown> };

const flowConfig = { production: "main", development: "develop", feature: "feature/", release: "release/", hotfix: "hotfix/", version_tag: "v" };

const hookEntry = (name: string, overrides: Record<string, unknown> = {}) => ({ name, path: `/r/.git/hooks/${name}`, active: true, reason: null, hash: `h-${name}`, approved: true, ...overrides });

function mountWithBackend(options: { flow?: boolean; shape?: RepoSnapshot; uiPrefs?: RepoUiPrefsStore; message?: string } = {}) {
  const ipc: IpcCall[] = [];
  mockIPC((cmd, args) => {
    ipc.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "git_flow_config") return options.flow === false ? null : flowConfig;
    if (cmd === "hooks_list") return { directory: "/r/.git/hooks", hooks: [hookEntry("pre-commit"), hookEntry("post-merge", { active: false, reason: "Not executable: Git skips this hook" })] };
    if (cmd === "submodule_list") return [];
    if (cmd === "hook_read") return { hook: hookEntry("pre-commit"), content: "#!/bin/sh\n", truncated: false };
    if (cmd === "hook_run") return new Promise(() => undefined);
    return null;
  });
  const mounted = mount(undefined, options.shape ?? snapshot, options.uiPrefs, undefined, () => options.message ?? "Fix login");
  return { ...mounted, ipc };
}

describe("sidebar hooks and git flow", () => {
  it("orders the sections Branches, Remotes, Worktrees, Tags, Stashes, Git Flow, Submodules, Hooks, Recovery, and omits Git Flow until initialized", async () => {
    const initialized = mountWithBackend();
    await flush(40);
    expect([...initialized.host.querySelectorAll("button.sec-title")].map((button) => button.textContent?.trim())).toEqual([
      "Branches",
      "Remotes",
      "Worktrees",
      "Tags",
      "Stashes",
      "Git Flow",
      "Submodules",
      "Hooks",
      "Recovery",
    ]);
    dispose?.();

    const plain = mountWithBackend({ flow: false });
    await flush(40);
    expect([...plain.host.querySelectorAll("button.sec-title")].map((button) => button.textContent?.trim())).toEqual([
      "Branches",
      "Remotes",
      "Worktrees",
      "Tags",
      "Stashes",
      "Submodules",
      "Hooks",
      "Recovery",
    ]);
  });

  it("collapses Git Flow and Hooks per repository like every other section", async () => {
    const first = mountWithBackend();
    await flush(40);
    for (const title of ["Git Flow", "Hooks"]) {
      expect(headerOf(first.host, title).getAttribute("aria-expanded")).toBe("true");
      headerOf(first.host, title).click();
    }
    await flush();
    const saved = first.uiPrefs.prefs();
    expect([...saved.collapsed_folders].sort()).toEqual(["@section:gitflow", "@section:hooks"]);
    expect(navIds(first.host, "Hooks")).toEqual([]);
    expect(countOf(first.host, "Hooks")).toBe("2");
    dispose?.();

    const second = mountWithBackend({ uiPrefs: testUiPrefs(saved) });
    await flush(40);
    expect(headerOf(second.host, "Git Flow").getAttribute("aria-expanded")).toBe("false");
    expect(headerOf(second.host, "Hooks").getAttribute("aria-expanded")).toBe("false");
    expect(headerOf(second.host, "Tags").getAttribute("aria-expanded")).toBe("true");
  });

  it("draws hook and flow rows as first-level tree children with one vertical guide", async () => {
    const { host } = mountWithBackend();
    await flush(40);

    for (const title of ["Git Flow", "Hooks"]) {
      const rows = [...section(host, title).querySelectorAll("[data-nav]")];
      expect(rows.length, title).toBeGreaterThan(0);
      for (const entry of rows) expect([...entry.querySelectorAll(".tree-guide")].map((guide) => guide.getAttribute("data-level"))).toEqual(["0"]);
    }
  });

  it("applies the sidebar filter to hook and flow rows with matched/total counts", async () => {
    const { host } = mountWithBackend();
    await flush(40);

    filterInput(host).value = "PRE-C";
    filterInput(host).dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();

    expect(navIds(host, "Hooks")).toEqual(["hook:pre-commit"]);
    expect(countOf(host, "Hooks")).toBe("1/2");
    expect(navIds(host, "Git Flow")).toEqual([]);
    expect(countOf(host, "Git Flow")).toBe("0/3");

    filterInput(host).value = "start rel";
    filterInput(host).dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();
    expect(navIds(host, "Git Flow")).toEqual(["flow:start:release"]);
    expect(countOf(host, "Git Flow")).toBe("1/3");
    expect(navIds(host, "Hooks")).toEqual([]);
  });

  it("runs a hook with the composer's message", async () => {
    const { host, ipc } = mountWithBackend({ message: "Fix login\n\nBody" });
    await flush(40);

    (row(host, "hook:pre-commit").querySelector('button[aria-label="Run pre-commit"]') as HTMLButtonElement).click();
    await flush(40);

    expect(ipc.find((call) => call.cmd === "hook_run")?.args).toMatchObject({ path: "/r", name: "pre-commit", mode: "run", message: "Fix login\n\nBody" });
  });

  it("starts a flow branch from the sidebar and finishes the one that is checked out", async () => {
    const onFeature = { ...snapshot, head: { kind: "branch", name: "feature/a", sha: "a" } } as unknown as RepoSnapshot;
    const { host, ipc } = mountWithBackend({ shape: onFeature });
    await flush(40);

    expect(navIds(host, "Git Flow")).toEqual(["flow:start:feature", "flow:start:release", "flow:start:hotfix", "flow:finish"]);
    row(host, "flow:finish").click();
    await flush();
    expect(ipc.find((call) => call.cmd === "git_flow_finish")?.args).toEqual({ path: "/r" });
  });
});
