import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { GraphPage } from "../ipc/bindings/GraphPage";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { GraphPanel } from "./GraphPanel";
import { flush, mountWithApp, testUiPrefs } from "./testkit";

const TOTAL = 450;
let total = TOTAL;
const VIEWPORT = 280;
const geometry = { row: 28, pitch: 22, gutter: 4, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 56, messageColumnMin: 50, hitMin: 24, laneColors: 10 };

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
  for (const name of ["clientHeight", "offsetHeight"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => VIEWPORT });
  }
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => TOTAL * geometry.row });
  for (const name of ["clientWidth", "offsetWidth"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => 800 });
  }
  Element.prototype.scrollIntoView = () => undefined;
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === "object" ? (options.top ?? 0) : 0;
  };
  const offsets = new WeakMap<Element, number>();
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return offsets.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      offsets.set(this, value);
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    },
  });
});

afterEach(async () => {
  overrides = {};
  total = TOTAL;
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
  for (const name of ["clientHeight", "offsetHeight", "clientWidth", "offsetWidth", "scrollTop", "scrollTo", "scrollHeight"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

let overrides: Record<number, Partial<GraphRow>> = {};

const rowAt = (index: number): GraphRow => ({
  ...baseRow(index),
  ...overrides[index],
});

const baseRow = (index: number): GraphRow => ({
  sha: `sha${index}`,
  parents: index + 1 < TOTAL ? [`sha${index + 1}`] : [],
  summary: `commit ${index}`,
  body: "",
  author: { name: "Yui", email: "a@example.test", initials: "Y" },
  time: 1_700_000_000,
  refs: [],
  kind: "commit",
  column: 0,
  edges: [{ lane: 0, parent_row: index + 1 < TOTAL ? index + 1 : null, parent_column: index + 1 < TOTAL ? 0 : null }],
});

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "sha0" }, upstream: null, remotes: [], counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } } as unknown as RepoSnapshot;

type MountOptions = { snapshot?: Partial<RepoSnapshot>; actions?: Record<string, unknown>; onRevealHead?: () => void; jira?: boolean; heldPage?: { offset: number; result: Promise<GraphPage> } };

async function mountGraph(config: MountOptions = {}) {
  const offsets: number[] = [];
  const visibilities: unknown[] = [];
  mockIPC((cmd, args) => {
    if (config.jira === true && cmd === "jira_connections_list") return [{ id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "V", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 }];
    if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map((text) => text.match(/ABC-\d+/g) ?? []);
    if (cmd === "jira_issues_lookup") return (args as { keys: string[] }).keys.map((key) => ({ key, issue: { key, summary: "Retry login", status: "Done", status_category: "done", issue_type: "Bug", project: "ABC", updated_at: "", web_url: "", connection_id: "j1" }, failure: null }));
    if (cmd !== "repo_graph") return null;
    const { offset, limit, visibility } = args as { offset: number; limit: number; visibility?: unknown };
    offsets.push(offset);
    visibilities.push(visibility);
    const rows = Array.from({ length: Math.max(Math.min(limit, total - offset), 0) }, (_, position) => rowAt(offset + position));
    return config.heldPage?.offset === offset ? config.heldPage.result : { rows, carried: [], total };
  });
  const uiPrefs = testUiPrefs();
  const [selection, setSelection] = createSignal<Selection | undefined>();
  const [focus, setFocus] = createSignal<{ nonce: number; index?: number; ref?: string } | undefined>();
  const [revision, setRevision] = createSignal(0);
  const [covered, setCovered] = createSignal(false);
  const mounted = mountWithApp(() => (
    <GraphPanel
      path="/r"
      snapshot={{ ...snapshot, ...config.snapshot } as RepoSnapshot}
      geometry={geometry}
      selection={selection()}
      revision={revision()}
      covered={covered()}
      actions={(config.actions ?? {}) as unknown as RepoActions}
      dimmed={() => false}
      searching={false}
      focus={focus()}
      onSelect={setSelection}
      uiPrefs={uiPrefs}
      onRevealHead={config.onRevealHead ?? (() => undefined)}
    />
  ));
  dispose = mounted.dispose;
  await flush(60);
  const list = () => mounted.host.querySelector<HTMLElement>(".gscroll") as HTMLElement;
  const options = () => [...mounted.host.querySelectorAll<HTMLElement>('.grow[role="option"]')];
  const positions = () => options().map((option) => Number(option.getAttribute("aria-posinset")));
  const key = (name: string, init: KeyboardEventInit = {}) => list().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  const scrollTo = async (top: number) => {
    list().scrollTop = top;
    await flush(60);
  };
  return { host: mounted.host, offsets, visibilities, selection, setSelection, setFocus, list, options, positions, key, scrollTo, setRevision, setCovered, uiPrefs };
}

describe("graph panel", () => {
  it("keeps an explicit loading state inside the graph while an uncached first page is pending", async () => {
    let finish!: (page: GraphPage) => void;
    const result = new Promise<GraphPage>((resolve) => { finish = resolve; });
    const { host } = await mountGraph({ heldPage: { offset: 0, result } });
    expect(host.querySelector(".ghead")?.textContent).toContain("Graph");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading history");
    expect(host.querySelector(".graph")?.getAttribute("aria-busy")).toBe("true");

    finish({ rows: [rowAt(0)], carried: [], total: 1 });
    await flush(60);
    expect(host.querySelector("#graph-row-0 .msg")?.textContent).toContain("commit 0");
    expect(host.querySelector(".graph")?.getAttribute("aria-busy")).toBe("false");
    expect(host.textContent).not.toContain("Loading history");
  });

  it.each(["empty", "refused"])("settles the initial loading state after an %s history result", async (outcome) => {
    let finish!: (page: GraphPage) => void;
    let refuse!: (reason: unknown) => void;
    const result = new Promise<GraphPage>((resolve, reject) => { finish = resolve; refuse = reject; });
    const { host } = await mountGraph({ heldPage: { offset: 0, result } });
    if (outcome === "empty") finish({ rows: [], carried: [], total: 0 });
    else refuse({ kind: "git_failed", message: "Cannot read history", output: null });
    await flush(60);
    expect(host.querySelector(".graph")?.getAttribute("aria-busy")).toBe("false");
    expect(host.textContent).not.toContain("Loading history");
    if (outcome === "refused") expect(host.querySelector('[role="alert"]')?.textContent).toBe("Cannot read history");
  });
  it("restores the visible range after a covered scroller resets without a scroll event", async () => {
    const { list, positions, scrollTo, setCovered } = await mountGraph();
    await scrollTo(300 * geometry.row);
    const before = list().scrollTop;
    setCovered(true);
    await flush();
    let offset = 0;
    Object.defineProperty(list(), "scrollTop", {
      configurable: true,
      get: () => offset,
      set: (value: number) => { offset = value; },
    });

    setCovered(false);
    await flush(60);

    expect(list().scrollTop).toBe(before);
    expect(positions()).toContain(301);
  });

  it("reveals a commit selected while covered when the graph returns", async () => {
    const { setSelection, setCovered, scrollTo, positions } = await mountGraph();
    setSelection({ kind: "commit", sha: "sha300" });
    await scrollTo(300 * geometry.row);
    setCovered(true);
    await flush();
    setSelection({ kind: "commit", sha: "sha350" });
    await flush(60);

    setCovered(false);
    await flush(60);

    expect(positions()).toContain(351);
  });
  it("shows the first description line after the commit summary without changing the row height", async () => {
    overrides = { 0: { summary: "Add export", body: "Explain the reason" } };
    const { host } = await mountGraph();
    const row = host.querySelector("#graph-row-0");
    expect(row?.querySelector(".msg .sum")?.textContent).toBe("Add export");
    expect(row?.querySelector(".msg .body")?.textContent).toBe("Explain the reason");
    expect(row?.getAttribute("aria-label")).toContain("Add export");
  });

  it("gives each loaded row an opaque lane-tinted graph-column band behind its node", async () => {
    const { host } = await mountGraph();
    const band = host.querySelector("#graph-row-0 .lane-band");
    expect(band).not.toBeNull();
    expect(band?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("#graph-row-1 .lane-band")).not.toBeNull();
  });
  it("renders only the rows in view, labelled with their position among all commits", async () => {
    const { options, positions, list, host } = await mountGraph();

    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThan(40);
    expect(positions()[0]).toBe(1);
    expect(options()[0]?.getAttribute("aria-setsize")).toBe(String(TOTAL));
    expect(options()[0]?.textContent).toContain("commit 0");
    expect(list().getAttribute("role")).toBe("listbox");
    expect(host.querySelector<HTMLElement>(".gspacer")?.style.height).toBe(`${TOTAL * geometry.row}px`);
  });

  it("loads the pages the scroll position reaches, once each", async () => {
    const { offsets, scrollTo, positions } = await mountGraph();
    expect(offsets).toEqual([0]);

    await scrollTo(300 * geometry.row);

    expect(offsets).toContain(200);
    expect(offsets.filter((offset) => offset === 200)).toHaveLength(1);
    expect(Math.min(...positions())).toBeGreaterThan(250);
    expect(Math.max(...positions())).toBeGreaterThan(300);
  });

  it("states that a visible page is loading instead of leaving a blank graph gap", async () => {
    let release: ((page: GraphPage) => void) | undefined;
    const held = new Promise<GraphPage>((resolve) => (release = resolve));
    const { host, scrollTo } = await mountGraph({ heldPage: { offset: 200, result: held } });
    await scrollTo(198 * geometry.row);

    expect(host.querySelectorAll(".grow.placeholder").length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.graph-loading[role="status"]')).toHaveLength(1);
    expect(host.querySelector(".graph-loading")?.textContent).toBe("Loading commits…");
    release?.({ rows: Array.from({ length: 200 }, (_, index) => rowAt(200 + index)), carried: [], total });
    await flush(80);
    expect(host.querySelector("#graph-row-200 .msg")?.textContent).toContain("commit 200");
    expect(host.querySelector(".graph-loading")).toBeNull();
  });

  it("moves the selection with the arrow keys and J/K, and points aria-activedescendant at it", async () => {
    const { key, selection, list } = await mountGraph();

    key("j");
    key("ArrowDown");
    expect(selection()).toEqual({ kind: "commit", sha: "sha1" });
    key("k");
    await flush();

    expect(selection()).toEqual({ kind: "commit", sha: "sha0" });
    expect(list().getAttribute("aria-activedescendant")).toBe("graph-row-0");
  });

  it("scrolls a selection that leaves the view back into it", async () => {
    const { key, list, selection, scrollTo } = await mountGraph();
    await scrollTo(400 * geometry.row);

    key("End");
    await flush(80);

    expect(selection()).toEqual({ kind: "commit", sha: `sha${TOTAL - 1}` });
    expect(list().scrollTop).toBeGreaterThanOrEqual((TOTAL - 1) * geometry.row + geometry.row - VIEWPORT - 1);
    expect(list().querySelector(`#graph-row-${TOTAL - 1}`)?.getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to a commit that a search reveals and selects it", async () => {
    const { setFocus, selection, positions } = await mountGraph();

    setFocus({ nonce: 1, index: 320 });
    await flush(120);

    expect(selection()).toEqual({ kind: "commit", sha: "sha320" });
    expect(positions()).toContain(321);
  });

  it("takes the header labels and the graph column width from the column model", async () => {
    const { host } = await mountGraph();

    expect([...host.querySelectorAll(".ghead .gh")].map((cell) => cell.textContent)).toEqual(["Branch / Tag", "Graph", "Commit message", ""]);
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe(`${geometry.graphColumn}px`);
    expect(host.querySelector<HTMLElement>(".grow .msg")?.style.left).toBe(`${geometry.refColumn + geometry.graphColumn + 12}px`);
  });
});

const ref = (name: string, kind: "local_branch" | "remote_branch" | "tag" = "local_branch", head = false) => ({ name, kind, is_head: head });
const rowElement = (host: ParentNode, index: number) => host.querySelector<HTMLElement>(`#graph-row-${index}`) as HTMLElement;
const click = (element: Element, init: MouseEventInit = {}) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const dirtySnapshot = { counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } };

describe("graph refresh", () => {
  it("renders the remaining commits when a refresh shortens history while scrolled beyond its new end", async () => {
    total = 2000;
    const { host, scrollTo, setRevision, offsets } = await mountGraph();
    await scrollTo(1500 * geometry.row);
    expect(host.querySelector("#graph-row-1500 .msg")?.textContent).toContain("commit 1500");

    total = TOTAL;
    setRevision(1);
    await flush(120);

    expect(offsets).toContain(400);
    expect(host.querySelector("#graph-row-449 .msg")?.textContent).toContain("commit 449");
    expect(host.querySelectorAll(".grow.placeholder")).toHaveLength(0);
  });

  it("keeps every visible row in place when the history grows, so nothing re-renders or flickers (S8)", async () => {
    const { host, setRevision } = await mountGraph();
    const before = rowElement(host, 2);
    expect(before).not.toBeNull();

    total = TOTAL + 1;
    setRevision(1);
    await flush(80);

    expect(rowElement(host, 2)).toBe(before);
  });
});

describe("branch and tag column overflow", () => {
  const crowded = { 1: { refs: [ref("main", "local_branch", true), ref("feature/a"), ref("origin/feature/b", "remote_branch"), ref("v1", "tag")] } };

  it("shows one label per row and names every other branch and tag on the +N button, which opens a popover listing them", async () => {
    overrides = crowded;
    const { host } = await mountGraph();

    expect([...rowElement(host, 1).querySelectorAll(".refcell > .label")].map((label) => label.textContent)).toEqual(["main"]);
    const more = rowElement(host, 1).querySelector<HTMLButtonElement>("button.more") as HTMLButtonElement;
    expect(more.textContent).toBe("+3");
    expect(more.getAttribute("aria-label")).toBe("3 more refs: feature/a, origin/feature/b, v1");
    expect(more.getAttribute("aria-haspopup")).toBe("dialog");
    click(more);
    await flush();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("More refs on sha1");
    expect([...dialog.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["feature/a", "origin/feature/b", "v1"]);
    expect(rowElement(host, 1).getAttribute("aria-label")).toContain("3 more refs, press Enter to list");
  });

  it("stacks every ref of the row on hover, each opening its own menu on right-click", async () => {
    overrides = crowded;
    const menus: unknown[] = [];
    const { host } = await mountGraph({ actions: { openRefMenu: (target: unknown) => menus.push(target) } });

    const stack = rowElement(host, 1).querySelector(".refcell .refstack") as HTMLElement;
    const labels = [...stack.querySelectorAll<HTMLElement>("[data-ref-label]")];
    expect(labels.map((label) => label.textContent)).toEqual(["main", "feature/a", "origin/feature/b", "v1"]);
    labels[3]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    labels[1]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));

    expect(menus).toEqual([
      { kind: "tag", name: "v1", startPoint: "sha1" },
      { kind: "local_branch", name: "feature/a", remoteName: undefined, startPoint: "sha1" },
    ]);
  });

  it("opens from the keyboard with Enter on the selected row, moves with the arrows, and checks the chosen branch out", async () => {
    overrides = crowded;
    const checked: unknown[] = [];
    const { host, key, setSelection } = await mountGraph({ actions: { checkoutRef: (target: unknown) => checked.push(target) } });
    setSelection({ kind: "commit", sha: "sha1" });
    await flush();

    key("Enter");
    await flush();
    const list = document.querySelector('[role="dialog"] [role="listbox"]') as HTMLElement;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-activedescendant")).toMatch(/-0$/);
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    expect(checked).toEqual([{ kind: "remote_branch", name: "origin/feature/b", startPoint: "sha1" }]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".gscroll")).toBe(document.activeElement);
  });

  it("closes the popover with Escape and returns focus to the graph", async () => {
    overrides = crowded;
    const { host, key, setSelection } = await mountGraph();
    setSelection({ kind: "commit", sha: "sha1" });
    await flush();
    key("Enter");
    await flush();

    document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[role="listbox"][aria-label="Commits"]')).not.toBeNull();
  });
});

