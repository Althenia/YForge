import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { DiffLineKind } from "../ipc/bindings/DiffLineKind";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { FileDiff } from "../ipc/bindings/FileDiff";

export type WorkingArea = ChangeArea;

export type DiffTarget =
  | { source: "working"; area: WorkingArea; file: string }
  | { source: "commit"; sha: string; file: string };

export const isConflictTarget = (target: DiffTarget): boolean => target.source === "working" && target.area === "conflicted";

export type HunkAction = "stage" | "unstage" | "discard";

export const sameTarget = (left: DiffTarget | undefined, right: DiffTarget | undefined): boolean => {
  if (left === undefined || right === undefined) return left === right;
  if (left.source === "working" && right.source === "working") return left.file === right.file && left.area === right.area;
  if (left.source === "commit" && right.source === "commit") return left.file === right.file && left.sha === right.sha;
  return false;
};

const areaWord: Record<WorkingArea, string> = { unstaged: "Unstaged", staged: "Staged", untracked: "Untracked", conflicted: "Conflicted" };

export const targetSource = (target: DiffTarget): string => (target.source === "working" ? "Changes" : target.sha.slice(0, 7));

export const targetMode = (target: DiffTarget): string => (target.source === "working" ? areaWord[target.area] : "Commit");

export function hunkActions(target: DiffTarget): HunkAction[] {
  if (target.source !== "working") return [];
  if (target.area === "unstaged") return ["stage", "discard"];
  if (target.area === "staged") return ["unstage"];
  return [];
}

export const hunkHeader = (hunk: DiffHunk): string =>
  `@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@${hunk.heading === "" ? "" : ` ${hunk.heading}`}`;

export function hunkLineRange(hunk: DiffHunk): string {
  const [start, count] = hunk.new_lines > 0 ? [hunk.new_start, hunk.new_lines] : [hunk.old_start, hunk.old_lines];
  return `lines ${start}–${Math.max(start + count - 1, start)}`;
}

export const hunkLabel = (index: number, total: number, hunk: DiffHunk): string => `Hunk ${index + 1} of ${total}, ${hunkLineRange(hunk)}`;

export const lineMarker: Record<DiffLineKind, string> = { context: " ", added: "+", removed: "−" };

export function diffNotice(diff: FileDiff, target: DiffTarget): string | undefined {
  if (diff.binary) return "Binary file. Its contents cannot be shown as text.";
  if (diff.hunks.length > 0) return undefined;
  if (target.source === "commit") return "No textual change in this file.";
  if (target.area === "untracked" || target.area === "conflicted") return "This file is empty.";
  return `No ${target.area} changes remain in this file.`;
}

const followOrder: readonly WorkingArea[] = ["conflicted", "staged", "unstaged", "untracked"];

export function followTarget(files: readonly FileChange[], target: DiffTarget): DiffTarget | undefined {
  if (target.source === "commit") return target;
  if (target.area === "conflicted") {
    if (files.some((file) => file.path === target.file && file.area === "conflicted")) return target;
    const next = files.find((file) => file.area === "conflicted");
    return next === undefined ? undefined : { source: "working", area: "conflicted", file: next.path };
  }
  const areas = new Set(files.filter((file) => file.path === target.file).map((file) => file.area));
  if (areas.has(target.area)) return target;
  const moved = followOrder.find((area) => areas.has(area));
  return moved === undefined ? undefined : { source: "working", area: moved, file: target.file };
}

export type DiffRow = { kind: "line"; line: DiffLine } | { kind: "note" };

export const hunkRows = (hunk: DiffHunk): DiffRow[] =>
  hunk.lines.flatMap((line): DiffRow[] => (line.no_newline ? [{ kind: "line", line }, { kind: "note" }] : [{ kind: "line", line }]));
