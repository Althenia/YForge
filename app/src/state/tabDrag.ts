import type { TabDragHit } from "./tabs";

/** The strip target under the pointer: a group chip, a tab edge, or the empty end of the strip. */
export function tabDragHit(node: Element | null, x: number): TabDragHit | undefined {
  if (node === null) return undefined;
  const chip = node.closest<HTMLElement>("[data-drop='chip']");
  if (chip !== null) {
    const index = Number(chip.dataset.group);
    return Number.isInteger(index) ? { kind: "group", index } : undefined;
  }
  const tab = node.closest<HTMLElement>("[data-tab-index]");
  if (tab !== null) {
    const index = Number(tab.dataset.tabIndex);
    if (!Number.isInteger(index)) return undefined;
    const rect = tab.getBoundingClientRect();
    return { kind: "before", index: x > rect.left + rect.width / 2 ? index + 1 : index };
  }
  return node.closest(".tab-scroll") === null ? undefined : { kind: "end" };
}
