import type { FileListMode } from "../ipc/bindings/FileListMode";

export type { FileListMode };

export type FolderEntry<T> = { kind: "folder"; path: string; name: string; depth: number; open: boolean; items: T[] };

export type FileEntry<T> = { kind: "file"; path: string; name: string; depth: number | undefined; item: T };

export type ListRow<T> = FolderEntry<T> | FileEntry<T>;

type Node<T> = { path: string; folders: Map<string, Node<T>>; files: Array<{ name: string; item: T }> };

const byName = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const leafOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

function build<T>(items: readonly T[], pathOf: (item: T) => string): Node<T> {
  const root: Node<T> = { path: "", folders: new Map(), files: [] };
  for (const item of items) {
    const parts = pathOf(item).split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (next === undefined) {
        next = { path: node.path === "" ? part : `${node.path}/${part}`, folders: new Map(), files: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.files.push({ name: parts[parts.length - 1] ?? "", item });
  }
  return root;
}

const sortedFolders = <T>(node: Node<T>) => [...node.folders.entries()].sort(([left], [right]) => byName(left, right));
const sortedFiles = <T>(node: Node<T>) => [...node.files].sort((left, right) => byName(left.name, right.name));
const itemsUnder = <T>(node: Node<T>): T[] => [...sortedFolders(node).flatMap(([, folder]) => itemsUnder(folder)), ...sortedFiles(node).map((file) => file.item)];

export function listRows<T>(items: readonly T[], pathOf: (item: T) => string, mode: FileListMode, isOpen: (folder: string) => boolean): ListRow<T>[] {
  if (mode === "path") return items.map((item) => ({ kind: "file", path: pathOf(item), name: leafOf(pathOf(item)), depth: undefined, item }));
  const rows: ListRow<T>[] = [];
  const walk = (node: Node<T>, depth: number) => {
    for (const [name, folder] of sortedFolders(node)) {
      const open = isOpen(folder.path);
      rows.push({ kind: "folder", path: folder.path, name, depth, open, items: itemsUnder(folder) });
      if (open) walk(folder, depth + 1);
    }
    for (const file of sortedFiles(node)) {
      const path = pathOf(file.item);
      rows.push({ kind: "file", path, name: file.name, depth, item: file.item });
    }
  };
  walk(build(items, pathOf), 0);
  return rows;
}

export function folderPaths(paths: readonly string[]): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_, index) => folders.add(parts.slice(0, index + 1).join("/")));
  }
  return [...folders].sort(byName);
}

export function withUnchanged<T>(changed: readonly T[], pathOf: (item: T) => string, allPaths: readonly string[]): Array<{ path: string; item: T | undefined }> {
  const byPath = new Map(changed.map((item) => [pathOf(item), item] as const));
  return [...new Set([...allPaths, ...byPath.keys()])].sort(byName).map((path) => ({ path, item: byPath.get(path) }));
}
