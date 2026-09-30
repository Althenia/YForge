import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useApp } from "../state/app";
import type { Toast } from "../state/activityModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

const LIFETIME_MS = 6000;

function ToastView(props: { toast: Toast; windowActive: () => boolean; onUndo: (id: number) => void }) {
  const app = useApp();
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  createEffect(() => {
    if (hovered() || focused() || !props.windowActive()) return;
    const timer = setTimeout(() => app.dismissToast(props.toast.id), LIFETIME_MS);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div
      class="toast stacked"
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={() => setFocused(false)}
    >
      <span>{props.toast.message}</span>
      <Show when={props.toast.undoable}>
        <button type="button" class="btn sm" title={props.toast.entry.undo.kind === "available" ? props.toast.entry.undo.scope : undefined} onClick={() => props.onUndo(props.toast.id)}>
          Undo
        </button>
      </Show>
      <button
        type="button"
        class="btn sm"
        onClick={() => {
          app.dismissToast(props.toast.id);
          app.openDrawer();
        }}
      >
        Details
      </button>
      <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={() => app.dismissToast(props.toast.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function Toasts(props: { onUndo: (id: number) => void }) {
  const app = useApp();
  const [windowActive, setWindowActive] = createSignal(document.hasFocus() && !document.hidden);
  onMount(() => {
    const sync = () => setWindowActive(document.hasFocus() && !document.hidden);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    onCleanup(() => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    });
  });
  return (
    <div class="toasts" aria-label="Notifications">
      <For each={app.toasts()}>{(toast) => <ToastView toast={toast} windowActive={windowActive} onUndo={props.onUndo} />}</For>
    </div>
  );
}
