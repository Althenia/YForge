import { createAsyncQueuer } from "@tanstack/solid-pacer";
import { useMutation, type QueryClient } from "@tanstack/solid-query";
import { useQuery } from "./query";
import { createSignal, onCleanup } from "solid-js";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";
import { repoKeys } from "./queryKeys";
import { visibilityKey } from "./repoUiPrefs";
import { snapshotOptions } from "./workspace";

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

export function createRepoSession(path: string, initial: RepoSnapshot, queryClient: QueryClient, visibility: () => GraphVisibility = () => ({ kind: "all" })) {
  const snapshot = useQuery(() => ({ ...snapshotOptions(path), initialData: initial }), () => queryClient);
  const [revision, setRevision] = createSignal(0);
  const [notice, setNotice] = createSignal<string | undefined>();
  const snapshotHash = queryClient.getQueryCache().find({ queryKey: repoKeys.snapshot(path) })?.queryHash;
  onCleanup(
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryHash !== snapshotHash) return;
      if (event.action.type === "success") setRevision((value) => value + 1);
      else if (event.action.type === "error") setNotice(asIpcError(event.action.error).message);
    }),
  );
  type Reload = { waiters: Array<() => void> };
  const reloads = createAsyncQueuer(
    async (_: Reload) => {
      await queryClient.invalidateQueries({ queryKey: repoKeys.all(path) }, { cancelRefetch: false });
    },
    {
      concurrency: 1,
      maxSize: 1,
      onSettled: (reload) => reload.waiters.forEach((resolve) => resolve()),
    },
  );

  function refresh(): Promise<void> {
    return new Promise((resolve) => {
      const reload: Reload = { waiters: [resolve] };
      if (!reloads.addItem(reload)) reloads.peekAllItems().at(-1)?.waiters.push(resolve);
    });
  }

  const mutation = useMutation(
    () => ({
      mutationFn: (action: () => Promise<unknown>) => action(),
      onSettled: refresh,
    }),
    () => queryClient,
  );

  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await mutation.mutateAsync(action);
      return true;
    } catch (failure) {
      setNotice(asIpcError(failure).message);
      return false;
    }
  }

  return {
    path,
    queryClient,
    snapshot: () => snapshot.data as RepoSnapshot,
    revision,
    notice,
    dismissNotice: () => setNotice(undefined),
    report: (failure: unknown) => setNotice(asIpcError(failure).message),
    inform: (message: string) => setNotice(message),
    refresh,
    mutate,
    read: <T>(parts: string[], load: () => Promise<T>) =>
      queryClient.fetchQuery({ queryKey: repoKeys.read(path, ...parts), queryFn: load, gcTime: 0 }),
    searchCommits: (query: string) => {
      const chosen = visibility();
      return queryClient.fetchQuery({
        queryKey: repoKeys.search(path, query, visibilityKey(chosen)),
        queryFn: () => client.searchCommits(path, query, chosen.kind === "all" ? undefined : chosen),
      });
    },
  };
}

export type RepoSession = ReturnType<typeof createRepoSession>;
