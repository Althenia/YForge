import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";

export const PENDING_DELAY_MS = 150;
export const PENDING_MIN_MS = 400;

export function createPendingIndicator(pending: Accessor<boolean>): Accessor<boolean> {
  const [shown, setShown] = createSignal(false);
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let shownAt = 0;
  const clear = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = undefined;
    hideTimer = undefined;
  };
  createEffect(
    on(pending, (busy) => {
      if (busy) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
        if (shown() || showTimer !== undefined) return;
        showTimer = setTimeout(() => {
          showTimer = undefined;
          shownAt = Date.now();
          setShown(true);
        }, PENDING_DELAY_MS);
        return;
      }
      clearTimeout(showTimer);
      showTimer = undefined;
      if (!shown()) return;
      const remaining = PENDING_MIN_MS - (Date.now() - shownAt);
      if (remaining <= 0) {
        setShown(false);
        return;
      }
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        setShown(false);
      }, remaining);
    }),
  );
  onCleanup(clear);
  return shown;
}
