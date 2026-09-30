import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import { isChange, lineKey, selectableLines, type LineRef } from "./diffRows";

export type LineSelection = { hunk: number; lines: readonly number[]; anchor: number };

const sorted = (lines: readonly number[]): number[] => [...lines].sort((left, right) => left - right);

export function toggleLine(selection: LineSelection | undefined, ref: LineRef): LineSelection | undefined {
  if (selection === undefined || selection.hunk !== ref.hunk) return { hunk: ref.hunk, lines: [ref.line], anchor: ref.line };
  if (!selection.lines.includes(ref.line)) return { hunk: ref.hunk, lines: sorted([...selection.lines, ref.line]), anchor: ref.line };
  const rest = selection.lines.filter((line) => line !== ref.line);
  return rest.length === 0 ? undefined : { hunk: ref.hunk, lines: rest, anchor: selection.anchor };
}

export function extendSelection(selection: LineSelection | undefined, hunks: readonly DiffHunk[], ref: LineRef): LineSelection {
  const anchor = selection !== undefined && selection.hunk === ref.hunk ? selection.anchor : ref.line;
  const [from, to] = [Math.min(anchor, ref.line), Math.max(anchor, ref.line)];
  const lines = (hunks[ref.hunk]?.lines ?? []).flatMap((line, at) => (at >= from && at <= to && isChange(line) ? [at] : []));
  return { hunk: ref.hunk, lines, anchor };
}

export const isSelected = (selection: LineSelection | undefined, ref: LineRef): boolean =>
  selection !== undefined && selection.hunk === ref.hunk && selection.lines.includes(ref.line);

export const selectionLabel = (count: number): string => `${count} ${count === 1 ? "line" : "lines"} selected`;

export function nextSelectable(hunks: readonly DiffHunk[], from: LineRef, delta: 1 | -1): LineRef | undefined {
  const all = selectableLines(hunks);
  const at = all.findIndex((ref) => lineKey(ref) === lineKey(from));
  return all[at + delta];
}
