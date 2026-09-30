import { basename, relativeAge } from "../format";
import type { RecentRepo } from "../ipc/bindings/RecentRepo";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";

export type RecentRow = { recent: RecentRepo; status: RecentStatus | undefined };

export function filterRecents(rows: readonly RecentRow[], query: string): RecentRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(({ recent }) => basename(recent.path).toLowerCase().includes(needle) || recent.path.toLowerCase().includes(needle));
}

export function displayPath(path: string, home: string | undefined): string {
  if (home === undefined || home === "") return path;
  const trimmed = home.replace(/\/+$/, "");
  return path === trimmed ? "~" : path.startsWith(`${trimmed}/`) ? `~${path.slice(trimmed.length)}` : path;
}

const countLetters = [
  ["modified", "M"],
  ["added", "A"],
  ["deleted", "D"],
  ["renamed", "R"],
  ["untracked", "U"],
  ["conflicted", "!"],
] as const;

export type StatusChips = { missing: boolean; branch: string; sync: string; changes: string; worktrees: string };

const pending = "…";

export function statusChips(status: RecentStatus | undefined): StatusChips {
  if (status === undefined) return { missing: false, branch: pending, sync: "", changes: pending, worktrees: "" };
  if (!status.exists) return { missing: true, branch: "Not found", sync: "", changes: "", worktrees: "" };
  const counts = status.counts;
  const parts = counts === null ? [] : countLetters.filter(([key]) => counts[key] > 0).map(([key, letter]) => `${letter} ${counts[key]}`);
  const { ahead_behind: ahead } = status;
  const sync = ahead === null ? "" : [ahead.ahead > 0 ? `↑${ahead.ahead}` : "", ahead.behind > 0 ? `↓${ahead.behind}` : ""].filter(Boolean).join(" ");
  return {
    missing: false,
    branch: status.unborn ? `${status.branch ?? "main"} (unborn)` : (status.branch ?? "—"),
    sync,
    changes: parts.length === 0 ? (status.unborn ? "no commits yet" : "clean") : parts.join(" "),
    worktrees: status.worktrees > 1 ? `${status.worktrees} worktrees` : "",
  };
}

export const openedAgo = (openedAt: number, now: number): string => `${relativeAge(openedAt, now)} ago`;

const SCHEMES = ["https://", "http://", "ssh://", "git://", "file://"];

export function cloneUrlProblem(url: string): string | undefined {
  const text = url.trim();
  if (text === "") return "Enter a repository address";
  const scheme = SCHEMES.some((prefix) => text.startsWith(prefix) && text.length > prefix.length);
  const scp = /^[^/\s:]+:(?!\/\/)[^\s]+$/.test(text) && !/^[A-Za-z]:[\\/]/.test(text);
  return scheme || scp || text.startsWith("/") ? undefined : "Use an https or ssh address, or an absolute local path";
}

export function cloneRepoName(url: string): string {
  const cleaned = url.trim().replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const tail = cleaned.split(/[\\/:]/).pop() ?? "";
  return tail === "" ? "repository" : tail;
}

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

export const cloneDestination = (parent: string, url: string): string => joinPath(parent, cloneRepoName(url));

export const createDestination = (parent: string, name: string): string => joinPath(parent, name.trim());

export function createNameProblem(name: string): string | undefined {
  const text = name.trim();
  if (text === "") return "Enter a name";
  return /[\\/]/.test(text) || text === "." || text === ".." ? "The name cannot contain slashes" : undefined;
}
