import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import { wordChanges, type Range } from "./wordDiff";

export type LineRef = { hunk: number; line: number };

export type Cell = { ref: LineRef; line: DiffLine };

export type NoteSide = "old" | "new" | "both";

export type DiffRow =
  | { kind: "head"; hunk: number }
  | { kind: "gap"; hidden: number }
  | { kind: "line"; cell: Cell }
  | { kind: "pair"; left: Cell | undefined; right: Cell | undefined }
  | { kind: "note"; side: NoteSide };

export const lineKey = (ref: LineRef): string => `${ref.hunk}:${ref.line}`;

export const isChange = (line: DiffLine): boolean => line.kind !== "context";

const noteSide = (line: DiffLine): NoteSide => (line.kind === "removed" ? "old" : line.kind === "added" ? "new" : "both");

export const hunkRows = (hunk: DiffHunk, index: number): DiffRow[] =>
  hunk.lines.flatMap((line, at): DiffRow[] => {
    const row: DiffRow = { kind: "line", cell: { ref: { hunk: index, line: at }, line } };
    return line.no_newline ? [row, { kind: "note", side: noteSide(line) }] : [row];
  });

function hiddenBefore(hunks: readonly DiffHunk[], index: number): number {
  const hunk = hunks[index];
  const previous = hunks[index - 1];
  if (hunk === undefined) return 0;
  return hunk.old_start - (previous === undefined ? 1 : previous.old_start + previous.old_lines);
}

function withHeads(hunks: readonly DiffHunk[], body: (hunk: DiffHunk, index: number) => DiffRow[]): DiffRow[] {
  return hunks.flatMap((hunk, index): DiffRow[] => {
    const hidden = hiddenBefore(hunks, index);
    return [...(hidden > 0 ? [{ kind: "gap" as const, hidden }] : []), { kind: "head", hunk: index }, ...body(hunk, index)];
  });
}

export const inlineRows = (hunks: readonly DiffHunk[]): DiffRow[] => withHeads(hunks, hunkRows);

function splitBody(hunk: DiffHunk, index: number): DiffRow[] {
  const rows: DiffRow[] = [];
  let removed: Cell[] = [];
  let added: Cell[] = [];
  const flush = () => {
    for (let at = 0; at < Math.max(removed.length, added.length); at += 1) rows.push({ kind: "pair", left: removed[at], right: added[at] });
    for (const cell of [...removed, ...added]) if (cell.line.no_newline) rows.push({ kind: "note", side: noteSide(cell.line) });
    removed = [];
    added = [];
  };
  hunk.lines.forEach((line, at) => {
    const cell: Cell = { ref: { hunk: index, line: at }, line };
    if (line.kind === "removed") {
      if (added.length > 0) flush();
      removed.push(cell);
    } else if (line.kind === "added") added.push(cell);
    else {
      flush();
      rows.push({ kind: "pair", left: cell, right: cell });
      if (line.no_newline) rows.push({ kind: "note", side: "both" });
    }
  });
  flush();
  return rows;
}

export const splitRows = (hunks: readonly DiffHunk[]): DiffRow[] => withHeads(hunks, splitBody);

export function rowIndex(rows: readonly DiffRow[]): Map<string, number> {
  const index = new Map<string, number>();
  rows.forEach((row, at) => {
    if (row.kind === "line") index.set(lineKey(row.cell.ref), at);
    else if (row.kind === "pair") for (const cell of [row.left, row.right]) if (cell !== undefined) index.set(lineKey(cell.ref), at);
  });
  return index;
}

export const selectableLines = (hunks: readonly DiffHunk[]): LineRef[] =>
  hunks.flatMap((hunk, index) => hunk.lines.flatMap((line, at) => (isChange(line) ? [{ hunk: index, line: at }] : [])));

export function changeStops(hunks: readonly DiffHunk[]): LineRef[] {
  return hunks.flatMap((hunk, index) =>
    hunk.lines.flatMap((line, at) => {
      const prior = hunk.lines[at - 1];
      return isChange(line) && (prior === undefined || !isChange(prior)) ? [{ hunk: index, line: at }] : [];
    }),
  );
}

export function wordMarks(hunk: DiffHunk): Map<number, Range[]> {
  const marks = new Map<number, Range[]>();
  let at = 0;
  while (at < hunk.lines.length) {
    const removed: number[] = [];
    const added: number[] = [];
    while (hunk.lines[at]?.kind === "removed") removed.push(at++);
    while (hunk.lines[at]?.kind === "added") added.push(at++);
    if (removed.length === 0 && added.length === 0) {
      at += 1;
      continue;
    }
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair += 1) {
      const before = removed[pair] as number;
      const after = added[pair] as number;
      const changes = wordChanges(hunk.lines[before]?.text ?? "", hunk.lines[after]?.text ?? "");
      if (changes.removed.length > 0) marks.set(before, changes.removed);
      if (changes.added.length > 0) marks.set(after, changes.added);
    }
  }
  return marks;
}

const TAB_COLUMNS = 8;

const columns = (text: string): number => {
  let width = 0;
  for (const char of text) width = char === "\t" ? width + TAB_COLUMNS - (width % TAB_COLUMNS) : width + 1;
  return width;
};

/// The longest code line of the hunks in character columns, so every diff row can share the widest row's width.
export const widestLine = (hunks: readonly DiffHunk[]): number => hunks.reduce((widest, hunk) => hunk.lines.reduce((most, line) => Math.max(most, columns(line.text)), widest), 0);
