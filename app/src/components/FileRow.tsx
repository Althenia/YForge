import { For, Show, type JSX } from "solid-js";
import { splitPath } from "../format";
import type { FileStatus } from "../ipc/bindings/FileStatus";
import { statusLetter, statusWord } from "../state/changes";
import { useFileListMode } from "../state/fileList";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { anchorBelow, opensMenu } from "./TabGroupLayer";
import type { VirtualRow } from "./VirtualRows";
import type { Anchor } from "../state/repoActions";

const moveFocus = (event: KeyboardEvent): boolean => {
  const row = event.currentTarget as HTMLElement;
  const sibling = event.key === "ArrowDown" || event.key === "j" ? row.nextElementSibling : event.key === "ArrowUp" || event.key === "k" ? row.previousElementSibling : undefined;
  if (sibling === undefined) return false;
  if (sibling instanceof HTMLElement) {
    event.preventDefault();
    sibling.focus();
  }
  return true;
};

function Guides(props: { depth: number | undefined }) {
  return (
    <Show when={(props.depth ?? 0) > 0}>
      <span class="guides" aria-hidden="true">
        <For each={Array.from({ length: props.depth ?? 0 })}>{() => <span class="guide" />}</For>
      </span>
    </Show>
  );
}

export const listAttrs = (mode: "path" | "tree", label: string): { role: "tree" | undefined; "aria-label": string | undefined } =>
  mode === "tree" ? { role: "tree", "aria-label": label } : { role: undefined, "aria-label": undefined };

export const multiListAttrs = (mode: "path" | "tree", label: string): { role: "tree" | "listbox"; "aria-label": string; "aria-multiselectable": true } => ({
  role: mode === "tree" ? "tree" : "listbox",
  "aria-label": label,
  "aria-multiselectable": true,
});

export type PickMode = "one" | "toggle" | "range";

const pickMode = (event: MouseEvent): PickMode => (event.metaKey || event.ctrlKey ? "toggle" : event.shiftKey ? "range" : "one");

