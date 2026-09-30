import { describe, expect, it } from "vitest";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import { mergeChoices } from "./integrationModel";

const preview = (incoming: number, outgoing: number): IntegrationPreview => ({
  incoming: { count: incoming, commits: [] },
  outgoing: { count: outgoing, commits: [] },
  fast_forward: incoming > 0 && outgoing === 0,
});

describe("merge choices", () => {
  it("defaults to a fast-forward and describes both results when the branch can move forward", () => {
    const { choices, initial, outcome } = mergeChoices("main", "feature", preview(3, 0));

    expect(initial).toBe("fast_forward");
    expect(choices.map((choice) => [choice.mode, choice.disabledReason])).toEqual([
      ["fast_forward", undefined],
      ["merge_commit", undefined],
    ]);
    expect(choices[0]?.detail).toBe("Moves main forward by 3 commits. No new commit.");
    expect(choices[1]?.detail).toBe("Adds a merge commit that joins 3 commits from feature.");
    expect(outcome("fast_forward")).toBe("Result: main points at the tip of feature.");
    expect(outcome("merge_commit")).toBe("Result: a new commit on main with main and feature as parents.");
  });

  it("disables the fast-forward with the reason and defaults to a merge commit when the branches diverged", () => {
    const { choices, initial } = mergeChoices("main", "feature", preview(1, 2));

    expect(initial).toBe("merge_commit");
    expect(choices[0]?.disabledReason).toBe("main has 2 commits that feature does not");
    expect(choices[1]?.disabledReason).toBeUndefined();
    expect(choices[1]?.detail).toBe("Adds a merge commit that joins 1 commit from feature.");
  });
});
