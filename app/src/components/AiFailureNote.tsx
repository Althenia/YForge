import { Show } from "solid-js";
import type { AiFailure } from "../state/aiModel";
import { Icon } from "./Icon";

export function AiFailureNote(props: { failure: AiFailure; onOpenAiSettings: () => void }) {
  return (
    <div class="note danger" role="alert">
      <strong>{props.failure.message}</strong>
      <Show when={props.failure.detail}>{(detail) => <span class="hint-text">{detail()}</span>}</Show>
      <Show when={props.failure.action}>
        {(action) => (
          <button type="button" class="btn sm" onClick={props.onOpenAiSettings}>
            <Icon name={action() === "sign_in" ? "key" : "settings"} size={14} />
            {action() === "sign_in" ? "Sign in" : "Open AI settings"}
          </button>
        )}
      </Show>
    </div>
  );
}
