import { describe, expect, it } from "vitest";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { RecomposePreview } from "../ipc/bindings/RecomposePreview";
import {
  addGroup,
  assign,
  catalogOf,
  describeGroup,
  fromGroups,
  groupOf,
  groupsOf,
  moveGroup,
  newDraft,
  problemsOf,
  progressOf,
  removeGroup,
  renameGroup,
} from "./recomposeModel";

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, old_number: 1, new_number: 1, text, no_newline: false });
const hunk = (lines: DiffLine[]) => ({ old_start: 1, old_lines: 3, new_start: 1, new_lines: 3, heading: "", lines });

const preview: RecomposePreview = {
  base: "b",
  head: "h",
  pushed: false,
  files: [
    {
      path: "a.txt",
      status: "modified",
      binary: false,
      whole_file_only: false,
      hunks: [
        { id: "a.txt@1,3+1,3", hunk: hunk([line("context", "x"), line("removed", "old"), line("added", "new"), line("added", "more")]) },
        { id: "a.txt@20,3+20,3", hunk: hunk([line("removed", "gone")]) },
      ],
    },
    { path: "logo.png", status: "added", binary: true, whole_file_only: true, hunks: [] },
    { path: "empty.txt", status: "added", binary: false, whole_file_only: false, hunks: [] },
  ],
};
const catalog = catalogOf(preview);

describe("catalog", () => {
  it("counts the changed lines of each hunk and treats binary and hunkless files as whole-file units", () => {
    expect(catalog.map((file) => [file.path, file.whole])).toEqual([["a.txt", false], ["logo.png", true], ["empty.txt", true]]);
    expect(catalog[0]?.hunks.map((unit) => [unit.id, unit.changed, unit.added, unit.removed])).toEqual([
      ["a.txt@1,3+1,3", [1, 2, 3], 2, 1],
      ["a.txt@20,3+20,3", [0], 0, 1],
    ]);
  });
});

describe("groups", () => {
  it("starts with one empty commit and adds, renames, moves, and removes commits", () => {
    let draft = newDraft();
    expect(draft.groups).toEqual([{ id: 1, message: "" }]);
    draft = renameGroup(addGroup(draft), 2, "Second");
    expect(draft.groups).toEqual([{ id: 1, message: "" }, { id: 2, message: "Second" }]);
    draft = moveGroup(draft, 2, -1);
    expect(draft.groups.map((group) => group.id)).toEqual([2, 1]);
    expect(moveGroup(draft, 2, -1).groups.map((group) => group.id)).toEqual([2, 1]);
    draft = removeGroup(draft, 2);
    expect(draft.groups.map((group) => group.id)).toEqual([1]);
  });

  it("unassigns the changes of a removed commit", () => {
    let draft = addGroup(newDraft());
    draft = assign(draft, catalog, { kind: "file", path: "a.txt" }, 2);
    draft = removeGroup(draft, 2);
    expect(groupOf(draft, catalog, { kind: "file", path: "a.txt" })).toBeUndefined();
  });
});

describe("assignment", () => {
  it("assigns a whole file, a hunk, or chosen lines, and reads the assignment back", () => {
    let draft = addGroup(newDraft());
    draft = assign(draft, catalog, { kind: "hunk", id: "a.txt@1,3+1,3" }, 1);
    draft = assign(draft, catalog, { kind: "lines", id: "a.txt@20,3+20,3", lines: [0] }, 2);
    expect(groupOf(draft, catalog, { kind: "hunk", id: "a.txt@1,3+1,3" })).toBe(1);
    expect(groupOf(draft, catalog, { kind: "hunk", id: "a.txt@20,3+20,3" })).toBe(2);
    expect(groupOf(draft, catalog, { kind: "file", path: "a.txt" })).toBe("mixed");
    draft = assign(draft, catalog, { kind: "file", path: "a.txt" }, 2);
    expect(groupOf(draft, catalog, { kind: "file", path: "a.txt" })).toBe(2);
    draft = assign(draft, catalog, { kind: "file", path: "a.txt" }, undefined);
    expect(groupOf(draft, catalog, { kind: "file", path: "a.txt" })).toBeUndefined();
  });

  it("moves a change between commits so it belongs to exactly one", () => {
    let draft = addGroup(newDraft());
    draft = assign(draft, catalog, { kind: "file", path: "logo.png" }, 1);
    draft = assign(draft, catalog, { kind: "file", path: "logo.png" }, 2);
    expect(groupsOf(draft, catalog).flatMap((group) => group.changes)).toEqual([{ kind: "file", path: "logo.png" }]);
    expect(groupsOf(draft, catalog)[1]?.changes).toEqual([{ kind: "file", path: "logo.png" }]);
  });

  it("ignores context lines when assigning lines", () => {
    const draft = assign(newDraft(), catalog, { kind: "lines", id: "a.txt@1,3+1,3", lines: [0, 1] }, 1);
    expect(groupsOf(draft, catalog)[0]?.changes).toEqual([{ kind: "lines", id: "a.txt@1,3+1,3", lines: [1] }]);
  });
});

