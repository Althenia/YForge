import { describe, expect, it } from "vitest";
import { cappedText, countOf, formatCount, partialFilesNote } from "./listCount";

describe("paged list counts (S44)", () => {
  it("counts the true total when the service gave one, else the items returned", () => {
    expect(countOf(3, { total: 3, capped: false })).toBe(3);
    expect(countOf(1000, { total: 1500, capped: true })).toBe(1500);
    expect(countOf(1000, { total: null, capped: true })).toBe(1000);
  });

  it("groups thousands so a large count reads at a glance", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1500)).toBe("1,500");
  });

  it("says nothing for a list that is not capped", () => {
    expect(cappedText({ total: 12, capped: false })).toBeUndefined();
    expect(cappedText({ total: null, capped: false })).toBeUndefined();
  });

  it("says Showing 1,000 of <total> when capped with a total, and the first 1,000 when the service gave none", () => {
    expect(cappedText({ total: 1500, capped: true })).toBe("Showing 1,000 of 1,500");
    expect(cappedText({ total: null, capped: true })).toBe("Showing the first 1,000");
  });

  it("states that file sums cover only the loaded files whenever fewer files than the total were loaded", () => {
    expect(partialFilesNote(3, { total: 3, capped: false })).toBeUndefined();
    expect(partialFilesNote(3, { total: null, capped: false })).toBeUndefined();
    expect(partialFilesNote(8, { total: 12, capped: false })).toBe("Additions and deletions cover only the 8 loaded files");
    expect(partialFilesNote(1000, { total: 1500, capped: true })).toBe("Showing 1,000 of 1,500. Additions and deletions cover only the 1,000 loaded files");
    expect(partialFilesNote(1000, { total: null, capped: true })).toBe("Showing the first 1,000. Additions and deletions cover only the 1,000 loaded files");
  });
});
