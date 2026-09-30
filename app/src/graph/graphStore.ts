import type { QueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup } from "solid-js";
import type { GraphPage } from "../ipc/bindings/GraphPage";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import { client, IpcError } from "../ipc/client";
import { repoKeys } from "../state/queryKeys";
import { visibilityKey } from "../state/repoUiPrefs";
import { edgeKey, placeRowEdges, type PlacedEdge } from "./laneArt";

export const PAGE_SIZE = 200;

type Layout = {
  total: number;
  rows: ReadonlyMap<number, GraphRow>;
  edges: ReadonlyMap<string, PlacedEdge>;
  lanes: number;
};

const emptyLayout: Layout = { total: 0, rows: new Map(), edges: new Map(), lanes: 1 };

function withPage(layout: Layout, page: number, result: GraphPage): Layout {
  const rows = new Map(layout.rows);
  const edges = new Map(layout.edges);
  let lanes = layout.lanes;
  const add = (placed: PlacedEdge) => {
    edges.set(edgeKey(placed), placed);
    lanes = Math.max(lanes, placed.column + 1, placed.edge.lane + 1);
  };
  result.carried.forEach(add);
  result.rows.forEach((row, offset) => {
    const index = page * PAGE_SIZE + offset;
    rows.set(index, row);
    placeRowEdges(index, row).forEach(add);
  });
  return { total: result.total, rows, edges, lanes };
}

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

const allBranches: GraphVisibility = { kind: "all" };

export function createGraphStore(path: string, queryClient: QueryClient, visibility: () => GraphVisibility = () => allBranches) {
  const fetchPage = (page: number): Promise<GraphPage> => {
    const chosen = visibility();
    return queryClient.fetchQuery({
      queryKey: repoKeys.graph(path, page, visibilityKey(chosen)),
      queryFn: () => client.repoGraph(path, page * PAGE_SIZE, PAGE_SIZE, chosen.kind === "all" ? undefined : chosen),
      staleTime: Infinity,
    });
  };

  const [layout, setLayout] = createSignal(emptyLayout);
  const [error, setError] = createSignal<IpcError | undefined>();
  const requested = new Set<number>();
  let epoch = 0;
  let rebuilding: Promise<void> | undefined;
  let rebuildAgain = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function loadPage(page: number): Promise<void> {
    const startedIn = epoch;
    try {
      const result = await fetchPage(page);
      if (disposed || startedIn !== epoch) return;
      setLayout(withPage(layout(), page, result));
      setError(undefined);
    } catch (failure) {
      if (disposed || startedIn !== epoch) return;
      requested.delete(page);
      setError(asIpcError(failure));
    }
  }

  function ensure(first: number, end: number): void {
    const bounded = layout().total > 0 ? Math.min(end, layout().total) : end;
    const lastPage = Math.floor(Math.max(bounded - 1, 0) / PAGE_SIZE);
    for (let page = Math.floor(first / PAGE_SIZE); page <= lastPage; page++) {
      if (requested.has(page)) continue;
      requested.add(page);
      if (rebuilding === undefined) void loadPage(page);
    }
  }

  async function load(first: number, end: number): Promise<void> {
    ensure(first, end);
    const lastPage = Math.floor(Math.max(end - 1, 0) / PAGE_SIZE);
    const pages = Array.from({ length: lastPage - Math.floor(first / PAGE_SIZE) + 1 }, (_, offset) => Math.floor(first / PAGE_SIZE) + offset);
    await Promise.all(pages.map((page) => fetchPage(page)));
    await rebuilding;
  }

  async function rebuild(): Promise<void> {
    epoch += 1;
    await queryClient.invalidateQueries({ queryKey: repoKeys.graphPages(path), refetchType: "none" });
    let next = emptyLayout;
    const loaded = new Set<number>();
    try {
      for (;;) {
        const pending = [...requested].filter((page) => !loaded.has(page)).sort((left, right) => left - right);
        if (pending.length === 0) break;
        const results = await Promise.all(pending.map((page) => fetchPage(page)));
        pending.forEach((page, position) => {
          next = withPage(next, page, results[position] as GraphPage);
          loaded.add(page);
        });
      }
      if (disposed) return;
      setLayout(next);
      setError(undefined);
    } catch (failure) {
      if (!disposed) setError(asIpcError(failure));
    }
  }

  function refresh(): Promise<void> {
    if (rebuilding !== undefined) {
      rebuildAgain = true;
      return rebuilding;
    }
    rebuilding = (async () => {
      do {
        rebuildAgain = false;
        await rebuild();
      } while (rebuildAgain && !disposed);
    })().finally(() => {
      rebuilding = undefined;
    });
    return rebuilding;
  }

  return {
    total: () => layout().total,
    rows: () => layout().rows,
    edges: () => layout().edges,
    lanes: () => layout().lanes,
    error,
    ensure,
    load,
    refresh,
  };
}
