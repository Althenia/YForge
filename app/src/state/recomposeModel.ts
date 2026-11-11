import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import type { RecomposeChange } from "../ipc/bindings/RecomposeChange";
import type { RecomposeGroup } from "../ipc/bindings/RecomposeGroup";
import type { RecomposePreview } from "../ipc/bindings/RecomposePreview";
import { fileList } from "./fileList";

export type HunkUnit = { id: string; hunk: DiffHunk; changed: number[]; added: number; removed: number };

export type FileUnit = { path: string; status: FileStatus; binary: boolean; whole: boolean; omitted: string | null; hunks: HunkUnit[] };

export type Catalog = FileUnit[];

type Target = { kind: "file"; path: string } | { kind: "hunk"; id: string } | { kind: "lines"; id: string; lines: readonly number[] };

export type Draft = { groups: Array<{ id: number; message: string }>; slots: Record<string, number> };

export function catalogOf(preview: RecomposePreview): Catalog {
  return preview.files.map((file) => ({
    path: file.path,
    status: file.status,
    binary: file.binary,
    whole: file.whole_file_only || file.hunks.length === 0,
    omitted: file.hunks_omitted,
    hunks: file.hunks.map(({ id, hunk }) => {
      const changed = hunk.lines.flatMap((line, index) => (line.kind === "context" ? [] : [index]));
      const added = changed.filter((index) => hunk.lines[index]?.kind === "added").length;
      return { id, hunk, changed, added, removed: changed.length - added };
    }),
  }));
}

const fileSlot = (path: string): string => `f:${path}`;
const lineSlot = (id: string, line: number): string => `l:${id}:${line}`;

const slotsOfFile = (file: FileUnit): string[] => (file.whole ? [fileSlot(file.path)] : file.hunks.flatMap((unit) => unit.changed.map((line) => lineSlot(unit.id, line))));

const hunkOf = (catalog: Catalog, id: string): HunkUnit | undefined => catalog.flatMap((file) => file.hunks).find((unit) => unit.id === id);

function slotsOf(catalog: Catalog, target: Target): string[] {
  if (target.kind === "file") {
    const file = catalog.find((entry) => entry.path === target.path);
    return file === undefined ? [] : slotsOfFile(file);
  }
  const unit = hunkOf(catalog, target.id);
  if (unit === undefined) return [];
  const wanted = target.kind === "hunk" ? unit.changed : unit.changed.filter((line) => target.lines.includes(line));
  return wanted.map((line) => lineSlot(unit.id, line));
}

function assign(draft: Draft, catalog: Catalog, target: Target, group: number): Draft {
  const slots = { ...draft.slots };
  for (const slot of slotsOf(catalog, target)) slots[slot] = group;
  return { ...draft, slots };
}

export function progressOf(draft: Draft, catalog: Catalog): { total: number; assigned: number } {
  const slots = catalog.flatMap(slotsOfFile);
  return { total: slots.length, assigned: slots.filter((slot) => draft.slots[slot] !== undefined).length };
}

function changesOf(draft: Draft, catalog: Catalog, group: number): RecomposeChange[] {
  const changes: RecomposeChange[] = [];
  for (const file of catalog) {
    if (file.whole) {
      if (draft.slots[fileSlot(file.path)] === group) changes.push({ kind: "file", path: file.path });
      continue;
    }
    const owned = file.hunks.map((unit) => unit.changed.filter((line) => draft.slots[lineSlot(unit.id, line)] === group));
    if (owned.every((lines, index) => lines.length === file.hunks[index]?.changed.length)) {
      if (owned.length > 0) changes.push({ kind: "file", path: file.path });
      continue;
    }
    file.hunks.forEach((unit, index) => {
      const lines = owned[index] ?? [];
      if (lines.length === unit.changed.length) changes.push({ kind: "hunk", id: unit.id });
      else if (lines.length > 0) changes.push({ kind: "lines", id: unit.id, lines });
    });
  }
  return changes;
}

export const groupsOf = (draft: Draft, catalog: Catalog): RecomposeGroup[] =>
  draft.groups.map((group) => ({ message: group.message, changes: changesOf(draft, catalog, group.id) }));

export type Problems = { general: string[]; groups: Record<number, string>; ready: boolean };

export function problemsOf(draft: Draft, catalog: Catalog): Problems {
  const general: string[] = [];
  const groups: Record<number, string> = {};
  const unassigned = catalog.filter((file) => slotsOfFile(file).some((slot) => draft.slots[slot] === undefined)).map((file) => file.path);
  if (unassigned.length > 0) general.push(`Changes not assigned to any commit: ${fileList(unassigned)}`);
  if (draft.groups.length === 0) general.push("The proposal has no commits");
  for (const group of draft.groups) {
    if (group.message.trim() === "") groups[group.id] = "Enter a message";
    else if (group.message.includes("\0")) groups[group.id] = "The message cannot contain a NUL character";
    else if (!Object.values(draft.slots).includes(group.id)) groups[group.id] = "This commit has no changes";
  }
  return { general, groups, ready: general.length === 0 && Object.keys(groups).length === 0 };
}

export function fromGroups(groups: readonly RecomposeGroup[], catalog: Catalog): Draft {
  let draft: Draft = { groups: groups.map((group, index) => ({ id: index + 1, message: group.message })), slots: {} };
  groups.forEach((group, index) => {
    for (const change of group.changes) draft = assign(draft, catalog, change, index + 1);
  });
  return draft;
}

export type GroupItem = { path: string; scope: string; added: number; removed: number };

export function describeGroup(draft: Draft, catalog: Catalog, group: number): GroupItem[] {
  const items: GroupItem[] = [];
  for (const file of catalog) {
    const owned = (slots: string[]) => slots.filter((slot) => draft.slots[slot] === group).length;
    const all = slotsOfFile(file);
    if (owned(all) === 0) continue;
    if (file.whole) {
      items.push({ path: file.path, scope: "whole file", added: 0, removed: 0 });
      continue;
    }
    let added = 0;
    let removed = 0;
    let full = 0;
    let partial = 0;
    for (const unit of file.hunks) {
      const mine = unit.changed.filter((line) => draft.slots[lineSlot(unit.id, line)] === group);
      added += mine.filter((line) => unit.hunk.lines[line]?.kind === "added").length;
      removed += mine.filter((line) => unit.hunk.lines[line]?.kind === "removed").length;
      if (mine.length === unit.changed.length) full += 1;
      else partial += mine.length;
    }
    const scope =
      owned(all) === all.length ? "whole file" : [full > 0 ? `${full} of ${file.hunks.length} hunks` : undefined, partial > 0 ? `${partial} ${partial === 1 ? "line" : "lines"}` : undefined].filter(Boolean).join(" + ");
    items.push({ path: file.path, scope, added, removed });
  }
  return items;
}
