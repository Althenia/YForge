import { createSignal, For, Show, type JSX } from "solid-js";
import { formatAbsolute } from "../format";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { commandText, formatDuration, outputText } from "../state/activityModel";
import { useNow } from "../state/clock";
import { EARLIER_SESSION_TEXT } from "../state/diagnosticsModel";
import { Icon } from "./Icon";

export function ActivityEntryView(props: {
  entry: ActivityEntry;
  earlier: boolean;
  onUndo: (id: number) => void;
  undoId: number | undefined;
  initiallyOpen?: boolean | undefined;
  onToggle?: (open: boolean) => void;
  style?: JSX.CSSProperties | undefined;
  measure?: ((element: Element | null) => void) | undefined;
}) {
  const [open, setOpen] = createSignal(props.initiallyOpen ?? !props.entry.ok);
  const toggle = () => {
    const next = !open();
    setOpen(next);
    props.onToggle?.(next);
  };
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const now = useNow();
  const time = () => {
    const started = new Date(props.entry.started_at * 1000);
    return started.toDateString() === new Date(now() * 1000).toDateString()
      ? started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : formatAbsolute(props.entry.started_at);
  };
  const status = () => (props.entry.ok ? "ok" : "failed");
  return (
    <li class="act-entry" classList={{ failed: !props.entry.ok }} ref={(element) => props.measure?.(element)} style={props.style}>
      <button type="button" class="act-head" aria-expanded={open()} onClick={toggle}>
        <span class="act-status" classList={{ bad: !props.entry.ok }}>
          <Icon name={props.entry.ok ? "check" : "warning"} size={14} /> <span class="sr">{status()}</span>
        </span>
        <span class="act-op">{props.entry.operation}</span>
        <span class="act-summary">{props.entry.summary}</span>
        <Show when={props.entry.undo.kind === "available" && props.undoId === props.entry.id}>
          <span class="chip chip-success">Undo available</span>
        </Show>
        <Show when={props.entry.undo.kind === "undone"}>
          <span class="chip">Undone</span>
        </Show>
        <Show when={props.earlier}>
          <span class="chip">{EARLIER_SESSION_TEXT}</span>
        </Show>
        <span class="act-time">{time()} · {formatDuration(props.entry.duration_ms)}</span>
      </button>
      <Show when={open()}>
        <div class="act-body">
          <Show when={props.entry.error}>{(error) => <p class="field-note error">{error()}</p>}</Show>
          <For each={props.entry.commands} fallback={<p class="setting-note">No git commands were run.</p>}>
            {(record) => (
              <div class="act-cmd">
                <code class="act-line">{record.command}</code>
                <span class="setting-note">
                  {record.status === null ? "terminated" : `exit ${record.status}`} · {formatDuration(record.duration_ms)}
                </span>
                <Show when={record.output}>{(output) => <pre class="act-output">{output()}</pre>}</Show>
              </div>
            )}
          </For>
          <div class="act-tools">
            <button type="button" class="btn sm" disabled={props.entry.commands.length === 0} onClick={() => copy(commandText(props.entry))}>
              <Icon name="copy" size={14} /> Copy command
            </button>
            <button type="button" class="btn sm" disabled={outputText(props.entry) === ""} onClick={() => copy(outputText(props.entry))}>
              <Icon name="copy" size={14} /> Copy output
            </button>
            <Show when={props.entry.undo.kind === "available" && props.undoId === props.entry.id}>
              <button type="button" class="btn sm" onClick={() => props.onUndo(props.entry.id)}>
                <Icon name="undo" size={14} /> Undo
              </button>
            </Show>
          </div>
          <Show when={!props.earlier && props.entry.undo.kind === "unavailable" && props.entry.local && props.entry.ok && props.entry.undo}>
            {(undo) => <p class="setting-note">Undo unavailable: {undo().kind === "unavailable" ? undo().reason : ""}</p>}
          </Show>
        </div>
      </Show>
    </li>
  );
}
