import { keepPreviousData, useQueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { ManagedRepo } from "../ipc/bindings/ManagedRepo";
import type { Repositories } from "../ipc/bindings/Repositories";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import { client } from "../ipc/client";
import { basename } from "../format";
import { useQuery } from "./query";
import { appKeys, launchpadKeys } from "./queryKeys";
import { removedText, rescanText, stoppedText } from "./repositoriesModel";

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
    rescan: (root: string) =>
      run(async () => {
        const result = await client.scanFolderRescan(root);
        accept(result.repositories);
        return { text: rescanText(root, result.added) };
      }),
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
