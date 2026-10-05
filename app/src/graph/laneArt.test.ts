import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { Geometry } from "./geometry";
import { edgePath, laneClass, nodeX, orthogonalPath, placeRowEdges, rowY, visibleEdges, type PlacedEdge } from "./laneArt";

const geometry: Geometry = {
  row: 28,
  pitch: 22,
  gutter: 4,
  node: 22,
  mergeNode: 12,
  line: 2,
  arc: 11,
  refColumn: 130,
  refColumnMin: 32,
  refColumnMax: 300,
  authorColumn: 130,
  dateColumn: 130,
  shaColumn: 100,
  graphColumn: 56,
  laneColors: 10,
};

const placed = (row: number, column: number, lane: number, parentRow: number | null, parentColumn: number | null): PlacedEdge => ({
  row,
  column,
  kind: "commit",
  edge: { lane, parent_row: parentRow, parent_column: parentColumn },
});

describe("lane art geometry", () => {
  it("starts the default first node 4px clear of the ref divider while compact lanes retain 10px", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../styles/tokens.css"), "utf8");
    const defaultGutter = Number(/--controls-graph-gutter:\s*(\d+)px/.exec(css)?.[1]);
    const compactGutter = Number(/--controls-graph-gutter-compact:\s*(\d+)px/.exec(css)?.[1]);
    expect(defaultGutter).toBe(4);
    expect(nodeX(0, { ...geometry, gutter: defaultGutter }) - geometry.refColumn - geometry.node / 2).toBe(4);
    expect(compactGutter).toBe(10);
  });
  it("places nodes after the ref column and gutter, one pitch per column", () => {
    expect(nodeX(0, geometry)).toBe(130 + 4 + 11);
    expect(nodeX(2, geometry)).toBe(130 + 4 + 44 + 11);
    expect(rowY(3, geometry)).toBe(3 * 28 + 14);
  });

  it("colors lanes by column index modulo ten", () => {
    expect(laneClass(0, geometry)).toBe("lane-0");
    expect(laneClass(13, geometry)).toBe("lane-3");
  });
});

describe("orthogonalPath", () => {
  it("draws a straight vertical line when the points are collinear", () => {
    expect(orthogonalPath([[10, 5], [10, 5], [10, 60], [10, 60]], 11)).toBe("M10 5 L10 60");
  });

  it("rounds a corner with the arc radius and sweep of the specimen", () => {
    expect(orthogonalPath([[11, 14], [33, 14], [33, 42]], 11)).toBe("M11 14 L22 14 A11 11 0 0 1 33 25 L33 42");
  });

  it("clamps the radius to the shorter neighbouring segment", () => {
    expect(orthogonalPath([[0, 0], [6, 0], [6, 40]], 11)).toBe("M0 0 L0 0 A6 6 0 0 1 6 6 L6 40");
  });
});

describe("edgePath", () => {
  it("routes a merge edge horizontally from the node then down the lane into the parent", () => {
    const x = nodeX(0, geometry);
    const laneX = nodeX(1, geometry);
    const path = edgePath(placed(10, 0, 1, 12, 1), geometry, 10, 20);
    expect(path).toBe(`M${x} 14 L${laneX - 11} 14 A11 11 0 0 1 ${laneX} 25 L${laneX} 70`);
  });

  it("runs to the bottom of the window when the parent is outside the graph", () => {
    const laneX = nodeX(0, geometry);
    expect(edgePath(placed(2, 0, 0, null, null), geometry, 0, 10)).toBe(`M${laneX} ${rowY(2, geometry)} L${laneX} ${10 * 28}`);
  });
});

describe("visibleEdges", () => {
  const edges = [placed(0, 0, 0, 100, 0), placed(50, 0, 0, 60, 0), placed(70, 1, 1, null, null), placed(200, 0, 0, 201, 0)];

  it("keeps edges that start above and end inside or below the window", () => {
    expect(visibleEdges(edges, 55, 65).map((edge) => edge.row)).toEqual([0, 50]);
  });

  it("keeps open-ended edges that start before the window end", () => {
    expect(visibleEdges(edges, 80, 90).map((edge) => edge.row)).toEqual([0, 70]);
  });
});

describe("placeRowEdges", () => {
  it("copies the row index, column, and kind onto each edge", () => {
    const row = {
      column: 2,
      kind: "stash",
      edges: [{ lane: 2, parent_row: 9, parent_column: 0 }],
    } as unknown as GraphRow;
    expect(placeRowEdges(4, row)).toEqual([{ row: 4, column: 2, kind: "stash", edge: { lane: 2, parent_row: 9, parent_column: 0 } }]);
  });
});
