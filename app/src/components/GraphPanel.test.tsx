import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { GraphPanel } from "./GraphPanel";
import { flush, mountWithApp } from "./testkit";

const TOTAL = 450;
const VIEWPORT = 280;
const geometry = { row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, graphColumn: 160, laneColors: 10 };

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

const rowAt = (index: number): GraphRow => ({
  sha: `sha${index}`,
  parents: index + 1 < TOTAL ? [`sha${index + 1}`] : [],
  summary: `commit ${index}`,
  author: { name: "Yui", initials: "Y" },
  time: 1_700_000_000,
  refs: [],
  kind: "commit",
  column: 0,
  edges: [{ lane: 0, parent_row: index + 1 < TOTAL ? index + 1 : null, parent_column: index + 1 < TOTAL ? 0 : null }],
});

const snapshot = { root: "/r", remotes: [], counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } } as unknown as RepoSnapshot;

async function mountGraph() {
  const offsets: number[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "repo_graph") return null;
    const { offset, limit } = args as { offset: number; limit: number };
    offsets.push(offset);
    const rows = Array.from({ length: Math.max(Math.min(limit, TOTAL - offset), 0) }, (_, position) => rowAt(offset + position));
    return { rows, carried: [], total: TOTAL };
  });
  const [selection, setSelection] = createSignal<Selection | undefined>();
  const [focus, setFocus] = createSignal<{ nonce: number; index?: number; ref?: string } | undefined>();
  const mounted = mountWithApp(() => (
    <GraphPanel
      path="/r"
      snapshot={snapshot}
      geometry={geometry}
      selection={selection()}
      revision={0}
      covered={false}
      actions={{} as RepoActions}
      dimmed={() => false}
      searching={false}
      focus={focus()}
      onSelect={setSelection}
    />
  ));
  dispose = mounted.dispose;
  await flush(60);
  const list = () => mounted.host.querySelector<HTMLElement>(".gscroll") as HTMLElement;
  const options = () => [...mounted.host.querySelectorAll<HTMLElement>('.grow[role="option"]')];
  const positions = () => options().map((option) => Number(option.getAttribute("aria-posinset")));
  const key = (name: string) => list().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const scrollTo = async (top: number) => {
    list().scrollTop = top;
    await flush(60);
  };
  return { host: mounted.host, offsets, selection, setFocus, list, options, positions, key, scrollTo };
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

    expect([...host.querySelectorAll(".ghead span")].map((cell) => cell.textContent)).toEqual(["Branch / Tag", "Graph", "Commit message"]);
    expect(host.querySelector<HTMLElement>(".graph")?.style.getPropertyValue("--graph-w")).toBe(`${geometry.graphColumn}px`);
    expect(host.querySelector<HTMLElement>(".grow .msg")?.style.left).toBe(`${geometry.refColumn + geometry.graphColumn + 12}px`);
  });
});
