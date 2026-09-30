import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createRepoSession } from "./repoSession";

afterEach(() => clearMocks());

const snapshotWith = (root: string) => ({ root }) as RepoSnapshot;

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
    const session = createRepoSession("/r", snapshotWith("/initial"));

    await session.refresh();

    expect(session.snapshot().root).toBe("/open-1");
    expect(session.revision()).toBe(1);
  });

  it("coalesces refreshes requested while one is running into a single follow-up reload", async () => {
    const repo = repository();
    repo.install();
    const session = createRepoSession("/r", snapshotWith("/initial"));

    await Promise.all([session.refresh(), session.refresh(), session.refresh()]);

    expect(repo.opened).toBe(2);
    expect(session.snapshot().root).toBe("/open-2");
    expect(session.revision()).toBe(2);
  });

  it("runs a mutation and then refreshes, reporting success", async () => {
    const repo = repository();
    repo.install();
    const session = createRepoSession("/r", snapshotWith("/initial"));

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
    const session = createRepoSession("/r", snapshotWith("/initial"));
    const { client } = await import("../ipc/client");

    const succeeded = await session.mutate(() => client.stageFiles("/r", []));

    expect(succeeded).toBe(false);
    expect(session.notice()).toBe("Invalid request: no files were given");
    expect(repo.calls).toEqual(["stage_files", "repo_open"]);
    expect(session.snapshot().root).toBe("/after");
    session.dismissNotice();
    expect(session.notice()).toBeUndefined();
  });

  it("keeps the last snapshot and reports a notice when a refresh fails", async () => {
    mockIPC(() => {
      throw { kind: "git_failed", message: "`git status` exited with status 128", output: null };
    });
    const session = createRepoSession("/r", snapshotWith("/initial"));

    await session.refresh();

    expect(session.snapshot().root).toBe("/initial");
    expect(session.revision()).toBe(0);
    expect(session.notice()).toBe("`git status` exited with status 128");
  });
});
