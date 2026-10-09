import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useApp } from "../state/app";
import type { Toast } from "../state/activityModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

const LIFETIME_MS = 3000;
const VISIBLE = 3;

const undoScope = (entry: ActivityEntry): string | undefined => (entry.undo.kind === "available" ? entry.undo.scope : undefined);

function TimedToast(props: { failure: boolean; title: string; windowActive: () => boolean; onDismiss: () => void; children?: JSX.Element }) {
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const held = () => hovered() || focused() || !props.windowActive();
  createEffect(() => {
    if (held()) return;
    const timer = setTimeout(props.onDismiss, LIFETIME_MS);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div
      class="toast stacked"
      classList={{ held: held(), failure: props.failure }}
      role={props.failure ? "alert" : "status"}
      style={{ "--toast-life": `${LIFETIME_MS}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onDismiss();
      }}
    >
      <span class="toast-status">
        <Icon name={props.failure ? "warning" : "check"} size={14} />
        <span class="sr-only">{props.failure ? "Failed:" : "Done:"}</span>
      </span>
      <span class="toast-title">{props.title}</span>
      {props.children}
      <span class="toast-close">
        <svg class="toast-ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="toast-ring-track" cx="12" cy="12" r="10" />
          <circle class="toast-ring-run" cx="12" cy="12" r="10" pathLength="100" />
        </svg>
        <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={() => props.onDismiss()}>
          <Icon name="close" size={14} />
        </button>
      </span>
    </div>
  );
}

function ToastAction(props: { toast: Toast; onUndo: (id: number) => void }) {
  const app = useApp();
  return (
    <Show
      when={props.toast.kind === "done" ? props.toast : undefined}
      fallback={
        <Show when={props.toast.kind === "activity" ? props.toast : undefined}>
          {(activity) => (
            <Show
              when={activity().undoable}
              fallback={
                <button
                  type="button"
                  class="btn sm"
                  onClick={() => {
                    app.dismissToast(activity().id);
                    app.openDrawer();
                  }}
                >
                  Details
                </button>
              }
            >
              <button type="button" class="btn sm" title={undoScope(activity().entry)} onClick={() => props.onUndo(activity().id)}>
                Undo
              </button>
            </Show>
          )}
        </Show>
      }
    >
      {(done) => (
        <button
          type="button"
          class="btn sm"
          onClick={() => {
            app.dismissToast(done().id);
            done().show();
          }}
        >
          Show
        </button>
      )}
    </Show>
  );
}

/// Top-right toasts (S48): failures, then outcomes newest first, three at a time, the rest queued behind a count.
export function Toasts(props: { onUndo: (id: number) => void }) {
  const app = useApp();
  const [windowActive, setWindowActive] = createSignal(document.hasFocus() && !document.hidden);
  const repoFailure = () => app.repoNotice()?.message();
  const failures = () => [app.notice(), repoFailure()].filter((message) => message !== undefined).length;
  const newestFirst = () => [...app.toasts()].reverse();
  const slots = () => Math.max(0, VISIBLE - failures());
  const dismissNewest = (): boolean => {
    if (app.notice() !== undefined) app.setNotice(undefined);
    else if (repoFailure() !== undefined) app.repoNotice()?.dismiss();
    else {
      const newest = newestFirst()[0];
      if (newest === undefined) return false;
      app.dismissToast(newest.id);
    }
    return true;
  };
  onMount(() => {
    const sync = () => setWindowActive(document.hasFocus() && !document.hidden);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (dismissNewest()) event.preventDefault();
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
      <Show when={app.notice()} keyed>
        {(message) => <TimedToast failure title={message} windowActive={windowActive} onDismiss={() => app.setNotice(undefined)} />}
      </Show>
      <Show when={repoFailure()} keyed>
        {(message) => <TimedToast failure title={message} windowActive={windowActive} onDismiss={() => app.repoNotice()?.dismiss()} />}
      </Show>
      <For each={newestFirst().slice(0, slots())}>
        {(toast) => (
          <TimedToast failure={false} title={toast.message} windowActive={windowActive} onDismiss={() => app.dismissToast(toast.id)}>
            <ToastAction toast={toast} onUndo={props.onUndo} />
          </TimedToast>
        )}
      </For>
      <Show when={newestFirst().length > slots()}>
        <span class="toast-more">{newestFirst().length - slots()} more</span>
      </Show>
    </div>
  );
}
