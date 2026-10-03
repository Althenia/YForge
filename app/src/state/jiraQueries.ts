import { keepPreviousData } from "@tanstack/solid-query";
import { client } from "../ipc/client";
import { jiraKeys } from "./queryKeys";

const FRESH_MS = 60_000;

export const jiraConnectionsOptions = () => ({ queryKey: jiraKeys.connections, queryFn: () => client.jiraConnectionsList() });

export const jiraIssuesOptions = (id: string) => ({ queryKey: jiraKeys.issues(id), queryFn: () => client.jiraMyIssues(id), staleTime: FRESH_MS });

export const issueKeysOptions = (texts: readonly string[], enabled: boolean) => ({
  queryKey: jiraKeys.keys(texts),
  queryFn: async (): Promise<Array<[string, string[]]>> => {
    const found = await client.jiraIssueKeys([...texts]);
    return texts.map((text, index) => [text, found[index] ?? []]);
  },
  enabled: enabled && texts.length > 0,
  staleTime: FRESH_MS,
  placeholderData: keepPreviousData,
});

export const issueLookupOptions = (keys: readonly string[]) => ({
  queryKey: jiraKeys.lookup(keys),
  queryFn: () => client.jiraIssuesLookup([...keys]),
  enabled: keys.length > 0,
  staleTime: FRESH_MS,
  placeholderData: keepPreviousData,
});
