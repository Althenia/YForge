import { beginPointerDrag, DRAG_THRESHOLD } from "../state/pointerDrag";
import type { RefTarget } from "../state/refMenu";

export { DRAG_THRESHOLD };

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
  let marked: Element | undefined;
  beginPointerDrag<LabelHit>(down, {
    hit: (x, y) => {
      const hit = hitAt(x, y);
      return hit !== undefined && hit.target.name !== source.name ? hit : undefined;
    },
    mark: (hit) => {
      if (marked === hit?.element) return;
      marked?.classList.remove("drop-target");
      marked = hit?.element;
      marked?.classList.add("drop-target");
    },
    drop: (hit, at) => onDrop(source, hit.target, at),
  });
}
