import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";
import type { LogTab } from "../state/palette";
import { defaultSettings } from "../state/settingsModel";
import { LogsSheet } from "./LogsSheet";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const crash: CrashRecord = { id: 1, occurred_at: 1_700_000_100, origin: "rust", kind: "panic", app_version: "0.1.1", os: "macos", arch: "aarch64", thread: null, message: "index out of bounds\nbacktrace", location: null, stack: null, view: null };

const usage = (id: number, extra: Partial<UsageRecord> = {}): UsageRecord => ({ id, occurred_at: 1_700_000_000 + id, app_version: "0.1.1", event: "fetch", ok: true, error_kind: null, duration_ms: 1500, count: 2, correlation_id: id, ...extra });

const failedPush: ActivityEntry = { id: 9, repo: "/r", operation: "Push", summary: "Push failed", started_at: 1_700_000_200, duration_ms: 40, ok: false, local: false, toast: false, error: "rejected: non-fast-forward\nhint", commands: [], undo: { kind: "unavailable", reason: "" } };

async function mount(options: { recording: boolean; crashes?: CrashRecord[]; usage?: UsageRecord[]; activity?: ActivityEntry[]; tab?: LogTab }) {
  mockIPC(
    (cmd) => {
      if (cmd === "settings_load") return { ...defaultSettings, telemetry_opt_in: options.recording };
      if (cmd === "session_load") return { tabs: [], active: 0, groups: [] };
      if (cmd === "repo_aliases_list" || cmd === "recents_list") return [];
      if (cmd === "activity_list") return options.activity ?? [];
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "crash_list") return options.crashes ?? [];
      if (cmd === "usage_list") return options.usage ?? [];
      return null;
    },
    { shouldMockEvents: true },
  );
  const onClose = vi.fn();
  const [tab, setTab] = createSignal<LogTab>(options.tab ?? "errors");
  const mounted = mountWithApp(() => <LogsSheet tab={tab()} onTab={setTab} onClose={onClose} />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush(60);
  return { ...mounted, onClose, tab };
}

const rows = (host: HTMLElement, label: string) => [...host.querySelectorAll(`ul[aria-label="${label}"] li`)].map((row) => row.textContent?.replace(/\s+/g, " ").trim());

describe("logs sheet (S61)", () => {
  it("offers the Error log and the Performance log as tabs", async () => {
    const { host } = await mount({ recording: true });

    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
      ["Error log", "true"],
      ["Performance log", "false"],
    ]);
  });

  it("lists the recorded crashes and the failed operations with their time, kind, and message, newest first", async () => {
    const { host } = await mount({ recording: false, crashes: [crash], activity: [failedPush, { ...failedPush, id: 10, ok: true, error: null }] });

    const listed = rows(host, "Error log");
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain("Push");
    expect(listed[0]).toContain("rejected: non-fast-forward");
    expect(listed[0]).not.toContain("hint");
    expect(listed[1]).toContain("Crash · panic");
    expect(listed[1]).toContain("index out of bounds");
    expect(host.querySelectorAll(".act-time").length).toBeGreaterThanOrEqual(2);
  });

  it("says when nothing was recorded", async () => {
    const { host } = await mount({ recording: false });

    expect(rows(host, "Error log")).toEqual(["No crashes or failed operations recorded"]);
  });

  it("lists the recorded operations with their durations in the Performance log", async () => {
    const { host } = await mount({ recording: true, usage: [usage(2), usage(1, { event: "push", ok: false, error_kind: "network", duration_ms: 320 })], tab: "performance" });

    const listed = rows(host, "Performance log");
    expect(listed).toHaveLength(2);
    expect(listed[0]).toContain("Fetch");
    expect(listed[0]).toContain("1.5 s");
    expect(listed[0]).toContain("2 commands");
    expect(listed[1]).toContain("Push");
    expect(listed[1]).toContain("failed (network)");
    expect(listed[1]).toContain("320 ms");
  });

  it("states that usage recording is off instead of an empty list", async () => {
    const { host } = await mount({ recording: false, usage: [usage(1)], tab: "performance" });

    expect(host.querySelector('[role="status"]')?.textContent).toContain("Usage recording is off");
    expect(host.querySelector('ul[aria-label="Performance log"]')).toBeNull();
  });

  it("switches between the logs and closes", async () => {
    const { host, onClose, tab } = await mount({ recording: true });

    host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    await flush();
    expect(tab()).toBe("performance");
    expect(host.querySelector('ul[aria-label="Performance log"]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>(".foot button")?.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
