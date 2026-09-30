import { describe, expect, it } from "vitest";
import type { Operation } from "../ipc/bindings/Operation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { abortCopy, conflictDescription, conflictLabel, conflictSides, firstConflict, operationButtons, operationSummary, operationTitle, stepLabel } from "./operationModel";

const snapshot = (operation: Operation | null, detail: Partial<NonNullable<RepoSnapshot["operation_detail"]>> = {}, files: RepoSnapshot["files"] = []): RepoSnapshot =>
  ({
    head: { kind: "branch", name: "main", sha: "a" },
    operation,
    operation_detail: operation === null ? null : { current: "main", incoming: null, message: "", step: null, resolved: [], ...detail },
    files,
  }) as RepoSnapshot;

const flat = (parts: ReturnType<typeof operationSummary>) => parts.map((part) => (typeof part === "string" ? part : part.ref)).join("");

describe("operation banner summary", () => {
  it("names what is merged into which branch", () => {
    expect(flat(operationSummary(snapshot("merge", { incoming: "origin/main" })))).toBe("Merging origin/main into main");
  });

  it("names the rebased branch and reads the step aloud as 'step k of n'", () => {
    const rebase = snapshot("rebase", { incoming: "feature/x", step: { current: 2, total: 5 } });

    expect(flat(operationSummary(rebase))).toBe("Rebasing feature/x");
    expect(stepLabel(rebase)).toBe("step 2 of 5");
    expect(stepLabel(snapshot("merge"))).toBeUndefined();
  });

  it("describes cherry-picks and reverts and copes with a missing detail", () => {
    expect(flat(operationSummary(snapshot("cherry_pick", { incoming: "abc1234 Fix" })))).toBe("Cherry-picking abc1234 Fix");
    expect(flat(operationSummary(snapshot("revert")))).toBe("Reverting a commit");
    expect(operationSummary(snapshot(null))).toEqual([]);
  });

  it("describes a cherry-pick or revert sequence with or without a stopped commit", () => {
    expect(flat(operationSummary(snapshot("cherry_pick_sequence", { incoming: "abc1234 Topic one" })))).toBe("Cherry-picking abc1234 Topic one");
    expect(flat(operationSummary(snapshot("cherry_pick_sequence")))).toBe("Cherry-picking a sequence of commits");
    expect(flat(operationSummary(snapshot("revert_sequence", { incoming: "abc1234 Two" })))).toBe("Reverting abc1234 Two");
    expect(flat(operationSummary(snapshot("revert_sequence")))).toBe("Reverting a sequence of commits");
  });

  it("names where a bisect returns to when it is reset", () => {
    expect(flat(operationSummary(snapshot("bisect", { current: "feature/x" })))).toBe("Bisecting · Reset returns to feature/x");
    expect(operationTitle.bisect).toBe("Bisecting");
  });

  it("pluralizes the conflict count", () => {
    expect([conflictLabel(1), conflictLabel(3)]).toEqual(["1 conflict", "3 conflicts"]);
  });
});

describe("operation buttons", () => {
  it("blocks continuing until nothing is conflicted and names how many remain", () => {
    expect(operationButtons("rebase", 2, false).continue).toEqual({ label: "Continue", disabledReason: "Resolve 2 conflicts first" });
    expect(operationButtons("rebase", 0, false).continue.disabledReason).toBeUndefined();
    expect(operationButtons("merge", 0, false).continue.label).toBe("Complete merge");
    expect(operationButtons("merge", 0, true).continue.disabledReason).toBe("Working…");
  });

  it("offers Skip for a rebase and for cherry-pick and revert sequences, and labels the abort by operation", () => {
    for (const operation of ["rebase", "cherry_pick_sequence", "revert_sequence"] as const) expect(operationButtons(operation, 0, false).skip).toBe(true);
    for (const operation of ["merge", "cherry_pick", "revert", "bisect"] as const) expect(operationButtons(operation, 0, false).skip).toBe(false);
    expect(operationButtons("cherry_pick", 0, false).abortLabel).toBe("Abort cherry-pick");
    expect(operationButtons("cherry_pick_sequence", 0, false)).toMatchObject({ abortLabel: "Abort cherry-pick sequence", abortText: "Abort" });
    expect(operationButtons("revert_sequence", 2, false).continue).toEqual({ label: "Continue", disabledReason: "Resolve 2 conflicts first" });
  });

  it("gives a bisect only Reset: no Resolve, Continue, or Skip", () => {
    const bisect = operationButtons("bisect", 0, false);

    expect(bisect).toMatchObject({ resolvable: false, skip: false, abortLabel: "Reset bisect", abortText: "Reset" });
    for (const operation of ["merge", "rebase", "cherry_pick", "revert", "cherry_pick_sequence", "revert_sequence"] as const) {
      expect(operationButtons(operation, 0, false)).toMatchObject({ resolvable: true, abortText: "Abort" });
    }
  });

  it("disables Resolve when nothing is conflicted", () => {
    expect(operationButtons("merge", 0, false).resolve.disabledReason).toBe("No conflicts to resolve");
    expect(operationButtons("merge", 1, false).resolve.disabledReason).toBeUndefined();
  });
});

