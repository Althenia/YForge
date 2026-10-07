import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoUiPrefs } from "../ipc/bindings/RepoUiPrefs";
import { createQueryClient } from "./queryClient";
import { columnVisibility, columnWidths, createRepoUiPrefs, defaultUiPrefs, resetColumns, toggleFolder, withColumn, withVisibility } from "./repoUiPrefs";

afterEach(() => clearMocks());

describe("repository interface preferences", () => {
  it("starts with only the default columns, no collapsed folders, and every branch visible", () => {
    expect(defaultUiPrefs).toEqual({ columns: [], collapsed_folders: [], branch_visibility: { kind: "all" } });
    expect(columnVisibility(defaultUiPrefs)).toEqual({ author: false, date: false, sha: false });
    expect(columnWidths(defaultUiPrefs)).toEqual({});
  });

  it("shows, hides, and resizes a column, and never hides the Branch / Tag column", () => {
    const shown = withColumn(defaultUiPrefs, "author", { visible: true });
    const sized = withColumn(withColumn(shown, "author", { width: 150 }), "refs", { width: 210, visible: false });

    expect(sized.columns).toEqual([
      { column: "author", visible: true, width: 150 },
      { column: "refs", visible: true, width: 210 },
    ]);
    expect(columnVisibility(sized)).toEqual({ author: true, date: false, sha: false });
    expect(columnWidths(sized)).toEqual({ author: 150, refs: 210 });
    expect(withColumn(sized, "author", { visible: false }).columns[0]).toEqual({ column: "author", visible: false, width: 150 });
  });

  it("keeps a resized graph column visible in repository preferences", () => {
    const sized = withColumn(defaultUiPrefs, "graph", { visible: false, width: 164 });
    expect(sized.columns).toEqual([{ column: "graph", visible: true, width: 164 }]);
    expect(columnWidths(sized)).toEqual({ graph: 164 });
  });

  it("resets the columns without touching folders or branch visibility", () => {
    const prefs: RepoUiPrefs = { columns: [{ column: "sha", visible: true, width: 90 }], collapsed_folders: ["local:x"], branch_visibility: { kind: "current_and_upstream" } };

    expect(resetColumns(prefs)).toEqual({ ...prefs, columns: [] });
  });

  it("toggles a folder and sets the branch visibility", () => {
    const collapsed = toggleFolder(defaultUiPrefs, "local:feature");
    expect(collapsed.collapsed_folders).toEqual(["local:feature"]);
    expect(toggleFolder(collapsed, "local:feature").collapsed_folders).toEqual([]);
    expect(withVisibility(defaultUiPrefs, { kind: "current_and_upstream" }).branch_visibility).toEqual({ kind: "current_and_upstream" });
  });
});

describe("repository interface preference store", () => {
  const stored: RepoUiPrefs = { columns: [{ column: "date", visible: true, width: 100 }], collapsed_folders: ["local:a"], branch_visibility: { kind: "all" } };

  function mount(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      return handler(cmd, (args ?? {}) as Record<string, unknown>);
    });
    const reported: unknown[] = [];
    const client = createQueryClient();
    let store!: ReturnType<typeof createRepoUiPrefs>;
    const dispose = createRoot((disposeRoot) => {
      store = createRepoUiPrefs("/r", client, (failure) => reported.push(failure));
      return disposeRoot;
    });
    return { store, calls, reported, dispose };
  }

  it("loads the stored preferences for the repository and applies changes while saving them", async () => {
    const { store, calls, dispose } = mount((cmd) => (cmd === "repo_ui_prefs_load" ? stored : null));
    expect(store.prefs()).toEqual(defaultUiPrefs);
    await vi.waitFor(() => expect(store.prefs()).toEqual(stored));

    store.update((prefs) => toggleFolder(prefs, "local:b"));
    await vi.waitFor(() => expect(store.prefs().collapsed_folders).toEqual(["local:a", "local:b"]));
    store.update((prefs) => withVisibility(prefs, { kind: "current_and_upstream" }));
    await vi.waitFor(() => expect(calls.filter((call) => call.cmd === "repo_ui_prefs_save")).toHaveLength(2));

    const saves = calls.filter((call) => call.cmd === "repo_ui_prefs_save").map((call) => call.args);
    expect(saves[0]).toEqual({ path: "/r", prefs: { ...stored, collapsed_folders: ["local:a", "local:b"] } });
    expect(saves[1]).toMatchObject({ prefs: { branch_visibility: { kind: "current_and_upstream" }, collapsed_folders: ["local:a", "local:b"] } });
    dispose();
  });

  it("reports a refused save and goes back to what is stored", async () => {
    const { store, reported, dispose } = mount((cmd) => {
      if (cmd === "repo_ui_prefs_save") throw { kind: "invalid_request", message: "a column width must be 24 to 2000 pixels", output: null };
      return cmd === "repo_ui_prefs_load" ? stored : null;
    });
    await vi.waitFor(() => expect(store.prefs()).toEqual(stored));

    store.update((prefs) => withColumn(prefs, "date", { width: 5 }));
    await vi.waitFor(() => expect(reported).toHaveLength(1));

    await vi.waitFor(() => expect(store.prefs()).toEqual(stored));
    dispose();
  });
});
