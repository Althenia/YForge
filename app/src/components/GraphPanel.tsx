import { useQueryClient } from "@tanstack/solid-query";
import { createTable } from "@tanstack/solid-table";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { formatAbsolute, relativeAge } from "../format";
import {
  clampColumn,
  columnLabels,
  columnLimits,
  defaultColumnSize,
  graphColumns,
  graphColumnSizing,
  graphFeatures,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  type ResizableColumn,
} from "../graph/columns";
import { createGraphStore, PAGE_SIZE } from "../graph/graphStore";
import { useNow } from "../state/clock";
import { createIssueChips, type IssueChips as IssueChipState } from "../state/jiraIssues";
import { IssueChips } from "./IssueChip";
import type { Geometry } from "../graph/geometry";
import { edgePath, laneClass, nodeX, rowY, visibleEdges } from "../graph/laneArt";
import { groupRefs, rowLabels } from "../graph/refLabels";
import { reachFrom } from "../graph/reachability";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { Anchor, RepoActions } from "../state/repoActions";
import { columnVisibility, columnWidths, withColumn, type RepoUiPrefsStore } from "../state/repoUiPrefs";
import { squashProblem } from "../state/rebaseModel";
import { indexOfSelection, indexOfSha, rangeSelection, selectedShas, selectionOfRow, stepIndex, toggleSelection, type Selection } from "../state/selection";
import { createMinWidth, GRAPH_COLUMNS_MIN_WIDTH } from "../state/viewport";
import { ColumnResizer } from "./ColumnResizer";
import { GraphSettings } from "./GraphSettings";
import { Icon } from "./Icon";
import { RefLabel } from "./RefLabel";
import { RefOverflow } from "./RefOverflow";
import { tip } from "./Tooltip";
import { useApp } from "../state/app";
import { ensureGraphAvatar, graphAvatarRevision } from "../state/avatar";

const OVERSCAN = 8;
const SHORT_AUTHOR_WIDTH = 40;

const kindWord = { commit: "commit", merge: "merge commit", stash: "stash", changes: "working tree changes", clean_changes: "working tree, clean" } as const;

type FocusTarget = { nonce: number; index?: number; ref?: string; select?: boolean };

const anchorBelow = (element: Element): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 4 };
};

function ExtraCell(props: { column: OptionalColumn; row: GraphRow; width: number; now: number }) {
  const text = () => {
    const { row } = props;
    if (props.column === "author") return row.author === null ? "" : props.width <= SHORT_AUTHOR_WIDTH ? row.author.initials : row.author.name;
    if (props.column === "date") return row.time === null ? "" : relativeAge(row.time, props.now);
    return row.sha === null ? "" : row.sha.slice(0, 7);
  };
  const title = () => {
    const { row } = props;
    if (props.column === "author") return row.author?.name;
    return props.column === "date" && row.time !== null ? formatAbsolute(row.time) : undefined;
  };
  return (
    <span class="gcell" classList={{ mono: props.column === "sha" }} style={{ width: `${props.width}px` }} title={title()} aria-hidden="true">
      {text()}
    </span>
  );
}

const rowText = (row: GraphRow): string => [row.summary, ...row.refs.map((ref) => ref.name)].join("\n");

