import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot, createSignal, type ComponentProps } from "solid-js";
import { render } from "solid-js/web";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { ActivityEntryView } from "../components/ActivityEntryView";
import { Composer } from "../components/Composer";
import { RebaseEditor } from "../components/RebaseEditor";
import { ContextMenu } from "../components/ContextMenu";
import { DiffView } from "../components/DiffView";
import { FileRow } from "../components/FileRow";
import { FileView } from "../components/FileView";
import { RecoveryView } from "../components/RecoveryView";
import { WorktreePanel } from "../components/WorktreePanel";
import { GraphPanel } from "../components/GraphPanel";
import { Switch } from "../components/Switch";
import { TabBar } from "../components/TabBar";
import { choose, flush, mountWithApp, stubLayout, testSession, testUiPrefs } from "../components/testkit";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createComposer } from "../state/composer";
import { createDiffPrefs } from "../state/diffPrefs";
import { defaultSettings } from "../state/settingsModel";
import type { RepoActions } from "../state/repoActions";

const root = resolve(import.meta.dirname, "../../..");
const front = parse(readFileSync(resolve(root, "app/DESIGN.md"), "utf8").split(/^---$/m)[1] ?? "") as { cursors: Record<string, string> };

type Token = keyof typeof front.cursors;

function expectCursor(element: Element | null | undefined, token: Token): void {
  if (element === null || element === undefined) throw new Error(`no element for the ${token} cursor`);
  const computed = getComputedStyle(element).cursor;
  expect(computed, `${element.tagName.toLowerCase()}.${element.className} cursor`).toBe(`var(--cursors-${token})`);
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(`--cursors-${token}`).trim();
  expect(resolved).toBe(front.cursors[token]);
}

const idleGenerate = { run: async () => undefined, cancel: () => undefined, running: () => false, failure: () => undefined, dismissFailure: () => undefined, drafted: () => false, notes: () => [], replaced: () => undefined, restore: () => undefined } as unknown as ComponentProps<typeof Composer>["generate"];

let stylesheet: HTMLStyleElement;
let dispose: (() => void) | undefined;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  document.body.className = "";
  clearMocks();
});

function mount(view: () => import("solid-js").JSX.Element): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(view, host);
  return host;
}

