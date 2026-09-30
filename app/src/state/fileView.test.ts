import { describe, expect, it } from "vitest";
import { IpcError } from "../ipc/client";
import { fileLines, fileViewError, fileViewTargetOf, formatBytes, stashFileViewTarget } from "./fileView";

describe("file view target", () => {
  it("reads the staged blob, the work tree file, or the commit, from the diff the user came from", () => {
    expect(fileViewTargetOf({ source: "working", area: "staged", file: "a.ts" })).toEqual({ file: "a.ts", rev: ":index", source: "Staged" });
    expect(fileViewTargetOf({ source: "working", area: "unstaged", file: "a.ts" })).toEqual({ file: "a.ts", rev: ":worktree", source: "Working tree" });
    expect(fileViewTargetOf({ source: "working", area: "untracked", file: "a.ts" })).toEqual({ file: "a.ts", rev: ":worktree", source: "Working tree" });
    expect(fileViewTargetOf({ source: "commit", sha: "abcdef1234567", file: "a.ts" })).toEqual({ file: "a.ts", rev: "abcdef1234567", source: "abcdef1" });
    expect(fileViewTargetOf({ source: "stash", index: 1, sha: "f".repeat(40), file: "a.ts" })).toEqual({ file: "a.ts", rev: "f".repeat(40), source: "stash@{1}" });
  });

  it("reads an untracked file of a stash from the stash's untracked commit", () => {
    const details = { index: 2, sha: "f".repeat(40), untracked_sha: "7".repeat(40) };

    expect(stashFileViewTarget(details, { path: "n.txt", untracked: true })).toEqual({ file: "n.txt", rev: "7".repeat(40), source: "stash@{2} (untracked)" });
    expect(stashFileViewTarget(details, { path: "a.ts", untracked: false })).toEqual({ file: "a.ts", rev: "f".repeat(40), source: "stash@{2}" });
  });
});

describe("file lines", () => {
  it("splits on LF and CRLF and does not add a line for the final newline", () => {
    expect(fileLines("a\nb\n")).toEqual(["a", "b"]);
    expect(fileLines("a\r\nb")).toEqual(["a", "b"]);
    expect(fileLines("")).toEqual([]);
    expect(fileLines("\n")).toEqual([""]);
  });
});

describe("sizes and errors", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(1023)).toBe("1,023 bytes");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(2_097_153)).toBe("2.0 MiB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GiB");
  });

  it("explains a file over the limit with its size, and passes other messages through", () => {
    const tooLarge = new IpcError({ kind: "file_too_large", message: "too large", output: "3145728" });
    expect(fileViewError(tooLarge)).toBe("This file is 3.0 MiB, over the 2.0 MiB limit of the file view. Open it in your editor instead.");
    expect(fileViewError(new IpcError({ kind: "file_too_large", message: "too large", output: null }))).toBe("This file is over the 2.0 MiB limit of the file view. Open it in your editor instead.");
    expect(fileViewError(new IpcError({ kind: "invalid_request", message: "a.ts is not a file in that revision", output: null }))).toBe("a.ts is not a file in that revision");
    expect(fileViewError(new Error("boom"))).toBe("boom");
  });
});
