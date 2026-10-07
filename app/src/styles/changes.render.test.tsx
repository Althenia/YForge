import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "solid-js/web";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FileRow } from "../components/FileRow";

const changes = readFileSync(resolve(import.meta.dirname, "changes.css"), "utf8");
let stylesheet: HTMLStyleElement;
let dispose: (() => void) | undefined;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css", "changes.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const mount = (view: () => Element) => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(view as never, host);
  return host;
};

const hiddenByOpacity = (element: Element | null, stop: Element | null) => {
  for (let node = element; node !== null && node !== stop; node = node.parentElement) if (getComputedStyle(node).opacity === "0") return true;
  return false;
};

describe("Changes panel styles (S49, S50)", () => {
  it("uses only token colors", () => {
    expect(changes.trim()).not.toBe("");
    expect(changes.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\(/g)).toBeNull();
  });

  it("shows the row Stage icon at rest while the other row actions wait for hover or focus", () => {
    const virtual = { index: 0, style: {}, measure: () => undefined };
    const host = mount(() => (
      <ul class="flist">
        <FileRow rowId="r" path="src/a.ts" originalPath={null} status="modified" selected={false} tabStop onFocusRow={() => undefined} virtual={virtual}>
          <span class="acts">
            <button type="button" class="icon-btn dense" aria-label="Open diff" />
          </span>
          <button type="button" class="icon-btn dense row-move" aria-label="Stage" />
        </FileRow>
      </ul>
    ) as Element);

    const row = host.querySelector("li.frow");
    expect(hiddenByOpacity(host.querySelector('[aria-label="Stage"]'), row)).toBe(false);
    expect(hiddenByOpacity(host.querySelector('[aria-label="Open diff"]'), row)).toBe(true);
  });

  it("rotates a collapsed folder's chevron by transform", () => {
    const host = mount(() => (
      <div>
        <span class="tree-chev" />
        <span class="tree-chev closed" />
      </div>
    ) as Element);

    const [open, closed] = [...host.querySelectorAll(".tree-chev")];
    expect(getComputedStyle(closed as Element).transform).toBe("rotate(-90deg)");
    expect(getComputedStyle(open as Element).transform).not.toBe("rotate(-90deg)");
  });

  it("keeps the summary on one line", () => {
    const host = mount(() => (
      <label class="input summary-field">
        <input type="text" aria-label="Summary" />
      </label>
    ) as Element);

    const style = getComputedStyle(host.querySelector("input") as Element);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("allows composer fields to shrink inside a narrow inspector while busy controls stay available", () => {
    const host = mount(() => (
      <div class="composer">
        <div class="composer-panel">
          <label class="input summary-field"><input aria-label="Summary" /><span class="field-tools"><span class="count">72</span><span class="field-busy-text">Generating…</span><button class="icon-btn" aria-label="Cancel generating" /></span></label>
          <span class="input area"><textarea aria-label="Description" /></span>
        </div>
      </div>
    ) as Element);
    expect(getComputedStyle(host.querySelector(".composer") as Element).gridTemplateColumns).toBe("minmax(0, 1fr)");
    for (const field of host.querySelectorAll(".input")) expect(getComputedStyle(field).minWidth).toBe("0px");
    expect(getComputedStyle(host.querySelector(".field-tools") as Element).flexShrink).toBe("0");
  });
});
