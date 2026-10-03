import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, Index, on, Show } from "solid-js";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { ConflictRegionProposal } from "../ipc/bindings/ConflictRegionProposal";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";
import { client, IpcError } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { createAiRun } from "../state/aiRun";
import { createExternalTools } from "../state/externalTools";
import { filesIn } from "../state/changes";
import { conflictDescription, conflictSides } from "../state/operationModel";
import { repoKeys } from "../state/queryKeys";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import {
  assemble,
  choose,
  hasSide,
  initialState,
  markResolvedReason,
  markerCount,
  mergeProgress,
  regionsOf,
  resolverCommand,
  savedContent,
  sideState,
  step,
  toggleAll,
  toggleSide,
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

const sideNames: Record<ConflictSide, { title: string; word: string }> = {
  current: { title: "Yours", word: "yours" },
  incoming: { title: "Theirs", word: "theirs" },
};

export function ConflictResolver(props: { session: RepoSession; actions: RepoActions; file: string; onClose: () => void; onOpenAiSettings: () => void }) {
  const path = props.session.path;
  const conflict = useQuery(() => ({
    queryKey: repoKeys.conflict(path, props.file),
    queryFn: () => client.conflictFile(path, props.file),
    placeholderData: keepPreviousData,
    gcTime: 0,
  }));
  const [state, setState] = createSignal<ResolverState>({ choices: [], active: 0 });
  const [output, setOutput] = createSignal<OutputState>({ text: "", starts: undefined, edited: false });
  const [undo, setUndo] = createSignal<{ output: OutputState; state: ResolverState } | undefined>();
  const [restore, setRestore] = createSignal<OutputState | undefined>();
  const [rationales, setRationales] = createSignal<ConflictRegionProposal[]>([]);
  const proposer = createAiRun(props.session.queryClient, (id) => client.aiProposeConflict(path, id, props.file));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const tools = createExternalTools(props.session);
  const reloadConflict = () => void props.session.queryClient.invalidateQueries({ queryKey: repoKeys.conflict(path, props.file) });
  const panes: Partial<Record<ConflictSide, HTMLDivElement>> = {};
  let outBody: HTMLDivElement | undefined;
  let gutter: HTMLPreElement | undefined;

  const sides = () => conflictSides(props.session.snapshot());
  const labels = () => ({ current: sides().current.name, incoming: sides().incoming.name });
  const loaded = () => (conflict.error == null ? conflict.data : undefined);
  const failure = () => (conflict.error instanceof IpcError ? conflict.error.message : conflict.error == null ? undefined : String(conflict.error));
  const regions = () => {
    const file = loaded();
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

  const merging = () => props.session.snapshot().operation === "merge";
  const progress = () =>
    mergeProgress({
      conflicted: filesIn(props.session.snapshot().files, "conflicted").length,
      resolved: props.session.snapshot().operation_detail?.resolved.length ?? 0,
      busy: props.actions.operationBusy(),
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
  };

  createEffect(on(loaded, (file) => file !== undefined && load(file)));

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
    if (file === undefined || result === undefined || result.regions.length === 0) return;
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

  const activeIndex = createMemo(() => state().active);
  createEffect(
    on(
      activeIndex,
      (index) => {
        for (const pane of Object.values(panes)) pane?.querySelector(`.mt-hunk[data-region="${index}"]`)?.scrollIntoView({ block: "nearest" });
        const line = output().starts?.[index];
        const area = outBody?.querySelector("textarea");
        if (line !== undefined && area != null) area.scrollTop = line * OUTPUT_LINE_HEIGHT;
      },
      { defer: true },
    ),
  );

  const syncGutter = (event: Event) => {
    const area = event.target;
    if (area instanceof HTMLTextAreaElement && gutter !== undefined && gutter.scrollTop !== area.scrollTop) gutter.scrollTop = area.scrollTop;
  };

  const resolve = () => {
    const file = loaded();
    if (file === undefined || reason() !== undefined) return;
    if (regions().length === 0 && !stageOnly()) return;
    const content = regions().length === 0 ? undefined : savedContent(file, output().text);
    void props.session.mutate(() => (content === undefined ? client.markResolved(path, [props.file]) : client.conflictResolve(path, props.file, content)));
  };

  const useSide = (side: ConflictSide) => void props.session.mutate(() => client.conflictTakeSide(path, props.file, side));

  const resetFile = async () => {
    if (!(await props.session.mutate(() => client.conflictReset(path, props.file)))) return;
    const { data: file } = await conflict.refetch();
    if (file !== undefined) load(file);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const command = resolverCommand(event);
    if (command === undefined) return;
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    if (typing && command.kind !== "save") return;
    event.preventDefault();
    if (command.kind === "save") resolve();
    else if (regions().length === 0) return;
    else if (command.kind === "choose") rebuild(choose(state(), state().active, command.choice));
    else setState(step(state(), command.kind === "next" ? 1 : -1));
  };

  const wholeFileNote = () => {
    const file = loaded();
    if (file === undefined) return undefined;
    if (file.binary) return "This is a binary file. Choose which version to keep.";
    if (!file.sides.current) return `${sides().current.name} deleted this file while the other side changed it. Keep the change or accept the deletion.`;
    if (!file.sides.incoming) return `${sides().incoming.name} deleted this file while the other side changed it. Keep the change or accept the deletion.`;
    return "No conflict markers remain in this file. Mark it resolved to stage its current content.";
  };

  const Pane = (paneProps: { side: ConflictSide; file: ConflictFile }) => {
    const names = sideNames[paneProps.side];
    const allState = () => sideState(state(), paneProps.side);
    const segments = () => {
      let index = 0;
      return paneProps.file.segments.map((segment) => (segment.kind === "text" ? { lines: segment.lines, region: undefined } : { lines: segment[paneProps.side], region: index++ }));
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
            title={allState() === "true" ? `Clear every ${names.word} block in this file` : `Use every ${names.word} block in this file`}
            onClick={() => rebuild(toggleAll(state(), paneProps.side))}
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
        <div class="mt-code" ref={(element) => (panes[paneProps.side] = element)}>
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
                  const on = () => hasSide(state().choices[region()], paneProps.side);
                  return (
                    <div class="mt-hunk" classList={{ "is-cur": state().active === region(), "is-on": on() }} data-region={region()}>
                      <button
                        type="button"
                        role="checkbox"
                        class="mt-check"
                        aria-checked={on()}
                        aria-label={`Use ${names.word} for conflict ${region() + 1}`}
                        data-region={region()}
                        onClick={() => rebuild(toggleSide(state(), region(), paneProps.side))}
                      >
                        <span class="mt-box" aria-hidden="true">
                          <Show when={on()}>
                            <Icon name="check" size={14} />
                          </Show>
                        </span>
                        Use {names.word}
                      </button>
                      <Show when={segment().lines.length > 0} fallback={<pre class="mt-lines empty-lines">(no lines)</pre>}>
                        <pre class="mt-lines">{segment().lines.join("\n")}</pre>
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
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody">
        <Show when={failure()}>{(message) => <div class="graph-error" role="alert">{message()}</div>}</Show>
        <Show when={loaded()}>
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
                        <button type="button" class="btn sm" onClick={props.onOpenAiSettings}>
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
                  <details class="cbase">
                    <summary>Show base of conflict {state().active + 1}</summary>
                    <pre>{base().join("\n")}</pre>
                  </details>
                )}
              </Show>
              <section class="mt-out" aria-label="Output">
                <div class="out-h">
                  <span class="out-title">
                    <strong>Output</strong> <span class="dim">Exactly what will be saved. Type to edit; unresolved parts show Git's conflict markers.</span>
                  </span>
                  <span class="out-state" classList={{ warn: left() > 0, ok: left() === 0 }} role="status">
                    <Icon name={left() > 0 ? "warning" : "check"} size={14} />
                    {left() > 0 ? `${left()} ${left() === 1 ? "conflict" : "conflicts"} left` : "No conflicts left"}
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
        <button type="button" class="btn primary" disabled={loaded() === undefined || reason() !== undefined || (regions().length === 0 && !stageOnly())} onClick={resolve}>
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
      <Show when={merging()}>
        <section class="mergebar" aria-label="Finish the merge">
          <span class="mb-progress">
            <Icon name={progress().commitReason === undefined ? "check" : "merge"} />
            <strong>{progress().label}</strong>
          </span>
          <Show when={progress().commitReason}>{(text) => <span class="reason" id="merge-commit-reason">{text()}</span>}</Show>
          <span class="spacer" />
          <button type="button" class="btn danger" disabled={props.actions.operationBusy()} onClick={props.actions.abortOperation}>
            Abort merge
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={progress().commitReason !== undefined}
            aria-describedby={progress().commitReason === undefined ? undefined : "merge-commit-reason"}
            title={progress().commitReason}
            onClick={() => void props.actions.continueOperation(null)}
          >
            <Icon name="commit" />
            Commit merge
          </button>
        </section>
      </Show>
    </section>
  );
}
