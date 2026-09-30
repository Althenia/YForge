import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { ChangeCounts } from "../ipc/bindings/ChangeCounts";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { FileStatus } from "../ipc/bindings/FileStatus";

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

export function neighborKey(keys: readonly string[], key: string): string | undefined {
  const index = keys.indexOf(key);
  if (index < 0) return undefined;
  return keys[index + 1] ?? keys[index - 1];
}
