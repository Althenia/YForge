import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import { buildCommands, type PaletteCommand } from "./palette";
import { isEditable, MENU_ACTIONS, menuChecked, menuEnabled, runMenuAction, type MenuDeps } from "./menuBar";
import { defaultSettings } from "./settingsModel";
import { SHORTCUTS } from "./shortcuts";

const command = (id: string, extra: Partial<PaletteCommand> = {}): PaletteCommand & { run: ReturnType<typeof vi.fn> } =>
  ({ id, title: id, group: "Application", covers: [], args: [], run: vi.fn(), ...extra }) as PaletteCommand & { run: ReturnType<typeof vi.fn> };

function deps(commands: PaletteCommand[], overrides: Partial<MenuDeps> = {}): MenuDeps & { opened: string[]; saved: AppSettings[]; edits: string[]; palette: ReturnType<typeof vi.fn>; shortcuts: ReturnType<typeof vi.fn> } {
  const opened: string[] = [];
  const saved: AppSettings[] = [];
  const edits: string[] = [];
  const palette = vi.fn();
  const shortcuts = vi.fn();
  return {
    commands: () => commands,
    settings: () => defaultSettings,
    saveSettings: async (next) => void saved.push(next),
    openPalette: palette,
    openShortcuts: shortcuts,
    openUrl: (url) => void opened.push(url),
    editableFocused: () => false,
    editCommand: (name) => void edits.push(name),
    ...overrides,
    opened,
    saved,
    edits,
    palette,
    shortcuts,
  };
}

const menuSource = readFileSync(resolve(import.meta.dirname, "../../src-tauri/src/menu.rs"), "utf8");

