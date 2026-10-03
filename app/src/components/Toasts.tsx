import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useApp } from "../state/app";
import type { Toast } from "../state/activityModel";
import { Icon } from "./Icon";
import { Notice } from "./Notice";
import { tip } from "./Tooltip";

const LIFETIME_MS = 5000;
const VISIBLE = 3;

function ToastView(props: { toast: Toast; windowActive: () => boolean; onUndo: (id: number) => void }) {
  const app = useApp();
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const held = () => hovered() || focused() || !props.windowActive();
  createEffect(() => {
    if (held()) return;
    const timer = setTimeout(() => app.dismissToast(props.toast.id), LIFETIME_MS);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div
      class="toast stacked"
      classList={{ held: held() }}
      role="status"
      style={{ "--toast-life": `${LIFETIME_MS}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        app.dismissToast(props.toast.id);
      }}
    >
      <span class="toast-status">
        <Icon name="check" size={14} />
        <span class="sr-only">Done:</span>
      </span>
      <span class="toast-title">{props.toast.message}</span>
      <Show
        when={props.toast.undoable}
        fallback={
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
        }
      >
        <button type="button" class="btn sm" title={props.toast.entry.undo.kind === "available" ? props.toast.entry.undo.scope : undefined} onClick={() => props.onUndo(props.toast.id)}>
          Undo
        </button>
      </Show>
      <span class="toast-close">
        <svg class="toast-ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="toast-ring-track" cx="12" cy="12" r="10" />
          <circle class="toast-ring-run" cx="12" cy="12" r="10" pathLength="100" />
        </svg>
        <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={() => app.dismissToast(props.toast.id)}>
          <Icon name="close" size={14} />
        </button>
      </span>
    </div>
  );
}

/// Top-right toasts (S48): newest first, three at a time, the rest queued behind a count.
export function Toasts(props: { onUndo: (id: number) => void }) {
  const app = useApp();
  const [windowActive, setWindowActive] = createSignal(document.hasFocus() && !document.hidden);
  const newestFirst = () => [...app.toasts()].reverse();
  onMount(() => {
    const sync = () => setWindowActive(document.hasFocus() && !document.hidden);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const newest = newestFirst()[0];
      if (newest === undefined) return;
      event.preventDefault();
      app.dismissToast(newest.id);
    };
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    document.addEventListener("keydown", escape);
    onCleanup(() => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("keydown", escape);
    });
  });
  return (
    <div class="toasts" aria-label="Notifications">
      <Notice message={app.notice()} onDismiss={() => app.setNotice(undefined)} />
      <For each={newestFirst().slice(0, VISIBLE)}>{(toast) => <ToastView toast={toast} windowActive={windowActive} onUndo={props.onUndo} />}</For>
      <Show when={newestFirst().length > VISIBLE}>
        <span class="toast-more">{newestFirst().length - VISIBLE} more</span>
      </Show>
    </div>
  );
}
