import { describe, expect, it } from "vitest";
import { tabDragHit } from "./tabDrag";

const box = (element: HTMLElement) => {
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 24, right: 100, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return element;
};

describe("tab drag hit", () => {
  it("hits a chip, either edge of a tab, and the empty end of the strip", () => {
    const strip = document.createElement("div");
    strip.className = "tab-scroll";
    const chip = box(document.createElement("button"));
    chip.dataset.drop = "chip";
    chip.dataset.group = "1";
    const tab = box(document.createElement("span"));
    tab.dataset.tabIndex = "2";
    const label = document.createElement("span");
    tab.append(label);
    strip.append(chip, tab);
    document.body.append(strip);

    expect(tabDragHit(chip, 80)).toEqual({ kind: "group", index: 1 });
    expect(tabDragHit(label, 10)).toEqual({ kind: "before", index: 2 });
    expect(tabDragHit(label, 80)).toEqual({ kind: "before", index: 3 });
    expect(tabDragHit(strip, 0)).toEqual({ kind: "end" });
    expect(tabDragHit(document.body, 0)).toBeUndefined();

    strip.remove();
  });
});
