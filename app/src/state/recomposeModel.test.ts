import { describe, expect, it } from "vitest";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { RecomposeGroup } from "../ipc/bindings/RecomposeGroup";
import type { RecomposePreview } from "../ipc/bindings/RecomposePreview";
import { catalogOf, describeGroup, fromGroups, groupsOf, problemsOf, progressOf } from "./recomposeModel";

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
      hunks_omitted: null,
      hunks: [
        { id: "a.txt@1,3+1,3", hunk: hunk([line("context", "x"), line("removed", "old"), line("added", "new"), line("added", "more")]) },
        { id: "a.txt@20,3+20,3", hunk: hunk([line("removed", "gone")]) },
      ],
    },
    { path: "logo.png", status: "added", binary: true, whole_file_only: true, hunks_omitted: null, hunks: [] },
    { path: "empty.txt", status: "added", binary: false, whole_file_only: false, hunks_omitted: null, hunks: [] },
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

describe("catalog of a file whose hunks the core omitted", () => {
  const reason = "The diff of big.sql is 3000000 bytes, over the 2097152 byte limit.";
  const omitted = catalogOf({ ...preview, files: [{ path: "big.sql", status: "modified", binary: false, whole_file_only: true, hunks_omitted: reason, hunks: [] }] });

  it("keeps the reason on the whole-file unit and assigns it as one file", () => {
    expect(omitted[0]).toMatchObject({ path: "big.sql", whole: true, omitted: reason, hunks: [] });
    const draft = fromGroups([{ message: "Big", changes: [{ kind: "file", path: "big.sql" }] }], omitted);
    expect(groupsOf(draft, omitted)[0]?.changes).toEqual([{ kind: "file", path: "big.sql" }]);
    expect(progressOf(draft, omitted)).toEqual({ total: 1, assigned: 1 });
  });

  it("has no omission reason for a file whose hunks were sent", () => {
    expect(catalog.map((file) => file.omitted)).toEqual([null, null, null]);
  });
});

const plan: RecomposeGroup[] = [
  { message: "Docs", changes: [{ kind: "file", path: "logo.png" }, { kind: "hunk", id: "a.txt@20,3+20,3" }] },
  { message: "Rest", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "file", path: "empty.txt" }] },
];

describe("a plan from the AI proposal", () => {
  it("builds one commit per proposed group, in order, with its message", () => {
    const draft = fromGroups(plan, catalog);
    expect(draft.groups.map((group) => group.message)).toEqual(["Docs", "Rest"]);
    expect(problemsOf(draft, catalog)).toEqual({ general: [], groups: {}, ready: true });
    expect(progressOf(draft, catalog)).toEqual({ total: 6, assigned: 6 });
  });

  it("emits the proposed changes for recompose_apply, folding a fully assigned splittable file into one file change", () => {
    const whole = fromGroups([{ message: "All of a", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "hunk", id: "a.txt@20,3+20,3" }] }], catalog);
    expect(groupsOf(whole, catalog)).toEqual([{ message: "All of a", changes: [{ kind: "file", path: "a.txt" }] }]);
    expect(groupsOf(fromGroups(plan, catalog), catalog)).toEqual([
      { message: "Docs", changes: [{ kind: "hunk", id: "a.txt@20,3+20,3" }, { kind: "file", path: "logo.png" }] },
      { message: "Rest", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "file", path: "empty.txt" }] },
    ]);
  });

  it("splits a hunk into lines only for the changed lines of a proposed lines change and ignores context lines", () => {
    const draft = fromGroups([{ message: "Part", changes: [{ kind: "lines", id: "a.txt@1,3+1,3", lines: [0, 1] }] }], catalog);
    expect(groupsOf(draft, catalog)[0]?.changes).toEqual([{ kind: "lines", id: "a.txt@1,3+1,3", lines: [1] }]);
  });

  it("blocks apply and names the unassigned paths, a blank message, and an empty commit", () => {
    const draft = fromGroups([{ message: " ", changes: [{ kind: "file", path: "logo.png" }] }, { message: "Nothing", changes: [] }], catalog);
    const problems = problemsOf(draft, catalog);
    expect(problems.ready).toBe(false);
    expect(problems.general).toEqual(["Changes not assigned to any commit: a.txt, empty.txt"]);
    expect(problems.groups).toEqual({ 1: "Enter a message", 2: "This commit has no changes" });
  });

  it("blocks apply for a proposal with no commits", () => {
    expect(problemsOf(fromGroups([], catalog), catalog).general).toContain("The proposal has no commits");
  });

  it("counts a long list of unassigned changes and names only the first three", () => {
    const many = catalogOf({
      ...preview,
      files: Array.from({ length: 245 }, (_, index) => ({ path: `src/file${index}.ts`, status: "added" as const, binary: true, whole_file_only: true, hunks_omitted: null, hunks: [] })),
    });
    expect(problemsOf(fromGroups([], many), many).general[0]).toBe("Changes not assigned to any commit: 245 files: src/file0.ts, src/file1.ts, src/file2.ts and 242 more");
  });

  it("counts a partial proposal as partly assigned", () => {
    const draft = fromGroups([{ message: "One", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }] }], catalog);
    expect(progressOf(draft, catalog)).toEqual({ total: 6, assigned: 3 });
  });
});

describe("describeGroup", () => {
  it("summarizes what a commit holds per file", () => {
    const draft = fromGroups([{ message: "One", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "file", path: "logo.png" }] }], catalog);
    expect(describeGroup(draft, catalog, 1)).toEqual([
      { path: "a.txt", scope: "1 of 2 hunks", added: 2, removed: 1 },
      { path: "logo.png", scope: "whole file", added: 0, removed: 0 },
    ]);
  });
});
