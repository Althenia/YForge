import { describe, expect, it } from "vitest";
import type { BlameRun } from "../ipc/bindings/BlameRun";
import type { FileRevision } from "../ipc/bindings/FileRevision";
import { blameRows, pickRevision, REVERT_WHITESPACE_REASON, revertReason, stepRevision } from "./fileHistory";

const revision = (sha: string, path = "src/util.js"): FileRevision => ({
  sha: sha.repeat(40),
  short: sha.repeat(7),
  summary: `Commit ${sha}`,
  author: "Yui Lin",
  email: "yui@example.com",
  time: 1_700_000_000,
  path,
  status: "modified",
});

const revisions = [revision("c"), revision("b"), revision("a", "src/old.js")];

describe("pickRevision", () => {
  it("picks the requested commit by full or abbreviated SHA", () => {
    expect(pickRevision(revisions, "b".repeat(40))?.sha).toBe("b".repeat(40));
    expect(pickRevision(revisions, "aaaaaaa")?.sha).toBe("a".repeat(40));
  });

  it("falls back to the newest commit when none is requested or the request is not in the history", () => {
    expect(pickRevision(revisions, undefined)?.sha).toBe("c".repeat(40));
    expect(pickRevision(revisions, "d".repeat(40))?.sha).toBe("c".repeat(40));
  });

  it("has nothing to pick when no commit changed the file", () => {
    expect(pickRevision([], undefined)).toBeUndefined();
  });
});

describe("stepRevision", () => {
  const at = (index: number) => revisions[index]?.sha;

  it("moves down and up one commit and stops at either end", () => {
    expect(stepRevision(revisions, at(0), "ArrowDown")).toBe(at(1));
    expect(stepRevision(revisions, at(1), "ArrowUp")).toBe(at(0));
    expect(stepRevision(revisions, at(0), "ArrowUp")).toBe(at(0));
    expect(stepRevision(revisions, at(2), "ArrowDown")).toBe(at(2));
  });

  it("jumps to the newest with Home and the oldest with End", () => {
    expect(stepRevision(revisions, at(1), "Home")).toBe(at(0));
    expect(stepRevision(revisions, at(1), "End")).toBe(at(2));
  });

  it("ignores any other key and an empty history", () => {
    expect(stepRevision(revisions, at(1), "Enter")).toBeUndefined();
    expect(stepRevision([], undefined, "ArrowDown")).toBeUndefined();
  });
});

describe("blameRows", () => {
  const run = (sha: string, start: number, lines: string[]): BlameRun => ({ sha: sha.repeat(40), short: sha.repeat(7), author: "Yui Lin", email: "yui@example.com", time: 1, summary: `Commit ${sha}`, start, lines });

  it("lists every line in order with the run that last changed it, marking the first line of each run", () => {
    expect(blameRows([run("a", 1, ["# util", ""]), run("b", 3, ["export const x = 1;"])])).toEqual([
      { text: "# util", run: 0, first: true },
      { text: "", run: 0, first: false },
      { text: "export const x = 1;", run: 1, first: true },
    ]);
  });
});

describe("revertReason", () => {
  it("blocks Revert hunk while Ignore whitespace hides changes, because the hunk would not match the commit", () => {
    expect(revertReason(true)).toBe(REVERT_WHITESPACE_REASON);
    expect(revertReason(false)).toBeUndefined();
  });
});
