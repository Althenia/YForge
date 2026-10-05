import type { PlatformActions } from "./platformActions";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, mountWithApp } from "../components/testkit";
import type { RepoBridge } from "./app";
import { highlightLines, loadLanguage, setSyntaxHighlighting } from "./syntax";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "./repoActions";
import { repoKeys } from "./queryKeys";
import { defaultSettings } from "./settingsModel";

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  window.matchMedia = (() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  vi.restoreAllMocks();
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

function install(options: { tabs: string[]; groups?: Array<{ name: string; color: "mint"; collapsed: boolean; tabs: string[] }>; launch: string; repositories: string[]; settings?: Partial<typeof defaultSettings>; mains?: Record<string, string>; failSessionSave?: () => boolean; failSettingsSave?: boolean; holdRepoOpen?: Promise<void>; aliases?: Array<{ path: string; alias: string }>; handlers?: Record<string, (args: Record<string, unknown>) => unknown> }) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      const custom = options.handlers?.[cmd];
      if (custom !== undefined) return custom((args ?? {}) as Record<string, unknown>);
      switch (cmd) {
        case "settings_load":
          return { ...defaultSettings, ...options.settings };
        case "session_load":
          return { tabs: options.tabs, active: 0, groups: options.groups ?? [] };
        case "launch_path":
          return options.launch;
        case "repo_aliases_list":
          return options.aliases ?? [];
        case "repo_alias_set": {
          const { path, alias } = args as { path: string; alias: string | null };
          if (alias === "refuse") throw { kind: "invalid_request", message: "An alias is at most 40 characters", output: null };
          options.aliases = [...(options.aliases ?? []).filter((entry) => entry.path !== path), ...(alias === null ? [] : [{ path, alias }])];
          return options.aliases;
        }
        case "settings_save":
          if (options.failSettingsSave === true) throw { kind: "internal", message: "settings database is read-only", output: null };
          return (args as { settings: typeof defaultSettings }).settings;
        case "session_save":
          if (options.failSessionSave?.()) throw { kind: "internal", message: "disk full", output: null };
          return null;
        case "repo_open":
          return (async () => {
            await options.holdRepoOpen;
            const path = (args as { path: string }).path;
            if (!options.repositories.includes(path)) throw { kind: "not_a_repository", message: `${path} is not inside a Git repository`, output: null };
            return { root: path, main_root: options.mains?.[path] ?? path };
          })();
        case "activity_list":
        case "recents_list":
        case "recent_add":
          return [];
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  return calls;
}

async function boot(options: Parameters<typeof install>[0]) {
  const calls = install(options);
  const mounted = mountWithApp((app) => {
    app.bind();
    return null;
  });
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return { ...mounted, calls };
}

const key = (name: string, init: KeyboardEventInit = {}, target: EventTarget = document) => {
  const event = new KeyboardEvent("keydown", { key: name, metaKey: true, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("app state", () => {
  it("restores the saved tabs and opens the launch path last when it is a repository", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/b", repositories: ["/a", "/b"] });

    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(app.activePath()).toBe("/b");
    expect(app.ready()).toBe(true);
  });

  it("ignores a launch path that is not a repository and shows the launcher when nothing was saved", async () => {
    const restored = await boot({ tabs: ["/a"], launch: "/tmp", repositories: ["/a"] });
    expect(restored.app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }]);
    restored.dispose();
    document.body.innerHTML = "";

    const empty = await boot({ tabs: [], launch: "/", repositories: [] });
    expect(empty.app.activeTab()).toEqual({ kind: "launcher" });
  });

  it("applies the saved theme and density to the document", async () => {
    await boot({ tabs: [], launch: "/", repositories: [], settings: { theme: "light", density: "compact" } });

    expect([document.documentElement.dataset.theme, document.documentElement.dataset.density]).toEqual(["light", "compact"]);
  });

  it("applies a saved named palette to the document", async () => {
    await boot({ tabs: [], launch: "/", repositories: [], settings: { theme: "gruvbox" } });

    expect(document.documentElement.dataset.theme).toBe("gruvbox");
  });

  it("follows the system colour scheme for the System theme", async () => {
    await boot({ tabs: [], launch: "/", repositories: [] });

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("opens a repository as a tab, records it as recent, and saves the session; refuses a folder that is not a repository", async () => {
    const { app, calls } = await boot({ tabs: [], launch: "/", repositories: ["/r"] });

    expect(await app.openRepository("/r")).toBe(true);
    expect(await app.openRepository("/nope")).toBe(false);

    expect(app.activePath()).toBe("/r");
    expect(app.notice()).toBe("/nope is not a Git repository");
    expect(calls.find((call) => call.cmd === "recent_add")?.args).toEqual({ path: "/r" });
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/r"], active: 0, groups: [] } });
  });

  it("closing the last tab leaves the launcher", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    app.closeActiveTab();

    expect(app.activeTab()).toEqual({ kind: "launcher" });
  });

  it("⌘K toggles the palette, ⌘T opens a launcher tab, and ⌘, opens settings", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    key("k");
    expect(app.paletteOpen()).toBe(true);
    key("k");
    expect(app.paletteOpen()).toBe(false);
    key("t");
    expect(app.activeTab()).toEqual({ kind: "launcher" });
    key(",");
    expect(app.screen()).toEqual({ kind: "settings", section: "general" });
  });

  it("does not run shortcuts while the palette is open, and leaves ⌘Z to text fields", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const input = document.createElement("input");
    document.body.append(input);

    key("z", {}, input);
    key("k");
    key("t");

    expect(app.paletteOpen()).toBe(true);
    expect(app.activeTab()).toEqual({ kind: "repo", path: "/a" });
  });

  it("undoes with ⌘Z outside text fields and leaves ⌘Z to a focused text field", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const undone: number[] = [];
    app.setBridge({
      path: "/a",
      snapshot: () =>
        ({
          root: "/a",
          main_root: "/a",
          head: { kind: "branch", name: "main", sha: "a".repeat(40) },
          upstream: null,
          counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
          files: [],
          operation: null,
          operation_detail: null,
          last_fetch: null,
          worktrees: [],
          branches: ["main"],
          remote_branches: [],
          remotes: [],
          tags: [],
          stashes: [],
        }) as RepoSnapshot,
      actions: { sync: () => ({ kind: "idle" }), discardAllReason: () => undefined, createPatchReason: () => undefined, maintainReason: () => undefined, undo: async (id: number) => void undone.push(id) } as unknown as RepoActions,
      selectedSha: () => undefined,
      selectedShas: () => [],
      revealCommit: () => undefined,
      revealRef: () => undefined,
      revealHead: () => undefined,
      openSearch: () => undefined,
      focusComposer: () => undefined,
      loadCommits: async () => [],
      openPanel: () => undefined,
      platform: { matched: () => undefined, pulls: () => [] } as unknown as PlatformActions,
      viewChanges: () => undefined,
      redo: async () => undefined,
      refresh: async () => undefined,
      createTag: async () => undefined,
    });
    const entry: ActivityEntry = { id: 7, repo: "/a", operation: "stage", summary: "Staged", started_at: 0, duration_ms: 1, ok: true, local: true, toast: false, error: null, commands: [], undo: { kind: "available", scope: "stage" } };
    await emit("activity-recorded", entry);
    await flush();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    key("z", {}, input);
    expect(undone).toEqual([]);

    input.blur();
    key("z");
    expect(undone).toEqual([7]);
  });

  it("⌘F opens the commit search, ⌘⇧H reveals HEAD, and ⌘↵ takes the user to the commit message, through the open repository", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const calls: string[] = [];
    app.setBridge({
      path: "/a",
      snapshot: () =>
        ({
          root: "/a",
          main_root: "/a",
          head: { kind: "branch", name: "main", sha: "a".repeat(40) },
          upstream: null,
          counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
          files: [],
          operation: null,
          operation_detail: null,
          last_fetch: null,
          worktrees: [],
          branches: ["main"],
          remote_branches: [],
          remotes: [],
          tags: [],
          stashes: [],
        }) as RepoSnapshot,
      actions: { sync: () => ({ kind: "idle" }), discardAllReason: () => undefined, createPatchReason: () => undefined, maintainReason: () => undefined } as unknown as RepoActions,
      selectedSha: () => undefined,
      selectedShas: () => [],
      revealCommit: () => undefined,
      revealRef: () => undefined,
      revealHead: () => calls.push("reveal-head"),
      openSearch: () => calls.push("search"),
      focusComposer: () => calls.push("composer"),
      loadCommits: async () => [],
      openPanel: () => undefined,
      platform: { matched: () => undefined, pulls: () => [] } as unknown as PlatformActions,
      viewChanges: () => undefined,
      redo: async () => undefined,
      refresh: async () => undefined,
      createTag: async () => undefined,
    });

    key("f");
    key("H", { shiftKey: true });
    key("Enter");

    expect(calls).toEqual(["search", "reveal-head", "composer"]);
  });

  it("groups a worktree's tab next to its main repository, at boot and when it is opened", async () => {
    const mains = { "/w/repo-feature": "/w/repo" };
    const { app } = await boot({ tabs: ["/w/repo", "/w/other", "/w/repo-feature"], launch: "/", repositories: ["/w/repo", "/w/other", "/w/repo-feature", "/w/repo-fix"], mains: { ...mains, "/w/repo-fix": "/w/repo" } });

    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/repo", "/w/repo-feature", "/w/other"]);
    expect(app.tabSegments().map((segment) => (segment.kind === "cluster" ? [segment.cluster.main, segment.cluster.tabs.map((entry) => entry.linked)] : []))).toEqual([
      ["/w/repo", [false, true]],
      ["/w/other", [false]],
    ]);

    await app.openRepository("/w/repo-fix");

    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/repo", "/w/repo-feature", "/w/repo-fix", "/w/other"]);
    expect(app.activePath()).toBe("/w/repo-fix");
  });

  it("restores saved tab groups and keeps them in the saved session when a worktree of a grouped repository opens", async () => {
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/repo"] };
    const { app, calls } = await boot({ tabs: ["/w/repo", "/w/other"], groups: [group], launch: "/", repositories: ["/w/repo", "/w/other", "/w/repo-feature"], mains: { "/w/repo-feature": "/w/repo" } });

    expect(app.tabs().groups).toEqual([group]);
    await app.openRepository("/w/repo-feature");

    expect(app.tabs().groups).toEqual([{ ...group, tabs: ["/w/repo", "/w/repo-feature"] }]);
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({
      session: { tabs: ["/w/repo", "/w/repo-feature", "/w/other"], active: 1, groups: [{ ...group, tabs: ["/w/repo", "/w/repo-feature"] }] },
    });
  });

  it("opens and activates the tab of a path a second yforge launch hands over", async () => {
    const { app, calls } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a", "/b"] });

    await emit("open-path-requested", { path: "/b" });
    await flush();
    expect(app.activePath()).toBe("/b");
    await emit("open-path-requested", { path: "/a" });
    await flush();

    expect(app.activePath()).toBe("/a");
    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/a", "/b"], active: 0, groups: [] } });
  });

  it("tells the user when a path handed over by a second launch is not a repository", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    await emit("open-path-requested", { path: "/nope" });
    await flush();

    expect(app.activePath()).toBe("/a");
    expect(app.notice()).toBe("/nope is not a Git repository");
  });

  it("closes the tabs of a worktree that was removed", async () => {
    const { app } = await boot({ tabs: ["/w/repo", "/w/repo-feature"], launch: "/", repositories: ["/w/repo", "/w/repo-feature"], mains: { "/w/repo-feature": "/w/repo" } });

    app.closeTabsAt("/w/repo-feature");

    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/w/repo" }]);
    expect(app.activePath()).toBe("/w/repo");
  });

  it("saves each tab group action with the session and keeps the repository and its worktree tabs together", async () => {
    const { app, calls } = await boot({ tabs: ["/w/a", "/w/b", "/w/b-feature"], launch: "/", repositories: ["/w/a", "/w/b", "/w/b-feature"], mains: { "/w/b-feature": "/w/b" } });
    const saved = () => calls.filter((call) => call.cmd === "session_save").at(-1)?.args;

    app.newTabGroup("/w/a", "  Corp A ", "red");
    expect(app.tabs().groups).toEqual([{ name: "Corp A", color: "red", collapsed: false, tabs: ["/w/a"] }]);
    app.addToTabGroup("/w/b", 0);
    app.toggleTabGroup(0);
    app.recolorTabGroup(0, "orange");
    app.renameTabGroup(0, "Corp B");

    const group = { name: "Corp B", color: "orange", collapsed: true, tabs: ["/w/a", "/w/b", "/w/b-feature"] };
    expect(app.tabs().groups).toEqual([group]);
    expect(saved()).toEqual({ session: { tabs: ["/w/a", "/w/b", "/w/b-feature"], active: 0, groups: [group] } });

    app.removeFromTabGroup("/w/b");
    expect(app.tabs().groups.map((entry) => entry.tabs)).toEqual([["/w/a"]]);
    app.ungroupTabs(0);
    expect(app.tabs().groups).toEqual([]);
    expect(saved()).toEqual({ session: { tabs: ["/w/a", "/w/b", "/w/b-feature"], active: 0, groups: [] } });
  });

  it("closes the tabs of a group and deletes the group", async () => {
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/a", "/w/b"] };
    const { app, calls } = await boot({ tabs: ["/w/a", "/w/b", "/w/c"], groups: [group], launch: "/", repositories: ["/w/a", "/w/b", "/w/c"] });

    app.closeTabGroup(0);

    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/w/c" }]);
    expect(app.activePath()).toBe("/w/c");
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/w/c"], active: 0, groups: [] } });
  });

  it("hides every tab of a collapsed group, including the open repository, and expands the group when one of its tabs is activated", async () => {
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/a", "/w/b"] };
    const { app } = await boot({ tabs: ["/w/a", "/w/b", "/w/c"], groups: [group], launch: "/", repositories: ["/w/a", "/w/b", "/w/c"] });
    const visible = () => app.tabSegments().flatMap((segment) => (segment.kind === "group" ? segment.clusters : [segment.cluster]).flatMap((cluster) => cluster.tabs.filter((entry) => !entry.hidden).map((entry) => entry.tab.kind === "repo" ? entry.tab.path : "")));

    app.activate(2);
    app.toggleTabGroup(0);
    expect(visible()).toEqual(["/w/c"]);

    app.activate(1);
    expect(app.tabs().groups[0]?.collapsed).toBe(false);
    expect(visible()).toEqual(["/w/a", "/w/b", "/w/c"]);

    app.toggleTabGroup(0);
    expect(app.activePath()).toBe("/w/b");
    expect(visible()).toEqual(["/w/c"]);
  });

  it("collapses, renames, and recolors a group without leaving the settings screen", async () => {
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/a"] };
    const { app } = await boot({ tabs: ["/w/a"], groups: [group], launch: "/", repositories: ["/w/a"] });
    app.openSettings("general");
    await flush();

    app.toggleTabGroup(0);
    app.renameTabGroup(0, "Corp");
    app.recolorTabGroup(0, "cyan");
    await flush();

    expect(app.screen()).toEqual({ kind: "settings", section: "general" });
    expect(app.tabs().groups).toEqual([{ name: "Corp", color: "cyan", collapsed: true, tabs: ["/w/a"] }]);
  });

  it("reports a tab group save failure and clears it when the retry saves", async () => {
    let failing = true;
    const { app, calls } = await boot({ tabs: ["/w/a"], launch: "/", repositories: ["/w/a"], failSessionSave: () => failing });

    app.newTabGroup("/w/a", "Work", "blue");
    await flush();
    expect(app.tabGroupSaveFailure()).toBe("disk full");
    expect(app.notice()).toBeUndefined();

    failing = false;
    app.retryTabGroupSave();
    await flush();

    expect(app.tabGroupSaveFailure()).toBeUndefined();
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({
      session: { tabs: ["/w/a"], active: 0, groups: [{ name: "Work", color: "blue", collapsed: false, tabs: ["/w/a"] }] },
    });
  });

  it("exposes the saved tab count and groups while the session is restored and drops them once ready", async () => {
    let release: () => void = () => undefined;
    const holdRepoOpen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/a"] };
    install({ tabs: ["/w/a", "/w/b"], groups: [group], launch: "/", repositories: ["/w/a", "/w/b"], holdRepoOpen });
    const mounted = mountWithApp(() => null);
    dispose = mounted.dispose;
    const booting = mounted.app.boot();
    await flush();

    expect(mounted.app.ready()).toBe(false);
    expect(mounted.app.restoring()).toEqual({ tabs: 2, groups: [group] });

    release();
    await booting;

    expect(mounted.app.ready()).toBe(true);
    expect(mounted.app.restoring()).toBeUndefined();
  });

  it("reopens the most recently closed tab into its former group, and says there is none until a tab was closed", async () => {
    const group = { name: "Work", color: "mint" as const, collapsed: false, tabs: ["/w/a", "/w/b"] };
    const { app, calls } = await boot({ tabs: ["/w/a", "/w/b", "/w/c"], groups: [group], launch: "/", repositories: ["/w/a", "/w/b", "/w/c"] });
    expect(app.canReopenClosedTab()).toBe(false);

    app.closeTabAt(1);
    app.closeTabAt(1);
    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/a"]);
    expect(app.canReopenClosedTab()).toBe(true);

    await app.reopenClosedTab();
    await flush();

    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/a", "/w/c"]);
    expect(app.activePath()).toBe("/w/c");
    expect(app.tabs().groups).toEqual([{ ...group, tabs: ["/w/a"] }]);
    await app.reopenClosedTab();
    await flush();
    expect(app.tabs().groups).toEqual([{ ...group, tabs: ["/w/a", "/w/b"] }]);
    expect(app.activePath()).toBe("/w/b");
    expect(app.canReopenClosedTab()).toBe(false);
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({
      session: { tabs: ["/w/a", "/w/b", "/w/c"], active: 1, groups: [{ ...group, tabs: ["/w/a", "/w/b"] }] },
    });
  });

  it("remembers at most the last 20 closed tabs and skips a tab that is open again", async () => {
    const paths = Array.from({ length: 24 }, (_, index) => `/w/r${index}`);
    const { app } = await boot({ tabs: paths, launch: "/", repositories: paths });

    app.closeTabIds(paths.slice(1));
    expect(app.closedTabs()).toHaveLength(20);
    expect(app.closedTabs()[0]?.path).toBe("/w/r4");

    await app.openRepository("/w/r23");
    await app.reopenClosedTab();
    await flush();

    expect(app.activePath()).toBe("/w/r22");
  });

  it("closes the other tabs or the tabs to the right and names the tabs with an operation in progress first", async () => {
    const { app } = await boot({ tabs: ["/w/a", "/w/b", "/w/c", "/w/d"], launch: "/", repositories: ["/w/a", "/w/b", "/w/c", "/w/d"] });
    app.queryClient.setQueryData(repoKeys.snapshot("/w/c"), { operation: "rebase" });

    expect(app.planClose("others", "/w/b")).toEqual({ ids: ["/w/a", "/w/c", "/w/d"], busy: [{ path: "/w/c", operation: "rebase" }] });
    expect(app.planClose("right", "/w/c")).toEqual({ ids: ["/w/d"], busy: [] });
    expect(app.planClose("right", "/w/d")).toEqual({ ids: [], busy: [] });

    app.closeTabIds(app.planClose("right", "/w/b").ids);

    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/a", "/w/b"]);
    expect(app.closedTabs().map((entry) => entry.path)).toEqual(["/w/c", "/w/d"]);
  });

  it("does not remember the tabs closed because their worktree was removed", async () => {
    const { app } = await boot({ tabs: ["/w/a", "/w/b"], launch: "/", repositories: ["/w/a", "/w/b"] });

    app.closeTabsAt("/w/b");

    expect(app.canReopenClosedTab()).toBe(false);
  });

  it("shows the next and previous tab, wrapping around", async () => {
    const { app } = await boot({ tabs: ["/w/a", "/w/b", "/w/c"], launch: "/", repositories: ["/w/a", "/w/b", "/w/c"] });
    await app.openRepository("/w/a");

    app.previousTab();
    expect(app.activePath()).toBe("/w/c");
    app.nextTab();
    expect(app.activePath()).toBe("/w/a");
    app.nextTab();
    expect(app.activePath()).toBe("/w/b");
  });

  it("opens and closes the update dialog from the check for update command", async () => {
    const { app } = await boot({ tabs: ["/w/a"], launch: "/", repositories: ["/w/a"] });
    expect(app.updateDialogOpen()).toBe(false);

    app.checkForUpdate();
    expect(app.updateDialogOpen()).toBe(true);
    app.closeUpdateDialog();

    expect(app.updateDialogOpen()).toBe(false);
  });

  it("loads the repository aliases at boot and names a repository by its alias", async () => {
    const { app } = await boot({ tabs: ["/w/a", "/w/b"], launch: "/", repositories: ["/w/a", "/w/b"], aliases: [{ path: "/w/a", alias: "Corp A · API" }] });

    expect(app.aliases()).toEqual({ "/w/a": "Corp A · API" });
    expect(app.aliasOf("/w/a")).toBe("Corp A · API");
    expect(app.aliasOf("/w/b")).toBeUndefined();
  });

  it("saves, replaces, and removes an alias per repository, and keeps the old one when the save is refused", async () => {
    const { app, calls } = await boot({ tabs: ["/w/a", "/w/b"], launch: "/", repositories: ["/w/a", "/w/b"] });

    expect(await app.setAlias("/w/a", "API")).toBeUndefined();
    expect(await app.setAlias("/w/b", "Web")).toBeUndefined();
    expect(await app.setAlias("/w/a", "refuse")).toBe("An alias is at most 40 characters");
    expect(app.aliases()).toEqual({ "/w/a": "API", "/w/b": "Web" });
    expect(await app.setAlias("/w/a", null)).toBeUndefined();

    expect(app.aliases()).toEqual({ "/w/b": "Web" });
    expect(calls.filter((call) => call.cmd === "repo_alias_set").map((call) => call.args)).toEqual([
      { path: "/w/a", alias: "API" },
      { path: "/w/b", alias: "Web" },
      { path: "/w/a", alias: "refuse" },
      { path: "/w/a", alias: null },
    ]);
  });

  it("runs the command a macOS menu item stands for when the menu reports a choice, through the open repository's palette", async () => {
    const { app } = await boot({ tabs: ["/w/a"], launch: "/", repositories: ["/w/a"] });

    await emit("menu-action", "tab.new");
    await flush();

    expect(app.activeTab()).toEqual({ kind: "launcher" });
  });

  it("tells the menu bar which items can act and which theme and density are chosen, and sends it again when that changes", async () => {
    const { app, calls } = await boot({ tabs: ["/w/a", "/w/b"], launch: "/", repositories: ["/w/a", "/w/b"], settings: { theme: "dark" } });
    const updates = () => calls.filter((call) => call.cmd === "menu_update").map((call) => call.args as { enabled: Record<string, boolean>; checked: Record<string, boolean> });
    await flush();

    expect(updates().at(-1)?.enabled).toMatchObject({ "tab.new": true, "tab.reopen": false, "edit.redo": false, "update.check": true });
    expect(updates().at(-1)?.checked).toMatchObject({ "theme.dark": true, "theme.light": false });

    app.closeTabAt(1);
    await flush();

    expect(updates().at(-1)?.enabled["tab.reopen"]).toBe(true);
  });

  it("sends Undo to the focused text field and Redo only there, and runs YForge's Undo for ⌘Z elsewhere", async () => {
    const { app } = await boot({ tabs: ["/w/a"], launch: "/", repositories: ["/w/a"] });
    const exec = vi.fn((_command: string) => true);
    document.execCommand = exec;
    const input = document.createElement("input");
    document.body.append(input);

    input.focus();
    await emit("menu-action", "edit.undo");
    await emit("menu-action", "edit.redo");
    await flush();
    input.blur();
    await emit("menu-action", "edit.redo");
    await flush();

    expect(exec.mock.calls.map((call) => call[0])).toEqual(["undo", "redo"]);
    expect(app.paletteOpen()).toBe(false);
  });

  it("shows the failure in the shell notice when the View menu cannot save the theme or density, and keeps the saved choice", async () => {
    const { app } = await boot({ tabs: [], launch: "/", repositories: [], settings: { theme: "dark", density: "default" }, failSettingsSave: true });

    await emit("menu-action", "theme.light");
    await flush();

    expect(app.notice()).toBe("settings database is read-only");
    expect(app.settings().theme).toBe("dark");
  });

  it("opens the palette for the Command Palette menu item", async () => {
    const { app } = await boot({ tabs: ["/w/a"], launch: "/", repositories: ["/w/a"] });

    await emit("menu-action", "palette.open");
    await flush();

    expect(app.paletteOpen()).toBe(true);
  });
});

