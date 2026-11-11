import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, Index, on, Show } from "solid-js";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { ConflictRegionProposal } from "../ipc/bindings/ConflictRegionProposal";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";
import type { Operation } from "../ipc/bindings/Operation";
import { client, IpcError } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { createAiRun } from "../state/aiRun";
import { createExternalTools } from "../state/externalTools";
import { filesIn } from "../state/changes";
import type { DiffTarget } from "../state/diffModel";
import { conflictDescription, conflictSides, operationButtons, stepLabel } from "../state/operationModel";
import { repoKeys } from "../state/queryKeys";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import {
  anchorAtScroll,
  assemble,
  choose,
  hasPick,
  initialState,
  markResolvedReason,
  markerCount,
  mergeProgress,
  regionSideState,
  regionsOf,
  resolverCommand,
  savedContent,
  scrollTopAtAnchor,
  sideState,
  step,
  toggleAll,
  toggleLinePick,
  toggleSide,
  type Region,
  type ResolverState,
} from "../state/resolverModel";
import { MenuLabel } from "./ContextMenu";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";
import { ToolButton } from "./ToolButton";

const OUTPUT_LINE_HEIGHT = 20;
const OUTPUT_ROWS = 12;

type OutputState = { text: string; starts: number[] | undefined; edited: boolean };

type PaneKind = "current" | "incoming" | "output";

const sideNames: Record<ConflictSide, { title: string; word: string }> = {
  current: { title: "Yours", word: "yours" },
  incoming: { title: "Theirs", word: "theirs" },
};

const operationNoun: Partial<Record<Operation, string>> = {
  merge: "merge",
  rebase: "rebase",
  cherry_pick: "cherry-pick",
  revert: "revert",
  cherry_pick_sequence: "cherry-pick",
  revert_sequence: "revert",
};