describe("cursors resolve to their tokens on real components (jsdom cascades var() but does not substitute it, so the declared token is asserted and resolved through the injected tokens.css)", () => {
  it("shows the action cursor on enabled buttons, switches, and checkbox labels, and the disabled cursor on disabled ones", () => {
    const [reason, setReason] = createSignal<string | undefined>("Stage changes to commit");
    const state = createRoot(() => createComposer());
    const generate = idleGenerate;
    const action = { button: () => ({ label: "Commit", disabledReason: reason() }), submit: async () => undefined, toggleAmend: async () => undefined } as unknown as ComponentProps<typeof Composer>["action"];
    const snapshot = { head: { kind: "branch" }, upstream: undefined } as unknown as RepoSnapshot;
    const host = mount(() => (
      <>
        <Composer snapshot={snapshot} state={state} action={action} generate={generate} generateAvailable={true} clean={false} staged={0} onOpenAiSettings={() => undefined} pushReason={undefined} summaryRef={() => undefined} />
        <Switch label="Usage" checked={false} onChange={() => undefined} />
        <Switch label="Locked" checked disabled onChange={() => undefined} />
      </>
    ));

    const commit = host.querySelector(".btn.primary");
    expectCursor(commit, "disabled");
    expectCursor(commit?.querySelector(".hint"), "disabled");
    setReason(undefined);
    expectCursor(commit, "action");
    expectCursor(host.querySelector("label.check"), "action");
    expectCursor(host.querySelector('input[type="checkbox"]'), "action");
    expectCursor(host.querySelector('[role="switch"]:not(:disabled)'), "action");
    expectCursor(host.querySelector('[role="switch"]:disabled'), "disabled");
  });

  it("shows the text cursor on inputs, textareas, and the labels that wrap them", () => {
    const state = createRoot(() => createComposer());
    const generate = idleGenerate;
    const action = { button: () => ({ label: "Commit", disabledReason: undefined }), submit: async () => undefined, toggleAmend: async () => undefined } as unknown as ComponentProps<typeof Composer>["action"];
    const host = mount(() => <Composer snapshot={{ head: { kind: "branch" }, upstream: undefined } as unknown as RepoSnapshot} state={state} action={action} generate={generate} generateAvailable={true} clean={false} staged={0} onOpenAiSettings={() => undefined} pushReason={undefined} summaryRef={() => undefined} />);

    expectCursor(host.querySelector('input[type="text"]'), "text");
    expectCursor(host.querySelector("textarea"), "text");
    expectCursor(host.querySelector("label.input"), "text");
    expectCursor(host.querySelector("label.input.area"), "text");
  });

  it("shows the action cursor on menu items, the disabled cursor on a disabled item, and the static cursor on the separator", () => {
    const host = mount(() => (
      <ContextMenu
        menu={{
          anchor: { left: 10, top: 20 },
          entries: [
            { kind: "item", id: "checkout", label: ["Checkout"] },
            { kind: "item", id: "merge", label: ["Merge"], disabledReason: "Not available yet" },
            { kind: "separator" },
          ],
          run: () => undefined,
        }}
        onClose={() => undefined}
      />
    ));

    const items = host.querySelectorAll('[role="menuitem"]');
    expectCursor(items[0], "action");
    expectCursor(items[1], "disabled");
    expect(items[1]?.getAttribute("title")).toBe("Not available yet");
    expectCursor(host.querySelector('[role="separator"]'), "static");
  });

  it("shows the action cursor on file rows that open and the static cursor on rows that do not", () => {
    const virtual = { index: 0, style: {}, measure: () => undefined };
    const row = { originalPath: null, status: "modified", selected: false, tabStop: true, onFocusRow: () => undefined, virtual } as const;
    const host = mount(() => (
      <ul>
        <FileRow {...row} rowId="open" path="src/open.ts" onOpen={() => undefined} />
        <FileRow {...row} rowId="static" path="src/static.ts" />
      </ul>
    ));

    const rows = host.querySelectorAll("li.frow");
    expectCursor(rows[0], "action");
    expectCursor(rows[1], "static");
  });

  it("shows the action cursor on tabs and the static cursor on the tab strip", async () => {
    mockIPC(
      (cmd) => {
        if (cmd === "settings_load") return defaultSettings;
        if (cmd === "repo_aliases_list") return [];
        if (cmd === "session_load") return { tabs: ["/work/sample"], active: 0, groups: [] };
        if (cmd === "activity_list" || cmd === "recents_list") return [];
        if (cmd === "launch_path") return "/nowhere";
        if (cmd === "repo_open") throw { kind: "not_a_repository", message: "no", output: null };
        return null;
      },
      { shouldMockEvents: true },
    );
    const mounted = mountWithApp(() => <TabBar count={1} />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    expectCursor(mounted.host.querySelector('[role="tab"]'), "action");
    expectCursor(mounted.host.querySelector('[role="tablist"]'), "static");
  });

  it("shows the text cursor on command output and the action cursor on the expandable head", () => {
    const entry: ActivityEntry = {
      id: 1,
      repo: "/r",
      operation: "commit",
      summary: "Commit failed",
      started_at: 1_700_000_000,
      duration_ms: 12,
      ok: false,
      local: true,
      toast: false,
      error: "hook rejected",
      commands: [{ command: "git commit -m x", status: 1, duration_ms: 12, output: "error: hook rejected" }],
      undo: { kind: "undone" },
    };
    const host = mount(() => <ActivityEntryView entry={entry} earlier={false} onUndo={() => undefined} undoId={undefined} />);

    expectCursor(host.querySelector("pre.act-output"), "text");
    expectCursor(host.querySelector("code.act-line"), "text");
    expectCursor(host.querySelector("button.act-head"), "action");
  });

  it("shows the busy cursor on a busy control (not on a busy region) and the dragging cursor everywhere while a ref label is dragged", () => {
    const host = mount(() => (
      <>
        <Switch label="Usage" checked={false} onChange={() => undefined} />
        <button type="button" id="running" aria-busy="true">
          <span id="running-icon" />
        </button>
        <section id="panel" aria-busy="true" />
      </>
    ));

    expectCursor(host.querySelector("#running"), "busy");
    expectCursor(host.querySelector("#running-icon"), "busy");
    expectCursor(host.querySelector("#panel"), "static");

    document.body.classList.add("dragging");
    expectCursor(host.querySelector('[role="switch"]'), "dragging");
    expectCursor(host.querySelector("#running"), "dragging");
    expectCursor(host.querySelector("#panel"), "dragging");
  });

  it("shows the column and row resize cursors on focusable separators, and leaves the plain menu separator static", () => {
    const host = mount(() => (
      <>
        <div id="column" role="separator" aria-orientation="vertical" aria-valuenow="248" tabindex="0" />
        <div id="row" role="separator" aria-orientation="horizontal" aria-valuenow="60" tabindex="0" />
        <div id="plain" role="separator" />
      </>
    ));

    expectCursor(host.querySelector("#column"), "resize-column");
    expectCursor(host.querySelector("#row"), "resize-row");
    expectCursor(host.querySelector("#plain"), "static");
  });
});

describe("cursors on the graph", () => {
  const VIEWPORT = 280;
  const geometry = { row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 160, laneColors: 10 };

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = () => undefined;
        unobserve = () => undefined;
        disconnect = () => undefined;
      },
    );
    for (const name of ["clientHeight", "offsetHeight"]) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => VIEWPORT });
    for (const name of ["clientWidth", "offsetWidth"]) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => 800 });
    Element.prototype.scrollIntoView = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const name of ["clientHeight", "offsetHeight", "clientWidth", "offsetWidth"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });

  it("shows the action cursor on graph rows, the drag cursor on branch labels, and the row's action cursor on tag labels", async () => {
    const row: GraphRow = {
      sha: "sha0",
      parents: [],
      summary: "first",
      author: { name: "Yui", email: "a@example.test", initials: "Y" },
      time: 1_700_000_000,
      refs: [
        { name: "main", kind: "local_branch", is_head: false },
        { name: "v1", kind: "tag", is_head: false },
      ],
      kind: "commit",
      column: 0,
      edges: [{ lane: 0, parent_row: null, parent_column: null }],
    };
    mockIPC((cmd) => (cmd === "repo_graph" ? { rows: [row], carried: [], total: 1 } : null));
    const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "sha0" }, upstream: null, remotes: [], counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } } as unknown as RepoSnapshot;
    const uiPrefs = testUiPrefs();
    const mounted = mountWithApp(() => (
      <GraphPanel
        path="/r"
        snapshot={snapshot}
        geometry={geometry}
        selection={undefined}
        revision={0}
        covered={false}
        actions={{} as RepoActions}
        dimmed={() => false}
        searching={false}
        focus={undefined}
        onSelect={() => undefined}
        uiPrefs={uiPrefs}
        onRevealHead={() => undefined}
      />
    ));
    dispose = mounted.dispose;
    await flush(60);

    expectCursor(mounted.host.querySelector('.grow[role="option"]'), "action");
    expectCursor(mounted.host.querySelector(".label[data-ref-label]:not(.tag)"), "drag");
    expectCursor(mounted.host.querySelector(".label.tag[data-ref-label]"), "action");
    expectCursor(mounted.host.querySelector('[role="listbox"]'), "static");
  });

  it("shows the text cursor on diff code in every mode, the action cursor on the line pick button, and the disabled cursor once whitespace is ignored", async () => {
    vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
    const restoreLayout = stubLayout();
    const lines = [
      { kind: "removed", old_number: 1, new_number: null, text: "a", no_newline: false },
      { kind: "added", old_number: null, new_number: 1, text: "b", no_newline: false },
    ];
    const diff = { path: "a.txt", original_path: null, binary: false, hunks: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, heading: "", lines }] };
    mockIPC((cmd) => (cmd === "diff_file" ? diff : null));
    const prefs = createDiffPrefs();
    const mounted = mountWithApp(() => (
      <DiffView session={testSession("/r", { root: "/r" } as RepoSnapshot)} target={{ source: "working", area: "unstaged", file: "a.txt" }} prefs={prefs} onClose={() => undefined} onViewFile={() => undefined} />
    ));
    dispose = () => {
      mounted.dispose();
      restoreLayout();
      vi.unstubAllGlobals();
    };
    await flush(60);

    expectCursor(mounted.host.querySelector(".dline"), "text");
    expectCursor(mounted.host.querySelector('button[role="checkbox"]'), "action");
    prefs.setMode("split");
    await flush(60);
    expectCursor(mounted.host.querySelector(".dsplit"), "text");
    prefs.setIgnoreWhitespace(true);
    await flush(60);
    expectCursor(mounted.host.querySelector('button[role="checkbox"]'), "disabled");
    expectCursor(mounted.host.querySelector('.hacts [aria-disabled="true"]'), "disabled");
  });

  it("shows the drag cursor on a rebase row's handle, the action cursor on its select, the disabled cursor on Move up of the first row, and the text cursor on a message editor", async () => {
    const todo = (sha: string, summary: string) => ({ sha, summary, author: { name: "Y", email: "a@example.test", initials: "Y" }, is_merge: false, pushed: false });
    const plan = { base: "b", commits: [todo("aaaaaaa1", "First"), todo("bbbbbbb2", "Second")], pushed: false };
    mockIPC((cmd) => {
      if (cmd === "rebase_plan") return plan;
      if (cmd === "commit_details") return { sha: "x", summary: "First", body: "", parents: [], refs: [], files: [] };
      return null;
    });
    const session = testSession("/r", { root: "/r", head: { kind: "branch", name: "main", sha: "a" }, counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, upstream: null } as unknown as RepoSnapshot);
    const mounted = mountWithApp(() => <RebaseEditor session={session} base="b" from="aaaaaaa1" onClose={() => undefined} />);
    dispose = mounted.dispose;
    await flush(60);
    await choose(mounted.host, "Action for Second", "Reword");
    const select = mounted.host.querySelector<HTMLButtonElement>('.rrow button[aria-haspopup="listbox"]') as HTMLButtonElement;

    const first = mounted.host.querySelector(".rrow");
    expectCursor(first?.querySelector(".rgrip"), "drag");
    expectCursor(select, "action");
    expectCursor(first?.querySelector('button[aria-label="Move Second up"]'), "disabled");
    expectCursor(first?.querySelector("textarea"), "text");
    expectCursor(first, "static");
  });

  it("shows the text cursor on file view lines and the action cursor on the recovery and worktree controls, with the disabled cursor and static rows", async () => {
    vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
    const restoreLayout = stubLayout();
    const lane = (path: string, current: boolean) => ({ path, head: "a", branch: "main", bare: false, locked: false, prunable: false, current, dirty: false });
    mockIPC((cmd) => {
      if (cmd === "file_at_revision") return { kind: "text", text: "a\n", size: 2, eol: "\n" };
      if (cmd === "reflog_refs") return ["HEAD"];
      if (cmd === "reflog_list") return [{ index: 0, selector: "HEAD@{0}", sha: "1".repeat(40), previous_sha: null, action: "commit", message: "commit: x", time: 1, summary: "x", exists: false }];
      if (cmd === "worktree_list") return [lane("/w/r", true), lane("/w/r-b", false)];
      return null;
    });
    const session = testSession("/r", { root: "/r", head: { kind: "branch", name: "main", sha: "a" }, branches: ["main"], worktrees: [] } as unknown as RepoSnapshot);
    const actions = { openCreate: () => undefined, open: () => undefined, openTerminal: () => undefined, integrate: () => undefined, remove: () => undefined } as never;
    const mounted = mountWithApp(() => (
      <>
        <FileView session={session} target={{ file: "a.txt", rev: ":worktree", source: "Working tree" }} onClose={() => undefined} />
        <RecoveryView session={session} tab="reflog" onClose={() => undefined} />
        <WorktreePanel session={session} actions={actions} onClose={() => undefined} />
      </>
    ));
    dispose = () => {
      mounted.dispose();
      restoreLayout();
      vi.unstubAllGlobals();
    };
    await flush(80);

    expectCursor(mounted.host.querySelector(".fline"), "text");
    expectCursor(mounted.host.querySelector('[aria-label="Recovery sources"] [role="tab"]'), "action");
    expectCursor(mounted.host.querySelector('button[aria-label="Restore 1111111 as a branch"]'), "disabled");
    expectCursor(mounted.host.querySelector(".recrow"), "static");
    expectCursor(mounted.host.querySelector('button[aria-label="Open /w/r-b in terminal"]'), "action");
    expectCursor(mounted.host.querySelector('button[aria-label="Open /w/r as a tab"]'), "disabled");
    expectCursor(mounted.host.querySelector(".wrow"), "static");
  });
});
