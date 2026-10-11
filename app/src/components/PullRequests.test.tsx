import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AiFeature } from "../ipc/bindings/AiFeature";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { PrDetail } from "../ipc/bindings/PrDetail";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { defaultSettings } from "../state/settingsModel";
import { Toasts } from "./Toasts";
import { TooltipHost } from "./Tooltip";
import { Workspace } from "./Workspace";
import { aiFeatureList, buttonNamed, choose, flush, mountWithApp, stubLayout, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, "../styles", name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

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

const geometry = { row: 28, pitch: 22, gutter: 4, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 56, messageColumnMin: 50, hitMin: 24, laneColors: 10 };
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
  draft: false,
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
  shape?: RepoSnapshot;
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
      if (cmd === "repo_open") return backend.shape ?? snapshot;
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
      <Workspace view={{ status: "ready", path: "/r", snapshot: backend.shape ?? snapshot, info }} geometry={geometry} />
      <TooltipHost />
      <Toasts onUndo={() => undefined} />
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
    expect([...panel.querySelectorAll(".flist .badge")].map((badge) => [badge.getAttribute("aria-label"), badge.getAttribute("title"), badge.querySelector("svg")?.getAttribute("data-icon"), badge.textContent])).toEqual([["Added", "Added", "plus", ""], ["Modified", "Modified", "edit", ""], ["Deleted", "Deleted", "minus", ""]]);
    expect(panel.querySelector('.flist .frow[aria-label="Modified src/app.ts"] .delta')?.textContent).toBe("+3 −4");
    expect(panel.querySelector('section[aria-label="Files"] .lhead .delta')?.textContent).toBe("+23 −13");
    expect(row(host, 7).getAttribute("aria-current")).toBe("true");
    expect(panel.querySelector('section[aria-label="Files"] .lhead-title')?.textContent).toContain("Files · 3");
    expect(panel.querySelector('section[aria-label="Files"] .field-note')).toBeNull();
    const body = panel.querySelector(".cbody")!;
    const style = getComputedStyle(body);
    expect(style.whiteSpace).toBe("pre-wrap");
    expect(style.overflowWrap).toBe("anywhere");
    expect(style.color).toBe("var(--colors-text-muted)");
    expect(style.font).toBe("var(--font-ui-body)");
    expect(style.cursor).toBe("var(--cursors-text)");
    const rules = [...stylesheet.sheet!.cssRules];
    const bodyRule = rules.find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ".cbody");
    const rootRule = rules.find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === ":root");
    expect(bodyRule?.style.getPropertyValue("margin")).toBe("0 var(--spacing-2) var(--spacing-2)");
    expect(bodyRule?.style.getPropertyValue("padding")).toBe("0 var(--spacing-2)");
    expect(rootRule?.style.getPropertyValue("--spacing-2")).toBe("8px");
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

