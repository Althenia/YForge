import { describe, expect, it } from "vitest";
import type { TabGroup } from "../ipc/bindings/TabGroup";
import {
  activateTab,
  addToGroup,
  aliasProblem,
  CLOSED_LIMIT,
  closedEntries,
  closeGroup,
  closeTab,
  closeTabIds,
  idsOfOthers,
  idsToTheRight,
  nextClosed,
  pushClosed,
  reopenTab,
  repoName,
  groupNameProblem,
  groupTabs,
  newGroup,
  openLauncherTab,
  openRepoTab,
  recolorGroup,
  removeFromGroup,
  renameGroup,
  restoreTabs,
  sessionOf,
  tabGroups,
  tabLabel,
  tabSegments,
  toggleGroup,
  ungroup,
  type TabsState,
} from "./tabs";

const repos = (...paths: string[]): TabsState => ({ tabs: paths.map((path) => ({ kind: "repo", path })), active: 0, groups: [] });

const group = (name: string, tabs: string[], extra: Partial<TabGroup> = {}): TabGroup => ({ name, color: "cyan", collapsed: false, tabs, ...extra });

const grouped = (paths: string[], groups: TabGroup[], active = 0): TabsState => ({ ...repos(...paths), active, groups });

const paths = (state: TabsState): string[] => state.tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind));

const activePath = (state: TabsState): string | undefined => paths(state)[state.active];

