import { createMemo } from "solid-js";
import type { LaunchpadPulls } from "../ipc/bindings/LaunchpadPulls";
import { client } from "../ipc/client";
import { createJiraIssues } from "./jiraIssues";
import type { PullSource } from "./launchpadModel";
import { platformFailure } from "./platformModel";
import { platformConnectionsOptions } from "./platformQueries";
import { useQuery } from "./query";
import { useQueryList } from "./queryList";
import { launchpadKeys } from "./queryKeys";

const FRESH_MS = 60_000;

/// Everything the Launchpad lists, read per source so one failing service never hides the others.
export function createLaunchpad() {
  const platform = useQuery(platformConnectionsOptions);
  const connections = () => platform.data ?? [];
  const results = useQueryList(() =>
    connections().map((connection) => ({ queryKey: launchpadKeys.pulls(connection.id), queryFn: () => client.platformMyPulls(connection.id), staleTime: FRESH_MS })),
  );
  const pullSources = createMemo((): PullSource[] =>
    connections().map((connection, index) => {
      const result = results()[index];
      const page = result?.data as LaunchpadPulls | undefined;
      return {
        connection,
        pulls: page?.pulls ?? [],
        total: page?.total ?? null,
        capped: page?.capped ?? false,
        loading: result === undefined || result.isFetching,
        failure: result?.error == null ? undefined : platformFailure(result.error),
        updatedAt: Math.floor((result?.dataUpdatedAt ?? 0) / 1000),
      };
    }),
  );
  const jira = createJiraIssues();
  const wips = useQuery(() => ({ queryKey: launchpadKeys.wips, queryFn: () => client.launchpadWips(), staleTime: FRESH_MS }));
  return {
    platformConnections: connections,
    platformPending: () => platform.isPending,
    pullSources,
    jira,
    wips: () => wips.data ?? [],
    wipsLoading: () => wips.isFetching,
    wipsFailure: () => (wips.error == null ? undefined : platformFailure(wips.error)),
    wipsUpdatedAt: (): number => Math.floor(wips.dataUpdatedAt / 1000),
    loading: () => pullSources().some((source) => source.loading) || jira.loading() || wips.isFetching,
    refresh: (): void => {
      results().forEach((result) => void result.refetch());
      jira.refresh();
      void wips.refetch();
    },
    retryPulls: (): void => results().forEach((result) => void (result.error == null ? undefined : result.refetch())),
  };
}

export type LaunchpadState = ReturnType<typeof createLaunchpad>;
