import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { defaultSettings } from "../state/settingsModel";
import { Toasts } from "./Toasts";
import { buttonNamed, mountWithApp } from "./testkit";

const tick = (ms = 10) => vi.advanceTimersByTimeAsync(ms);

let dispose: (() => void) | undefined;

let windowFocused = true;

beforeEach(() => {
  windowFocused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => windowFocused);
  vi.useFakeTimers();
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await vi.advanceTimersByTimeAsync(5);
  document.body.innerHTML = "";
  clearMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const entry = (extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 1,
  repo: "/r",
  operation: "Commit",
  summary: "Committed abc1234",
  started_at: 0,
  duration_ms: 5,
  ok: true,
  local: true,
  toast: true,
  error: null,
  commands: [],
  undo: { kind: "available", scope: "Undo commit abc1234: moves main back to 9f8e7d6" },
  ...extra,
});

async function mount(undone: number[] = []) {
  mockIPC(
    (cmd) => {
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "repo_aliases_list") return [];
      if (cmd === "session_load") return { tabs: ["/r"], active: 0, groups: [] };
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") throw { kind: "not_a_repository", message: "no", output: null };
      if (cmd === "activity_list" || cmd === "recents_list") return [];
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp((app) => {
    app.bind();
    return <Toasts onUndo={(id) => undone.push(id)} />;
  });
  dispose = mounted.dispose;
  await mounted.app.boot();
  await tick();
  return mounted;
}

const record = async (value: ActivityEntry) => {
  await emit("activity-recorded", value);
  await tick();
};

describe("toasts", () => {
  it("shows the outcome with Undo, whose tooltip states the undo scope, and Undo reports the entry id", async () => {
    const undone: number[] = [];
    const { host } = await mount(undone);

    await record(entry());

    expect(host.querySelector(".toast")?.textContent).toContain("Committed abc1234");
    const undo = buttonNamed(host, "Undo");
    expect(undo?.title).toBe("Undo commit abc1234: moves main back to 9f8e7d6");
    undo?.click();
    expect(undone).toEqual([1]);
  });

  it("omits Undo when the operation has none and ignores failures, quiet operations, and other repositories", async () => {
    const { host } = await mount();

    await record(entry({ id: 2, undo: { kind: "unavailable", reason: "x" } }));
    expect(buttonNamed(host, "Undo")).toBeUndefined();
    expect(host.querySelectorAll(".toast")).toHaveLength(1);
    await record(entry({ id: 3, ok: false, error: "boom" }));
    await record(entry({ id: 4, toast: false }));
    await record(entry({ id: 5, repo: "/other" }));

    expect(host.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("removes the Undo button once the operation is undone", async () => {
    const { host } = await mount();
    await record(entry());

    await record(entry({ undo: { kind: "undone" } }));

    expect(buttonNamed(host, "Undo")).toBeUndefined();
  });

  it("dismisses a success toast after five seconds, but not while the pointer is over it", async () => {
    const { host } = await mount();
    await record(entry());
    const toast = host.querySelector(".toast");

    toast?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    toast?.dispatchEvent(new MouseEvent("mouseenter"));
    await tick(7000);
    expect(host.querySelector(".toast")).not.toBeNull();
    toast?.dispatchEvent(new MouseEvent("mouseleave"));
    await tick(4900);
    expect(host.querySelector(".toast")).not.toBeNull();
    await tick(200);

    expect(host.querySelector(".toast")).toBeNull();
  });

  it("waits while the window is unfocused and restarts the five seconds when it regains focus", async () => {
    const { host } = await mount();
    await record(entry());

    windowFocused = false;
    window.dispatchEvent(new Event("blur"));
    await tick(30000);
    expect(host.querySelector(".toast")).not.toBeNull();
    windowFocused = true;
    window.dispatchEvent(new Event("focus"));
    await tick(4900);
    expect(host.querySelector(".toast")).not.toBeNull();
    await tick(200);

    expect(host.querySelector(".toast")).toBeNull();
  });

  it("does not start counting for a toast that arrives while the window is unfocused", async () => {
    const { host } = await mount();
    windowFocused = false;
    window.dispatchEvent(new Event("blur"));

    await record(entry());
    await tick(30000);

    expect(host.querySelector(".toast")).not.toBeNull();
  });

  it("keeps a toast while keyboard focus is inside it and counts again after focus leaves", async () => {
    const { host } = await mount();
    await record(entry());
    const toast = host.querySelector(".toast");

    toast?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await tick(30000);
    expect(host.querySelector(".toast")).not.toBeNull();
    toast?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick(5100);

    expect(host.querySelector(".toast")).toBeNull();
  });

  it("dismisses on request", async () => {
    const { host } = await mount();
    await record(entry());

    host.querySelector<HTMLButtonElement>("button[aria-label=\"Dismiss\"]")?.click();
    await tick();

    expect(host.querySelector(".toast")).toBeNull();
  });

  it("is a pill with its status in words, one action, and a countdown ring (S48)", async () => {
    const { host } = await mount();
    await record(entry({ undo: { kind: "unavailable", reason: "x" } }));
    const toast = host.querySelector<HTMLElement>(".toast") as HTMLElement;

    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.querySelector(".sr-only")?.textContent).toBe("Done:");
    expect(toast.querySelector(".toast-ring")).not.toBeNull();
    expect([...toast.querySelectorAll("button")].map((button) => button.textContent?.trim() || button.getAttribute("aria-label"))).toEqual(["Details", "Dismiss"]);
  });

  it("shows at most three, newest first, and queues the rest behind a count", async () => {
    const { host } = await mount();
    for (const id of [1, 2, 3, 4, 5]) await record(entry({ id, summary: `Committed ${id}` }));

    expect([...host.querySelectorAll(".toast .toast-title")].map((title) => title.textContent)).toEqual(["Committed 5", "Committed 4", "Committed 3"]);
    expect(host.querySelector(".toast-more")?.textContent).toBe("2 more");
    host.querySelector<HTMLButtonElement>('.toast button[aria-label="Dismiss"]')?.click();
    await tick();
    expect([...host.querySelectorAll(".toast .toast-title")].map((title) => title.textContent)).toEqual(["Committed 4", "Committed 3", "Committed 2"]);
    expect(host.querySelector(".toast-more")?.textContent).toBe("1 more");
  });

  it("dismisses the newest toast with Esc", async () => {
    const { host } = await mount();
    await record(entry({ id: 1, summary: "First" }));
    await record(entry({ id: 2, summary: "Second" }));

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();

    expect([...host.querySelectorAll(".toast .toast-title")].map((title) => title.textContent)).toEqual(["First"]);
  });
});