export function FileRow(props: {
  rowId: string;
  path: string;
  originalPath: string | null;
  status: FileStatus;
  selected: boolean;
  partial?: boolean;
  picked?: boolean;
  tabStop: boolean;
  depth?: number;
  onFocusRow: (rowId: string) => void;
  onOpen?: () => void;
  onPick?: (mode: PickMode) => void;
  onExtend?: (step: 1 | -1) => void;
  onMenu?: (anchor: Anchor) => void;
  onKey?: (event: KeyboardEvent) => void;
  virtual: VirtualRow;
  children?: JSX.Element;
}) {
  const parts = () => splitPath(props.path);
  const tree = () => props.depth !== undefined;
  const label = () => (props.originalPath === null ? props.path : `${props.originalPath} → ${props.path}`);

  const onClick = (event: MouseEvent) => {
    const mode = pickMode(event);
    props.onPick?.(mode);
    if (mode === "one") props.onOpen?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp") && props.onExtend !== undefined) {
      event.preventDefault();
      props.onExtend(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (props.onMenu !== undefined && event.target === event.currentTarget && opensMenu(event)) {
      event.preventDefault();
      props.onMenu(anchorBelow(event.currentTarget as HTMLElement));
      return;
    }
    if (moveFocus(event)) return;
    if (event.key === "Enter" && event.target === event.currentTarget && props.onOpen !== undefined) {
      event.preventDefault();
      props.onOpen();
      return;
    }
    props.onKey?.(event);
  };

  return (
    <li
      class="frow"
      classList={{ sel: props.selected, picked: props.picked === true, openable: props.onOpen !== undefined, tree: tree() }}
      ref={props.virtual.measure}
      data-index={props.virtual.index}
      style={props.virtual.style}
      data-row={props.rowId}
      role={tree() ? "treeitem" : props.picked === undefined ? undefined : "option"}
      aria-level={tree() ? (props.depth ?? 0) + 1 : undefined}
      aria-selected={props.picked}
      tabindex={props.tabStop ? 0 : -1}
      aria-label={`${statusWord[props.status]} ${label()}${props.partial ? ", partially staged" : ""}`}
      aria-current={props.selected ? "true" : undefined}
      title={label()}
      onClick={onClick}
      onContextMenu={(event) => {
        if (props.onMenu === undefined) return;
        event.preventDefault();
        props.onMenu({ left: event.clientX, top: event.clientY });
      }}
      onFocus={() => props.onFocusRow(props.rowId)}
      onKeyDown={onKeyDown}
    >
      <Guides depth={props.depth} />
      <span class={`badge st-${props.status}`} classList={{ partial: props.partial === true }} title={props.partial ? "Partially staged" : undefined} aria-hidden="true">
        {statusLetter[props.status]}
        <Show when={props.partial}>
          <span class="half">½</span>
        </Show>
      </span>
      <span class="path">
        <bdi dir="ltr">
          <Show when={props.originalPath}>{(original) => <span class="dir">{original()} → </span>}</Show>
          <Show when={!tree()}>
            <span class="dir">{parts().directory}</span>
          </Show>
          <span class="file">{parts().name}</span>
        </bdi>
      </span>
      {props.children}
    </li>
  );
}

export function FolderRow(props: {
  rowId: string;
  path: string;
  name: string;
  depth: number;
  open: boolean;
  count: number;
  tabStop: boolean;
  onFocusRow: (rowId: string) => void;
  onToggle: (open?: boolean) => void;
  onSpace?: () => void;
  onMenu?: (anchor: Anchor) => void;
  virtual: VirtualRow;
  children?: JSX.Element;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
    if (moveFocus(event)) return;
    if (props.onMenu !== undefined && opensMenu(event)) {
      event.preventDefault();
      props.onMenu(anchorBelow(event.currentTarget as HTMLElement));
      return;
    }
    const open = { Enter: undefined, ArrowRight: true, ArrowLeft: false }[event.key as "Enter" | "ArrowRight" | "ArrowLeft"];
    if (event.key === "Enter" || open !== undefined) {
      event.preventDefault();
      props.onToggle(open);
    } else if (event.key === " " && props.onSpace !== undefined) {
      event.preventDefault();
      props.onSpace();
    }
  };

  return (
    <li
      class="frow drow tree"
      ref={props.virtual.measure}
      data-index={props.virtual.index}
      style={props.virtual.style}
      data-row={props.rowId}
      role="treeitem"
      aria-level={props.depth + 1}
      aria-expanded={props.open}
      aria-label={`${props.path}, ${props.count} ${props.count === 1 ? "file" : "files"}`}
      tabindex={props.tabStop ? 0 : -1}
      title={props.path}
      onClick={() => props.onToggle()}
      onContextMenu={(event) => {
        if (props.onMenu === undefined) return;
        event.preventDefault();
        props.onMenu({ left: event.clientX, top: event.clientY });
      }}
      onFocus={() => props.onFocusRow(props.rowId)}
      onKeyDown={onKeyDown}
    >
      <Guides depth={props.depth} />
      <span class="tree-chev" classList={{ closed: !props.open }} aria-hidden="true">
        <Icon name="chevron" size={14} />
      </span>
      <span class="folder-icon" aria-hidden="true">
        <Icon name="folder" size={14} />
      </span>
      <span class="path">
        <bdi dir="ltr">
          <span class="file">{props.name}</span>
        </bdi>
      </span>
      <span class="dcount">{props.count}</span>
      {props.children}
    </li>
  );
}

export function UnchangedRow(props: { rowId: string; path: string; depth?: number; tabStop: boolean; onFocusRow: (rowId: string) => void; virtual: VirtualRow }) {
  const parts = () => splitPath(props.path);
  const tree = () => props.depth !== undefined;
  return (
    <li
      class="frow unchanged"
      classList={{ tree: tree() }}
      ref={props.virtual.measure}
      data-index={props.virtual.index}
      style={props.virtual.style}
      data-row={props.rowId}
      role={tree() ? "treeitem" : undefined}
      aria-level={tree() ? (props.depth ?? 0) + 1 : undefined}
      tabindex={props.tabStop ? 0 : -1}
      aria-label={`Unchanged ${props.path}`}
      title={`${props.path} · unchanged in this commit`}
      onFocus={() => props.onFocusRow(props.rowId)}
      onKeyDown={(event) => {
        if (!event.metaKey && !event.ctrlKey && !event.altKey) moveFocus(event);
      }}
    >
      <Guides depth={props.depth} />
      <span class="badge st-unchanged" aria-hidden="true" />
      <span class="path">
        <bdi dir="ltr">
          <Show when={!tree()}>
            <span class="dir">{parts().directory}</span>
          </Show>
          <span class="file">{parts().name}</span>
        </bdi>
      </span>
      <span class="unchanged-word">unchanged</span>
    </li>
  );
}

export function FileListTools(props: { folders: number; anyClosed: boolean; onCollapseAll: () => void; onExpandAll: () => void }) {
  const view = useFileListMode();
  const fileListMode = view.mode;
  const setFileListMode = view.choose;
  return (
    <span class="list-tools">
      <span class="seg seg-icon" role="group" aria-label="File list view">
        <button type="button" class="icon-btn dense" classList={{ on: fileListMode() === "path" }} aria-pressed={fileListMode() === "path"} {...tip("Path view: full paths", undefined, "Path view")} onClick={() => setFileListMode("path")}>
          <Icon name="file" size={14} />
        </button>
        <button type="button" class="icon-btn dense" classList={{ on: fileListMode() === "tree" }} aria-pressed={fileListMode() === "tree"} {...tip("Tree view: group files by folder", undefined, "Tree view")} onClick={() => setFileListMode("tree")}>
          <Icon name="folder" size={14} />
        </button>
      </span>
      <Show when={fileListMode() === "tree" && props.folders > 0}>
        <button
          type="button"
          class="icon-btn dense"
          {...tip(props.anyClosed ? "Expand all folders" : "Collapse all folders")}
          onClick={() => (props.anyClosed ? props.onExpandAll() : props.onCollapseAll())}
        >
          <Icon name={props.anyClosed ? "plus" : "minus"} size={14} />
        </button>
      </Show>
    </span>
  );
}
