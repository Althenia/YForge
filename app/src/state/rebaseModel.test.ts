import { describe, expect, it } from "vitest";
import type { RebasePlan } from "../ipc/bindings/RebasePlan";
import type { RebaseResult } from "../ipc/bindings/RebaseResult";
import {
  dirtyReason,
  editableMessages,
  moveRow,
  moveRowTo,
  outcomeNotice,
  previewOf,
  pushedRewriteWarning,
  rowsOf,
  setAction,
  setMessage,
  squashMessage,
  squashOrder,
  squashProblem,
  stepsOf,
  validate,
  type RebaseRow,
} from "./rebaseModel";

const todo = (sha: string, summary: string, extra: Partial<RebasePlan["commits"][number]> = {}) => ({ sha, summary, author: { name: "Yui", initials: "Y" }, is_merge: false, pushed: false, ...extra });
const plan = (overrides: Partial<RebasePlan> = {}): RebasePlan => ({
  base: "base000",
  commits: [todo("aaa1111", "First"), todo("bbb2222", "Second"), todo("ccc3333", "Third")],
  pushed: false,
  ...overrides,
});
const full: Record<string, string> = { aaa1111: "First\n\nbody one", bbb2222: "Second", ccc3333: "Third\n\nbody three" };
const messageOf = (row: RebaseRow) => full[row.sha] ?? row.summary;
const shas = (rows: readonly RebaseRow[]) => rows.map((row) => row.sha);

describe("rows", () => {
  it("lists the commits newest first, as the graph does, every row picked", () => {
    const rows = rowsOf(plan());
    expect(shas(rows)).toEqual(["ccc3333", "bbb2222", "aaa1111"]);
    expect(rows.every((row) => row.action === "pick" && row.message === undefined)).toBe(true);
  });

  it("moves a row one step up or down and stops at the ends", () => {
    const rows = rowsOf(plan());
    expect(shas(moveRow(rows, "bbb2222", -1))).toEqual(["bbb2222", "ccc3333", "aaa1111"]);
    expect(shas(moveRow(rows, "bbb2222", 1))).toEqual(["ccc3333", "aaa1111", "bbb2222"]);
    expect(shas(moveRow(rows, "ccc3333", -1))).toEqual(["ccc3333", "bbb2222", "aaa1111"]);
    expect(shas(moveRow(rows, "aaa1111", 1))).toEqual(["ccc3333", "bbb2222", "aaa1111"]);
  });

  it("moves a row to a dropped-on position", () => {
    const rows = rowsOf(plan());
    expect(shas(moveRowTo(rows, "ccc3333", 2))).toEqual(["bbb2222", "aaa1111", "ccc3333"]);
    expect(shas(moveRowTo(rows, "aaa1111", 0))).toEqual(["aaa1111", "ccc3333", "bbb2222"]);
  });

  it("sets an action and a message on one row", () => {
    const rows = setMessage(setAction(rowsOf(plan()), "bbb2222", "reword"), "bbb2222", "Renamed");
    expect(rows.find((row) => row.sha === "bbb2222")).toMatchObject({ action: "reword", message: "Renamed" });
  });
});

describe("steps for rebase_interactive", () => {
  it("runs oldest first, with the reworded message and the joined run message", () => {
    let rows = rowsOf(plan());
    rows = setAction(rows, "aaa1111", "reword");
    rows = setMessage(rows, "aaa1111", "First, reworded");
    rows = setAction(rows, "ccc3333", "squash");
    expect(stepsOf(rows, messageOf)).toEqual([
      { kind: "reword", sha: "aaa1111", message: "First, reworded" },
      { kind: "pick", sha: "bbb2222" },
      { kind: "squash", sha: "ccc3333", message: "Second\n\nThird\n\nbody three" },
    ]);
  });

  it("uses the explicit message of the last squash for the whole run and omits a fixup's message", () => {
    let rows = rowsOf(plan());
    rows = setAction(setAction(rows, "bbb2222", "squash"), "ccc3333", "squash");
    rows = setMessage(rows, "ccc3333", "Combined");
    expect(stepsOf(rows, messageOf)).toEqual([
      { kind: "pick", sha: "aaa1111" },
      { kind: "squash", sha: "bbb2222", message: "Combined" },
      { kind: "squash", sha: "ccc3333", message: "Combined" },
    ]);
    const fixed = setAction(rowsOf(plan()), "bbb2222", "fixup");
    expect(stepsOf(fixed, messageOf)).toContainEqual({ kind: "fixup", sha: "bbb2222" });
  });

  it("carries drop and edit steps and follows the dragged order", () => {
    let rows = moveRow(rowsOf(plan()), "ccc3333", 1);
    rows = setAction(setAction(rows, "aaa1111", "drop"), "ccc3333", "edit");
    expect(stepsOf(rows, messageOf)).toEqual([
      { kind: "drop", sha: "aaa1111" },
      { kind: "edit", sha: "ccc3333" },
      { kind: "pick", sha: "bbb2222" },
    ]);
  });
});

