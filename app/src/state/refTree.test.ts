import { describe, expect, it } from "vitest";
import { treeRows } from "./refTree";

const names = ["feature/a", "feature/b/deep", "feature/b/deeper", "main", "release/1.0"];

describe("ref tree", () => {
  it("nests slash-separated names into folders that show their branch counts", () => {
    expect(treeRows(names, new Set())).toEqual([
      { kind: "folder", id: "feature", name: "feature", depth: 0, count: 3, open: true, last: false, trail: [] },
      { kind: "leaf", path: "feature/a", label: "a", depth: 1, last: false, trail: [true] },
      { kind: "folder", id: "feature/b", name: "b", depth: 1, count: 2, open: true, last: true, trail: [true] },
      { kind: "leaf", path: "feature/b/deep", label: "deep", depth: 2, last: false, trail: [true, false] },
      { kind: "leaf", path: "feature/b/deeper", label: "deeper", depth: 2, last: true, trail: [true, false] },
      { kind: "leaf", path: "main", label: "main", depth: 0, last: false, trail: [] },
      { kind: "folder", id: "release", name: "release", depth: 0, count: 1, open: true, last: true, trail: [] },
      { kind: "leaf", path: "release/1.0", label: "1.0", depth: 1, last: true, trail: [false] },
    ]);
  });

  it("hides the contents of a collapsed folder, and only that folder", () => {
    const rows = treeRows(names, new Set(["feature"]));
    expect(rows.map((row) => (row.kind === "folder" ? row.id : row.path))).toEqual(["feature", "main", "release", "release/1.0"]);
    expect(rows[0]).toMatchObject({ kind: "folder", open: false, count: 3 });
    const inner = treeRows(names, new Set(["feature/b"]));
    expect(inner.map((row) => (row.kind === "folder" ? row.id : row.path))).toContain("feature/a");
    expect(inner.map((row) => (row.kind === "folder" ? row.id : row.path))).not.toContain("feature/b/deep");
  });

  it("scopes folder ids so two remotes keep separate collapse state", () => {
    const rows = treeRows(["x/y"], new Set(["origin:x"]), "origin:");
    expect(rows).toEqual([{ kind: "folder", id: "origin:x", name: "x", depth: 0, count: 1, open: false, last: true, trail: [] }]);
  });

  it("keeps a flat list flat", () => {
    expect(treeRows(["a", "b"], new Set()).every((row) => row.kind === "leaf" && row.depth === 0)).toBe(true);
  });
});
