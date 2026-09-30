import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { IpcError } from "../ipc/client";
import { workspaceView } from "./workspace";

const info = { app_version: "0.1.0", git_version: "2.55.0" };
const snapshot = { root: "/repo" } as RepoSnapshot;
const failure = (kind: "not_a_repository" | "git_failed" | "git_missing", message: string) => new IpcError({ kind, message, output: null });

describe("workspaceView", () => {
  it("is ready once app info and the snapshot have loaded", () => {
    expect(workspaceView("/repo", { data: info, error: null }, { data: snapshot, error: null })).toEqual({ status: "ready", path: "/repo", snapshot, info });
  });

  it("is undefined while either read is pending", () => {
    expect(workspaceView("/repo", { data: undefined, error: null }, { data: snapshot, error: null })).toBeUndefined();
    expect(workspaceView("/repo", { data: info, error: null }, { data: undefined, error: null })).toBeUndefined();
  });

  it("reports a path that is not a repository as an empty state, not a failure", () => {
    expect(workspaceView("/tmp", { data: info, error: null }, { data: undefined, error: failure("not_a_repository", "/tmp is not inside a Git repository") })).toEqual({
      status: "not_a_repository",
      path: "/tmp",
      message: "/tmp is not inside a Git repository",
    });
  });

  it("surfaces git problems from app_info as a failure with the backend message", () => {
    expect(workspaceView("/repo", { data: undefined, error: failure("git_missing", "The git executable was not found on PATH") }, { data: undefined, error: null })).toEqual({
      status: "failed",
      message: "The git executable was not found on PATH",
    });
  });

  it("surfaces other repository errors as failures", () => {
    expect(workspaceView("/repo", { data: info, error: null }, { data: undefined, error: failure("git_failed", "`git status` exited with status 128") })).toEqual({
      status: "failed",
      message: "`git status` exited with status 128",
    });
  });
});
