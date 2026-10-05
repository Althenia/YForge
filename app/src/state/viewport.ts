import { createSignal, onCleanup } from "solid-js";

export const TOOLBAR_LABELS_MIN_WIDTH = 1600;
export const GRAPH_COLUMNS_MIN_WIDTH = 1024;

export function createMinWidth(min: number): () => boolean {
  const [wide, setWide] = createSignal(window.innerWidth >= min);
  const update = () => setWide(window.innerWidth >= min);
  window.addEventListener("resize", update);
  onCleanup(() => window.removeEventListener("resize", update));
  return wide;
}

export const createToolbarLabels = (): (() => boolean) => createMinWidth(TOOLBAR_LABELS_MIN_WIDTH);
