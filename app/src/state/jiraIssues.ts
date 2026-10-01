import { createMemo } from "solid-js";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { JiraIssueList } from "../ipc/bindings/JiraIssueList";
import type { JiraIssueLookup } from "../ipc/bindings/JiraIssueLookup";
import { jiraConnectionsOptions, issueKeysOptions, issueLookupOptions, jiraIssuesOptions } from "./jiraQueries";
import { uniqueKeys } from "./jiraModel";
import { cappedText, countOf, type Paged } from "./listCount";
import { platformFailure, type PlatformFailure } from "./platformModel";
import { useQuery } from "./query";
import { useQueryList } from "./queryList";

export type JiraSource = Paged & { connection: JiraConnection; issues: JiraIssue[]; loading: boolean; failure: PlatformFailure | undefined; updatedAt: number };

/// The issues assigned to the user, one source per Jira connection so a failing site never hides the others.
export function createJiraIssues() {
  const connections = useQuery(jiraConnectionsOptions);
  const list = (): JiraConnection[] => connections.data ?? [];
  const results = useQueryList(() => list().map((connection) => jiraIssuesOptions(connection.id)));
  const sources = createMemo((): JiraSource[] =>
    list().map((connection, index) => {
      const result = results()[index];
      const page = result?.data as JiraIssueList | undefined;
      return {
        connection,
        issues: page?.issues ?? [],
        total: page?.total ?? null,
        capped: page?.capped ?? false,
        loading: result === undefined || result.isFetching,
        failure: result?.error == null ? undefined : platformFailure(result.error),
        updatedAt: Math.floor((result?.dataUpdatedAt ?? 0) / 1000),
      };
    }),
  );
  return {
    connections: list,
    connected: () => list().length > 0,
    sources,
    issues: (): JiraIssue[] => sources().flatMap((source) => source.issues),
    total: (): number => sources().reduce((sum, source) => sum + countOf(source.issues.length, source), 0),
    cappedNotes: (): string[] => sources().flatMap((source) => (cappedText(source) === undefined ? [] : [`${source.connection.host}: ${cappedText(source)}`])),
    loading: () => sources().some((source) => source.loading),
    refresh: () => results().forEach((result) => void result.refetch()),
  };
}

export type JiraIssuesState = ReturnType<typeof createJiraIssues>;

export type JiraSidebar = { state: JiraIssuesState; chips: IssueChips; select: (key: string) => void; openSettings: () => void; openInBrowser: (issue: Pick<JiraIssue, "web_url">) => void };

/// The issue keys inside each text (known projects only) and what the sites say about them.
export function createIssueChips(texts: () => readonly string[]) {
  const connections = useQuery(jiraConnectionsOptions);
  const connected = () => (connections.data ?? []).length > 0;
  const found = useQuery(() => issueKeysOptions(texts(), connected()));
  const keys = createMemo(() => uniqueKeys(found.data ?? []));
  const lookups = useQuery(() => issueLookupOptions(keys()));
  const byKey = createMemo(() => new Map((lookups.data ?? []).map((lookup): [string, JiraIssueLookup] => [lookup.key, lookup])));
  const byText = createMemo(() => new Map(texts().map((text, index): [string, readonly string[]] => [text, found.data?.[index] ?? []])));
  return {
    keysFor: (text: string): readonly string[] => byText().get(text) ?? [],
    lookup: (key: string): JiraIssueLookup | undefined => byKey().get(key),
  };
}

export type IssueChips = ReturnType<typeof createIssueChips>;
