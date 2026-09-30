import { useQuery, type QueryClient } from "@tanstack/solid-query";
import type { AppUiPrefs } from "../ipc/bindings/AppUiPrefs";
import { client } from "../ipc/client";
import { dataOf } from "./queryData";
import { appKeys } from "./queryKeys";

const RECENT_COMMAND_LIMIT = 8;

export const defaultAppUiPrefs: AppUiPrefs = { palette_recents: [], last_parent_folder: null };

export const rememberCommand = (prefs: AppUiPrefs, id: string): AppUiPrefs => ({
  ...prefs,
  palette_recents: [id, ...prefs.palette_recents.filter((entry) => entry !== id)].slice(0, RECENT_COMMAND_LIMIT),
});

export const withParentFolder = (prefs: AppUiPrefs, folder: string): AppUiPrefs => ({ ...prefs, last_parent_folder: folder });

export function createAppUiPrefs(queryClient: QueryClient, report: (failure: unknown) => void) {
  const key = appKeys.uiPrefs;
  const query = useQuery(() => ({ queryKey: key, queryFn: () => client.appUiPrefsLoad(), staleTime: Infinity, enabled: false }), () => queryClient);
  const fetch = (staleTime: number): Promise<AppUiPrefs> => queryClient.fetchQuery({ queryKey: key, queryFn: () => client.appUiPrefsLoad(), staleTime });
  const load = (): Promise<AppUiPrefs> => fetch(Infinity);
  let saving: Promise<unknown> = Promise.resolve();
  return {
    prefs: (): AppUiPrefs => dataOf(query) ?? defaultAppUiPrefs,
    load,
    ensure: (): void => void load().catch(report),
    update: (change: (current: AppUiPrefs) => AppUiPrefs): void => {
      saving = saving.then(async () => {
        try {
          const next = change(await load());
          queryClient.setQueryData(key, next);
          await client.appUiPrefsSave(next);
        } catch (failure) {
          report(failure);
          await fetch(0).catch(() => undefined);
        }
      });
    },
  };
}

export type AppUiPrefsStore = ReturnType<typeof createAppUiPrefs>;
