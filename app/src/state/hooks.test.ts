import { describe, expect, it } from "vitest";
import type { HookEntry } from "../ipc/bindings/HookEntry";
import { commitMessageOf, hookConfirmCopy, hookRowLabel, hooksDirectoryLabel, outcomeText } from "./hooks";

const hook: HookEntry = { name: "pre-push", path: "/r/.git/hooks/pre-push", active: true, reason: null, hash: "h", approved: false };

describe("hooks model", () => {
  it("joins the composer's summary and description the way a commit message is written", () => {
    expect(commitMessageOf("Fix login", "")).toBe("Fix login");
    expect(commitMessageOf(" Fix login ", "\nBody\n")).toBe("Fix login\n\nBody");
  });

  it("labels rows by state and reason", () => {
    expect(hookRowLabel(hook)).toBe("Hook pre-push, Active");
    expect(hookRowLabel({ ...hook, active: false, reason: "Not a Git hook name" })).toBe("Hook pre-push, Inactive, Not a Git hook name");
  });

  it("shows the directory relative to the repository when it lives inside it", () => {
    expect(hooksDirectoryLabel("/r/.git/hooks", "/r")).toBe(".git/hooks");
    expect(hooksDirectoryLabel("/shared/hooks", "/r")).toBe("/shared/hooks");
  });

  it("ends a run with the exit code and whether Git would stop", () => {
    expect(outcomeText({ end: "exited", exit_code: 2, stops_git: true })).toBe("Exit code 2. Git would stop the action.");
    expect(outcomeText({ end: "exited", exit_code: 0, stops_git: false })).toBe("Exit code 0. Git would not stop the action.");
    expect(outcomeText({ end: "exited", exit_code: null, stops_git: true })).toBe("Ended by a signal. Git would stop the action.");
    expect(outcomeText({ end: "timed_out", exit_code: null, stops_git: false })).toBe("Stopped after 120 seconds.");
    expect(outcomeText({ end: "stopped", exit_code: null, stops_git: false })).toBe("Stopped.");
  });

  it("names the script path in the confirmation for each mode", () => {
    expect(hookConfirmCopy(hook, "run")).toMatchObject({ title: "Run pre-push?", names: ["/r/.git/hooks/pre-push"], confirmLabel: "Run" });
    expect(hookConfirmCopy(hook, "test")).toMatchObject({ title: "Test pre-push?", confirmLabel: "Test" });
    expect(hookConfirmCopy(hook, "test").consequences.join(" ")).toContain("temporary worktree");
  });
});
