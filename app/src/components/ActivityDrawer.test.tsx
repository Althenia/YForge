import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { defaultSettings } from "../state/settingsModel";
import { ActivityDrawer } from "./ActivityDrawer";
import { buttonNamed, flush, mountWithApp } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

let dispose: (() => void) | undefined;

let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubScrollLayout({ viewport: 1500, row: 36, total: 2000 });
});

afterEach(() => {
  restoreLayout?.();
  vi.unstubAllGlobals();
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

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

async function open(options: { history: ActivityEntry[]; session: ActivityEntry[]; repo?: string | undefined; identity?: unknown; holdClear?: () => Promise<void> }) {
  let history = options.history;
  let session = options.session;
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    switch (cmd) {
      case "settings_load":
        return defaultSettings;
      case "repo_aliases_list":
        return [];
      case "session_load":
        return { tabs: [], active: 0, groups: [] };
      case "launch_path":
        return "/nowhere";
      case "repo_open":
        throw { kind: "not_a_repository", message: "not a repository", output: null };
      case "recents_list":
        return [];
      case "activity_list":
        return session;
      case "identity_read":
        return options.identity ?? null;
      case "avatar_url":
        return "https://www.gravatar.com/avatar/2befe04c9ff31d77bff2c10f99ffaa3b?s=48&d=identicon";
      case "activity_history": {
        const before = call.args.before as number | null;
        return history.filter((each) => before === null || each.id < before).slice(0, call.args.limit as number);
      }
      case "activity_clear":
        if (options.holdClear !== undefined) return options.holdClear().then(() => { history = []; session = []; return null; });
        history = []; session = [];
        return null;
      default:
        return null;
    }
  });
  const undone: number[] = [];
  const repo = "repo" in options ? options.repo : "/r";
  const mounted = mountWithApp(() => <ActivityDrawer repo={repo} onUndo={(id) => undone.push(id)} />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return { ...mounted, calls, undone };
}

const rowsOf = (host: ParentNode) => [...host.querySelectorAll("li.act-entry")].map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "");

describe("activity drawer earlier group", () => {
  it("announces clearing and locks the scope until the activity is removed", async () => {
    let finish: (() => void) | undefined;
    const { host, calls } = await open({ history: [entry(8)], session: [entry(9)], holdClear: () => new Promise<void>((resolve) => { finish = resolve; }) });
    buttonNamed(host, "Clear")?.click();
    await flush();
    const button = buttonNamed(host, "Clearing…");
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Clearing activity");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    button?.click();
    expect(calls.filter((call) => call.cmd === "activity_clear")).toHaveLength(1);
    finish?.();
    await flush(40);
    expect(buttonNamed(host, "Clear")?.disabled).toBe(false);
  });
  it("lists persisted entries of earlier sessions under Earlier, read-only and marked as having no undo", async () => {
    const { host, calls } = await open({
      history: [entry(9), entry(8), entry(7)],
      session: [entry(9, { summary: "Committed this session", undo: { kind: "available", scope: "Move HEAD back" } })],
    });

    expect(calls.find((call) => call.cmd === "activity_history")?.args).toEqual({ repo: "/r", before: null, limit: 25 });
    expect(host.querySelector(".act-group h3")?.textContent).toBe("Earlier");
    const rows = rowsOf(host);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Committed this session");
    expect(rows[0]).not.toContain("Earlier session — no undo");
    expect(rows[1]).toContain("Committed change 8");
    expect(rows[1]).toContain("Earlier session — no undo");
    expect(rows[2]).toContain("Committed change 7");
    const earlierRows = [...host.querySelectorAll("li.act-entry")].slice(1);
    for (const row of earlierRows) {
      expect(row.textContent).not.toContain("Undo available");
      expect([...row.querySelectorAll("button")].map((button) => button.textContent?.trim())).not.toContain("Undo");
    }
  });

  it("shows no Earlier group when nothing was persisted before this session", async () => {
    const { host } = await open({ history: [entry(9)], session: [entry(9)] });

    expect(host.querySelector(".act-group")).toBeNull();
    expect(rowsOf(host)).toHaveLength(1);
  });

  it("pages older entries from the last id shown", async () => {
    const history = Array.from({ length: 30 }, (_, index) => entry(30 - index));
    const { host, calls } = await open({ history, session: [] });

    expect(rowsOf(host)).toHaveLength(25);
    buttonNamed(host, "Show older")?.click();
    await flush();

    expect(rowsOf(host)).toHaveLength(30);
    expect(calls.filter((call) => call.cmd === "activity_history").map((call) => call.args.before)).toEqual([null, 6]);
    expect(buttonNamed(host, "Show older")).toBeUndefined();
  });

  it("hides the Earlier group for all repositories, since history is stored per repository", async () => {
    const { host } = await open({ history: [entry(8)], session: [entry(9)] });
    expect(rowsOf(host)).toHaveLength(2);

    host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await flush();

    expect(rowsOf(host)).toHaveLength(1);
    expect(host.querySelector(".act-group")).toBeNull();
  });

  it("does not ask for history without an active repository", async () => {
    const { calls, host } = await open({ history: [entry(8)], session: [], repo: undefined });

    expect(calls.some((call) => call.cmd === "activity_history")).toBe(false);
    expect(host.textContent).toContain("No operations yet in this session");
  });

  it("removes the Earlier group after Clear deletes the stored history", async () => {
    const { host, calls } = await open({ history: [entry(8)], session: [] });
    expect(rowsOf(host)).toHaveLength(1);

    buttonNamed(host, "Clear")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "activity_clear").map((call) => call.args)).toEqual([{ repo: "/r" }]);
    expect(rowsOf(host)).toHaveLength(0);
    expect(host.querySelector(".act-group")).toBeNull();
  });
});

