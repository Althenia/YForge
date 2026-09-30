import { describe, expect, it } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import { indexOfSelection, selectionOfRow, stepIndex } from "./selection";

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
    expect(selectionOfRow(row("stash", "123"))).toEqual({ kind: "commit", sha: "123" });
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
});