const repoSnapshot = (root: string): RepoSnapshot =>
  ({
    root,
    main_root: root,
    head: { kind: "branch", name: "main", sha: "a".repeat(40) },
    upstream: null,
    counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
    files: [],
    operation: null,
    operation_detail: null,
    last_fetch: null,
    worktrees: [],
    branches: ["main"],
    remote_branches: [],
    remotes: [],
    tags: [],
    stashes: [],
  }) as RepoSnapshot;

function bridgeFor(path: string, overrides: Partial<RepoBridge> = {}): RepoBridge {
  return {
    path,
    snapshot: () => repoSnapshot(path),
    actions: { sync: () => ({ kind: "idle" }), discardAllReason: () => undefined, createPatchReason: () => undefined, maintainReason: () => undefined } as unknown as RepoActions,
    selectedSha: () => undefined,
    selectedShas: () => [],
    revealCommit: () => undefined,
    revealRef: () => undefined,
    revealHead: () => undefined,
    openSearch: () => undefined,
    focusComposer: () => undefined,
    loadCommits: async () => [],
    openPanel: () => undefined,
    platform: { matched: () => undefined, pulls: () => [] } as unknown as PlatformActions,
    viewChanges: () => undefined,
    redo: async () => undefined,
    refresh: async () => undefined,
    createTag: async () => undefined,
    ...overrides,
  };
}

