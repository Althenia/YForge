import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { commandText, entriesFor, formatDuration, NOTHING_TO_UNDO, outputText, refreshToasts, toastFor, undoState, upsertEntry } from "./activityModel";

let next = 0;
const entry = (extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: (next += 1),
  repo: "/r",
  operation: "Commit",
  summary: "Committed abc1234",
  started_at: 0,
  duration_ms: 120,
  ok: true,
  local: true,
  toast: true,
  error: null,
  commands: [{ command: "git commit --quiet -m X", status: 0, duration_ms: 90, output: "hook says hi" }],
  undo: { kind: "available", scope: "Undo commit abc1234: moves main back to 9f8e7d6" },
  ...extra,
});

describe("activity model", () => {
  it("upserts by id so an undone entry replaces its earlier version in place", () => {
    const first = entry();
    const second = entry();
    const undone = { ...first, undo: { kind: "undone" } as const };
    expect(upsertEntry([first, second], undone)).toEqual([undone, second]);
    expect(upsertEntry([first], second)).toEqual([first, second]);
  });

  it("offers Undo for the newest local, successful, not-yet-undone entry with its scope", () => {
    const state = undoState([entry(), entry({ operation: "Checkout", undo: { kind: "available", scope: "Undo checkout: switches back to main" } })], "/r");
    expect(state).toMatchObject({ kind: "available", scope: "Undo checkout: switches back to main" });
  });

  it("skips index-only, network, failed, other-repository, and undone entries when choosing the target", () => {
    const target = entry();
    const entries = [
      target,
      entry({ operation: "Stage", local: false, undo: { kind: "unavailable", reason: "x" } }),
      entry({ operation: "Push", local: false }),
      entry({ ok: false, error: "boom" }),
      entry({ repo: "/other" }),
      entry({ undo: { kind: "undone" } }),
    ];
    expect(undoState(entries, "/r")).toMatchObject({ kind: "available", entry: target });
  });

  it("disables Undo with the reason of the newest local entry, or a generic one when there is none", () => {
    const tag = entry({ operation: "Create tag", undo: { kind: "unavailable", reason: "Create tag has no safe undo" } });
    expect(undoState([entry(), tag], "/r")).toEqual({ kind: "unavailable", reason: "Create tag: Create tag has no safe undo" });
    expect(undoState([], "/r")).toEqual({ kind: "unavailable", reason: NOTHING_TO_UNDO });
    expect(undoState([entry({ repo: "/other" })], "/r")).toEqual({ kind: "unavailable", reason: NOTHING_TO_UNDO });
  });

  it("toasts only successful toast-worthy entries for the open repository, with Undo when available", () => {
    expect(toastFor(entry(), "/r")).toMatchObject({ message: "Committed abc1234", undoable: true });
    expect(toastFor(entry({ undo: { kind: "unavailable", reason: "x" } }), "/r")?.undoable).toBe(false);
    expect(toastFor(entry({ toast: false }), "/r")).toBeUndefined();
    expect(toastFor(entry({ ok: false }), "/r")).toBeUndefined();
    expect(toastFor(entry(), "/other")).toBeUndefined();
    expect(toastFor(entry(), undefined)).toBeUndefined();
  });

  it("drops a toast when its entry is undone and replaces it when the entry updates", () => {
    const committed = entry();
    const toasts = refreshToasts([], committed, "/r");
    expect(toasts).toHaveLength(1);
    expect(refreshToasts(toasts, { ...committed, undo: { kind: "undone" } }, "/r")[0]?.undoable).toBe(false);
    expect(refreshToasts(toasts, { ...committed, toast: false }, "/r")).toEqual([]);
  });

  it("formats durations, filters by repository, and exposes command lines and output for copy", () => {
    expect(formatDuration(120)).toBe("120 ms");
    expect(formatDuration(2500)).toBe("2.5 s");
    const one = entry();
    const two = entry({ repo: "/other" });
    expect(entriesFor([one, two], "/r")).toEqual([one]);
    expect(entriesFor([one, two], undefined)).toHaveLength(2);
    expect(commandText(one)).toBe("git commit --quiet -m X");
    expect(outputText(one)).toBe("$ git commit --quiet -m X\nhook says hi");
    expect(outputText(entry({ commands: [{ command: "git stash", status: 0, duration_ms: 1, output: "" }] }))).toBe("");
  });
});
