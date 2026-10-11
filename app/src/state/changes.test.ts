import { describe, expect, it } from "vitest";
import type { FileChange } from "../ipc/bindings/FileChange";
import {
  areaOrder,
  canDiscard,
  changeTotal,
  extendSelection,
  filesIn,
  folderDiscardFiles,
  folderMenuEntries,
  folderStashPaths,
  isPartiallyStaged,
  neighborKey,
  pathsToMove,
  pruneSelection,
  rowKey,
  selectAll,
  selectOnly,
  selectedFiles,
  selectionMenuEntries,
  stagedFileCount,
  toggleSelected,
} from "./changes";
import * as changes from "./changes";

const file = (path: string, area: FileChange["area"]): FileChange => ({ path, original_path: null, area, status: "modified" });

describe("changes helpers", () => {
  it("totals every counted status", () => {
    expect(changeTotal({ modified: 1, added: 2, deleted: 3, renamed: 4, untracked: 5, conflicted: 6 })).toBe(21);
  });

  it("maps every file status to its approved icon with no letter mapping", () => {
    expect(changes).toHaveProperty("statusIcon", {
      modified: "edit",
      added: "plus",
      deleted: "minus",
      renamed: "renamed",
      copied: "copy",
      type_changed: "type_changed",
      untracked: "untracked",
      conflicted: "warning",
    });
    expect(changes).not.toHaveProperty("statusLetter");
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

describe("folder actions", () => {
  const files = [
    change("src/ui/a.ts", "staged"),
    change("src/ui/a.ts", "unstaged"),
    change("src/ui/b.ts", "untracked"),
    change("src/ui/old.ts", "staged"),
    change("src/ui/renamed.ts", "staged", "src/old.ts"),
    change("src/ui/c.ts", "conflicted"),
    change("src/uix/other.ts", "unstaged"),
    change("README.md", "unstaged"),
  ];

  it("stashes every changed path under the folder once, staged rename origins included, conflicted and sibling folders left out", () => {
    expect(folderStashPaths(files, "src/ui")).toEqual(["src/ui/a.ts", "src/ui/b.ts", "src/ui/old.ts", "src/old.ts", "src/ui/renamed.ts"]);
  });

  it("discards only the unstaged and untracked rows under the folder", () => {
    expect(folderDiscardFiles(files, "src/ui").map((file) => file.path)).toEqual(["src/ui/a.ts", "src/ui/b.ts"]);
    expect(folderDiscardFiles(files, "src")).toHaveLength(3);
  });

  it("offers Stage or Unstage, Stash, and Discard in the folder menu, disabling Discard with its reason when nothing can be discarded", () => {
    const items = (staged: boolean, discardable: number) =>
      folderMenuEntries(staged, discardable).flatMap((entry) => (entry.kind === "item" ? [[entry.id, entry.label.join(""), entry.danger === true, entry.disabledReason]] : []));
    expect(items(false, 2)).toEqual([
      ["move", "Stage folder", false, undefined],
      ["stash", "Stash folder", false, undefined],
      ["discard", "Discard all changes in folder", true, undefined],
    ]);
    expect(items(true, 0)).toEqual([
      ["move", "Unstage folder", false, undefined],
      ["stash", "Stash folder", false, undefined],
      ["discard", "Discard all changes in folder", true, "No unstaged or untracked changes in this folder"],
    ]);
  });
});

describe("file multi-select (S62)", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("selects one file, and toggles a file in or out of the same list", () => {
    const one = selectOnly("unstaged", "b");
    expect(one).toEqual({ area: "unstaged", paths: ["b"], anchor: "b" });

    const two = toggleSelected(one, "unstaged", "d");
    expect(two).toEqual({ area: "unstaged", paths: ["b", "d"], anchor: "d" });
    expect(toggleSelected(two, "unstaged", "b")).toEqual({ area: "unstaged", paths: ["d"], anchor: "b" });
    expect(toggleSelected(selectOnly("unstaged", "b"), "unstaged", "b")).toBeUndefined();
  });

  it("never spans two lists: toggling or extending in another list starts over there", () => {
    const staged = selectOnly("staged", "a");

    expect(toggleSelected(staged, "unstaged", "b")).toEqual(selectOnly("unstaged", "b"));
    expect(extendSelection(staged, "untracked", order, "c", undefined)).toEqual(selectOnly("untracked", "c"));
  });

  it("extends a range from the anchor in either direction and keeps the anchor", () => {
    const from = selectOnly("unstaged", "b");

    const down = extendSelection(from, "unstaged", order, "d", "b");
    expect(down).toEqual({ area: "unstaged", paths: ["b", "c", "d"], anchor: "b" });
    expect(extendSelection(down, "unstaged", order, "a", "b")).toEqual({ area: "unstaged", paths: ["a", "b"], anchor: "b" });
  });

  it("extends from the start row when nothing in the list is selected yet", () => {
    expect(extendSelection(undefined, "unstaged", order, "d", "b")).toEqual({ area: "unstaged", paths: ["b", "c", "d"], anchor: "b" });
    expect(extendSelection(undefined, "unstaged", order, "d", undefined)).toEqual(selectOnly("unstaged", "d"));
  });

  it("selects the whole list, and prunes files that left it", () => {
    expect(selectAll("staged", order)).toEqual({ area: "staged", paths: order, anchor: "a" });
    expect(selectAll("staged", [])).toBeUndefined();

    const files = [file("a", "staged"), file("c", "staged"), file("b", "unstaged")];
    expect(pruneSelection({ area: "staged", paths: ["a", "b", "c"], anchor: "b" }, files)).toEqual({ area: "staged", paths: ["a", "c"], anchor: "a" });
    expect(pruneSelection({ area: "staged", paths: ["b"], anchor: "b" }, files)).toBeUndefined();
    expect(pruneSelection(undefined, files)).toBeUndefined();
  });

  it("lists the selected files in list order", () => {
    const files = [file("a", "unstaged"), file("b", "unstaged"), file("b", "staged"), file("c", "unstaged")];

    expect(selectedFiles({ area: "unstaged", paths: ["c", "b"], anchor: "c" }, files).map(rowKey)).toEqual(["unstaged:b", "unstaged:c"]);
  });

  it("words the menu for the whole selection in the S62 order, with a separator before Create patch", () => {
    const files = [file("src/a.ts", "unstaged"), file("src/b.ts", "unstaged"), file("c.ts", "unstaged")];

    const entries = selectionMenuEntries(files);

    expect(entries.map((entry) => (entry.kind === "separator" ? "-" : [entry.id, entry.label.join("")]))).toEqual([
      ["move", "Stage 3 files"],
      ["discard", "Discard 3 files"],
      ["ignore", "Ignore 3 files"],
      ["stash", "Stash 3 files"],
      "-",
      ["patch", "Create patch from changes in 3 files"],
    ]);
    expect(entries.find((entry) => entry.kind === "item" && entry.id === "discard")).toMatchObject({ danger: true });
  });

  it("words a staged selection with Unstage and one selected file for that file", () => {
    const [stage, ...rest] = selectionMenuEntries([file("src/a.ts", "staged"), file("b.ts", "staged")]);
    expect(stage).toMatchObject({ id: "move", label: ["Unstage 2 files"] });
    expect(rest).toHaveLength(5);

    const single = selectionMenuEntries([file("src/a.ts", "untracked")]);
    expect(single.map((entry) => (entry.kind === "separator" ? "-" : entry.label.join("")))).toEqual([
      "Stage a.ts",
      "Discard a.ts",
      "Ignore a.ts",
      "Stash a.ts",
      "-",
      "Create patch from changes in a.ts",
    ]);
  });
});
