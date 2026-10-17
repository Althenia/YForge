import { createDebouncer } from "@tanstack/solid-pacer";
import { createSignal } from "solid-js";
import type { SearchResult } from "../ipc/bindings/SearchResult";
import { idleSearch, stepMatch, type SearchState } from "./searchModel";

export const SEARCH_DELAY_MS = 200;

export function createSearch(find: (query: string) => Promise<SearchResult>, onFailure: (failure: unknown) => void, onReveal: (row: number) => void) {
  const [state, setState] = createSignal<SearchState>(idleSearch);
  const [open, setOpen] = createSignal(false);
  let latest = 0;

  const reveal = () => {
    const index = state().rows[state().position];
    if (index !== undefined) onReveal(index);
  };

  async function run(query: string, keep = false): Promise<void> {
    const mine = (latest += 1);
    try {
      const found = await find(query);
      if (mine !== latest) return;
      const position = keep ? Math.min(state().position, Math.max(found.rows.length - 1, 0)) : 0;
      setState({ query, rows: found.rows, total: found.total, position, status: "done" });
      if (!keep) reveal();
    } catch (failure) {
      if (mine === latest) setState({ ...idleSearch, query });
      onFailure(failure);
    }
  }

  const pause = createDebouncer((query: string) => void run(query), { wait: SEARCH_DELAY_MS });

  function setQuery(query: string): void {
    pause.cancel();
    latest += 1;
    if (query.trim() === "") {
      setState({ ...idleSearch, query });
      return;
    }
    setState({ ...idleSearch, query, status: "searching" });
    pause.maybeExecute(query);
  }

  function move(direction: 1 | -1): void {
    const current = state();
    if (current.status !== "done" || current.rows.length === 0) return;
    setState({ ...current, position: stepMatch(current.position, current.rows.length, direction) });
    reveal();
  }

  function refresh(): void {
    const current = state();
    if (!open() || current.query.trim() === "" || current.status === "searching") return;
    pause.cancel();
    void run(current.query, true);
  }

  function close(): void {
    pause.cancel();
    latest += 1;
    setState(idleSearch);
    setOpen(false);
  }

  return { state, open, show: () => setOpen(true), setQuery, next: () => move(1), previous: () => move(-1), refresh, close };
}

export type Search = ReturnType<typeof createSearch>;
