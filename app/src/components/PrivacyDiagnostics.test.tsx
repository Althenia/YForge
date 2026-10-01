import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";
import { defaultSettings } from "../state/settingsModel";
import { SettingsView } from "./SettingsView";
import { buttonNamed, flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const usage = (id: number, overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id,
  occurred_at: 1_790_000_000,
  app_version: "0.1.0",
  event: "stage_all",
  ok: true,
  error_kind: null,
  duration_ms: 12,
  count: 2,
  correlation_id: id,
  ...overrides,
});

const crash = (id: number, overrides: Partial<CrashRecord> = {}): CrashRecord => ({
  id,
  occurred_at: 1_790_000_000,
  origin: "frontend",
  kind: "render",
  app_version: "0.1.0",
  os: "macos",
  arch: "aarch64",
  thread: null,
  message: "cannot read properties of undefined\nsecond line",
  location: null,
  stack: "TypeError: cannot read\n    at Graph (graph.tsx:10)",
  view: "/repo",
  ...overrides,
});

const entry = (id: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  repo: "/r",
  operation: "commit",
  summary: `Committed change ${id}`,
  started_at: 1_790_000_000,
  duration_ms: 30,
  ok: true,
  local: true,
  toast: true,
  error: null,
  commands: [],
  undo: { kind: "unavailable", reason: "Undo is only available in the session that ran the operation" },
  ...overrides,
});

type World = { settings: AppSettings; usage: UsageRecord[]; crashes: CrashRecord[]; history: ActivityEntry[]; session: ActivityEntry[]; saved: string | undefined; count: number; exportFailure: string | undefined };

function install(world: Partial<World> = {}) {
  const state: World = { settings: { ...defaultSettings }, usage: [], crashes: [], history: [], session: [], saved: "/tmp/export.json", count: 2, exportFailure: undefined, ...world };
  const calls: Call[] = [];
  const page = <T extends { id: number }>(rows: T[], args: Record<string, unknown>): T[] => {
    const before = args.before as number | null;
    return rows.filter((row) => before === null || row.id < before).slice(0, args.limit as number);
  };
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    switch (cmd) {
      case "settings_load":
        return state.settings;
      case "settings_save": {
        const next = call.args.settings as AppSettings;
        if (state.settings.telemetry_opt_in && !next.telemetry_opt_in) state.usage = [];
        state.settings = next;
        return next;
      }
      case "session_load":
        return { tabs: ["/r"], active: 0 };
      case "launch_path":
        return "/nowhere";
      case "repo_open":
        throw { kind: "not_a_repository", message: "not a repository", output: null };
      case "recents_list":
        return [];
      case "activity_list":
        return state.session;
      case "activity_history":
        return page(state.history, call.args);
      case "activity_clear":
        state.history = [];
        state.session = [];
        return null;
      case "usage_list":
        return page(state.usage, call.args);
      case "usage_clear":
        state.usage = [];
        return null;
      case "usage_export":
      case "crash_export":
        if (state.exportFailure !== undefined) throw { kind: "invalid_request", message: state.exportFailure, output: null };
        return state.count;
      case "crash_list":
        return page(state.crashes, call.args);
      case "crash_clear":
        state.crashes = [];
        return null;
      case "plugin:dialog|save":
        return state.saved ?? null;
      default:
        return null;
    }
  });
  return { calls, state };
}

async function open(world: Partial<World> = {}) {
  const installed = install(world);
  const mounted = mountWithApp(() => <SettingsView section="privacy" />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return { ...mounted, ...installed };
}

const region = (host: ParentNode, name: string): HTMLElement => {
  const found = host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  if (found === null) throw new Error(`no ${name} section`);
  return found;
};

const usageSwitch = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Record usage data"]');
const rowsOf = (section: HTMLElement) => [...section.querySelectorAll("li.act-entry")].map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "");

