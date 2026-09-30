export const DRAG_THRESHOLD = 5;

export type DragHandlers<T> = {
  hit: (x: number, y: number) => T | undefined;
  mark: (target: T | undefined) => void;
  drop: (target: T, at: { left: number; top: number }) => void;
};

export function beginPointerDrag<T>(down: PointerEvent, handlers: DragHandlers<T>): void {
  if (down.button !== 0) return;
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let hovered: T | undefined;

  const setHover = (next: T | undefined) => {
    if (next === hovered) return;
    hovered = next;
    handlers.mark(next);
  };
  const swallowClick = (event: Event) => event.stopPropagation();

  const onMove = (event: PointerEvent) => {
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      document.body.classList.add("dragging");
    }
    setHover(handlers.hit(event.clientX, event.clientY));
  };

  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", onKey, true);
    setHover(undefined);
    document.body.classList.remove("dragging");
    if (dragging) {
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
    }
  };

  function onUp(event: PointerEvent): void {
    dragging ||= Math.hypot(event.clientX - startX, event.clientY - startY) >= DRAG_THRESHOLD;
    const target = dragging ? handlers.hit(event.clientX, event.clientY) : undefined;
    stop();
    if (target !== undefined) handlers.drop(target, { left: event.clientX, top: event.clientY });
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    stop();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("keydown", onKey, true);
}