describe("graph columns", () => {
  it("lets the visible single-lane graph resize without a wide off-screen commit forcing its minimum", async () => {
    overrides = { 100: { column: 24, edges: [{ lane: 24, parent_row: 101, parent_column: 0 }] } };
    const { host, uiPrefs, scrollTo } = await mountGraph();
    const handle = host.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Graph column"]');
    expect(handle?.getAttribute("aria-valuemin")).toBe("56");
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("56px");
    handle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 0 }));
    handle?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 120 }));
    handle?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 120 }));
    await flush();
    expect(uiPrefs.prefs().columns).toContainEqual({ column: "graph", visible: true, width: 176 });

    await scrollTo(100 * geometry.row);
    expect(Number(handle?.getAttribute("aria-valuemin"))).toBeGreaterThanOrEqual(4 + 25 * 22);
    await scrollTo(0);
    expect(handle?.getAttribute("aria-valuemin")).toBe("56");
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("176px");
    expect(uiPrefs.prefs().columns).toContainEqual({ column: "graph", visible: true, width: 176 });
  });

  it("reserves space for a carried edge crossing the viewport even when both endpoint nodes are outside it", async () => {
    overrides = { 10: { edges: [{ lane: 9, parent_row: 150, parent_column: 0 }] } };
    const { host, scrollTo } = await mountGraph();
    await scrollTo(80 * geometry.row);
    expect(host.querySelector("#graph-row-10")).toBeNull();
    expect(host.querySelector("#graph-row-150")).toBeNull();
    const handle = host.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Graph column"]');
    expect(handle?.getAttribute("aria-valuemin")).toBe("224");
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("224px");
  });
  const openSettings = async (host: HTMLElement) => {
    click(host.querySelector('button[aria-haspopup="dialog"][data-tip="Graph columns and branches"]') as Element);
    await flush();
  };
  const checkbox = (label: string) => [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')].find((input) => input.parentElement?.textContent?.trim() === label) as HTMLInputElement;

  it("shows only the default columns until Author, Date / Time, and SHA are turned on in the column settings", async () => {
    const { host } = await mountGraph();
    expect(host.querySelector(".gcell")).toBeNull();
    await openSettings(host);

    checkbox("Author").click();
    checkbox("SHA").click();
    await flush();

    expect([...host.querySelectorAll(".ghead .gh")].map((cell) => cell.textContent)).toEqual(["Branch / Tag", "Graph", "Commit message", "Author", "SHA", ""]);
    expect([...rowElement(host, 0).querySelectorAll(".gcell")].map((cell) => cell.textContent)).toEqual(["Yui", "sha0"]);
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--extra-w")).toBe("230px");
  });

  it("does not load the history again when a column is shown", async () => {
    const { host, offsets } = await mountGraph();
    await openSettings(host);
    const before = offsets.length;

    checkbox("Author").click();
    await flush(80);

    expect(offsets.length).toBe(before);
  });

  it("shows the date as a relative age with the absolute time in its tooltip", async () => {
    const { host } = await mountGraph();
    await openSettings(host);

    checkbox("Date / Time").click();
    await flush();

    const cell = rowElement(host, 0).querySelector<HTMLElement>(".gcell") as HTMLElement;
    expect(cell.textContent).toMatch(/\d/);
    expect(cell.title).not.toBe("");
  });

  it("ages the date column as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date(1_700_000_020 * 1000));
      const { host } = await mountGraph();
      await openSettings(host);
      checkbox("Date / Time").click();
      await flush();
      const age = () => rowElement(host, 0).querySelector(".gcell")?.textContent;
      expect(age()).toBe("20s");

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(age()).toBe("2h");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resizes the Branch / Tag column from its separator with the arrow keys within its limits, and resets it with Home", async () => {
    const { host } = await mountGraph();
    const handle = host.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Branch / Tag column"]') as HTMLElement;

    expect(handle.getAttribute("aria-valuenow")).toBe("200");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--ref-w")).toBe("208px");
    for (let step = 0; step < 20; step++) handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--ref-w")).toBe("300px");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--ref-w")).toBe("200px");
  });

  it("resizes the Graph column from its message-edge separator and saves the width", async () => {
    const { host, uiPrefs } = await mountGraph();
    const handle = host.querySelector<HTMLElement>('[role="separator"][aria-label="Resize Graph column"]');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-valuenow")).toBe("56");
    expect(handle?.getAttribute("aria-valuemax")).toBe("526");

    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("64px");
    expect(host.querySelector<HTMLElement>(".grow .msg")?.style.left).toBe("276px");
    expect(host.querySelector<HTMLElement>(".ghead")?.style.gridTemplateColumns).toContain("minmax(50px, 1fr)");
    expect(uiPrefs.prefs().columns).toContainEqual({ column: "graph", visible: true, width: 64 });

    handle?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 0 }));
    handle?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 100 }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("164px");
    handle?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 100 }));
    await flush();
    expect(uiPrefs.prefs().columns).toContainEqual({ column: "graph", visible: true, width: 164 });

    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("156px");

    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("56px");
  });

  it("keeps the saved graph width when the panel narrows and restores it when space returns", async () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe = (element: Element) => {
        if (element.classList.contains("graph")) resize = () => this.callback([], this as ResizeObserver);
      };
      unobserve = () => undefined;
      disconnect = () => undefined;
    });
    let width = 800;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
    const { host, uiPrefs } = await mountGraph();
    uiPrefs.update((current) => ({ ...current, columns: [{ column: "graph", visible: true, width: 500 }] }));
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("500px");

    width = 600;
    resize?.();
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("326px");
    expect(uiPrefs.prefs().columns).toContainEqual({ column: "graph", visible: true, width: 500 });

    width = 800;
    resize?.();
    await flush();
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe("500px");
  });

  it("hides the optional columns on a narrow window without forgetting them", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    const { host } = await mountGraph();
    await openSettings(host);
    checkbox("Author").click();
    await flush();
    expect(host.querySelector(".gcell")).not.toBeNull();

    Object.defineProperty(window, "innerWidth", { value: 960, configurable: true });
    window.dispatchEvent(new Event("resize"));
    await flush();

    expect(host.querySelector(".gcell")).toBeNull();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });
});

