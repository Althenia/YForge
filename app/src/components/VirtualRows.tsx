import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual";
import { createEffect, createSignal, For, on, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export type VirtualRow = {
  index: number;
  style: JSX.CSSProperties;
  measure: (element: Element | null) => void;
};

const OVERSCAN = 8;

export const fileRowHeight = (): number => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--controls-row-file"));

export function VirtualRows<T>(props: {
  items: readonly T[];
  scroller: () => HTMLElement | undefined;
  estimate: number;
  keepIndex?: number | undefined;
  reveal?: { nonce: number; index: number } | undefined;
  measured?: boolean;
  as?: "ul" | "div";
  class?: string;
  children: (item: T, row: VirtualRow) => JSX.Element;
}) {
  let list: HTMLElement | undefined;
  const [margin, setMargin] = createSignal(0);
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));

  const updateMargin = () => {
    const parent = props.scroller();
    if (list === undefined || parent === undefined) return;
    setMargin(list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop);
  };

  const virtualizer = createVirtualizer({
    get count() {
      return props.items.length;
    },
    getScrollElement: () => (mounted() ? (props.scroller() ?? null) : null),
    estimateSize: () => props.estimate,
    overscan: OVERSCAN,
    get scrollMargin() {
      return margin();
    },
    rangeExtractor: (range) => {
      const shown = defaultRangeExtractor(range);
      const keep = props.keepIndex;
      return keep === undefined || keep < 0 || keep >= props.items.length || shown.includes(keep) ? shown : [...shown, keep].sort((left, right) => left - right);
    },
    onChange: updateMargin,
  });

  createEffect(
    on(
      () => props.reveal,
      (target) => {
        if (target !== undefined) virtualizer.scrollToIndex(target.index, { align: "auto" });
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    props.items.length;
    queueMicrotask(updateMargin);
  });

  return (
    <Dynamic
      component={props.as ?? "ul"}
      ref={(element: HTMLElement) => (list = element)}
      class={props.class}
      style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={virtualizer.getVirtualItems().filter((item) => item !== undefined)}>
        {(item) => {
          const value = () => props.items[item.index];
          return (
            <>
              {value() === undefined
                ? null
                : props.children(value() as T, {
                    index: item.index,
                    style: { position: "absolute", top: `${item.start - margin()}px`, left: "0", right: "0" },
                    measure: (element) => {
                      if (props.measured === true) element?.setAttribute("data-index", String(item.index));
                      virtualizer.measureElement(element);
                    },
                  })}
            </>
          );
        }}
      </For>
    </Dynamic>
  );
}
