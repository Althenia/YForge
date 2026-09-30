import { describe, expect, it } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileDiff } from "../ipc/bindings/FileDiff";
import type { FileChange } from "../ipc/bindings/FileChange";
import { diffNotice, followTarget, isConflictTarget, hunkActions, hunkHeader, hunkLabel, hunkRows, lineMarker, sameTarget, targetMode, targetSource, type DiffTarget } from "./diffModel";

const hunk: DiffHunk = { old_start: 3, old_lines: 7, new_start: 3, new_lines: 7, heading: "export function clamp", lines: [] };
const working = (area: "unstaged" | "staged" | "untracked" | "conflicted"): DiffTarget => ({ source: "working", area, file: "src/util.js" });
const commit: DiffTarget = { source: "commit", sha: "62db91d0000", file: "README.md" };
const diff = (overrides: Partial<FileDiff>): FileDiff => ({ path: "f", original_path: null, binary: false, hunks: [hunk], ...overrides });

describe("diff view model", () => {
  it("formats the hunk header and its accessible name from the ranges", () => {
    expect(hunkHeader(hunk)).toBe("@@ -3,7 +3,7 @@ export function clamp");
    expect(hunkHeader({ ...hunk, heading: "" })).toBe("@@ -3,7 +3,7 @@");
    expect(hunkLabel(0, 2, hunk)).toBe("Hunk 1 of 2, lines 3–9");
    expect(hunkLabel(1, 2, { ...hunk, new_start: 5, new_lines: 0, old_start: 5, old_lines: 2 })).toBe("Hunk 2 of 2, lines 5–6");
  });

  it("offers hunk actions by source and area", () => {
    expect(hunkActions(working("unstaged"))).toEqual(["stage", "discard"]);
    expect(hunkActions(working("staged"))).toEqual(["unstage"]);
    expect(hunkActions(working("untracked"))).toEqual([]);
    expect(hunkActions(working("conflicted"))).toEqual([]);
    expect(hunkActions(commit)).toEqual([]);
  });

  it("marks each line kind with a glyph besides its color", () => {
    expect(lineMarker).toEqual({ context: " ", added: "+", removed: "−" });
  });

  it("names the source and mode for the breadcrumb and chip", () => {
    expect(targetSource(working("staged"))).toBe("Changes");
    expect(targetMode(working("staged"))).toBe("Staged");
    expect(targetMode(working("conflicted"))).toBe("Conflicted");
    expect(targetSource(commit)).toBe("62db91d");
    expect(targetMode(commit)).toBe("Commit");
  });

  it("compares targets by source, file, and area or commit", () => {
    expect(sameTarget(working("staged"), working("staged"))).toBe(true);
    expect(sameTarget(working("staged"), working("unstaged"))).toBe(false);
    expect(sameTarget(commit, { ...commit })).toBe(true);
    expect(sameTarget(commit, working("staged"))).toBe(false);
    expect(sameTarget(undefined, undefined)).toBe(true);
    expect(sameTarget(undefined, commit)).toBe(false);
  });

  it("explains a diff with no hunks and a binary file", () => {
    expect(diffNotice(diff({}), working("unstaged"))).toBeUndefined();
    expect(diffNotice(diff({ binary: true, hunks: [] }), working("untracked"))).toContain("Binary file");
    expect(diffNotice(diff({ hunks: [] }), working("untracked"))).toBe("This file is empty.");
    expect(diffNotice(diff({ hunks: [] }), working("staged"))).toBe("No staged changes remain in this file.");
    expect(diffNotice(diff({ hunks: [] }), commit)).toBe("No textual change in this file.");
  });

  it("follows a working-tree file to the area it moved to and closes when it left the changes", () => {
    const at = (area: FileChange["area"]): FileChange => ({ path: "src/util.js", original_path: null, area, status: "modified" });
    expect(followTarget([at("unstaged")], working("unstaged"))).toEqual(working("unstaged"));
    expect(followTarget([at("staged")], working("unstaged"))).toEqual(working("staged"));
    expect(followTarget([at("untracked")], working("staged"))).toEqual(working("untracked"));
    expect(followTarget([at("staged"), at("unstaged")], working("untracked"))).toEqual(working("staged"));
    expect(followTarget([at("conflicted"), at("staged")], working("staged"))).toEqual(working("staged"));
    expect(followTarget([], working("staged"))).toBeUndefined();
    expect(followTarget([], commit)).toBe(commit);
  });

  it("recognises only a conflicted working-tree target as a conflict", () => {
    expect(isConflictTarget(working("conflicted"))).toBe(true);
    expect(isConflictTarget(working("staged"))).toBe(false);
    expect(isConflictTarget(commit)).toBe(false);
  });

  it("moves a resolved conflict on to the next conflicted file and closes when none remain", () => {
    const change = (path: string, area: FileChange["area"]): FileChange => ({ path, original_path: null, area, status: "modified" });
    const target: DiffTarget = { source: "working", area: "conflicted", file: "a.txt" };

    expect(followTarget([change("a.txt", "conflicted"), change("b.txt", "conflicted")], target)).toBe(target);
    expect(followTarget([change("a.txt", "staged"), change("b.txt", "conflicted")], target)).toEqual({ source: "working", area: "conflicted", file: "b.txt" });
    expect(followTarget([change("a.txt", "staged")], target)).toBeUndefined();
    expect(followTarget([], target)).toBeUndefined();
  });
});

describe("hunkRows", () => {
  it("adds a note row after a line that lacks a final newline", () => {
    const line = (text: string, no_newline: boolean) => ({ kind: "added" as const, old_number: null, new_number: 1, text, no_newline });
    const hunk = { old_start: 1, old_lines: 0, new_start: 1, new_lines: 2, heading: "", lines: [line("a", false), line("b", true)] };

    expect(hunkRows(hunk).map((row) => row.kind)).toEqual(["line", "line", "note"]);
  });
});
