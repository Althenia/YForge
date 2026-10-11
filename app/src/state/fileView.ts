import { IpcError } from "../ipc/client";
import type { DiffTarget } from "./diffModel";

export type FileViewTarget = { file: string; rev: string; source: string; fragment?: string };

export function previewKind(file: string): "image" | "markdown" | "html" | undefined {
  const extension = file.split(".").at(-1)?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension ?? "")) return "image";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  return undefined;
}

const MEBIBYTE = 1024 * 1024;

export function fileViewTargetOf(target: DiffTarget): FileViewTarget {
  if (target.source === "commit") return { file: target.file, rev: target.sha, source: target.sha.slice(0, 7) };
  if (target.source === "stash") return { file: target.file, rev: target.sha, source: `stash@{${target.index}}` };
  if (target.source === "range") return { file: target.file, rev: target.head, source: target.head };
  return target.area === "staged" ? { file: target.file, rev: ":index", source: "Staged" } : { file: target.file, rev: ":worktree", source: "Working tree" };
}

export function stashFileViewTarget(details: { index: number; sha: string; untracked_sha: string | null }, file: { path: string; untracked: boolean }): FileViewTarget {
  const reference = `stash@{${details.index}}`;
  if (file.untracked && details.untracked_sha !== null) return { file: file.path, rev: details.untracked_sha, source: `${reference} (untracked)` };
  return { file: file.path, rev: details.sha, source: reference };
}

export function fileLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size.toLocaleString("en-US")} ${size === 1 ? "byte" : "bytes"}`;
  const units = ["KiB", "MiB", "GiB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function fileViewError(failure: unknown, subject: "file" | "diff" = "file"): string {
  if (failure instanceof IpcError && failure.kind === "file_too_large") {
    const size = Number(failure.output);
    const limit = `over the ${formatBytes(2 * MEBIBYTE)} limit of the ${subject} view. Open it in your editor instead.`;
    return failure.output === null || !Number.isFinite(size) ? `This ${subject} is ${limit}` : `This ${subject} is ${formatBytes(size)}, ${limit}`;
  }
  return failure instanceof Error ? failure.message : String(failure);
}
