import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { PrDetail } from "../ipc/bindings/PrDetail";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { defaultSettings } from "../state/settingsModel";
import { TooltipHost } from "./Tooltip";
import { Workspace } from "./Workspace";
import { buttonNamed, choose, flush, mountWithApp, stubLayout, type } from "./testkit";

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

const geometry = { row: 28, pitch: 22, gutter: 4, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 56, laneColors: 10 };
const info: AppInfo = { app_version: "0.1.0", git_version: "2.50.0" };
const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot: RepoSnapshot = {
  root: "/r",
  main_root: "/r",
  head: { kind: "branch", name: "feature/retry", sha: "a".repeat(40) },
  upstream: { name: "origin/feature/retry", ahead_behind: { ahead: 0, behind: 0 } },
  counts,
  files: [],
  operation: null,
  operation_detail: null,
  last_fetch: null,
  worktrees: [{ path: "/r", head: null, branch: "feature/retry", bare: false, locked: false, prunable: false, current: true }],
  branches: ["feature/retry", "main"],
  remote_branches: ["origin/HEAD", "origin/develop", "origin/feature/retry", "origin/main"],
  remotes: ["origin"],
  tags: [],
  stashes: [],
};

const connection: PlatformConnection = { id: "c1", kind: "github", host: "github.com", name: "GitHub", insecure_tls: false, created_at: 1 };
const matched = { connection, remote: "origin", repo: { owner: "team", repo: "app" } };

const pull = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
  number,
  title: `Pull ${number}`,
  body: "",
  state: "open",
  source_ref: `feature/p${number}`,
  target_ref: "main",
  author: "yui",
  created_at: "2026-09-29T08:00:00Z",
  updated_at: "2026-09-30T09:00:00Z",
  mergeable: true,
  web_url: `https://github.com/team/app/pull/${number}`,
  ...overrides,
});

type Call = { cmd: string; args: Record<string, unknown> };

type Backend = {
  match?: unknown;
  pulls?: (state: string) => PullRequest[] | Error;
  paging?: { total: number | null; capped: boolean };
  detail?: (number: number) => PrDetail;
  respond?: (call: Call) => unknown;
};

async function mountWorkspace(backend: Backend = {}) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      const custom = backend.respond?.(call);
      if (custom !== undefined) return custom;
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "repo_aliases_list") return [];
      if (cmd === "session_load") return { tabs: ["/r"], active: 0, groups: [] };
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") return snapshot;
      if (cmd === "repo_graph") return { rows: [], carried: [], total: 0 };
      if (cmd === "recents_list") return [];
      if (cmd === "activity_list") return [];
      if (cmd === "remotes_list" || cmd === "switch_stashes") return [];
      if (cmd === "platform_repo_match") return "match" in backend ? backend.match : matched;
      if (cmd === "platform_prs_list") {
        const listed = backend.pulls?.(String(call.args.state)) ?? [];
        if (listed instanceof Error) throw { kind: "auth_failed", message: listed.message, output: null };
        return { pulls: listed, ...(backend.paging ?? { total: listed.length, capped: false }) };
      }
      if (cmd === "platform_pr_detail") return backend.detail?.(Number(call.args.number)) ?? { pull: pull(Number(call.args.number)), files: [], files_total: 0, files_capped: false };
      if (cmd === "amend_info") return { sha: "a".repeat(40), summary: "Add retry helper", description: "", pushed: true };
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => (
    <>
      <Workspace view={{ status: "ready", path: "/r", snapshot, info }} geometry={geometry} />
      <TooltipHost />
    </>
  ));
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush(60);
  return { ...mounted, calls };
}

const section = (host: ParentNode) => host.querySelector<HTMLElement>('section[aria-label="Pull requests"]');
const row = (host: ParentNode, number: number) => host.querySelector<HTMLElement>(`[data-nav="pull:${number}"]`) as HTMLElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
const inspector = (host: ParentNode) => host.querySelector<HTMLElement>('aside[aria-label="Pull request"]');

