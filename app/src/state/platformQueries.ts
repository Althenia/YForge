import { client, type PrListState } from "../ipc/client";
import { platformKeys } from "./queryKeys";

export const platformConnectionsOptions = () => ({ queryKey: platformKeys.connections, queryFn: () => client.platformConnectionsList() });

export const matchOptions = (path: string) => ({ queryKey: platformKeys.match(path), queryFn: () => client.platformRepoMatch(path) });

export const pullsOptions = (path: string, state: PrListState, enabled: boolean) => ({
  queryKey: platformKeys.prs(path, state),
  queryFn: () => client.platformPrsList(path, state),
  enabled,
});

export const pullDetailOptions = (path: string, number: number) => ({ queryKey: platformKeys.pr(path, number), queryFn: () => client.platformPrDetail(path, number) });
