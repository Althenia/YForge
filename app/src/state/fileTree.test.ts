import { describe, expect, it } from "vitest";
import { folderPaths, listRows, withUnchanged, type ListRow } from "./fileTree";

type Item = { path: string; tag: string };

const items: Item[] = [
  { path: "src/ui/button.ts", tag: "a" },
  { path: "README.md", tag: "b" },
  { path: "src/app.ts", tag: "c" },
  { path: "docs/guide.md", tag: "d" },
];

const allOpen = () => true;
const shape = (rows: ListRow<Item>[]) => rows.map((row) => (row.kind === "folder" ? `${"  ".repeat(row.depth)}${row.name}/ ${row.items.length}${row.open ? "" : " closed"}` : `${"  ".repeat(row.depth ?? 0)}${row.name}`));

describe("path mode", () => {
  it("keeps the files in their given order with full paths and no depth", () => {
    const rows = listRows(items, (item) => item.path, "path", allOpen);

    expect(rows.map((row) => [row.kind, row.path, row.depth])).toEqual([
      ["file", "src/ui/button.ts", undefined],
      ["file", "README.md", undefined],
      ["file", "src/app.ts", undefined],
      ["file", "docs/guide.md", undefined],
    ]);
  });
});

describe("tree mode", () => {
  it("groups files under their folders, folders first and each level sorted by name, with every descendant counted", () => {
    expect(shape(listRows(items, (item) => item.path, "tree", allOpen))).toEqual(["docs/ 1", "  guide.md", "src/ 2", "  ui/ 1", "    button.ts", "  app.ts", "README.md"]);
  });

  it("keeps the item and the full path on each file row and the folder path on each folder row", () => {
    const rows = listRows(items, (item) => item.path, "tree", allOpen);
    const button = rows.find((row) => row.kind === "file" && row.name === "button.ts");
    const ui = rows.find((row) => row.kind === "folder" && row.name === "ui");

    expect(button).toMatchObject({ path: "src/ui/button.ts", depth: 2, item: { tag: "a" } });
    expect(ui).toMatchObject({ path: "src/ui", depth: 1, open: true });
    expect(ui?.kind === "folder" ? ui.items.map((item) => item.tag) : []).toEqual(["a"]);
  });

  it("hides the contents of a collapsed folder but keeps the folder row and its count", () => {
    const rows = listRows(items, (item) => item.path, "tree", (folder) => folder !== "src");

    expect(shape(rows)).toEqual(["docs/ 1", "  guide.md", "src/ 2 closed", "README.md"]);
  });

  it("lists nothing for no files", () => {
    expect(listRows([], (item: Item) => item.path, "tree", allOpen)).toEqual([]);
  });
});

describe("folder paths", () => {
  it("lists every folder that holds a file once, nested ones included", () => {
    expect(folderPaths(items.map((item) => item.path))).toEqual(["docs", "src", "src/ui"]);
  });
});

describe("all files of a commit", () => {
  it("lists every path once, sorted, keeping the changed item and marking the rest unchanged", () => {
    const changed = [
      { path: "src/app.ts", tag: "c" },
      { path: "gone.ts", tag: "d" },
    ];

    expect(withUnchanged(changed, (item) => item.path, ["src/util.ts", "src/app.ts", "README.md"])).toEqual([
      { path: "README.md", item: undefined },
      { path: "gone.ts", item: { path: "gone.ts", tag: "d" } },
      { path: "src/app.ts", item: { path: "src/app.ts", tag: "c" } },
      { path: "src/util.ts", item: undefined },
    ]);
  });
});
