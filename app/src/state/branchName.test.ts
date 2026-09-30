import { describe, expect, it } from "vitest";
import { branchNameProblem } from "./branchName";

describe("branch name problems", () => {
  it("stays quiet while the field is empty and flags duplicates and unchanged names", () => {
    expect(branchNameProblem("", ["main"])).toBeUndefined();
    expect(branchNameProblem("main", ["main"])).toBe("A branch named main already exists");
    expect(branchNameProblem("old", ["old"], "old")).toBe("Enter a different name");
    expect(branchNameProblem("fresh", ["main"])).toBeUndefined();
  });
});
