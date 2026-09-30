import { createSignal } from "solid-js";
import { client } from "../ipc/client";
import { idleSearch, stepMatch, type SearchState } from "./searchModel";

export const SEARCH_DELAY_MS = 200;

export function createSearch(path: string, onFailure: (failure: unknown) => void, onReveal: (row: number) => void) {
  const [state, setState] = createSignal<SearchState>(idleSearch);
  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;

  const reveal = () => {
    const index = state().rows[state().position];
    if (index !== undefined) onReveal(index);
  };

  async function run(query: string): Promise<void> {
    const mine = (latest += 1);
    try {
      const found = await client.searchCommits(path, query);
      if (mine !== latest) return;
      setState({ query, rows: found.rows, total: found.total, position: 0, status: "done" });
      reveal();
    } catch (failure) {
      if (mine === latest) setState({ ...idleSearch, query });
      onFailure(failure);
    }
  }

  function setQuery(query: string): void {
    clearTimeout(timer);
    latest += 1;
    if (query.trim() === "") {
      setState({ ...idleSearch, query });
      return;
    }
    setState({ ...idleSearch, query, status: "searching" });
    timer = setTimeout(() => void run(query), SEARCH_DELAY_MS);
  }

  function move(direction: 1 | -1): void {
    const current = state();
    if (current.status !== "done" || current.rows.length === 0) return;
    setState({ ...current, position: stepMatch(current.position, current.rows.length, direction) });
    reveal();
  }

  function close(): void {
    clearTimeout(timer);
    latest += 1;
    setState(idleSearch);
    setOpen(false);
  }

  return { state, open, show: () => setOpen(true), setQuery, next: () => move(1), previous: () => move(-1), close };
}

export type Search = ReturnType<typeof createSearch>;