describe("validation mirrors the core", () => {
  it("accepts an unchanged list but reports nothing to apply", () => {
    const result = validate(rowsOf(plan()), plan(), messageOf);
    expect(result).toMatchObject({ problems: [], rowProblems: {}, changed: false, canApply: false });
  });

  it("refuses a squash or fixup with no earlier kept commit", () => {
    const rows = setAction(rowsOf(plan()), "aaa1111", "squash");
    const result = validate(rows, plan(), messageOf);
    expect(result.rowProblems.aaa1111).toBe("Nothing below to combine with. Move it above another kept commit, or pick it.");
    expect(result.canApply).toBe(false);
    const dropped = setAction(setAction(rowsOf(plan()), "aaa1111", "drop"), "bbb2222", "fixup");
    expect(validate(dropped, plan(), messageOf).rowProblems.bbb2222).toBeDefined();
  });

  it("refuses a blank or NUL message on reword and squash", () => {
    let rows = setAction(rowsOf(plan()), "bbb2222", "reword");
    rows = setMessage(rows, "bbb2222", "  ");
    expect(validate(rows, plan(), messageOf).rowProblems.bbb2222).toBe("Enter a message");
    rows = setMessage(rows, "bbb2222", "a\0b");
    expect(validate(rows, plan(), messageOf).rowProblems.bbb2222).toBe("The message cannot contain a NUL character");
    const squashed = setMessage(setAction(rowsOf(plan()), "ccc3333", "squash"), "ccc3333", "");
    expect(validate(squashed, plan(), messageOf).rowProblems.ccc3333).toBe("Enter a message");
  });

  it("refuses a range that holds a merge commit", () => {
    const merged = plan({ commits: [todo("aaa1111", "First"), todo("bbb2222", "Merge", { is_merge: true })] });
    const result = validate(setAction(rowsOf(merged), "aaa1111", "drop"), merged, messageOf);
    expect(result.problems).toEqual(["This range contains a merge commit. Interactive rebase does not support merge commits."]);
    expect(result.canApply).toBe(false);
  });

  it("allows Apply for a valid change and states that dropping everything returns to the base", () => {
    const changed = validate(setAction(rowsOf(plan()), "bbb2222", "drop"), plan(), messageOf);
    expect(changed).toMatchObject({ canApply: true, changed: true, dropsAll: false });
    let rows = rowsOf(plan());
    for (const sha of shas(rows)) rows = setAction(rows, sha, "drop");
    expect(validate(rows, plan(), messageOf)).toMatchObject({ canApply: true, dropsAll: true });
  });

  it("treats a reorder alone as a change", () => {
    expect(validate(moveRow(rowsOf(plan()), "bbb2222", -1), plan(), messageOf).canApply).toBe(true);
  });
});

describe("preview of the resulting history", () => {
  it("lists the resulting commits newest first with their sources and the dropped ones", () => {
    let rows = rowsOf(plan());
    rows = setAction(rows, "aaa1111", "drop");
    rows = setAction(rows, "ccc3333", "squash");
    const preview = previewOf(rows, messageOf);
    expect(preview.commits).toEqual([
      { subject: "Second", from: ["bbb2222", "ccc3333"], kind: "combined", stops: false },
    ]);
    expect(preview.dropped.map((row) => row.sha)).toEqual(["aaa1111"]);
  });

  it("shows a reworded subject and marks an edit stop", () => {
    let rows = rowsOf(plan());
    rows = setMessage(setAction(rows, "bbb2222", "reword"), "bbb2222", "Second, better\n\nmore");
    rows = setAction(rows, "aaa1111", "edit");
    expect(previewOf(rows, messageOf).commits).toEqual([
      { subject: "Third", from: ["ccc3333"], kind: "kept", stops: false },
      { subject: "Second, better", from: ["bbb2222"], kind: "reworded", stops: false },
      { subject: "First", from: ["aaa1111"], kind: "kept", stops: true },
    ]);
  });
});

