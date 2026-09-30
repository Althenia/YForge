import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";
import { commandCount, earlierEntries, eventLabel, firstLine, pageOptions, PAGE_SIZE, usageOutcome } from "./diagnosticsModel";

const entry = (id: number): ActivityEntry => ({
  id,
  repo: "/r",
  operation: "commit",
  summary: "Committed",
  started_at: 0,
  duration_ms: 1,
  ok: true,
  local: true,
  toast: true,
  error: null,
  commands: [],
  undo: { kind: "unavailable", reason: "x" },
});

const usage = (overrides: Partial<UsageRecord>): UsageRecord => ({
  id: 1,
  occurred_at: 0,
  app_version: "0.1.0",
  event: "stage_all",
  ok: true,
  error_kind: null,
  duration_ms: 5,
  count: 1,
  correlation_id: 1,
  ...overrides,
});

describe("diagnostics model", () => {
  it("takes the first line of a multi-line message", () => {
    expect(firstLine("panicked at src/lib.rs\nstack backtrace:\n  0: frame")).toBe("panicked at src/lib.rs");
    expect(firstLine("single")).toBe("single");
    expect(firstLine("")).toBe("");
  });

  it("names an operation kind and its outcome in words", () => {
    expect(eventLabel("stage_all")).toBe("Stage all");
    expect(usageOutcome(usage({}))).toBe("succeeded");
    expect(usageOutcome(usage({ ok: false, error_kind: "push_rejected" }))).toBe("failed (push rejected)");
    expect(commandCount(1)).toBe("1 command");
    expect(commandCount(3)).toBe("3 commands");
  });

  it("drops persisted entries that this session already lists", () => {
    expect(earlierEntries([entry(9), entry(8), entry(7)], [entry(8), entry(9)]).map((each) => each.id)).toEqual([7]);
  });

  it("continues from the last id of a full page and stops after a short page", () => {
    const options = pageOptions<ActivityEntry>(["k"], async () => []);
    const full = Array.from({ length: PAGE_SIZE }, (_, index) => entry(100 - index));

    expect(options.getNextPageParam(full)).toBe(100 - PAGE_SIZE + 1);
    expect(options.getNextPageParam(full.slice(1))).toBeUndefined();
    expect(options.getNextPageParam([])).toBeUndefined();
  });
});