describe("multi-select", () => {
  it("adds and removes commits with ⌘-click and reports the count", async () => {
    const { host, selection } = await mountGraph();

    click(rowElement(host, 1));
    click(rowElement(host, 3), { metaKey: true });
    await flush();

    expect(selection()).toEqual({ kind: "commit", sha: "sha3", anchor: "sha3", shas: ["sha1", "sha3"] });
    expect(rowElement(host, 1).getAttribute("aria-selected")).toBe("true");
    expect(rowElement(host, 2).getAttribute("aria-selected")).toBe("false");
    expect(rowElement(host, 3).getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".gsummary")?.textContent).toContain("2 commits selected");
    click(rowElement(host, 3), { metaKey: true });
    await flush();
    expect(selection()).toEqual({ kind: "commit", sha: "sha1", anchor: "sha1" });
    expect(host.querySelector(".gsummary")).toBeNull();
  });

  it("selects the range from the anchor with ⇧-click, even across pages that were not loaded yet", async () => {
    const { host, selection } = await mountGraph();

    click(rowElement(host, 1));
    click(rowElement(host, 5), { shiftKey: true });
    await flush(60);

    expect((selection() as { shas: readonly string[] }).shas).toEqual(["sha1", "sha2", "sha3", "sha4", "sha5"]);
    expect(host.querySelector(".gsummary")?.textContent).toContain("5 commits selected");
    expect(host.querySelector(".gsummary")?.textContent).toContain("sha5");
  });

  it("extends with ⇧+arrow and J/K, toggles the current commit with Space, and collapses to one with Escape", async () => {
    const { host, key, selection, setSelection } = await mountGraph();
    setSelection({ kind: "commit", sha: "sha1" });
    await flush();

    key("ArrowDown", { shiftKey: true });
    key("J", { shiftKey: true });
    await flush();
    expect((selection() as { shas: readonly string[] }).shas).toEqual(["sha1", "sha2", "sha3"]);
    key("K", { shiftKey: true });
    await flush();
    expect((selection() as { shas: readonly string[] }).shas).toEqual(["sha1", "sha2"]);
    key(" ");
    await flush();
    expect(selection()).toEqual({ kind: "commit", sha: "sha1", anchor: "sha1" });
    key("ArrowDown", { shiftKey: true });
    await flush();
    key("Escape");
    await flush();
    expect(selection()).toEqual({ kind: "commit", sha: "sha2" });
    expect(host.querySelector(".gsummary")).toBeNull();
  });

  it("clears the selection to the current commit from the summary bar", async () => {
    const { host, selection } = await mountGraph();
    click(rowElement(host, 1));
    click(rowElement(host, 2), { metaKey: true });
    await flush();

    host.querySelector<HTMLButtonElement>('.gsummary button[data-tip^="Clear selection"]')?.click();
    await flush();

    expect(selection()).toEqual({ kind: "commit", sha: "sha2" });
  });

  it("opens the commit menu with the whole selection when the right-clicked commit is in it, and selects a commit outside it first", async () => {
    const menus: unknown[][] = [];
    const { host, selection } = await mountGraph({ actions: { openCommitMenu: (...args: unknown[]) => menus.push(args) } });
    click(rowElement(host, 1));
    click(rowElement(host, 3), { metaKey: true });
    await flush();

    rowElement(host, 3).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 5 }));
    rowElement(host, 6).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 6, clientY: 7 }));
    await flush();

    expect(menus[0]).toEqual(["sha3", false, { left: 4, top: 5 }, ["sha1", "sha3"], { root: false, squashReason: "The selected commits are not one contiguous run of the current branch" }]);
    expect(menus[1]).toEqual(["sha6", false, { left: 6, top: 7 }, ["sha6"], { root: false }]);
    expect(selection()).toEqual({ kind: "commit", sha: "sha6" });
  });

  it("gives the menu no squash reason for a contiguous selection and flags the root commit", async () => {
    const menus: unknown[][] = [];
    await mountGraph({ actions: { openCommitMenu: (...args: unknown[]) => menus.push(args) } }).then(async ({ host }) => {
      click(rowElement(host, 1));
      click(rowElement(host, 2), { metaKey: true });
      await flush();
      rowElement(host, 2).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 2 }));
      await flush();
    });

    expect(menus[0]?.[3]).toEqual(["sha1", "sha2"]);
    expect(menus[0]?.[4]).toEqual({ root: false });
  });
});

