export type Geometry = {
  row: number;
  pitch: number;
  gutter: number;
  node: number;
  mergeNode: number;
  line: number;
  arc: number;
  refColumn: number;
  graphColumn: number;
  laneColors: number;
};

const px = (style: CSSStyleDeclaration, name: string): number => {
  const value = Number.parseFloat(style.getPropertyValue(name));
  if (Number.isNaN(value)) throw new Error(`design token ${name} is not defined`);
  return value;
};

export function readGeometry(style: CSSStyleDeclaration): Geometry {
  return {
    row: px(style, "--controls-row-graph"),
    pitch: px(style, "--controls-graph-lane-pitch"),
    gutter: px(style, "--controls-graph-gutter"),
    node: px(style, "--controls-graph-node"),
    mergeNode: px(style, "--controls-graph-merge-node"),
    line: px(style, "--controls-graph-line"),
    arc: px(style, "--controls-graph-arc-radius"),
    refColumn: px(style, "--layout-graph-ref-column"),
    graphColumn: px(style, "--layout-graph-column"),
    laneColors: 10,
  };
}
