import { createDebouncer } from "@tanstack/solid-pacer";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";

const HOVER_DELAY_MS = 450;
const GAP = 6;
const MARGIN = 8;

export const tip = (action: string, shortcut?: string, name: string = action) => ({
  "aria-label": name,
  "data-tip": action,
  "data-shortcut": shortcut,
});

type Shown = { action: string; shortcut: string | undefined; anchor: DOMRect };

const tipOwner = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>("[data-tip]") : null);

export function TooltipHost() {
  const [shown, setShown] = createSignal<Shown | undefined>();
  let element: HTMLDivElement | undefined;
  let owner: HTMLElement | null = null;
  let pointerFocus = false;

  const show = (target: HTMLElement) => {
    owner = target;
    setShown({ action: target.dataset.tip ?? "", shortcut: target.dataset.shortcut, anchor: target.getBoundingClientRect() });
  };

  const hoverDelay = createDebouncer(show, { wait: HOVER_DELAY_MS });

  const hide = () => {
    hoverDelay.cancel();
    owner = null;
    setShown(undefined);
  };

  createEffect(() => {
    const current = shown();
    if (current === undefined || element === undefined) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const center = current.anchor.left + current.anchor.width / 2;
    const below = current.anchor.bottom + GAP;
    const fits = below + height + MARGIN <= window.innerHeight;
    element.style.left = `${Math.max(MARGIN, Math.min(center - width / 2, window.innerWidth - width - MARGIN))}px`;
    element.style.top = `${fits ? below : current.anchor.top - GAP - height}px`;
  });

  onMount(() => {
    const listen = <K extends keyof DocumentEventMap>(type: K, handler: (event: DocumentEventMap[K]) => void) => {
      document.addEventListener(type, handler, true);
      onCleanup(() => document.removeEventListener(type, handler, true));
    };
    listen("mouseover", (event) => {
      const target = tipOwner(event.target);
      if (target === owner) return;
      hide();
      if (target === null) return;
      owner = target;
      hoverDelay.maybeExecute(target);
    });
    listen("mouseout", (event) => {
      if (owner !== null && !(event.relatedTarget instanceof Node && owner.contains(event.relatedTarget))) hide();
    });
    listen("focusin", (event) => {
      const target = tipOwner(event.target);
      hide();
      if (target !== null && !pointerFocus) show(target);
    });
    listen("focusout", hide);
    listen("mousedown", () => {
      pointerFocus = true;
      hide();
    });
    listen("keydown", () => {
      pointerFocus = false;
      hide();
    });
    listen("scroll", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    onCleanup(() => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    });
  });

  return (
    <Show when={shown()}>
      {(current) => (
        <div class="tooltip" role="tooltip" ref={element}>
          <span>{current().action}</span>
          <Show when={current().shortcut}>{(shortcut) => <kbd class="tip-key">{shortcut()}</kbd>}</Show>
        </div>
      )}
    </Show>
  );
}