describe("privacy and diagnostics settings", () => {
  it("is a settings section with usage recording off by default, stating what is recorded and that nothing leaves this Mac", async () => {
    const { host, calls } = await open();
    const usageSection = region(host, "Usage data");

    expect(host.querySelector('.settings-nav [aria-current="page"]')?.textContent).toContain("Privacy & diagnostics");
    expect(usageSwitch(host)?.getAttribute("aria-checked")).toBe("false");
    expect(usageSection.textContent).toContain("Off");
    for (const recorded of ["type", "whether it succeeded", "how long it took", "how many Git commands it ran"]) expect(usageSection.textContent).toContain(recorded);
    expect(usageSection.textContent).toContain("Paths, branch names, and messages are never recorded");
    expect(usageSection.textContent).toContain("nothing leaves this Mac");
    expect(usageSection.textContent).toContain("Turning it off deletes the stored events");
    expect(buttonNamed(usageSection, "Export…")).toBeUndefined();
    expect(calls.some((call) => call.cmd === "usage_list")).toBe(false);
  });

  it("saves the opt-in, then lists the stored usage events with their type, outcome, duration, and command count", async () => {
    const { host, calls, state } = await open({ usage: [usage(2, { event: "push", ok: false, error_kind: "push_rejected", duration_ms: 1500, count: 1 }), usage(1)] });

    usageSwitch(host)?.click();
    await flush();
    const usageSection = region(host, "Usage data");

    expect(calls.filter((call) => call.cmd === "settings_save").map((call) => (call.args.settings as AppSettings).telemetry_opt_in)).toEqual([true]);
    expect(state.settings.telemetry_opt_in).toBe(true);
    expect(usageSwitch(host)?.getAttribute("aria-checked")).toBe("true");
    expect(rowsOf(usageSection)).toEqual([expect.stringMatching(/Push.*failed \(push rejected\).*1\.5 s.*1 command$/), expect.stringMatching(/Stage all.*succeeded.*12 ms.*2 commands$/)]);
    expect(calls.find((call) => call.cmd === "usage_list")?.args).toEqual({ before: null, limit: 25 });
  });

  it("shows an empty state while recording is on and nothing was recorded", async () => {
    const { host } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true } });

    expect(region(host, "Usage data").textContent).toContain("No usage events recorded yet");
  });

  it("pages usage events, requesting the next page from the last id shown", async () => {
    const usageRows = Array.from({ length: 30 }, (_, index) => usage(30 - index));
    const { host, calls } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: usageRows });
    const usageSection = region(host, "Usage data");

    expect(rowsOf(usageSection)).toHaveLength(25);
    buttonNamed(usageSection, "Show older")?.click();
    await flush();

    expect(rowsOf(usageSection)).toHaveLength(30);
    expect(calls.filter((call) => call.cmd === "usage_list").map((call) => call.args)).toEqual([
      { before: null, limit: 25 },
      { before: 6, limit: 25 },
    ]);
    expect(buttonNamed(usageSection, "Show older")).toBeUndefined();
  });

  it("exports usage events to the path chosen in the save dialog and reports the count", async () => {
    const { host, calls } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: [usage(1), usage(2)] });
    const usageSection = region(host, "Usage data");

    buttonNamed(usageSection, "Export…")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "usage_export")?.args).toEqual({ path: "/tmp/export.json" });
    expect(usageSection.querySelector('[role="status"]')?.textContent).toContain("Exported 2 usage events to /tmp/export.json");
  });

  it("exports nothing when the save dialog is dismissed", async () => {
    const { host, calls } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: [usage(1)], saved: undefined });

    buttonNamed(region(host, "Usage data"), "Export…")?.click();
    await flush();

    expect(calls.some((call) => call.cmd === "usage_export")).toBe(false);
  });

  it("shows the refusal when an export fails and does not claim it succeeded", async () => {
    const { host } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: [usage(1)], exportFailure: "Invalid request: path must be absolute" });
    const usageSection = region(host, "Usage data");

    buttonNamed(usageSection, "Export…")?.click();
    await flush();

    expect(usageSection.querySelector('[role="alert"]')?.textContent).toContain("path must be absolute");
    expect(usageSection.querySelector('[role="status"]')).toBeNull();
  });

  it("deletes all usage events only after confirmation", async () => {
    const { host, calls } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: [usage(1)] });
    const usageSection = region(host, "Usage data");

    buttonNamed(usageSection, "Delete all")?.click();
    await flush();
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete all usage data?");
    buttonNamed(document.body, "Cancel")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "usage_clear")).toBe(false);

    buttonNamed(usageSection, "Delete all")?.click();
    await flush();
    buttonNamed(document.body, "Delete usage data")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "usage_clear")).toHaveLength(1);
    expect(usageSection.textContent).toContain("No usage events recorded yet");
    expect(rowsOf(usageSection)).toEqual([]);
  });

  it("states that stored events were deleted when recording is turned off, and hides the list", async () => {
    const { host, calls, state } = await open({ settings: { ...defaultSettings, telemetry_opt_in: true }, usage: [usage(1)] });
    const usageSection = region(host, "Usage data");
    expect(rowsOf(usageSection)).toHaveLength(1);

    usageSwitch(host)?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "settings_save").map((call) => (call.args.settings as AppSettings).telemetry_opt_in)).toEqual([false]);
    expect(state.usage).toEqual([]);
    expect(usageSwitch(host)?.getAttribute("aria-checked")).toBe("false");
    expect(usageSection.querySelector('[role="status"]')?.textContent).toContain("Stored usage events were deleted");
    expect(rowsOf(usageSection)).toEqual([]);
    expect(buttonNamed(usageSection, "Delete all")).toBeUndefined();
  });

  it("lists crash reports with time, origin, kind, and the first line of the message, and expands their details", async () => {
    const { host } = await open({ crashes: [crash(2, { origin: "rust", kind: "panic", message: "index out of bounds", location: "src/graph.rs:41:9", stack: null, view: null }), crash(1)] });
    const crashSection = region(host, "Crash reports");

    const [first, second] = rowsOf(crashSection);
    expect(first).toMatch(/rust.*panic.*index out of bounds/);
    expect(second).toMatch(/frontend.*render.*cannot read properties of undefined$/);
    expect(second).not.toContain("second line");
    const heads = crashSection.querySelectorAll<HTMLButtonElement>("button.act-head");
    expect(heads[0]?.getAttribute("aria-expanded")).toBe("false");
    heads[0]?.click();
    heads[1]?.click();
    await flush();

    const details = [...crashSection.querySelectorAll(".act-body")].map((body) => body.textContent ?? "");
    expect(details[0]).toContain("src/graph.rs:41:9");
    expect(details[1]).toContain("TypeError: cannot read");
    expect(details[1]).toContain("at Graph (graph.tsx:10)");
    expect(details[1]).toContain("/repo");
    expect(details[1]).toContain("cannot read properties of undefined");
    expect(details[1]).toContain("second line");
  });

  it("exports crash reports to the chosen path and clears them after confirmation", async () => {
    const { host, calls } = await open({ crashes: [crash(1)] });
    const crashSection = region(host, "Crash reports");

    buttonNamed(crashSection, "Export…")?.click();
    await flush();
    buttonNamed(crashSection, "Clear")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "crash_clear")).toBe(false);
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("Clear crash reports?");
    buttonNamed(document.body, "Clear crash reports")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "crash_export")?.args).toEqual({ path: "/tmp/export.json" });
    expect(crashSection.querySelector('[role="status"]')?.textContent).toContain("Exported 2 crash reports to /tmp/export.json");
    expect(calls.filter((call) => call.cmd === "crash_clear")).toHaveLength(1);
    expect(crashSection.textContent).toContain("No crash reports");
  });

  it("shows the persisted history of the active repository, newest first, marking earlier sessions as having no undo", async () => {
    const { host, calls } = await open({ history: [entry(9), entry(8), entry(7)], session: [entry(9, { undo: { kind: "available", scope: "Move HEAD back" } })] });
    const historySection = region(host, "Activity history");

    expect(calls.find((call) => call.cmd === "activity_history")?.args).toEqual({ repo: "/r", before: null, limit: 25 });
    const rows = rowsOf(historySection);
    expect(rows.map((row) => /change (\d)/.exec(row)?.[1])).toEqual(["9", "8", "7"]);
    expect(rows[0]).not.toContain("Earlier session — no undo");
    expect(rows[1]).toContain("Earlier session — no undo");
    expect(rows[2]).toContain("Earlier session — no undo");
  });

  it("clears the history of the active repository after confirmation and refreshes the list", async () => {
    const { host, calls, app } = await open({ history: [entry(9), entry(8)], session: [entry(9)] });
    const historySection = region(host, "Activity history");

    buttonNamed(historySection, "Clear history")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "activity_clear")).toBe(false);
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("Clear activity history for r?");
    buttonNamed(document.body.querySelector<HTMLElement>('[role="alertdialog"]') as HTMLElement, "Clear history")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "activity_clear").map((call) => call.args)).toEqual([{ repo: "/r" }]);
    expect(historySection.textContent).toContain("No activity recorded for this repository");
    expect(app.activity()).toEqual([]);
  });
});

describe("profile pictures setting", () => {
  const pictureSwitch = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Show profile pictures from Gravatar"]');

  it("is on by default, says that only a hash of the email is sent, and turns the pictures off and on", async () => {
    const { host } = await open();
    const section = region(host, "Profile pictures");

    expect(pictureSwitch(host)?.getAttribute("aria-checked")).toBe("true");
    expect(section.textContent).toContain("On");
    expect(section.textContent).toContain("MD5 hash of the author's email");
    expect(section.textContent).toContain("never the email itself");
    expect(section.textContent).toContain("initial");

    pictureSwitch(host)?.click();
    await flush();
    expect(host.textContent).toContain("Off");
    expect(pictureSwitch(host)?.getAttribute("aria-checked")).toBe("false");
    expect(section.textContent).toContain("Off");

    pictureSwitch(host)?.click();
    await flush();
    expect(host.textContent).toContain("On");
  });

  it("no longer claims that nothing is sent anywhere, since the pictures are fetched when on", async () => {
    const { host } = await open();

    expect(host.textContent).not.toContain("Nothing is sent anywhere");
  });
});
