import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import { errorRows } from "./logsModel";

const crash = (id: number, occurred_at: number, message: string): CrashRecord => ({ id, occurred_at, origin: "rust", kind: "panic", app_version: "0.1.1", os: "macos", arch: "aarch64", thread: null, message, location: null, stack: null, view: null });

const entry = (id: number, started_at: number, ok: boolean, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  repo: "/r",
  operation: "Push",
  summary: ok ? "Pushed" : "Push failed",
  started_at,
  duration_ms: 10,
  ok,
  local: false,
  toast: false,
  error: ok ? null : "rejected: non-fast-forward\nhint: pull first",
  commands: [],
  undo: { kind: "unavailable", reason: "" },
  ...extra,
});

describe("error log rows", () => {
  it("merges crashes and failed operations newest first with time, kind, and the first line of the message", () => {
    const rows = errorRows([crash(1, 100, "index out of bounds\nstack"), crash(2, 300, "later crash")], [entry(7, 200, false), entry(8, 250, true)]);

    expect(rows).toEqual([
      { key: "crash-2", time: 300, kind: "Crash · panic", message: "later crash" },
      { key: "operation-7", time: 200, kind: "Push", message: "rejected: non-fast-forward" },
      { key: "crash-1", time: 100, kind: "Crash · panic", message: "index out of bounds" },
    ]);
  });

  it("leaves out succeeded operations and falls back to the summary when a failure has no error text", () => {
    expect(errorRows([], [entry(1, 10, true)])).toEqual([]);
    expect(errorRows([], [entry(2, 10, false, { error: null })])[0]?.message).toBe("Push failed");
  });
});
