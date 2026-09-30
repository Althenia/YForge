import type { GraphRow } from "../ipc/bindings/GraphRow";

export type Reach = { start: number; covered: number; reachable: ReadonlySet<number> };

export function reachFrom(rows: ReadonlyMap<number, GraphRow>, isTip: (row: GraphRow) => boolean, start = 0): Reach {
  const reachable = new Set<number>();
  const wanted = new Set<string>();
  let index = start;
  for (let row = rows.get(index); row !== undefined; row = rows.get(++index)) {
    if (row.sha !== null && (isTip(row) || wanted.has(row.sha))) {
      reachable.add(index);
      row.parents.forEach((parent) => wanted.add(parent));
    }
  }
  return { start, covered: index, reachable };
}
