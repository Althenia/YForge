import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { Anchor } from "../state/repoActions";

const MARGIN = 8;

export function Popover(props: { anchor: Anchor; label: string; onClose: () => void; children: JSX.Element }) {
  const [position, setPosition] = createSignal(props.anchor);
  const opener = document.activeElement;
  let element: HTMLDivElement | undefined;

  onMount(() => {
    if (element === undefined) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(props.anchor.left, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(props.anchor.top, window.innerHeight - rect.height - MARGIN)),
    });
    element.querySelector<HTMLElement>("input")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !element?.contains(event.target)) props.onClose();
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss, true);
      if (opener instanceof HTMLElement && document.activeElement === document.body) opener.focus();
    });
  });

  return (
    <div
      class="popover"
      role="dialog"
      aria-label={props.label}
      ref={element}
      style={{ left: `${position().left}px`, top: `${position().top}px` }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      {props.children}
    </div>
  );
}
