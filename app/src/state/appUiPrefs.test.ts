import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUiPrefs } from "../ipc/bindings/AppUiPrefs";
import { createAppUiPrefs, defaultAppUiPrefs, rememberCommand, withParentFolder } from "./appUiPrefs";
import { createQueryClient } from "./queryClient";

afterEach(() => clearMocks());

describe("application interface preferences", () => {
  it("starts with no recent commands and no remembered folder", () => {
    expect(defaultAppUiPrefs).toEqual({ palette_recents: [], last_parent_folder: null });
  });

  it("remembers a run command newest first, without duplicates, at most eight", () => {
    const once = rememberCommand(rememberCommand(rememberCommand(defaultAppUiPrefs, "a"), "b"), "a");
    expect(once.palette_recents).toEqual(["a", "b"]);

    const many = Array.from({ length: 10 }, (_, index) => `c${index}`).reduce(rememberCommand, defaultAppUiPrefs);
    expect(many.palette_recents).toEqual(["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2"]);
  });

  it("remembers the last parent folder and keeps the recent commands", () => {
    const next = withParentFolder(rememberCommand(defaultAppUiPrefs, "a"), "/Users/yui/code");
    expect(next).toEqual({ palette_recents: ["a"], last_parent_folder: "/Users/yui/code" });
  });
});

describe("application interface preference store", () => {
  const stored: AppUiPrefs = { palette_recents: ["tab.new"], last_parent_folder: "/Users/yui/code" };

  function mount(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return handler(cmd, (args ?? {}) as Record<string, unknown>);
    });
    const reported: unknown[] = [];
    const client = createQueryClient();
    let store!: ReturnType<typeof createAppUiPrefs>;
    const dispose = createRoot((disposeRoot) => {
      store = createAppUiPrefs(client, (failure) => reported.push(failure));
      return disposeRoot;
    });
    return { store, calls, reported, dispose };
  }

  it("loads what the database holds and saves each change on top of it, in order", async () => {
    const { store, calls, dispose } = mount((cmd) => (cmd === "app_ui_prefs_load" ? stored : null));

    store.update((prefs) => rememberCommand(prefs, "repo.fetch"));
    store.update((prefs) => withParentFolder(prefs, "/tmp/work"));
    await vi.waitFor(() => expect(calls.filter((call) => call.cmd === "app_ui_prefs_save")).toHaveLength(2));

    const saves = calls.filter((call) => call.cmd === "app_ui_prefs_save").map((call) => call.args);
    expect(saves[0]).toEqual({ prefs: { palette_recents: ["repo.fetch", "tab.new"], last_parent_folder: "/Users/yui/code" } });
    expect(saves[1]).toEqual({ prefs: { palette_recents: ["repo.fetch", "tab.new"], last_parent_folder: "/tmp/work" } });
    await vi.waitFor(() => expect(store.prefs().last_parent_folder).toBe("/tmp/work"));
    dispose();
  });

  it("reports a refused save and goes back to what is stored", async () => {
    const { store, reported, dispose } = mount((cmd) => {
      if (cmd === "app_ui_prefs_load") return stored;
      throw { kind: "invalid_request", message: "refused", output: null };
    });

    store.update((prefs) => rememberCommand(prefs, "x"));
    await vi.waitFor(() => expect(reported).toHaveLength(1));

    await vi.waitFor(() => expect(store.prefs()).toEqual(stored));
    dispose();
  });
});