describe("output for recompose_apply", () => {
  it("emits a file when every change of a splittable file is in one commit, else hunks, else lines", () => {
    let draft = addGroup(newDraft());
    draft = assign(draft, catalog, { kind: "file", path: "a.txt" }, 1);
    expect(groupsOf(draft, catalog)[0]?.changes).toEqual([{ kind: "file", path: "a.txt" }]);
    draft = assign(draft, catalog, { kind: "hunk", id: "a.txt@20,3+20,3" }, 2);
    expect(groupsOf(draft, catalog)[0]?.changes).toEqual([{ kind: "hunk", id: "a.txt@1,3+1,3" }]);
    expect(groupsOf(draft, catalog)[1]?.changes).toEqual([{ kind: "hunk", id: "a.txt@20,3+20,3" }]);
    draft = assign(draft, catalog, { kind: "lines", id: "a.txt@1,3+1,3", lines: [3] }, 2);
    expect(groupsOf(draft, catalog)[0]?.changes).toEqual([{ kind: "lines", id: "a.txt@1,3+1,3", lines: [1, 2] }]);
    expect(groupsOf(draft, catalog)[1]?.changes).toEqual(
      expect.arrayContaining([{ kind: "lines", id: "a.txt@1,3+1,3", lines: [3] }, { kind: "hunk", id: "a.txt@20,3+20,3" }]),
    );
  });

  it("carries the message of each commit in order", () => {
    const draft = assign(renameGroup(newDraft(), 1, "Only"), catalog, { kind: "file", path: "logo.png" }, 1);
    expect(groupsOf(draft, catalog)).toEqual([{ message: "Only", changes: [{ kind: "file", path: "logo.png" }] }]);
  });
});

describe("validation", () => {
  it("lists what blocks Apply: unassigned paths, blank messages, and empty commits", () => {
    let draft = addGroup(newDraft());
    const first = problemsOf(draft, catalog);
    expect(first.ready).toBe(false);
    expect(first.general).toEqual(["Changes not assigned to any commit: a.txt, logo.png, empty.txt"]);
    expect(first.groups).toEqual({ 1: "Enter a message", 2: "Enter a message" });
    draft = renameGroup(renameGroup(draft, 1, "One"), 2, "Two");
    draft = assign(assign(assign(draft, catalog, { kind: "file", path: "a.txt" }, 1), catalog, { kind: "file", path: "logo.png" }, 1), catalog, { kind: "file", path: "empty.txt" }, 1);
    const second = problemsOf(draft, catalog);
    expect(second.groups).toEqual({ 2: "This commit has no changes" });
    expect(second.ready).toBe(false);
    draft = removeGroup(draft, 2);
    expect(problemsOf(draft, catalog)).toEqual({ general: [], groups: {}, ready: true });
  });

  it("counts assigned and total changes", () => {
    const draft = assign(newDraft(), catalog, { kind: "hunk", id: "a.txt@1,3+1,3" }, 1);
    expect(progressOf(draft, catalog)).toEqual({ total: 6, assigned: 3 });
  });
});

describe("from an AI proposal", () => {
  it("builds commits from file and hunk changes, keeping the message, so the user can edit them", () => {
    const draft = fromGroups(
      [
        { message: "Docs", changes: [{ kind: "file", path: "logo.png" }, { kind: "hunk", id: "a.txt@20,3+20,3" }] },
        { message: "Rest", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "file", path: "empty.txt" }] },
      ],
      catalog,
    );
    expect(draft.groups.map((group) => group.message)).toEqual(["Docs", "Rest"]);
    expect(problemsOf(draft, catalog).ready).toBe(true);
    expect(groupOf(draft, catalog, { kind: "hunk", id: "a.txt@20,3+20,3" })).toBe(draft.groups[0]?.id);
  });
});

describe("describeGroup", () => {
  it("summarizes what a commit holds per file", () => {
    let draft = newDraft();
    draft = assign(draft, catalog, { kind: "hunk", id: "a.txt@1,3+1,3" }, 1);
    draft = assign(draft, catalog, { kind: "file", path: "logo.png" }, 1);
    expect(describeGroup(draft, catalog, 1)).toEqual([
      { path: "a.txt", scope: "1 of 2 hunks", added: 2, removed: 1 },
      { path: "logo.png", scope: "whole file", added: 0, removed: 0 },
    ]);
  });
});
