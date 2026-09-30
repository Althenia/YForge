import { describe, expect, it } from "vitest";
import { activateTab, closeTab, groupTabs, openLauncherTab, openRepoTab, restoreTabs, sessionOf, tabGroups, tabLabel, type TabsState } from "./tabs";

const repos = (...paths: string[]): TabsState => ({ tabs: paths.map((path) => ({ kind: "repo", path })), active: 0 });

describe("tabs", () => {
  it("opens a repository as a new active tab and re-activates one already open", () => {
    const opened = openRepoTab(repos("/a"), "/b");
    expect(opened.tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(opened.active).toBe(1);
    expect(openRepoTab(opened, "/a")).toEqual({ tabs: opened.tabs, active: 0 });
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
    expect(openLauncherTab({ ...once, active: 0 })).toEqual({ tabs: once.tabs, active: 1 });
    const alone = openRepoTab({ tabs: [{ kind: "launcher" }], active: 0 }, "/a");
    expect(alone).toEqual({ tabs: [{ kind: "repo", path: "/a" }], active: 0 });
  });

  it("closes tabs keeping the active tab stable and falls back to the launcher", () => {
    const three: TabsState = { ...repos("/a", "/b", "/c"), active: 2 };
    expect(closeTab(three, 0)).toEqual({ tabs: three.tabs.slice(1), active: 1 });
    expect(closeTab(three, 2)).toEqual({ tabs: three.tabs.slice(0, 2), active: 1 });
    expect(closeTab({ ...three, active: 1 }, 1).active).toBe(1);
    expect(closeTab(repos("/a"), 0)).toEqual({ tabs: [{ kind: "launcher" }], active: 0 });
  });

  it("ignores activating a tab that does not exist", () => {
    const state = repos("/a", "/b");
    expect(activateTab(state, 1).active).toBe(1);
    expect(activateTab(state, 5)).toBe(state);
  });

  it("saves only repository tabs and restores them, adding the launch path last", () => {
    const state: TabsState = { tabs: [{ kind: "repo", path: "/a" }, { kind: "launcher" }, { kind: "repo", path: "/b" }], active: 2 };
    const session = sessionOf(state);
    expect(session).toEqual({ tabs: ["/a", "/b"], active: 1 });
    expect(restoreTabs(session, undefined)).toEqual({ tabs: repos("/a", "/b").tabs, active: 1 });
    expect(restoreTabs(session, "/c").active).toBe(2);
    expect(restoreTabs(session, "/a").active).toBe(0);
  });

  it("restores an empty session as the launcher and opens the launch path over it", () => {
    expect(restoreTabs({ tabs: [], active: 0 }, undefined)).toEqual({ tabs: [{ kind: "launcher" }], active: 0 });
    expect(restoreTabs({ tabs: [], active: 0 }, "/a")).toEqual({ tabs: [{ kind: "repo", path: "/a" }], active: 0 });
    expect(restoreTabs({ tabs: ["/a"], active: 9 }, undefined).active).toBe(0);
  });

  it("labels tabs by repository name", () => {
    expect(tabLabel({ kind: "repo", path: "/work/sample/" })).toBe("sample");
    expect(tabLabel({ kind: "launcher" })).toBe("New tab");
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
    const state: TabsState = { tabs: [{ kind: "repo", path: "/a" }, { kind: "launcher" }, { kind: "repo", path: "/b" }], active: 1 };

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
