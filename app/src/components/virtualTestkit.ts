import { vi } from "vitest";

export type ScrollLayout = { viewport: number; row: number; total: number };

const spacing = { "--spacing-0-5": "2px", "--spacing-1": "4px" };

const layoutNames = ["offsetHeight", "clientHeight", "offsetWidth", "clientWidth", "scrollHeight", "scrollTop", "scrollTo", "getBoundingClientRect"] as const;

/// Gives every element a fixed viewport and a scrollTop that fires `scroll`, so a virtualized list renders its real window in jsdom.
export function stubScrollLayout({ viewport, row, total }: ScrollLayout): () => void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
  const saved = new Map(layoutNames.map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));
  const heightOf = (element: Element): number => (element.hasAttribute("data-index") ? row : viewport);
  for (const [name, value] of Object.entries({ offsetWidth: 800, clientWidth: 800, scrollHeight: total * row })) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
  for (const name of ["offsetHeight", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return heightOf(this);
      },
    });
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const virtualList = this.style.position === "relative" && this.style.height !== "";
    let scrolled = 0;
    for (let ancestor = this.parentElement; virtualList && ancestor !== null; ancestor = ancestor.parentElement) scrolled += ancestor.scrollTop;
    const top = -scrolled;
    const height = heightOf(this);
    return { x: 0, y: top, top, left: 0, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) };
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
  document.documentElement.style.setProperty("--controls-row-file", `${row}px`);
  document.documentElement.style.setProperty("--controls-row-list", `${row}px`);
  for (const [name, value] of Object.entries(spacing)) document.documentElement.style.setProperty(name, value);
  return () => {
    vi.unstubAllGlobals();
    for (const name of layoutNames) {
      const original = saved.get(name);
      if (original === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(HTMLElement.prototype, name, original);
    }
    for (const name of ["--controls-row-file", "--controls-row-list", ...Object.keys(spacing)]) document.documentElement.style.removeProperty(name);
  };
}