const menuIds = [...menuSource.matchAll(/(?:item\(\s*|id:\s*)"([\w.]+)"/g)].map((match) => match[1] as string);

describe("macOS menu bar actions", () => {
  it("runs the palette command a menu item stands for, and nothing when that command cannot act", () => {
    const fetch = command("sync.fetch");
    const pull = command("sync.pull", { disabledReason: "Open a repository first" });

    runMenuAction("sync.fetch", deps([fetch, pull]));
    runMenuAction("sync.pull", deps([fetch, pull]));

    expect(fetch.run).toHaveBeenCalledOnce();
    expect(pull.run).not.toHaveBeenCalled();
  });

  it("runs YForge's Undo for ⌘Z outside a text field and the field's own undo inside one", () => {
    const undo = command("undo");
    const outside = deps([undo]);
    const inside = deps([undo], { editableFocused: () => true });

    runMenuAction("edit.undo", outside);
    runMenuAction("edit.undo", inside);

    expect(undo.run).toHaveBeenCalledOnce();
    expect(outside.edits).toEqual([]);
    expect(inside.edits).toEqual(["undo"]);
  });

  it("runs YForge's Redo for ⇧⌘Z outside a text field and the field's own redo inside one", () => {
    const redo = command("redo");
    const outside = deps([redo]);
    const inside = deps([redo], { editableFocused: () => true });

    runMenuAction("edit.redo", outside);
    runMenuAction("edit.redo", inside);

    expect(redo.run).toHaveBeenCalledOnce();
    expect([outside.edits, inside.edits]).toEqual([[], ["redo"]]);
  });

  it("does not redo outside a text field when there is nothing to redo", () => {
    const redo = command("redo", { disabledReason: "Nothing to redo" });

    runMenuAction("edit.redo", deps([redo]));

    expect(redo.run).not.toHaveBeenCalled();
  });

  it("opens the palette for Command Palette and the shortcuts sheet for Keyboard Shortcuts", () => {
    const run = deps([]);

    runMenuAction("palette.open", run);
    runMenuAction("help.shortcuts", run);

    expect(run.palette).toHaveBeenCalledOnce();
    expect(run.shortcuts).toHaveBeenCalledOnce();
  });

  it("runs the zoom, sidebar, inspector, repository search, editor, and redo items through their palette commands", () => {
    const ids = ["zoom.in", "zoom.out", "zoom.reset", "view.sidebar", "view.inspector", "repository.search", "open.editor", "redo"];
    const commands = ids.map((id) => command(id));

    for (const id of ids) runMenuAction(id, deps(commands));

    for (const entry of commands) expect(entry.run, entry.id).toHaveBeenCalledOnce();
  });

  it("opens the project's GitHub pages for release notes, help, and issue reports", () => {
    const run = deps([]);

    runMenuAction("app.release_notes", run);
    runMenuAction("help.docs", run);
    runMenuAction("help.report_issue", run);

    expect(run.opened).toEqual(["https://github.com/Althenia/YForge/releases", "https://github.com/Althenia/YForge#readme", "https://github.com/Althenia/YForge/issues/new"]);
  });

  it("saves the chosen theme and density with the rest of the settings", () => {
    const run = deps([]);

    runMenuAction("theme.dark", run);
    runMenuAction("density.compact", run);

    expect(run.saved).toEqual([{ ...defaultSettings, theme: "dark" }, { ...defaultSettings, density: "compact" }]);
  });

  it("ignores an id it does not know", () => {
    const run = deps([command("tab.new")]);

    runMenuAction("nothing.here", run);

    expect(run.saved).toEqual([]);
    expect(run.opened).toEqual([]);
  });
});

describe("macOS menu bar state", () => {
  it("disables an item whose command cannot act, keeps the others enabled, and tracks the text field for Undo and Redo", () => {
    const commands = [command("sync.fetch", { disabledReason: "Open a repository first" }), command("tab.new"), command("undo", { disabledReason: "Nothing to undo" }), command("redo", { disabledReason: "Nothing to redo" }), command("tab.reopen", { disabledReason: "No closed tabs" }), command("update.check")];

    const outside = menuEnabled(commands, false);
    const inside = menuEnabled(commands, true);

    expect(outside).toMatchObject({ "sync.fetch": false, "tab.new": true, undo: false, redo: false, "tab.reopen": false, "edit.undo": false, "edit.redo": false, "palette.open": true, "update.check": true });
    expect(inside).toMatchObject({ "edit.undo": true, "edit.redo": true });
  });

  it("enables Redo Last Action and the Edit menu's Redo when there is something to redo, and disables zoom items that cannot act", () => {
    const commands = [command("redo"), command("zoom.in", { disabledReason: "Already at 200%, the largest size" }), command("zoom.out"), command("view.sidebar", { disabledReason: "Open a repository first" })];

    expect(menuEnabled(commands, false)).toMatchObject({ redo: true, "edit.redo": true, "zoom.in": false, "zoom.out": true, "view.sidebar": false });
  });

  it("marks the current theme and density", () => {
    expect(menuChecked({ ...defaultSettings, theme: "dark", density: "compact" })).toEqual({
      "theme.light": false,
      "theme.dark": true,
      "theme.system": false,
      "density.default": false,
      "density.compact": true,
    });
  });

  it("recognises a text field, a text area, and editable content, and nothing else", () => {
    const text = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    const area = document.createElement("textarea");
    const rich = document.createElement("div");
    rich.setAttribute("contenteditable", "true");

    expect([text, area, rich, box, document.createElement("button"), null].map(isEditable)).toEqual([true, true, true, false, false, false]);
  });
});

describe("macOS menu bar contents (S43)", () => {
  it("handles every item the Rust menu emits, and every palette-backed item is a real palette command", () => {
    const palette = buildCommands({
      snapshot: undefined,
      actions: undefined,
      selectedSha: undefined,
      selection: [],
      pullMode: "fast_forward_or_merge",
      offline: false,
      undo: { kind: "unavailable", reason: "" },
      redo: { kind: "unavailable", reason: "" },
      zoomPercent: 100,
      theme: "system",
      externalTools: undefined,
      lfs: undefined,
      anchor: { left: 0, top: 0 },
      app: {
        openLauncher: vi.fn(),
        openFolder: vi.fn(),
        openClone: vi.fn(),
        openCreate: vi.fn(),
        closeTab: vi.fn(),
        openSettings: vi.fn(),
        openLaunchpad: vi.fn(),
        addPlatformConnection: vi.fn(),
        toggleDrawer: vi.fn(),
        openSearch: vi.fn(),
        openExternal: vi.fn(),
        setTheme: vi.fn(),
        openRepository: vi.fn(),
        repositories: () => [],
        aliasOf: () => undefined,
        canReopenClosedTab: () => false,
        reopenClosedTab: vi.fn(),
        nextTab: vi.fn(),
        previousTab: vi.fn(),
        checkForUpdate: vi.fn(),
        openRepositorySearch: vi.fn(),
        openShortcuts: vi.fn(),
        openLogs: vi.fn(),
        openDrawer: vi.fn(),
        openReleaseNotes: vi.fn(),
        zoom: vi.fn(),
        toggleSidebar: vi.fn(),
        toggleInspector: vi.fn(),
        toggleSyntaxHighlighting: vi.fn(),
        toggleTheme: vi.fn(),
        switchProfile: vi.fn(),
        profileList: () => undefined,
        profileOptions: async () => [],
        openFileInTool: vi.fn(),
        openFileInEditor: vi.fn(),
        initializeLfs: vi.fn(),
      },
      platform: undefined,
      revealCommit: vi.fn(),
      revealRef: vi.fn(),
      focusComposer: vi.fn(),
      revealHead: vi.fn(),
      openPanel: vi.fn(),
      trackedFiles: async () => [],
      openFileHistory: vi.fn(),
      viewChanges: vi.fn(),
      redoLast: vi.fn(),
      createTag: vi.fn(),
      loadCommits: async () => [],
    });
    const commandIds = new Set(palette.map((entry) => entry.id));

    expect(menuIds.length).toBeGreaterThan(30);
    expect(menuIds.filter((id) => !(id in MENU_ACTIONS))).toEqual([]);
    expect(Object.entries(MENU_ACTIONS).filter(([, kind]) => kind === "command").map(([id]) => id).filter((id) => !commandIds.has(id))).toEqual([]);
  });

  it("names only shortcuts the registry holds", () => {
    const keys = [...menuSource.matchAll(/"\s*,\s*Some\("(\w+)"\)\s*,?\s*\)/g)].map((match) => match[1] as string);

    expect(keys.length).toBeGreaterThan(15);
    expect(keys.filter((key) => !(key in SHORTCUTS))).toEqual([]);
  });
});
