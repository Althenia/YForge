import { createMemo, createSignal, Show } from "solid-js";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import { entriesFor, undoState } from "../state/activityModel";
import { earlierEntries } from "../state/diagnosticsModel";
import { createPagedList } from "../state/pagedList";
import { useQuery } from "../state/query";
import { appKeys, diagnosticsKeys, repoKeys } from "../state/queryKeys";
import { ActivityEntryView } from "./ActivityEntryView";
import { AuthorBadge } from "./AuthorBadge";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { listRowHeight, spacingPx, VirtualRows } from "./VirtualRows";

type Row = { kind: "entry"; entry: ActivityEntry; earlier: boolean } | { kind: "earlier-heading" };

export function ActivityDrawer(props: { repo: string | undefined; onUndo: (id: number) => void }) {
  const app = useApp();
  const [everything, setEverything] = createSignal(false);
  const shown = createMemo(() => entriesFor(app.activity(), everything() ? undefined : props.repo).slice().reverse());
  const history = createPagedList(() => {
    const repo = props.repo;
    return { key: diagnosticsKeys.history(repo ?? ""), fetchPage: (before, limit) => client.activityHistory(repo as string, before, limit), enabled: repo !== undefined && !everything() };
  });
  const earlier = createMemo(() => (everything() ? [] : earlierEntries(history.rows(), app.activity())));
  const rows = createMemo((): Row[] => [
    ...shown().map((entry): Row => ({ kind: "entry", entry, earlier: false })),
    ...(earlier().length > 0 ? [{ kind: "earlier-heading" } satisfies Row] : []),
    ...earlier().map((entry): Row => ({ kind: "entry", entry, earlier: true })),
  ]);
  const [expanded, setExpanded] = createSignal<ReadonlyMap<string, boolean>>(new Map());
  const expansionKey = (entry: ActivityEntry, earlierSession: boolean) => `${earlierSession ? "earlier" : "session"}:${entry.id}`;
  let scroller: HTMLDivElement | undefined;
  const identity = useQuery(() => ({ queryKey: props.repo === undefined ? appKeys.identity : repoKeys.identity(props.repo), queryFn: () => client.identityRead(props.repo ?? null) }));
  const who = () => identity.data?.name.value ?? undefined;
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
        <Show when={who()}>
          {(name) => (
            <span class="drawer-who" title={identity.data?.email.value ?? undefined}>
              <AuthorBadge name={name()} email={identity.data?.email.value} />
              {name()}
            </span>
          )}
        </Show>
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
      <div class="act-list" ref={scroller}>
        <Show when={rows().length > 0} fallback={<p class="setting-note act-empty">No operations yet in this session</p>}>
          <VirtualRows as="ul" class="act-rows" items={rows()} scroller={() => scroller} estimate={listRowHeight()} gap={spacingPx("1")} measured>
            {(row, virtual) =>
              row.kind === "earlier-heading" ? (
                <li class="act-group" ref={virtual.measure} style={virtual.style}>
                  <h3>Earlier</h3>
                </li>
              ) : (
                <ActivityEntryView
                  entry={row.entry}
                  earlier={row.earlier}
                  onUndo={props.onUndo}
                  undoId={row.earlier ? undefined : undoId()}
                  initiallyOpen={expanded().get(expansionKey(row.entry, row.earlier))}
                  onToggle={(open) => setExpanded((current) => new Map(current).set(expansionKey(row.entry, row.earlier), open))}
                  style={virtual.style}
                  measure={virtual.measure}
                />
              )
            }
          </VirtualRows>
        </Show>
        <Show when={history.failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
        <Show when={!everything() && history.hasMore()}>
          <div>
            <button type="button" class="btn sm" disabled={history.fetchingMore()} onClick={history.loadMore}>
              Show older
            </button>
          </div>
        </Show>
      </div>
    </section>
  );
}
