import { useQuery, type QueryClient } from "@tanstack/solid-query";
import { OPTIONAL_COLUMNS, type OptionalColumn, type ResizableColumn } from "../graph/columns";
import type { GraphColumn } from "../ipc/bindings/GraphColumn";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import type { RepoUiPrefs } from "../ipc/bindings/RepoUiPrefs";
import { client } from "../ipc/client";
import { dataOf } from "./queryData";
import { repoKeys } from "./queryKeys";

export const defaultUiPrefs: RepoUiPrefs = { columns: [], collapsed_folders: [], branch_visibility: { kind: "all" } };

export function columnVisibility(prefs: RepoUiPrefs): Record<OptionalColumn, boolean> {
  return Object.fromEntries(OPTIONAL_COLUMNS.map((id) => [id, prefs.columns.find((entry) => entry.column === id)?.visible === true])) as Record<OptionalColumn, boolean>;
}

export function columnWidths(prefs: RepoUiPrefs): Partial<Record<ResizableColumn, number>> {
  return Object.fromEntries(prefs.columns.flatMap((entry) => (entry.width == null ? [] : [[entry.column, entry.width]])));
}

export function withColumn(prefs: RepoUiPrefs, id: GraphColumn, change: { visible?: boolean; width?: number }): RepoUiPrefs {
  const current = prefs.columns.find((entry) => entry.column === id);
  const visible = id === "refs" ? true : (change.visible ?? current?.visible ?? false);
  const width = change.width ?? current?.width;
  const next = { column: id, visible, ...(width == null ? {} : { width }) };
  return { ...prefs, columns: current === undefined ? [...prefs.columns, next] : prefs.columns.map((entry) => (entry === current ? next : entry)) };
}

export const resetColumns = (prefs: RepoUiPrefs): RepoUiPrefs => ({ ...prefs, columns: [] });

export const toggleFolder = (prefs: RepoUiPrefs, id: string): RepoUiPrefs => ({
  ...prefs,
  collapsed_folders: prefs.collapsed_folders.includes(id) ? prefs.collapsed_folders.filter((entry) => entry !== id) : [...prefs.collapsed_folders, id],
});

export const withVisibility = (prefs: RepoUiPrefs, branch_visibility: GraphVisibility): RepoUiPrefs => ({ ...prefs, branch_visibility });

export function createRepoUiPrefs(path: string, queryClient: QueryClient, report: (failure: unknown) => void) {
  const key = repoKeys.uiPrefs(path);
  const query = useQuery(() => ({ queryKey: key, queryFn: () => client.repoUiPrefsLoad(path), staleTime: Infinity }), () => queryClient);
  let saving: Promise<unknown> = Promise.resolve();
  const prefs = (): RepoUiPrefs => dataOf(query) ?? defaultUiPrefs;
  return {
    prefs,
    update: (change: (current: RepoUiPrefs) => RepoUiPrefs): void => {
      const next = change(prefs());
      queryClient.setQueryData(key, next);
      saving = saving.then(() =>
        client.repoUiPrefsSave(path, next).catch((failure) => {
          report(failure);
          return queryClient.invalidateQueries({ queryKey: key });
        }),
      );
    },
  };
}

export type RepoUiPrefsStore = ReturnType<typeof createRepoUiPrefs>;

export const visibilityKey = (visibility: GraphVisibility): string => JSON.stringify(visibility);
