import { useMutation } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createComputed, createMemo, createSignal, For, on, Show } from "solid-js";
import type { RecomposeGroup } from "../ipc/bindings/RecomposeGroup";
import { client, IpcError } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { createAiRun } from "../state/aiRun";
import { fileList } from "../state/fileList";
import { historyKeys } from "../state/queryKeys";
import { dirtyReason, PUSHED_REWRITE_NOTICE } from "../state/rebaseModel";
import { catalogOf, describeGroup, fromGroups, groupsOf, problemsOf, progressOf, type Draft } from "../state/recomposeModel";
import type { RepoSession } from "../state/repoSession";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { tip } from "./Tooltip";

const short = (sha: string) => sha.slice(0, 7);

const UPSTREAM = "upstream";

const PROPOSE_LABEL = "Propose a grouping of these changes into commits";

const isTyping = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

type Plan = { draft: Draft; withheld: string[] };

export function RecomposeView(props: { session: RepoSession; base: string | undefined; onClose: () => void; onOpenAiSettings: () => void }) {
  const path = props.session.path;
  const snapshot = () => props.session.snapshot();
  const upstream = () => snapshot().upstream?.name;
  const upstreamRef = () => {
    const name = upstream();
    return name === undefined ? undefined : `${snapshot().remote_branches.includes(name) ? "refs/remotes" : "refs/heads"}/${name}`;
  };
  const [choice, setChoice] = createSignal<string | undefined>(props.base ?? (upstream() === undefined ? undefined : UPSTREAM));
  const baseRef = () => (choice() === UPSTREAM ? upstreamRef() : choice());
  const choices = useQuery(
    () => ({ queryKey: historyKeys.baseChoices(path), queryFn: () => client.repoGraph(path, 0, 100), staleTime: Infinity, gcTime: 0 }),
    () => props.session.queryClient,
  );
  const chain = createMemo(() => {
    const rows = new Map((choices.data?.rows ?? []).flatMap((row) => (row.sha === null ? [] : [[row.sha, row] as const])));
    const found: Array<{ sha: string; summary: string }> = [];
    const head = snapshot().head;
    let next: string | undefined = head.kind === "unborn" ? undefined : head.sha;
    while (next !== undefined && rows.has(next)) {
      const row = rows.get(next);
      if (row === undefined) break;
      found.push({ sha: next, summary: row.summary });
      next = row.parents[0];
    }
    return found.slice(1);
  });

  const preview = useQuery(
    () => ({ queryKey: historyKeys.recompose(path, baseRef() ?? ""), queryFn: () => client.recomposePreview(path, baseRef() as string), enabled: baseRef() !== undefined, staleTime: Infinity, gcTime: 0, retry: false }),
    () => props.session.queryClient,
  );
  const loaded = () => (preview.error == null ? preview.data : undefined);
  const catalog = createMemo(() => (loaded() === undefined ? [] : catalogOf(loaded() as NonNullable<ReturnType<typeof loaded>>)));
  const headSha = () => {
    const head = snapshot().head;
    return head.kind === "unborn" ? "" : head.sha;
  };
  const planKey = createMemo(() => {
    const current = loaded();
    const base = baseRef();
    return current === undefined || base === undefined ? undefined : `${base}|${headSha()}|${current.base}|${current.head}`;
  });

  const [stored, setStored] = createSignal<Plan | undefined>();
  const [lateDiscard, setLateDiscard] = createSignal(false);
  const [failure, setFailure] = createSignal<IpcError | undefined>();
  let generation = 0;
  let request = 0;
  createComputed(
    on(
      planKey,
      () => {
        generation += 1;
        if (stored() === undefined) return;
        setStored(undefined);
        setLateDiscard(true);
      },
      { defer: true },
    ),
  );
  const plan = () => stored();
  const discarded = lateDiscard;
  const problems = createMemo(() => {
    const current = plan();
    return current === undefined ? undefined : problemsOf(current.draft, catalog());
  });
  const progress = createMemo(() => {
    const current = plan();
    return current === undefined ? undefined : progressOf(current.draft, catalog());
  });

  const proposer = createAiRun(props.session.queryClient, (id) => client.aiProposeRecompose(path, id, baseRef() as string));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const apply = useMutation(
    () => ({ mutationFn: (groups: RecomposeGroup[]) => client.recomposeApply(path, baseRef() as string, groups) }),
    () => props.session.queryClient,
  );
  const proposeBlock = () => (apply.isPending ? "Recomposing…" : loaded() === undefined ? "Loading the changes…" : catalog().length === 0 ? "There are no changes in this range" : undefined);

  async function propose(): Promise<void> {
    if (planKey() === undefined || proposeBlock() !== undefined) return;
    const issuedGeneration = generation;
    request += 1;
    const issuedRequest = request;
    setLateDiscard(false);
    const proposal = await proposer.start();
    if (proposal === undefined || issuedRequest !== request) return;
    if (issuedGeneration !== generation) {
      setLateDiscard(true);
      return;
    }
    setStored({ draft: fromGroups(proposal.groups, catalog()), withheld: proposal.excluded });
  }

  function cancelProposal(): void {
    request += 1;
    proposer.cancel();
  }

  const reason = (): string | undefined => {
    if (loaded() === undefined) return preview.error == null ? (baseRef() === undefined ? "Choose a base first" : "Reading the changes…") : "The changes could not be read";
    const current = plan();
    const found = problems();
    const index = current === undefined || found === undefined ? -1 : current.draft.groups.findIndex((group) => found.groups[group.id] !== undefined);
    const group = current?.draft.groups[index];
    return (
      dirtyReason(snapshot().counts) ??
      (proposer.running() ? "Proposing a plan…" : undefined) ??
      (current === undefined ? "Propose a plan with AI first" : undefined) ??
      found?.general[0] ??
      (group === undefined ? undefined : `Commit ${index + 1}: ${found?.groups[group.id]}`) ??
      (apply.isPending ? "Recomposing…" : undefined)
    );
  };

  async function run(): Promise<void> {
    const current = plan();
    if (reason() !== undefined || current === undefined) return;
    setFailure(undefined);
    try {
      const result = await apply.mutateAsync(groupsOf(current.draft, catalog()));
      await props.session.refresh();
      if (result.pushed) props.session.inform(PUSHED_REWRITE_NOTICE);
      props.onClose();
    } catch (error) {
      setFailure(error instanceof IpcError ? error : new IpcError({ kind: "internal", message: String(error) }));
      await props.session.refresh();
    }
  }

  const baseLabel = () => {
    const base = baseRef();
    return base === undefined ? "the base" : short(base.startsWith("refs/") ? (upstream() ?? base) : base);
  };

  return (
    <section class="panel rpanel recompose" aria-label="Recompose" aria-busy={apply.isPending} tabindex="-1" onKeyDown={(event) => event.key === "Escape" && !isTyping(event.target) && props.onClose()}>
      <div class="rhead">
        <Icon name="recompose" />
        <span>Recompose</span>
        <Show when={baseRef()}>{(base) => <span class="mono">{short(base().startsWith("refs/") ? (upstream() ?? base()) : base())}..HEAD</span>}</Show>
        <Show when={loaded()}>{(current) => <span class="dim">{current().files.length} {current().files.length === 1 ? "file" : "files"}</span>}</Show>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody">
        <div class="rtool" role="toolbar" aria-label="Recompose tools">
          <label class="base-pick">
            <span class="field-label">Base</span>
            <Select
              label="Base"
              value={choice() ?? ""}
              options={[
                ...(choice() === undefined ? [{ value: "", label: "Choose a base…" }] : []),
                ...(upstream() === undefined ? [] : [{ value: UPSTREAM, label: `Upstream · ${upstream()}` }]),
                ...(props.base !== undefined && !chain().some((entry) => entry.sha === props.base)
                  ? [{ value: props.base as string, label: `${short(props.base as string)} · chosen commit` }]
                  : []),
                ...chain().map((entry) => ({ value: entry.sha, label: `${short(entry.sha)} · ${entry.summary}` })),
              ]}
              disabled={apply.isPending}
              disabledReason={apply.isPending ? "Recomposing…" : undefined}
              onChange={(value) => setChoice(value === "" ? undefined : value)}
            />
          </label>
          <Show when={progress()}>
            {(counted) => (
              <span class="reason" role="status" aria-live="polite">
                {counted().assigned} of {counted().total} changes in the plan
              </span>
            )}
          </Show>
          <span class="spacer" />
          <Show when={featureAvailable(features.data, "recompose") || proposer.running()}>
            <Show
              when={proposer.running()}
              fallback={
                <button
                  type="button"
                  class="icon-btn dense ai-btn"
                  {...tip(proposeBlock() === undefined ? PROPOSE_LABEL : `${PROPOSE_LABEL}. ${proposeBlock()}`)}
                  aria-disabled={proposeBlock() === undefined ? undefined : "true"}
                  onClick={() => void propose()}
                >
                  <Icon name="wand" size={14} />
                </button>
              }
            >
              <button type="button" class="icon-btn dense ai-btn" aria-busy="true" disabled {...tip("Proposing a grouping…")}>
                <Icon name="wand" size={14} />
              </button>
              <button type="button" class="icon-btn dense" {...tip("Cancel proposing")} onClick={cancelProposal}>
                <Icon name="close" size={14} />
              </button>
            </Show>
          </Show>
        </div>
        <Show when={preview.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {error() instanceof Error ? (error() as Error).message : String(error())}
            </div>
          )}
        </Show>
        <Show when={loaded()?.pushed}>
          <div class="note attention" role="status">
            <Icon name="warning" /> Some of these commits are already on {upstream() ?? "the upstream"}. Recomposing them means the next push needs a force push.
          </div>
        </Show>
        <Show when={features.data !== undefined && !featureAvailable(features.data, "recompose")}>
          <div class="note attention" role="status">
            <span>Recompose needs an AI provider to plan the new commits. Set up Propose with AI in Recompose in Settings → AI. Nothing is sent until you press Propose.</span>
            <button type="button" class="btn sm" onClick={props.onOpenAiSettings}>
              <Icon name="settings" size={14} />
              Open AI settings
            </button>
          </div>
        </Show>
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
        <Show when={discarded()}>
          <div class="note attention" role="status">
            <Icon name="warning" /> The base or the commits changed, so the earlier proposal was discarded. Propose again.
          </div>
        </Show>
        <Show when={plan()?.withheld.length}>
          <div class="note attention" role="status">
            Withheld from the provider because they look like secrets: {fileList(plan()?.withheld ?? [])}. Review where they belong.
          </div>
        </Show>
        <section class="rgroups" aria-label="Proposed commits, oldest first">
          <h4>Proposed commits · oldest first</h4>
          <Show
            when={plan()}
            fallback={
              <p class="setting-note">
                {baseRef() === undefined
                  ? "There is no upstream. Choose a base commit to recompose from."
                  : "No plan yet. Press the wand to have the AI group the changes after the base into new commits. You review the plan before anything is rewritten."}
              </p>
            }
          >
            {(current) => (
              <>
                <div class="note attention" role="status">
                  <Icon name="warning" /> Applying replaces the commits after {baseLabel()} with these {current().draft.groups.length} {current().draft.groups.length === 1 ? "commit" : "commits"}; Undo restores the previous history.
                </div>
                <For each={current().draft.groups}>
                  {(group, index) => (
                    <section class="rgroup" classList={{ invalid: problems()?.groups[group.id] !== undefined }} aria-label={`Commit ${index() + 1}`}>
                      <div class="rgroup-head">
                        <strong>Commit {index() + 1}</strong>
                      </div>
                      <p class="rgroup-message">{group.message}</p>
                      <Show when={problems()?.groups[group.id]}>{(text) => <span class="field-note error">{text()}</span>}</Show>
                      <ul class="rgroup-items">
                        <For each={describeGroup(current().draft, catalog(), group.id)} fallback={<li class="setting-note">Nothing assigned.</li>}>
                          {(item) => (
                            <li>
                              <span class="path-line">
                                <bdi dir="ltr">{item.path}</bdi>
                              </span>
                              <span class="hint-text">{item.scope}</span>
                              <Show when={item.added + item.removed > 0}>
                                <span class="counts">
                                  <span class="plus">+{item.added}</span> <span class="minus">−{item.removed}</span>
                                </span>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    </section>
                  )}
                </For>
              </>
            )}
          </Show>
        </section>
      </div>
      <div class="rfoot">
        <button type="button" class="btn primary" disabled={reason() !== undefined} onClick={() => void run()}>
          <Icon name="recompose" />
          Recompose {plan()?.draft.groups.length ?? 0} {plan()?.draft.groups.length === 1 ? "commit" : "commits"}
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
