import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingLine } from "./PendingLine";
import { mountWithApp } from "./testkit";

const css = readFileSync(resolve(import.meta.dirname, "../styles/app.css"), "utf8");
const rule = (selector: string, source = css) => {
  const start = source.indexOf(`${selector} {`);
  return start < 0 ? "" : source.slice(start, source.indexOf("}", start));
};
const reducedBlock = () => {
  const marker = "@media (prefers-reduced-motion: reduce) {\n  .pending-line";
  const start = css.indexOf(marker);
  return start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mount(initial: boolean) {
  const [pending, setPending] = createSignal(initial);
  const view = mountWithApp(() => <PendingLine pending={pending()} label="Loading commit details" />);
  return { ...view, setPending, line: () => view.host.querySelector<HTMLElement>("[data-indicator]") };
}

describe("PendingLine", () => {
  it("stays out of the page for the first 150ms of pending work (S72)", () => {
    const view = mount(true);
    vi.advanceTimersByTime(149);
    expect(view.line()).toBeNull();
    view.dispose();
  });

  it("then shows a status naming the work, with the reduced-motion text ready", () => {
    const view = mount(true);
    vi.advanceTimersByTime(150);
    const line = view.line();
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.querySelector(".sr-only")?.textContent).toBe("Loading commit details");
    expect(line?.querySelector(".pending-line-static")?.textContent).toBe("In progress…");
    expect(line?.querySelector(".pending-line-bar")?.getAttribute("aria-hidden")).toBe("true");
    view.dispose();
  });

  it("keeps the line for its 400ms minimum after the work ends", () => {
    const view = mount(true);
    vi.advanceTimersByTime(150);
    view.setPending(false);
    vi.advanceTimersByTime(399);
    expect(view.line()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(view.line()).toBeNull();
    view.dispose();
  });

  it("draws a 2px animated line that becomes static text under reduced motion", () => {
    expect(rule(".pending-line")).toContain("height: 2px;");
    expect(rule(".pending-line-bar")).toMatch(/animation: progress-slide/);
    expect(rule(".pending-line-static")).toContain("display: none;");
    const reduced = reducedBlock();
    expect(rule(".pending-line-bar", reduced)).toContain("display: none;");
    expect(rule(".pending-line-static", reduced)).toContain("display: block;");
  });
});
