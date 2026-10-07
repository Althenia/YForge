import { columnSizingFeature, columnVisibilityFeature, createColumnHelper, tableFeatures, type ColumnSizingState } from "@tanstack/solid-table";
import type { Geometry } from "./geometry";

export const graphFeatures = tableFeatures({ columnSizingFeature, columnVisibilityFeature });

const helper = createColumnHelper<typeof graphFeatures, never>();

export const OPTIONAL_COLUMNS = ["author", "date", "sha"] as const;

export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

export type ResizableColumn = "refs" | "graph" | OptionalColumn;

export const columnLabels: Record<OptionalColumn, string> = { author: "Author", date: "Date / Time", sha: "SHA" };

export const graphColumns = helper.columns([
  helper.display({ id: "refs", header: "Branch / Tag", enableHiding: false }),
  helper.display({ id: "graph", header: "Graph", enableHiding: false }),
  helper.display({ id: "message", header: "Commit message", enableHiding: false }),
  helper.display({ id: "author", header: columnLabels.author }),
  helper.display({ id: "date", header: columnLabels.date }),
  helper.display({ id: "sha", header: columnLabels.sha }),
]);

const OPTIONAL_LIMITS = { author: { min: 32, max: 300 }, date: { min: 56, max: 300 }, sha: { min: 56, max: 200 } } as const;

export function columnLimits(id: ResizableColumn, geometry: Geometry, lanes = 0, availableGraphWidth = 2000): { min: number; max: number } {
  if (id === "refs") return { min: geometry.refColumnMin, max: geometry.refColumnMax };
  if (id === "graph") {
    const min = Math.max(geometry.graphColumn, geometry.gutter + lanes * geometry.pitch);
    return { min, max: Math.max(min, Math.min(2000, availableGraphWidth)) };
  }
  return OPTIONAL_LIMITS[id];
}

export function clampColumn(id: ResizableColumn, size: number, geometry: Geometry, lanes = 0, availableGraphWidth = 2000): number {
  const { min, max } = columnLimits(id, geometry, lanes, availableGraphWidth);
  return Math.min(Math.max(Math.round(size), min), max);
}

export const defaultColumnSize = (id: ResizableColumn, geometry: Geometry): number =>
  id === "refs" ? geometry.refColumn : id === "graph" ? geometry.graphColumn : id === "author" ? geometry.authorColumn : id === "date" ? geometry.dateColumn : geometry.shaColumn;

export function graphColumnSizing(geometry: Geometry, lanes: number, saved: Partial<Record<ResizableColumn, number>>, availableGraphWidth = 2000): ColumnSizingState {
  const size = (id: ResizableColumn) => saved[id] ?? defaultColumnSize(id, geometry);
  return {
    refs: size("refs"),
    graph: clampColumn("graph", size("graph"), geometry, lanes, availableGraphWidth),
    author: size("author"),
    date: size("date"),
    sha: size("sha"),
  };
}
