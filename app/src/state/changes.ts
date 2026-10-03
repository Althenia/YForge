import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { ChangeCounts } from "../ipc/bindings/ChangeCounts";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import type { MenuEntry } from "./refMenu";

export const changeTotal = (counts: ChangeCounts): number =>
  counts.modified + counts.added + counts.deleted + counts.renamed + counts.untracked + counts.conflicted;

export const statusLetter: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  copied: "C",
  type_changed: "T",
  untracked: "U",
  conflicted: "!",
};

export const statusWord: Record<FileStatus, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  type_changed: "Type changed",
  untracked: "Untracked",
  conflicted: "Conflicted",
};

export const areaOrder: ReadonlyArray<{ area: ChangeArea; title: string; empty: string | undefined }> = [
  { area: "conflicted", title: "Conflicted", empty: undefined },
  { area: "unstaged", title: "Unstaged", empty: "No unstaged changes." },
  { area: "untracked", title: "Untracked", empty: undefined },
  { area: "staged", title: "Staged", empty: "Nothing staged. Stage files, hunks, or lines to commit them." },
];

export const filesIn = (files: readonly FileChange[], area: ChangeArea): FileChange[] => files.filter((file) => file.area === area);

export const rowKey = (file: Pick<FileChange, "area" | "path">): string => `${file.area}:${file.path}`;

export const stagedFileCount = (files: readonly FileChange[]): number => new Set(filesIn(files, "staged").map((file) => file.path)).size;

export const isPartiallyStaged = (files: readonly FileChange[], file: FileChange): boolean => {
  const other = file.area === "staged" ? "unstaged" : file.area === "unstaged" ? "staged" : undefined;
  return other !== undefined && files.some((candidate) => candidate.area === other && candidate.path === file.path);
};

export const pathsToMove = (file: FileChange): string[] =>
  file.area === "staged" && file.original_path !== null ? [file.original_path, file.path] : [file.path];

export const canDiscard = (file: FileChange): boolean => file.area === "unstaged" || file.area === "untracked";

const inFolder = (file: FileChange, folder: string): boolean => file.path.startsWith(`${folder}/`);

export const folderStashPaths = (files: readonly FileChange[], folder: string): string[] => [
  ...new Set(files.filter((file) => file.area !== "conflicted" && inFolder(file, folder)).flatMap(pathsToMove)),
];

export const folderDiscardFiles = (files: readonly FileChange[], folder: string): FileChange[] => files.filter((file) => canDiscard(file) && inFolder(file, folder));

export const NOTHING_TO_DISCARD = "No unstaged or untracked changes in this folder";

export const folderMenuEntries = (staged: boolean, discardable: number): MenuEntry[] => [
  { kind: "item", id: "move", label: [staged ? "Unstage folder" : "Stage folder"], icon: staged ? "minus" : "plus", shortcut: "Space" },
  { kind: "item", id: "stash", label: ["Stash folder"], icon: "stash" },
  { kind: "separator" },
  { kind: "item", id: "discard", label: ["Discard all changes in folder"], icon: "trash", danger: true, ...(discardable === 0 ? { disabledReason: NOTHING_TO_DISCARD } : {}) },
];

export type FileSelection = { area: ChangeArea; paths: readonly string[]; anchor: string };

export const selectOnly = (area: ChangeArea, path: string): FileSelection => ({ area, paths: [path], anchor: path });

export function toggleSelected(current: FileSelection | undefined, area: ChangeArea, path: string): FileSelection | undefined {
  if (current === undefined || current.area !== area) return selectOnly(area, path);
  const paths = current.paths.includes(path) ? current.paths.filter((candidate) => candidate !== path) : [...current.paths, path];
  return paths.length === 0 ? undefined : { area, paths, anchor: path };
}

export function extendSelection(current: FileSelection | undefined, area: ChangeArea, order: readonly string[], target: string, start: string | undefined): FileSelection {
  const anchor = current?.area === area ? current.anchor : start;
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (anchor === undefined || from < 0 || to < 0) return selectOnly(area, target);
  return { area, paths: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
}

export const selectAll = (area: ChangeArea, order: readonly string[]): FileSelection | undefined =>
  order[0] === undefined ? undefined : { area, paths: order, anchor: order[0] };

export function pruneSelection(current: FileSelection | undefined, files: readonly FileChange[]): FileSelection | undefined {
  if (current === undefined) return undefined;
  const present = new Set(filesIn(files, current.area).map((file) => file.path));
  const paths = current.paths.filter((path) => present.has(path));
  if (paths.length === current.paths.length) return current;
  const [first] = paths;
  return first === undefined ? undefined : { area: current.area, paths, anchor: paths.includes(current.anchor) ? current.anchor : first };
}

export const selectedFiles = (selection: FileSelection | undefined, files: readonly FileChange[]): FileChange[] =>
  selection === undefined ? [] : filesIn(files, selection.area).filter((file) => selection.paths.includes(file.path));

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const selectionNoun = (files: readonly FileChange[]): string => (files.length === 1 && files[0] !== undefined ? baseName(files[0].path) : `${files.length} files`);

export function selectionMenuEntries(files: readonly FileChange[]): MenuEntry[] {
  const noun = selectionNoun(files);
  const staged = files[0]?.area === "staged";
  return [
    { kind: "item", id: "move", label: [`${staged ? "Unstage" : "Stage"} ${noun}`], icon: staged ? "minus" : "plus" },
    { kind: "item", id: "discard", label: [`Discard ${noun}`], icon: "trash", danger: true },
    { kind: "item", id: "ignore", label: [`Ignore ${noun}`], icon: "close" },
    { kind: "item", id: "stash", label: [`Stash ${noun}`], icon: "stash" },
    { kind: "separator" },
    { kind: "item", id: "patch", label: [`Create patch from changes in ${noun}`], icon: "diff" },
  ];
}

export const selectionStashMessage = (files: readonly FileChange[]): string =>
  files.length === 1 && files[0] !== undefined ? `Stash ${files[0].path}` : `Stash ${files.length} files`;

export const selectionPaths = (files: readonly FileChange[]): string[] => [...new Set(files.flatMap(pathsToMove))];

export function neighborKey(keys: readonly string[], key: string): string | undefined {
  const index = keys.indexOf(key);
  if (index < 0) return undefined;
  return keys[index + 1] ?? keys[index - 1];
}
