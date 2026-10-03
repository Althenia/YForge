import { createSignal } from "solid-js";
import { useApp } from "./app";
import { withFileListMode } from "./appUiPrefs";
import { folderPaths, type FileListMode } from "./fileTree";

const NAMED_ITEMS = 3;

export function boundedList(items: readonly string[], noun: string, separator = ", "): string {
  if (items.length <= NAMED_ITEMS) return items.join(separator);
  return `${items.length} ${noun}: ${items.slice(0, NAMED_ITEMS).join(separator)} and ${items.length - NAMED_ITEMS} more`;
}

export const fileList = (paths: string[]): string => boundedList(paths, "files");

export function useFileListMode() {
  const app = useApp();
  app.uiPrefs.ensure();
  return {
    mode: (): FileListMode => app.uiPrefs.prefs().file_list_mode,
    choose: (next: FileListMode): void => app.uiPrefs.update((prefs) => withFileListMode(prefs, next)),
  };
}

const folderKey = (scope: string, folder: string): string => `${scope}\u0000${folder}`;

export function createFolderState() {
  const [closed, setClosed] = createSignal<ReadonlySet<string>>(new Set());
  const keysOf = (lists: ReadonlyArray<{ scope: string; paths: readonly string[] }>) => lists.flatMap((list) => folderPaths(list.paths).map((folder) => folderKey(list.scope, folder)));
  return {
    isOpen: (scope: string) => (folder: string) => !closed().has(folderKey(scope, folder)),
    toggle: (scope: string, folder: string, open?: boolean) => {
      const key = folderKey(scope, folder);
      const next = new Set(closed());
      if (open ?? next.has(key)) next.delete(key);
      else next.add(key);
      setClosed(next);
    },
    folders: (lists: ReadonlyArray<{ scope: string; paths: readonly string[] }>) => keysOf(lists).length,
    anyClosed: (lists: ReadonlyArray<{ scope: string; paths: readonly string[] }>) => keysOf(lists).some((key) => closed().has(key)),
    collapseAll: (lists: ReadonlyArray<{ scope: string; paths: readonly string[] }>) => setClosed(new Set([...closed(), ...keysOf(lists)])),
    expandAll: () => setClosed(new Set<string>()),
  };
}

export type FolderState = ReturnType<typeof createFolderState>;
