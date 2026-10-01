import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";
import type { ConflictRegionProposal } from "../ipc/bindings/ConflictRegionProposal";
import { client, IpcError } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { createAiRun } from "../state/aiRun";
import { conflictDescription, conflictSides } from "../state/operationModel";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import {
  choiceLabel,
  choose,
  draftLines,
  initialState,
  isManual,
  markResolvedReason,
  regionLines,
  regionsOf,
  resolverCommand,
  resultLines,
  resultText,
  step,
  takeAll,
  unresolvedCount,
  type Choice,
  type ResolverState,
} from "../state/resolverModel";
import { MenuLabel } from "./ContextMenu";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { VirtualRows } from "./VirtualRows";

const RESULT_LINE_HEIGHT = 20;

const blocks: { choice: Choice; label: string; hint?: string }[] = [
  { choice: "current", label: "Take current", hint: "1" },
  { choice: "incoming", label: "Take incoming", hint: "2" },
  { choice: "current_incoming", label: "Take both (current first)", hint: "3" },
  { choice: "incoming_current", label: "Take both (incoming first)" },
];

function PaneText(props: { lines: string[] }) {
  return (
    <Show when={props.lines.length > 0} fallback={<pre class="empty-lines">(no lines)</pre>}>
      <pre>{props.lines.join("\n")}</pre>
    </Show>
  );
}

