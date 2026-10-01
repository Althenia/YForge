import { createUniqueId, For, onCleanup, onMount } from "solid-js";
import type { ConfirmCopy } from "../state/confirmCopy";
import { Icon } from "./Icon";

const MAX_NAMES = 8;

const moreCount = (total: number) => (total - MAX_NAMES).toLocaleString("en-US");

export function ConfirmDialog(props: { copy: ConfirmCopy; onConfirm: () => void; onCancel: () => void }) {
  const titleId = createUniqueId();
  const bodyId = createUniqueId();
  let cancel: HTMLButtonElement | undefined;
  let confirm: HTMLButtonElement | undefined;
  const opener = document.activeElement;

  onMount(() => cancel?.focus());
  onCleanup(() => {
    if (opener instanceof HTMLElement) opener.focus();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onCancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === cancel ? confirm : cancel)?.focus();
    }
  };

  return (
    <div class="scrim" onPointerDown={(event) => event.target === event.currentTarget && props.onCancel()}>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} onKeyDown={onKeyDown}>
        <h3 id={titleId}>
          {props.copy.warning && <Icon name="warning" />}
          {props.copy.title}
        </h3>
        <div id={bodyId} class="dialog-body">
          {props.copy.lead !== undefined && <p>{props.copy.lead}</p>}
          {props.copy.namesHeading !== undefined && <p class="dialog-heading">{props.copy.namesHeading}</p>}
          {props.copy.names.length > 0 && (
            <ul class="dialog-names">
              <For each={props.copy.names.slice(0, MAX_NAMES)}>{(name) => <li class="ref">{name}</li>}</For>
              {(props.copy.total ?? props.copy.names.length) > MAX_NAMES && <li>and {moreCount(props.copy.total ?? props.copy.names.length)} more</li>}
            </ul>
          )}
          {props.copy.also !== undefined && (
            <>
              <p class="dialog-heading">{props.copy.also.heading}</p>
              <ul class="dialog-names">
                <For each={props.copy.also.names.slice(0, MAX_NAMES)}>{(name) => <li class="ref">{name}</li>}</For>
                {(props.copy.also.total ?? props.copy.also.names.length) > MAX_NAMES && <li>and {moreCount(props.copy.also.total ?? props.copy.also.names.length)} more</li>}
              </ul>
            </>
          )}
          <For each={props.copy.consequences}>{(line) => <p>{line}</p>}</For>
        </div>
        <div class="foot">
          <button type="button" class="btn" ref={cancel} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" class="btn" classList={{ danger: props.copy.neutral !== true, primary: props.copy.neutral === true }} ref={confirm} onClick={props.onConfirm}>
            {props.copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
