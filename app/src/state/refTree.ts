export type TreeRow =
  | { kind: "folder"; id: string; name: string; depth: number; count: number; open: boolean; last: boolean; trail: boolean[] }
  | { kind: "leaf"; path: string; label: string; depth: number; last: boolean; trail: boolean[] };

type Folder = { name: string; path: string; count: number; entries: Array<Folder | string> };

export function treeRows(paths: readonly string[], collapsed: ReadonlySet<string>, scope = ""): TreeRow[] {
  const root: Folder = { name: "", path: "", count: 0, entries: [] };
  const folders = new Map<string, Folder>();
  for (const path of paths) {
    const segments = path.split("/");
    segments.pop();
    let parent = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      let folder = folders.get(prefix);
      if (folder === undefined) {
        folder = { name: segment, path: prefix, count: 0, entries: [] };
        folders.set(prefix, folder);
        parent.entries.push(folder);
      }
      folder.count += 1;
      parent = folder;
    }
    parent.entries.push(path);
  }
  const rows: TreeRow[] = [];
  const walk = (folder: Folder, depth: number, trail: boolean[]) => {
    folder.entries.forEach((entry, index) => {
      const last = index === folder.entries.length - 1;
      if (typeof entry === "string") {
        rows.push({ kind: "leaf", path: entry, label: entry.slice(entry.lastIndexOf("/") + 1), depth, last, trail });
        return;
      }
      const id = `${scope}${entry.path}`;
      const open = !collapsed.has(id);
      rows.push({ kind: "folder", id, name: entry.name, depth, count: entry.count, open, last, trail });
      if (open) walk(entry, depth + 1, [...trail, !last]);
    });
  };
  walk(root, 0, []);
  return rows;
}
