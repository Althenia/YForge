import { client } from "../ipc/client";
import { jiraKeys } from "./queryKeys";

const FRESH_MS = 60_000;

export const jiraConnectionsOptions = () => ({ queryKey: jiraKeys.connections, queryFn: () => client.jiraConnectionsList() });

export const jiraIssuesOptions = (id: string) => ({ queryKey: jiraKeys.issues(id), queryFn: () => client.jiraMyIssues(id), staleTime: FRESH_MS });

export const issueKeysOptions = (texts: readonly string[], enabled: boolean) => ({
  queryKey: jiraKeys.keys(texts),
  queryFn: () => client.jiraIssueKeys([...texts]),
  enabled: enabled && texts.length > 0,
  staleTime: FRESH_MS,
});

export const issueLookupOptions = (keys: readonly string[]) => ({
  queryKey: jiraKeys.lookup(keys),
  queryFn: () => client.jiraIssuesLookup([...keys]),
  enabled: keys.length > 0,
  staleTime: FRESH_MS,
});
