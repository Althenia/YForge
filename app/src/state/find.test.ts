import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFindRegistry, createPageFind, findLabel, occurrences, type FindList } from "./find";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("occurrences", () => {
  it("finds every non-overlapping match regardless of case", () => {
    expect(occurrences("Retry, retry, RETRY", "retry")).toEqual([0, 7, 14]);
    expect(occurrences("aaaa", "aa")).toEqual([0, 2]);
    expect(occurrences("anything", "")).toEqual([]);
  });
});

describe("findLabel", () => {
  it("states the position, no match, or nothing for an empty query", () => {
    expect(findLabel({ query: "", count: 0, position: 0 })).toBe("");
    expect(findLabel({ query: "x", count: 0, position: 0 })).toBe("No matches");
    expect(findLabel({ query: "x", count: 4, position: 1 })).toBe("2 of 4");
  });
});

function fixture() {
  const root = document.createElement("section");
  root.innerHTML = `<header>Retry header</header><span aria-hidden="true">retry hidden</span><div class="rows"><div data-find-row="0">retry once</div></div><p>tail retry</p>`;
  document.body.append(root);
  const element = root.querySelector<HTMLElement>(".rows")!;
  const revealed: number[] = [];
  const list: FindList = {
    element,
    texts: () => ["retry once", "no match", "retry twice retry"],
    reveal: (index) => revealed.push(index),
    rows: () => [...element.querySelectorAll<HTMLElement>("[data-find-row]")].map((row) => [Number(row.dataset.findRow), row] as const),
  };
  return { root, list, revealed };
}

function mount(root: HTMLElement, lists: FindList[]) {
  return createRoot((dispose) => {
    const registry = createFindRegistry();
    for (const list of lists) registry.registry.register(list);
    return { find: createPageFind(() => root, registry.lists), dispose };
  });
}

describe("createPageFind", () => {
  it("counts matches in document order, including rows a virtual list has not drawn, and skips hidden text", () => {
    const { root, list, revealed } = fixture();
    const { find, dispose } = mount(root, [list]);
    find.show();
    find.setQuery("retry");

    expect(find.state()).toEqual({ query: "retry", count: 5, position: 0 });
    find.next();
    expect(revealed).toEqual([0]);
    find.next();
    find.next();
    expect(revealed).toEqual([0, 2, 2]);
    expect(find.state().position).toBe(3);
    find.next();
    find.next();
    expect(find.state().position).toBe(0);
    find.previous();
    expect(find.state().position).toBe(4);
    dispose();
  });

  it("marks visible matches and the current one, and clears the marks when closed", () => {
    const sets = new Map<string, { ranges: Range[] }>();
    class HighlightStub {
      ranges: Range[] = [];
      add(range: Range) {
        this.ranges.push(range);
      }
    }
    vi.stubGlobal("Highlight", HighlightStub);
    vi.stubGlobal("CSS", { highlights: { set: (name: string, value: HighlightStub) => sets.set(name, value), delete: (name: string) => sets.delete(name) } });
    const { root, list } = fixture();
    const { find, dispose } = mount(root, [list]);
    find.show();
    find.setQuery("retry");
    find.next();

    expect(sets.get("find-current")?.ranges.map((range) => range.startContainer.textContent)).toEqual(["retry once"]);
    expect(sets.get("find")?.ranges.map((range) => range.toString())).toEqual(["Retry", "retry"]);

    find.close();
    expect(sets.size).toBe(0);
    expect(find.state()).toEqual({ query: "", count: 0, position: 0 });
    dispose();
  });

  it("returns focus to the view: to where it was inside the view, or to the view's first control", () => {
    const { root, list } = fixture();
    const inside = document.createElement("button");
    root.append(inside);
    const outside = document.createElement("button");
    document.body.append(outside);
    const { find, dispose } = mount(root, [list]);

    inside.focus();
    find.show();
    outside.focus();
    find.close();
    expect(document.activeElement).toBe(inside);

    outside.focus();
    find.show();
    find.close();
    expect(document.activeElement).toBe(inside);
    dispose();
  });
});