function RowView(props: {
  index: number;
  row: GraphRow;
  geometry: Geometry;
  messageLeft: number;
  extras: readonly OptionalColumn[];
  sizes: Record<string, number>;
  total: number;
  remotes: readonly string[];
  actions: RepoActions;
  now: number;
  selected: boolean;
  conflicted: boolean;
  dimmed: boolean;
  onSelect: (index: number, event: MouseEvent) => void;
  onMenu: (index: number, event: MouseEvent) => void;
  onOverflow: (index: number, anchor: Anchor) => void;
  onHighlight: (sha: string | undefined) => void;
  chips: IssueChipState;
}) {
  const labels = createMemo(() => rowLabels(groupRefs(props.row.refs, props.remotes)));
  const hidden = () => labels().moreBranches;
  const accessibleName = () => {
    const { row } = props;
    const parts = [row.summary || "(no message)"];
    if (row.author !== null) parts.push(row.author.name);
    if (row.time !== null) parts.push(relativeAge(row.time, props.now));
    const names = row.refs.map((ref) => ref.name);
    if (names.length > 0) parts.push(`refs: ${names.join(", ")}`);
    if (hidden().length > 0) parts.push(`${hidden().length} more ${hidden().length === 1 ? "branch" : "branches"}, press Enter to list`);
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
      onClick={(event) => props.onSelect(props.index, event)}
      onContextMenu={(event) => props.onMenu(props.index, event)}
    >
      <div class="gbg" />
      <div class="lstrip" style={{ left: `${props.messageLeft}px` }} />
      <Show when={labels().branch !== undefined || labels().tags.length > 0}>
        <div class="refcell">
          <Show when={labels().branch}>{(group) => <RefLabel group={group()} sha={props.row.sha} actions={props.actions} onHighlight={props.onHighlight} />}</Show>
          <Show when={hidden().length > 0}>
            <button
              type="button"
              class="more"
              tabindex="-1"
              aria-haspopup="dialog"
              aria-label={`${hidden().length} more ${hidden().length === 1 ? "branch" : "branches"}: ${hidden().map((group) => group.title).join(", ")}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onOverflow(props.index, anchorBelow(event.currentTarget));
              }}
            >
              +{hidden().length}
            </button>
          </Show>
          <For each={labels().tags}>{(group) => <RefLabel group={group} sha={props.row.sha} actions={props.actions} />}</For>
        </div>
      </Show>
      <div class="msg" style={{ left: `${props.messageLeft + 12}px` }}>
        <span class="sum" title={props.row.summary}>
          {props.row.summary || "(no message)"}
        </span>
        <IssueChips keys={props.chips.keysFor(rowText(props.row))} lookup={props.chips.lookup} />
      </div>
      <Show when={props.extras.length > 0}>
        <div class="gextra">
          <For each={props.extras}>{(column) => <ExtraCell column={column} row={props.row} width={props.sizes[column] ?? 0} now={props.now} />}</For>
        </div>
      </Show>
    </div>
  );
}

function PlaceholderRow(props: { index: number; geometry: Geometry }) {
  return <div class="grow placeholder" style={{ top: `${props.index * props.geometry.row}px` }} aria-hidden="true" />;
}

function LaneArt(props: {
  geometry: Geometry;
  avatarsOn: () => boolean;
  firstRow: number;
  endRow: number;
  rows: ReadonlyMap<number, GraphRow>;
  edges: ReturnType<typeof visibleEdges>;
  width: number;
  faded: (index: number) => boolean;
}) {
  const geometry = () => props.geometry;
  const indices = () => Array.from({ length: Math.max(props.endRow - props.firstRow, 0) }, (_, offset) => props.firstRow + offset);
  const dotted = (kind: string) => (kind === "changes" || kind === "clean_changes" || kind === "stash" ? "2 2" : undefined);
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
                  classList={{ faded: props.faded(index) }}
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
            classList={{ faded: props.faded(placed.row) }}
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
              const avatarOf = () => (props.avatarsOn() ? ensureGraphAvatar(row().author?.email) : undefined);
              return (
                <g class={laneClass(row().column, geometry())} classList={{ faded: props.faded(index) }}>
                  <Show when={row().kind === "changes" || row().kind === "clean_changes"}>
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
                    <Show when={avatarOf()}>
                      {(source) => (
                        <image
                          class="node-avatar"
                          href={source()}
                          x={x() - radius()}
                          y={y() - radius()}
                          width={radius() * 2}
                          height={radius() * 2}
                          aria-hidden="true"
                        />
                      )}
                    </Show>
                    <Show when={!avatarOf()}>
                      <text class="initials" x={x()} y={y()} dy="0.35em" text-anchor="middle">
                        {row().author?.initials ?? "?"}
                      </text>
                    </Show>
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
  focus: FocusTarget | undefined;
  uiPrefs: RepoUiPrefsStore;
  onSelect: (selection: Selection) => void;
  onRevealHead: () => void;
}) {
  const app = useApp();
  const avatarsOn = () => app.ready() && app.settings().gravatar_avatars;
  const visibility = () => props.uiPrefs.prefs().branch_visibility;
  const store = createGraphStore(props.path, useQueryClient(), visibility, () => props.selection);
  // Re-render the nodes once a picture has loaded.
  createEffect(() => void graphAvatarRevision());
  const wide = createMinWidth(GRAPH_COLUMNS_MIN_WIDTH);
  const now = useNow();
  let scroller: HTMLDivElement | undefined;
  const [preview, setPreview] = createSignal<{ id: ResizableColumn; size: number } | undefined>();
  const [settingsAnchor, setSettingsAnchor] = createSignal<Anchor | undefined>();
  const [overflow, setOverflow] = createSignal<{ index: number; anchor: Anchor } | undefined>();
  const [hover, setHover] = createSignal<string | undefined>();
  const [pinned, setPinned] = createSignal<string | undefined>();

  const savedSizes = () => {
    const drag = preview();
    return drag === undefined ? columnWidths(props.uiPrefs.prefs()) : { ...columnWidths(props.uiPrefs.prefs()), [drag.id]: drag.size };
  };

  const table = createTable({
    features: graphFeatures,
    columns: graphColumns,
    data: [],
    state: {
      get columnSizing() {
        return graphColumnSizing(props.geometry, store.lanes(), savedSizes());
      },
      get columnVisibility() {
        return wide() ? columnVisibility(props.uiPrefs.prefs()) : { author: false, date: false, sha: false };
      },
    },
  });
  const sizeOf = (id: string) => table.getColumn(id)?.getSize() ?? 0;
  const extras = createMemo(() => OPTIONAL_COLUMNS.filter((id) => table.getColumn(id)?.getIsVisible() === true));
  const sizes = createMemo(() => Object.fromEntries(["refs", "graph", ...OPTIONAL_COLUMNS].map((id) => [id, sizeOf(id)])));
  const extraWidth = () => extras().reduce((total, id) => total + sizeOf(id), 0);
  const graphWidth = () => sizeOf("graph");
  const messageLeft = () => sizeOf("refs") + graphWidth();
  const view = createMemo((): Geometry => ({ ...props.geometry, refColumn: sizeOf("refs") }));
  const headerColumns = () => `${sizeOf("refs")}px ${graphWidth()}px minmax(0, 1fr) ${extras().map((id) => `${sizeOf(id)}px`).join(" ")} var(--controls-hit-min)`;

  const virtualizer = createVirtualizer({
    get count() {
      return store.total();
    },
    getScrollElement: () => scroller ?? null,
    estimateSize: () => props.geometry.row,
    overscan: OVERSCAN,
  });
  const items = () => virtualizer.getVirtualItems();
  const range = createMemo(() => {
    const visible = items();
    const last = visible.at(-1);
    return { first: visible[0]?.index ?? 0, end: last === undefined ? 0 : last.index + 1 };
  });
  const edges = createMemo(() => visibleEdges(store.edges().values(), range().first, range().end));
  const chips = createIssueChips(() => items().flatMap((item) => store.rows().get(item.index) ?? []).map(rowText));

  const selected = createMemo(() => indexOfSelection(store.rows(), props.selection));
  const chosen = createMemo(() => new Set(selectedShas(props.selection)));
  const highlighted = () => pinned() ?? hover();
  const reach = createMemo(() => {
    const rows = store.rows();
    const tip = highlighted();
    const start = tip === undefined ? undefined : indexOfSha(rows, tip);
    return tip === undefined || start === undefined ? undefined : reachFrom(rows, (row) => row.sha === tip, start);
  });
  const faded = (index: number): boolean => {
    const current = reach();
    const kind = store.rows().get(index)?.kind;
    if (current === undefined || kind === "changes" || kind === "clean_changes") return false;
    return index < current.start || (index < current.covered && !current.reachable.has(index));
  };

  createEffect(on(() => props.revision, () => void store.refresh(), { defer: true }));

  const visibilitySignature = createMemo(() => JSON.stringify(visibility()));
  createEffect(on(visibilitySignature, () => void store.refresh(), { defer: true }));

  createEffect(on(() => props.geometry.row, () => virtualizer.measure(), { defer: true }));

  createEffect(() => {
    const { first, end } = range();
    store.show(first, Math.max(end, first + 1));
  });

  createEffect(() => {
    const index = selected();
    if (index !== undefined) virtualizer.scrollToIndex(index, { align: "auto" });
  });

  const select = (index: number) => {
    const row = store.rows().get(index);
    const next = row === undefined ? undefined : selectionOfRow(row);
    if (next !== undefined) props.onSelect(next);
  };

  const anchorOf = (): string | undefined => (props.selection?.kind === "commit" ? (props.selection.anchor ?? props.selection.sha) : undefined);

  const extend = (index: number) => {
    const anchor = anchorOf();
    const next = anchor === undefined ? undefined : rangeSelection(store.rows(), anchor, index);
    if (next === undefined) select(index);
    else props.onSelect(next);
  };

  const choose = (index: number, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      const next = toggleSelection(store.rows(), props.selection, index);
      if (next !== undefined) props.onSelect(next);
      return;
    }
    const anchor = anchorOf();
    const anchorIndex = anchor === undefined ? undefined : indexOfSha(store.rows(), anchor);
    if (event.shiftKey && anchorIndex !== undefined) {
      void store.load(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).then(() => extend(index));
      return;
    }
    select(index);
  };

  const openMenu = (index: number, event: MouseEvent) => {
    const row = store.rows().get(index);
    if (row === undefined || row.sha === null || row.kind === "stash") return;
    event.preventDefault();
    const inSelection = chosen().has(row.sha);
    if (!inSelection) select(index);
    const shas = inSelection ? selectedShas(props.selection) : [row.sha];
    const commits = shas.flatMap((sha) => {
      const found = store.rows().get(indexOfSha(store.rows(), sha) ?? -1);
      return found === undefined ? [] : [{ sha, parents: found.parents }];
    });
    props.actions.openCommitMenu(row.sha, row.kind === "merge", { left: event.clientX, top: event.clientY }, shas, {
      root: row.parents.length === 0,
      ...(shas.length > 1 ? { squashReason: squashProblem(commits) } : {}),
    });
  };

  const hiddenGroups = (index: number) => {
    const row = store.rows().get(index);
    return row === undefined ? [] : rowLabels(groupRefs(row.refs, props.snapshot.remotes)).moreBranches;
  };

  const openOverflowAt = (index: number | undefined) => {
    if (index === undefined || hiddenGroups(index).length === 0) return false;
    const element = document.querySelector<HTMLElement>(`#graph-row-${index} .more`) ?? document.querySelector<HTMLElement>(`#graph-row-${index}`);
    if (element === null) return false;
    setOverflow({ index, anchor: anchorBelow(element) });
    return true;
  };

  const overflowRow = createMemo(() => {
    const open = overflow();
    const row = open === undefined ? undefined : store.rows().get(open.index);
    return open === undefined || row === undefined || row.sha === null ? undefined : { anchor: open.anchor, sha: row.sha, groups: hiddenGroups(open.index) };
  });

  const closeOverflow = () => {
    setOverflow(undefined);
    setHover(undefined);
    scroller?.focus();
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
    virtualizer.scrollToIndex(index, { align: "center" });
    if (target.select !== false) select(index);
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const last = store.total() - 1;
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const row = document.querySelector<HTMLElement>(`#graph-row-${selected()}`);
      const label = row?.querySelector<HTMLElement>("[data-ref-label]") ?? row;
      if (label !== null && label !== undefined) {
        event.preventDefault();
        const rect = label.getBoundingClientRect();
        label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom + 4 }));
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = ({ ArrowDown: 1, j: 1, J: 1, ArrowUp: -1, k: -1, K: -1 } as const)[event.key as "j"];
    if (step !== undefined) {
      event.preventDefault();
      const target = stepIndex(selected(), step, last);
      if (target === undefined) return;
      if (event.shiftKey) extend(target);
      else select(target);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(last);
    } else if (event.key === " ") {
      const index = selected();
      const next = index === undefined ? undefined : toggleSelection(store.rows(), props.selection, index);
      if (next !== undefined) {
        event.preventDefault();
        props.onSelect(next);
      }
    } else if (event.key === "Enter") {
      if (openOverflowAt(selected())) event.preventDefault();
    } else if (event.key === "Escape") {
      const current = props.selection;
      if (pinned() !== undefined) {
        event.preventDefault();
        setPinned(undefined);
      } else if (current?.kind === "commit" && current.shas !== undefined) {
        event.preventDefault();
        props.onSelect({ kind: "commit", sha: current.sha });
      }
    } else if (event.key === "b" || event.key === "B") {
      const index = selected();
      const row = index === undefined ? undefined : store.rows().get(index);
      if (row?.sha != null && row.refs.some((ref) => ref.kind !== "tag")) {
        event.preventDefault();
        setPinned(pinned() === row.sha ? undefined : row.sha);
      }
    } else if (event.key === "h" || event.key === "H") {
      event.preventDefault();
      props.onRevealHead();
    }
  };

  const summary = () => {
    const shas = selectedShas(props.selection);
    return shas.length > 1 ? shas : undefined;
  };

  const settle = (id: ResizableColumn, size: number) => props.uiPrefs.update((current) => withColumn(current, id, { width: size }));
  const resizer = (id: ResizableColumn, label: string, side: "start" | "end") => (
    <ColumnResizer
      label={label}
      side={side}
      size={sizeOf(id)}
      min={columnLimits(id, props.geometry).min}
      max={columnLimits(id, props.geometry).max}
      clamp={(size) => clampColumn(id, size, props.geometry)}
      onPreview={(size) => setPreview(size === undefined ? undefined : { id, size })}
      onCommit={(size) => settle(id, size)}
      onReset={() => settle(id, defaultColumnSize(id, props.geometry))}
    />
  );

  return (
    <section
      class="panel graph"
      classList={{ covered: props.covered, searching: props.searching }}
      inert={props.covered}
      aria-label="Commit graph"
      style={{ "--graph-w": `${graphWidth()}px`, "--ref-w": `${sizeOf("refs")}px`, "--extra-w": `${extraWidth()}px` }}
    >
      <div class="ghead" style={{ "grid-template-columns": headerColumns() }}>
        <span class="gh">
          Branch / Tag
          {resizer("refs", "Branch / Tag", "end")}
        </span>
        <span class="gh">Graph</span>
        <span class="gh">Commit message</span>
        <For each={extras()}>
          {(id) => (
            <span class="gh">
              {resizer(id, columnLabels[id], "start")}
              {columnLabels[id]}
            </span>
          )}
        </For>
        <span class="gh gear">
          <button
            type="button"
            class="icon-btn dense"
            {...tip("Graph columns and branches")}
            aria-haspopup="dialog"
            aria-expanded={settingsAnchor() !== undefined}
            onClick={(event) => setSettingsAnchor(settingsAnchor() === undefined ? anchorBelow(event.currentTarget) : undefined)}
          >
            <Icon name="settings" />
          </button>
        </span>
      </div>
      <Show when={store.error()}>{(error) => <div class="graph-error" role="alert">{error().message}</div>}</Show>
      <div
        class="gscroll"
        ref={scroller}
        role="listbox"
        tabindex="0"
        aria-label="Commits"
        aria-multiselectable="true"
        aria-activedescendant={selected() === undefined ? undefined : `graph-row-${selected()}`}
        onKeyDown={onKeyDown}
      >
        <div class="gspacer" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          <For each={items()}>
            {(item) => (
              <Show when={store.rows().get(item.index)} fallback={<PlaceholderRow index={item.index} geometry={props.geometry} />}>
                {(row) => (
                  <RowView
                    index={item.index}
                    row={row()}
                    geometry={view()}
                    messageLeft={messageLeft()}
                    extras={extras()}
                    sizes={sizes()}
                    total={store.total()}
                    remotes={props.snapshot.remotes}
                    actions={props.actions}
                    now={now()}
                    selected={selected() === item.index || (row().sha !== null && row().kind !== "stash" && chosen().has(row().sha as string))}
                    conflicted={props.snapshot.counts.conflicted > 0}
                    dimmed={props.dimmed(item.index) || faded(item.index)}
                    onSelect={choose}
                    onMenu={openMenu}
                    onOverflow={(index, anchor) => setOverflow({ index, anchor })}
                    onHighlight={setHover}
                    chips={chips}
                  />
                )}
              </Show>
            )}
          </For>
          <LaneArt geometry={view()} avatarsOn={avatarsOn} firstRow={range().first} endRow={range().end} rows={store.rows()} edges={edges()} width={messageLeft()} faded={faded} />
        </div>
      </div>
      <Show when={summary()}>
        {(shas) => (
          <div class="gsummary" role="status">
            <span class="gsummary-count">{shas().length} commits selected</span>
            <span class="gsummary-range">
              <span class="ref">{shas()[0]?.slice(0, 7)}</span>
              <Icon name="next" size={14} />
              <span class="ref">{shas()[shas().length - 1]?.slice(0, 7)}</span>
            </span>
            <span class="spacer" />
            <button
              type="button"
              class="icon-btn dense"
              {...tip("Clear selection", "Esc")}
              onClick={() => {
                const current = props.selection;
                if (current?.kind === "commit") props.onSelect({ kind: "commit", sha: current.sha });
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </Show>
      <Show when={settingsAnchor()}>
        {(anchor) => <GraphSettings anchor={anchor()} prefs={props.uiPrefs} onClose={() => setSettingsAnchor(undefined)} />}
      </Show>
      <Show when={overflowRow()}>
        {(open) => <RefOverflow anchor={open().anchor} sha={open().sha} groups={open().groups} actions={props.actions} onHighlight={setHover} onClose={closeOverflow} />}
      </Show>
    </section>
  );
}
