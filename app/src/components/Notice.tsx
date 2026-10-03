import { Show } from "solid-js";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function Notice(props: { message: string | undefined; onDismiss: () => void }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <div class="toast stacked failure" role="alert">
          <span class="toast-status">
            <Icon name="warning" size={14} />
            <span class="sr-only">Failed:</span>
          </span>
          <span class="toast-title">{message()}</span>
          <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={props.onDismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </Show>
  );
}
