import type { QueryClient } from "@tanstack/solid-query";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";
import { appKeys, repoKeys } from "./queryKeys";

export type WorkspaceView =
  | { status: "ready"; path: string; snapshot: RepoSnapshot; info: AppInfo }
  | { status: "not_a_repository"; path: string; message: string }
  | { status: "failed"; message: string };

export const appInfoOptions = () => ({ queryKey: appKeys.info, queryFn: () => client.appInfo(), staleTime: Infinity });

export const snapshotOptions = (path: string) => ({ queryKey: repoKeys.snapshot(path), queryFn: () => client.repoOpen(path), staleTime: Infinity });

export function cachedWorktreeCount(queryClient: QueryClient, path: string): number | undefined {
  const snapshots = queryClient.getQueriesData<RepoSnapshot>({ predicate: (query) => query.queryKey.length === 3 && query.queryKey[2] === "snapshot" && query.queryKey[0] === "repo" });
  return snapshots.find(([, snapshot]) => snapshot?.worktrees.some((worktree) => worktree.path === path))?.[1]?.worktrees.length;
}

const asMessage = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function workspaceView(
  path: string,
  info: { data: AppInfo | undefined; error: unknown },
  snapshot: { data: RepoSnapshot | undefined; error: unknown },
): WorkspaceView | undefined {
  if (info.data === undefined) return info.error == null ? undefined : { status: "failed", message: asMessage(info.error) };
  if (snapshot.data !== undefined) return { status: "ready", path, snapshot: snapshot.data, info: info.data };
  if (snapshot.error == null) return undefined;
  const failure = snapshot.error;
  return failure instanceof IpcError && failure.kind === "not_a_repository"
    ? { status: "not_a_repository", path, message: failure.message }
    : { status: "failed", message: asMessage(failure) };
}
