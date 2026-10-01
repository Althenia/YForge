import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { defaultSettings } from "../state/settingsModel";
import { Workspace } from "./Workspace";
import { buttonNamed, flush, mountWithApp, stubLayout } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  restoreLayout = stubLayout();
  mockWindows("main");
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreLayout?.();
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const geometry = { row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 160, laneColors: 10 };
const info: AppInfo = { app_version: "0.1.0", git_version: "2.50.0" };
const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot: RepoSnapshot = {
  root: "/r",
  main_root: "/r",
  head: { kind: "branch", name: "main", sha: "a".repeat(40) },
  upstream: null,
  counts,
  files: [],
  operation: null,
  operation_detail: null,
  last_fetch: null,
  worktrees: [{ path: "/r", head: null, branch: "main", bare: false, locked: false, prunable: false, current: true }],
  branches: ["main", "web-model-sort"],
  remote_branches: [],
  remotes: [],
  tags: [],
  stashes: [],
};

type Call = { cmd: string; args: Record<string, unknown> };

async function mountWorkspace(respond: (call: Call) => unknown = () => undefined, shape: RepoSnapshot = snapshot) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      const custom = respond(call);
      if (custom !== undefined) return custom;
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "repo_aliases_list") return [];
      if (cmd === "session_load") return { tabs: ["/r"], active: 0, groups: [] };
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") return shape;
      if (cmd === "repo_graph") return { rows: [], carried: [], total: 0 };
      if (cmd === "recents_list" || cmd === "activity_list" || cmd === "remotes_list" || cmd === "switch_stashes") return [];
      if (cmd === "platform_repo_match") return null;
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => <Workspace view={{ status: "ready", path: "/r", snapshot: shape, info }} geometry={geometry} />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush(60);
  return { ...mounted, calls };
}

describe("Escape in the workspace", () => {
  it("is consumed even when there is nothing to close, so the system never acts on it", async () => {
    await mountWorkspace();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("automatic fetch", () => {
  it("pauses visibly when a timed fetch fails, stops fetching, and resumes after a successful fetch from the chip", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      let failing = true;
      const { host, calls } = await mountWorkspace(
        (call) => {
          if (call.cmd === "settings_load") return { ...defaultSettings, auto_fetch_minutes: 5 };
          if (call.cmd === "fetch" && failing) throw { kind: "internal", message: "git fetch failed", output: null };
          return undefined;
        },
        { ...snapshot, remotes: ["origin"] },
      );
      const fetches = () => calls.filter((call) => call.cmd === "fetch");
      const chip = () => [...host.querySelectorAll<HTMLButtonElement>(".chips button")].find((entry) => /Fetch now/.test(entry.getAttribute("aria-label") ?? ""));

      vi.advanceTimersByTime(5 * 60 * 1000);
      await flush(60);

      expect(fetches().map((call) => call.args.interactive)).toEqual([false]);
      expect(chip()?.textContent).toContain("Auto-fetch paused: git fetch failed");

      vi.advanceTimersByTime(5 * 60 * 1000);
      await flush(60);
      expect(fetches()).toHaveLength(1);

      failing = false;
      chip()?.click();
      await flush(60);
      expect(fetches()).toHaveLength(2);
      expect(host.textContent).not.toContain("Auto-fetch paused");

      vi.advanceTimersByTime(5 * 60 * 1000);
      await flush(60);
      expect(fetches()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checking out a branch that a worktree owns", () => {
  it("shows the message with Open worktree, which opens that worktree's tab", async () => {
    const { host, calls } = await mountWorkspace((call) => {
      if (call.cmd === "checkout") throw { kind: "branch_in_worktree", message: "web-model-sort is checked out in worktree /w/web-model-sort", output: null };
      return undefined;
    });

    host.querySelector<HTMLElement>('[data-nav="branch:web-model-sort"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush(40);

    expect(host.querySelector(".strip-notice")?.textContent).toContain("web-model-sort is checked out in worktree /w/web-model-sort");
    buttonNamed(host, "Open worktree")?.click();
    await flush(40);

    expect(calls.filter((call) => call.cmd === "repo_open").map((call) => call.args.path)).toContain("/w/web-model-sort");
    expect(host.querySelector(".strip-notice")).toBeNull();
  });
});

describe("Jira issue inspector", () => {
  const found = { key: "ABC-155", summary: "Show the account switcher", status: "Done", status_category: "done", issue_type: "Story", project: "ABC", assignee: "Sam Lee", updated_at: "2026-10-01T09:30:00.000+0000", web_url: "https://your-site.atlassian.net/browse/ABC-155", connection_id: "j1" };

  it("opens when an issue row in the sidebar is activated and opens the issue in the browser", async () => {
    const { host } = await mountWorkspace((call) => {
      if (call.cmd === "jira_connections_list") return [{ id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "Sam Lee", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 }];
      if (call.cmd === "jira_my_issues") return { issues: [found], total: 1, capped: false };
      return undefined;
    });
    const browser = vi.spyOn(window, "open").mockReturnValue(null);

    host.querySelector<HTMLElement>('[data-nav="issue:ABC-155"]')?.click();
    await flush(60);

    const panel = host.querySelector('aside[aria-label="Issue"]') as HTMLElement;
    expect(panel.querySelector("h2")?.textContent).toBe("Issue ABC-155");
    expect(panel.textContent).toContain("your-site.atlassian.net · Accounts");
    expect(panel.querySelector(".chip")?.classList.contains("chip-success")).toBe(true);
    expect(host.querySelector('[data-nav="issue:ABC-155"]')?.getAttribute("aria-current")).toBe("true");
    buttonNamed(panel, "Open in browser")?.click();
    expect(browser).toHaveBeenCalledWith("https://your-site.atlassian.net/browse/ABC-155", "_blank", "noopener,noreferrer");
  });
});
