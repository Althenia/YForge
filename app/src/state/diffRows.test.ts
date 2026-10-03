import { describe, expect, it } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import { changeStops, hunkRows, inlineRows, lineKey, rowIndex, selectableLines, splitRows, widestLine, wordMarks } from "./diffRows";

const line = (kind: DiffLine["kind"], text: string, no_newline = false): DiffLine => ({
  kind,
  old_number: kind === "added" ? null : 1,
  new_number: kind === "removed" ? null : 1,
  text,
  no_newline,
});

const make = (old_start: number, old_lines: number, lines: DiffLine[]): DiffHunk => ({ old_start, old_lines, new_start: old_start, new_lines: old_lines, heading: "", lines });

const first = make(3, 5, [line("context", "a"), line("removed", "old one"), line("removed", "old two"), line("added", "new one"), line("context", "b")]);
const second = make(20, 3, [line("context", "c"), line("added", "extra"), line("context", "d")]);

describe("hunk rows", () => {
  it("adds a note row after a line that lacks a final newline", () => {
    const hunk = make(1, 0, [line("added", "a"), line("added", "b", true)]);
    expect(hunkRows(hunk, 0).map((row) => row.kind)).toEqual(["line", "line", "note"]);
  });

  it("references each line by hunk and line index", () => {
    const rows = hunkRows(second, 1);
    expect(rows[1]).toMatchObject({ kind: "line", cell: { ref: { hunk: 1, line: 1 } } });
  });
});

describe("inline rows", () => {
  it("lists a gap of unchanged lines before each hunk and a head row per hunk", () => {
    const rows = inlineRows([first, second]);
    expect(rows.filter((row) => row.kind === "gap")).toEqual([
      { kind: "gap", hidden: 2 },
      { kind: "gap", hidden: 12 },
    ]);
    expect(rows.filter((row) => row.kind === "head")).toEqual([
      { kind: "head", hunk: 0 },
      { kind: "head", hunk: 1 },
    ]);
    expect(rows.filter((row) => row.kind === "line")).toHaveLength(8);
  });

  it("shows no gap when a hunk starts at line one", () => {
    expect(inlineRows([make(1, 1, [line("context", "x")])]).some((row) => row.kind === "gap")).toBe(false);
  });
});

describe("split rows", () => {
  it("aligns a removed run with the added run beside it and pads the shorter side", () => {
    const rows = splitRows([first]).filter((row) => row.kind === "pair");
    expect(rows.map((row) => [row.left?.line.text, row.right?.line.text])).toEqual([
      ["a", "a"],
      ["old one", "new one"],
      ["old two", undefined],
      ["b", "b"],
    ]);
  });

  it("puts a lone addition on the right with an empty left cell", () => {
    const rows = splitRows([second]).filter((row) => row.kind === "pair");
    expect(rows[1]).toMatchObject({ left: undefined, right: { ref: { hunk: 0, line: 1 } } });
  });

  it("puts a note row on the side that lacks the final newline", () => {
    const hunk = make(1, 1, [line("removed", "a", true), line("added", "b")]);
    expect(splitRows([hunk]).find((row) => row.kind === "note")).toEqual({ kind: "note", side: "old" });
  });
});

describe("row lookup", () => {
  it("maps every line of a flat mode to its row index, on both cells of a split row", () => {
    const rows = splitRows([first]);
    const index = rowIndex(rows);
    expect(index.get(lineKey({ hunk: 0, line: 1 }))).toBe(index.get(lineKey({ hunk: 0, line: 3 })));
    expect(index.get(lineKey({ hunk: 0, line: 2 }))).toBe((index.get(lineKey({ hunk: 0, line: 1 })) ?? 0) + 1);
  });
});

describe("change navigation", () => {
  it("lists the first changed line of each contiguous block across hunks", () => {
    expect(changeStops([first, second])).toEqual([
      { hunk: 0, line: 1 },
      { hunk: 1, line: 1 },
    ]);
  });

  it("starts a new block after a context line", () => {
    const hunk = make(1, 5, [line("added", "a"), line("added", "b"), line("context", "c"), line("removed", "d")]);
    expect(changeStops([hunk])).toEqual([
      { hunk: 0, line: 0 },
      { hunk: 0, line: 3 },
    ]);
  });

  it("lists only added and removed lines as selectable", () => {
    expect(selectableLines([first]).map((ref) => ref.line)).toEqual([1, 2, 3]);
  });
});

describe("word marks", () => {
  it("pairs a removed run with the added run that follows it, line by line", () => {
    const hunk = make(1, 2, [line("removed", "let n = 3;"), line("added", "let n = 4;")]);
    const marks = wordMarks(hunk);
    expect(marks.get(0)).toEqual([[8, 9]]);
    expect(marks.get(1)).toEqual([[8, 9]]);
  });

  it("leaves unpaired lines and context unmarked", () => {
    const marks = wordMarks(first);
    expect(marks.has(0)).toBe(false);
    expect(marks.has(2)).toBe(false);
    expect(marks.has(1)).toBe(true);
    expect(marks.has(3)).toBe(true);
  });

  it("marks nothing for a pure addition", () => {
    expect(wordMarks(second).size).toBe(0);
  });
});

describe("widest line", () => {
  it("measures the longest code line in characters, with tabs at eight columns, so every row can share its width", () => {
    expect(widestLine([first, second])).toBe("old one".length);
    expect(widestLine([make(1, 1, [line("added", "\tx"), line("context", "ab\tc")])])).toBe(9);
    expect(widestLine([])).toBe(0);
  });
});
