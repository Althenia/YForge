import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { relativeAge } from "../format";
import { createGraphStore, PAGE_SIZE } from "../graph/graphStore";
import type { Geometry } from "../graph/geometry";
import { edgePath, laneClass, nodeX, rowY, visibleEdges } from "../graph/laneArt";
import { beginLabelDrag, labelAt, registerLabel } from "../graph/labelDrag";
import { groupRefs, refTarget, rowLabels, type LabelGroup } from "../graph/refLabels";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RefTarget } from "../state/refMenu";
import type { RepoActions } from "../state/repoActions";
import { indexOfSelection, selectionOfRow, stepIndex, type Selection } from "../state/selection";
import { Icon } from "./Icon";

const OVERSCAN = 8;

const kindWord = { commit: "commit", merge: "merge commit", stash: "stash", changes: "working tree changes" } as const;

function Label(props: { group: LabelGroup; sha: string | null; actions: RepoActions }) {
  const target = (): RefTarget | undefined => (props.sha === null ? undefined : refTarget(props.group, props.sha));
  return (
    <span
      class="label"
      classList={{ active: props.group.head, tag: props.group.tag }}
      title={props.group.title}
      data-ref-label
      ref={(element) => registerLabel(element, target)}
      onPointerDown={(event) => {
        const current = target();
        if (current !== undefined && !props.group.tag) {
          beginLabelDrag(event, current, labelAt, (dragged, dropped, at) => void props.actions.openDropMenu(dragged, dropped, at));
        }
      }}
      onContextMenu={(event) => {
        const current = target();
        if (current === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        props.actions.openRefMenu(current, { left: event.clientX, top: event.clientY });
      }}
      onDblClick={(event) => {
        const current = target();
        if (current === undefined || props.group.head) return;
        event.stopPropagation();
        props.actions.checkoutRef(current);
      }}
    >
      <Show when={props.group.head}>
        <Icon name="check" size={14} />
      </Show>
      <span class="name">{props.group.name}</span>
      <Show when={props.group.local}>
        <Icon name="local" size={14} />
      </Show>
      <Show when={props.group.remote}>
        <Icon name="remote" size={14} />
      </Show>
      <Show when={props.group.tag}>
        <Icon name="tag" size={14} />
      </Show>
    </span>
  );
}

function RowView(props: {
  index: number;
  row: GraphRow;
  geometry: Geometry;
  messageLeft: number;
  total: number;
  remotes: readonly string[];
  actions: RepoActions;
  now: number;
  selected: boolean;
  conflicted: boolean;
  dimmed: boolean;
  onSelect: (index: number) => void;
}) {
  const labels = createMemo(() => rowLabels(groupRefs(props.row.refs, props.remotes)));
  const accessibleName = () => {
    const { row } = props;
    const parts = [row.summary || "(no message)"];
    if (row.author !== null) parts.push(row.author.name);
    if (row.time !== null) parts.push(relativeAge(row.time, props.now));
    const names = row.refs.map((ref) => ref.name);
    if (names.length > 0) parts.push(`refs: ${names.join(", ")}`);
    parts.push(kindWord[row.kind]);
    if (row.refs.some((ref) => ref.is_head)) parts.push("checked out");
    return parts.join(", ");
  };
  return (
    <div
      id={`graph-row-${props.index}`}
      class={`grow ${laneClass(props.row.column, props.geometry)} kind-${props.row.kind}`}
      classList={{ sel: props.selected, dim: props.dimmed, conflict: props.row.kind === "changes" && props.conflicted }}
      style={{ top: `${props.index * props.geometry.row}px` }}
      role="option"
      aria-selected={props.selected}
      aria-posinset={props.index + 1}
      aria-setsize={props.total}
      aria-label={accessibleName()}
      onClick={() => props.onSelect(props.index)}
      onContextMenu={(event) => {
        if (props.row.sha === null || props.row.kind === "stash") return;
        event.preventDefault();
        props.onSelect(props.index);
        props.actions.openCommitMenu(props.row.sha, props.row.kind === "merge", { left: event.clientX, top: event.clientY });
      }}
    >
      <div class="gbg" />
      <div class="lstrip" style={{ left: `${props.messageLeft}px` }} />
      <Show when={labels().branch !== undefined || labels().tags.length > 0}>
        <div class="refcell">
          <Show when={labels().branch}>{(group) => <Label group={group()} sha={props.row.sha} actions={props.actions} />}</Show>
          <Show when={labels().moreBranches.length > 0}>
            <span class="more" title={labels().moreBranches.map((group) => group.title).join(", ")}>
              +{labels().moreBranches.length}
            </span>
          </Show>
          <For each={labels().tags}>{(group) => <Label group={group} sha={props.row.sha} actions={props.actions} />}</For>
        </div>
      </Show>
      <div class="msg" style={{ left: `${props.messageLeft + 12}px` }}>
        <span class="sum" title={props.row.summary}>
          {props.row.summary || "(no message)"}
        </span>
      </div>
    </div>
  );
}

function PlaceholderRow(props: { index: number; geometry: Geometry }) {
  return <div class="grow placeholder" style={{ top: `${props.index * props.geometry.row}px` }} aria-hidden="true" />;
}

function LaneArt(props: {
  geometry: Geometry;
  firstRow: number;
  endRow: number;
  rows: ReadonlyMap<number, GraphRow>;
  edges: ReturnType<typeof visibleEdges>;
  width: number;
}) {
  const geometry = () => props.geometry;
  const indices = () => Array.from({ length: Math.max(props.endRow - props.firstRow, 0) }, (_, offset) => props.firstRow + offset);
  const dotted = (kind: string) => (kind === "changes" || kind === "stash" ? "2 2" : undefined);
  return (
    <svg
      class="lanes"
      style={{ top: `${props.firstRow * geometry().row}px` }}
      width={props.width}
      height={Math.max(props.endRow - props.firstRow, 0) * geometry().row}
      aria-hidden="true"
    >
      <For each={indices()}>
        {(index) => (
          <Show when={props.rows.get(index)}>
            {(row) => (
              <Show when={row().refs.length > 0}>
                <line
                  class={`connector ${laneClass(row().column, geometry())}`}
                  x1="2"
                  x2={nodeX(row().column, geometry())}
                  y1={rowY(index - props.firstRow, geometry())}
                  y2={rowY(index - props.firstRow, geometry())}
                />
              </Show>
            )}
          </Show>
        )}
      </For>
      <For each={props.edges}>
        {(placed) => (
          <path
            class={`edge ${laneClass(placed.edge.lane, geometry())}`}
            d={edgePath(placed, geometry(), props.firstRow, props.endRow)}
            stroke-dasharray={dotted(placed.kind)}
            stroke-width={geometry().line}
          />
        )}
      </For>
      <For each={indices()}>
        {(index) => (
          <Show when={props.rows.get(index)}>
            {(row) => {
              const x = () => nodeX(row().column, geometry());
              const y = () => rowY(index - props.firstRow, geometry());
              const radius = () => (geometry().node - geometry().line) / 2;
              return (
                <g class={laneClass(row().column, geometry())}>
                  <Show when={row().kind === "changes"}>
                    <circle class="node-dotted" cx={x()} cy={y()} r={radius()} stroke-dasharray="2 3" stroke-width={geometry().line} />
                  </Show>
                  <Show when={row().kind === "stash"}>
                    <rect
                      class="node-dotted"
                      x={x() - radius()}
                      y={y() - radius()}
                      width={radius() * 2}
                      height={radius() * 2}
                      stroke-dasharray="2 2"
                      stroke-width={geometry().line}
                    />
                    <g transform={`translate(${x() - 6} ${y() - 6}) scale(.5)`} class="stash-glyph">
                      <path d="M4 9h16v11H4zM7 4h10l3 5H4zM9 14h6" />
                    </g>
                  </Show>
                  <Show when={row().kind === "merge"}>
                    <circle class="node-fill" cx={x()} cy={y()} r={geometry().mergeNode / 2} />
                  </Show>
                  <Show when={row().kind === "commit"}>
                    <circle
                      class="node-fill node-disc"
                      cx={x()}
                      cy={y()}
                      r={geometry().node / 2 - geometry().line / 2}
                      stroke-width={geometry().line}
                    />
                    <text class="initials" x={x()} y={y()} dy="0.35em" text-anchor="middle">
                      {row().author?.initials ?? "?"}
                    </text>
                  </Show>
                </g>
              );
            }}
          </Show>
        )}
      </For>
    </svg>
  );
}

export function GraphPanel(props: {
  path: string;
  snapshot: RepoSnapshot;
  geometry: Geometry;
  selection: Selection | undefined;
  revision: number;
  covered: boolean;
  actions: RepoActions;
  dimmed: (index: number) => boolean;
  searching: boolean;
  focus: { nonce: number; index?: number; ref?: string } | undefined;
  onSelect: (selection: Selection) => void;
}) {
  const store = createGraphStore(props.path);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const now = Math.floor(Date.now() / 1000);
  let scroller: HTMLDivElement | undefined;

  const graphWidth = () => Math.max(props.geometry.graphColumn, props.geometry.gutter + store.lanes() * props.geometry.pitch);
  const messageLeft = () => props.geometry.refColumn + graphWidth();
  const range = createMemo(() => {
    const rowHeight = props.geometry.row;
    const first = Math.max(0, Math.floor(scrollTop() / rowHeight) - OVERSCAN);
    const end = Math.min(store.total(), Math.ceil((scrollTop() + viewportHeight()) / rowHeight) + OVERSCAN);
    return { first, end };
  });
  const indices = createMemo(() => Array.from({ length: Math.max(range().end - range().first, 0) }, (_, offset) => range().first + offset));
  const edges = createMemo(() => visibleEdges(store.edges().values(), range().first, range().end));

  const selected = createMemo(() => indexOfSelection(store.rows(), props.selection));

  createEffect(on(() => props.revision, () => void store.refresh(), { defer: true }));

  createEffect(() => {
    const { first, end } = range();
    store.ensure(first, Math.max(end, first + 1, Math.ceil(viewportHeight() / props.geometry.row) + OVERSCAN));
  });

  onMount(() => {
    if (scroller === undefined) return;
    const observer = new ResizeObserver(() => setViewportHeight(scroller?.clientHeight ?? 0));
    observer.observe(scroller);
    setViewportHeight(scroller.clientHeight);
    onCleanup(() => observer.disconnect());
  });

  const reveal = (index: number) => {
    if (scroller === undefined) return;
    const top = index * props.geometry.row;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + props.geometry.row > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + props.geometry.row - scroller.clientHeight;
    }
  };

  createEffect(() => {
    const index = selected();
    if (index !== undefined) reveal(index);
  });

  const select = (index: number) => {
    const row = store.rows().get(index);
    const next = row === undefined ? undefined : selectionOfRow(row);
    if (next !== undefined) props.onSelect(next);
  };

  let handledFocus = -1;
  createEffect(() => {
    const target = props.focus;
    if (target === undefined || handledFocus === target.nonce) return;
    let index = target.index;
    if (index === undefined) {
      for (const [row, value] of store.rows()) {
        if (value.refs.some((ref) => ref.name === target.ref)) {
          index = row;
          break;
        }
      }
      if (index === undefined) {
        store.ensure(0, store.total() > 0 ? store.total() : PAGE_SIZE);
        if (store.total() > 0 && store.rows().size >= store.total()) handledFocus = target.nonce;
        return;
      }
    }
    store.ensure(index, index + 1);
    if (store.rows().get(index) === undefined) return;
    handledFocus = target.nonce;
    if (scroller !== undefined) scroller.scrollTop = Math.max(0, index * props.geometry.row - scroller.clientHeight / 2);
    select(index);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const last = store.total() - 1;
    const step = ({ ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 } as const)[event.key as "j"];
    if (step !== undefined) {
      event.preventDefault();
      const target = stepIndex(selected(), step, last);
      if (target !== undefined) select(target);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const row = document.querySelector<HTMLElement>(`#graph-row-${selected()}`);
      const label = row?.querySelector<HTMLElement>("[data-ref-label]") ?? row;
      if (label !== null && label !== undefined) {
        event.preventDefault();
        const rect = label.getBoundingClientRect();
        label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom + 4 }));
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(last);
    }
  };

  return (
    <section class="panel graph" classList={{ covered: props.covered, searching: props.searching }} inert={props.covered} aria-label="Commit graph" style={{ "--graph-w": `${graphWidth()}px` }}>
      <div class="ghead" aria-hidden="true">
        <span>Branch / Tag</span>
        <span>Graph</span>
        <span>Commit message</span>
      </div>
      <Show when={store.error()}>{(error) => <div class="graph-error" role="alert">{error().message}</div>}</Show>
      <div
        class="gscroll"
        ref={scroller}
        role="listbox"
        tabindex="0"
        aria-label="Commits"
        aria-activedescendant={selected() === undefined ? undefined : `graph-row-${selected()}`}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div class="gspacer" style={{ height: `${store.total() * props.geometry.row}px` }}>
          <For each={indices()}>
            {(index) => (
              <Show when={store.rows().get(index)} fallback={<PlaceholderRow index={index} geometry={props.geometry} />}>
                {(row) => (
                  <RowView
                    index={index}
                    row={row()}
                    geometry={props.geometry}
                    messageLeft={messageLeft()}
                    total={store.total()}
                    remotes={props.snapshot.remotes}
                    actions={props.actions}
                    now={now}
                    selected={selected() === index}
                    conflicted={props.snapshot.counts.conflicted > 0}
                    dimmed={props.dimmed(index)}
                    onSelect={select}
                  />
                )}
              </Show>
            )}
          </For>
          <LaneArt
            geometry={props.geometry}
            firstRow={range().first}
            endRow={range().end}
            rows={store.rows()}
            edges={edges()}
            width={messageLeft()}
          />
        </div>
      </div>
    </section>
  );
}
