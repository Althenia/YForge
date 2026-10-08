import { createComputed, on, onCleanup, type Accessor } from "solid-js";

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const milliseconds = (value: string) => (value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000);

function copyOf(region: HTMLElement): HTMLElement {
  const held = region.cloneNode(true) as HTMLElement;
  held.removeAttribute("id");
  for (const node of held.querySelectorAll("[id]")) node.removeAttribute("id");
  for (const node of held.querySelectorAll("[name]")) node.removeAttribute("name");
  held.setAttribute("aria-hidden", "true");
  held.inert = true;
  held.dataset.swapHeld = "";
  held.classList.add("swap-held");
  return held;
}

function keepScroll(region: HTMLElement, held: HTMLElement): void {
  const sources = [region, ...region.querySelectorAll("*")];
  const copies = [held, ...held.querySelectorAll("*")];
  sources.forEach((source, index) => {
    const copy = copies[index];
    if (copy === undefined || (source.scrollTop === 0 && source.scrollLeft === 0)) return;
    copy.scrollTop = source.scrollTop;
    copy.scrollLeft = source.scrollLeft;
  });
}

function fadeOut(held: HTMLElement, done: () => void): () => void {
  if (typeof held.animate !== "function" || reducedMotion()) {
    done();
    return () => undefined;
  }
  const duration = milliseconds(token("--motion-quick"));
  const animation = held.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: token("--ease-standard"), fill: "forwards" });
  const timer = setTimeout(done, duration);
  return () => {
    clearTimeout(timer);
    animation.cancel();
  };
}

type Held = { element: HTMLElement; released: boolean; stop: () => void };

const holding = (element: HTMLElement): Held => ({ element, released: false, stop: () => undefined });

function release(current: Held, clear: (current: Held) => void): void {
  if (current.released) return;
  current.released = true;
  current.stop = fadeOut(current.element, () => {
    current.element.remove();
    clear(current);
  });
}

function drop(current: Held | undefined): void {
  current?.stop();
  current?.element.remove();
}

export function createViewSwap(region: () => HTMLElement | undefined, key: Accessor<string | undefined>): void {
  let held: Held | undefined;
  const clear = (current: Held) => {
    if (held === current) held = undefined;
  };
  createComputed(
    on(key, (next, previous) => {
      if (next === undefined || previous === undefined || next === previous) return;
      const element = region();
      if (element === undefined || !element.isConnected || typeof element.animate !== "function" || reducedMotion()) return;
      drop(held);
      const copy = copyOf(element);
      Object.assign(copy.style, { left: "0px", top: "0px", width: `${element.offsetWidth}px`, height: `${element.offsetHeight}px` });
      element.after(copy);
      const target = element.getBoundingClientRect();
      const placed = copy.getBoundingClientRect();
      Object.assign(copy.style, { left: `${target.left - placed.left}px`, top: `${target.top - placed.top}px` });
      keepScroll(element, copy);
      held = holding(copy);
      release(held, clear);
    }),
  );
  onCleanup(() => {
    drop(held);
    held = undefined;
  });
}

export function createViewHold() {
  let held: Held | undefined;
  const clear = (current: Held) => {
    if (held === current) held = undefined;
  };
  onCleanup(() => {
    drop(held);
    held = undefined;
  });
  return {
    capture(region: Element | null | undefined, keep: Element | null | undefined): void {
      if ((held !== undefined && !held.released) || !(region instanceof HTMLElement) || !region.isConnected) return;
      drop(held);
      const bounds = region.getBoundingClientRect();
      const clip = keep instanceof HTMLElement ? Math.max(0, keep.getBoundingClientRect().bottom - bounds.top) : 0;
      const copy = copyOf(region);
      Object.assign(copy.style, {
        position: "fixed",
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        clipPath: `inset(${clip}px 0 0 0)`,
      });
      document.body.append(copy);
      keepScroll(region, copy);
      held = holding(copy);
    },
    release(): void {
      if (held !== undefined) release(held, clear);
    },
  };
}