export function ConflictResolver(props: { session: RepoSession; file: string; onClose: () => void; onOpenAiSettings: () => void }) {
  const path = props.session.path;
  const conflict = useQuery(() => ({
    queryKey: repoKeys.conflict(path, props.file),
    queryFn: () => client.conflictFile(path, props.file),
    placeholderData: keepPreviousData,
    gcTime: 0,
  }));
  const [state, setState] = createSignal<ResolverState>({ choices: [], active: 0 });
  const [draft, setDraft] = createSignal<string | undefined>();
  const [proposals, setProposals] = createSignal<Record<number, ConflictRegionProposal>>({});
  const proposer = createAiRun(props.session.queryClient, (id) => client.aiProposeConflict(path, id, props.file));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  let root: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();

  const sides = () => conflictSides(props.session.snapshot());
  const loaded = () => (conflict.error == null ? conflict.data : undefined);
  const failure = () => (conflict.error instanceof IpcError ? conflict.error.message : conflict.error == null ? undefined : String(conflict.error));
  const regions = () => {
    const file = loaded();
    return file === undefined ? [] : regionsOf(file);
  };
  const active = () => regions()[state().active];
  const position = () => `conflict ${state().active + 1} of ${regions().length}`;
  const lines = () => {
    const file = loaded();
    return file === undefined ? [] : resultLines(file, state(), { current: sides().current.name, incoming: sides().incoming.name });
  };
  const reason = () => (regions().length === 0 ? undefined : (markResolvedReason(state()) ?? (draft() === undefined ? undefined : "Apply or cancel the edit first")));
  const stageOnly = () => {
    const file = loaded();
    return file !== undefined && regions().length === 0 && !file.binary && file.sides.current && file.sides.incoming;
  };
  const resolvedCount = () => regions().length - unresolvedCount(state());

  createEffect(
    on(loaded, (file) => {
      if (file === undefined) return;
      setState(initialState(file));
      setDraft(undefined);
      setProposals({});
    }),
  );

  const activeIndex = createMemo(() => state().active);
  createEffect(
    on(
      activeIndex,
      (region) => {
        const first = lines().findIndex((line) => line.region === region);
        if (first >= 0) setReveal((current) => ({ nonce: (current?.nonce ?? 0) + 1, index: first }));
      },
      { defer: true },
    ),
  );

  const apply = (choice: Choice) => {
    setState(choose(state(), state().active, choice));
    setDraft(undefined);
    dropProposal(state().active);
  };

  const dropProposal = (index: number) =>
    setProposals((current) => Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index)));

  const propose = async () => {
    const result = await proposer.start();
    if (result === undefined) return;
    setProposals(Object.fromEntries(result.regions.map((region) => [region.index, region])));
  };

  const activeProposal = () => proposals()[state().active];
  const proposalCount = () => Object.keys(proposals()).length;

  const startEdit = () => {
    const region = active();
    if (region === undefined) return;
    const proposal = activeProposal();
    const current = state().choices[state().active];
    setDraft(proposal === undefined ? regionLines(region, current ?? "current_incoming").join("\n") : proposal.text);
  };

  const applyEdit = () => {
    const text = draft();
    if (text !== undefined) apply({ manual: draftLines(text) });
  };

  const cancelEdit = () => {
    setDraft(undefined);
    root?.focus();
  };

  const resolve = () => {
    const file = loaded();
    if (file === undefined || reason() !== undefined) return;
    const content = regions().length === 0 ? undefined : resultText(file, state());
    void props.session.mutate(() => (content === undefined ? client.markResolved(path, [props.file]) : client.conflictResolve(path, props.file, content)));
  };

  const useSide = (side: ConflictSide) => void props.session.mutate(() => client.conflictTakeSide(path, props.file, side));

  const resetFile = async () => {
    if (!(await props.session.mutate(() => client.conflictReset(path, props.file)))) return;
    const { data: file } = await conflict.refetch();
    if (file !== undefined) {
      setState(initialState(file));
      setDraft(undefined);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && draft() !== undefined) {
      event.preventDefault();
      cancelEdit();
      return;
    }
    const command = resolverCommand(event);
    if (command === undefined) return;
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    if (typing && command.kind !== "save") return;
    event.preventDefault();
    if (command.kind === "save") resolve();
    else if (regions().length === 0) return;
    else if (command.kind === "choose") apply(command.choice);
    else if (command.kind === "edit") startEdit();
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

  return (
    <section class="panel rpanel" aria-label="Conflict resolver" aria-busy={conflict.isFetching} tabindex="-1" ref={(element) => {
      root = element;
      queueMicrotask(() => element.focus());
    }} onKeyDown={onKeyDown}>
      <div class="rhead">
        <span class="mono">{props.file}</span>
        <Show when={regions().length > 0}>
          <span class="dim">·</span>
          <span class="dim">{position()}</span>
        </Show>
        <span class="dim">·</span>
        <span class="dim">
          <MenuLabel parts={conflictDescription(props.session.snapshot())} />
        </span>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody" ref={body}>
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
              <div class="rtool" role="toolbar" aria-label="Conflict navigation">
                <button type="button" class="icon-btn dense" {...tip("Previous conflict", "P")} onClick={() => setState(step(state(), -1))}>
                  <Icon name="previous" />
                </button>
                <button type="button" class="icon-btn dense" {...tip("Next conflict", "N")} onClick={() => setState(step(state(), 1))}>
                  <Icon name="next" />
                </button>
                <span class="reason" role="status" aria-live="polite">
                  {resolvedCount()} of {regions().length} resolved
                  <Show when={proposalCount() > 0}> · {proposalCount()} {proposalCount() === 1 ? "proposal" : "proposals"} to review</Show>
                </span>
                <span class="spacer" />
                <Show when={featureAvailable(features.data, "conflict_fix") || proposer.running()}>
                  <Show
                    when={proposer.running()}
                    fallback={
                      <button type="button" class="btn sm" title="Ask your AI provider for a resolution of every conflict in this file. Nothing changes until you accept one." onClick={() => void propose()}>
                        <Icon name="wand" size={14} />
                        Propose resolution
                      </button>
                    }
                  >
                    <button type="button" class="btn sm" aria-busy="true" disabled>
                      <Icon name="wand" size={14} />
                      Proposing…
                    </button>
                    <button type="button" class="icon-btn dense" {...tip("Cancel proposing")} onClick={proposer.cancel}>
                      <Icon name="close" size={14} />
                    </button>
                  </Show>
                </Show>
                <button type="button" class="btn sm" onClick={() => setState(takeAll(state(), "current"))}>
                  Take all current
                </button>
                <button type="button" class="btn sm" onClick={() => setState(takeAll(state(), "incoming"))}>
                  Take all incoming
                </button>
              </div>
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
              <Show when={active()}>
                {(region) => (
                  <>
                    <div class="panes">
                      <div class="cpane lane-0">
                        <div class="chead">
                          <span>
                            Current · <span class="mono">{sides().current.name}</span> · <span class="role">{sides().current.role}</span>
                          </span>
                        </div>
                        <PaneText lines={region().current} />
                      </div>
                      <div class="cpane lane-1">
                        <div class="chead">
                          <span>
                            Incoming · <span class="mono">{sides().incoming.name}</span> · <span class="role">{sides().incoming.role}</span>
                          </span>
                        </div>
                        <PaneText lines={region().incoming} />
                      </div>
                    </div>
                    <Show when={region().base}>
                      {(base) => (
                        <details class="cbase">
                          <summary>Show base</summary>
                          <PaneText lines={base()} />
                        </details>
                      )}
                    </Show>
                    <Show when={activeProposal()}>
                      {(proposal) => (
                        <section class="proposal" aria-label={`Proposed resolution of ${position()}`}>
                          <div class="chead">
                            <Icon name="wand" size={14} />
                            <span>Proposed resolution · draft from your AI provider</span>
                          </div>
                          <p class="proposal-why">{proposal().rationale}</p>
                          <PaneText lines={draftLines(proposal().text)} />
                          <div class="hrow">
                            <button type="button" class="btn sm primary" onClick={() => apply({ manual: draftLines(proposal().text) })}>
                              <Icon name="check" size={14} />
                              Accept
                            </button>
                            <button type="button" class="btn sm" onClick={startEdit}>
                              <Icon name="edit" size={14} />
                              Edit
                            </button>
                            <button type="button" class="btn sm" onClick={() => dropProposal(state().active)}>
                              <Icon name="close" size={14} />
                              Reject
                            </button>
                          </div>
                        </section>
                      )}
                    </Show>
                    <div class="actions" role="group" aria-label={`Conflict ${state().active + 1} of ${regions().length}`}>
                      <For each={blocks}>
                        {(block) => (
                          <button type="button" class="btn sm" aria-pressed={state().choices[state().active] === block.choice} onClick={() => apply(block.choice)}>
                            {block.label}
                            <Show when={block.hint}>{(hint) => <span class="hint">{hint()}</span>}</Show>
                          </button>
                        )}
                      </For>
                      <button type="button" class="btn sm" aria-pressed={isManual(state().choices[state().active])} onClick={startEdit}>
                        <Icon name="edit" size={14} />
                        Edit <span class="hint">E</span>
                      </button>
                      <span class="state" classList={{ unresolved: state().choices[state().active] === undefined }}>
                        {state().choices[state().active] === undefined ? "! " : "✓ "}
                        {choiceLabel(state().choices[state().active])}
                      </span>
                    </div>
                    <Show when={draft() !== undefined}>
                      <div class="editor">
                        <label class="input area mtext">
                          <textarea
                            aria-label={`Edit the result of ${position()}`}
                            spellcheck={false}
                            value={draft()}
                            onInput={(event) => setDraft(event.currentTarget.value)}
                            ref={(element) => queueMicrotask(() => element.focus())}
                          />
                        </label>
                        <div class="hrow">
                          <button type="button" class="btn sm primary" onClick={applyEdit}>
                            Apply edit
                          </button>
                          <button type="button" class="btn sm" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
              <div class="cpane result">
                <div class="chead">Result</div>
                <div class="lines" role="group" aria-label="Result">
                  <VirtualRows as="div" items={lines()} scroller={() => body} estimate={RESULT_LINE_HEIGHT} reveal={reveal()} measured>
                    {(line, row) => (
                      <div
                        class="rline"
                        classList={{ active: line.region === state().active, unresolved: line.region !== undefined && state().choices[line.region] === undefined }}
                        data-region={line.region}
                        ref={row.measure}
                        style={row.style}
                        onClick={() => line.region !== undefined && setState({ ...state(), active: line.region })}
                      >
                        <span class="ln" aria-hidden="true">{line.number}</span>
                        <span class="gl" classList={{ src: line.gutter === "C" || line.gutter === "I" }} aria-hidden="true">{line.gutter}</span>
                        <span>{line.text}</span>
                      </div>
                    )}
                  </VirtualRows>
                </div>
              </div>
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
    </section>
  );
}