describe("repository search, redo, zoom, layout, and syntax highlighting (S55, S61)", () => {
  it("⇧⌘O opens the palette scoped to repositories, even while it is already open, and closing clears the scope", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    key("O", { shiftKey: true });
    expect(app.paletteOpen()).toBe(true);
    expect(app.paletteScope()).toBe("repositories");
    const first = app.paletteSession();

    key("k");
    expect(app.paletteOpen()).toBe(false);
    expect(app.paletteScope()).toBeUndefined();
    key("k");
    expect(app.paletteScope()).toBeUndefined();
    key("O", { shiftKey: true });
    expect(app.paletteScope()).toBe("repositories");
    expect(app.paletteSession()).toBeGreaterThan(first);
  });

  it("⇧⌘Z redoes outside text fields once the backend reports a redo, leaves it to a focused text field, and does nothing otherwise", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const redone: string[] = [];
    app.setBridge(bridgeFor("/a", { redo: async () => void redone.push("redo") }));

    key("Z", { shiftKey: true });
    expect(redone).toEqual([]);
    expect(app.paletteContext().redo).toEqual({ kind: "unavailable", reason: "Nothing to redo" });

    await emit("redo-changed", { repo: "/a", scope: "Redo: moves main forward to abc1234" });
    await flush();
    expect(app.paletteContext().redo).toEqual({ kind: "available", scope: "Redo: moves main forward to abc1234" });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    key("Z", { shiftKey: true }, input);
    expect(redone).toEqual([]);

    input.blur();
    key("Z", { shiftKey: true });
    expect(redone).toEqual(["redo"]);

    await emit("redo-changed", { repo: "/a", scope: null });
    await flush();
    key("Z", { shiftKey: true });
    expect(redone).toEqual(["redo"]);
  });

  it("keeps the redo state of one repository apart from another", async () => {
    const { app } = await boot({ tabs: ["/a", "/b"], launch: "/", repositories: ["/a", "/b"] });
    app.setBridge(bridgeFor("/b"));

    await emit("redo-changed", { repo: "/a", scope: "Redo: elsewhere" });
    await flush();

    expect(app.paletteContext().redo.kind).toBe("unavailable");
  });

  it("⌘= steps the zoom up, saves it, and applies it to the webview; ⌘0 puts it back at 100 percent", async () => {
    mockWindows("main");
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
    const { app, calls } = await boot({ tabs: [], launch: "/", repositories: [], handlers: { app_ui_prefs_load: () => prefs } });
    await flush();

    key("=");
    await flush(40);
    expect(app.zoomPercent()).toBe(110);
    expect(calls.filter((call) => call.cmd === "app_ui_prefs_save").at(-1)?.args).toEqual({ prefs: { ...prefs, zoom_percent: 110 } });
    expect(calls.filter((call) => call.cmd === "plugin:webview|set_webview_zoom").at(-1)?.args).toMatchObject({ value: 1.1 });

    key("-");
    key("-");
    await flush(40);
    expect(app.zoomPercent()).toBe(90);
    key("0");
    await flush(40);
    expect(app.zoomPercent()).toBe(100);
    expect(calls.filter((call) => call.cmd === "plugin:webview|set_webview_zoom").map((call) => call.args.value)).toEqual([1.1, 1, 0.9, 1]);
  });

  it("applies a zoom remembered from the last run when the app starts", async () => {
    mockWindows("main");
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 150, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
    const { calls } = await boot({ tabs: [], launch: "/", repositories: [], handlers: { app_ui_prefs_load: () => prefs } });
    await flush(40);

    expect(calls.filter((call) => call.cmd === "plugin:webview|set_webview_zoom").at(-1)?.args).toMatchObject({ value: 1.5 });
  });

  it("⌘\\ hides and shows the sidebar and ⌥⌘\\ the inspector, remembered for the app, only while a repository is open", async () => {
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
    const { app, calls } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"], handlers: { app_ui_prefs_load: () => prefs } });
    await flush();

    key("\\");
    await flush(40);
    expect(app.sidebarHidden()).toBe(false);

    app.setBridge(bridgeFor("/a"));
    key("\\");
    await flush(40);
    expect(app.sidebarHidden()).toBe(true);
    key("\\", { altKey: true });
    await flush(40);
    expect(app.inspectorHidden()).toBe(true);
    expect(calls.filter((call) => call.cmd === "app_ui_prefs_save").at(-1)?.args).toEqual({ prefs: { ...prefs, sidebar_hidden: true, inspector_hidden: true } });

    key("\\");
    await flush(40);
    expect(app.sidebarHidden()).toBe(false);
  });

  it("shows the inspector again when the working directory changes are requested while it is hidden", async () => {
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: true, syntax_highlighting: true };
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"], handlers: { app_ui_prefs_load: () => prefs } });
    await flush();
    expect(app.inspectorHidden()).toBe(true);

    app.showInspector();
    await flush(40);

    expect(app.inspectorHidden()).toBe(false);
  });

  it("turns syntax highlighting off and on from the palette command and keeps the choice", async () => {
    await loadLanguage("rust");
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
    const { app, calls } = await boot({ tabs: [], launch: "/", repositories: [], handlers: { app_ui_prefs_load: () => prefs } });
    await flush();
    expect(highlightLines("rust", ["fn a() {}"])[0]?.some((segment) => segment.kind === "keyword")).toBe(true);

    app.paletteContext().app.toggleSyntaxHighlighting();
    await flush(40);

    expect(highlightLines("rust", ["fn a() {}"])[0]?.some((segment) => segment.kind === "keyword")).toBe(false);
    expect(calls.filter((call) => call.cmd === "app_ui_prefs_save").at(-1)?.args).toEqual({ prefs: { ...prefs, syntax_highlighting: false } });
    setSyntaxHighlighting(true);
  });

  it("opens the shortcuts sheet and the logs from the menu and the palette, and the release notes page", async () => {
    const { app } = await boot({ tabs: [], launch: "/", repositories: [] });

    await emit("menu-action", "help.shortcuts");
    await flush();
    expect(app.shortcutsOpen()).toBe(true);
    app.closeShortcuts();
    app.paletteContext().app.openShortcuts();
    expect(app.shortcutsOpen()).toBe(true);

    app.paletteContext().app.openLogs("performance");
    expect(app.logsTab()).toBe("performance");
    app.paletteContext().app.openLogs("errors");
    expect(app.logsTab()).toBe("errors");
    app.closeLogs();
    expect(app.logsTab()).toBeUndefined();
    app.paletteContext().app.openDrawer();
    expect(app.drawerOpen()).toBe(true);
  });

  it("runs the zoom and repository search menu items through the same commands as the palette", async () => {
    mockWindows("main");
    const prefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
    const { app } = await boot({ tabs: [], launch: "/", repositories: [], handlers: { app_ui_prefs_load: () => prefs } });
    await flush();

    await emit("menu-action", "zoom.in");
    await flush(40);
    expect(app.zoomPercent()).toBe(110);
    await emit("menu-action", "repository.search");
    await flush();
    expect(app.paletteScope()).toBe("repositories");
  });

  it("includes the repositories of the open tabs and the recents in the repository scope", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"], handlers: { recents_list: () => [{ path: "/old", opened_at: 1 }] } });
    await flush();

    expect(app.paletteContext().app.repositories()).toEqual(["/a", "/old"]);
  });
});

