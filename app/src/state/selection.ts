import type { GraphRow } from "../ipc/bindings/GraphRow";

export type Selection =
  | { kind: "changes" }
  | { kind: "stash"; sha: string }
  | { kind: "pull"; number: number }
  | { kind: "commit"; sha: string; anchor?: string; shas?: readonly string[] };

export function selectionOfRow(row: GraphRow): Selection | undefined {
  if (row.kind === "changes" || row.kind === "clean_changes") return { kind: "changes" };
  if (row.sha === null) return undefined;
  return row.kind === "stash" ? { kind: "stash", sha: row.sha } : { kind: "commit", sha: row.sha };
}

const matches = (row: GraphRow, selection: Selection): boolean =>
  selection.kind === "changes" ? row.kind === "changes" || row.kind === "clean_changes" : selection.kind === "pull" ? false : row.sha === selection.sha;

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

export function selectedShas(selection: Selection | undefined): readonly string[] {
  if (selection?.kind !== "commit") return [];
  return selection.shas ?? [selection.sha];
}

const pickable = (row: GraphRow | undefined): row is GraphRow & { sha: string } => row !== undefined && row.sha !== null && (row.kind === "commit" || row.kind === "merge");

export const indexOfSha = (rows: ReadonlyMap<number, GraphRow>, sha: string): number | undefined => {
  for (const [index, row] of rows) {
    if (row.sha === sha) return index;
  }
  return undefined;
};

const commitSelection = (sha: string, anchor: string, shas: readonly string[]): Selection =>
  shas.length > 1 ? { kind: "commit", sha, anchor, shas } : { kind: "commit", sha, anchor };

export function rangeSelection(rows: ReadonlyMap<number, GraphRow>, anchor: string, cursorIndex: number): Selection | undefined {
  const cursor = rows.get(cursorIndex);
  const anchorIndex = indexOfSha(rows, anchor);
  if (!pickable(cursor) || anchorIndex === undefined) return undefined;
  const shas: string[] = [];
  for (let index = Math.min(anchorIndex, cursorIndex); index <= Math.max(anchorIndex, cursorIndex); index++) {
    const row = rows.get(index);
    if (pickable(row)) shas.push(row.sha);
  }
  return commitSelection(cursor.sha, anchor, shas);
}

export function toggleSelection(rows: ReadonlyMap<number, GraphRow>, current: Selection | undefined, index: number): Selection | undefined {
  const row = rows.get(index);
  if (!pickable(row)) return current;
  const chosen = selectedShas(current);
  if (chosen.includes(row.sha)) {
    const remaining = chosen.filter((sha) => sha !== row.sha);
    const first = remaining[0];
    return first === undefined ? current : commitSelection(first, first, remaining);
  }
  const position = (sha: string) => indexOfSha(rows, sha) ?? Number.POSITIVE_INFINITY;
  const shas = [...chosen, row.sha].sort((left, right) => position(left) - position(right));
  return commitSelection(row.sha, row.sha, shas);
}