describe("sidebar pull requests", () => {
  it("has no section when no connection matches the repository's remotes", async () => {
    const { host, calls } = await mountWorkspace({ match: null });

    expect(section(host)).toBeNull();
    expect(calls.some((call) => call.cmd === "platform_prs_list")).toBe(false);
  });

  it("lists open pull requests with number, title, author, source → target, and a state chip carrying a word", async () => {
    const { host, calls } = await mountWorkspace({ pulls: () => [pull(7, { title: "Add retry helper", author: "chen", source_ref: "feature/retry" }), pull(8)] });

    expect(calls.find((call) => call.cmd === "platform_repo_match")?.args).toEqual({ path: "/r" });
    expect(calls.find((call) => call.cmd === "platform_prs_list")?.args).toEqual({ path: "/r", state: "open" });
    const first = row(host, 7);
    expect(first.textContent).toContain("#7");
    expect(first.textContent).toContain("Add retry helper");
    expect(first.textContent).toContain("chen");
    expect(first.querySelector(".pull-sub")?.textContent).toContain("feature/retry → main");
    expect(first.querySelector(".pull-state")?.textContent).toBe("Open");
    expect(first.getAttribute("aria-label")).toBe("Pull request #7: Add retry helper, by chen, feature/retry to main, Open");
    expect(section(host)?.querySelector(".count")?.textContent).toBe("2");
    expect(section(host)?.textContent).not.toContain("Showing");
  });

  it("counts the true total and says Showing 1,000 of <total> when the list is capped", async () => {
    const { host } = await mountWorkspace({ pulls: () => [pull(7), pull(8)], paging: { total: 1500, capped: true } });

    expect(section(host)?.querySelector(".count")?.textContent).toContain("1500");
    expect(section(host)?.textContent).toContain("Showing 1,000 of 1,500");
  });

  it("says Showing the first 1,000 when the list is capped and the service gave no total", async () => {
    const { host } = await mountWorkspace({ pulls: () => [pull(7), pull(8)], paging: { total: null, capped: true } });

    expect(section(host)?.textContent).toContain("Showing the first 1,000");
  });

  it("says there are no open pull requests, and lists merged ones after Show merged and closed", async () => {
    const { host, calls } = await mountWorkspace({ pulls: (state) => (state === "all" ? [pull(3, { state: "merged" })] : []) });

    expect(section(host)?.textContent).toContain("No open pull requests");
    buttonNamed(section(host) as HTMLElement, "Show merged and closed")?.click();
    await flush(60);

    expect(calls.filter((call) => call.cmd === "platform_prs_list").map((call) => call.args.state)).toEqual(["open", "all"]);
    expect(row(host, 3).querySelector(".pull-state")?.textContent).toBe("Merged");
    expect(row(host, 3).querySelector('[aria-label="Merge pull request #3"]')?.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows Authentication failed for the host with Edit connection, which opens Settings → Platforms", async () => {
    const { host, app } = await mountWorkspace({ pulls: () => new Error("Authentication failed for github.com") });

    const note = section(host)?.querySelector('[role="alert"]') as HTMLElement;
    expect(note.textContent).toContain("Authentication failed for github.com");
    buttonNamed(note, "Edit connection")?.click();
    await flush(40);

    expect(app.screen()).toEqual({ kind: "settings", section: "platforms" });
  });

  it("opens the pull request in the browser from the row action without selecting the row", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { host } = await mountWorkspace({ pulls: () => [pull(7)] });

    row(host, 7).querySelector<HTMLElement>('[aria-label="Open pull request #7 in browser"]')?.click();
    await flush();

    expect(open).toHaveBeenCalledWith("https://github.com/team/app/pull/7", "_blank", "noopener,noreferrer");
    expect(inspector(host)).toBeNull();
  });
});