describe("activity drawer identity badge", () => {
  const identity = { name: { value: "Yui", source: "global" }, email: { value: "Yui@Example.com", source: "global" } };
  const requested: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    referrerPolicy = "";
    set src(address: string) {
      requested.push(address);
      queueMicrotask(() => this.onload?.());
    }
  }

  it("shows the gravatar of the git identity the operations run as, next to its name", async () => {
    requested.length = 0;
    vi.stubGlobal("Image", FakeImage);
    const { host, calls } = await open({ history: [], session: [], identity });
    await flush(60);

    expect(host.querySelector(".drawer-who")?.textContent).toContain("Yui");
    expect(host.querySelector(".drawer-who .avatar img")).not.toBeNull();
    expect(calls.find((call) => call.cmd === "identity_read")?.args).toEqual({ path: "/r" });
    expect(calls.some((call) => call.cmd === "avatar_url")).toBe(true);
  });

});

describe("activity drawer with a full log", () => {
  const LOG = 300;
  const session = Array.from({ length: LOG }, (_, index) => entry(index + 1));

  it("renders only the entries in view, newest first, and reaches the oldest by scrolling", async () => {
    const { host } = await open({ history: [], session });

    expect(rowsOf(host).length).toBeGreaterThan(0);
    expect(rowsOf(host).length).toBeLessThan(60);
    expect(rowsOf(host)[0]).toContain(`Committed change ${LOG}`);

    (host.querySelector(".act-list") as HTMLElement).scrollTop = 1_000_000;
    await flush(80);
    await flush(80);

    expect([...host.querySelectorAll(".act-summary")].some((summary) => summary.textContent === "Committed change 1")).toBe(true);
    expect(rowsOf(host).length).toBeLessThan(60);
  });

  it("keeps an expanded entry expanded after it was scrolled out of view and back", async () => {
    const { host } = await open({ history: [], session: session.map((each) => (each.id === LOG ? { ...each, commands: [{ command: "git commit -m X", status: 0, duration_ms: 3, output: "" }] } : each)) });
    const list = host.querySelector(".act-list") as HTMLElement;
    host.querySelector<HTMLButtonElement>("li.act-entry .act-head")?.click();
    await flush();
    expect(host.querySelector("li.act-entry .act-body")?.textContent).toContain("git commit -m X");

    list.scrollTop = 1_000_000;
    await flush(80);
    await flush(80);
    list.scrollTop = 0;
    await flush(80);
    await flush(80);

    expect(host.querySelector("li.act-entry .act-head")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("li.act-entry .act-body")?.textContent).toContain("git commit -m X");
  });
});

describe("activity drawer entry time", () => {
  it("switches an entry from its time of day to its full date when the clock passes midnight", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      const started = new Date(2026, 9, 1, 23, 59, 0);
      vi.setSystemTime(new Date(2026, 9, 1, 23, 59, 30));
      const { host } = await open({ history: [], session: [entry(1, { started_at: started.getTime() / 1000 })] });
      const time = () => host.querySelector(".act-time")?.textContent ?? "";
      expect(time()).not.toContain("Oct");

      vi.advanceTimersByTime(60_000);
      await flush();

      expect(time()).toContain("1 Oct 2026");
    } finally {
      vi.useRealTimers();
    }
  });
});
