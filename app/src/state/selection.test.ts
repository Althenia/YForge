import { describe, expect, it } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import { indexOfSelection, rangeSelection, selectedShas, selectionOfRow, stepIndex, toggleSelection, type Selection } from "./selection";

const row = (kind: GraphRow["kind"], sha: string | null): GraphRow => ({
  sha,
  parents: [],
  summary: "",
  author: null,
  time: null,
  refs: [],
  kind,
  column: 0,
  edges: [],
});

describe("selection", () => {
  it("selects the Changes pseudo-row as changes and commit-like rows by sha", () => {
    expect(selectionOfRow(row("changes", null))).toEqual({ kind: "changes" });
    expect(selectionOfRow(row("commit", "abc"))).toEqual({ kind: "commit", sha: "abc" });
    expect(selectionOfRow(row("merge", "def"))).toEqual({ kind: "commit", sha: "def" });
    expect(selectionOfRow(row("stash", "123"))).toEqual({ kind: "stash", sha: "123" });
    expect(selectionOfRow(row("commit", null))).toBeUndefined();
  });

  it("finds the selected row by identity, so the selection follows a row that moved", () => {
    const before = new Map([[0, row("commit", "abc")], [1, row("commit", "def")]]);
    const after = new Map([[0, row("changes", null)], [1, row("commit", "abc")], [2, row("commit", "def")]]);
    expect(indexOfSelection(before, { kind: "commit", sha: "def" })).toBe(1);
    expect(indexOfSelection(after, { kind: "commit", sha: "def" })).toBe(2);
    expect(indexOfSelection(after, { kind: "changes" })).toBe(0);
    expect(indexOfSelection(before, { kind: "changes" })).toBeUndefined();
    expect(indexOfSelection(before, undefined)).toBeUndefined();
  });

  it("steps J/K within the rows, starting from the first or last row when nothing is selected", () => {
    expect(stepIndex(undefined, 1, 4)).toBe(0);
    expect(stepIndex(undefined, -1, 4)).toBe(4);
    expect(stepIndex(2, 1, 4)).toBe(3);
    expect(stepIndex(2, -1, 4)).toBe(1);
    expect(stepIndex(4, 1, 4)).toBe(4);
    expect(stepIndex(0, -1, 4)).toBe(0);
    expect(stepIndex(undefined, 1, -1)).toBeUndefined();
  });

  it("finds a selected stash row by its sha", () => {
    const rows = new Map([[0, row("commit", "abc")], [1, row("stash", "123")]]);
    expect(indexOfSelection(rows, { kind: "stash", sha: "123" })).toBe(1);
  });
});

const history = new Map<number, GraphRow>([
  [0, row("changes", null)],
  [1, row("commit", "c1")],
  [2, row("stash", "s1")],
  [3, row("merge", "c2")],
  [4, row("commit", "c3")],
  [5, row("commit", "c4")],
]);

describe("multi-select", () => {
  it("lists the selected commits, one for a single selection and none for Changes", () => {
    expect(selectedShas(undefined)).toEqual([]);
    expect(selectedShas({ kind: "changes" })).toEqual([]);
    expect(selectedShas({ kind: "stash", sha: "s1" })).toEqual([]);
    expect(selectedShas({ kind: "commit", sha: "c1" })).toEqual(["c1"]);
    expect(selectedShas({ kind: "commit", sha: "c3", anchor: "c1", shas: ["c1", "c2", "c3"] })).toEqual(["c1", "c2", "c3"]);
  });

  it("extends a range from the anchor to the target row, skipping Changes and stash rows, in graph order", () => {
    const down = rangeSelection(history, "c1", 4);
    expect(down).toEqual({ kind: "commit", sha: "c3", anchor: "c1", shas: ["c1", "c2", "c3"] });
    const up = rangeSelection(history, "c4", 3);
    expect(up).toEqual({ kind: "commit", sha: "c2", anchor: "c4", shas: ["c2", "c3", "c4"] });
    expect(rangeSelection(history, "c1", 1)).toEqual({ kind: "commit", sha: "c1", anchor: "c1" });
  });

  it("refuses a range to a row that is not a commit or from an anchor that is not loaded", () => {
    expect(rangeSelection(history, "c1", 0)).toBeUndefined();
    expect(rangeSelection(history, "c1", 2)).toBeUndefined();
    expect(rangeSelection(history, "gone", 4)).toBeUndefined();
    expect(rangeSelection(history, "c1", 99)).toBeUndefined();
  });

  it("toggles a commit in and out of the selection, keeping graph order and the clicked commit as the cursor", () => {
    const first: Selection = { kind: "commit", sha: "c1" };
    const two = toggleSelection(history, first, 4);
    expect(two).toEqual({ kind: "commit", sha: "c3", anchor: "c3", shas: ["c1", "c3"] });
    const three = toggleSelection(history, two, 3);
    expect(selectedShas(three)).toEqual(["c1", "c2", "c3"]);
    const back = toggleSelection(history, three, 3);
    expect(selectedShas(back)).toEqual(["c1", "c3"]);
    const single = toggleSelection(history, back, 4);
    expect(single).toEqual({ kind: "commit", sha: "c1", anchor: "c1" });
  });

  it("starts a selection from Changes or nothing, and ignores rows that cannot be selected together", () => {
    expect(toggleSelection(history, undefined, 4)).toEqual({ kind: "commit", sha: "c3", anchor: "c3" });
    expect(toggleSelection(history, { kind: "changes" }, 4)).toEqual({ kind: "commit", sha: "c3", anchor: "c3" });
    const current: Selection = { kind: "commit", sha: "c1" };
    expect(toggleSelection(history, current, 2)).toBe(current);
    expect(toggleSelection(history, current, 0)).toBe(current);
    expect(toggleSelection(history, current, 1)).toBe(current);
  });
});
