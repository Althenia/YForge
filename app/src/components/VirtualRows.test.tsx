import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "./testkit";
import { VirtualRows } from "./VirtualRows";

const VIEWPORT = 320;
const ROW = 32;
const items = Array.from({ length: 2000 }, (_, index) => `row ${index}`);

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
  for (const [name, value] of Object.entries({ offsetHeight: VIEWPORT, clientHeight: VIEWPORT, offsetWidth: 800, clientWidth: 800, scrollHeight: items.length * ROW })) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = this.tagName === "UL" ? -(this.parentElement?.scrollTop ?? 0) : 0;
    return { x: 0, y: top, top, left: 0, right: 800, bottom: top + ROW, width: 800, height: ROW, toJSON: () => ({}) };
  };
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    this.scrollTop = typeof options === "object" ? (options.top ?? 0) : 0;
  };
  const offsets = new WeakMap<Element, number>();
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return offsets.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      offsets.set(this, value);
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
    },
  });
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  for (const name of ["offsetHeight", "clientHeight", "offsetWidth", "clientWidth", "scrollHeight", "scrollTop", "scrollTo", "getBoundingClientRect"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

async function mountRows() {
  const host = document.createElement("div");
  document.body.append(host);
  const [keep, setKeep] = createSignal<number | undefined>();
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();
  let scroller: HTMLDivElement | undefined;
  dispose = render(
    () => (
      <div class="scroller" ref={scroller}>
        <VirtualRows items={items} scroller={() => scroller} estimate={ROW} keepIndex={keep()} reveal={reveal()}>
          {(item, row) => (
            <li ref={row.measure} data-index={row.index} style={row.style} tabindex="0">
              {item}
            </li>
          )}
        </VirtualRows>
      </div>
    ),
    host,
  );
  await flush(60);
  const rendered = () => [...host.querySelectorAll("li")].map((element) => element.textContent);
  const scrollTo = async (top: number) => {
    (scroller as HTMLDivElement).scrollTop = top;
    await flush(60);
  };
  return { host, rendered, scrollTo, setKeep, setReveal };
}

describe("virtual rows", () => {
  it("renders only the rows in view inside a list as tall as all of them", async () => {
    const { host, rendered } = await mountRows();

    expect(rendered()[0]).toBe("row 0");
    expect(rendered().length).toBeLessThan(40);
    expect(host.querySelector<HTMLElement>("ul")?.style.height).toBe(`${items.length * ROW}px`);
  });

  it("swaps the rendered window as the scroller moves", async () => {
    const { rendered, scrollTo } = await mountRows();

    await scrollTo(1000 * ROW);

    expect(rendered()).toContain("row 1000");
    expect(rendered()).not.toContain("row 0");
  });

  it("keeps the kept row mounted while it is scrolled far out of view", async () => {
    const { rendered, scrollTo, setKeep } = await mountRows();
    setKeep(3);

    await scrollTo(1500 * ROW);

    expect(rendered()).toContain("row 3");
    expect(rendered()).toContain("row 1500");
  });

  it("keeps the same row elements, and the focus on one of them, when the list's offset inside its scroller shifts by a fraction while the window moves", async () => {
    const { host, scrollTo } = await mountRows();
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const measured = rect.call(this);
      if (this.tagName !== "UL") return measured;
      const shift = ((this.parentElement?.scrollTop ?? 0) / ROW) % 2 === 0 ? 0 : 0.5;
      return { ...measured, top: measured.top + shift, y: measured.y + shift };
    };
    const row = (index: number) => host.querySelector<HTMLElement>(`li[data-index="${index}"]`);
    row(5)?.focus();
    const focused = row(5);

    for (const top of [ROW, 2 * ROW, 3 * ROW, 4 * ROW]) await scrollTo(top);

    expect(focused).not.toBeNull();
    expect(row(5)).toBe(focused);
    expect(document.activeElement).toBe(focused);
  });

  it("scrolls a revealed row into the rendered window", async () => {
    const { rendered, setReveal } = await mountRows();

    setReveal({ nonce: 1, index: 1500 });
    await flush(60);

    expect(rendered()).toContain("row 1500");
    expect(rendered()).not.toContain("row 0");
  });
});
