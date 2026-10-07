import { QueryClientProvider } from "@tanstack/solid-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/solid-router";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, stubLayout } from "./components/testkit";
import type { GraphPage } from "./ipc/bindings/GraphPage";
import type { ProfileList } from "./ipc/bindings/ProfileList";
import type { RepoSnapshot } from "./ipc/bindings/RepoSnapshot";
import { createAppRouter, viewOf } from "./routes";
import { AppContext, createAppState } from "./state/app";
import { repoKeys } from "./state/queryKeys";
import { defaultSettings } from "./state/settingsModel";

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  mockWindows("main");
  window.matchMedia = (() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
const tokens = { "--controls-row-graph": 28, "--controls-graph-lane-pitch": 22, "--controls-graph-gutter": 4, "--controls-graph-node": 22, "--controls-graph-merge-node": 12, "--controls-graph-line": 2, "--controls-graph-arc-radius": 11, "--layout-graph-ref-column": 200, "--layout-graph-ref-column-min": 32, "--layout-graph-ref-column-max": 300, "--layout-graph-author-column": 130, "--layout-graph-date-column": 130, "--layout-graph-sha-column": 100, "--layout-graph-column": 56 };
  for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, `${value}px`);
  document.documentElement.style.setProperty("--layout-graph-message-column-min", "50px");
  document.documentElement.style.setProperty("--controls-hit-min", "24px");
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  restoreLayout = undefined;
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const snapshotAt = (root: string): RepoSnapshot => ({
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
});

type Call = { cmd: string; args: Record<string, unknown> };

const graphAt = (path: string, offset = 0, limit = 200, dirty = false): GraphPage => ({
  total: 600,
  carried: [],
  rows: Array.from({ length: Math.max(0, Math.min(limit, 600 - offset)) }, (_, index) => {
    const position = offset + index;
    const changes = dirty && position === 0;
    return {
      sha: changes ? null : `${path === "/a" ? "a" : "b"}${position.toString(16).padStart(39, "0")}`,
      parents: [],
      summary: `${path} ${changes ? "changes" : `commit ${position}`}`,
      body: "",
      author: null,
      time: null,
      refs: position === (dirty ? 1 : 0) ? [{ kind: "local_branch", name: "main", is_head: true }] : [],
      kind: changes ? "changes" : "commit",
      column: 0,
      edges: [],
    };
  }),
});