describe("abort confirmation", () => {
  it("states what is discarded and names the operation on the confirm button", () => {
    const copy = abortCopy(snapshot("merge", { incoming: "topic" }));

    expect(copy?.title).toBe("Abort the merge?");
    expect(copy?.confirmLabel).toBe("Abort merge");
    expect(copy?.names).toEqual(["topic"]);
    expect(copy?.consequences.join(" ")).toMatch(/conflict resolution/);
    expect(copy?.neutral).toBeUndefined();
  });

  it("states what a sequence abort drops and where the branch returns to", () => {
    const pick = abortCopy(snapshot("cherry_pick_sequence", { incoming: "abc1234 Topic one" }));
    const revert = abortCopy(snapshot("revert_sequence"));

    expect(pick?.title).toBe("Abort the cherry-pick sequence?");
    expect(pick?.confirmLabel).toBe("Abort cherry-pick sequence");
    expect(pick?.names).toEqual(["abc1234 Topic one"]);
    expect(pick?.consequences.join(" ")).toMatch(/before the sequence started/);
    expect(revert?.title).toBe("Abort the revert sequence?");
    expect(revert?.names).toEqual([]);
  });

  it("words a bisect exit as a reset that returns to the starting point", () => {
    const copy = abortCopy(snapshot("bisect", { current: "main" }));

    expect(copy?.title).toBe("Reset the bisect?");
    expect(copy?.confirmLabel).toBe("Reset bisect");
    expect(copy?.consequences.join(" ")).toMatch(/starting point/);
    expect(copy?.consequences.join(" ")).toMatch(/marks/);
  });

  it("has no copy when no operation is running", () => {
    expect(abortCopy(snapshot(null))).toBeUndefined();
  });
});

describe("first conflict", () => {
  it("returns the first conflicted path", () => {
    const files = [
      { path: "a.txt", area: "staged" },
      { path: "b.txt", area: "conflicted" },
      { path: "c.txt", area: "conflicted" },
    ] as RepoSnapshot["files"];
    expect(firstConflict(snapshot("merge", {}, files))).toBe("b.txt");
    expect(firstConflict(snapshot("merge"))).toBeUndefined();
  });
});

describe("conflict sides", () => {
  const flatParts = (parts: ReturnType<typeof conflictDescription>) => parts.map((part) => (typeof part === "string" ? part : part.ref)).join("");

  it("names a merge's sides by the checked-out branch and the merged ref", () => {
    expect(conflictSides(snapshot("merge", { incoming: "origin/main" }))).toEqual({
      current: { name: "main", role: "your branch" },
      incoming: { name: "origin/main", role: "incoming" },
    });
  });

  it("names a rebase's current side the rebase target and its incoming side your replayed commit", () => {
    expect(conflictSides(snapshot("rebase", { current: "main", incoming: "feature/greeting" }))).toEqual({
      current: { name: "main", role: "rebase target" },
      incoming: { name: "feature/greeting", role: "your commit being replayed" },
    });
  });

  it("gives cherry-pick and revert their own incoming roles", () => {
    expect(conflictSides(snapshot("cherry_pick", { incoming: "abc1234 Fix" })).incoming).toEqual({ name: "abc1234 Fix", role: "commit being picked" });
    expect(conflictSides(snapshot("revert", { incoming: "abc1234 Fix" })).incoming).toEqual({ name: "abc1234 Fix", role: "commit being reverted" });
  });

  it("gives sequences the roles of the single cherry-pick and revert", () => {
    expect(conflictSides(snapshot("cherry_pick_sequence", { incoming: "abc1234 Fix" })).incoming).toEqual({ name: "abc1234 Fix", role: "commit being picked" });
    expect(conflictSides(snapshot("revert_sequence", { incoming: "abc1234 Fix" })).incoming).toEqual({ name: "abc1234 Fix", role: "commit being reverted" });
  });

  it("treats conflicts during a bisect as stash conflicts, since a bisect has none of its own", () => {
    expect(conflictSides(snapshot("bisect")).incoming).toEqual({ name: "stash", role: "stashed changes being applied" });
    expect(flatParts(conflictDescription(snapshot("bisect")))).toBe("Applying stashed changes to main");
  });

  it("names the stash when conflicts remain without an operation and falls back when the incoming ref is unknown", () => {
    expect(conflictSides(snapshot(null))).toEqual({
      current: { name: "main", role: "your branch" },
      incoming: { name: "stash", role: "stashed changes being applied" },
    });
    expect(conflictSides(snapshot("merge")).incoming.name).toBe("incoming changes");
    expect(flatParts(conflictDescription(snapshot(null)))).toBe("Applying stashed changes to main");
    expect(flatParts(conflictDescription(snapshot("merge", { incoming: "topic" })))).toBe("Merging topic into main");
  });
});
