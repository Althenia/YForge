import { describe, expect, it } from "vitest";
import { IpcError } from "../ipc/client";
import { failureNotice } from "./errorNotice";

describe("failure notice formatter", () => {
  it("uses the first meaningful diagnostic, not hints or a command-bearing diagnostic", () => {
    const error = new IpcError({ kind: "git_failed", message: "`git push` exited with status 1", output: "hint: retry\nerror: `git push` failed\nfatal: Permission denied\nerror: another cause" }, "push");
    expect(failureNotice(error)).toBe("Push failed: Permission denied");
    expect(error.output).toContain("hint: retry");
  });

  it("falls back to Activity rather than displaying a long cause", () => {
    expect(failureNotice(new IpcError({ kind: "git_failed", message: `fatal: ${"very long cause ".repeat(30)}` }, "push"))).toBe("Push failed: See Activity for details");
  });

  it("keeps a single sentence and never prints a raw pathspec", () => {
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "error: Permission denied. Retry with different credentials." }, "push"))).toBe("Push failed: Permission denied");
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "fatal: invalid pathspec :(exclude,literal)bad" }, "stage_all"))).toBe("Stage all failed: See Activity for details");
  });
});