describe("branch highlight", () => {
  const forked = {
    0: { sha: "other", parents: ["sha2"], refs: [ref("other")] },
    1: { sha: "sha1", parents: ["sha2"], refs: [ref("main", "local_branch", true)] },
    2: { sha: "sha2", parents: ["sha3"] },
  };
  const dimmed = (host: ParentNode, count: number) => Array.from({ length: count }, (_, index) => rowElement(host, index).classList.contains("dim"));

  it("dims the commits that are not part of a branch while its label is hovered, and restores them after", async () => {
    overrides = forked;
    const { host } = await mountGraph({ snapshot: dirtySnapshot });
    const labels = rowElement(host, 1).querySelectorAll<HTMLElement>(".label");

    labels[0]?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    await flush();
    expect(dimmed(host, 5)).toEqual([true, false, false, false, false]);
    labels[0]?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    await flush();
    expect(dimmed(host, 5)).toEqual([false, false, false, false, false]);
  });

  it("pins the highlight of the selected row's branch with B until B or Escape", async () => {
    overrides = forked;
    const { host, key, setSelection } = await mountGraph({ snapshot: dirtySnapshot });
    setSelection({ kind: "commit", sha: "sha1" });
    await flush();

    key("b");
    await flush();
    expect(dimmed(host, 4)).toEqual([true, false, false, false]);
    key("b");
    await flush();
    expect(dimmed(host, 4)).toEqual([false, false, false, false]);
    key("B");
    key("Escape");
    await flush();
    expect(dimmed(host, 4)).toEqual([false, false, false, false]);
  });
});

