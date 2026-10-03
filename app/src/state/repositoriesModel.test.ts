import { describe, expect, it } from "vitest";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import {
  branchText,
  DEPTH_CHOICES,
  filterRepositories,
  folderMeta,
  groupRepositories,
  OPENED_GROUP,
  openedText,
  repoStateText,
  repositoryRows,
  rescanText,
  sortRepositories,
  stoppedText,
} from "./repositoriesModel";

const status = (path: string, overrides: Partial<RecentStatus> = {}): RecentStatus => ({
  path,
  exists: true,
  branch: "main",
  unborn: false,
  ahead_behind: null,
  counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
  worktrees: 1,
  unreadable: null,
  ...overrides,
});

const folder: ScannedFolder = { path: "/u/Code", depth: 2, scanned_at: 1_000, repos: ["/u/Code/api", "/u/Code/web"], skipped: [] };

describe("repository rows", () => {
  const rows = repositoryRows(
    [
      { path: "/u/Code/web", folder: "/u/Code", opened_at: 900 },
      { path: "/u/dotfiles", folder: null, opened_at: 500 },
      { path: "/u/Code/api", folder: "/u/Code", opened_at: null },
    ],
    [status("/u/Code/web", { branch: "feature/login" }), status("/u/Code/api")],
  );

  it("groups by scanned folder in order, then the repositories known only because they were opened", () => {
    expect(groupRepositories(rows, [folder]).map((group) => [group.label, group.rows.map((row) => row.name)])).toEqual([
      ["/u/Code", ["web", "api"]],
      [OPENED_GROUP, ["dotfiles"]],
    ]);
  });

  it("searches names, paths, and branches, and sorts by name on request", () => {
    expect(filterRepositories(rows, "login").map((row) => row.name)).toEqual(["web"]);
    expect(filterRepositories(rows, "/u/dot").map((row) => row.name)).toEqual(["dotfiles"]);
    expect(sortRepositories(rows, "name").map((row) => row.name)).toEqual(["api", "dotfiles", "web"]);
    expect(sortRepositories(rows, "recent").map((row) => row.name)).toEqual(["web", "dotfiles", "api"]);
  });
});

describe("repository status in words", () => {
  it("states changes, commits to push and to pull, or Clean", () => {
    expect(repoStateText(status("/r", { counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 }, ahead_behind: { ahead: 0, behind: 3 } }))).toBe("2 changes, 3 to pull");
    expect(repoStateText(status("/r", { ahead_behind: { ahead: 1, behind: 0 } }))).toBe("1 to push");
    expect(repoStateText(status("/r"))).toBe("Clean");
    expect(repoStateText(status("/r", { unborn: true }))).toBe("No commits yet");
  });

  it("says Not found and Status unavailable, and shows no branch for them", () => {
    expect(repoStateText(status("/r", { exists: false, branch: null }))).toBe("Not found");
    expect(repoStateText(status("/r", { unreadable: "permission denied" }))).toBe("Status unavailable");
    expect(branchText(status("/r", { exists: false }))).toBe("");
    expect(branchText(status("/r", { branch: "dev" }))).toBe("dev");
    expect(repoStateText(undefined)).toBe("Reading…");
  });
});

describe("folder and list texts", () => {
  it("describes a folder with its count, depth, and scan age, and a row with when it was opened", () => {
    expect(folderMeta(folder, 1_000 + 600)).toBe("2 repositories · 2 levels deep · scanned 10m ago");
    expect(openedText(null, 0)).toBe("Never opened");
    expect(openedText(0, 7_200)).toBe("Opened 2h ago");
  });

  it("offers 1 to 5 levels with 2 as the default", () => {
    expect(DEPTH_CHOICES.map((choice) => choice.label)).toEqual(["1 level", "2 levels", "3 levels", "4 levels", "5 levels"]);
    expect(DEPTH_CHOICES.find((choice) => choice.hint === "Default")?.value).toBe("2");
  });

  it("states what a rescan and Stop scanning did", () => {
    expect(rescanText("/u/Code", [])).toBe("No new repositories in /u/Code.");
    expect(rescanText("/u/Code", ["/u/Code/cli"])).toBe("Found 1 new repository in /u/Code: cli.");
    expect(stoppedText("/u/Code", 2, 1)).toBe("Stopped scanning /u/Code. Took 2 repositories off the list; kept 1 repository you opened. Nothing on disk changed.");
  });
});
