import type { GraphRow } from "../ipc/bindings/GraphRow";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { requestFileHistory } from "../state/fileHistoryRequest";
import type { RepoActions } from "../state/repoActions";
import { defaultSettings } from "../state/settingsModel";
import { Toasts } from "./Toasts";
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
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => ({ length: 0, item: () => null }) });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
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
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects;
  delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
});

const geometry = { row: 28, pitch: 22, gutter: 4, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 56, messageColumnMin: 50, hitMin: 24, laneColors: 10 };
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
  const mounted = mountWithApp(() => (
    <>
      <Workspace view={{ status: "ready", path: "/r", snapshot: shape, info }} geometry={geometry} />
      <Toasts onUndo={() => undefined} />
    </>
  ));
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
  const held: RepoSnapshot = {
    ...snapshot,
    worktrees: [...snapshot.worktrees, { path: "/w/web-model-sort", head: null, branch: "web-model-sort", bare: false, locked: false, prunable: false, current: false }],
  };

  it("opens that worktree's tab on double-click without a checkout or a notice (S79)", async () => {
    const { host, calls } = await mountWorkspace(() => undefined, held);

    host.querySelector<HTMLElement>('[data-nav="branch:web-model-sort"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush(40);

    expect(calls.filter((call) => call.cmd === "repo_open").map((call) => call.args.path)).toContain("/w/web-model-sort");
    expect(calls.some((call) => call.cmd === "checkout")).toBe(false);
    expect(host.querySelector(".strip-notice")).toBeNull();
    expect(host.querySelector('.toast[role="alert"]')).toBeNull();
  });
});