describe("profiles (S60)", () => {
  const profiles = (active: string) => ({
    active,
    profiles: [
      { id: "default", name: "Default", author_name: "Yui", author_email: "yui@example.test" },
      { id: "work", name: "Work", author_name: "Yui Lin", author_email: "yui@work.test" },
    ],
  });

  it("loads the active profile at start so the Launchpad tooltip can name it", async () => {
    const { app } = await boot({ tabs: [], launch: "/", repositories: [], handlers: { profiles_list: () => profiles("work") } });
    await flush();

    expect(app.activeProfile()?.name).toBe("Work");
  });

  it("saves the open tabs, switches, and replaces the open tabs with the new profile's", async () => {
    let active = "default";
    const { app, calls } = await boot({
      tabs: ["/a"],
      launch: "/",
      repositories: ["/a", "/w1", "/w2"],
      handlers: {
        profiles_list: () => profiles(active),
        profile_switch: (args) => {
          active = args.id as string;
          return null;
        },
      },
    });
    await flush();
    const install = calls.length;
    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }]);

    mockIPC(
      (cmd, args) => {
        calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
        if (cmd === "profiles_list") return profiles(active);
        if (cmd === "profile_switch") {
          active = (args as { id: string }).id;
          return null;
        }
        if (cmd === "session_load") return { tabs: ["/w1", "/w2"], active: 1, groups: [] };
        if (cmd === "repo_open") return { root: (args as { path: string }).path, main_root: (args as { path: string }).path };
        return null;
      },
      { shouldMockEvents: true },
    );

    await app.switchProfile("work");
    await flush();

    const after = calls.slice(install).map((call) => call.cmd);
    expect(after.indexOf("session_save")).toBeLessThan(after.indexOf("profile_switch"));
    expect(after.indexOf("profile_switch")).toBeLessThan(after.indexOf("session_load"));
    expect(calls.slice(install).find((call) => call.cmd === "session_save")?.args).toEqual({ session: { tabs: ["/a"], active: 0, groups: [] } });
    expect(calls.slice(install).find((call) => call.cmd === "profile_switch")?.args).toEqual({ id: "work" });
    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/w1" }, { kind: "repo", path: "/w2" }]);
    expect(app.activePath()).toBe("/w2");
    expect(app.activeProfile()?.name).toBe("Work");
    expect(app.closedTabs()).toEqual([]);
  });

  it("opens the Launchpad when the new profile has no tabs", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"], handlers: { profiles_list: () => profiles("default"), profile_switch: () => null } });
    await flush();
    expect(app.activePath()).toBe("/a");

    mockIPC(
      (cmd) => {
        if (cmd === "session_load") return { tabs: [], active: 0, groups: [] };
        if (cmd === "profiles_list") return profiles("work");
        return null;
      },
      { shouldMockEvents: true },
    );
    await app.switchProfile("work");
    await flush();

    expect(app.activeTab()).toEqual({ kind: "launcher" });
    expect(app.tabs().tabs).toEqual([{ kind: "launcher" }]);
  });

  it("shows the refusal and keeps the current tabs when the switch fails", async () => {
    const { app } = await boot({
      tabs: ["/a"],
      launch: "/",
      repositories: ["/a"],
      handlers: {
        profile_switch: () => {
          throw { kind: "invalid_request", message: "That profile no longer exists", output: null };
        },
      },
    });
    await flush();

    await app.switchProfile("gone");

    expect(app.notice()).toBe("That profile no longer exists");
    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }]);
  });
});

