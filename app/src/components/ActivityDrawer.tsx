import { createMemo, createSignal, For, Show } from "solid-js";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { useApp } from "../state/app";
import { commandText, entriesFor, formatDuration, outputText, undoState } from "../state/activityModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

function EntryView(props: { entry: ActivityEntry; onUndo: (id: number) => void; undoId: number | undefined }) {
  const [open, setOpen] = createSignal(!props.entry.ok);
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const time = () => new Date(props.entry.started_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const status = () => (props.entry.ok ? "ok" : "failed");
  return (
    <li class="act-entry" classList={{ failed: !props.entry.ok }}>
      <button type="button" class="act-head" aria-expanded={open()} onClick={() => setOpen((value) => !value)}>
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
          <Show when={props.entry.undo.kind === "unavailable" && props.entry.local && props.entry.ok && props.entry.undo}>
            {(undo) => <p class="setting-note">Undo unavailable: {undo().kind === "unavailable" ? undo().reason : ""}</p>}
          </Show>
        </div>
      </Show>
    </li>
  );
}

export function ActivityDrawer(props: { repo: string | undefined; onUndo: (id: number) => void }) {
  const app = useApp();
  const [everything, setEverything] = createSignal(false);
  const shown = createMemo(() => entriesFor(app.activity(), everything() ? undefined : props.repo).slice().reverse());
  const undoId = () => {
    const state = props.repo === undefined ? undefined : undoState(app.activity(), props.repo);
    return state?.kind === "available" ? state.entry.id : undefined;
  };
  return (
    <section class="drawer" id="activity-drawer" role="region" aria-label="Activity">
      <div class="drawer-head">
        <h2>
          <Icon name="activity" />
          Activity
        </h2>
        <Show when={props.repo}>
          <label class="check">
            <input type="checkbox" checked={everything()} onChange={(event) => setEverything(event.currentTarget.checked)} />
            All repositories
          </label>
        </Show>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={() => void app.clearActivity(everything() ? undefined : props.repo)}>
          <Icon name="trash" size={14} />
          Clear
        </button>
        <button type="button" class="icon-btn dense" {...tip("Collapse Activity", "⌘⇧Y")} onClick={app.closeDrawer}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <ul class="act-list">
        <For each={shown()} fallback={<li class="setting-note act-empty">No operations yet in this session</li>}>
          {(entry) => <EntryView entry={entry} onUndo={props.onUndo} undoId={undoId()} />}
        </For>
      </ul>
    </section>
  );
}
