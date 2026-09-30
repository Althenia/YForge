import { createSignal, onCleanup } from "solid-js";

export const TOOLBAR_LABELS_MIN_WIDTH = 1280;

export function createToolbarLabels(): () => boolean {
  const [labelled, setLabelled] = createSignal(window.innerWidth >= TOOLBAR_LABELS_MIN_WIDTH);
  const update = () => setLabelled(window.innerWidth >= TOOLBAR_LABELS_MIN_WIDTH);
  window.addEventListener("resize", update);
  onCleanup(() => window.removeEventListener("resize", update));
  return labelled;
}
