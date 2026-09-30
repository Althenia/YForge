import { createMemo, createSignal, For, Show } from "solid-js";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { entriesFor, undoState } from "../state/activityModel";
import { earlierEntries } from "../state/diagnosticsModel";
import { createPagedList } from "../state/pagedList";
import { diagnosticsKeys } from "../state/queryKeys";
import { ActivityEntryView } from "./ActivityEntryView";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function ActivityDrawer(props: { repo: string | undefined; onUndo: (id: number) => void }) {
  const app = useApp();
  const [everything, setEverything] = createSignal(false);
  const shown = createMemo(() => entriesFor(app.activity(), everything() ? undefined : props.repo).slice().reverse());
  const history = createPagedList(() => {
    const repo = props.repo;
    return { key: diagnosticsKeys.history(repo ?? ""), fetchPage: (before, limit) => client.activityHistory(repo as string, before, limit), enabled: repo !== undefined && !everything() };
  });
  const earlier = createMemo(() => (everything() ? [] : earlierEntries(history.rows(), app.activity())));
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
          {(entry) => <ActivityEntryView entry={entry} earlier={false} onUndo={props.onUndo} undoId={undoId()} />}
        </For>
        <Show when={earlier().length > 0}>
          <li class="act-group">
            <h3>Earlier</h3>
          </li>
        </Show>
        <For each={earlier()}>{(entry) => <ActivityEntryView entry={entry} earlier onUndo={props.onUndo} undoId={undefined} />}</For>
        <Show when={history.failure()}>{(text) => <li class="field-note error" role="alert">{text()}</li>}</Show>
        <Show when={!everything() && history.hasMore()}>
          <li>
            <button type="button" class="btn sm" disabled={history.fetchingMore()} onClick={history.loadMore}>
              Show older
            </button>
          </li>
        </Show>
      </ul>
    </section>
  );
}
