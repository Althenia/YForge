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

  it("prefers the known error kind wording over raw Git output", () => {
    const error = new IpcError({ kind: "push_rejected", message: "raw", output: "To github.com:o/r.git\n ! [rejected] main -> main (fetch first)\nerror: failed to push some refs to 'github.com:o/r.git'" }, "push");
    expect(failureNotice(error)).toBe("Push failed: the remote rejected the push");
  });

  it("words an uninitialized folder as not a Git repository", () => {
    const error = new IpcError({ kind: "uninitialized_folder", message: "raw", output: "fatal: not a git repository: '/Users/viadz/Workspace/new'" }, "repo_open");
    expect(failureNotice(error)).toBe("Open repository failed: not a Git repository");
  });

  it("names a path by its last segment and never shows an absolute path", () => {
    const worktree = "/Users/viadz/Workspace/Project/ycoding/.worktrees/performance-analysis";
    expect(failureNotice(new IpcError({ kind: "git_failed", message: `fatal: '${worktree}' is not a working tree` }, "worktree_remove"))).toBe("Worktree remove failed: 'performance-analysis' is not a working tree");
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "fatal: cannot lock C:\\Users\\viadz\\repo\\.git\\index.lock" }, "stage_all"))).toBe("Stage all failed: cannot lock index.lock");
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "fatal: not a branch: refs/heads/feature/x" }, "checkout"))).toBe("Checkout failed: not a branch: refs/heads/feature/x");
  });

  it("never shows a URL", () => {
    const error = new IpcError({ kind: "git_failed", message: "fatal: unable to access 'https://user:token@github.com/o/r.git/': Could not resolve host: github.com" }, "fetch");
    expect(failureNotice(error)).toBe("Fetch failed: See Activity for details");
  });

  it("keeps the whole title within two toast lines", () => {
    const cause = "the generated configuration for this repository is not valid anywhere";
    const title = failureNotice(new IpcError({ kind: "git_failed", message: `fatal: ${cause}` }, "repo_open"));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title).toBe("Open repository failed: See Activity for details");
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "fatal: lock is held by another process" }, "fetch"))).toBe("Fetch failed: lock is held by another process");
  });

  it("reports a platform refusal by its status and message without the host preamble", () => {
    expect(failureNotice(new IpcError({ kind: "api_error", message: "github.com answered with HTTP 405: Pull Request is not mergeable" }, "platform_pr_merge"))).toBe(
      "Merge pull request failed: HTTP 405: Pull Request is not mergeable",
    );
  });

  it("keeps a single sentence and never prints a raw pathspec", () => {
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "error: Permission denied. Retry with different credentials." }, "push"))).toBe("Push failed: Permission denied");
    expect(failureNotice(new IpcError({ kind: "git_failed", message: "fatal: invalid pathspec :(exclude,literal)bad" }, "stage_all"))).toBe("Stage all failed: See Activity for details");
  });
});