describe("reveal HEAD", () => {
  it("reveals HEAD with the H key from the graph", async () => {
    let revealed = 0;
    const { key } = await mountGraph({ onRevealHead: () => (revealed += 1) });

    key("h");
    key("H");

    expect(revealed).toBe(2);
  });

  it("scrolls to a target without selecting it when the target asks not to select", async () => {
    const { setFocus, selection, positions } = await mountGraph();

    setFocus({ nonce: 1, index: 320, select: false });
    await flush(120);

    expect(selection()).toBeUndefined();
    expect(positions()).toContain(321);
  });
});

describe("working tree row from the core", () => {
  it("shows the clean working-tree row, named for screen readers, and opens the Changes inspector when selected", async () => {
    overrides = { 0: { sha: null, parents: ["sha1"], summary: "Working tree clean", author: null, time: null, kind: "clean_changes" } };
    const { host, selection } = await mountGraph();

    const row = rowElement(host, 0);
    expect(row.textContent).toContain("Working tree clean");
    expect(row.getAttribute("aria-label")).toContain("working tree, clean");
    expect(row.classList.contains("kind-clean_changes")).toBe(true);
    click(row);

    expect(selection()).toEqual({ kind: "changes" });
  });
});

describe("branch visibility", () => {
  const radio = (label: string) => [...document.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[type="radio"]')].find((input) => input.parentElement?.textContent?.includes(label)) as HTMLInputElement;

  it("asks the core for Current + upstream when chosen and for every branch again when All is chosen", async () => {
    const { host, visibilities } = await mountGraph();
    expect(visibilities).toEqual([undefined]);
    click(host.querySelector('button[aria-haspopup="dialog"][data-tip="Graph columns and branches"]') as Element);
    await flush();
    expect(radio("All branches").checked).toBe(true);

    radio("Current + upstream").click();
    await flush(80);
    expect(visibilities.at(-1)).toEqual({ kind: "current_and_upstream" });
    expect(radio("Current + upstream").checked).toBe(true);

    radio("All branches").click();
    await flush(80);
    expect(visibilities.at(-1)).toBeUndefined();
  });
});

describe("Jira issue chips", () => {
  it("marks a key in a commit subject or a branch label with a chip and leaves other rows alone", async () => {
    overrides = {
      0: { summary: "Retry the login (ABC-142)" },
      1: { summary: "Bump the base image", refs: [{ name: "fix/ABC-77-timeouts", kind: "local_branch", is_head: false, sha: "sha1" } as unknown as GraphRow["refs"][number]] },
    };
    const { host } = await mountGraph({ jira: true });
    await flush(100);

    const chips = (index: number) => [...rowElement(host, index).querySelectorAll(".chip.key .mono")].map((chip) => chip.textContent);
    expect(chips(0)).toEqual(["ABC-142"]);
    expect(chips(1)).toEqual(["ABC-77"]);
    expect(chips(2)).toEqual([]);
    expect(rowElement(host, 0).querySelector(".chip.key")?.getAttribute("data-tip")).toBe("ABC-142 · Retry login · Done");
  });

  it("shows no chips without a Jira connection", async () => {
    overrides = { 0: { summary: "Retry the login (ABC-142)" } };
    const { host } = await mountGraph();
    await flush(60);

    expect(rowElement(host, 0).querySelector(".chip.key")).toBeNull();
  });
});
