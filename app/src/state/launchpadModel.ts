import type { IconName } from "../iconNames";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { LaunchpadPull } from "../ipc/bindings/LaunchpadPull";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { PullRole } from "../ipc/bindings/PullRole";
import type { Wip } from "../ipc/bindings/Wip";
import { relativeAge } from "../format";
import { filterIssues } from "./jiraModel";
import type { JiraSource } from "./jiraIssues";
import { cappedText, countOf, type Paged } from "./listCount";
import { cardOfPlatform, type PlatformFailure } from "./platformModel";

export type LaunchpadTab = "repos" | "pulls" | "issues" | "wips";

export const LAUNCHPAD_TABS: ReadonlyArray<{ id: LaunchpadTab; label: string }> = [
  { id: "repos", label: "Repositories" },
  { id: "pulls", label: "My pull requests" },
  { id: "issues", label: "My issues" },
  { id: "wips", label: "WIPs" },
];

export const ALL_SOURCES = "all";

export type PullSource = Paged & { connection: PlatformConnection; pulls: LaunchpadPull[]; loading: boolean; failure: PlatformFailure | undefined; updatedAt: number };

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/// How a connection is named in status lines: its host, with its own name when that adds something.
export function sourceName(connection: Pick<PlatformConnection, "host" | "name" | "kind">): string {
  const generic = connection.name === cardOfPlatform(connection.kind).title || connection.name === connection.host;
  return generic ? connection.host : `${connection.host} (${connection.name})`;
}

const includes = (query: string, ...texts: readonly string[]): boolean => {
  const needle = query.trim().toLowerCase();
  return needle === "" || texts.some((text) => text.toLowerCase().includes(needle));
};

export function visiblePulls(sources: readonly PullSource[], query: string, source: string): LaunchpadPull[] {
  return sources
    .filter((entry) => source === ALL_SOURCES || entry.connection.id === source)
    .flatMap((entry) => entry.pulls)
    .filter((pull) => includes(query.replace(/^#/, ""), String(pull.pull.number), pull.pull.title, `${pull.repo.owner}/${pull.repo.repo}`, pull.pull.source_ref, pull.pull.target_ref));
}

export type PullGroup = { role: PullRole; heading: string; pulls: LaunchpadPull[] };

const PULL_HEADINGS: Record<PullRole, string> = { review_requested: "Waiting for your review", authored: "Authored by you" };

export function groupPulls(pulls: readonly LaunchpadPull[]): PullGroup[] {
  return (["review_requested", "authored"] as const)
    .map((role) => ({ role, pulls: pulls.filter((pull) => pull.role === role) }))
    .filter((group) => group.pulls.length > 0)
    .map((group) => ({ ...group, heading: `${PULL_HEADINGS[group.role]} · ${group.pulls.length}` }));
}

export function visibleIssues(sources: readonly JiraSource[], query: string, source: string): JiraIssue[] {
  const issues = sources.filter((entry) => source === ALL_SOURCES || entry.connection.id === source).flatMap((entry) => entry.issues);
  return filterIssues(issues, query);
}

export const visibleWips = (wips: readonly Wip[], query: string): Wip[] => wips.filter((wip) => includes(query, wip.name, wip.path, wip.branch ?? ""));

export type SourceChoice = { value: string; label: string; hint?: string };

export function sourceChoices(tab: LaunchpadTab, platform: readonly PlatformConnection[], jira: readonly JiraConnection[]): SourceChoice[] {
  const all: SourceChoice = { value: ALL_SOURCES, label: "All sources" };
  if (tab === "pulls") return [all, ...platform.map((connection) => ({ value: connection.id, label: sourceName(connection), hint: cardOfPlatform(connection.kind).title }))];
  if (tab === "issues") return [all, ...jira.map((connection) => ({ value: connection.id, label: connection.host, hint: connection.display_name }))];
  return [all];
}

export type SourceLine = { id: string; state: "loading" | "done" | "failed"; text: string };

type SourceStatus = { id: string; name: string; loading: boolean; failure: PlatformFailure | undefined; updatedAt: number; done: string };

/// One status line per source: its name, when its rows were last read (never another source's time), then what it is doing.
function sourceLine(source: SourceStatus, now: number): SourceLine {
  const stamp = source.updatedAt > 0 ? ` · updated ${relativeAge(source.updatedAt, now)} ago` : "";
  const head = `${source.name}${stamp}`;
  if (source.loading) return { id: source.id, state: "loading", text: `${head} · reading …` };
  if (source.failure !== undefined) return { id: source.id, state: "failed", text: `${head} · could not be read: ${source.failure.message}` };
  return { id: source.id, state: "done", text: `${head} · ${source.done}` };
}

const withCap = (text: string, paged: Paged): string => {
  const capped = cappedText(paged);
  return capped === undefined ? text : `${text} · ${capped}`;
};

export const pullSourceLines = (sources: readonly PullSource[], now: number): SourceLine[] =>
  sources.map((entry) =>
    sourceLine({ id: entry.connection.id, name: sourceName(entry.connection), loading: entry.loading, failure: entry.failure, updatedAt: entry.updatedAt, done: withCap(plural(countOf(entry.pulls.length, entry), "pull request", "pull requests"), entry) }, now),
  );

export const issueSourceLines = (sources: readonly JiraSource[], now: number): SourceLine[] =>
  sources.map((entry) =>
    sourceLine({ id: entry.connection.id, name: entry.connection.host, loading: entry.loading, failure: entry.failure, updatedAt: entry.updatedAt, done: withCap(plural(countOf(entry.issues.length, entry), "issue", "issues"), entry) }, now),
  );

export const wipSourceLine = (wips: { count: number; loading: boolean; failure: PlatformFailure | undefined; updatedAt: number }, now: number): SourceLine =>
  sourceLine({ id: "wips", name: "Recent repositories", loading: wips.loading, failure: wips.failure, updatedAt: wips.updatedAt, done: plural(wips.count, "repository", "repositories") }, now);

/// The count shown on a tab: the number of rows, or an ellipsis while no source has answered.
export const countText = (rows: number, loading: boolean): string => (loading && rows === 0 ? "…" : String(rows));

export type PullBadge = { label: string; tone: "attention" | "neutral" | "ok"; icon?: IconName };

export function pullBadge(pull: LaunchpadPull): PullBadge {
  if (pull.role === "review_requested") return { label: "Review requested", tone: "attention" };
  if (pull.draft) return { label: "Draft", tone: "neutral" };
  return { label: "Open", tone: "ok", icon: "pullrequest" };
}

export const pullRowLabel = (pull: LaunchpadPull): string =>
  `Pull request #${pull.pull.number}: ${pull.pull.title}, ${pull.repo.owner}/${pull.repo.repo}, ${pull.pull.source_ref} to ${pull.pull.target_ref}, ${pullBadge(pull).label}`;

export function wipSummary(wip: Wip): string {
  if (wip.unreadable !== null) return `Could not read status: ${wip.unreadable}`;
  const parts = [];
  if (wip.changes > 0) parts.push(`${plural(wip.changes, "uncommitted change", "uncommitted changes")}`);
  if (wip.unpushed > 0) parts.push(`${plural(wip.unpushed, "unpushed commit", "unpushed commits")}`);
  return parts.join(" · ");
}

export const MISSING_PULL_SERVICES: ReadonlyArray<{ kind: PlatformConnection["kind"]; label: string }> = [
  { kind: "github", label: "Connect GitHub" },
  { kind: "gitlab", label: "Connect GitLab" },
  { kind: "bitbucket", label: "Connect Bitbucket" },
];
