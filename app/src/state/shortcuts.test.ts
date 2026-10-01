import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hotkeyOf } from "./palette";
import { SHORTCUTS } from "./shortcuts";

const source = readFileSync(resolve(import.meta.dirname, "shortcuts.ts"), "utf8");

describe("shortcut registry", () => {
  it("gives every action its own shortcut", () => {
    const values = Object.values(SHORTCUTS);

    expect(new Set(values).size).toBe(values.length);
  });

  it("writes each shortcut as modifier glyphs followed by one key", () => {
    for (const [name, shortcut] of Object.entries(SHORTCUTS)) expect(shortcut, name).toMatch(/^[⌘⇧⌃⌥]*[A-Z0-9,↵⇥]$/);
  });

  it("keeps one `name: \"glyphs\",` line per shortcut, which is the form the macOS menu reads it in", () => {
    const lines = source.split("\n").filter((line) => /^ {2}\w+: /.test(line));

    expect(lines).toHaveLength(Object.keys(SHORTCUTS).length);
    for (const line of lines) expect(line).toMatch(/^ {2}\w+: "[^"]+",$/);
  });

  it("holds the shortcuts the tab and macOS menus use", () => {
    expect(SHORTCUTS).toMatchObject({
      newTab: "⌘T",
      closeTab: "⌘W",
      reopenClosedTab: "⌘⇧T",
      nextTab: "⌃⇥",
      previousTab: "⌃⇧⇥",
      settings: "⌘,",
      redo: "⌘⇧Z",
    });
  });

  it("turns every shortcut into a hotkey the keyboard layer accepts", () => {
    expect(Object.values(SHORTCUTS).map(hotkeyOf)).toEqual(expect.arrayContaining(["Mod+K", "Mod+Shift+T", "Control+Tab", "Control+Shift+Tab", "Mod+,"]));
  });
});
