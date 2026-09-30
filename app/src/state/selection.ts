import type { GraphRow } from "../ipc/bindings/GraphRow";

export type Selection = { kind: "changes" } | { kind: "commit"; sha: string };

export function selectionOfRow(row: GraphRow): Selection | undefined {
  if (row.kind === "changes") return { kind: "changes" };
  return row.sha === null ? undefined : { kind: "commit", sha: row.sha };
}

const matches = (row: GraphRow, selection: Selection): boolean =>
  selection.kind === "changes" ? row.kind === "changes" : row.sha === selection.sha;

export function indexOfSelection(rows: ReadonlyMap<number, GraphRow>, selection: Selection | undefined): number | undefined {
  if (selection === undefined) return undefined;
  for (const [index, row] of rows) {
    if (matches(row, selection)) return index;
  }
  return undefined;
}

export function stepIndex(current: number | undefined, step: 1 | -1, last: number): number | undefined {
  if (last < 0) return undefined;
  const from = current ?? (step > 0 ? -1 : last + 1);
  return Math.min(Math.max(from + step, 0), last);
}