export function ConflictResolver(props: {
  session: RepoSession;
  actions?: Pick<RepoActions, "operationBusy" | "continueOperation" | "skipOperation" | "abortOperation">;
  file: string;
  onClose?: () => void;
  onBack?: () => void;
  onOpenDiff?: (target: DiffTarget) => void;
  onOpenAiSettings?: () => void;
}) {
  const path = props.session.path;
  const [resolvedHere, setResolvedHere] = createSignal(false);
  const conflict = useQuery(() => ({
    queryKey: repoKeys.conflict(path, props.file),
    queryFn: () => client.conflictFile(path, props.file),
    placeholderData: keepPreviousData,
    gcTime: 0,
    enabled: !resolvedHere(),
  }));
  const [state, setState] = createSignal<ResolverState>({ picks: [], active: 0 });
  const [output, setOutput] = createSignal<OutputState>({ text: "", starts: undefined, edited: false });
  const [undo, setUndo] = createSignal<{ output: OutputState; state: ResolverState } | undefined>();
  const [restore, setRestore] = createSignal<OutputState | undefined>();
  const [rationales, setRationales] = createSignal<ConflictRegionProposal[]>([]);
  const [baseOpen, setBaseOpen] = createSignal(false);
  const [mergeMessage, setMergeMessage] = createSignal(props.session.snapshot().operation_detail?.message ?? "");
  const proposer = createAiRun(props.session.queryClient, (id) => client.aiProposeConflict(path, id, props.file));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const tools = createExternalTools(props.session);
  const reloadConflict = () => void props.session.queryClient.invalidateQueries({ queryKey: repoKeys.conflict(path, props.file) });
  const panes: Partial<Record<ConflictSide, HTMLDivElement>> = {};
  let outBody: HTMLDivElement | undefined;
  let gutter: HTMLPreElement | undefined;
  let syncing = false;

  const back = () => (props.onBack ?? props.onClose)?.();
  const sides = () => conflictSides(props.session.snapshot());
  const labels = () => ({ current: sides().current.name, incoming: sides().incoming.name });
  const held = () => (conflict.error == null ? conflict.data : undefined);
  const loaded = () => (conflict.isPlaceholderData ? undefined : held());
  const failure = () => (resolvedHere() ? undefined : conflict.error instanceof IpcError ? conflict.error.message : conflict.error == null ? undefined : String(conflict.error));
  const regions = () => {
    const file = held();
    return file === undefined ? [] : regionsOf(file);
  };
  const active = () => regions()[state().active];
  const position = () => `Conflict ${state().active + 1} of ${regions().length}`;
  const reason = () => (regions().length === 0 ? undefined : markResolvedReason(output().text));
  const stageOnly = () => {
    const file = loaded();
    return file !== undefined && regions().length === 0 && !file.binary && file.sides.current && file.sides.incoming;
  };
  const left = () => markerCount(output().text);
  const lineNumbers = () => Array.from({ length: output().text.split("\n").length }, (_, index) => index + 1).join("\n");
  const conflictedFiles = () => filesIn(props.session.snapshot().files, "conflicted").map((file) => file.path);
  const operation = () => props.session.snapshot().operation;
  const busy = () => props.actions?.operationBusy() ?? false;
  const remainingConflicts = () => conflictedFiles().filter((file) => !(resolvedHere() && file === props.file)).length;
  const progress = () =>
    mergeProgress({
      conflicted: remainingConflicts(),
      resolved: (props.session.snapshot().operation_detail?.resolved.length ?? 0) + (resolvedHere() && !(props.session.snapshot().operation_detail?.resolved ?? []).includes(props.file) ? 1 : 0),
      busy: busy(),
    });

  const derived = (file: ConflictFile, next: ResolverState): OutputState => {
    const built = assemble(file, next, labels());
    return { text: built.text, starts: built.starts, edited: false };
  };

  const load = (file: ConflictFile) => {
    const start = initialState(file);
    setState(start);
    setOutput(derived(file, start));
    setUndo(undefined);
    setRestore(undefined);
    setRationales([]);
    setBaseOpen(false);
  };

  const loadedContent = createMemo(() => {
    const file = loaded();
    return file === undefined ? undefined : JSON.stringify([props.file, file]);
  });
  createEffect(
    on(loadedContent, (content) => {
      const file = loaded();
      if (content !== undefined && file !== undefined) load(file);
    }),
  );
  createEffect(
    on(
      () => props.file,
      () => {
        setResolvedHere(false);
        proposer.cancel();
        proposer.dismiss();
      },
      { defer: true },
    ),
  );

  const rebuild = (next: ResolverState) => {
    const file = loaded();
    if (file === undefined) return;
    const previous = output();
    setUndo(previous.edited ? { output: previous, state: state() } : undefined);
    setState(next);
    setOutput(derived(file, next));
    setRestore(undefined);
    setRationales([]);
  };

  const undoRebuild = () => {
    const saved = undo();
    if (saved === undefined) return;
    setState(saved.state);
    setOutput(saved.output);
    setUndo(undefined);
  };

  const edit = (text: string) => {
    setOutput({ text, starts: undefined, edited: true });
    setUndo(undefined);
  };

  const propose = async () => {
    const file = loaded();
    const result = await proposer.start();
    if (file === undefined || loaded() !== file || result === undefined || result.regions.length === 0) return;
    const built = assemble(file, state(), labels(), Object.fromEntries(result.regions.map((region) => [region.index, region.text])));
    setRestore(output());
    setOutput({ text: built.text, starts: built.starts, edited: true });
    setUndo(undefined);
    setRationales([...result.regions].sort((a, b) => a.index - b.index));
  };

  const restoreMine = () => {
    const saved = restore();
    if (saved === undefined) return;
    setOutput(saved);
    setRestore(undefined);
    setRationales([]);
  };

  const outputArea = () => outBody?.querySelector<HTMLTextAreaElement>("textarea") ?? undefined;
  const paneElement = (kind: PaneKind): HTMLElement | undefined => (kind === "output" ? outputArea() : panes[kind]);

  const lineHeight = (): number => {
    const area = outputArea();
    const measured = area === undefined ? Number.NaN : Number.parseFloat(getComputedStyle(area).lineHeight);
    return Number.isFinite(measured) && measured > 0 ? measured : OUTPUT_LINE_HEIGHT;
  };

  const segmentCounts = (kind: PaneKind): number[] => {
    const file = held();
    if (file === undefined) return [];
    let regionIndex = 0;
    const starts = output().starts;
    const totalOutputLines = output().text === "" ? 0 : output().text.split("\n").length;
    return file.segments.map((segment) => {
      if (segment.kind === "text") return segment.lines.length;
      const index = regionIndex++;
      if (kind === "current") return segment.current.length;
      if (kind === "incoming") return segment.incoming.length;
      if (starts !== undefined) {
        const start = starts[index] ?? 0;
        const next = starts[index + 1];
        return Math.max(0, (next === undefined ? totalOutputLines : next) - start);
      }
      return segment.current.length + segment.incoming.length + 3;
    });
  };

  const setPaneScroll = (kind: PaneKind, value: number, horizontal: number) => {
    const element = paneElement(kind);
    if (element === undefined) return;
    element.scrollTop = value;
    element.scrollLeft = horizontal;
    if (kind === "output" && gutter !== undefined) {
      gutter.scrollTop = value;
    }
  };

  const syncFrom = (source: PaneKind, element: HTMLElement) => {
    if (syncing) return;
    syncing = true;
    try {
      const height = lineHeight();
      const sourceCounts = segmentCounts(source);
      const anchor = anchorAtScroll(sourceCounts, element.scrollTop, element.clientHeight, Math.max(element.scrollHeight, sourceCounts.reduce((sum, count) => sum + count, 0) * height), height);
      for (const kind of ["current", "incoming", "output"] as PaneKind[]) {
        if (kind === source) continue;
        const target = paneElement(kind);
        if (target === undefined) continue;
        const counts = segmentCounts(kind);
        const virtualHeight = counts.reduce((sum, count) => sum + count, 0) * height;
        setPaneScroll(kind, scrollTopAtAnchor(counts, anchor, target.clientHeight, Math.max(target.scrollHeight, virtualHeight), height), element.scrollLeft);
      }
      if (source !== "output") {
        const area = outputArea();
        if (area !== undefined && gutter !== undefined) gutter.scrollTop = area.scrollTop;
      }
    } finally {
      queueMicrotask(() => {
        syncing = false;
      });
    }
  };

  const attachSync = (kind: PaneKind, element: HTMLElement) => {
    element.addEventListener("scroll", () => syncFrom(kind, element));
  };

  const segmentPositionOfRegion = (regionIndex: number): number => {
    const file = held();
    if (file === undefined) return regionIndex;
    let seen = -1;
    for (const [index, segment] of file.segments.entries()) {
      if (segment.kind !== "conflict") continue;
      seen += 1;
      if (seen === regionIndex) return index;
    }
    return regionIndex;
  };

  const revealActive = (index: number) => {
    const height = lineHeight();
    syncing = true;
    try {
      for (const side of ["current", "incoming"] as ConflictSide[]) {
        const pane = panes[side];
        const hunk = pane?.querySelector(`.mt-hunk[data-region="${index}"]`);
        hunk?.scrollIntoView({ block: "center" });
        if (pane !== undefined) {
          const counts = segmentCounts(side);
          const virtualHeight = Math.max(pane.scrollHeight, counts.reduce((sum, count) => sum + count, 0) * height);
          const anchored = scrollTopAtAnchor(counts, { segmentIndex: segmentPositionOfRegion(index), fraction: 0 }, pane.clientHeight, virtualHeight, height);
          pane.scrollTop = Math.max(0, Math.min(Math.max(0, virtualHeight - pane.clientHeight), anchored - Math.max(0, (pane.clientHeight - height) / 2)));
        }
      }
      const line = output().starts?.[index];
      const area = outputArea();
      if (line !== undefined && area !== undefined) {
        const centered = Math.max(0, Math.min(Math.max(0, area.scrollHeight - area.clientHeight), line * height - Math.max(0, (area.clientHeight - height) / 2)));
        area.scrollTop = centered;
        if (gutter !== undefined) gutter.scrollTop = centered;
      }
    } finally {
      queueMicrotask(() => {
        syncing = false;
      });
    }
  };

  const activeIndex = createMemo(() => state().active);
  createEffect(
    on(activeIndex, (index) => revealActive(index), { defer: true }),
  );

  const syncGutter = (event: Event) => {
    const area = event.target;
    if (area instanceof HTMLTextAreaElement) {
      if (gutter !== undefined && gutter.scrollTop !== area.scrollTop) gutter.scrollTop = area.scrollTop;
      syncFrom("output", area);
    }
  };

  const resolve = async () => {
    const file = loaded();
    if (file === undefined || reason() !== undefined) return;
    if (regions().length === 0 && !stageOnly()) return;
    const content = regions().length === 0 ? undefined : savedContent(file, output().text);
    const ok = await props.session.mutate(() => (content === undefined ? client.markResolved(path, [props.file]) : client.conflictResolve(path, props.file, content)));
    if (!ok) return;
    setResolvedHere(true);
    const next = conflictedFiles().find((candidate) => candidate !== props.file);
    if (next !== undefined && props.onOpenDiff !== undefined) props.onOpenDiff({ source: "working", area: "conflicted", file: next });
    else if (operation() === null) back();
  };

  const useSide = (side: ConflictSide) => {
    if (loaded() !== undefined) void props.session.mutate(() => client.conflictTakeSide(path, props.file, side));
  };

  const resetFile = async () => {
    if (!(await props.session.mutate(() => client.conflictReset(path, props.file)))) return;
    const { data: file } = await conflict.refetch();
    if (file !== undefined) load(file);
  };

  const continueOp = () => {
    const message = mergeMessage().trim() === "" ? null : mergeMessage();
    if (props.actions !== undefined) void props.actions.continueOperation(operation() === "merge" ? message : null);
    else void props.session.mutate(() => client.operationContinue(path, operation() === "merge" ? message : null));
  };
  const skipOp = () => {
    if (props.actions !== undefined) void props.actions.skipOperation();
    else void props.session.mutate(() => client.operationSkip(path));
  };
  const abortOp = () => {
    if (props.actions !== undefined) props.actions.abortOperation();
    else void props.session.mutate(() => client.operationAbort(path));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const command = resolverCommand(event);
    if (command === undefined) return;
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    if (typing && command.kind !== "save") return;
    event.preventDefault();
    if (command.kind === "save") void resolve();
    else if (regions().length === 0) return;
    else if (command.kind === "choose") rebuild(choose(state(), state().active, command.choice, regions()));
    else setState(step(state(), command.kind === "next" ? 1 : -1));
  };

  const wholeFileNote = () => {
    const file = held();
    if (file === undefined) return undefined;
    if (file.binary) return "This is a binary file. Choose which version to keep.";
    if (!file.sides.current) return `${sides().current.name} deleted this file while the other side changed it. Keep the change or accept the deletion.`;
    if (!file.sides.incoming) return `${sides().incoming.name} deleted this file while the other side changed it. Keep the change or accept the deletion.`;
    return "No conflict markers remain in this file. Mark it resolved to stage its current content.";
  };

  const openConflictedFile = (offset: number) => {
    const files = conflictedFiles();
    const current = files.indexOf(props.file);
    const target = files[current + offset];
    if (target !== undefined && props.onOpenDiff !== undefined) props.onOpenDiff({ source: "working", area: "conflicted", file: target });
  };

  const Pane = (paneProps: { side: ConflictSide; file: ConflictFile }) => {
    const names = sideNames[paneProps.side];
    const allState = () => sideState(state(), paneProps.side, regions());
    const segments = () => {
      let index = 0;
      return paneProps.file.segments.map((segment) => (segment.kind === "text" ? { lines: segment.lines, region: undefined } : { lines: segment[paneProps.side], region: index++, segment }));
    };
    return (
      <section class="mt-pane" classList={{ [`side-${paneProps.side}`]: true }} aria-label={names.title}>
        <div class="mt-h">
          <span class="mt-title">
            <strong>{names.title}</strong> · <span class="mono">{sides()[paneProps.side].name}</span> · <span class="role">{sides()[paneProps.side].role}</span>
          </span>
          <button
            type="button"
            role="checkbox"
            class="mt-all"
            aria-checked={allState()}
            {...tip(allState() === "true" ? `Clear every ${names.word} block in this file` : `Use every ${names.word} block in this file`, undefined, "Select all")}
            onClick={() => rebuild(toggleAll(state(), paneProps.side, regions()))}
          >
            <span class="mt-box" aria-hidden="true">
              <Show when={allState() !== "false"}>
                <Icon name={allState() === "true" ? "check" : "minus"} size={14} />
              </Show>
            </span>
            Select all
          </button>
          <span class="mt-nav" role="group" aria-label={`Conflict navigation in ${names.title}`}>
            <span class="mt-pos">{position()}</span>
            <button type="button" class="icon-btn dense" {...tip("Previous conflict", "P")} onClick={() => setState(step(state(), -1))}>
              <Icon name="previous" />
            </button>
            <button type="button" class="icon-btn dense" {...tip("Next conflict", "N")} onClick={() => setState(step(state(), 1))}>
              <Icon name="next" />
            </button>
          </span>
        </div>
        <div
          class="mt-code"
          ref={(element) => {
            panes[paneProps.side] = element;
            attachSync(paneProps.side, element);
          }}
        >
          <Index each={segments()}>
            {(segment) => (
              <Show
                when={segment().region !== undefined}
                fallback={
                  <Show when={segment().lines.length > 0}>
                    <pre class="mt-ctx">{segment().lines.join("\n")}</pre>
                  </Show>
                }
              >
                {(() => {
                  const region = () => segment().region ?? 0;
                  const regionObject = (): Region => regions()[region()] ?? { current: [], incoming: [], base: null };
                  const picks = () => state().picks[region()] ?? [];
                  const sideCheck = () => regionSideState(regionObject(), picks(), paneProps.side);
                  return (
                    <div class="mt-hunk" classList={{ "is-cur": state().active === region(), "is-on": sideCheck() !== "false" }} data-region={region()}>
                      <button
                        type="button"
                        role="checkbox"
                        class="mt-check"
                        aria-checked={sideCheck()}
                        aria-label={`Use ${names.word} for conflict ${region() + 1}`}
                        data-region={region()}
                        onClick={() => rebuild(toggleSide(state(), region(), paneProps.side, regionObject()))}
                      >
                        <span class="mt-box" aria-hidden="true">
                          <Show when={sideCheck() !== "false"}>
                            <Icon name={sideCheck() === "true" ? "check" : "minus"} size={14} />
                          </Show>
                        </span>
                        Use {names.word}
                      </button>
                      <Show
                        when={segment().lines.length > 0}
                        fallback={
                          <button
                            type="button"
                            role="checkbox"
                            class="mt-line-check mt-empty"
                            aria-checked={hasPick(picks(), paneProps.side, -1)}
                            aria-label={`Select empty ${names.word} side for conflict ${region() + 1}`}
                            data-line={-1}
                            onClick={() => rebuild(toggleLinePick(state(), region(), { side: paneProps.side, lineIndex: -1 }))}
                          >
                            <span class="mt-box" aria-hidden="true">
                              <Show when={hasPick(picks(), paneProps.side, -1)}>
                                <Icon name="check" size={14} />
                              </Show>
                            </span>
                            <span class="mt-line-text">(no lines)</span>
                          </button>
                        }
                      >
                        <div class="mt-lines">
                          <For each={segment().lines}>
                            {(line, lineIndex) => (
                              <div class="mt-line-row">
                                <button
                                  type="button"
                                  role="checkbox"
                                  class="mt-line-check"
                                  aria-checked={hasPick(picks(), paneProps.side, lineIndex())}
                                  aria-label={`Select ${names.word} line ${lineIndex() + 1} for conflict ${region() + 1}`}
                                  data-line={lineIndex()}
                                  onClick={() => rebuild(toggleLinePick(state(), region(), { side: paneProps.side, lineIndex: lineIndex() }))}
                                >
                                  <span class="mt-box" aria-hidden="true">
                                    <Show when={hasPick(picks(), paneProps.side, lineIndex())}>
                                      <Icon name="check" size={14} />
                                    </Show>
                                  </span>
                                </button>
                                <pre class="mt-line">{line}</pre>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  );
                })()}
              </Show>
            )}
          </Index>
        </div>
      </section>
    );
  };

  const barOperation = () => {
    const current = operation();
    return current !== null && operationNoun[current] !== undefined ? current : null;
  };
  const barButtons = () => {
    const current = barOperation();
    return current === null ? undefined : operationButtons(current, remainingConflicts(), busy(), props.session.snapshot().operation_detail?.stopped_edit != null);
  };
  const barReason = () => (barOperation() === "merge" ? progress().commitReason : barButtons()?.continue.disabledReason);
  const showSkip = () => {
    const current = barOperation();
    return current === "rebase" || current === "cherry_pick" || current === "revert" || current === "cherry_pick_sequence" || current === "revert_sequence";
  };

  return (
    <section
      class="panel rpanel merge-tool"
      aria-label="Conflict resolver"
      aria-busy={conflict.isFetching}
      tabindex="-1"
      ref={(element) => queueMicrotask(() => element.focus())}
      onKeyDown={onKeyDown}
    >
      <div class="rhead">
        <span class="mono">{props.file}</span>
        <span class="dim">·</span>
        <span class="dim">
          <MenuLabel parts={conflictDescription(props.session.snapshot())} />
        </span>
        <Show when={conflictedFiles().length > 1 && props.onOpenDiff !== undefined}>
          <span class="rfile-pos">{`${conflictedFiles().indexOf(props.file) + 1} of ${conflictedFiles().length} files`}</span>
          <button type="button" class="icon-btn dense" {...tip("Previous conflicted file")} disabled={conflictedFiles().indexOf(props.file) <= 0} onClick={() => openConflictedFile(-1)}>
            <Icon name="previous" />
          </button>
          <button
            type="button"
            class="icon-btn dense"
            {...tip("Next conflicted file")}
            disabled={conflictedFiles().indexOf(props.file) >= conflictedFiles().length - 1}
            onClick={() => openConflictedFile(1)}
          >
            <Icon name="next" />
          </button>
        </Show>
        <span class="spacer" />
        <Show when={regions().length > 0 && (featureAvailable(features.data, "conflict_fix") || proposer.running())}>
          <Show
            when={proposer.running()}
            fallback={
              <button type="button" class="icon-btn dense ai-btn" {...tip("Propose a resolution for every conflict in this file")} onClick={() => void propose()}>
                <Icon name="wand" size={14} />
              </button>
            }
          >
            <button type="button" class="icon-btn dense ai-btn" aria-busy="true" disabled {...tip("Proposing a resolution…")}>
              <Icon name="wand" size={14} />
            </button>
            <button type="button" class="icon-btn dense" {...tip("Cancel proposing")} onClick={proposer.cancel}>
              <Icon name="close" size={14} />
            </button>
          </Show>
        </Show>
        <ToolButton
          action="Open in external merge tool"
          icon="merge"
          reason={tools.mergeReason()}
          onRun={() => void tools.openMerge(props.file, reloadConflict)}
        />
        <button type="button" class="btn sm" onClick={back}>
          Back to graph
        </button>
      </div>
      <div class="rbody">
        <Show when={resolvedHere() && barOperation() !== null}>
          <div class="note" role="status">{`All conflicts resolved. Finish the ${operationNoun[barOperation()!] ?? "operation"} below.`}</div>
        </Show>
        <Show when={failure()}>{(message) => <div class="graph-error" role="alert">{message()}</div>}</Show>
        <Show when={held()}>
          {(file) => (
            <Show
              when={regions().length > 0}
              fallback={
                <>
                  <div class="note attention" role="status">{wholeFileNote()}</div>
                  <div class="actions" role="group" aria-label="Choose a version">
                    <button type="button" class="btn sm" onClick={() => useSide("current")}>
                      {file().sides.current ? "Use current version" : "Accept current deletion"}
                    </button>
                    <button type="button" class="btn sm" onClick={() => useSide("incoming")}>
                      {file().sides.incoming ? "Use incoming version" : "Accept incoming deletion"}
                    </button>
                  </div>
                </>
              }
            >
              <Show when={proposer.failure()}>
                {(error) => (
                  <div class="note danger" role="alert">
                    <strong>{error().message}</strong>
                    <Show when={error().detail}>{(detail) => <span class="hint-text">{detail()}</span>}</Show>
                    <Show when={error().action}>
                      {(action) => (
                        <button type="button" class="btn sm" onClick={() => props.onOpenAiSettings?.()}>
                          <Icon name={action() === "sign_in" ? "key" : "settings"} size={14} />
                          {action() === "sign_in" ? "Sign in" : "Open AI settings"}
                        </button>
                      )}
                    </Show>
                  </div>
                )}
              </Show>
              <div class="mt-sides">
                <Pane side="current" file={file()} />
                <Pane side="incoming" file={file()} />
              </div>
              <Show when={active()?.base}>
                {(base) => (
                  <div class="cbase">
                    <button type="button" class="cbase-toggle" aria-expanded={baseOpen()} onClick={() => setBaseOpen(!baseOpen())}>
                      <Icon name="chevron" size={14} />
                      {`Show base of conflict ${state().active + 1}`}
                    </button>
                    <Show when={baseOpen()}>
                      <pre>{base().join("\n")}</pre>
                    </Show>
                  </div>
                )}
              </Show>
              <section class="mt-out" aria-label="Output">
                <div class="out-h">
                  <span class="out-title">
                    <strong>Output</strong> <span class="dim">Exactly what will be saved. Type to edit; unresolved parts show Git's conflict markers.</span>
                  </span>
                  <span class="out-state" classList={{ warn: left() > 0, ok: left() === 0 }} role="status">
                    <Icon name={left() > 0 ? "warning" : "check"} size={14} />
                    {left() > 0 ? `${left()} ${left() === 1 ? "conflict marker" : "conflict markers"} left` : "No conflicts left"}
                  </span>
                </div>
                <Show when={undo()}>
                  <div class="note attention" role="status">
                    <span>Rebuilt the Output from your choices, replacing your edits.</span>
                    <button type="button" class="btn sm" onClick={undoRebuild}>
                      <Icon name="undo" size={14} />
                      Undo
                    </button>
                  </div>
                </Show>
                <Show when={rationales().length > 0 || restore() !== undefined}>
                  <div class="note attention" role="status">
                    <span>Draft from your AI provider. Review and edit it; nothing changes in Git until you mark the file resolved.</span>
                    <For each={rationales()}>{(proposal) => <span>Conflict {proposal.index + 1}: {proposal.rationale}</span>}</For>
                    <Show when={restore() !== undefined}>
                      <button type="button" class="btn sm" onClick={restoreMine}>
                        <Icon name="undo" size={14} />
                        Restore my text
                      </button>
                    </Show>
                  </div>
                </Show>
                <div
                  class="out-body"
                  ref={(element) => {
                    outBody = element;
                    element.addEventListener("scroll", syncGutter, true);
                  }}
                >
                  <pre class="out-ln" aria-hidden="true" ref={gutter}>
                    {lineNumbers()}
                  </pre>
                  <TextArea label="Output" value={output().text} minRows={OUTPUT_ROWS} maxRows={OUTPUT_ROWS} onInput={edit} />
                </div>
              </section>
            </Show>
          )}
        </Show>
      </div>
      <div class="rfoot">
        <button type="button" class="btn primary" disabled={loaded() === undefined || reason() !== undefined || (regions().length === 0 && !stageOnly())} onClick={() => void resolve()}>
          <Icon name="check" />
          Mark resolved <span class="hint">⌘S</span>
        </button>
        <Show when={regions().length > 0}>
          <button type="button" class="btn" onClick={() => void resetFile()}>
            Reset file
          </button>
        </Show>
        <Show when={reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
      </div>
      <Show when={barOperation()}>
        {(current) => (
          <section class="mergebar" aria-label={`Finish the ${operationNoun[current()]}`}>
            <span class="mb-progress">
              <Icon name={barReason() === undefined ? "check" : "merge"} />
              <strong>{current() === "merge" ? progress().label : current() === "rebase" ? (stepLabel(props.session.snapshot()) ?? progress().label) : progress().label}</strong>
            </span>
            <Show when={current() === "rebase" && stepLabel(props.session.snapshot())}>
              <span class="reason">{stepLabel(props.session.snapshot())}</span>
            </Show>
            <Show when={barReason()}>{(text) => <span class="reason" id="merge-commit-reason">{text()}</span>}</Show>
            <span class="spacer" />
            <Show when={current() === "merge"}>
              <TextArea label="Merge message" value={mergeMessage()} minRows={1} maxRows={3} onInput={setMergeMessage} />
            </Show>
            <button type="button" class="btn danger" disabled={busy()} onClick={abortOp}>
              {barButtons()?.abortLabel ?? `Abort ${operationNoun[current()]}`}
            </button>
            <Show when={showSkip()}>
              <button type="button" class="btn" disabled={busy()} onClick={skipOp}>
                Skip
              </button>
            </Show>
            <button
              type="button"
              class="btn primary"
              disabled={barReason() !== undefined}
              aria-describedby={barReason() === undefined ? undefined : "merge-commit-reason"}
              {...(barReason() === undefined ? {} : tip(barReason()!))}
              onClick={continueOp}
            >
              <Icon name="commit" />
              {current() === "merge" ? "Commit merge" : "Continue"}
            </button>
          </section>
        )}
      </Show>
    </section>
  );
}
