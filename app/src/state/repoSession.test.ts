import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createQueryClient } from "./queryClient";
import { repoKeys } from "./queryKeys";
import { createRepoSession } from "./repoSession";
import { client } from "../ipc/client";

afterEach(() => clearMocks());

const snapshotWith = (root: string) => ({ root }) as RepoSnapshot;

const sharedClient = () => createQueryClient();
const sessionAt = (root: string, queryClient = sharedClient()) => createRoot(() => createRepoSession("/r", snapshotWith(root), queryClient));

function repository() {
  const calls: string[] = [];
  let opened = 0;
  return {
    calls,
    get opened() {
      return opened;
    },
    install() {
      mockIPC((cmd) => {
        calls.push(cmd);
        if (cmd !== "repo_open") return null;
        opened += 1;
        return snapshotWith(`/open-${opened}`);
      });
    },
  };
}

describe("repo session", () => {
  it("reloads the snapshot and bumps the revision on refresh", async () => {
    const repo = repository();
    repo.install();
    const session = sessionAt("/initial");

    await session.refresh();

    await vi.waitFor(() => expect(session.snapshot().root).toBe("/open-1"));
    expect(session.revision()).toBe(1);
  });

  it("coalesces refreshes requested while one is running into a single follow-up reload", async () => {
    const repo = repository();
    repo.install();
    const session = sessionAt("/initial");

    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);

    expect(repo.opened).toBe(2);
    await vi.waitFor(() => expect(session.snapshot().root).toBe("/open-2"));
    expect(session.revision()).toBe(2);
  });

  it("runs a mutation and then refreshes, reporting success", async () => {
    const repo = repository();
    repo.install();
    const session = sessionAt("/initial");

    const succeeded = await session.mutate(() => Promise.resolve());

    expect(succeeded).toBe(true);
    expect(session.notice()).toBeUndefined();
    expect(repo.calls).toEqual(["repo_open"]);
  });

  it("surfaces a failed mutation as a notice and still refreshes the possibly changed state", async () => {
    const repo = repository();
    mockIPC((cmd) => {
      repo.calls.push(cmd);
      if (cmd === "stage_files") throw { kind: "invalid_request", message: "Invalid request: no files were given", output: null };
      return snapshotWith("/after");
    });
    const session = sessionAt("/initial");
    const { client } = await import("../ipc/client");

    const succeeded = await session.mutate(() => client.stageFiles("/r", []));

    expect(succeeded).toBe(false);
    expect(session.notice()).toBe("Stage files failed: no files were given");
    expect(repo.calls).toEqual(["stage_files", "repo_open"]);
    await vi.waitFor(() => expect(session.snapshot().root).toBe("/after"));
    session.dismissNotice();
    expect(session.notice()).toBeUndefined();
  });

  it("keeps the last snapshot and reports a notice when a refresh fails", async () => {
    mockIPC(() => {
      throw { kind: "git_failed", message: "`git status` exited with status 128", output: null };
    });
    const session = sessionAt("/initial");

    await session.refresh();

    expect(session.snapshot().root).toBe("/initial");
    expect(session.revision()).toBe(0);
    await vi.waitFor(() => expect(session.notice()).toBe("Open repository failed: See Activity for details"));
  });

  it("marks only this repository's cached reads stale on refresh and after a mutation", async () => {
    const repo = repository();
    repo.install();
    const queryClient = createQueryClient();
    queryClient.setQueryData(repoKeys.commit("/r", "abc"), { summary: "kept" });
    queryClient.setQueryData(repoKeys.commit("/other", "abc"), { summary: "other" });
    const session = sessionAt("/initial", queryClient);
    const stale = (path: string) => queryClient.getQueryState(repoKeys.commit(path, "abc"))?.isInvalidated;

    await session.refresh();
    expect([stale("/r"), stale("/other")]).toEqual([true, false]);

    queryClient.setQueryData(repoKeys.commit("/r", "abc"), { summary: "fresh" });
    expect(stale("/r")).toBe(false);
    await session.mutate(() => Promise.resolve());
    expect(stale("/r")).toBe(true);
  });
});

describe("concise failure notices (S48)", () => {
  it.each([
    ["ignored paths", { kind: "git_failed", message: "`git add --all -- . :(exclude,literal).worktrees/topic` exited with status 1: The following paths are ignored by one of your .gitignore files:\n.worktrees\nhint: Use -f if you really want to add them.\nhint: Disable this message with git config advice.addIgnoredFile false", output: null }, "Stage all failed: .worktrees is ignored by .gitignore"],
    ["fatal cause", { kind: "git_failed", message: "`git add --all` exited with status 128: fatal: Unable to create index.lock: File exists\nhint: remove lock", output: "fatal: Unable to create index.lock: File exists\nhint: remove lock" }, "Stage all failed: Unable to create index.lock: File exists"],
    ["known kind", { kind: "local_changes", message: "unstructured raw message", output: null }, "Stage all failed: local changes would be overwritten"],
    ["no usable cause", { kind: "git_failed", message: "`git add --all` exited with status 1", output: "hint: use -f\n:(exclude,literal).worktrees/topic" }, "Stage all failed: See Activity for details"],
  ])("formats %s without changing the raw error", async (_name, payload, expected) => {
    mockIPC((cmd) => {
      if (cmd === "stage_all") throw payload;
      return snapshotWith("/initial");
    });
    const session = sessionAt("/initial");
    let failure: unknown;
    try { await client.stageAll("/r"); } catch (error) { failure = error; }
    session.report(failure);
    expect(session.notice()).toBe(expected);
    expect(failure).toMatchObject({ message: payload.message, output: payload.output });
  });
});

describe("search with a branch visibility", () => {
  it("searches only the commits the chosen visibility shows, and asks again when it changes", async () => {
    const searches: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "search_commits") searches.push(args);
      return { total: 0, rows: [] };
    });
    let visibility: GraphVisibility = { kind: "all" };
    const session = createRoot(() => createRepoSession("/r", snapshotWith("/r"), sharedClient(), () => visibility));

    await session.searchCommits("fix");
    visibility = { kind: "current_and_upstream" };
    await session.searchCommits("fix");

    expect(searches).toEqual([
      { path: "/r", query: "fix" },
      { path: "/r", query: "fix", visibility: { kind: "current_and_upstream" } },
    ]);
  });
});