describe("tabs", () => {
  it("opens a repository as a new active tab and re-activates one already open", () => {
    const opened = openRepoTab(repos("/a"), "/b");
    expect(opened.tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(opened.active).toBe(1);
    expect(openRepoTab(opened, "/a")).toEqual({ tabs: opened.tabs, active: 0, groups: [] });
  });

  it("replaces the active launcher tab instead of leaving it behind", () => {
    const withLauncher = openLauncherTab(repos("/a"));
    expect(withLauncher.tabs[1]).toEqual({ kind: "launcher" });
    const opened = openRepoTab(withLauncher, "/b");
    expect(opened.tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(opened.active).toBe(1);
  });

  it("keeps a single launcher tab and shows the launcher alone when it is the only tab", () => {
    const once = openLauncherTab(repos("/a"));
    expect(openLauncherTab({ ...once, active: 0 })).toEqual({ tabs: once.tabs, active: 1, groups: [] });
    const alone = openRepoTab({ tabs: [{ kind: "launcher" }], active: 0, groups: [] }, "/a");
    expect(alone).toEqual({ tabs: [{ kind: "repo", path: "/a" }], active: 0, groups: [] });
  });

  it("closes tabs keeping the active tab stable and falls back to the launcher", () => {
    const three: TabsState = { ...repos("/a", "/b", "/c"), active: 2 };
    expect(closeTab(three, 0)).toEqual({ tabs: three.tabs.slice(1), active: 1, groups: [] });
    expect(closeTab(three, 2)).toEqual({ tabs: three.tabs.slice(0, 2), active: 1, groups: [] });
    expect(closeTab({ ...three, active: 1 }, 1).active).toBe(1);
    expect(closeTab(repos("/a"), 0)).toEqual({ tabs: [{ kind: "launcher" }], active: 0, groups: [] });
  });

  it("ignores activating a tab that does not exist", () => {
    const state = repos("/a", "/b");
    expect(activateTab(state, 1).active).toBe(1);
    expect(activateTab(state, 5)).toBe(state);
  });

  it("saves only repository tabs and restores them, adding the launch path last", () => {
    const state: TabsState = { tabs: [{ kind: "repo", path: "/a" }, { kind: "launcher" }, { kind: "repo", path: "/b" }], active: 2, groups: [] };
    const session = sessionOf(state);
    expect(session).toEqual({ tabs: ["/a", "/b"], active: 1, groups: [] });
    expect(restoreTabs(session, undefined)).toEqual({ tabs: repos("/a", "/b").tabs, active: 1, groups: [] });
    expect(restoreTabs(session, "/c").active).toBe(2);
    expect(restoreTabs(session, "/a").active).toBe(0);
  });

  it("restores an empty session as the launcher and opens the launch path over it", () => {
    expect(restoreTabs({ tabs: [], active: 0, groups: [] }, undefined)).toEqual({ tabs: [{ kind: "launcher" }], active: 0, groups: [] });
    expect(restoreTabs({ tabs: [], active: 0, groups: [] }, "/a")).toEqual({ tabs: [{ kind: "repo", path: "/a" }], active: 0, groups: [] });
    expect(restoreTabs({ tabs: ["/a"], active: 9, groups: [] }, undefined).active).toBe(0);
  });

  it("labels tabs by repository name", () => {
    expect(tabLabel({ kind: "repo", path: "/work/sample/" })).toBe("sample");
    expect(tabLabel({ kind: "launcher" })).toBe("New tab");
  });

  it("labels a tab by its alias when one is set, and keeps the folder name for the tooltip", () => {
    const aliases = { "/work/sample": "Corp A · API" };

    expect(tabLabel({ kind: "repo", path: "/work/sample" }, aliases)).toBe("Corp A · API");
    expect(tabLabel({ kind: "repo", path: "/work/other" }, aliases)).toBe("other");
    expect(repoName("/work/sample", aliases)).toBe("Corp A · API");
    expect(repoName("/work/sample/", {})).toBe("sample");
  });

  it("validates an alias as 1 to 40 characters", () => {
    expect(aliasProblem("")).toBe("Enter an alias");
    expect(aliasProblem("   ")).toBe("Enter an alias");
    expect(aliasProblem("x".repeat(41))).toBe("An alias is at most 40 characters");
    expect(aliasProblem(` ${"é".repeat(40)} `)).toBeUndefined();
  });
});

describe("closing several tabs", () => {
  it("lists the other tabs and the tabs to the right of one, launcher included", () => {
    const state: TabsState = { tabs: [{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }, { kind: "launcher" }, { kind: "repo", path: "/c" }], active: 1, groups: [] };

    expect(idsOfOthers(state, 1)).toEqual(["/a", "launcher", "/c"]);
    expect(idsToTheRight(state, 1)).toEqual(["launcher", "/c"]);
    expect(idsToTheRight(state, 3)).toEqual([]);
    expect(idsOfOthers(repos("/a"), 0)).toEqual([]);
  });

  it("closes the other tabs and leaves the chosen one active", () => {
    const state = grouped(["/a", "/b", "/c"], [group("G", ["/a", "/b"])], 0);

    const next = closeTabIds(state, idsOfOthers(state, 1));

    expect(paths(next)).toEqual(["/b"]);
    expect(activePath(next)).toBe("/b");
    expect(next.groups).toEqual([group("G", ["/b"])]);
  });

  it("closes the tabs to the right, keeping the active tab when it stays and otherwise activating the chosen one", () => {
    const state = repos("/a", "/b", "/c", "/d");

    const keepsActive = closeTabIds({ ...state, active: 0 }, idsToTheRight(state, 1));
    const movesActive = closeTabIds({ ...state, active: 3 }, idsToTheRight(state, 1));

    expect(paths(keepsActive)).toEqual(["/a", "/b"]);
    expect(activePath(keepsActive)).toBe("/a");
    expect(paths(movesActive)).toEqual(["/a", "/b"]);
    expect(activePath(movesActive)).toBe("/b");
  });

  it("deletes a group whose tabs were all closed and falls back to the launcher when nothing is left", () => {
    const state = grouped(["/a", "/b"], [group("G", ["/b"])]);

    expect(closeTabIds(state, ["/b"]).groups).toEqual([]);
    expect(closeTabIds(state, ["/a", "/b"])).toEqual({ tabs: [{ kind: "launcher" }], active: 0, groups: [] });
  });
});

describe("closed tabs", () => {
  it("records the closed repository tabs in order with the group members that stay open, and skips the launcher", () => {
    const state: TabsState = { ...grouped(["/a", "/b", "/c"], [group("G", ["/a", "/b"])]), tabs: [{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }, { kind: "repo", path: "/c" }, { kind: "launcher" }] };

    expect(closedEntries(state, ["launcher", "/b", "/c"])).toEqual([
      { path: "/b", siblings: ["/a"] },
      { path: "/c", siblings: [] },
    ]);
    expect(closedEntries(state, ["/a", "/b"])).toEqual([
      { path: "/a", siblings: [] },
      { path: "/b", siblings: [] },
    ]);
  });

  it("keeps only the last 20 closed tabs", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ path: `/r${index}`, siblings: [] }));

    const stack = pushClosed([], entries);

    expect(CLOSED_LIMIT).toBe(20);
    expect(stack).toHaveLength(20);
    expect(stack[0]?.path).toBe("/r5");
    expect(pushClosed(stack, [{ path: "/last", siblings: [] }]).at(-1)?.path).toBe("/last");
    expect(pushClosed(stack, [{ path: "/last", siblings: [] }])).toHaveLength(20);
  });

  it("offers the most recently closed tab that is not open again, and nothing when there is none", () => {
    const stack = [{ path: "/a", siblings: [] }, { path: "/b", siblings: [] }, { path: "/c", siblings: [] }];

    expect(nextClosed(stack, repos("/x"))).toEqual({ entry: { path: "/c", siblings: [] }, rest: stack.slice(0, 2) });
    expect(nextClosed(stack, repos("/c"))).toEqual({ entry: { path: "/b", siblings: [] }, rest: stack.slice(0, 1) });
    expect(nextClosed(stack, repos("/a", "/b", "/c"))).toBeUndefined();
    expect(nextClosed([], repos("/a"))).toBeUndefined();
  });

  it("reopens a tab as the active tab and returns it to its former group at the group's end while that group exists", () => {
    const state = grouped(["/a", "/b", "/d"], [group("Renamed", ["/a", "/b"], { color: "red" })]);

    const next = reopenTab(state, {}, { path: "/c", siblings: ["/b"] });

    expect(paths(next)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(next.groups).toEqual([group("Renamed", ["/a", "/b", "/c"], { color: "red" })]);
    expect(activePath(next)).toBe("/c");
  });

  it("reopens a tab ungrouped once its former group is gone", () => {
    const state = repos("/a", "/d");

    const next = reopenTab(state, {}, { path: "/c", siblings: ["/b"] });

    expect(paths(next)).toEqual(["/a", "/d", "/c"]);
    expect(next.groups).toEqual([]);
    expect(activePath(next)).toBe("/c");
  });

  it("reopens a repository with the worktree tabs that are open next to it", () => {
    const state = grouped(["/w/repo-feature", "/z"], [group("G", ["/w/repo-feature"])]);

    const next = reopenTab(state, { "/w/repo-feature": "/w/repo" }, { path: "/w/repo", siblings: ["/w/repo-feature"] });

    expect([...(next.groups[0]?.tabs ?? [])].sort()).toEqual(["/w/repo", "/w/repo-feature"]);
  });
});

