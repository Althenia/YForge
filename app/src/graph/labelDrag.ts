import type { RefTarget } from "../state/refMenu";

export const DRAG_THRESHOLD = 5;

export type LabelHit = { target: RefTarget; element: Element };

export type DropPoint = { left: number; top: number };

const targets = new WeakMap<Element, () => RefTarget | undefined>();

export function registerLabel(element: Element, target: () => RefTarget | undefined): void {
  targets.set(element, target);
}

export function labelAt(x: number, y: number): LabelHit | undefined {
  const element = document.elementFromPoint(x, y)?.closest("[data-ref-label]");
  const target = element === null || element === undefined ? undefined : targets.get(element)?.();
  return element === null || element === undefined || target === undefined ? undefined : { target, element };
}

export function beginLabelDrag(
  down: PointerEvent,
  source: RefTarget,
  hitAt: (x: number, y: number) => LabelHit | undefined,
  onDrop: (dragged: RefTarget, dropped: RefTarget, at: DropPoint) => void,
): void {
  if (down.button !== 0) return;
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let hovered: Element | undefined;

  const otherLabel = (x: number, y: number) => {
    const hit = hitAt(x, y);
    return hit !== undefined && hit.target.name !== source.name ? hit : undefined;
  };
  const setHover = (next: Element | undefined) => {
    if (next === hovered) return;
    hovered?.classList.remove("drop-target");
    hovered = next;
    hovered?.classList.add("drop-target");
  };
  const swallowClick = (event: Event) => event.stopPropagation();

  const onMove = (event: PointerEvent) => {
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      document.body.classList.add("dragging-ref");
    }
    setHover(otherLabel(event.clientX, event.clientY)?.element);
  };

  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    setHover(undefined);
    document.body.classList.remove("dragging-ref");
    if (dragging) {
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
    }
  };

  function onUp(event: PointerEvent): void {
    dragging ||= Math.hypot(event.clientX - startX, event.clientY - startY) >= DRAG_THRESHOLD;
    const hit = dragging ? otherLabel(event.clientX, event.clientY) : undefined;
    stop();
    if (hit !== undefined) onDrop(source, hit.target, { left: event.clientX, top: event.clientY });
  }

  function onCancel(): void {
    stop();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    stop();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}
