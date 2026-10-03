import { type QueryClient } from "@tanstack/solid-query";
import { useQuery } from "./query";
import type { AppUiPrefs } from "../ipc/bindings/AppUiPrefs";
import type { FileListMode } from "../ipc/bindings/FileListMode";
import { client } from "../ipc/client";
import { appKeys } from "./queryKeys";

const RECENT_COMMAND_LIMIT = 8;

export const ZOOM_STEPS = [80, 90, 100, 110, 125, 140, 150, 175, 200] as const;

export const DEFAULT_ZOOM_PERCENT = 100;

export const defaultAppUiPrefs: AppUiPrefs = {
  palette_recents: [],
  last_parent_folder: null,
  file_list_mode: "path",
  zoom_percent: DEFAULT_ZOOM_PERCENT,
  sidebar_hidden: false,
  inspector_hidden: false,
  syntax_highlighting: true,
};

export type ZoomMove = "in" | "out" | "reset";

export function steppedZoom(percent: number, move: ZoomMove): number {
  if (move === "reset") return DEFAULT_ZOOM_PERCENT;
  const index = ZOOM_STEPS.findIndex((step) => step >= percent);
  const here = index < 0 ? ZOOM_STEPS.length - 1 : index;
  const next = move === "in" ? (ZOOM_STEPS[here] === percent ? here + 1 : here) : here - 1;
  return ZOOM_STEPS[Math.min(Math.max(next, 0), ZOOM_STEPS.length - 1)] ?? DEFAULT_ZOOM_PERCENT;
}

export const zoomBlockReason = (percent: number, move: ZoomMove): string | undefined => {
  if (move === "reset") return percent === DEFAULT_ZOOM_PERCENT ? "Already at 100%" : undefined;
  if (move === "in") return percent >= (ZOOM_STEPS.at(-1) ?? DEFAULT_ZOOM_PERCENT) ? `Already at ${percent}%, the largest size` : undefined;
  return percent <= (ZOOM_STEPS[0] ?? DEFAULT_ZOOM_PERCENT) ? `Already at ${percent}%, the smallest size` : undefined;
};

export const withZoom = (prefs: AppUiPrefs, move: ZoomMove): AppUiPrefs => ({ ...prefs, zoom_percent: steppedZoom(prefs.zoom_percent, move) });

export const withSidebarToggled = (prefs: AppUiPrefs): AppUiPrefs => ({ ...prefs, sidebar_hidden: !prefs.sidebar_hidden });

export const withInspectorToggled = (prefs: AppUiPrefs): AppUiPrefs => ({ ...prefs, inspector_hidden: !prefs.inspector_hidden });

export const withSyntaxToggled = (prefs: AppUiPrefs): AppUiPrefs => ({ ...prefs, syntax_highlighting: !prefs.syntax_highlighting });

export const rememberCommand = (prefs: AppUiPrefs, id: string): AppUiPrefs => ({
  ...prefs,
  palette_recents: [id, ...prefs.palette_recents.filter((entry) => entry !== id)].slice(0, RECENT_COMMAND_LIMIT),
});

export const withParentFolder = (prefs: AppUiPrefs, folder: string): AppUiPrefs => ({ ...prefs, last_parent_folder: folder });

export const withFileListMode = (prefs: AppUiPrefs, mode: FileListMode): AppUiPrefs => ({ ...prefs, file_list_mode: mode });

export function createAppUiPrefs(queryClient: QueryClient, report: (failure: unknown) => void) {
  const key = appKeys.uiPrefs;
  const query = useQuery(() => ({ queryKey: key, queryFn: () => client.appUiPrefsLoad(), staleTime: Infinity, enabled: false }), () => queryClient);
  const fetch = (staleTime: number): Promise<AppUiPrefs> => queryClient.fetchQuery({ queryKey: key, queryFn: () => client.appUiPrefsLoad(), staleTime });
  const load = (): Promise<AppUiPrefs> => fetch(Infinity);
  let saving: Promise<unknown> = Promise.resolve();
  return {
    prefs: (): AppUiPrefs => query.data ?? defaultAppUiPrefs,
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