describe("a failed operation", () => {
  it("is shown in the top-right toast stack, never inside the workspace grid (S48)", async () => {
    const { host } = await mountWorkspace((call) => {
      if (call.cmd === "checkout") throw { kind: "git_failed", message: "Checkout failed", output: "error: pathspec did not match" };
      return undefined;
    });

    host.querySelector<HTMLElement>('[data-nav="branch:web-model-sort"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush(40);

    expect(host.querySelector('.toasts .toast[role="alert"] .toast-title')?.textContent).toBe("Checkout failed: error: pathspec did not match");
    expect(host.querySelector('.app > .toast, .app .toast[role="alert"]')).toBeNull();
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

describe("file history", () => {
  const history = [{ sha: "c".repeat(40), short: "ccccccc", summary: "Tune retries", author: "Yui Lin", email: "yui@example.com", time: 1_700_000_000, path: "src/util.js", status: "modified" }];

  it("opens in the center from a request, covering the graph, and Escape closes it back to the graph", async () => {
    const { host, calls } = await mountWorkspace((call) => {
      if (call.cmd === "file_history") return history;
      if (call.cmd === "commit_file_diff") return { path: "src/util.js", original_path: null, binary: false, old_size: null, new_size: null, hunks: [] };
      if (call.cmd === "commit_details") return null;
      return undefined;
    });

    requestFileHistory({ file: "src/util.js", view: "diff" });
    await flush(80);

    const view = host.querySelector('.center section[aria-label="File history"]');
    expect(view).not.toBeNull();
    expect(calls.find((call) => call.cmd === "file_history")?.args).toEqual({ path: "/r", file: "src/util.js" });
    expect(host.querySelector(".center .graph")?.classList.contains("covered")).toBe(true);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush(40);

    expect(host.querySelector('section[aria-label="File history"]')).toBeNull();
    expect(host.querySelector(".center .graph")?.classList.contains("covered")).toBe(false);
  });
});

describe("AI sheet", () => {
  const changed: RepoSnapshot = {
    ...snapshot,
    counts: { ...counts, modified: 1 },
    files: [{ path: "src/app.ts", original_path: null, area: "unstaged", status: "modified" }],
  };
  const features = (["explain_changes"] as const).map((feature) => ({ feature, config: { feature, provider_id: "p1", model_id: "m", prompt_template: "{context}" }, enabled: true, available: true, default_prompt_template: "{context}" }));
  const respond = (call: Call) => {
    if (call.cmd === "ai_feature_config_list") return features;
    if (call.cmd === "ai_explain_changes") return { items: [{ path: "src/app.ts", text: "Wires the app." }], excluded: [], truncated: [] };
    return undefined;
  };

  it("opens over the graph in the center beside the inspector and Escape closes only the sheet", async () => {
    const { host, calls } = await mountWorkspace(respond, changed);

    host.querySelector<HTMLButtonElement>('.inspector button[aria-label="Explain the working-tree changes"]')?.click();
    await flush(60);

    const sheet = host.querySelector(".ai-sheet");
    expect(sheet?.closest(".center")).not.toBeNull();
    expect(sheet?.closest(".inspector")).toBeNull();
    expect(sheet?.querySelector(".ai-items .ref")?.textContent).toBe("src/app.ts");
    expect(host.querySelector(".graph.covered")).toBeNull();
    expect(calls.filter((call) => call.cmd === "ai_explain_changes")).toHaveLength(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();

    expect(host.querySelector(".ai-sheet")).toBeNull();
    expect(host.querySelector(".inspector")).not.toBeNull();
  });

  it("is cancelled and closed by Escape while the request is running", async () => {
    const { host, calls } = await mountWorkspace((call) => (call.cmd === "ai_explain_changes" ? new Promise(() => undefined) : respond(call)), changed);

    host.querySelector<HTMLButtonElement>('.inspector button[aria-label="Explain the working-tree changes"]')?.click();
    await flush(60);
    expect(host.querySelector(".ai-sheet")?.getAttribute("aria-busy")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();

    expect(host.querySelector(".ai-sheet")).toBeNull();
    expect(calls.find((call) => call.cmd === "operation_cancel")?.args.id).toBe(calls.find((call) => call.cmd === "ai_explain_changes")?.args.id);
  });
});

describe("file operations in the center", () => {
  type Bridge = { actions: RepoActions };

  async function mountCapturing(respond: (call: Call) => unknown) {
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
        if (cmd === "repo_open") return snapshot;
        if (cmd === "repo_graph") return { rows: [], carried: [], total: 0 };
        if (cmd === "recents_list" || cmd === "activity_list" || cmd === "remotes_list" || cmd === "switch_stashes") return [];
        return null;
      },
      { shouldMockEvents: true },
    );
    let bridge: Bridge | undefined;
    const mounted = mountWithApp((app) => {
      const set = app.setBridge;
      app.setBridge = ((next: Bridge | undefined) => {
        bridge = next;
        return set(next as never);
      }) as typeof app.setBridge;
      return (
        <>
          <Workspace view={{ status: "ready", path: "/r", snapshot, info }} geometry={geometry} />
          <Toasts onUndo={() => undefined} />
        </>
      );
    });
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush(60);
    const actions = () => {
      if (bridge === undefined) throw new Error("the workspace did not publish its actions");
      return bridge.actions;
    };
    return { ...mounted, calls, actions };
  }

  const editable = { text: "one\ntwo\n", eol: "\n", size: 8 };

  it("opens the editor over the graph, saves with the line ending, refreshes, and closes back to the graph", async () => {
    const { host, calls, actions } = await mountCapturing((call) => (call.cmd === "file_editable" ? editable : undefined));

    actions().editFile("a.txt");
    await flush(60);

    expect(host.querySelector('.center section[aria-label="Edit file"]')).not.toBeNull();
    expect(host.querySelector(".center .graph")?.classList.contains("covered")).toBe(true);
    const editor = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor") as HTMLElement) as EditorView;
    expect(editor.state.doc.toString()).toBe("one\ntwo\n");
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "one\nTWO\n" } });
    await flush();
    const before = calls.filter((call) => call.cmd === "repo_open").length;
    buttonNamed(host, "Save")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "file_save")?.args).toEqual({ path: "/r", file: "a.txt", text: "one\nTWO\n", eol: "\n" });
    expect(calls.filter((call) => call.cmd === "repo_open").length).toBeGreaterThan(before);
    buttonNamed(host, "Close")?.click();
    await flush(40);

    expect(host.querySelector('section[aria-label="Edit file"]')).toBeNull();
    expect(host.querySelector(".center .graph")?.classList.contains("covered")).toBe(false);
  });

  it("shows a refused edit as a notice and opens no editor", async () => {
    const { host, actions } = await mountCapturing((call) => {
      if (call.cmd === "file_editable") throw { kind: "invalid_request", message: "Invalid request: big.txt is 2.0 MiB, over the 1 MiB limit of the editor", output: null };
      return undefined;
    });

    actions().editFile("big.txt");
    await flush(60);

    expect(host.querySelector('section[aria-label="Edit file"]')).toBeNull();
    expect(host.textContent).toContain("big.txt is 2.0 MiB, over the 1 MiB limit of the editor");
  });

  it("views a working-tree file in the existing file view", async () => {
    const { host, calls, actions } = await mountCapturing((call) => (call.cmd === "file_at_revision" ? { kind: "text", text: "one\n", eol: "\n", size: 4 } : undefined));

    actions().viewFile("a.txt");
    await flush(60);

    expect(host.querySelector('.center section[aria-label="File"]')).not.toBeNull();
    expect(calls.find((call) => call.cmd === "file_at_revision")?.args).toEqual({ path: "/r", file: "a.txt", rev: ":worktree" });
  });

  it("opens the create dialog, creates the path, and refuses an existing one with its reason", async () => {
    let exists = true;
    const { host, calls, actions } = await mountCapturing((call) => {
      if (call.cmd !== "file_create") return undefined;
      if (exists) throw { kind: "invalid_request", message: "Invalid request: a.txt already exists", output: null };
      return null;
    });

    actions().createFile();
    await flush();
    const path = host.querySelector<HTMLInputElement>('input[aria-label="Path"]');
    path!.value = "a.txt";
    path!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();
    buttonNamed(host, "Create")?.click();
    await flush(40);
    expect(host.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Invalid request: a.txt already exists");

    exists = false;
    path!.value = "new/b.txt";
    path!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush();
    buttonNamed(host, "Create")?.click();
    await flush(40);

    expect(calls.filter((call) => call.cmd === "file_create").map((call) => call.args.file)).toEqual(["a.txt", "new/b.txt"]);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("picks a file, confirms the deletion with a text-labelled danger button, and deletes it", async () => {
    const { host, calls, actions } = await mountCapturing((call) => (call.cmd === "worktree_files" ? ["a.txt", "b.txt"] : undefined));

    actions().deleteFile();
    await flush(40);
    expect(host.querySelector("h3")?.textContent).toBe("Delete file");
    const { choose } = await import("./testkit");
    await choose(host, "File", "b.txt");
    buttonNamed(host, "Continue")?.click();
    await flush(40);

    const confirm = host.querySelector('[role="alertdialog"]');
    expect(confirm?.querySelector("h3")?.textContent).toBe("Delete b.txt?");
    expect(calls.some((call) => call.cmd === "file_delete")).toBe(false);
    const danger = buttonNamed(confirm as HTMLElement, "Delete file");
    expect(danger?.classList.contains("danger")).toBe(true);
    danger?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "file_delete")?.args).toEqual({ path: "/r", file: "b.txt" });
  });
});

describe("incoming markers (S74)", () => {
  it("marks the commits a fetch brought in on their graph rows, and drops a marker once its row is selected", async () => {
    const one = "1".repeat(40);
    const two = "2".repeat(40);
    const head = "a".repeat(40);
    const row = (sha: string, summary: string, parent: string | undefined): GraphRow => ({ sha, parents: parent === undefined ? [] : [parent], summary, body: "", author: null, time: 1_700_000_000, refs: [], kind: "commit", column: 0, edges: [] });
    const rows = [row(one, "Remote one", two), row(two, "Remote two", head), row(head, "Local", undefined)];
    const tracked = { ...snapshot, remotes: ["origin"], upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 2 } } };
    const { host } = await mountWorkspace((call) => {
      if (call.cmd === "repo_graph") return { rows, carried: [], total: rows.length };
      if (call.cmd === "incoming_commits") return [one, two];
      return undefined;
    }, tracked);
    const marker = (index: number) => host.querySelector(`#graph-row-${index} .incoming-marker`);
    expect(marker(0)).toBeNull();

    [...host.querySelectorAll<HTMLButtonElement>(".chips button")].find((entry) => /Fetch now/.test(entry.getAttribute("aria-label") ?? ""))?.click();
    await flush(80);
    expect(marker(0)?.textContent).toBe("incoming");
    expect(marker(1)?.textContent).toBe("incoming");
    expect(marker(2)).toBeNull();

    host.querySelector<HTMLElement>("#graph-row-0 .msg")?.click();
    await flush(40);
    expect(marker(0)).toBeNull();
    expect(marker(1)?.textContent).toBe("incoming");
  });
});

