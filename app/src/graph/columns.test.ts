import { describe, expect, it } from "vitest";
import { clampColumn, columnLimits, graphColumnSizing } from "./columns";
import type { Geometry } from "./geometry";

const geometry: Geometry = {
  row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11,
  refColumn: 130, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 150, laneColors: 10,
};

describe("graph column model", () => {
  it("sizes every column from the tokens, the lanes in use, and the saved widths", () => {
    expect(graphColumnSizing(geometry, 3, {})).toEqual({ refs: 130, graph: 150, author: 130, date: 130, sha: 100 });
    expect(graphColumnSizing(geometry, 9, { refs: 200, sha: 80 })).toEqual({ refs: 200, graph: 28 + 9 * 22, author: 130, date: 130, sha: 80 });
  });

  it("clamps a dragged width to the limits of its column", () => {
    expect(columnLimits("refs", geometry)).toEqual({ min: 32, max: 300 });
    expect(clampColumn("refs", 10, geometry)).toBe(32);
    expect(clampColumn("refs", 999, geometry)).toBe(300);
    expect(clampColumn("author", 20.4, geometry)).toBe(32);
    expect(clampColumn("date", 141.6, geometry)).toBe(142);
  });
});