describe("pushed warning and outcome notices", () => {
  it("names how many of the commits are already on the upstream", () => {
    const rows = rowsOf(plan({ commits: [todo("aaa1111", "First", { pushed: true }), todo("bbb2222", "Second", { pushed: true }), todo("ccc3333", "Third")], pushed: true }));
    expect(pushedRewriteWarning(rows, "origin/main")).toBe("2 of these commits are already on origin/main. Rewriting them means the next push needs a force push.");
    expect(pushedRewriteWarning(rowsOf(plan()), "origin/main")).toBeUndefined();
    expect(pushedRewriteWarning(rows.slice(1, 2), undefined)).toBe("1 of these commits is already on its upstream. Rewriting it means the next push needs a force push.");
  });

  it("reports conflicts, an edit stop, dropped-all, and pushed rewrites, and nothing for a plain completion", () => {
    const result = (overrides: Partial<RebaseResult>): RebaseResult => ({ outcome: "completed", pushed: false, dropped_all: false, ...overrides });
    expect(outcomeNotice(result({ outcome: "conflicts" }), "Interactive rebase")).toBe("Interactive rebase stopped on conflicts. Resolve them, then continue, or abort.");
    expect(outcomeNotice(result({ outcome: "stopped_to_edit" }), "Interactive rebase")).toBe("Interactive rebase stopped to edit a commit. Amend it or change files, then Continue.");
    expect(outcomeNotice(result({ dropped_all: true }), "Interactive rebase")).toBe("Every commit was dropped. The branch is back at the base.");
    expect(outcomeNotice(result({ pushed: true }), "Squash")).toBe("Commits that are already on the upstream were rewritten. The next push needs a force push.");
    expect(outcomeNotice(result({}), "Squash")).toBeUndefined();
  });
});

describe("squash selection", () => {
  const commit = (sha: string, ...parents: string[]) => ({ sha, parents });

  it("accepts a contiguous run and orders it oldest first", () => {
    const run = [commit("c", "b"), commit("b", "a"), commit("a", "z")];
    expect(squashProblem(run)).toBeUndefined();
    expect(squashOrder(run)).toEqual(["a", "b", "c"]);
  });

  it("names why a selection cannot be squashed", () => {
    expect(squashProblem([commit("a", "z")])).toBe("Select at least two commits");
    expect(squashProblem([commit("c", "b"), commit("a", "z")])).toBe("The selected commits are not one contiguous run of the current branch");
    expect(squashProblem([commit("c", "b"), commit("b", "a", "x")])).toBe("A merge commit cannot be squashed");
    expect(squashProblem([commit("b", "a"), commit("a")])).toBe("The oldest selected commit has no parent, so there is nothing to rebase onto");
  });

  it("joins the selected messages oldest first", () => {
    expect(squashMessage(["First\n\nbody", "Second"])).toBe("First\n\nbody\n\nSecond");
  });
});

describe("dirty working tree", () => {
  const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

  it("blocks a rewrite while tracked files or the index have changes and ignores untracked files", () => {
    expect(dirtyReason(counts)).toBeUndefined();
    expect(dirtyReason({ ...counts, untracked: 4 })).toBeUndefined();
    for (const key of ["modified", "added", "deleted", "renamed", "conflicted"] as const) {
      expect(dirtyReason({ ...counts, [key]: 1 })).toBe("Commit, stash, or discard your changes first. Git will not rewrite history over changes to tracked files.");
    }
  });
});

describe("editable messages", () => {
  it("gives a message editor to each reworded commit and to the last squash of each run, with its effective text", () => {
    let rows = rowsOf(plan());
    expect(editableMessages(rows, messageOf)).toEqual({});
    rows = setAction(rows, "aaa1111", "reword");
    rows = setAction(setAction(rows, "ccc3333", "squash"), "bbb2222", "pick");
    expect(editableMessages(rows, messageOf)).toEqual({ aaa1111: "First\n\nbody one", ccc3333: "Second\n\nThird\n\nbody three" });
    rows = setMessage(rows, "ccc3333", "Mine");
    expect(editableMessages(rows, messageOf).ccc3333).toBe("Mine");
  });
});
