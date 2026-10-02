import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

const rules = () =>
  [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules];
    } catch {
      return [];
    }
  });

const rule = (selector: string) =>
  rules().find((entry) => "selectorText" in entry && String(entry.selectorText).replace(/\s+/g, " ").trim() === selector) as CSSStyleRule | undefined;

describe("diff row fill", () => {
  it("paints a short added or removed line across the pane, and leaves an empty split half as the pane background", () => {
    const pane = document.createElement("div");
    pane.className = "hunk";
    const track = document.createElement("div");
    track.className = "dtrack";
    const added = document.createElement("div");
    added.className = "dline add";
    added.textContent = "x";
    const removed = document.createElement("div");
    removed.className = "dline del sel";
    removed.textContent = "y";
    const split = document.createElement("div");
    split.className = "dsplit";
    const blank = document.createElement("div");
    blank.className = "half blank";
    split.append(blank);
    track.append(added, removed, split);
    pane.append(track);
    document.body.append(pane);

    expect(getComputedStyle(track).minWidth).toBe("100%");
    expect(getComputedStyle(added).minWidth).toBe("100%");
    expect(getComputedStyle(removed).minWidth).toBe("100%");
    expect(getComputedStyle(split).minWidth).toBe("100%");
    expect(getComputedStyle(removed).boxShadow).toContain("2px");
    expect(rule(".dline.add, .half.add")?.style.getPropertyValue("background")).toBe("var(--colors-accent-tint)");
    expect(rule(".half.blank")?.style.getPropertyValue("background")).toBe("transparent");
    expect(rule(".dline.add .word, .half.add .word")?.style.getPropertyValue("background")).toBe("var(--colors-diff-added-word)");
  });
});
