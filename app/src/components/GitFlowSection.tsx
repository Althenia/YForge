import { createSignal, For, Show } from "solid-js";
import type { FlowKind } from "../ipc/bindings/FlowKind";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { CONFLICT_NOTICE, finishLabel, finishNote, flowBranchOf, FLOW_KINDS, kindTitle, prefixOf, startLabel, startNote } from "../state/gitFlow";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { countLabel, matchesFilter } from "../state/sidebarModel";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : "The Git Flow command failed");

function StartDialog(props: { kind: FlowKind; prefix: string; note: string; onStart: (name: string) => Promise<string | undefined>; onClose: () => void }) {
  const [name, setName] = createSignal("");
  const [problem, setProblem] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  const submit = async () => {
    if (busy()) return;
    setBusy(true);
    setProblem(await props.onStart(name()));
    setBusy(false);
  };
  return (
    <DialogFrame title={startLabel(props.kind)} onEscape={props.onClose}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label class="field">
          {kindTitle(props.kind)} name
          <input aria-label={`${kindTitle(props.kind)} name`} value={name()} placeholder="name" ref={(input) => queueMicrotask(() => input.focus())} onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <p class="flow-note">{props.note}</p>
        <Show when={name().trim() !== ""}>
          <p class="flow-note ref">
            {props.prefix}
            {name().trim()}
          </p>
        </Show>
        <Show when={problem()}>
          <p class="flow-note error" role="alert">
            {problem()}
          </p>
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" aria-disabled={busy() || name().trim() === ""}>
            Start
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function GitFlowSection(props: { root: string; head: string | undefined; expanded: boolean; onToggle: () => void; filter: string }) {
  const app = useApp();
  const query = useQuery(() => ({ queryKey: repoKeys.read(props.root, "gitflow"), queryFn: () => client.gitFlowConfig(props.root) }));
  const [starting, setStarting] = createSignal<FlowKind | undefined>();
  const [finishing, setFinishing] = createSignal(false);
  const config = () => query.data ?? undefined;
  const flow = () => {
    const current = config();
    return current === undefined ? undefined : flowBranchOf(current, props.head);
  };

  const rows = () => {
    const current = config();
    if (current === undefined) return [];
    const starts = FLOW_KINDS.map((kind) => ({ id: `start:${kind}`, label: startLabel(kind), note: startNote(current, kind), icon: "plus" as const, run: () => setStarting(kind) }));
    const active = flow();
    const finishRows =
      active === undefined
        ? []
        : [{ id: "finish", label: finishLabel(active), note: finishNote(current, active), icon: "merge" as const, run: () => void finish() }];
    return [...starts, ...finishRows];
  };
  const visible = () => rows().filter((row) => matchesFilter(props.filter, row.label, row.note));

  const start = async (kind: FlowKind, name: string): Promise<string | undefined> => {
    try {
      await client.gitFlowStart(props.root, kind, name);
      setStarting(undefined);
      return undefined;
    } catch (failure) {
      return messageOf(failure);
    }
  };

  const finish = async () => {
    if (finishing()) return;
    setFinishing(true);
    try {
      const result = await client.gitFlowFinish(props.root);
      if (result.outcome === "conflicts") app.setNotice(CONFLICT_NOTICE);
    } catch (failure) {
      app.setNotice(messageOf(failure));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Show when={config()} keyed>
      {(current) => (
        <section aria-label="Git Flow">
          <div class="sec">
            <button type="button" class="sec-title" aria-expanded={props.expanded} onClick={() => props.onToggle()}>
              <Icon name="merge" />
              Git Flow
              <span class="sec-chevron" classList={{ collapsed: !props.expanded }}>
                <Icon name="chevron" size={14} />
              </span>
            </button>
            <span class="count">{countLabel(rows().length, visible().length, props.filter !== "")}</span>
          </div>
          <Show when={props.expanded}>
            <For each={visible()}>
              {(row) => (
                <div
                  class="srow flow"
                  role="button"
                  tabindex="0"
                  data-nav={`flow:${row.id}`}
                  aria-label={row.label}
                  aria-disabled={row.id === "finish" && finishing() ? "true" : undefined}
                  title={row.note}
                  style={{ "padding-left": "20px" }}
                  onClick={row.run}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.target === event.currentTarget) {
                      event.preventDefault();
                      row.run();
                    }
                  }}
                >
                  <span class="tree-guide" data-level="0" style={{ "--level": 0 }} aria-hidden="true" />
                  <Icon name={row.icon} size={14} />
                  <span class="name">{row.label}</span>
                </div>
              )}
            </For>
          </Show>
          <Show when={starting()} keyed>
            {(kind) => <StartDialog kind={kind} prefix={prefixOf(current, kind)} note={startNote(current, kind)} onStart={(name) => start(kind, name)} onClose={() => setStarting(undefined)} />}
          </Show>
        </section>
      )}
    </Show>
  );
}
