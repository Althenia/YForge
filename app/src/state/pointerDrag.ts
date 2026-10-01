export const DRAG_THRESHOLD = 5;

export type DragHandlers<T> = {
  hit: (x: number, y: number) => T | undefined;
  mark: (target: T | undefined) => void;
  drop: (target: T, at: { left: number; top: number }) => void;
  /// The label the ghost follows the pointer with; without one, no ghost is drawn.
  ghost?: (x: number, y: number) => string | undefined;
  /// The element that dims while its own drag runs.
  source?: Element;
};

export function beginPointerDrag<T>(down: PointerEvent, handlers: DragHandlers<T>): void {
  if (down.button !== 0) return;
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let hovered: T | undefined;
  let ghost: HTMLElement | undefined;

  const setHover = (next: T | undefined) => {
    if (next === hovered) return;
    hovered = next;
    handlers.mark(next);
  };
  const swallowClick = (event: Event) => event.stopPropagation();

  const moveGhost = (event: PointerEvent) => {
    if (ghost === undefined) return;
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY + 12}px`;
  };

  const showGhost = (event: PointerEvent) => {
    handlers.source?.classList.add("drag-source");
    const text = handlers.ghost?.(event.clientX, event.clientY);
    if (text === undefined || text === "") return;
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = text;
    document.body.append(ghost);
    moveGhost(event);
  };

  const hideGhost = () => {
    handlers.source?.classList.remove("drag-source");
    ghost?.remove();
    ghost = undefined;
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      document.body.classList.add("dragging");
      showGhost(event);
    }
    moveGhost(event);
    setHover(handlers.hit(event.clientX, event.clientY));
  };

  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", stop);
    window.removeEventListener("keydown", onKey, true);
    setHover(undefined);
    hideGhost();
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
