import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, mountWithApp } from "../components/testkit";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "./repoActions";
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

function install(options: { tabs: string[]; launch: string; repositories: string[]; settings?: Partial<typeof defaultSettings>; mains?: Record<string, string> }) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      switch (cmd) {
        case "settings_load":
          return { ...defaultSettings, ...options.settings };
        case "session_load":
          return { tabs: options.tabs, active: 0 };
        case "launch_path":
          return options.launch;
        case "repo_open": {
          const path = (args as { path: string }).path;
          if (!options.repositories.includes(path)) throw { kind: "not_a_repository", message: `${path} is not inside a Git repository`, output: null };
          return { root: path, main_root: options.mains?.[path] ?? path };
        }
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
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/r"], active: 0 } });
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
      actions: { sync: () => ({ kind: "idle" }), undo: async (id: number) => void undone.push(id) } as unknown as RepoActions,
      selectedSha: () => undefined,
      selectedShas: () => [],
      revealCommit: () => undefined,
      revealRef: () => undefined,
      revealHead: () => undefined,
      openSearch: () => undefined,
      focusComposer: () => undefined,
      loadCommits: async () => [],
      openPanel: () => undefined,
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
      actions: { sync: () => ({ kind: "idle" }) } as unknown as RepoActions,
      selectedSha: () => undefined,
      selectedShas: () => [],
      revealCommit: () => undefined,
      revealRef: () => undefined,
      revealHead: () => calls.push("reveal-head"),
      openSearch: () => calls.push("search"),
      focusComposer: () => calls.push("composer"),
      loadCommits: async () => [],
      openPanel: () => undefined,
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
    expect(app.tabGroups().map((group) => [group.main, group.tabs.map((entry) => entry.linked)])).toEqual([
      ["/w/repo", [false, true]],
      ["/w/other", [false]],
    ]);

    await app.openRepository("/w/repo-fix");

    expect(app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : tab.kind))).toEqual(["/w/repo", "/w/repo-feature", "/w/repo-fix", "/w/other"]);
    expect(app.activePath()).toBe("/w/repo-fix");
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
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/a", "/b"], active: 0 } });
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
});
