import { describe, expect, it } from "vitest";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import { reachFrom } from "./reachability";

const row = (sha: string | null, parents: string[], extra: Partial<GraphRow> = {}): GraphRow => ({
  sha,
  parents,
  summary: "",
  body: "",
  author: null,
  time: null,
  refs: [],
  kind: "commit",
  column: 0,
  edges: [],
  ...extra,
});

const history = new Map<number, GraphRow>([
  [0, row(null, ["m"], { kind: "changes" })],
  [1, row("f2", ["f1"], { refs: [{ name: "feature", kind: "local_branch", is_head: true }] })],
  [2, row("o1", ["b"], { refs: [{ name: "other", kind: "local_branch", is_head: false }] })],
  [3, row("f1", ["b"])],
  [4, row("b", ["a"])],
  [5, row("a", [])],
]);

describe("reachability", () => {
  it("marks the tip and every ancestor, and leaves side branches out", () => {
    const reach = reachFrom(history, (candidate) => candidate.sha === "f2");
    expect([...reach.reachable].sort()).toEqual([1, 3, 4, 5]);
    expect(reach.covered).toBe(6);
  });

  it("starts at the given row, so rows above a tip are never reached", () => {
    const reach = reachFrom(history, (candidate) => candidate.sha === "o1", 2);
    expect([...reach.reachable].sort()).toEqual([2, 4, 5]);
    expect(reach.start).toBe(2);
    expect(reach.covered).toBe(6);
  });

  it("only judges the contiguous loaded prefix", () => {
    const gap = new Map(history);
    gap.delete(3);
    const reach = reachFrom(gap, (candidate) => candidate.sha === "f2");
    expect(reach.covered).toBe(3);
    expect(reach.reachable.has(4)).toBe(false);
  });
});
