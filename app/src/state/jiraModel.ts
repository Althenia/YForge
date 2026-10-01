import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { JiraIssueLookup } from "../ipc/bindings/JiraIssueLookup";
import type { JiraKind } from "../ipc/bindings/JiraKind";
import type { JiraStatusCategory } from "../ipc/bindings/JiraStatusCategory";
import { relativeAge } from "../format";
import { client } from "../ipc/client";
import { boundedList } from "./fileList";

export type JiraKindCard = { kind: JiraKind; title: string; tokenLabel: string; sitePlaceholder: string; tokenPlaceholder: string; tokenHint: string };

export const JIRA_KINDS: readonly JiraKindCard[] = [
  {
    kind: "cloud",
    title: "Jira Cloud",
    tokenLabel: "API token",
    sitePlaceholder: "https://your-site.atlassian.net",
    tokenPlaceholder: "Paste the token from id.atlassian.com → Security → API tokens",
    tokenHint: "Stored in the macOS Keychain and never shown again. Data Center asks for a personal access token instead of an email and API token.",
  },
  {
    kind: "data_center",
    title: "Jira Data Center",
    tokenLabel: "Personal access token",
    sitePlaceholder: "https://jira.example.com",
    tokenPlaceholder: "Paste a personal access token from your Jira profile",
    tokenHint: "Stored in the macOS Keychain and never shown again.",
  },
];

export const jiraKindCard = (kind: JiraKind): JiraKindCard => JIRA_KINDS.find((card) => card.kind === kind) as JiraKindCard;

export type JiraField = "site" | "email" | "token";

export type JiraDraft = { kind: JiraKind; site: string; email: string; token: string };

export type JiraProblems = Partial<Record<JiraField, string>>;

export const jiraFields = (kind: JiraKind): readonly JiraField[] => (kind === "cloud" ? ["site", "email", "token"] : ["site", "token"]);

/// Asks the core which field of the draft has a problem, so the form and the save agree.
export async function jiraProblems(draft: JiraDraft): Promise<JiraProblems> {
  const entries = await Promise.all(jiraFields(draft.kind).map(async (field) => [field, (await client.jiraFieldProblem(field, draft[field])) ?? undefined] as const));
  return Object.fromEntries(entries.filter(([, problem]) => problem !== undefined)) as JiraProblems;
}

export type StatusTone = "neutral" | "info" | "ok";

export function statusTone(category: JiraStatusCategory): StatusTone {
  switch (category) {
    case "todo":
      return "neutral";
    case "in_progress":
      return "info";
    case "done":
      return "ok";
  }
}

export const issueRowLabel = (issue: Pick<JiraIssue, "key" | "summary" | "status">): string => `${issue.key} ${issue.summary}, ${issue.status}`;

export function chipTitle(key: string, lookup: JiraIssueLookup | undefined): string {
  if (lookup === undefined) return key;
  if (lookup.issue !== null) return `${key} · ${lookup.issue.summary} · ${lookup.issue.status}`;
  return lookup.failure === null ? `${key} · issue details unavailable` : `${key} · issue details unavailable: ${lookup.failure}`;
}

export function filterIssues(issues: readonly JiraIssue[], query: string): JiraIssue[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...issues];
  return issues.filter((issue) => [issue.key, issue.summary, issue.status, issue.project].some((text) => text.toLowerCase().includes(needle)));
}

/// The text a pull request is searched for issue keys in: its title and its source branch.
export const pullText = (pull: { title: string; source_ref: string }): string => `${pull.title}\n${pull.source_ref}`;

export const uniqueKeys = (lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];

export const connectionSubtitle = (connection: JiraConnection): string => `${jiraKindCard(connection.kind).title} · Connected as ${connection.display_name}`;

export const tokenNote = (connection: JiraConnection): string =>
  connection.kind === "cloud" ? `API token for ${connection.email ?? "the account"}, stored in the macOS Keychain` : "Personal access token, stored in the macOS Keychain";

export const projectsText = (connection: JiraConnection): string =>
  connection.projects.length === 0 ? "No projects visible to this account" : boundedList(connection.projects.map((project) => `${project.key} ${project.name}`), "projects", " · ");

export function loadingIssuesText(connections: readonly JiraConnection[]): string {
  const hosts = connections.map((connection) => connection.host);
  const named = hosts.length > 1 ? `${hosts.slice(0, -1).join(", ")} and ${hosts.at(-1)}` : (hosts[0] ?? "Jira");
  return `Loading issues from ${named}…`;
}

/// The host a typed site address points at, as the form shows it while connecting.
export const siteHost = (site: string): string => (site.trim().split("://").at(-1) ?? "").split("/")[0] ?? "";

/// Jira writes its offset as +0000, which not every browser engine parses; add the colon first.
export function jiraEpochSeconds(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

export type IssueFacts = { origin: string; assignee: string; updated: string };

export function issueFacts(issue: JiraIssue, connection: JiraConnection | undefined, now: number): IssueFacts {
  const project = connection?.projects.find((entry) => entry.key === issue.project)?.name;
  const updated = jiraEpochSeconds(issue.updated_at);
  const assignee = issue.assignee === null ? "Unassigned" : issue.assignee === connection?.display_name ? "Assigned to you" : `Assigned to ${issue.assignee}`;
  return {
    origin: [connection?.host, project ?? issue.project].filter((part) => part !== undefined).join(" · "),
    assignee,
    updated: updated === undefined ? "Update time unknown" : `Updated ${relativeAge(updated, now)} ago`,
  };
}