describe("pull request detail", () => {
  it("shows state, author, dates, mergeability, and the changed files with +/- counts", async () => {
    const detail: PrDetail = {
      pull: pull(7, { title: "Add retry helper", body: "Retries the fetch.", mergeable: false }),
      files: [
        { filename: "src/retry.ts", status: "added", additions: 20, deletions: 0 },
        { filename: "src/app.ts", status: "modified", additions: 3, deletions: 4 },
        { filename: "old.ts", status: "removed", additions: 0, deletions: 9 },
      ],
      files_total: 3,
      files_capped: false,
    };
    const { host, calls } = await mountWorkspace({ pulls: () => [pull(7)], detail: () => detail });

    row(host, 7).click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "platform_pr_detail")?.args).toEqual({ path: "/r", number: 7 });
    const panel = inspector(host) as HTMLElement;
    expect(panel.querySelector("h2")?.textContent).toContain("#7 Add retry helper");
    expect(panel.querySelector(".ihead")?.textContent).toContain("Open");
    expect(panel.querySelector(".ihead")?.textContent).toContain("yui");
    expect(panel.textContent).toContain("Retries the fetch.");
    expect(panel.textContent).toContain("Cannot be merged yet");
    expect(panel.textContent).toContain("Created");
    expect(panel.textContent).toContain("Updated");
    const files = [...panel.querySelectorAll(".flist .frow")].map((item) => item.getAttribute("aria-label"));
    expect(files).toEqual(["Added src/retry.ts", "Modified src/app.ts", "Deleted old.ts"]);
    expect(panel.querySelector('.flist .frow[aria-label="Modified src/app.ts"] .delta')?.textContent).toBe("+3 −4");
    expect(panel.querySelector('section[aria-label="Files"] .lhead .delta')?.textContent).toBe("+23 −13");
    expect(row(host, 7).getAttribute("aria-current")).toBe("true");
    expect(panel.querySelector('section[aria-label="Files"] .lhead-title')?.textContent).toContain("Files · 3");
    expect(panel.querySelector('section[aria-label="Files"] .field-note')).toBeNull();
  });

  describe("files beyond the loaded page (S44)", () => {
    const files = (count: number) => Array.from({ length: count }, (_, index) => ({ filename: `src/f${index}.ts`, status: "modified", additions: 1, deletions: 2 }));
    const open = async (loaded: number, files_total: number | null, files_capped: boolean) => {
      const { host } = await mountWorkspace({ pulls: () => [pull(7)], detail: () => ({ pull: pull(7), files: files(loaded), files_total, files_capped }) });
      row(host, 7).click();
      await flush(60);
      return (inspector(host) as HTMLElement).querySelector('section[aria-label="Files"]') as HTMLElement;
    };

    it("counts the true total of files and says the sums cover only the loaded ones when capped with a total", async () => {
      const panel = await open(1000, 1500, true);

      expect(panel.querySelector(".lhead-title")?.textContent).toContain("Files · 1500");
      expect(panel.querySelector(".lhead .delta")?.textContent).toBe("+1000 −2000");
      expect(panel.querySelector(".field-note")?.textContent).toBe("Showing 1,000 of 1,500. Additions and deletions cover only the 1,000 loaded files");
    });

    it("says Showing the first 1,000 when capped and the service gave no total", async () => {
      const panel = await open(1000, null, true);

      expect(panel.querySelector(".lhead-title")?.textContent).toContain("Files · 1000");
      expect(panel.querySelector(".field-note")?.textContent).toBe("Showing the first 1,000. Additions and deletions cover only the 1,000 loaded files");
    });

    it("says the sums cover only the loaded files when the service reports more files than it listed, without claiming a cap", async () => {
      const panel = await open(8, 12, false);

      expect(panel.querySelector(".lhead-title")?.textContent).toContain("Files · 12");
      expect(panel.querySelector(".field-note")?.textContent).toBe("Additions and deletions cover only the 8 loaded files");
    });
  });

  it("ages the updated time as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date("2026-09-30T09:00:20Z"));
      const { host } = await mountWorkspace({ pulls: () => [pull(7)] });
      row(host, 7).click();
      await flush(60);
      const updated = () => [...(inspector(host) as HTMLElement).querySelectorAll(".ago")].map((entry) => entry.textContent);
      expect(updated()).toContain("· 20s ago");

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(updated()).toContain("· 2h ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders an unknown mergeability as a dash rather than a value", async () => {
    const { host } = await mountWorkspace({ pulls: () => [pull(7)], detail: () => ({ pull: pull(7, { mergeable: null }), files: [], files_total: 0, files_capped: false }) });

    row(host, 7).click();
    await flush(60);

    const mergeable = [...(inspector(host)?.querySelectorAll(".mrow") ?? [])].find((entry) => entry.querySelector(".k")?.textContent === "Mergeable");
    expect(mergeable?.querySelector(".v")?.textContent).toBe("—");
    expect(mergeable?.querySelector(".v")?.getAttribute("title")).toContain("has not reported");
  });

  it("offers Open in browser for the pull request", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { host } = await mountWorkspace({ pulls: () => [pull(7)] });
    row(host, 7).click();
    await flush(60);

    buttonNamed(inspector(host) as HTMLElement, "Open in browser")?.click();

    expect(open).toHaveBeenCalledWith("https://github.com/team/app/pull/7", "_blank", "noopener,noreferrer");
  });
});

