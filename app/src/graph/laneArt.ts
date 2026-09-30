import type { CarriedEdge } from "../ipc/bindings/CarriedEdge";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { Geometry } from "./geometry";

export type Point = readonly [number, number];

export type PlacedEdge = CarriedEdge;

export const laneClass = (column: number, geometry: Geometry): string => `lane-${column % geometry.laneColors}`;

export const nodeX = (column: number, geometry: Geometry): number =>
  geometry.refColumn + geometry.gutter + column * geometry.pitch + geometry.node / 2;

export const rowY = (row: number, geometry: Geometry): number => row * geometry.row + geometry.row / 2;

export function orthogonalPath(points: readonly Point[], arc: number): string {
  const kept = points.filter((point, index) => index === 0 || point[0] !== points[index - 1]![0] || point[1] !== points[index - 1]![1]);
  const first = kept[0];
  if (first === undefined) return "";
  let path = `M${first[0]} ${first[1]}`;
  for (let index = 1; index < kept.length; index++) {
    const [x, y] = kept[index]!;
    if (index === kept.length - 1) {
      path += ` L${x} ${y}`;
      break;
    }
    const [previousX, previousY] = kept[index - 1]!;
    const [nextX, nextY] = kept[index + 1]!;
    const inX = Math.sign(x - previousX);
    const inY = Math.sign(y - previousY);
    const outX = Math.sign(nextX - x);
    const outY = Math.sign(nextY - y);
    const radius = Math.min(arc, Math.abs(x - previousX) + Math.abs(y - previousY), Math.abs(nextX - x) + Math.abs(nextY - y));
    const sweep = inX * outY - inY * outX > 0 ? 1 : 0;
    path += ` L${x - inX * radius} ${y - inY * radius} A${radius} ${radius} 0 0 ${sweep} ${x + outX * radius} ${y + outY * radius}`;
  }
  return path;
}

export function edgePath(placed: PlacedEdge, geometry: Geometry, firstRow: number, endRow: number): string {
  const { row, column, edge } = placed;
  const x = nodeX(column, geometry);
  const y = rowY(row - firstRow, geometry);
  const laneX = nodeX(edge.lane, geometry);
  if (edge.parent_row === null || edge.parent_column === null) {
    return orthogonalPath(
      [
        [x, y],
        [laneX, y],
        [laneX, (endRow - firstRow) * geometry.row],
      ],
      geometry.arc,
    );
  }
  const parentY = rowY(edge.parent_row - firstRow, geometry);
  return orthogonalPath(
    [
      [x, y],
      [laneX, y],
      [laneX, parentY],
      [nodeX(edge.parent_column, geometry), parentY],
    ],
    geometry.arc,
  );
}

export const edgeKey = (placed: PlacedEdge): string => `${placed.row}:${placed.edge.lane}:${placed.edge.parent_row ?? "outside"}`;

export function placeRowEdges(index: number, row: GraphRow): PlacedEdge[] {
  return row.edges.map((edge) => ({ row: index, column: row.column, kind: row.kind, edge }));
}

export function visibleEdges(edges: Iterable<PlacedEdge>, firstRow: number, endRow: number): PlacedEdge[] {
  const visible: PlacedEdge[] = [];
  for (const placed of edges) {
    const reaches = placed.edge.parent_row ?? Number.POSITIVE_INFINITY;
    if (placed.row < endRow && reaches >= firstRow) visible.push(placed);
  }
  return visible;
}
