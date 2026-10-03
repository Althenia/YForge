import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import { firstLine } from "./diagnosticsModel";

export type ErrorRow = { key: string; time: number; kind: string; message: string };

export const NO_ERRORS = "No crashes or failed operations recorded";

export const USAGE_RECORDING_OFF = "Usage recording is off. Turn on Record usage data in Settings → Privacy & diagnostics to see operation durations here.";

export const NO_USAGE = "No operations recorded yet";

export function errorRows(crashes: readonly CrashRecord[], entries: readonly ActivityEntry[]): ErrorRow[] {
  const crashRows = crashes.map((crash): ErrorRow => ({ key: `crash-${crash.id}`, time: crash.occurred_at, kind: `Crash · ${crash.kind}`, message: firstLine(crash.message) }));
  const failedRows = entries
    .filter((entry) => !entry.ok)
    .map((entry): ErrorRow => ({ key: `operation-${entry.id}`, time: entry.started_at, kind: entry.operation, message: firstLine(entry.error ?? entry.summary) }));
  return [...crashRows, ...failedRows].sort((left, right) => right.time - left.time);
}