async function mountApp(
  session: { tabs: string[]; active: number },
  repoOpen?: (path: string) => RepoSnapshot | Promise<RepoSnapshot>,
  repoGraph?: (path: string, offset: number, limit: number) => GraphPage | Promise<GraphPage>,
  handlers: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      const handler = handlers[cmd];
      if (handler !== undefined) return handler((args ?? {}) as Record<string, unknown>);
      switch (cmd) {
        case "settings_load":
          return defaultSettings;
        case "repo_aliases_list":
          return [];
        case "session_load":
          return { ...session, groups: [] };
        case "launch_path":
          return "/nowhere";
        case "repo_open": {
          const path = (args as { path: string }).path;
          if (!session.tabs.includes(path)) throw { kind: "not_a_repository", message: "no", output: null };
          return repoOpen?.(path) ?? snapshotAt(path);
        }
        case "app_info":
          return { app_version: "0.1.0", git_version: "2.50.0" };
        case "repo_graph": {
          const { path, offset, limit } = args as { path: string; offset: number; limit: number };
          return repoGraph?.(path, offset, limit) ?? { rows: [], carried: [], total: 0 };
        }
        case "activity_list":
        case "recents_list":
        case "remotes_list":
        case "switch_stashes":
        case "recent_statuses":
          return [];
        case "plugin:path|resolve_directory":
          return "/Users/yui";
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  const host = document.createElement("div");
  document.body.append(host);
  let app!: ReturnType<typeof createAppState>;
  dispose = render(() => {
    app = createAppState(router);
    return (
      <QueryClientProvider client={app.queryClient}>
        <AppContext.Provider value={app}>
          <RouterProvider router={router} />
        </AppContext.Provider>
      </QueryClientProvider>
    );
  }, host);
  await vi.waitFor(() => expect(app.ready()).toBe(true));
  await flush(60);
  const watched = () => calls.filter((call) => call.cmd === "repo_watch").map((call) => call.args.path);
  const workspaces = () => host.querySelectorAll(".commandbar").length;
  return { app, router, host, calls, watched, workspaces };
}

describe("routes", () => {
  it("renders the warm target graph without an uncached profile read suspending a dirty repository tab", async () => {
    restoreLayout = stubLayout();
    const profiles: ProfileList = { active: "default", profiles: [{ id: "default", name: "Default", author_name: "Synthetic", author_email: "author@example.test" }] };
    let holdProfiles = false;
    let finishProfiles!: (value: ProfileList) => void;
    const pendingProfiles = new Promise<ProfileList>((resolve) => { finishProfiles = resolve; });
    const { app, host, calls } = await mountApp(
      { tabs: ["/a", "/b"], active: 0 },
      (path) => ({ ...snapshotAt(path), counts: { ...snapshotAt(path).counts, modified: 1 }, files: [{ path: "src/work.ts", area: "unstaged", status: "modified", original_path: null }] }),
      (path, offset, limit) => graphAt(path, offset, limit, true),
      { profiles_list: () => holdProfiles ? pendingProfiles : profiles },
    );
    try {
      app.activate(1);
      await vi.waitFor(() => expect(host.querySelector(".grow .sum")?.textContent).toBe("/b changes"));
      app.activate(0);
      await vi.waitFor(() => expect(host.querySelector(".grow .sum")?.textContent).toBe("/a changes"));
      expect(app.profileList()?.active).toBe("default");
      const profileReads = calls.filter((call) => call.cmd === "profiles_list").length;
      const graphReads = calls.filter((call) => call.cmd === "repo_graph" && call.args.path === "/b" && call.args.offset === 0).length;
      holdProfiles = true;

      app.activate(1);
      await flush(40);

      expect(app.activePath()).toBe("/b");
      expect(host.querySelector('.grow[role="option"] .sum')?.textContent).toBe("/b changes");
      expect(host.textContent).not.toContain("/a changes");
      expect(calls.filter((call) => call.cmd === "profiles_list")).toHaveLength(profileReads);
      expect(calls.filter((call) => call.cmd === "repo_graph" && call.args.path === "/b" && call.args.offset === 0)).toHaveLength(graphReads + 1);
    } finally {
      finishProfiles(profiles);
      await flush();
    }
  });

  it("fetches the target viewport requested during a failed cached-tab graph refresh", async () => {
    restoreLayout = stubLayout();
    let holdGraphRefresh = false;
    let failRefresh!: (failure: unknown) => void;
    const graphRefresh = new Promise<GraphPage>((_resolve, reject) => { failRefresh = reject; });
    const { app, host, calls } = await mountApp({ tabs: ["/a", "/b"], active: 0 }, undefined, (path, offset, limit) => {
      if (holdGraphRefresh && path === "/a" && offset === 0) return graphRefresh;
      return graphAt(path, offset, limit);
    });
    try {
      expect(host.querySelector(".grow .sum")?.textContent).toBe("/a commit 0");
      app.activate(1);
      await vi.waitFor(() => expect(host.querySelector(".grow .sum")?.textContent).toBe("/b commit 0"));
      const aReads = calls.filter((call) => call.cmd === "repo_graph" && call.args.path === "/a" && call.args.offset === 0).length;
      holdGraphRefresh = true;

      app.activate(0);
      await vi.waitFor(() => expect(calls.filter((call) => call.cmd === "repo_graph" && call.args.path === "/a" && call.args.offset === 0)).toHaveLength(aReads + 1));
      expect(host.querySelector(".grow .sum")?.textContent).toBe("/a commit 0");
      const scroller = host.querySelector<HTMLElement>(".gscroll") as HTMLElement;
      scroller.scrollTop = 400 * 28;
      scroller.dispatchEvent(new Event("scroll"));
      await flush();
      holdGraphRefresh = false;
      failRefresh({ kind: "git_failed", message: "Synthetic refresh refusal", output: null });

      await vi.waitFor(() => expect(host.querySelector("#graph-row-400 .sum")?.textContent).toBe("/a commit 400"));
      expect(app.activePath()).toBe("/a");
      expect(calls.filter((call) => call.cmd === "repo_graph" && call.args.path === "/a" && call.args.offset === 400)).toHaveLength(1);
      expect(host.textContent).not.toContain("/b commit");
    } finally {
      failRefresh({ kind: "git_failed", message: "Synthetic refresh refusal", output: null });
      await flush();
    }
  });

  it("updates the mounted composer from the shared profile source after a profile refresh", async () => {
    restoreLayout = stubLayout();
    let profiles: ProfileList = { active: "default", profiles: [{ id: "default", name: "Default", author_name: "Synthetic", author_email: "author@example.test" }] };
    const { app, host, calls } = await mountApp(
      { tabs: ["/a"], active: 0 },
      (path) => ({ ...snapshotAt(path), counts: { ...snapshotAt(path).counts, modified: 1 }, files: [{ path: "src/work.ts", area: "unstaged", status: "modified", original_path: null }] }),
      (path, offset, limit) => graphAt(path, offset, limit, true),
      { profiles_list: () => profiles },
    );
    expect(host.querySelector(".composer-identity")?.textContent).toBe("Committing as Synthetic author@example.test");
    const reads = calls.filter((call) => call.cmd === "profiles_list").length;
    profiles = { active: "default", profiles: [{ ...profiles.profiles[0]!, author_name: "Updated author" }] };

    await app.loadProfiles();
    await flush();

    expect(host.querySelector(".composer-identity")?.textContent).toBe("Committing as Updated author author@example.test");
    expect(calls.filter((call) => call.cmd === "profiles_list")).toHaveLength(reads + 1);
  });

  it("shows the Launchpad for a new tab and a repository on the repo route, addressed by tab id (S41)", async () => {
    const { router, host, workspaces } = await mountApp({ tabs: ["/a"], active: 0 });

    expect(router.state.location.pathname).toBe("/repo");
    expect(router.state.location.search).toEqual({ tab: "/a" });
    expect(workspaces()).toBe(1);

    await router.navigate({ to: "/launcher" });
    await flush(40);
    expect(host.querySelector(".launchpad")).not.toBeNull();
    expect(host.querySelector(".launcher")).toBeNull();
    expect(workspaces()).toBe(0);
  });

  it("opens the Launchpad from the app, keeps the active tab addressed, and the tab bar button returns to it", async () => {
    const { app, router, host } = await mountApp({ tabs: ["/a"], active: 0 });

    app.openLaunchpad();
    await flush(80);

    expect(router.state.location.pathname).toBe("/launchpad");
    expect(router.state.location.search).toEqual({ tab: "/a" });
    expect(host.querySelector(".launchpad")).not.toBeNull();
    expect(app.launchpadOpen()).toBe(true);
    const button = host.querySelector<HTMLButtonElement>('.tabbar button[aria-label="Launchpad"]') as HTMLButtonElement;
    expect(button.getAttribute("aria-current")).toBe("page");

    button.click();
    await flush(80);

    expect(router.state.location.pathname).toBe("/repo");
    expect(app.launchpadOpen()).toBe(false);
  });

  it("lands a window with no repository and a new tab on the Launchpad (S41)", async () => {
    const { app, router, host } = await mountApp({ tabs: [], active: 0 });
    await flush(60);
    expect(host.querySelector(".launchpad")).not.toBeNull();

    app.openLauncher();
    await flush(80);

    expect(router.state.location.pathname).toBe("/launcher");
    expect(host.querySelector(".launchpad")).not.toBeNull();
  });

  it("keeps only the active tab's workspace mounted and watches the active repository", async () => {
    const { app, watched, workspaces, router } = await mountApp({ tabs: ["/a", "/b"], active: 0 });
    expect(watched()).toEqual(["/a"]);

    app.activate(1);
    await flush(60);

    expect(router.state.location.search).toEqual({ tab: "/b" });
    expect(workspaces()).toBe(1);
    expect(watched()).toEqual(["/a", "/b"]);
    expect(app.activePath()).toBe("/b");
  });

  it("returns to an earlier tab without the loading screen and refreshes its state in the background (S8)", async () => {
    const { app, host, calls } = await mountApp({ tabs: ["/a", "/b"], active: 0 });
    app.activate(1);
    await flush(60);
    const opensBefore = calls.filter((call) => call.cmd === "repo_open" && call.args.path === "/a").length;
    const flashed: string[] = [];
    new MutationObserver(() => {
      if (host.textContent?.includes("Opening repository")) flashed.push("loading");
    }).observe(host, { childList: true, subtree: true, characterData: true });

    app.activate(0);
    await flush(60);

    expect(flashed).toEqual([]);
    expect(host.querySelectorAll(".commandbar").length).toBe(1);
    expect(calls.filter((call) => call.cmd === "repo_open" && call.args.path === "/a").length).toBe(opensBefore + 1);
  });

  it("keeps the cached target repository visible while its tab refresh is pending", async () => {
    let finishRefresh!: (snapshot: RepoSnapshot) => void;
    let bOpens = 0;
    const refresh = new Promise<RepoSnapshot>((resolve) => {
      finishRefresh = resolve;
    });
    const { app, host, calls } = await mountApp({ tabs: ["/a", "/b"], active: 0 }, (path) => {
      if (path === "/b" && ++bOpens > 1) return refresh;
      const snapshot = snapshotAt(path);
      return { ...snapshot, head: { ...snapshot.head, name: path === "/a" ? "source-a" : "main" } };
    });
    const cached = { ...snapshotAt("/b"), head: { kind: "branch" as const, name: "cached-b", sha: "b".repeat(40) } };
    app.queryClient.setQueryData(repoKeys.snapshot("/b"), cached);
    await app.queryClient.invalidateQueries({ queryKey: repoKeys.snapshot("/b"), refetchType: "none" });

    app.activate(1);
    await flush(60);

    expect(calls.some((call) => call.cmd === "repo_open" && call.args.path === "/b")).toBe(true);
    expect(app.activePath()).toBe("/b");
    expect(host.textContent).toContain("cached-b");
    expect(host.textContent).not.toContain("source-a");
    expect(host.textContent).not.toContain("Opening repository");

    finishRefresh(snapshotAt("/b"));
    await flush(60);
    expect(host.textContent).toContain("main");
  });

  it("keeps the focused control focused while the repository refreshes", async () => {
    const { app, host } = await mountApp({ tabs: ["/a"], active: 0 });
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Filter sidebar"]');
    expect(field).not.toBeNull();
    field?.focus();
    expect(document.activeElement).toBe(field);
    const detached: Node[] = [];
    new MutationObserver((records) => records.forEach((record) => detached.push(...record.removedNodes))).observe(host, { childList: true, subtree: true });

    await app.queryClient.invalidateQueries({ queryKey: ["repo", "/a"] });
    await flush(60);

    expect(detached.filter((node) => node instanceof HTMLElement && node.classList.contains("app"))).toEqual([]);
    expect(document.activeElement).toBe(field);
  });

  it("replaces a cached workspace with the not-a-repository state when its refresh is refused and recovers on return", async () => {
    let missing = false;
    const { app, host, workspaces } = await mountApp({ tabs: ["/a", "/b"], active: 0 }, (path) => {
      if (path === "/a" && missing) throw { kind: "not_a_repository", message: "Repository was moved", output: null };
      return snapshotAt(path);
    });
    missing = true;
    await app.queryClient.invalidateQueries({ queryKey: repoKeys.snapshot("/a") });
    await flush();

    expect(host.textContent).toContain("This folder is not a Git repository");
    expect(host.textContent).toContain("Nothing was changed");
    expect(workspaces()).toBe(0);
    expect(app.paletteContext().snapshot).toBeUndefined();

    app.activate(1);
    await flush(60);
    expect(workspaces()).toBe(1);
    missing = false;
    app.activate(0);
    await flush(60);
    expect(workspaces()).toBe(1);
    expect(host.textContent).not.toContain("This folder is not a Git repository");
    expect(app.paletteContext().snapshot?.root).toBe("/a");
  });

  it("keeps a cached workspace and reports the cause when an ordinary refresh fails", async () => {
    let failing = false;
    const { app, host, workspaces } = await mountApp({ tabs: ["/a"], active: 0 }, (path) => {
      if (failing) throw { kind: "git_failed", message: "git status could not read the index", output: null };
      return snapshotAt(path);
    });
    failing = true;
    await app.queryClient.invalidateQueries({ queryKey: repoKeys.snapshot("/a") });
    await flush();

    expect(host.textContent).toContain("git status could not read the index");
    expect(workspaces()).toBe(1);
    expect(app.paletteContext().snapshot?.root).toBe("/a");
  });

  it("settles rapid tab, settings, and Launchpad transitions on the last repository without a blank outlet", async () => {
    const { app, host, workspaces } = await mountApp({ tabs: ["/a", "/b"], active: 0 });
    for (let index = 0; index < 3; index += 1) {
      app.activate(1);
      app.openSettings("general");
      app.openLaunchpad();
      app.activate(0);
    }
    await flush(80);

    expect(app.activePath()).toBe("/a");
    expect(workspaces()).toBe(1);
    expect(host.querySelector(".tabbar")).not.toBeNull();
    expect(app.paletteContext().snapshot?.root).toBe("/a");
  });

  it("keeps an invalid launch or open notice visible on repository, settings, and Launchpad routes", async () => {
    const { app, host, router } = await mountApp({ tabs: ["/a"], active: 0 });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("/nowhere is not a Git repository");

    expect(await app.openRepository("/missing")).toBe(false);
    expect(app.activePath()).toBe("/a");
    expect(router.state.location.pathname).toBe("/repo");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("/missing is not a Git repository");

    app.openSettings("general");
    await flush(60);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("/missing is not a Git repository");
    app.openLaunchpad();
    await flush(60);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("/missing is not a Git repository");

    app.setNotice(undefined);
    expect(await app.openRepository("/a")).toBe(true);
    await flush(60);
    expect(host.querySelector(".commandbar")).not.toBeNull();
    expect(app.activePath()).toBe("/a");
    expect(app.notice()).toBeUndefined();
  });

  it("switches between a repository with no commits and committed history without mistaking either for an invalid folder", async () => {
    const { app, host, workspaces } = await mountApp({ tabs: ["/a", "/empty"], active: 0 }, (path) => {
      const snapshot = snapshotAt(path);
      return path === "/empty" ? { ...snapshot, head: { kind: "unborn", branch: "main" }, branches: [] } : snapshot;
    });

    app.activate(1);
    await flush(60);
    expect(workspaces()).toBe(1);
    expect(host.textContent).toContain("This repository has no commits yet");
    expect(host.textContent).not.toContain("This folder is not a Git repository");
    expect(app.paletteContext().snapshot?.head.kind).toBe("unborn");

    app.activate(0);
    await flush(60);
    expect(workspaces()).toBe(1);
    expect(host.textContent).not.toContain("This repository has no commits yet");
    app.activate(1);
    await flush(60);
    expect(workspaces()).toBe(1);
    expect(host.textContent).toContain("This repository has no commits yet");
  });

  it("opens settings over the active tab through the router and closes back to that tab", async () => {
    const { app, host, router, workspaces } = await mountApp({ tabs: ["/a", "/b"], active: 1 });

    app.openSettings("repository");
    await flush(60);

    expect(router.state.location.pathname).toBe("/settings/repository");
    expect(router.state.location.search).toEqual({ tab: "/b" });
    expect(app.screen()).toEqual({ kind: "settings", section: "repository" });
    expect(app.activePath()).toBe("/b");
    expect(host.querySelector("main.settings")).not.toBeNull();
    expect(workspaces()).toBe(0);

    app.closeSettings();
    await flush(60);

    expect(router.state.location.pathname).toBe("/repo");
    expect(app.screen()).toEqual({ kind: "workspace" });
    expect(workspaces()).toBe(1);
  });

  it("maps a location to a view", async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/settings/git?tab=%2Fa"] }));
    await router.load();
    expect(viewOf(router.matchRoutes(router.state.location))).toEqual({ kind: "settings", section: "git", tab: "/a" });
    await router.navigate({ to: "/launcher" });
    expect(viewOf(router.matchRoutes(router.state.location))).toEqual({ kind: "launcher" });
    await router.navigate({ to: "/repo", search: { tab: "/a b" } });
    expect(viewOf(router.matchRoutes(router.state.location))).toEqual({ kind: "repo", tab: "/a b" });
  });
});
