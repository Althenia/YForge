import { columnSizingFeature, createColumnHelper, tableFeatures, type ColumnSizingState } from "@tanstack/solid-table";
import type { Geometry } from "./geometry";

export const graphFeatures = tableFeatures({ columnSizingFeature });

const helper = createColumnHelper<typeof graphFeatures, never>();

export const graphColumns = helper.columns([
  helper.display({ id: "refs", header: "Branch / Tag" }),
  helper.display({ id: "graph", header: "Graph" }),
  helper.display({ id: "message", header: "Commit message" }),
]);

export const graphColumnSizing = (geometry: Geometry, lanes: number): ColumnSizingState => ({
  refs: geometry.refColumn,
  graph: Math.max(geometry.graphColumn, geometry.gutter + lanes * geometry.pitch),
});
