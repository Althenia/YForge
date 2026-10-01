import { describe, expect, it } from "vitest";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";
import {
  cloneDestination,
  cloneRepoName,
  cloneUrlProblem,
  createDestination,
  createNameProblem,
  displayPath,
  filterRecents,
  openedAgo,
  statusChips,
  type RecentRow,
} from "./launcher";

const status = (extra: Partial<RecentStatus> = {}): RecentStatus => ({
  path: "/r",
  exists: true,
  branch: "feature/greeting",
  unborn: false,
  ahead_behind: { ahead: 2, behind: 0 },
  counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 },
  worktrees: 2,
  unreadable: null,
  ...extra,
});

const row = (path: string): RecentRow => ({ recent: { path, opened_at: 0 }, status: undefined });

describe("launcher recents", () => {
  it("filters by repository name or path, ignoring case, and keeps the order", () => {
    const rows = [row("/dev/sample"), row("/dev/Other-Repo"), row("/srv/empty")];
    expect(filterRecents(rows, "other").map((entry) => entry.recent.path)).toEqual(["/dev/Other-Repo"]);
    expect(filterRecents(rows, "/dev").map((entry) => entry.recent.path)).toEqual(["/dev/sample", "/dev/Other-Repo"]);
    expect(filterRecents(rows, "  ")).toHaveLength(3);
    expect(filterRecents(rows, "zzz")).toEqual([]);
  });

  it("also finds a repository by its alias", () => {
    const rows = [row("/dev/sample"), row("/dev/other")];

    expect(filterRecents(rows, "corp", { "/dev/other": "Corp A · API" }).map((entry) => entry.recent.path)).toEqual(["/dev/other"]);
    expect(filterRecents(rows, "other", { "/dev/other": "Corp A · API" }).map((entry) => entry.recent.path)).toEqual(["/dev/other"]);
  });

  it("abbreviates the home directory and leaves other paths whole", () => {
    expect(displayPath("/Users/yui/dev/a", "/Users/yui")).toBe("~/dev/a");
    expect(displayPath("/Users/yui", "/Users/yui/")).toBe("~");
    expect(displayPath("/tmp/a", "/Users/yui")).toBe("/tmp/a");
    expect(displayPath("/Users/yuiko/a", "/Users/yui")).toBe("/Users/yuiko/a");
    expect(displayPath("/a", undefined)).toBe("/a");
  });

  it("summarises status as chips, with placeholders while loading and a not-found marker", () => {
    expect(statusChips(status())).toEqual({ missing: false, branch: "feature/greeting", sync: "↑2", changes: "M 1 U 1", worktrees: "2 worktrees", problem: "" });
    expect(statusChips(status({ ahead_behind: null, counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, worktrees: 1 }))).toMatchObject({ sync: "", changes: "clean", worktrees: "" });
    expect(statusChips(status({ unborn: true, branch: "main", ahead_behind: null, counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 } }))).toMatchObject({
      branch: "main (unborn)",
      changes: "no commits yet",
    });
    expect(statusChips(status({ ahead_behind: { ahead: 1, behind: 3 } })).sync).toBe("↑1 ↓3");
    expect(statusChips(undefined)).toMatchObject({ branch: "…", changes: "…", missing: false });
    expect(statusChips(status({ exists: false }))).toMatchObject({ missing: true, branch: "Not found" });
  });

  it("states why a status could not be read instead of showing Not found", () => {
    const chips = statusChips(status({ branch: null, counts: null, worktrees: 0, unreadable: "index file smaller than expected" }));

    expect(chips).toMatchObject({ missing: false, problem: "Could not read status: index file smaller than expected" });
    expect(chips.branch).not.toBe("Not found");
  });

  it("words the last-opened time relative to now", () => {
    expect(openedAgo(1000, 1000 + 300)).toBe("5m ago");
  });
});

describe("clone and create forms", () => {
  it("validates addresses: https, ssh, scp-like, and absolute local paths", () => {
    for (const good of ["https://github.com/a/b.git", "ssh://git@host/a.git", "git@github.com:a/b.git", "/srv/repos/a.git", "file:///srv/a.git"]) {
      expect(cloneUrlProblem(good)).toBeUndefined();
    }
    for (const bad of ["", "  ", "not a url", "https://", "relative/path", "C:\\repos\\a"]) {
      expect(cloneUrlProblem(bad)).toBeDefined();
    }
  });

  it("derives the repository folder from the address and previews the full path", () => {
    expect(cloneRepoName("https://github.com/example/lab-app.git")).toBe("lab-app");
    expect(cloneRepoName("git@github.com:example/lab-app.git/")).toBe("lab-app");
    expect(cloneRepoName("/srv/bare.git")).toBe("bare");
    expect(cloneRepoName("https://")).toBe("repository");
    expect(cloneDestination("~/Developer/", "https://github.com/example/lab-app.git")).toBe("~/Developer/lab-app");
    expect(createDestination("/dev", " new-repo ")).toBe("/dev/new-repo");
  });

  it("rejects empty names and names with slashes when creating", () => {
    expect(createNameProblem("")).toBeDefined();
    expect(createNameProblem("a/b")).toBeDefined();
    expect(createNameProblem("..")).toBeDefined();
    expect(createNameProblem("ok-name")).toBeUndefined();
  });
});
