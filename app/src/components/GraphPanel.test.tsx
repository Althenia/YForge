import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { GraphPanel } from "./GraphPanel";
import { flush, mountWithApp, testUiPrefs } from "./testkit";

const TOTAL = 450;
const VIEWPORT = 280;
const geometry = { row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 160, laneColors: 10 };

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
  author: { name: "Yui", email: "a@example.test", initials: "Y" },
  time: 1_700_000_000,
  refs: [],
  kind: "commit",
  column: 0,
  edges: [{ lane: 0, parent_row: index + 1 < TOTAL ? index + 1 : null, parent_column: index + 1 < TOTAL ? 0 : null }],
});

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "sha0" }, upstream: null, remotes: [], counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } } as unknown as RepoSnapshot;

type MountOptions = { snapshot?: Partial<RepoSnapshot>; actions?: Record<string, unknown>; onRevealHead?: () => void };

async function mountGraph(config: MountOptions = {}) {
  const offsets: number[] = [];
  const visibilities: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "repo_graph") return null;
    const { offset, limit, visibility } = args as { offset: number; limit: number; visibility?: unknown };
    offsets.push(offset);
    visibilities.push(visibility);
    const rows = Array.from({ length: Math.max(Math.min(limit, TOTAL - offset), 0) }, (_, position) => rowAt(offset + position));
    return { rows, carried: [], total: TOTAL };
  });
  const uiPrefs = testUiPrefs();
  const [selection, setSelection] = createSignal<Selection | undefined>();
  const [focus, setFocus] = createSignal<{ nonce: number; index?: number; ref?: string } | undefined>();
  const mounted = mountWithApp(() => (
    <GraphPanel
      path="/r"
      snapshot={{ ...snapshot, ...config.snapshot } as RepoSnapshot}
      geometry={geometry}
      selection={selection()}
      revision={0}
      covered={false}
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
  return { host: mounted.host, offsets, visibilities, selection, setSelection, setFocus, list, options, positions, key, scrollTo };
}

describe("graph panel", () => {
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

describe("branch and tag column overflow", () => {
  const crowded = { 1: { refs: [ref("main", "local_branch", true), ref("feature/a"), ref("origin/feature/b", "remote_branch"), ref("v1", "tag")] } };

  it("names the hidden branches on the +N button, which opens a popover listing them", async () => {
    overrides = crowded;
    const { host } = await mountGraph();

    const more = rowElement(host, 1).querySelector<HTMLButtonElement>("button.more") as HTMLButtonElement;
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("aria-label")).toBe("2 more branches: feature/a, origin/feature/b");
    expect(more.getAttribute("aria-haspopup")).toBe("dialog");
    click(more);
    await flush();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("More branches on sha1");
    expect([...dialog.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["feature/a", "origin/feature/b"]);
    expect(rowElement(host, 1).getAttribute("aria-label")).toContain("2 more branches, press Enter to list");
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
