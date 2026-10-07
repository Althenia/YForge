import { isCancelledError, type QueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup } from "solid-js";
import type { GraphPage } from "../ipc/bindings/GraphPage";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import { client, IpcError } from "../ipc/client";
import { repoKeys } from "../state/queryKeys";
import { visibilityKey } from "../state/repoUiPrefs";
import { indexOfSelection, selectedShas, type Selection } from "../state/selection";
import { edgeKey, placeRowEdges, type PlacedEdge } from "./laneArt";

export const PAGE_SIZE = 200;

const PAGE_MARGIN = 1;

type Layout = {
  total: number;
  rows: Map<number, GraphRow>;
  edges: Map<string, PlacedEdge>;
  pages: Set<number>;
};

const emptyLayout = (): Layout => ({ total: 0, rows: new Map(), edges: new Map(), pages: new Set() });

function addPage(layout: Layout, page: number, result: GraphPage): void {
  const add = (placed: PlacedEdge) => {
    layout.edges.set(edgeKey(placed), placed);
  };
  result.carried.forEach(add);
  result.rows.forEach((row, offset) => {
    const index = page * PAGE_SIZE + offset;
    layout.rows.set(index, row);
    placeRowEdges(index, row).forEach(add);
  });
  layout.total = result.total;
  layout.pages.add(page);
}

const pageOf = (index: number): number => Math.floor(index / PAGE_SIZE);

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

const allBranches: GraphVisibility = { kind: "all" };

export function createGraphStore(
  path: string,
  queryClient: QueryClient,
  visibility: () => GraphVisibility = () => allBranches,
  selection: () => Selection | undefined = () => undefined,
) {
  const [pending, setPending] = createSignal(0);
  const fetchPage = async (page: number): Promise<GraphPage> => {
    const chosen = visibility();
    setPending((count) => count + 1);
    try {
      return await queryClient.fetchQuery({
        queryKey: repoKeys.graph(path, page, visibilityKey(chosen)),
        queryFn: () => client.repoGraph(path, page * PAGE_SIZE, PAGE_SIZE, chosen.kind === "all" ? undefined : chosen),
        staleTime: Infinity,
      });
    } finally {
      setPending((count) => count - 1);
    }
  };

  const [layout, setLayout] = createSignal(emptyLayout(), { equals: false });
  const [error, setError] = createSignal<IpcError | undefined>();
  const requested = new Set<number>();
  let viewport: { first: number; end: number } | undefined;
  let epoch = 0;
  let rebuilding: Promise<void> | undefined;
  let collectingPages = false;
  let rebuildAgain = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function loadPage(page: number): Promise<void> {
    const startedIn = epoch;
    const cached = queryClient.getQueryData<GraphPage>(repoKeys.graph(path, page, visibilityKey(visibility())));
    if (cached !== undefined) {
      const current = layout();
      addPage(current, page, cached);
      setLayout(current);
    }
    try {
      const result = await fetchPage(page);
      if (disposed || startedIn !== epoch) return;
      if (result === cached) {
        setError(undefined);
        return;
      }
      const current = layout();
      addPage(current, page, result);
      setLayout(current);
      setError(undefined);
    } catch (failure) {
      if (disposed || startedIn !== epoch) return;
      requested.delete(page);
      if (!isCancelledError(failure)) setError(asIpcError(failure));
    }
  }

  function ensure(first: number, end: number): void {
    const bounded = layout().total > 0 ? Math.min(end, layout().total) : end;
    const lastPage = Math.floor(Math.max(bounded - 1, 0) / PAGE_SIZE);
    for (let page = Math.floor(first / PAGE_SIZE); page <= lastPage; page++) {
      if (requested.has(page)) continue;
      requested.add(page);
      if (!collectingPages) void loadPage(page);
    }
  }

  function show(first: number, end: number): void {
    viewport = { first, end };
    ensure(first, end);
  }

  function pagesToKeep(): Set<number> {
    const { rows, total } = layout();
    const keep = new Set<number>();
    if (viewport !== undefined) {
      const lastPage = pageOf(Math.max(total - 1, 0));
      const first = Math.max(pageOf(viewport.first) - PAGE_MARGIN, 0);
      const last = Math.min(pageOf(Math.max(viewport.end - 1, viewport.first)) + PAGE_MARGIN, lastPage);
      for (let page = first; page <= last; page++) keep.add(page);
    }
    const chosen = selection();
    const primary = indexOfSelection(rows, chosen);
    if (primary !== undefined) keep.add(pageOf(primary));
    const shas = new Set(selectedShas(chosen));
    if (shas.size > 0) {
      for (const [index, row] of rows) {
        if (row.sha !== null && shas.has(row.sha)) keep.add(pageOf(index));
      }
    }
    return keep;
  }

  async function load(first: number, end: number): Promise<void> {
    ensure(first, end);
    const lastPage = Math.floor(Math.max(end - 1, 0) / PAGE_SIZE);
    const pages = Array.from({ length: lastPage - Math.floor(first / PAGE_SIZE) + 1 }, (_, offset) => Math.floor(first / PAGE_SIZE) + offset);
    await Promise.all(pages.map((page) => fetchPage(page)));
    await rebuilding;
  }

  async function rebuild(): Promise<void> {
    collectingPages = true;
    epoch += 1;
    await queryClient.invalidateQueries({ queryKey: repoKeys.graphPages(path), refetchType: "none" });
    const keep = pagesToKeep();
    for (const page of layout().pages) {
      if (!keep.has(page)) requested.delete(page);
    }
    keep.forEach((page) => requested.add(page));
    const next = emptyLayout();
    const attempted = new Set<number>();
    try {
      for (;;) {
        const pending = [...requested].filter((page) => !next.pages.has(page)).sort((left, right) => left - right);
        if (pending.length === 0) break;
        pending.forEach((page) => attempted.add(page));
        const results = await Promise.all(pending.map((page) => fetchPage(page)));
        pending.forEach((page, position) => addPage(next, page, results[position] as GraphPage));
      }
      if (disposed) return;
      collectingPages = false;
      setLayout(next);
      setError(undefined);
    } catch (failure) {
      if (!disposed) {
        for (const page of attempted) {
          if (!layout().pages.has(page)) requested.delete(page);
        }
        if (!isCancelledError(failure)) setError(asIpcError(failure));
      }
    }
  }

  function refresh(): Promise<void> {
    if (rebuilding !== undefined) {
      rebuildAgain = true;
      return rebuilding;
    }
    setPending((count) => count + 1);
    rebuilding = (async () => {
      do {
        rebuildAgain = false;
        await rebuild();
      } while (rebuildAgain && !disposed);
    })().finally(() => {
      collectingPages = false;
      rebuilding = undefined;
      if (!disposed) {
        for (const page of requested) {
          if (!layout().pages.has(page)) void loadPage(page);
        }
      }
      setPending((count) => count - 1);
    });
    return rebuilding;
  }

  return {
    total: () => layout().total,
    rows: () => layout().rows,
    edges: () => layout().edges,
    error,
    loading: () => pending() > 0,
    ensure,
    show,
    load,
    refresh,
  };
}
