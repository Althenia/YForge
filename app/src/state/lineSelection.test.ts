import { describe, expect, it } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import { extendSelection, isSelected, nextSelectable, selectionLabel, toggleLine } from "./lineSelection";

const line = (kind: DiffLine["kind"]): DiffLine => ({ kind, old_number: 1, new_number: 1, text: "x", no_newline: false });
const hunk = (kinds: DiffLine["kind"][]): DiffHunk => ({ old_start: 1, old_lines: kinds.length, new_start: 1, new_lines: kinds.length, heading: "", lines: kinds.map(line) });

const hunks = [hunk(["context", "added", "context", "removed", "added", "context"]), hunk(["removed", "added"])];

describe("toggling lines", () => {
  it("adds a line, removes it again, and clears the selection when the last line goes", () => {
    const one = toggleLine(undefined, { hunk: 0, line: 1 });
    expect(one).toEqual({ hunk: 0, lines: [1], anchor: 1 });
    const two = toggleLine(one, { hunk: 0, line: 4 });
    expect(two?.lines).toEqual([1, 4]);
    expect(toggleLine(two, { hunk: 0, line: 1 })?.lines).toEqual([4]);
    expect(toggleLine(toggleLine(undefined, { hunk: 0, line: 1 }), { hunk: 0, line: 1 })).toBeUndefined();
  });

  it("starts a new selection when the line belongs to another hunk", () => {
    const selection = toggleLine(toggleLine(undefined, { hunk: 0, line: 1 }), { hunk: 1, line: 0 });
    expect(selection).toEqual({ hunk: 1, lines: [0], anchor: 0 });
  });
});

describe("extending a selection", () => {
  it("selects every changed line from the anchor to the target and skips context", () => {
    const anchored = toggleLine(undefined, { hunk: 0, line: 1 });
    expect(extendSelection(anchored, hunks, { hunk: 0, line: 4 })).toEqual({ hunk: 0, lines: [1, 3, 4], anchor: 1 });
  });

  it("extends backwards from the anchor", () => {
    const anchored = toggleLine(undefined, { hunk: 0, line: 4 });
    expect(extendSelection(anchored, hunks, { hunk: 0, line: 1 })?.lines).toEqual([1, 3, 4]);
  });

  it("selects just the target when nothing is selected or the hunk differs", () => {
    expect(extendSelection(undefined, hunks, { hunk: 1, line: 1 })).toEqual({ hunk: 1, lines: [1], anchor: 1 });
    const other = toggleLine(undefined, { hunk: 0, line: 1 });
    expect(extendSelection(other, hunks, { hunk: 1, line: 0 })).toEqual({ hunk: 1, lines: [0], anchor: 0 });
  });
});

describe("selection queries", () => {
  it("reports membership by hunk and line", () => {
    const selection = toggleLine(undefined, { hunk: 1, line: 0 });
    expect(isSelected(selection, { hunk: 1, line: 0 })).toBe(true);
    expect(isSelected(selection, { hunk: 0, line: 0 })).toBe(false);
    expect(isSelected(undefined, { hunk: 0, line: 0 })).toBe(false);
  });

  it("counts lines in words", () => {
    expect(selectionLabel(1)).toBe("1 line selected");
    expect(selectionLabel(3)).toBe("3 lines selected");
  });
});

describe("keyboard stepping", () => {
  it("moves to the next or previous changed line across hunks and stops at the ends", () => {
    expect(nextSelectable(hunks, { hunk: 0, line: 1 }, 1)).toEqual({ hunk: 0, line: 3 });
    expect(nextSelectable(hunks, { hunk: 0, line: 4 }, 1)).toEqual({ hunk: 1, line: 0 });
    expect(nextSelectable(hunks, { hunk: 1, line: 0 }, -1)).toEqual({ hunk: 0, line: 4 });
    expect(nextSelectable(hunks, { hunk: 1, line: 1 }, 1)).toBeUndefined();
    expect(nextSelectable(hunks, { hunk: 0, line: 1 }, -1)).toBeUndefined();
  });
});
