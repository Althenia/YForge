import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewHold, createViewSwap } from "./viewSwap";

type FakeAnimation = {
  element: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  finish: () => void;
  cancel: () => void;
  finished: Promise<unknown>;
};

let animations: FakeAnimation[] = [];
let reduced = false;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  animations = [];
  reduced = false;
  document.documentElement.style.setProperty("--motion-quick", "120ms");
  document.documentElement.style.setProperty("--ease-standard", "cubic-bezier(0.2, 0, 0, 1)");
  window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reduced })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let finish = () => undefined as void;
    let cancel = () => undefined as void;
    const finished = new Promise((resolve, reject) => {
      finish = () => resolve(undefined);
      cancel = () => reject(new DOMException("The animation was cancelled", "AbortError"));
    });
    finished.catch(() => undefined);
    const animation = { element: this, keyframes, options, finish: () => finish(), cancel: () => cancel(), finished };
    animations.push(animation);
    return animation as unknown as Animation;
  } as unknown as typeof HTMLElement.prototype.animate;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  document.documentElement.removeAttribute("style");
  document.body.replaceChildren();
});

type Item = { key: string; label: string } | undefined;

const rectAt = (top: number, left: number) => ({ top, left, bottom: top + 400, right: left + 800, width: 800, height: 400, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function only<T>(items: ArrayLike<T>): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

function mount(initial: Item) {
  const [item, setItem] = createSignal<Item>(initial);
  const host = document.createElement("div");
  document.body.append(host);
  let region: HTMLElement | undefined;
  const dispose = render(() => {
    createViewSwap(() => region, () => item()?.key);
    return (
      <section class="region" id="region" ref={region}>
        <p id="label">{item()?.label ?? ""}</p>
        <input type="radio" name="mode" checked />
      </section>
    );
  }, host);
  const held = () => host.querySelectorAll<HTMLElement>("[data-swap-held]");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { host, setItem, held, settle, dispose, region: () => region as HTMLElement };
}

describe("view swap (S72)", () => {
  it("holds the previous content above its replacement and fades it out over quick", () => {
    const view = mount({ key: "a", label: "Alpha" });
    view.setItem({ key: "b", label: "Beta" });

    expect(view.region().textContent).toContain("Beta");
    const held = only(view.held());
    expect(held.textContent).toContain("Alpha");
    expect(held.previousElementSibling).toBe(view.region());
    expect(held.getAttribute("aria-hidden")).toBe("true");
    expect(held.inert).toBe(true);
    expect(held.querySelector("[id]")).toBeNull();
    expect(held.id).toBe("");
    expect(held.querySelector("input")?.hasAttribute("name")).toBe(false);
    const animation = only(animations);
    expect(animation.element).toBe(held);
    expect(animation.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(animation.options).toMatchObject({ duration: 120, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    view.dispose();
  });

  it("removes the held content once quick has passed, even when its fade never advances, as in a hidden document", () => {
    vi.useFakeTimers();
    try {
      const view = mount({ key: "a", label: "Alpha" });
      view.setItem({ key: "b", label: "Beta" });
      vi.advanceTimersByTime(119);
      expect(view.held()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(view.held()).toHaveLength(0);
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("places the held content exactly over its region when the region's own classes move the copy's containing block, as a grid row does", () => {
    const view = mount({ key: "a", label: "Alpha" });
    const region = view.region();
    Object.defineProperty(region, "offsetTop", { configurable: true, value: 30 });
    region.getBoundingClientRect = () => rectAt(157, 265);
    const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rectAt(157 + Number.parseFloat(this.style.top || "0"), 265 + Number.parseFloat(this.style.left || "0"));
    });
    try {
      view.setItem({ key: "b", label: "Beta" });
      const held = only(view.held());
      expect(held.getBoundingClientRect().top).toBe(157);
      expect(held.getBoundingClientRect().left).toBe(265);
    } finally {
      measured.mockRestore();
      view.dispose();
    }
  });

  it("updates in place, without a fade, while the content keeps its identity", () => {
    const view = mount({ key: "a", label: "Alpha" });
    view.setItem({ key: "a", label: "Alpha, refreshed" });
    expect(view.region().textContent).toContain("Alpha, refreshed");
    expect(view.held()).toHaveLength(0);
    expect(animations).toHaveLength(0);
    view.dispose();
  });

  it("shows first content at once, with nothing to hold", () => {
    const view = mount(undefined);
    view.setItem({ key: "a", label: "Alpha" });
    expect(view.held()).toHaveLength(0);
    view.dispose();
  });

  it("swaps instantly under reduced motion", () => {
    reduced = true;
    const view = mount({ key: "a", label: "Alpha" });
    view.setItem({ key: "b", label: "Beta" });
    expect(view.region().textContent).toContain("Beta");
    expect(view.held()).toHaveLength(0);
    expect(animations).toHaveLength(0);
    view.dispose();
  });

  it("keeps only the latest held content when swaps overlap", async () => {
    const view = mount({ key: "a", label: "Alpha" });
    view.setItem({ key: "b", label: "Beta" });
    view.setItem({ key: "c", label: "Gamma" });
    await view.settle();
    expect(only(view.held()).textContent).toContain("Beta");
    view.dispose();
  });

  it("removes held content when its owner is disposed", () => {
    const view = mount({ key: "a", label: "Alpha" });
    view.setItem({ key: "b", label: "Beta" });
    view.dispose();
    expect(view.held()).toHaveLength(0);
  });
});

describe("view hold (S72 tab switch)", () => {
  const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  function workspace(label: string) {
    const app = document.createElement("div");
    app.className = "app";
    app.innerHTML = `<div class="tabbar"><button id="tab" name="tab">${label}</button></div><main><p>${label} workspace</p></main>`;
    app.getBoundingClientRect = () => box(0, 600);
    (app.querySelector(".tabbar") as HTMLElement).getBoundingClientRect = () => box(0, 36);
    document.body.append(app);
    return app;
  }

  function mountHold() {
    let hold!: ReturnType<typeof createViewHold>;
    const dispose = createRoot((stop) => {
      hold = createViewHold();
      return stop;
    });
    const held = () => document.querySelectorAll<HTMLElement>("[data-swap-held]");
    const capture = (app: HTMLElement) => {
      hold.capture(app, app.querySelector(".tabbar"));
      app.remove();
    };
    return { hold, held, capture, dispose };
  }

  it("holds an inert copy of the previous view over the page, clipped below the bar that stays live, until released", () => {
    const view = mountHold();
    view.capture(workspace("Alpha"));

    const held = only(view.held());
    expect(held.textContent).toContain("Alpha workspace");
    expect(held.parentElement).toBe(document.body);
    expect(held.style.position).toBe("fixed");
    expect(held.style.height).toBe("600px");
    expect(held.style.clipPath).toBe("inset(36px 0 0 0)");
    expect(held.getAttribute("aria-hidden")).toBe("true");
    expect(held.inert).toBe(true);
    expect(held.querySelector("[id]")).toBeNull();
    expect(held.querySelector("[name]")).toBeNull();
    expect(animations).toHaveLength(0);
    view.dispose();
  });

  it("keeps showing the first held view while later switches are still loading", () => {
    const view = mountHold();
    view.capture(workspace("Alpha"));
    view.capture(workspace("Beta loading"));
    expect(only(view.held()).textContent).toContain("Alpha workspace");
    view.dispose();
  });

  it("fades the held view out over quick when released, then removes it once quick has passed, even when its fade never advances", () => {
    vi.useFakeTimers();
    try {
      const view = mountHold();
      view.capture(workspace("Alpha"));
      view.hold.release();

      const animation = only(animations);
      expect(animation.element).toBe(only(view.held()));
      expect(animation.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
      expect(animation.options).toMatchObject({ duration: 120, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      vi.advanceTimersByTime(119);
      expect(view.held()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(view.held()).toHaveLength(0);
      view.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the held view at once on release under reduced motion", () => {
    reduced = true;
    const view = mountHold();
    view.capture(workspace("Alpha"));
    expect(view.held()).toHaveLength(1);
    view.hold.release();
    expect(view.held()).toHaveLength(0);
    expect(animations).toHaveLength(0);
    view.dispose();
  });

  it("replaces a held view that is already fading with the view on screen", () => {
    const view = mountHold();
    view.capture(workspace("Alpha"));
    view.hold.release();
    view.capture(workspace("Beta"));
    expect(only(view.held()).textContent).toContain("Beta workspace");
    view.dispose();
  });

  it("removes the held view when its owner is disposed", () => {
    const view = mountHold();
    view.capture(workspace("Alpha"));
    view.dispose();
    expect(view.held()).toHaveLength(0);
  });
});