describe("worktree tab groups", () => {
  const mains = { "/w/repo-feature": "/w/repo", "/w/repo-fix": "/w/repo" };

  it("moves the tabs of a repository's worktrees next to it without changing which tab is active", () => {
    const state: TabsState = { ...repos("/w/repo", "/w/other", "/w/repo-feature", "/w/repo-fix"), active: 2 };

    const grouped = groupTabs(state, mains);

    expect(grouped.tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/repo", "/w/repo-feature", "/w/repo-fix", "/w/other"]);
    expect(grouped.tabs[grouped.active]).toEqual({ kind: "repo", path: "/w/repo-feature" });
  });

  it("leaves an already grouped list and unrelated tabs in place, launcher included", () => {
    const state: TabsState = { tabs: [{ kind: "repo", path: "/a" }, { kind: "launcher" }, { kind: "repo", path: "/b" }], active: 1, groups: [] };

    expect(groupTabs(state, {})).toEqual(state);
  });

  it("keeps a worktree tab in its group when its main repository is not open", () => {
    const state: TabsState = { ...repos("/w/repo-feature", "/w/other", "/w/repo-fix"), active: 0 };

    expect(groupTabs(state, mains).tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/repo-feature", "/w/repo-fix", "/w/other"]);
  });

  it("describes the groups with the main repository, each tab's position, and whether it is a linked worktree", () => {
    const grouped = groupTabs({ ...repos("/w/repo", "/w/other", "/w/repo-feature"), active: 0 }, mains);

    expect(tabGroups(grouped, mains)).toEqual([
      {
        main: "/w/repo",
        tabs: [
          { tab: { kind: "repo", path: "/w/repo" }, index: 0, linked: false },
          { tab: { kind: "repo", path: "/w/repo-feature" }, index: 1, linked: true },
        ],
      },
      { main: "/w/other", tabs: [{ tab: { kind: "repo", path: "/w/other" }, index: 2, linked: false }] },
    ]);
  });
});

describe("user tab groups", () => {
  const mains = { "/w/repo-feature": "/w/repo" };

  it("saves the groups with the tab session and restores them", () => {
    const state = grouped(["/a", "/b", "/c"], [group("Backend", ["/b", "/c"], { color: "mint", collapsed: true })], 2);

    const session = sessionOf(state);

    expect(session).toEqual({ tabs: ["/a", "/b", "/c"], active: 2, groups: [{ name: "Backend", color: "mint", collapsed: true, tabs: ["/b", "/c"] }] });
    expect(restoreTabs(session, undefined)).toEqual(state);
  });

  it("opens a collapsed group when the launch path activates one of its tabs", () => {
    const session = { tabs: ["/a", "/b"], active: 0, groups: [group("G", ["/b"], { collapsed: true })] };

    expect(restoreTabs(session, "/b").groups[0]?.collapsed).toBe(false);
    expect(restoreTabs(session, undefined).groups[0]?.collapsed).toBe(true);
  });

  it("creates a group from a tab where it stands, trimming the name", () => {
    const next = newGroup(repos("/a", "/b", "/c"), {}, "/b", "  Docs  ", "pink");

    expect(next.groups).toEqual([{ name: "Docs", color: "pink", collapsed: false, tabs: ["/b"] }]);
    expect(paths(next)).toEqual(["/a", "/b", "/c"]);
  });

  it("moves a repository together with its worktree tabs into a new group", () => {
    const state = repos("/w/repo", "/w/other", "/w/repo-feature");

    const next = newGroup(groupTabs(state, mains), mains, "/w/repo-feature", "Work", "blue");

    expect([...(next.groups[0]?.tabs ?? [])].sort()).toEqual(["/w/repo", "/w/repo-feature"]);
    expect(paths(next)).toEqual(["/w/repo", "/w/repo-feature", "/w/other"]);
  });

  it("adds a tab to the end of an existing group and keeps the active tab", () => {
    const state = grouped(["/a", "/b", "/c", "/d"], [group("G", ["/a", "/b"])], 3);

    const next = addToGroup(state, {}, "/d", 0);

    expect(paths(next)).toEqual(["/a", "/b", "/d", "/c"]);
    expect(next.groups[0]?.tabs).toEqual(["/a", "/b", "/d"]);
    expect(activePath(next)).toBe("/d");
  });

  it("moves a tab from one group to another, leaving the first group contiguous", () => {
    const state = grouped(["/a", "/b", "/c", "/d"], [group("One", ["/a", "/b", "/c"]), group("Two", ["/d"])]);

    const next = addToGroup(state, {}, "/b", 1);

    expect(paths(next)).toEqual(["/a", "/c", "/d", "/b"]);
    expect(next.groups.map((entry) => [entry.name, entry.tabs])).toEqual([
      ["One", ["/a", "/c"]],
      ["Two", ["/d", "/b"]],
    ]);
  });

  it("moves a repository's worktree tabs with it when it joins a group", () => {
    const state = groupTabs(grouped(["/a", "/b", "/w/repo", "/w/repo-feature"], [group("G", ["/a"])]), mains);

    const next = addToGroup(state, mains, "/w/repo-feature", 0);

    expect(paths(next)).toEqual(["/a", "/w/repo", "/w/repo-feature", "/b"]);
    expect(next.groups[0]?.tabs).toEqual(["/a", "/w/repo", "/w/repo-feature"]);
  });

  it("removes a tab from its group and places it right after the group", () => {
    const state = grouped(["/a", "/b", "/c", "/d"], [group("G", ["/a", "/b", "/c"])]);

    const next = removeFromGroup(state, {}, "/a");

    expect(paths(next)).toEqual(["/b", "/c", "/a", "/d"]);
    expect(next.groups[0]?.tabs).toEqual(["/b", "/c"]);
  });

  it("deletes a group left without tabs", () => {
    const state = grouped(["/a", "/b"], [group("G", ["/a"])]);

    expect(removeFromGroup(state, {}, "/a").groups).toEqual([]);
    expect(closeTab(state, 0).groups).toEqual([]);
  });

  it("keeps a worktree tab opened later inside its repository's group", () => {
    const state: TabsState = grouped(["/w/repo", "/other", "/w/repo-feature"], [group("G", ["/w/repo"])]);

    const next = groupTabs(state, mains);

    expect(paths(next)).toEqual(["/w/repo", "/w/repo-feature", "/other"]);
    expect([...(next.groups[0]?.tabs ?? [])].sort()).toEqual(["/w/repo", "/w/repo-feature"]);
  });

  it("renames, recolors, collapses, and ungroups without moving tabs", () => {
    const state = grouped(["/a", "/b"], [group("Old", ["/a", "/b"])]);

    expect(renameGroup(state, 0, "  New  ").groups[0]?.name).toBe("New");
    expect(recolorGroup(state, 0, "orange").groups[0]?.color).toBe("orange");
    expect(toggleGroup(state, 0).groups[0]?.collapsed).toBe(true);
    expect(toggleGroup(toggleGroup(state, 0), 0).groups[0]?.collapsed).toBe(false);
    const free = ungroup(state, 0);
    expect(free.groups).toEqual([]);
    expect(paths(free)).toEqual(["/a", "/b"]);
  });

  it("expands a collapsed group when one of its tabs is activated", () => {
    const state = grouped(["/a", "/b", "/c"], [group("G", ["/b", "/c"], { collapsed: true })]);

    const next = activateTab(state, 2);

    expect(next.groups[0]?.collapsed).toBe(false);
    expect(next.active).toBe(2);
    expect(activateTab(state, 0).groups[0]?.collapsed).toBe(true);
  });

  it("closes every tab of a group and activates a neighbour when the active tab was inside", () => {
    const state = grouped(["/a", "/b", "/c", "/d"], [group("G", ["/b", "/c"])], 2);

    const next = closeGroup(state, 0);

    expect(paths(next)).toEqual(["/a", "/d"]);
    expect(next.groups).toEqual([]);
    expect(activePath(next)).toBe("/d");
    expect(activePath(closeGroup({ ...state, active: 3 }, 0))).toBe("/d");
    expect(closeGroup(grouped(["/a"], [group("G", ["/a"])]), 0)).toEqual({ tabs: [{ kind: "launcher" }], active: 0, groups: [] });
  });

  it("describes the segments: a group with its repository clusters, hiding all but the active tab while collapsed", () => {
    const state = groupTabs(grouped(["/a", "/w/repo", "/w/repo-feature", "/z"], [group("G", ["/w/repo", "/w/repo-feature"], { collapsed: true })], 2), mains);

    const segments = tabSegments(state, mains);

    expect(segments.map((segment) => segment.kind)).toEqual(["cluster", "group", "cluster"]);
    const [, middle] = segments;
    if (middle?.kind !== "group") throw new Error("expected a group segment");
    expect(middle.index).toBe(0);
    expect(middle.group.name).toBe("G");
    expect(middle.clusters.flatMap((cluster) => cluster.tabs.map((entry) => [entry.index, entry.hidden]))).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("validates a group name as 1 to 40 characters", () => {
    expect(groupNameProblem("")).toBe("Enter a group name");
    expect(groupNameProblem("   ")).toBe("Enter a group name");
    expect(groupNameProblem("x".repeat(41))).toBe("A group name is at most 40 characters");
    expect(groupNameProblem("x".repeat(40))).toBeUndefined();
  });
});
