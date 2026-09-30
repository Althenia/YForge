import { createEffect, For, Show } from "solid-js";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffController } from "../state/diffController";
import { hunkHeader, lineMarker, type HunkAction } from "../state/diffModel";
import type { Cell, NoteSide } from "../state/diffRows";
import { lineKey } from "../state/diffRows";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import type { VirtualRow } from "./VirtualRows";

const kindWord = { added: "added", removed: "removed", context: "context" } as const;

const actionLabel: Record<HunkAction, string> = { stage: "Stage hunk", unstage: "Unstage hunk", discard: "Discard hunk" };
const actionShortcut = { stage: "S", unstage: "U" } as const;

export function Code(props: { diff: DiffController; cell: Cell }) {
  return (
    <span class="code">
      <For each={props.diff.segments(props.cell.ref)}>
        {(part) => (
          <span classList={{ [`syn-${part.kind}`]: part.kind !== undefined, word: part.changed }}>{part.text}</span>
        )}
      </For>
    </span>
  );
}

function Gutter(props: { diff: DiffController; cell: Cell; numbers: Array<number | null> }) {
  const line = () => props.cell.line;
  const ref = () => props.cell.ref;
  const number = () => (line().kind === "removed" ? line().old_number : line().new_number);
  const selected = () => props.diff.isSelected(ref());
  const reason = () => props.diff.blocked();
  const label = () => {
    const name = `Select ${kindWord[line().kind]} line ${number()}`;
    const why = reason();
    return why === undefined ? { "aria-label": name } : tip(why, undefined, name);
  };
  let button: HTMLButtonElement | undefined;
  createEffect(() => {
    if (props.diff.focusRequest() !== lineKey(ref())) return;
    button?.focus();
    props.diff.fulfilFocus();
  });
  const marker = () => (
    <span class="mk" aria-hidden="true">
      <Show when={selected()} fallback={lineMarker[line().kind]}>
        <Icon name="check" size={14} />
      </Show>
    </span>
  );
  const numbers = () => (
    <For each={props.numbers}>{(value) => <span class="ln" aria-hidden="true">{value}</span>}</For>
  );
  return (
    <Show
      when={line().kind !== "context" && props.diff.selectable()}
      fallback={
        <span class="gut">
          {numbers()}
          <span class="mk" aria-hidden="true">{lineMarker[line().kind]}</span>
        </span>
      }
    >
      <button
        type="button"
        role="checkbox"
        class="gut pick"
        ref={button}
        aria-checked={selected()}
        aria-disabled={reason() === undefined ? undefined : "true"}
        {...label()}
        tabindex={props.diff.tabStop(ref()) ? 0 : -1}
        onClick={(event) => props.diff.pick(ref(), event.shiftKey)}
        onFocus={() => props.diff.setCursor(ref())}
        onKeyDown={(event) => props.diff.onLineKey(ref(), event)}
      >
        {numbers()}
        {marker()}
      </button>
    </Show>
  );
}

export function UnifiedLine(props: { diff: DiffController; cell: Cell; virtual: VirtualRow }) {
  return (
    <div
      class="dline"
      classList={{ add: props.cell.line.kind === "added", del: props.cell.line.kind === "removed", sel: props.diff.isSelected(props.cell.ref) }}
      ref={props.virtual.measure}
      data-index={props.virtual.index}
      style={props.virtual.style}
    >
      <Gutter diff={props.diff} cell={props.cell} numbers={[props.cell.line.old_number, props.cell.line.new_number]} />
      <Code diff={props.diff} cell={props.cell} />
    </div>
  );
}

const NEWLINE_NOTE = "No newline at end of file";

export function NoteRow(props: { side: NoteSide; split: boolean; virtual: VirtualRow }) {
  return (
    <Show
      when={props.split}
      fallback={
        <div class="dline note" ref={props.virtual.measure} data-index={props.virtual.index} style={props.virtual.style}>
          <span class="gut" />
          <span class="code">{NEWLINE_NOTE}</span>
        </div>
      }
    >
      <div class="dsplit note" ref={props.virtual.measure} data-index={props.virtual.index} style={props.virtual.style}>
        <div class="half old">
          <span class="gut" />
          <span class="code">{props.side === "new" ? "" : NEWLINE_NOTE}</span>
        </div>
        <div class="half new">
          <span class="gut" />
          <span class="code">{props.side === "old" ? "" : NEWLINE_NOTE}</span>
        </div>
      </div>
    </Show>
  );
}

function Half(props: { diff: DiffController; cell: Cell | undefined; side: "old" | "new" }) {
  return (
    <div
      class="half"
      classList={{
        old: props.side === "old",
        new: props.side === "new",
        add: props.cell?.line.kind === "added",
        del: props.cell?.line.kind === "removed",
        blank: props.cell === undefined,
        sel: props.cell !== undefined && props.diff.isSelected(props.cell.ref),
      }}
    >
      <Show when={props.cell}>
        {(cell) => (
          <>
            <Gutter diff={props.diff} cell={cell()} numbers={[props.side === "old" ? cell().line.old_number : cell().line.new_number]} />
            <Code diff={props.diff} cell={cell()} />
          </>
        )}
      </Show>
    </div>
  );
}

export function SplitRow(props: { diff: DiffController; left: Cell | undefined; right: Cell | undefined; virtual: VirtualRow }) {
  return (
    <div class="dsplit" ref={props.virtual.measure} data-index={props.virtual.index} style={props.virtual.style}>
      <Half diff={props.diff} cell={props.left} side="old" />
      <Half diff={props.diff} cell={props.right} side="new" />
    </div>
  );
}

export function GapRow(props: { hidden: number; virtual: VirtualRow }) {
  return (
    <div class="dgap" ref={props.virtual.measure} data-index={props.virtual.index} style={props.virtual.style}>
      {props.hidden} unchanged {props.hidden === 1 ? "line" : "lines"}
    </div>
  );
}

export function HunkActions(props: { diff: DiffController; hunk: DiffHunk }) {
  const reason = () => props.diff.blocked();
  const disabled = (action: HunkAction) => ({
    ...tip(reason() ?? actionLabel[action], reason() === undefined ? actionShortcut[action as "stage" | "unstage"] : undefined, actionLabel[action]),
    "aria-disabled": reason() === undefined ? undefined : ("true" as const),
  });
  return (
    <span class="hacts">
      <For each={props.diff.actions()}>
        {(action) => (
          <Show
            when={action === "discard"}
            fallback={
              <button type="button" class="icon-btn dense" {...disabled(action)} onClick={() => props.diff.runHunk(action, props.hunk)}>
                <Icon name={action === "stage" ? "plus" : "minus"} />
              </button>
            }
          >
            <button type="button" class="btn sm text-danger" {...disabled(action)} onClick={() => props.diff.runHunk(action, props.hunk)}>
              <Icon name="trash" size={14} />
              {actionLabel[action]}
            </button>
          </Show>
        )}
      </For>
    </span>
  );
}

export function HunkHead(props: { diff: DiffController; hunk: DiffHunk }) {
  return (
    <>
      <span class="range">{hunkHeader(props.hunk)}</span>
      <span class="spacer" />
      <HunkActions diff={props.diff} hunk={props.hunk} />
    </>
  );
}
