import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUiPrefs } from "../ipc/bindings/AppUiPrefs";
import {
  createAppUiPrefs,
  defaultAppUiPrefs,
  rememberCommand,
  steppedZoom,
  withFileListMode,
  withInspectorToggled,
  withParentFolder,
  withSidebarToggled,
  withSyntaxToggled,
  withZoom,
  ZOOM_STEPS,
  zoomBlockReason,
} from "./appUiPrefs";
import { createQueryClient } from "./queryClient";

afterEach(() => clearMocks());

const view = { zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };

describe("application interface preferences", () => {
  it("starts with no recent commands, no remembered folder, and file lists by path", () => {
    expect(defaultAppUiPrefs).toEqual({ ...view, palette_recents: [], last_parent_folder: null, file_list_mode: "path" });
  });

  it("remembers the file list view and keeps the rest", () => {
    const next = withFileListMode(rememberCommand(defaultAppUiPrefs, "a"), "tree");
    expect(next).toEqual({ ...view, palette_recents: ["a"], last_parent_folder: null, file_list_mode: "tree" });
  });

  it("remembers a run command newest first, without duplicates, at most eight", () => {
    const once = rememberCommand(rememberCommand(rememberCommand(defaultAppUiPrefs, "a"), "b"), "a");
    expect(once.palette_recents).toEqual(["a", "b"]);

    const many = Array.from({ length: 10 }, (_, index) => `c${index}`).reduce(rememberCommand, defaultAppUiPrefs);
    expect(many.palette_recents).toEqual(["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2"]);
  });

  it("remembers the last parent folder and keeps the recent commands", () => {
    const next = withParentFolder(rememberCommand(defaultAppUiPrefs, "a"), "/Users/yui/code");
    expect(next).toEqual({ ...view, palette_recents: ["a"], last_parent_folder: "/Users/yui/code", file_list_mode: "path" });
  });
});

describe("zoom, layout, and syntax highlighting preferences", () => {
  it("steps through 80, 90, 100, 110, 125, 140, 150, 175, and 200 percent and stops at the ends", () => {
    expect([...ZOOM_STEPS]).toEqual([80, 90, 100, 110, 125, 140, 150, 175, 200]);
    const up = [100];
    for (let count = 0; count < 9; count += 1) up.push(steppedZoom(up.at(-1) ?? 100, "in"));
    expect(up).toEqual([100, 110, 125, 140, 150, 175, 200, 200, 200, 200]);
    const down = [100];
    for (let count = 0; count < 4; count += 1) down.push(steppedZoom(down.at(-1) ?? 100, "out"));
    expect(down).toEqual([100, 90, 80, 80, 80]);
    expect(steppedZoom(175, "reset")).toBe(100);
  });

  it("snaps a stored value that is not a step to the nearest step in the direction of travel", () => {
    expect(steppedZoom(120, "in")).toBe(125);
    expect(steppedZoom(120, "out")).toBe(110);
  });

  it("says why a zoom move cannot act at the ends and at 100 percent", () => {
    expect(zoomBlockReason(200, "in")).toBe("Already at 200%, the largest size");
    expect(zoomBlockReason(80, "out")).toBe("Already at 80%, the smallest size");
    expect(zoomBlockReason(100, "reset")).toBe("Already at 100%");
    expect(zoomBlockReason(150, "in")).toBeUndefined();
    expect(zoomBlockReason(150, "out")).toBeUndefined();
    expect(zoomBlockReason(150, "reset")).toBeUndefined();
  });

  it("changes one preference at a time and keeps the rest", () => {
    const zoomed = withZoom(rememberCommand(defaultAppUiPrefs, "a"), "in");
    expect(zoomed).toEqual({ ...defaultAppUiPrefs, palette_recents: ["a"], zoom_percent: 110 });
    expect(withSidebarToggled(zoomed).sidebar_hidden).toBe(true);
    expect(withInspectorToggled(withInspectorToggled(zoomed)).inspector_hidden).toBe(false);
    expect(withSyntaxToggled(zoomed)).toEqual({ ...zoomed, syntax_highlighting: false });
  });
});

describe("application interface preference store", () => {
  const stored: AppUiPrefs = { ...view, palette_recents: ["tab.new"], last_parent_folder: "/Users/yui/code", file_list_mode: "path" };

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
    expect(saves[0]).toEqual({ prefs: { ...view, palette_recents: ["repo.fetch", "tab.new"], last_parent_folder: "/Users/yui/code", file_list_mode: "path" } });
    expect(saves[1]).toEqual({ prefs: { ...view, palette_recents: ["repo.fetch", "tab.new"], last_parent_folder: "/tmp/work", file_list_mode: "path" } });
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
