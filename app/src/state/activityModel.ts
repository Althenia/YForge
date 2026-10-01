import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";

export const ACTIVITY_LIMIT = 300;

export function upsertEntry(entries: readonly ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  const at = entries.findIndex((candidate) => candidate.id === entry.id);
  if (at < 0) return [...entries, entry].slice(-ACTIVITY_LIMIT);
  return entries.map((candidate, index) => (index === at ? entry : candidate));
}

export type UndoState = { kind: "available"; entry: ActivityEntry; scope: string } | { kind: "unavailable"; reason: string };

export const NOTHING_TO_UNDO = "No local operation to undo in this session";

export function undoState(entries: readonly ActivityEntry[], repo: string): UndoState {
  const last = [...entries].reverse().find((entry) => entry.repo === repo && entry.local && entry.ok && entry.undo.kind !== "undone");
  if (last === undefined) return { kind: "unavailable", reason: NOTHING_TO_UNDO };
  if (last.undo.kind === "available") return { kind: "available", entry: last, scope: last.undo.scope };
  return { kind: "unavailable", reason: last.undo.kind === "unavailable" ? `${last.operation}: ${last.undo.reason}` : NOTHING_TO_UNDO };
}

export type Toast = { id: number; entry: ActivityEntry; message: string; undoable: boolean };

export function toastFor(entry: ActivityEntry, current: string | undefined): Toast | undefined {
  if (!entry.toast || !entry.ok || entry.repo !== current) return undefined;
  return { id: entry.id, entry, message: entry.summary, undoable: entry.undo.kind === "available" };
}

export function refreshToasts(toasts: readonly Toast[], entry: ActivityEntry, current: string | undefined): Toast[] {
  const rest = toasts.filter((toast) => toast.id !== entry.id);
  const next = toastFor(entry, current);
  return next === undefined ? rest : [...rest, next];
}

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

export function entriesFor(entries: readonly ActivityEntry[], repo: string | undefined): ActivityEntry[] {
  return repo === undefined ? [...entries] : entries.filter((entry) => entry.repo === repo);
}

export const commandText = (entry: ActivityEntry): string => entry.commands.map((record) => record.command).join("\n");

export const outputText = (entry: ActivityEntry): string =>
  entry.commands
    .filter((record) => record.output !== "")
    .map((record) => `$ ${record.command}\n${record.output}`)
    .join("\n\n");
