import { basename, relativeAge } from "../format";
import type { IconName } from "../iconNames";
import type { ManagedRepo } from "../ipc/bindings/ManagedRepo";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import { repoName, type Aliases } from "./tabs";

export type RepoRow = { path: string; name: string; folder: string | null; openedAt: number | null; status: RecentStatus | undefined };

export type RepoSort = "recent" | "name";

export const SORT_CHOICES: ReadonlyArray<{ value: RepoSort; label: string }> = [
  { value: "recent", label: "Recently opened" },
  { value: "name", label: "Name" },
];

export const DEFAULT_DEPTH = 2;

export const DEPTH_CHOICES: ReadonlyArray<{ value: string; label: string; hint?: string }> = [1, 2, 3, 4, 5].map((depth) => ({
  value: String(depth),
  label: plural(depth, "level", "levels"),
  ...(depth === DEFAULT_DEPTH ? { hint: "Default" } : {}),
}));


export const OPENED_GROUP = "Added when you opened them";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function repositoryRows(repos: readonly ManagedRepo[], statuses: readonly RecentStatus[] | undefined, aliases: Aliases = {}): RepoRow[] {
  const found = new Map((statuses ?? []).map((status) => [status.path, status]));
  return repos.map((repo) => ({ path: repo.path, name: repoName(repo.path, aliases), folder: repo.folder, openedAt: repo.opened_at, status: found.get(repo.path) }));
}

export function filterRepositories(rows: readonly RepoRow[], query: string): RepoRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => [row.name, basename(row.path), row.path, row.status?.branch ?? ""].some((text) => text.toLowerCase().includes(needle)));
}

export function sortRepositories(rows: readonly RepoRow[], sort: RepoSort): RepoRow[] {
  return sort === "name" ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : [...rows];
}

export type RepoGroup = { key: string | null; label: string; rows: RepoRow[] };

/// One group per scanned folder in the order they were added, then the repositories known only because they were opened.
export function groupRepositories(rows: readonly RepoRow[], folders: readonly ScannedFolder[]): RepoGroup[] {
  const known = new Set(folders.map((folder) => folder.path));
  const groups: RepoGroup[] = folders.map((folder) => ({ key: folder.path, label: folder.path, rows: rows.filter((row) => row.folder === folder.path) }));
  groups.push({ key: null, label: OPENED_GROUP, rows: rows.filter((row) => row.folder === null || !known.has(row.folder)) });
  return groups.filter((group) => group.rows.length > 0);
}

export type StatePart = { icon: IconName; text: string; tone: "ok" | "attention" | "neutral" };

/// The status column in words, never color alone.
export function repoStateParts(status: RecentStatus | undefined): StatePart[] {
  if (status === undefined) return [{ icon: "sync", text: "Reading…", tone: "neutral" }];
  if (!status.exists) return [{ icon: "warning", text: "Not found", tone: "attention" }];
  if (status.unreadable !== null) return [{ icon: "warning", text: "Status unavailable", tone: "attention" }];
  const counts = status.counts;
  const changes = counts === null ? 0 : counts.modified + counts.added + counts.deleted + counts.renamed + counts.untracked + counts.conflicted;
  const parts: StatePart[] = [];
  if (changes > 0) parts.push({ icon: "changes", text: plural(changes, "change", "changes"), tone: "attention" });
  if (status.ahead_behind !== null && status.ahead_behind.ahead > 0) parts.push({ icon: "push", text: `${status.ahead_behind.ahead} to push`, tone: "neutral" });
  if (status.ahead_behind !== null && status.ahead_behind.behind > 0) parts.push({ icon: "pull", text: `${status.ahead_behind.behind} to pull`, tone: "neutral" });
  if (parts.length === 0) parts.push(status.unborn ? { icon: "commit", text: "No commits yet", tone: "neutral" } : { icon: "check", text: "Clean", tone: "ok" });
  return parts;
}

export const repoStateText = (status: RecentStatus | undefined): string => repoStateParts(status).map((part) => part.text).join(", ");

export function branchText(status: RecentStatus | undefined): string {
  if (status === undefined || !status.exists || status.unreadable !== null) return "";
  return status.unborn ? `${status.branch ?? "main"} (unborn)` : (status.branch ?? "");
}

export const openedText = (openedAt: number | null, now: number): string => (openedAt === null ? "Never opened" : `Opened ${relativeAge(openedAt, now)} ago`);

export const folderMeta = (folder: ScannedFolder, now: number): string =>
  `${plural(folder.repos.length, "repository", "repositories")} · ${plural(folder.depth, "level", "levels")} deep · scanned ${relativeAge(folder.scanned_at, now)} ago`;

export const removedText = (name: string, opened: boolean, folder: string | null): string =>
  `Removed ${name} from the list. Nothing on disk changed.${folder === null ? "" : ` Rescans of ${folder} skip it.`}${opened ? " It returns here when you open it again." : ""}`;

export const stoppedText = (folder: string, taken: number, kept: number): string =>
  `Stopped scanning ${folder}. Took ${plural(taken, "repository", "repositories")} off the list${kept > 0 ? `; kept ${plural(kept, "repository", "repositories")} you opened` : ""}. Nothing on disk changed.`;

export const rescanText = (folder: string, added: readonly string[]): string =>
  added.length === 0 ? `No new repositories in ${folder}.` : `Found ${plural(added.length, "new repository", "new repositories")} in ${folder}: ${added.map(basename).join(", ")}.`;

export const addedText = (folder: string, added: number): string => `Added ${plural(added, "repository", "repositories")} from ${folder}.`;

export const scanSummary = (found: number, folder: string, checked: number, depth: number, capped: boolean): string =>
  `Found ${plural(found, "repository", "repositories")} in ${folder} · ${plural(checked, "folder", "folders")} checked, ${plural(depth, "level", "levels")} deep${capped ? " · stopped at 20,000 folders" : ""}`;

export const nothingFoundText = (folder: string, checked: number, depth: number, capped: boolean): string =>
  `Looked ${plural(depth, "level", "levels")} deep in ${folder} and checked ${plural(checked, "folder", "folders")}${capped ? ", stopping at 20,000" : ""}. Nothing was added.`;

export const addButtonText = (picked: number): string => (picked === 0 ? "Add repositories" : `Add ${plural(picked, "repository", "repositories")}`);
