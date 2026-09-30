export type SearchState = {
  query: string;
  rows: readonly number[];
  total: number;
  position: number;
  status: "idle" | "searching" | "done";
};

export const idleSearch: SearchState = { query: "", rows: [], total: 0, position: 0, status: "idle" };

export function stepMatch(position: number, count: number, direction: 1 | -1): number {
  return count === 0 ? 0 : (position + direction + count) % count;
}

export function searchLabel(state: SearchState): string {
  if (state.query.trim() === "") return "";
  if (state.status === "searching") return "Searching…";
  if (state.rows.length === 0) return "No commits match";
  return `${state.position + 1} of ${state.rows.length}`;
}

export const searchFootnote = (state: SearchState): string =>
  state.status === "done" && state.query.trim() !== "" ? `Searched all ${state.total.toLocaleString("en-US")} commits` : "";

export const isDimmed = (state: SearchState, matches: ReadonlySet<number>, row: number): boolean =>
  state.query.trim() !== "" && state.status === "done" && !matches.has(row);
