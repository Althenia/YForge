import { describe, expect, it } from "vitest";
import { idleSearch, isDimmed, searchFootnote, searchLabel, stepMatch, type SearchState } from "./searchModel";

const done = (rows: number[], position = 0, query = "fix"): SearchState => ({ query, rows, total: 12408, position, status: "done" });

describe("search model", () => {
  it("steps through matches with wraparound in both directions", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(0);
  });

  it("labels progress as N of M, no matches, or searching", () => {
    expect(searchLabel(done([4, 9, 20], 1))).toBe("2 of 3");
    expect(searchLabel(done([]))).toBe("No commits match");
    expect(searchLabel({ ...done([1]), status: "searching" })).toBe("Searching…");
    expect(searchLabel(idleSearch)).toBe("");
    expect(searchLabel(done([1], 0, "  "))).toBe("");
  });

  it("reports how many commits were searched once the search finishes", () => {
    expect(searchFootnote(done([1]))).toBe("Searched all 12,408 commits");
    expect(searchFootnote({ ...done([1]), status: "searching" })).toBe("");
    expect(searchFootnote(idleSearch)).toBe("");
  });

  it("dims non-matching rows only while a finished search has a query", () => {
    const matches = new Set([4, 9]);
    expect(isDimmed(done([4, 9]), matches, 4)).toBe(false);
    expect(isDimmed(done([4, 9]), matches, 5)).toBe(true);
    expect(isDimmed({ ...done([4, 9]), status: "searching" }, matches, 5)).toBe(false);
    expect(isDimmed(idleSearch, matches, 5)).toBe(false);
  });
});