describe("conflict prediction (S76)", () => {
  const base = "4d9e2f7".padEnd(40, "0");
  const diverged: RepoSnapshot = { ...snapshot, head: { kind: "branch", name: "feature", sha: "a".repeat(40) }, upstream: { name: "origin/feature", ahead_behind: { ahead: 1, behind: 1 } }, branches: ["feature", "main"], remote_branches: ["origin/feature"], remotes: ["origin"] };
  const graphRow: GraphRow = { sha: "a".repeat(40), parents: [], summary: "Local work", body: "", author: null, time: 1_700_000_000, refs: [{ kind: "local_branch", name: "feature", is_head: true }], kind: "commit", column: 0, edges: [] };
  const respond = (call: Call) => {
    if (call.cmd === "repo_graph") return { rows: [graphRow], carried: [], total: 1 };
    if (call.cmd === "merge_prediction") return { merge_base: base, conflicted_files: ["app/src/styles/app.css"] };
    if (call.cmd === "revision_file_diff") return { path: "app/src/styles/app.css", original_path: null, binary: false, old_size: null, new_size: null, hunks: [] };
    if (call.cmd === "integration_preview") return { incoming: { count: 1, commits: [] }, outgoing: { count: 1, commits: [] }, fast_forward: false };
    return undefined;
  };
  const popover = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Predicted conflict"]') as HTMLElement;

  it("marks the checked-out branch's label and row, and its strip chip offers each file's diff and a confirmed rebase", async () => {
    const { host, calls } = await mountWorkspace(respond, diverged);

    await vi.waitFor(() => expect(host.querySelector("#graph-row-0 .label .conflict-mark")?.textContent).toBe("!"));
    expect(calls.find((call) => call.cmd === "merge_prediction")?.args).toMatchObject({ path: "/r", ours: "feature", theirs: "origin/feature" });
    expect(host.querySelector("#graph-row-0 .label")?.getAttribute("title")).toContain("conflict with origin/feature");
    expect(host.querySelector("#graph-row-0")?.getAttribute("aria-label")).toContain("conflict");
    const branch = host.querySelector('[data-nav="branch:feature"]');
    expect(branch?.querySelector(".conflict-mark")?.textContent).toBe("!");
    expect(branch?.getAttribute("aria-label")).toContain("conflict with origin/feature");

    const chip = host.querySelector<HTMLButtonElement>(".chips .conflict-chip");
    expect(chip?.querySelector(".st-conflicted")?.textContent?.trim()).toBe("!");
    expect(chip?.textContent).toContain("Conflicts with origin/feature · 1 file");
    chip?.click();
    await flush();
    expect(popover().textContent).toContain("4d9e2f7");
    expect(buttonNamed(popover(), "Compose pull request anyway")).toBeDefined();

    buttonNamed(popover(), "app/src/styles/app.css")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "revision_file_diff")?.args).toEqual({ path: "/r", base, head: "origin/feature", file: "app/src/styles/app.css" });

    chip?.click();
    await flush();
    buttonNamed(popover(), "Rebase feature onto origin/feature…")?.click();
    await flush(40);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(calls.some((call) => call.cmd === "rebase")).toBe(false);
  });

  it("predicts nothing and marks nothing while the branch and its upstream have not diverged", async () => {
    const { host, calls } = await mountWorkspace(respond, { ...diverged, upstream: { name: "origin/feature", ahead_behind: { ahead: 1, behind: 0 } } });

    expect(calls.some((call) => call.cmd === "merge_prediction")).toBe(false);
    expect(host.querySelector(".conflict-mark, .conflict-chip")).toBeNull();
  });
});
