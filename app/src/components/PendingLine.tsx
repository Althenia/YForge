import { Show } from "solid-js";
import { createPendingIndicator } from "../state/pending";

export function PendingLine(props: { pending: boolean; label: string }) {
  const shown = createPendingIndicator(() => props.pending);
  return (
    <Show when={shown()}>
      <div class="pending-line" data-indicator role="status">
        <span class="pending-line-bar" aria-hidden="true" />
        <span class="pending-line-static" aria-hidden="true">
          In progress…
        </span>
        <span class="sr-only">{props.label}</span>
      </div>
    </Show>
  );
}
