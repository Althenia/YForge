import { QueryClientProvider } from "@tanstack/solid-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/solid-router";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "./components/testkit";
import type { RepoSnapshot } from "./ipc/bindings/RepoSnapshot";
import { createAppRouter, viewOf } from "./routes";
import { AppContext, createAppState } from "./state/app";
import { defaultSettings } from "./state/settingsModel";

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  mockWindows("main");
  window.matchMedia = (() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => undefined;
const tokens = { "--controls-row-graph": 28, "--controls-graph-lane-pitch": 22, "--controls-graph-gutter": 4, "--controls-graph-node": 22, "--controls-graph-merge-node": 12, "--controls-graph-line": 2, "--controls-graph-arc-radius": 11, "--layout-graph-ref-column": 200, "--layout-graph-ref-column-min": 32, "--layout-graph-ref-column-max": 300, "--layout-graph-author-column": 130, "--layout-graph-date-column": 130, "--layout-graph-sha-column": 100, "--layout-graph-column": 56 };
  for (const [name, value] of Object.entries(tokens)) document.documentElement.style.setProperty(name, `${value}px`);
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
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

async function mountApp(session: { tabs: string[]; active: number }) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
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
          return snapshotAt(path);
        }
        case "app_info":
          return { app_version: "0.1.0", git_version: "2.50.0" };
        case "repo_graph":
          return { rows: [], carried: [], total: 0 };
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
