import { Show, type JSX } from "solid-js";
import { splitPath } from "../format";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import { statusLetter, statusWord } from "../state/changes";

export function FileRow(props: {
  rowId: string;
  path: string;
  originalPath: string | null;
  status: FileStatus;
  selected: boolean;
  partial?: boolean;
  tabStop: boolean;
  onFocusRow: (rowId: string) => void;
  onOpen?: () => void;
  onKey?: (event: KeyboardEvent) => void;
  children?: JSX.Element;
}) {
  const parts = () => splitPath(props.path);
  const label = () => (props.originalPath === null ? props.path : `${props.originalPath} → ${props.path}`);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const row = event.currentTarget as HTMLElement;
    const moveTo = (sibling: Element | null) => {
      if (!(sibling instanceof HTMLElement)) return;
      event.preventDefault();
      sibling.focus();
    };
    if (event.key === "ArrowDown" || event.key === "j") return moveTo(row.nextElementSibling);
    if (event.key === "ArrowUp" || event.key === "k") return moveTo(row.previousElementSibling);
    if (event.key === "Enter" && event.target === row && props.onOpen !== undefined) {
      event.preventDefault();
      props.onOpen();
      return;
    }
    props.onKey?.(event);
  };

  return (
    <li
      class="frow"
      classList={{ sel: props.selected, openable: props.onOpen !== undefined }}
      data-row={props.rowId}
      tabindex={props.tabStop ? 0 : -1}
      aria-label={`${statusWord[props.status]} ${label()}${props.partial ? ", partially staged" : ""}`}
      aria-current={props.selected ? "true" : undefined}
      title={label()}
      onClick={() => props.onOpen?.()}
      onFocus={() => props.onFocusRow(props.rowId)}
      onKeyDown={onKeyDown}
    >
      <span class={`badge st-${props.status}`} classList={{ partial: props.partial === true }} title={props.partial ? "Partially staged" : undefined} aria-hidden="true">
        {statusLetter[props.status]}
        <Show when={props.partial}>
          <span class="half">½</span>
        </Show>
      </span>
      <span class="path">
        <bdi dir="ltr">
          <Show when={props.originalPath}>{(original) => <span class="dir">{original()} → </span>}</Show>
          <span class="dir">{parts().directory}</span>
          <span class="file">{parts().name}</span>
        </bdi>
      </span>
      {props.children}
    </li>
  );
}
