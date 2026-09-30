import { describe, expect, it } from "vitest";
import type { FileChange } from "../ipc/bindings/FileChange";
import {
  areaOrder,
  canDiscard,
  changeTotal,
  filesIn,
  isPartiallyStaged,
  neighborKey,
  pathsToMove,
  rowKey,
  stagedFileCount,
  statusLetter,
} from "./changes";

describe("changes helpers", () => {
  it("totals every counted status", () => {
    expect(changeTotal({ modified: 1, added: 2, deleted: 3, renamed: 4, untracked: 5, conflicted: 6 })).toBe(21);
  });

  it("maps every status to the letter the design pairs with its color", () => {
    expect(statusLetter).toEqual({
      modified: "M",
      added: "A",
      deleted: "D",
      renamed: "R",
      copied: "C",
      type_changed: "T",
      untracked: "U",
      conflicted: "!",
    });
  });

  it("filters files by area", () => {
    const files: FileChange[] = [
      { path: "a", original_path: null, area: "staged", status: "added" },
      { path: "b", original_path: null, area: "unstaged", status: "modified" },
      { path: "a", original_path: null, area: "unstaged", status: "modified" },
    ];
    expect(filesIn(files, "unstaged").map((file) => file.path)).toEqual(["b", "a"]);
    expect(filesIn(files, "conflicted")).toEqual([]);
  });
});

const change = (path: string, area: FileChange["area"], original_path: string | null = null): FileChange => ({
  path,
  original_path,
  area,
  status: "modified",
});

describe("staging helpers", () => {
  it("lists the sections in the S03 order", () => {
    expect(areaOrder.map((section) => section.area)).toEqual(["conflicted", "unstaged", "untracked", "staged"]);
  });

  it("keys rows by area and path so a file changed on both sides has two rows", () => {
    expect(rowKey(change("a", "staged"))).toBe("staged:a");
    expect(rowKey(change("a", "unstaged"))).not.toBe(rowKey(change("a", "staged")));
  });

  it("counts staged paths once", () => {
    const files = [change("a", "staged"), change("a", "unstaged"), change("b", "staged"), change("c", "untracked")];
    expect(stagedFileCount(files)).toBe(2);
    expect(stagedFileCount([])).toBe(0);
  });

  it("marks a file partially staged on either side when the other side also has changes", () => {
    const files = [change("a", "staged"), change("a", "unstaged"), change("b", "unstaged"), change("c", "untracked")];
    expect(files.map((file) => isPartiallyStaged(files, file))).toEqual([true, true, false, false]);
  });

  it("moves both names of a staged rename and one name otherwise", () => {
    expect(pathsToMove(change("new.txt", "staged", "old.txt"))).toEqual(["old.txt", "new.txt"]);
    expect(pathsToMove(change("new.txt", "unstaged"))).toEqual(["new.txt"]);
  });

  it("allows discarding only unstaged and untracked rows", () => {
    expect((["staged", "unstaged", "untracked", "conflicted"] as const).map((area) => canDiscard(change("a", area)))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it("picks the next row to focus after a row leaves a list, falling back to the previous one", () => {
    expect(neighborKey(["a", "b", "c"], "b")).toBe("c");
    expect(neighborKey(["a", "b", "c"], "c")).toBe("b");
    expect(neighborKey(["a"], "a")).toBeUndefined();
    expect(neighborKey(["a"], "zzz")).toBeUndefined();
  });
});
