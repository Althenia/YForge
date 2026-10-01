import { QueriesObserver, useQueryClient, type QueryClient, type QueryObserverOptions, type QueryObserverResult } from "@tanstack/solid-query";
import { type Accessor, createComputed, createSignal, on, onCleanup, untrack } from "solid-js";

/// Observes a list of queries whose length follows the data, one result per option in order.
export function useQueryList(options: Accessor<QueryObserverOptions[]>, queryClient?: Accessor<QueryClient>): Accessor<QueryObserverResult[]> {
  const client = queryClient?.() ?? useQueryClient();
  const defaulted = () => options().map((entry) => client.defaultQueryOptions(entry as never) as QueryObserverOptions);
  const observer = new QueriesObserver(client, untrack(defaulted));
  const [results, setResults] = createSignal<QueryObserverResult[]>(observer.getCurrentResult(), { equals: false });
  createComputed(
    on(
      defaulted,
      (next) => {
        observer.setQueries(next);
        setResults(() => observer.getCurrentResult());
      },
      { defer: true },
    ),
  );
  onCleanup(observer.subscribe((next) => setResults(() => next)));
  return results;
}
