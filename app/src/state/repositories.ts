import { keepPreviousData, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { ManagedRepo } from "../ipc/bindings/ManagedRepo";
import type { Repositories } from "../ipc/bindings/Repositories";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import { client } from "../ipc/client";
import { basename } from "../format";
import { useQuery } from "./query";
import { appKeys, launchpadKeys } from "./queryKeys";
import { removedText, rescanAllText, rescanText, stoppedText } from "./repositoriesModel";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/// What the last list change did, in text, with the change that reverses it.
export type ListChange = { text: string; undo?: () => Promise<void> };

/// The repositories YForge knows, their statuses, and the list changes that never touch the disk.
export function createRepositories() {
  const queryClient = useQueryClient();
  const list = useQuery(() => ({ queryKey: appKeys.repositories, queryFn: () => client.repositoriesList() }));
  const paths = () => (list.data?.repos ?? []).map((repo) => repo.path);
  const statuses = useQuery(() => ({
    queryKey: [...appKeys.repositories, "statuses", paths()],
    queryFn: () => client.recentStatuses(paths()),
    enabled: list.data !== undefined,
    placeholderData: keepPreviousData,
  }));
  const [change, setChange] = createSignal<ListChange | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();

  const accept = (next: Repositories) => {
    queryClient.setQueryData(appKeys.repositories, next);
    void queryClient.invalidateQueries({ queryKey: launchpadKeys.wips });
    void queryClient.invalidateQueries({ queryKey: appKeys.recents });
  };

  async function run(task: () => Promise<ListChange>): Promise<void> {
    setFailure(undefined);
    try {
      setChange(await task());
    } catch (error) {
      setFailure(message(error));
    }
  }

  const restoreFolder = (folder: ScannedFolder) => async () => {
    accept(await client.scanFolderSave(folder));
    setChange(undefined);
  };

  return {
    folders: () => list.data?.folders ?? [],
    repos: (): ManagedRepo[] => list.data?.repos ?? [],
    statuses: () => statuses.data,
    statusesUpdatedAt: (): number => Math.floor(statuses.dataUpdatedAt / 1000),
    loading: () => list.isPending,
    readFailure: () => (list.error == null ? undefined : message(list.error)),
    change,
    failure,
    dismissChange: () => setChange(undefined),
    undoChange: async (): Promise<void> => {
      const undo = change()?.undo;
      if (undo === undefined) return;
      setFailure(undefined);
      try {
        await undo();
      } catch (error) {
        setFailure(message(error));
      }
    },
    refresh: () => {
      void list.refetch();
      void statuses.refetch();
    },
    added: (next: Repositories, text: string, folder: ScannedFolder) => {
      accept(next);
      setChange({
        text,
        undo: async () => {
          const removed = await client.scanFolderRemove(folder.path);
          accept(removed.repositories);
          setChange(undefined);
        },
      });
    },
    remove: (path: string, opened: boolean) =>
      run(async () => {
        const result = await client.repositoryRemove(path);
        accept(result.repositories);
        return {
          text: removedText(basename(path), opened, result.removed.folder),
          undo: async () => {
            accept(await client.repositoryRestore(result.removed));
            setChange(undefined);
          },
        };
      }),
    removeMany: async (paths: readonly string[]): Promise<void> => {
      setFailure(undefined);
      const removed: ManagedRepo[] = [];
      const failures: string[] = [];
      for (const path of paths) {
        try {
          const result = await client.repositoryRemove(path);
          removed.push(result.removed);
          accept(result.repositories);
        } catch (error) {
          failures.push(`${path}: ${message(error)}`);
        }
      }
      if (removed.length > 0) {
        setChange({
          text: `Removed ${removed.length} ${removed.length === 1 ? "repository" : "repositories"} from the list. Nothing on disk changed.`,
          undo: async () => {
            for (const repo of removed) accept(await client.repositoryRestore(repo));
            setChange(undefined);
          },
        });
      }
      if (failures.length > 0) setFailure(`Could not remove ${failures.join("; ")}`);
    },
    rescan: (root: string) =>
      run(async () => {
        const result = await client.scanFolderRescan(root);
        accept(result.repositories);
        return { text: rescanText(root, result.added) };
      }),
    rescanAll: async (): Promise<void> => {
      setFailure(undefined);
      const folders = list.data?.folders ?? [];
      let added = 0;
      const failures: string[] = [];
      for (const folder of folders) {
        try {
          const result = await client.scanFolderRescan(folder.path);
          added += result.added.length;
          accept(result.repositories);
        } catch (error) {
          failures.push(`${folder.path}: ${message(error)}`);
        }
      }
      setChange({ text: rescanAllText(folders.length, added) });
      if (failures.length > 0) setFailure(`Could not rescan ${failures.join("; ")}`);
    },
    stopScanning: (root: string) =>
      run(async () => {
        const result = await client.scanFolderRemove(root);
        accept(result.repositories);
        const kept = result.folder.repos.filter((path) => result.repositories.repos.some((repo) => repo.path === path)).length;
        return { text: stoppedText(root, result.folder.repos.length - kept, kept), undo: restoreFolder(result.folder) };
      }),
  };
}

export type RepositoriesState = ReturnType<typeof createRepositories>;
