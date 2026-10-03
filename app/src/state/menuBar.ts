import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { PaletteCommand } from "./palette";

type Kind = "command" | "special";

export const MENU_ACTIONS: Readonly<Record<string, Kind>> = {
  "tab.new": "command",
  "repository.open": "command",
  "repository.clone": "command",
  "repository.create": "command",
  "launchpad.open": "command",
  "tab.close": "command",
  "tab.reopen": "command",
  "tab.next": "command",
  "tab.previous": "command",
  "settings.open": "command",
  "update.check": "command",
  "search.commits": "command",
  "head.reveal": "command",
  "sync.fetch": "command",
  "sync.pull": "command",
  "sync.push": "command",
  "branch.create": "command",
  "stash.push": "command",
  undo: "command",
  redo: "command",
  "zoom.in": "command",
  "zoom.out": "command",
  "zoom.reset": "command",
  "view.sidebar": "command",
  "view.inspector": "command",
  "repository.search": "command",
  "open.editor": "command",
  "edit.undo": "special",
  "edit.redo": "special",
  "palette.open": "special",
  "app.release_notes": "special",
  "help.docs": "special",
  "help.shortcuts": "special",
  "help.report_issue": "special",
  "theme.light": "special",
  "theme.dark": "special",
  "theme.system": "special",
  "density.default": "special",
  "density.compact": "special",
};

const PROJECT = "https://github.com/Althenia/YForge";

export const RELEASE_NOTES_URL = `${PROJECT}/releases`;

const PAGES: Readonly<Record<string, string>> = {
  "app.release_notes": RELEASE_NOTES_URL,
  "help.docs": `${PROJECT}#readme`,
  "help.report_issue": `${PROJECT}/issues/new`,
};

export type MenuDeps = {
  commands: () => PaletteCommand[];
  settings: () => AppSettings;
  saveSettings: (next: AppSettings) => Promise<unknown>;
  openPalette: () => void;
  openShortcuts: () => void;
  openUrl: (url: string) => void;
  editableFocused: () => boolean;
  editCommand: (name: "undo" | "redo") => void;
};

export function isEditable(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"].includes(element.type);
  return element instanceof HTMLElement && element.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function runCommand(deps: MenuDeps, id: string): void {
  const found = deps.commands().find((entry) => entry.id === id);
  if (found !== undefined && found.disabledReason === undefined) found.run([]);
}

export function runMenuAction(id: string, deps: MenuDeps): void {
  const kind = MENU_ACTIONS[id];
  if (kind === "command") return runCommand(deps, id);
  if (kind === undefined) return;
  const page = PAGES[id];
  if (page !== undefined) return deps.openUrl(page);
  if (id === "edit.undo") return deps.editableFocused() ? deps.editCommand("undo") : runCommand(deps, "undo");
  if (id === "edit.redo") return deps.editableFocused() ? deps.editCommand("redo") : runCommand(deps, "redo");
  if (id === "help.shortcuts") return deps.openShortcuts();
  if (id === "palette.open") return deps.openPalette();
  if (id.startsWith("theme.")) return void deps.saveSettings({ ...deps.settings(), theme: id.slice("theme.".length) as AppSettings["theme"] });
  if (id.startsWith("density.")) void deps.saveSettings({ ...deps.settings(), density: id.slice("density.".length) as AppSettings["density"] });
}

export function menuEnabled(commands: readonly PaletteCommand[], editableFocused: boolean): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const [id, kind] of Object.entries(MENU_ACTIONS)) {
    if (kind === "command") state[id] = commands.some((entry) => entry.id === id && entry.disabledReason === undefined);
    else state[id] = true;
  }
  state["edit.undo"] = editableFocused || state.undo === true;
  state["edit.redo"] = editableFocused || state.redo === true;
  return state;
}

export function menuChecked(settings: AppSettings): Record<string, boolean> {
  return {
    "theme.light": settings.theme === "light",
    "theme.dark": settings.theme === "dark",
    "theme.system": settings.theme === "system",
    "density.default": settings.density === "default",
    "density.compact": settings.density === "compact",
  };
}
