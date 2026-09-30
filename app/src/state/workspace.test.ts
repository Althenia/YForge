import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { loadWorkspace } from "./workspace";

afterEach(() => clearMocks());

const info = { app_version: "0.1.0", git_version: "2.55.0" };
const snapshot = { root: "/repo" } as RepoSnapshot;

describe("loadWorkspace", () => {
  it("opens the given path and returns the snapshot with app info", async () => {
    const opened: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "app_info") return info;
      opened.push(args);
      return snapshot;
    });

    expect(await loadWorkspace("/repo")).toEqual({ status: "ready", path: "/repo", snapshot, info });
    expect(opened).toEqual([{ path: "/repo" }]);
  });

  it("reports a path that is not a repository as an empty state, not a failure", async () => {
    mockIPC((cmd) => {
      if (cmd === "app_info") return info;
      throw { kind: "not_a_repository", message: "/tmp is not inside a Git repository" };
    });

    expect(await loadWorkspace("/tmp")).toEqual({
      status: "not_a_repository",
      path: "/tmp",
      message: "/tmp is not inside a Git repository",
    });
  });

  it("surfaces git problems from app_info as a failure with the backend message", async () => {
    mockIPC(() => {
      throw { kind: "git_missing", message: "The git executable was not found on PATH" };
    });

    expect(await loadWorkspace("/repo")).toEqual({ status: "failed", message: "The git executable was not found on PATH" });
  });

  it("surfaces other repository errors as failures", async () => {
    mockIPC((cmd) => {
      if (cmd === "app_info") return info;
      throw { kind: "git_failed", message: "`git status` exited with status 128" };
    });

    expect(await loadWorkspace("/repo")).toEqual({ status: "failed", message: "`git status` exited with status 128" });
  });
});
