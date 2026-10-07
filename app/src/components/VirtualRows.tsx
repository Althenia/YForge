import { createVirtualizer, defaultRangeExtractor, observeElementOffset } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, For, on, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

export type VirtualRow = {
  index: number;
  style: JSX.CSSProperties;
  measure: (element: Element | null) => void;
};

const OVERSCAN = 8;

export const VIRTUAL_LIST_FROM = 100;

const tokenPx = (name: string): number => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

export const fileRowHeight = (): number => tokenPx("--controls-row-file");

export const listRowHeight = (): number => tokenPx("--controls-row-list");

export const spacingPx = (token: string): number => tokenPx(`--spacing-${token}`);

export function VirtualRows<T>(props: {
  items: readonly T[];
  scroller: () => HTMLElement | undefined;
  estimate: number;
  gap?: number;
  attrs?: Omit<JSX.HTMLAttributes<HTMLElement>, "ref" | "style" | "class" | "children">;
  keepIndex?: number | undefined;
  reveal?: { nonce: number; index: number } | undefined;
  measured?: boolean;
  as?: "ul" | "ol" | "div";
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
    get gap() {
      return props.gap ?? 0;
    },
    overscan: OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
    observeElementOffset: (instance, notify) => {
      const stop = observeElementOffset(instance, notify);
      const element = instance.scrollElement;
      if (element === null) return stop;
      let active = true;
      const reconcile = () => queueMicrotask(() => {
        if (!active) return;
        updateMargin();
        if (instance.scrollOffset !== element.scrollTop) notify(element.scrollTop, instance.isScrolling);
      });
      element.ownerDocument.addEventListener("focusin", reconcile);
      return () => {
        active = false;
        element.ownerDocument.removeEventListener("focusin", reconcile);
        stop?.();
      };
    },
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

  const positions = createMemo(() => new Map(virtualizer.getVirtualItems().flatMap((item) => (item === undefined ? [] : [[item.index, item] as const]))));
  const indexes = createMemo(() => [...positions().keys()]);

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
      {...props.attrs}
      style={{ position: "relative", height: `${virtualizer.getTotalSize()}px` }}
    >
      <For each={indexes()}>
        {(index) => {
          const value = () => props.items[index];
          return (
            <>
              {value() === undefined
                ? null
                : props.children(value() as T, {
                    index,
                    get style(): JSX.CSSProperties {
                      return { position: "absolute", top: `${(positions().get(index)?.start ?? 0) - margin()}px`, left: "0", right: "0" };
                    },
                    measure: (element) => {
                      if (props.measured === true) element?.setAttribute("data-index", String(index));
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