describe("create pull request", () => {
  const openDialog = async (backend: Backend = {}) => {
    const mounted = await mountWorkspace({ pulls: () => [pull(7)], ...backend });
    section(mounted.host)?.querySelector<HTMLElement>('[aria-label="New pull request"]')?.click();
    await flush(60);
    return mounted;
  };
  const control = (label: string) => dialog()?.querySelector<HTMLInputElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`) as HTMLInputElement | null;
  const chosen = (label: string) => dialog()?.querySelector(`button[aria-label="${label}"] .select-value`)?.textContent;
  const optionsOf = async (label: string) => {
    dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent?.replace(/\s+/g, " ").trim());
    dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    return options;
  };

  it("defaults the source to the current branch, the target to the remote's main, and the title to the HEAD subject", async () => {
    await openDialog();

    expect(dialog()?.textContent).toContain("team/app");
    expect(chosen("Source branch")).toBe("feature/retry");
    expect(chosen("Target branch")).toBe("main");
    expect(control("Title")?.value).toBe("Add retry helper");
    expect(await optionsOf("Target branch")).toEqual(["develop", "feature/retry", "main"]);
  });

  it("requires a title and a different target before it calls the platform", async () => {
    const { calls } = await openDialog();
    type(control("Title"), " ");
    await choose(dialog() as HTMLElement, "Target branch", "feature/retry");
    buttonNamed(dialog() as HTMLElement, "Create pull request")?.click();
    await flush();

    expect(dialog()?.textContent).toContain("Enter a title");
    expect(dialog()?.textContent).toContain("Choose a different target branch");
    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(false);
  });

  it("creates the pull request, closes the dialog, refreshes the list, and shows a toast with the web URL", async () => {
    let created = false;
    const { host, calls } = await openDialog({
      pulls: () => (created ? [pull(7), pull(9, { title: "Add retry helper" })] : [pull(7)]),
      respond: (call) => {
        if (call.cmd !== "platform_pr_create") return undefined;
        created = true;
        return pull(9, { title: "Add retry helper" });
      },
    });
    type(control("Description"), "Retries with backoff.");
    buttonNamed(dialog() as HTMLElement, "Create pull request")?.click();
    await flush(80);

    expect(calls.find((call) => call.cmd === "platform_pr_create")?.args).toEqual({
      path: "/r",
      input: { source_ref: "feature/retry", target_ref: "main", title: "Add retry helper", body: "Retries with backoff." },
    });
    expect(dialog()).toBeNull();
    expect(host.querySelector(".toast")?.textContent).toContain("Created pull request #9: https://github.com/team/app/pull/9");
    expect(row(host, 9)).not.toBeNull();
  });

  it("keeps the dialog open and shows the platform's message when creation is refused", async () => {
    const { calls } = await openDialog({
      respond: (call) => {
        if (call.cmd === "platform_pr_create") throw { kind: "api_error", message: "github.com answered with HTTP 422: A pull request already exists", output: null };
        return undefined;
      },
    });
    buttonNamed(dialog() as HTMLElement, "Create pull request")?.click();
    await flush(60);

    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(true);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("HTTP 422: A pull request already exists");
  });
});

describe("merge pull request", () => {
  it("confirms the consequence, merges, then fetches, and reports it", async () => {
    let merged = false;
    const { host, calls } = await mountWorkspace({
      pulls: (state) => (merged ? (state === "all" ? [pull(7, { state: "merged" })] : []) : [pull(7, { title: "Add retry helper" })]),
      respond: (call) => {
        if (call.cmd === "platform_pr_merge") {
          merged = true;
          return pull(7, { state: "merged" });
        }
        return undefined;
      },
    });

    row(host, 7).querySelector<HTMLElement>('[aria-label="Merge pull request #7"]')?.click();
    await flush();
    expect(dialog()?.textContent).toContain("Merge pull request #7?");
    expect(dialog()?.textContent).toContain("Merges feature/p7 into main on GitHub");
    expect(dialog()?.textContent).toContain("cannot be undone from YForge");
    expect(calls.some((call) => call.cmd === "platform_pr_merge")).toBe(false);
    buttonNamed(dialog() as HTMLElement, "Merge pull request")?.click();
    await flush(120);

    const order = calls.map((call) => call.cmd).filter((cmd) => cmd === "platform_pr_merge" || cmd === "fetch");
    expect(order).toEqual(["platform_pr_merge", "fetch"]);
    expect(calls.find((call) => call.cmd === "platform_pr_merge")?.args).toEqual({ path: "/r", number: 7 });
    expect(host.querySelector(".toast")?.textContent).toContain("Merged pull request #7 into main on GitHub.");
    expect(calls.filter((call) => call.cmd === "platform_prs_list").length).toBeGreaterThan(1);
    expect(row(host, 7)).toBeNull();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    const { host, calls } = await mountWorkspace({ pulls: () => [pull(7)] });
    row(host, 7).querySelector<HTMLElement>('[aria-label="Merge pull request #7"]')?.click();
    await flush();

    buttonNamed(dialog() as HTMLElement, "Cancel")?.click();
    await flush();

    expect(dialog()).toBeNull();
    expect(calls.some((call) => call.cmd === "platform_pr_merge" || call.cmd === "fetch")).toBe(false);
  });

  it("reports a refused merge and does not fetch", async () => {
    const { host, calls } = await mountWorkspace({
      pulls: () => [pull(7)],
      respond: (call) => {
        if (call.cmd === "platform_pr_merge") throw { kind: "api_error", message: "github.com answered with HTTP 405: Pull Request is not mergeable", output: null };
        return undefined;
      },
    });
    row(host, 7).querySelector<HTMLElement>('[aria-label="Merge pull request #7"]')?.click();
    await flush();
    buttonNamed(dialog() as HTMLElement, "Merge pull request")?.click();
    await flush(80);

    expect(host.querySelector(".toast")?.textContent).toContain("HTTP 405: Pull Request is not mergeable");
    expect(calls.some((call) => call.cmd === "fetch")).toBe(false);
  });

  it("warns in the confirmation when the platform reports the pull request cannot be merged", async () => {
    const { host } = await mountWorkspace({ pulls: () => [pull(7, { mergeable: false })] });

    row(host, 7).querySelector<HTMLElement>('[aria-label="Merge pull request #7"]')?.click();
    await flush();

    expect(dialog()?.textContent).toContain("GitHub reports conflicts or a blocked merge");
  });
});