describe("compose pull request (S77)", () => {
  const comparison = { merge_base: "b".repeat(40), source: "feature/retry", target: "origin/main", commits: [{ sha: "c".repeat(40), summary: "Add retry helper", author: "yui", timestamp: 1_700_000_000 }], files: 3, additions: 58, deletions: 5 };
  const template = "## Summary\n\n## Testing\n";
  const composeBackend = (respond?: (call: Call) => unknown) => (call: Call) => {
    const custom = respond?.(call);
    if (custom !== undefined) return custom;
    if (call.cmd === "branch_comparison") return comparison;
    if (call.cmd === "merge_prediction") return { merge_base: comparison.merge_base, conflicted_files: [] };
    if (call.cmd === "pull_request_template") return template;
    return undefined;
  };
  const compose = () => document.querySelector<HTMLElement>('section[aria-label="Create pull request"]');
  const openCompose = async (backend: Backend = {}) => {
    const mounted = await mountWorkspace({ pulls: () => [pull(7)], ...backend, respond: composeBackend(backend.respond) });
    section(mounted.host)?.querySelector<HTMLElement>('[aria-label="New pull request"]')?.click();
    await flush(80);
    return mounted;
  };
  const control = (label: string) => compose()?.querySelector<HTMLInputElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`) as HTMLInputElement | null;
  const chosen = (label: string) => compose()?.querySelector(`button[aria-label="${label}"] .select-value`)?.textContent;
  const create = () => buttonNamed(compose() as HTMLElement, "Create pull request") as HTMLButtonElement;
  const reason = () => compose()?.querySelector(".compose-reason")?.textContent;
  const optionsOf = async (label: string) => {
    compose()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent?.replace(/\s+/g, " ").trim());
    compose()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    return options;
  };

  it("opens over the graph with the platform line, defaults, the comparison and its commits, the conflict line, the template, and Draft off", async () => {
    const { host, calls } = await openCompose();

    expect(compose()?.textContent).toContain("team/app");
    expect(chosen("Source branch")).toBe("feature/retry");
    expect(chosen("Target branch")).toBe("main");
    expect(await optionsOf("Target branch")).toEqual(["develop", "feature/retry", "main"]);
    expect(control("Title")?.value).toBe("Add retry helper");
    expect(compose()?.querySelector(".compare-summary")?.textContent).toBe("1 commit · 3 files · +58 −5");
    expect(compose()?.querySelector(".compare-commits")?.textContent).toContain("Add retry helper");
    expect(compose()?.querySelector(".compose-conflict")?.textContent).toBe("No conflicts with origin/main");
    expect(control("Description")?.value).toBe(template);
    expect(compose()?.querySelector('button[role="switch"][aria-label="Draft"]')?.getAttribute("aria-checked")).toBe("false");
    expect(calls.find((call) => call.cmd === "branch_comparison")?.args).toEqual({ path: "/r", source: "feature/retry", target: "origin/main" });
    expect(calls.find((call) => call.cmd === "merge_prediction")?.args).toMatchObject({ path: "/r", ours: "origin/main", theirs: "feature/retry" });
    expect(host.querySelector(".graph")?.classList.contains("covered")).toBe(true);
    expect(create().getAttribute("aria-disabled")).toBeNull();
  });

  it("states a predicted conflict between the source and the target", async () => {
    await openCompose({ respond: (call) => (call.cmd === "merge_prediction" ? { merge_base: comparison.merge_base, conflicted_files: ["a.txt"] } : undefined) });

    expect(compose()?.querySelector(".compose-conflict")?.textContent).toContain("Conflicts with origin/main · 1 file");
    expect(compose()?.querySelector('.compose-conflict [aria-label="Conflicted"] svg')?.getAttribute("data-icon")).toBe("warning");
  });

  it("disables Create with a visible reason while the comparison is read or the title is empty, and requires a different target", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { calls } = await openCompose({ respond: (call) => (call.cmd === "branch_comparison" ? new Promise((resolve) => (release = resolve)) : undefined) });

    expect(create().getAttribute("aria-disabled")).toBe("true");
    expect(reason()).toBe("Reading the comparison…");
    create().click();
    await flush();
    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(false);

    release(comparison);
    await flush(40);
    expect(create().getAttribute("aria-disabled")).toBeNull();
    type(control("Title"), " ");
    await flush();
    expect(reason()).toBe("Enter a title");
    type(control("Title"), "Add retry helper");
    await choose(compose() as HTMLElement, "Target branch", "feature/retry");
    await flush(40);
    expect(reason()).toBe("Choose a different target branch");
    create().click();
    await flush();
    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(false);
  });

  it("pushes an unpushed source first, showing both steps, creates a draft, returns to the graph with its badge, and toasts with Show", async () => {
    const shape: RepoSnapshot = { ...snapshot, head: { kind: "branch", name: "feature/new", sha: "a".repeat(40) }, upstream: null, branches: ["feature/new", "feature/retry", "main"] };
    let releasePush: (value: unknown) => void = () => undefined;
    let releaseCreate: (value: unknown) => void = () => undefined;
    let created = false;
    const { host, calls } = await openCompose({
      shape,
      pulls: () => (created ? [pull(7), pull(12, { source_ref: "feature/new", draft: true })] : [pull(7)]),
      respond: (call) => {
        if (call.cmd === "publish") return new Promise((resolve) => (releasePush = resolve));
        if (call.cmd === "platform_pr_create") return new Promise((resolve) => (releaseCreate = resolve));
        if (call.cmd === "branch_comparison") return { ...comparison, source: "feature/new" };
        return undefined;
      },
    });

    expect(compose()?.textContent).toContain("feature/new is not on origin yet");
    compose()?.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Draft"]')?.click();
    create().click();
    await flush();
    expect(compose()?.querySelector(".compose-step")?.textContent).toBe("Pushing feature/new to origin…");
    expect(calls.find((call) => call.cmd === "publish")?.args).toMatchObject({ path: "/r", remote: "origin", branch: "feature/new" });
    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(false);

    releasePush(null);
    await flush(40);
    expect(compose()?.querySelector(".compose-step")?.textContent).toBe("Creating pull request…");
    expect(calls.find((call) => call.cmd === "platform_pr_create")?.args).toEqual({ path: "/r", input: { source_ref: "feature/new", target_ref: "main", title: "Add retry helper", body: template, draft: true } });

    created = true;
    releaseCreate(pull(12, { source_ref: "feature/new", draft: true }));
    await flush(80);
    expect(compose()).toBeNull();
    expect(host.querySelector('[data-nav="branch:feature/new"] .pr-badge')?.textContent).toBe("#12Draft");
    const toast = host.querySelector<HTMLElement>(".toast");
    expect(toast?.querySelector(".toast-title")?.textContent).toBe("Created pull request #12");
    buttonNamed(toast as HTMLElement, "Show")?.click();
    await flush(60);
    expect(inspector(host)?.textContent).toContain("https://github.com/team/app/pull/12");
  });

  it("keeps the view open and shows the platform's message when creation is refused", async () => {
    const { calls } = await openCompose({
      respond: (call) => {
        if (call.cmd === "platform_pr_create") throw { kind: "api_error", message: "github.com answered with HTTP 422: A pull request already exists", output: null };
        return undefined;
      },
    });
    create().click();
    await flush(60);

    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(true);
    expect(compose()?.querySelector('[role="alert"]')?.textContent).toContain("HTTP 422: A pull request already exists");
  });

  it("closes on Cancel and returns to the graph without calling the platform", async () => {
    const { host, calls } = await openCompose();
    buttonNamed(compose() as HTMLElement, "Cancel")?.click();
    await flush();

    expect(compose()).toBeNull();
    expect(host.querySelector(".graph")?.classList.contains("covered")).toBe(false);
    expect(calls.some((call) => call.cmd === "platform_pr_create")).toBe(false);
  });

  it("opens from the conflict popover with the branch and the conflicting target", async () => {
    const { host } = await mountWorkspace({
      pulls: () => [pull(7, { source_ref: "feature/retry", target_ref: "develop" })],
      respond: composeBackend((call) => (call.cmd === "merge_prediction" ? { merge_base: comparison.merge_base, conflicted_files: ["a.txt"] } : undefined)),
    });
    await vi.waitFor(() => expect(host.querySelector(".chips .conflict-chip")).not.toBeNull());
    host.querySelector<HTMLButtonElement>(".chips .conflict-chip")?.click();
    await flush();
    buttonNamed(document.querySelector('[aria-label="Predicted conflict"]') as HTMLElement, "Compose pull request anyway")?.click();
    await flush(80);

    expect(chosen("Source branch")).toBe("feature/retry");
    expect(chosen("Target branch")).toBe("develop");
  });
});

describe("AI pull request drafts (S78)", () => {
  const comparison = { merge_base: "b".repeat(40), source: "feature/retry", target: "origin/main", commits: [{ sha: "c".repeat(40), summary: "Add retry helper", author: "yui", timestamp: 1_700_000_000 }], files: 3, additions: 58, deletions: 5 };
  const template = "## Summary\n\n## Testing\n";
  const sent = { commit_messages: 2, files: 3, additions: 58, deletions: 5, provider_name: "Work account", excluded: [], truncated: ["Cargo.lock"] };
  const aiBackend = (respond?: (call: Call) => unknown, features: AiFeature[] = ["compose_pull_request"]) => (call: Call) => {
    const custom = respond?.(call);
    if (custom !== undefined) return custom;
    if (call.cmd === "branch_comparison") return comparison;
    if (call.cmd === "merge_prediction") return { merge_base: comparison.merge_base, conflicted_files: [] };
    if (call.cmd === "pull_request_template") return template;
    if (call.cmd === "ai_feature_config_list") return aiFeatureList(features);
    if (call.cmd === "ai_pull_request_context") return sent;
    return undefined;
  };
  const compose = () => document.querySelector<HTMLElement>('section[aria-label="Create pull request"]') as HTMLElement;
  const openCompose = async (respond?: (call: Call) => unknown, features?: AiFeature[]) => {
    const mounted = await mountWorkspace({ pulls: () => [pull(7)], respond: aiBackend(respond, features) });
    section(mounted.host)?.querySelector<HTMLElement>('[aria-label="New pull request"]')?.click();
    await flush(80);
    return mounted;
  };
  const generate = () => compose().querySelector<HTMLButtonElement>(".compose-ai .ai-btn");
  const ai = () => compose().querySelector<HTMLElement>(".compose-ai") as HTMLElement;
  const field = (label: string) => compose().querySelector<HTMLInputElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`) as HTMLInputElement;
  const create = () => buttonNamed(compose(), "Create pull request") as HTMLButtonElement;

  it("states what Generate sends and to whom, never runs on its own, and fills an editable draft with Restore my text", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { calls } = await openCompose((call) => (call.cmd === "ai_compose_pull_request" ? new Promise((resolve) => (release = resolve)) : undefined));

    await vi.waitFor(() => expect(ai().textContent).toContain("Generate sends 2 commit messages and the diff of 3 files (+58 −5) to Work account"));
    expect(ai().textContent).toContain("Cut to fit the size limit: Cargo.lock");
    expect(calls.find((call) => call.cmd === "ai_pull_request_context")?.args).toEqual({ path: "/r", source: "feature/retry", target: "origin/main" });
    expect(calls.some((call) => call.cmd === "ai_compose_pull_request")).toBe(false);
    expect(generate()?.getAttribute("aria-label")).toBe("Generate a title and description from 1 commit and the diff of feature/retry");
    expect(generate()?.getAttribute("aria-disabled")).toBeNull();

    generate()?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "ai_compose_pull_request")?.args).toMatchObject({ path: "/r", source: "feature/retry", target: "origin/main", template });
    expect(field("Title").disabled).toBe(true);
    expect(field("Description").disabled).toBe(true);
    expect(compose().querySelector(".compose-fields")?.getAttribute("aria-busy")).toBe("true");
    expect(compose().querySelector(".compose-fields")?.textContent).toContain("Generation in progress; fields unlock when it completes.");
    expect(buttonNamed(ai(), "Cancel generation")).toBeDefined();
    expect(create().getAttribute("aria-disabled")).toBe("true");

    release({ title: "Retry login with backoff", description: "## Summary\nRetries with backoff.\n\n## Testing\nUnit tests.\n", title_trimmed: false, sent });
    await flush(40);
    expect(field("Title").value).toBe("Retry login with backoff");
    expect(field("Description").value).toBe("## Summary\nRetries with backoff.\n\n## Testing\nUnit tests.\n");
    expect(field("Title").disabled).toBe(false);
    type(field("Title"), "Retry login with backoff, edited");
    expect(field("Title").value).toBe("Retry login with backoff, edited");

    buttonNamed(compose(), "Restore my text")?.click();
    await flush();
    expect(field("Title").value).toBe("Add retry helper");
    expect(field("Description").value).toBe(template);
    expect(calls.some((call) => call.cmd === "publish" || call.cmd === "platform_pr_create")).toBe(false);
  });

  it("cancels a running draft and keeps the text", async () => {
    const { calls } = await openCompose((call) => {
      if (call.cmd === "ai_compose_pull_request") return new Promise((_resolve, reject) => setTimeout(() => reject({ kind: "cancelled", message: "Cancelled", output: null }), 30));
      return undefined;
    });
    await vi.waitFor(() => expect(generate()?.getAttribute("aria-disabled")).toBeNull());
    generate()?.click();
    await flush();
    buttonNamed(ai(), "Cancel generation")?.click();
    await flush(60);

    expect(calls.some((call) => call.cmd === "operation_cancel")).toBe(true);
    expect(field("Title").value).toBe("Add retry helper");
    expect(field("Title").disabled).toBe(false);
    expect(compose().querySelector('[role="alert"]')).toBeNull();
  });

  it("states a failure and that nothing changed, and offers Generate again and Open AI settings", async () => {
    let failing = true;
    const { app } = await openCompose((call) => {
      if (call.cmd !== "ai_compose_pull_request") return undefined;
      if (failing) throw { kind: "ai_provider_unavailable", message: "connection refused", output: null };
      return { title: "Retry login", description: "## Summary\n", title_trimmed: false, sent };
    });
    const opened = vi.spyOn(app, "openSettings");
    await vi.waitFor(() => expect(generate()?.getAttribute("aria-disabled")).toBeNull());
    generate()?.click();
    await flush(40);

    const alert = compose().querySelector<HTMLElement>('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("The provider could not be reached. Nothing was changed.");
    expect(field("Title").value).toBe("Add retry helper");
    buttonNamed(alert, "Open AI settings")?.click();
    expect(opened).toHaveBeenCalledWith("ai");

    failing = false;
    expect(generate()?.getAttribute("aria-disabled")).toBeNull();
    generate()?.click();
    await flush(40);
    expect(field("Title").value).toBe("Retry login");
    expect(compose().querySelector('[role="alert"]')).toBeNull();
  });

  it("offers no Generate while the feature is not set up in Settings → AI", async () => {
    const { calls } = await openCompose(undefined, []);

    expect(generate()).toBeNull();
    expect(calls.some((call) => call.cmd === "ai_pull_request_context")).toBe(false);
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

describe("pull request badges (S75)", () => {
  const refsRow = { sha: "a".repeat(40), parents: [], summary: "Add retry helper", body: "", author: null, time: 1_700_000_000, refs: [{ kind: "local_branch", name: "feature/retry", is_head: true }, { kind: "remote_branch", name: "origin/feature/retry", is_head: false }, { kind: "local_branch", name: "main", is_head: false }], kind: "commit", column: 0, edges: [] };
  const withRows = (respond?: (call: Call) => unknown) => (call: Call) => (call.cmd === "repo_graph" ? { rows: [refsRow], carried: [], total: 1 } : respond?.(call));
  const badge = (host: ParentNode, selector: string) => host.querySelector<HTMLButtonElement>(`${selector} .pr-badge`);

  it("badges a branch that heads an open pull request in the sidebar and on its graph label, naming it with its checks, and opens the inspector", async () => {
    const { host, calls } = await mountWorkspace({
      pulls: () => [pull(7, { title: "Add retry helper", source_ref: "feature/retry" })],
      respond: withRows((call) => (call.cmd === "platform_pr_checks" ? { passing: 2, failing: 0, pending: 1, capped: false } : undefined)),
    });
    const name = "Pull request #7: Add retry helper · Open · feature/retry → main · checks: 2 passing, 1 pending";

    const local = badge(host, '[data-nav="branch:feature/retry"]');
    expect(local?.tagName).toBe("BUTTON");
    expect(local?.textContent).toBe("#7");
    expect(local?.querySelector("svg")).not.toBeNull();
    await vi.waitFor(() => expect(local?.getAttribute("aria-label")).toBe(name));
    expect(local?.getAttribute("data-tip")).toBe(name);
    expect(badge(host, '[data-nav="remote:origin/feature/retry"]')?.textContent).toBe("#7");
    expect(badge(host, "#graph-row-0 .refcell")?.textContent).toBe("#7");
    expect(calls.filter((call) => call.cmd === "platform_pr_checks").every((call) => call.args.number === 7)).toBe(true);

    local?.click();
    await flush(40);
    expect(inspector(host)?.textContent).toContain("#7");
  });

  it("adds the word Draft for a draft, and shows no badge for a merged or closed pull request", async () => {
    const { host } = await mountWorkspace({
      pulls: () => [pull(7, { source_ref: "feature/retry", state: "merged" }), pull(8, { source_ref: "main", draft: true }), pull(9, { source_ref: "develop", state: "closed" })],
      respond: withRows(),
    });

    expect(badge(host, '[data-nav="branch:main"]')?.textContent).toBe("#8Draft");
    expect(badge(host, '[data-nav="branch:feature/retry"]')).toBeNull();
    expect(badge(host, '[data-nav="remote:origin/develop"]')).toBeNull();
  });

  it("shows no badge and calls nothing on the network without a platform connection", async () => {
    const { host, calls } = await mountWorkspace({ match: null, respond: withRows() });

    expect(host.querySelector(".pr-badge")).toBeNull();
    expect(calls.some((call) => call.cmd.startsWith("platform_pr"))).toBe(false);
  });
});

describe("conflict prediction for pull requests (S76)", () => {
  it("checks an open pull request's head against its target, marks both branches, and runs again after a fetch", async () => {
    const { host, calls } = await mountWorkspace({
      pulls: () => [pull(7, { source_ref: "feature/retry", target_ref: "main" })],
      respond: (call) => (call.cmd === "merge_prediction" ? { merge_base: "b".repeat(40), conflicted_files: ["a.txt", "b.txt"] } : undefined),
    });
    const predictions = () => calls.filter((call) => call.cmd === "merge_prediction");

    await vi.waitFor(() => expect(host.querySelector('[data-nav="remote:origin/feature/retry"] .conflict-mark')).not.toBeNull());
    expect(predictions()[0]?.args).toMatchObject({ path: "/r", ours: "origin/main", theirs: "origin/feature/retry" });
    expect(host.querySelector('[data-nav="branch:feature/retry"]')?.getAttribute("aria-label")).toContain("conflict with origin/main");
    expect(host.querySelector(".chips .conflict-chip")?.textContent).toContain("Conflicts with origin/main · 2 files");

    const before = predictions().length;
    [...host.querySelectorAll<HTMLButtonElement>(".chips button")].find((entry) => /Fetch now/.test(entry.getAttribute("aria-label") ?? ""))?.click();
    await vi.waitFor(() => expect(predictions().length).toBeGreaterThan(before));
  });
});