describe("external tools and LFS from the palette (S54, S61)", () => {
  it("opens the repository and a file in the chosen editor", async () => {
    const { app, calls } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    await app.openExternal("editor");
    await app.paletteContext().app.openFileInEditor("src/main.rs");
    await flush();

    expect(calls.filter((call) => call.cmd === "open_in_editor").map((call) => call.args)).toEqual([{ path: "/a", file: null }, { path: "/a", file: "src/main.rs" }]);
  });

  it("shows the cause when the editor cannot be launched", async () => {
    const failing = await boot({
      tabs: ["/f"],
      launch: "/",
      repositories: ["/f"],
      handlers: {
        open_in_editor: () => {
          throw { kind: "invalid_request", message: "Visual Studio Code could not be started: not found", output: null };
        },
      },
    });
    await failing.app.openExternal("editor");
    expect(failing.app.notice()).toBe("Visual Studio Code could not be started: not found");
  });

  it("opens a staged or unstaged file in the diff tool and a conflicted file in the merge tool, which then refreshes the repository", async () => {
    const { app, calls } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const refreshed: string[] = [];
    app.setBridge(bridgeFor("/a", { refresh: async () => void refreshed.push("refresh") }));
    const palette = app.paletteContext().app;

    palette.openFileInTool("a.txt", "staged");
    palette.openFileInTool("b.txt", "unstaged");
    palette.openFileInTool("c.txt", "untracked");
    palette.openFileInTool("d.txt", "conflicted");
    await flush(40);

    expect(calls.filter((call) => call.cmd === "open_in_diff_tool").map((call) => call.args)).toEqual([
      { path: "/a", file: "a.txt", source: { kind: "staged" } },
      { path: "/a", file: "b.txt", source: { kind: "unstaged" } },
      { path: "/a", file: "c.txt", source: { kind: "unstaged" } },
    ]);
    expect(calls.filter((call) => call.cmd === "open_in_merge_tool").map((call) => call.args)).toEqual([{ path: "/a", file: "d.txt" }]);
    expect(refreshed).toEqual(["refresh"]);
  });

  it("reads which external tools and LFS state the open repository has for the palette's reasons", async () => {
    const { app } = await boot({
      tabs: ["/a"],
      launch: "/",
      repositories: ["/a"],
      handlers: {
        external_tools_status: () => ({ editor: null, diff: "FileMerge", merge: null }),
        lfs_status: () => ({ installed: true, version: "3.5.1", initialized: true, patterns: [] }),
      },
    });
    await flush(40);

    expect(app.paletteContext().externalTools).toEqual({ editor: null, diff: "FileMerge", merge: null });
    expect(app.paletteContext().lfs?.initialized).toBe(true);
  });

  it("initializes LFS in the open repository and reads its state again", async () => {
    let initialized = false;
    const { app, calls } = await boot({
      tabs: ["/a"],
      launch: "/",
      repositories: ["/a"],
      handlers: {
        lfs_status: () => ({ installed: true, version: "3.5.1", initialized, patterns: [] }),
        lfs_initialize: () => {
          initialized = true;
          return null;
        },
      },
    });
    await flush(40);
    expect(app.paletteContext().lfs?.initialized).toBe(false);

    app.paletteContext().app.initializeLfs();
    await flush(60);

    expect(calls.filter((call) => call.cmd === "lfs_initialize").map((call) => call.args)).toEqual([{ path: "/a" }]);
    expect(app.paletteContext().lfs?.initialized).toBe(true);
  });

  it("opens the release notes page of the project", async () => {
    const { app } = await boot({ tabs: [], launch: "/", repositories: [] });
    const opened = vi.spyOn(window, "open").mockReturnValue(null);

    app.paletteContext().app.openReleaseNotes();

    expect(opened).toHaveBeenCalledWith("https://github.com/Althenia/YForge/releases", "_blank", "noopener,noreferrer");
  });
});
