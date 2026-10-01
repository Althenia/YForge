import { useMutation } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import type { RebasePlan } from "../ipc/bindings/RebasePlan";
import { client, IpcError } from "../ipc/client";
import { beginPointerDrag } from "../state/pointerDrag";
import { historyKeys } from "../state/queryKeys";
import {
  dirtyReason,
  editableMessages,
  moveRow,
  moveRowTo,
  outcomeNotice,
  previewOf,
  pushedRewriteWarning,
  REBASE_ACTIONS,
  rowsOf,
  setAction,
  setMessage,
  stepsOf,
  validate,
  type RebaseAction,
  type RebaseRow,
} from "../state/rebaseModel";
import type { RepoSession } from "../state/repoSession";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { tip } from "./Tooltip";
import { fileRowHeight, spacingPx, VirtualRows } from "./VirtualRows";

type DropAt = { index: number; after: boolean };

const short = (sha: string) => sha.slice(0, 7);

const KEY_ACTIONS: Record<string, RebaseAction> = { p: "pick", r: "reword", s: "squash", f: "fixup", d: "drop", e: "edit" };

const sameOrder = (left: string[], right: string[]) => left.length === right.length && left.every((sha, index) => sha === right[index]);

const isTyping = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

export function RebaseEditor(props: { session: RepoSession; base: string; from: string; onClose: () => void }) {
  const path = props.session.path;
  const plan = useQuery(
    () => ({ queryKey: historyKeys.rebase(path, props.base), queryFn: () => client.rebasePlan(path, props.base), staleTime: Infinity, gcTime: 0, retry: false }),
    () => props.session.queryClient,
  );
  const loaded = () => (plan.error == null ? plan.data : undefined);
  const [rows, setRows] = createSignal<RebaseRow[]>([]);
  const [messages, setMessages] = createSignal<Record<string, string>>({});
  const [dropAt, setDropAt] = createSignal<DropAt | undefined>();
  const [failure, setFailure] = createSignal<IpcError | undefined>();
  let list: HTMLDivElement | undefined;
  let body: HTMLDivElement | undefined;
  let pendingFocus: string | undefined;
  const [tabStop, setTabStop] = createSignal<string | undefined>();
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();

  const messageOf = (row: RebaseRow) => messages()[row.sha] ?? row.summary;
  const check = createMemo(() => {
    const current = loaded();
    return current === undefined ? undefined : validate(rows(), current, messageOf);
  });
  const order = createMemo(() => rows().map((row) => row.sha), [], { equals: sameOrder });
  const byId = createMemo(() => new Map(rows().map((row) => [row.sha, row])));
  const positions = createMemo(() => new Map(order().map((sha, index) => [sha, index])));
  const stopIndex = () => positions().get(tabStop() ?? "") ?? 0;
  const preview = createMemo(() => previewOf(rows(), messageOf));
  const editors = createMemo(() => editableMessages(rows(), messageOf));
  const upstream = () => props.session.snapshot().upstream?.name;
  const warning = () => pushedRewriteWarning(rows(), upstream());

  createEffect(
    on(loaded, (current: RebasePlan | undefined) => {
      if (current === undefined) return;
      setRows(rowsOf(current));
      void Promise.all(
        current.commits.map((commit) =>
          props.session
            .read(["details", commit.sha], () => client.commitDetails(path, commit.sha))
            .then((details): [string, string] => [commit.sha, details.body === "" ? details.summary : `${details.summary}\n\n${details.body}`])
            .catch((error) => {
              props.session.report(error);
              return undefined;
            }),
        ),
      ).then((loadedMessages) => setMessages((known) => ({ ...known, ...Object.fromEntries(loadedMessages.filter((entry) => entry !== undefined)) })));
      const first = order()[0];
      if (first !== undefined) focusRow(first);
    }),
  );

  const apply = useMutation(
    () => ({ mutationFn: () => client.rebaseInteractive(path, props.base, stepsOf(rows(), messageOf)) }),
    () => props.session.queryClient,
  );

  const reason = (): string | undefined => {
    const result = check();
    if (result === undefined) return "Reading the commits…";
    if (result.problems[0] !== undefined) return result.problems[0];
    if (Object.keys(result.rowProblems).length > 0) return "Fix the highlighted commits first";
    if (!result.changed) return "Change an action or reorder a commit first";
    return dirtyReason(props.session.snapshot().counts) ?? (apply.isPending ? "Rewriting…" : undefined);
  };

  async function run(): Promise<void> {
    if (reason() !== undefined) return;
    setFailure(undefined);
    try {
      const result = await apply.mutateAsync();
      await props.session.refresh();
      const notice = outcomeNotice(result, "Interactive rebase");
      if (notice !== undefined) props.session.inform(notice);
      props.onClose();
    } catch (error) {
      setFailure(error instanceof IpcError ? error : new IpcError({ kind: "internal", message: String(error) }));
      await props.session.refresh();
    }
  }

  function focusRow(sha: string): void {
    setTabStop(sha);
    queueMicrotask(() => {
      const element = list?.querySelector<HTMLElement>(`.rrow[data-sha="${sha}"]`);
      if (element !== null && element !== undefined) {
        element.focus();
        return;
      }
      const index = positions().get(sha);
      if (index === undefined) return;
      pendingFocus = sha;
      setReveal((current) => ({ nonce: (current?.nonce ?? 0) + 1, index }));
    });
  }

  const mountRow = (sha: string, element: HTMLElement, measure: (element: Element | null) => void) => {
    measure(element);
    if (pendingFocus !== sha) return;
    pendingFocus = undefined;
    queueMicrotask(() => element.focus());
  };

  const move = (sha: string, delta: -1 | 1) => {
    setRows(moveRow(rows(), sha, delta));
    focusRow(sha);
  };

  const dropTarget = (x: number, y: number): DropAt | undefined => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>(".rrow");
    if (row === null || row === undefined || !list?.contains(row)) return undefined;
    const rect = row.getBoundingClientRect();
    return { index: Number(row.dataset.index), after: y > rect.top + rect.height / 2 };
  };

  const startDrag = (event: PointerEvent, sha: string) => {
    beginPointerDrag<DropAt>(event, {
      hit: dropTarget,
      mark: setDropAt,
      drop: (target) => {
        const from = positions().get(sha) ?? 0;
        const insertion = target.index + (target.after ? 1 : 0);
        setRows(moveRowTo(rows(), sha, insertion > from ? insertion - 1 : insertion));
        focusRow(sha);
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(".rrow") : null;
    const sha = row?.dataset.sha;
    if (row === null || sha === undefined || isTyping(event.target)) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(sha, event.key === "ArrowUp" ? -1 : 1);
    } else if (!event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const next = order()[(positions().get(sha) ?? 0) + (event.key === "ArrowUp" ? -1 : 1)];
      if (next !== undefined) focusRow(next);
    } else if (!event.altKey && !event.metaKey && !event.ctrlKey && KEY_ACTIONS[event.key.toLowerCase()] !== undefined) {
      event.preventDefault();
      setRows(setAction(rows(), sha, KEY_ACTIONS[event.key.toLowerCase()] as RebaseAction));
    }
  };

  return (
    <section
      class="panel rpanel"
      aria-label="Interactive rebase"
      aria-busy={apply.isPending}
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !isTyping(event.target)) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="rhead">
        <Icon name="rebase" />
        <span>Edit history</span>
        <span class="mono">{short(props.base)}..HEAD</span>
        <Show when={loaded()}>{(current) => <span class="dim">{current().commits.length} {current().commits.length === 1 ? "commit" : "commits"}</span>}</Show>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody" ref={body}>
        <Show when={plan.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {error() instanceof Error ? (error() as Error).message : String(error())}
            </div>
          )}
        </Show>
        <Show when={warning()}>
          {(text) => (
            <div class="note attention" role="status">
              <Icon name="warning" /> {text()}
            </div>
          )}
        </Show>
        <For each={check()?.problems ?? []}>
          {(text) => (
            <div class="note danger" role="alert">
              {text}
            </div>
          )}
        </For>
        <Show when={check()?.dropsAll}>
          <div class="note attention" role="status">
            <Icon name="warning" /> Every commit is dropped. The branch moves back to {short(props.base)}. Undo restores it.
          </div>
        </Show>
        <p class="setting-note">
          Newest first. Each commit is combined with the one below it when you choose Squash or Fixup. Drag a handle, or use <span class="kbd">⌥↑</span> <span class="kbd">⌥↓</span>, to reorder; press <span class="kbd">P</span> <span class="kbd">R</span> <span class="kbd">S</span> <span class="kbd">F</span> <span class="kbd">D</span> <span class="kbd">E</span> to set the action.
        </p>
        <div
          ref={list}
          onKeyDown={onKeyDown}
          onFocusIn={(event) => {
            const sha = event.target.closest<HTMLElement>(".rrow")?.dataset.sha;
            if (sha !== undefined) setTabStop(sha);
          }}
        >
          <VirtualRows as="ol" class="rlist" attrs={{ "aria-label": "Commits, newest first" }} items={order()} scroller={() => body} estimate={fileRowHeight()} gap={spacingPx("1")} keepIndex={stopIndex()} reveal={reveal()} measured>
            {(sha, virtual) => {
              const row = () => byId().get(sha) as RebaseRow;
              return (
                <li
                  class="rrow"
                  classList={{ dropped: row().action === "drop", "drop-before": dropAt()?.index === virtual.index && dropAt()?.after === false, "drop-after": dropAt()?.index === virtual.index && dropAt()?.after === true, invalid: check()?.rowProblems[sha] !== undefined }}
                  data-sha={sha}
                  data-index={virtual.index}
                  aria-posinset={virtual.index + 1}
                  aria-setsize={order().length}
                  tabindex={virtual.index === stopIndex() ? 0 : -1}
                  ref={(element) => mountRow(sha, element, virtual.measure)}
                  style={virtual.style}
                >
                  <button type="button" class="icon-btn dense rgrip" tabindex="-1" {...tip("Drag to reorder", "⌥↑ ⌥↓", `Drag ${row().summary} to reorder`)} onPointerDown={(event) => startDrag(event, sha)}>
                    <Icon name="grip" />
                  </button>
                  <span class="rsha ref">{short(sha)}</span>
                  <span class="rsum" title={row().summary}>
                    {row().summary}
                  </span>
                  <Show when={row().pushed}>
                    <span class="chip chip-pushed" title="Already on the upstream">
                      <Icon name="push" size={14} />
                      Pushed
                    </span>
                  </Show>
                  <Select
                    label={`Action for ${row().summary}`}
                    value={row().action}
                    options={REBASE_ACTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
                    onChange={(value) => setRows(setAction(rows(), sha, value as RebaseAction))}
                  />
                  <button type="button" class="icon-btn dense" disabled={virtual.index === 0} title={virtual.index === 0 ? "Already the newest commit" : undefined} {...tip("Move up", "⌥↑", `Move ${row().summary} up`)} onClick={() => move(sha, -1)}>
                    <Icon name="previous" />
                  </button>
                  <button type="button" class="icon-btn dense" disabled={virtual.index === order().length - 1} title={virtual.index === order().length - 1 ? "Already the oldest commit" : undefined} {...tip("Move down", "⌥↓", `Move ${row().summary} down`)} onClick={() => move(sha, 1)}>
                    <Icon name="next" />
                  </button>
                  <Show when={editors()[sha] !== undefined}>
                    <label class="input area rmessage">
                      <textarea
                        aria-label={`Message for ${short(sha)}`}
                        spellcheck={false}
                        value={editors()[sha]}
                        onInput={(event) => setRows(setMessage(rows(), sha, event.currentTarget.value))}
                      />
                    </label>
                  </Show>
                  <Show when={check()?.rowProblems[sha]}>{(text) => <span class="row-problem field-note error">{text()}</span>}</Show>
                </li>
              );
            }}
          </VirtualRows>
        </div>
        <section class="rpreview" aria-label="Resulting history">
          <h4>Resulting history · {preview().commits.length} {preview().commits.length === 1 ? "commit" : "commits"}</h4>
          <VirtualRows as="ol" items={preview().commits} scroller={() => body} estimate={fileRowHeight()} gap={spacingPx("1")} measured>
            {(commit, virtual) => (
              <li ref={virtual.measure} style={virtual.style}>
                <Icon name={commit.kind === "combined" ? "squash" : commit.kind === "reworded" ? "edit" : "commit"} />
                <span class="rsum">{commit.subject}</span>
                <span class="ref">{commit.from.map(short).join(" + ")}</span>
                <Show when={commit.kind !== "kept"}>
                  <span class="chip">{commit.kind === "combined" ? "Combined" : "Reworded"}</span>
                </Show>
                <Show when={commit.stops}>
                  <span class="chip chip-attention">
                    <Icon name="warning" size={14} />
                    Stops here so you can amend it
                  </span>
                </Show>
              </li>
            )}
          </VirtualRows>
          <Show when={preview().dropped.length > 0}>
            <h4>Dropped ({preview().dropped.length})</h4>
            <VirtualRows as="ul" class="rdropped" items={preview().dropped} scroller={() => body} estimate={fileRowHeight()} gap={spacingPx("1")} measured>
              {(row, virtual) => (
                <li ref={virtual.measure} style={virtual.style}>
                  <Icon name="trash" />
                  <span class="rsum">{row.summary}</span>
                  <span class="ref">{short(row.sha)}</span>
                </li>
              )}
            </VirtualRows>
          </Show>
        </section>
      </div>
      <div class="rfoot">
        <button type="button" class="btn primary" disabled={reason() !== undefined} onClick={() => void run()}>
          <Icon name="rebase" />
          Rewrite history
        </button>
        <button type="button" class="btn" onClick={props.onClose}>
          Cancel
        </button>
        <Show when={failure()}>
          {(error) => (
            <span class="field-note error" role="alert">
              {error().message}
              <Show when={error().output}>{(output) => <pre class="out">{output()}</pre>}</Show>
            </span>
          )}
        </Show>
        <Show when={!failure() && reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
      </div>
    </section>
  );
}
