import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let stylesheet: HTMLStyleElement;
const source = readFileSync(resolve(import.meta.dirname, "app.css"), "utf8");

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(() => {
  document.body.innerHTML = "";
});

const looks = (classes: string, attribute: "disabled" | "aria-disabled" | undefined) => {
  const button = document.createElement("button");
  button.className = classes;
  if (attribute === "disabled") button.disabled = true;
  if (attribute === "aria-disabled") button.setAttribute("aria-disabled", "true");
  document.body.append(button);
  const style = getComputedStyle(button);
  return { color: style.color, background: style.backgroundColor, shadow: style.boxShadow };
};

describe("a button that is disabled through aria-disabled", () => {
  it.each(["btn", "btn primary", "btn danger"])("looks the same as the native disabled %s and differs from the enabled one", (classes) => {
    const enabled = looks(classes, undefined);
    const native = looks(classes, "disabled");
    const aria = looks(classes, "aria-disabled");

    expect(aria).toEqual(native);
    expect(aria).not.toEqual(enabled);
  });

  it("takes neither the hover fill nor the primary hover brightening", () => {
    const hoverRules = [...source.matchAll(/([^{}]*\.btn[^{}]*:hover[^{}]*)\{/g)].map((match) => (match[1] ?? "").trim());

    expect(hoverRules.length).toBeGreaterThan(0);
    for (const selector of hoverRules) expect(selector, selector).toContain(':not([aria-disabled="true"])');
  });
});
