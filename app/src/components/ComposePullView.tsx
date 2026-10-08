import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { PullRequestDisclosure } from "../ipc/bindings/PullRequestDisclosure";
import { client } from "../ipc/client";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { fileNotes } from "../state/aiGenerate";
import { aiFailure } from "../state/aiModel";
import { createAiRun } from "../state/aiRun";
import { conflictLabel, isUnsupported, predictMerge } from "../state/conflicts";
import { platformFailure, pullProblems } from "../state/platformModel";
import type { ComposeRequest, PlatformActions } from "../state/platformActions";
import { useQuery } from "../state/query";
import { repoKeys } from "../state/queryKeys";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { AiFailureNote } from "./AiFailureNote";
import { AiTrigger } from "./AiTrigger";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

const disclosed = (sent: PullRequestDisclosure) =>
  `Generate sends ${plural(sent.commit_messages, "commit message")} and the diff of ${plural(sent.files, "file")} (+${sent.additions} −${sent.deletions}) to ${sent.provider_name}.`;

export function ComposePullView(props: { session: RepoSession; platform: PlatformActions; actions: RepoActions; request: ComposeRequest; onOpenAiSettings: () => void }) {
  const path = props.session.path;
  const snapshot = props.session.snapshot;
  const remote = () => props.platform.matched()?.remote ?? "";
  const [source, setSource] = createSignal(props.request.source);
  const [target, setTarget] = createSignal(props.request.target);
  const [title, setTitle] = createSignal(props.request.title);
  const [body, setBody] = createSignal("");
  const [bodyTouched, setBodyTouched] = createSignal(false);
  const [draft, setDraft] = createSignal(false);
  const [step, setStep] = createSignal<string>();
  const [failure, setFailure] = createSignal<string>();
  const targets = () => {
    const prefix = `${remote()}/`;
    return remote() === "" ? [] : snapshot().remote_branches.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length)).filter((name) => name !== "HEAD");
  };
  const targetRef = () => `${remote()}/${target()}`;
  const comparable = () => source() !== "" && target() !== "" && source() !== target();
  const comparison = useQuery(
    () => ({
      queryKey: [...repoKeys.all(path), "pull-compare", source(), targetRef()],
      queryFn: () => client.branchComparison(path, source(), targetRef()),
      enabled: comparable(),
    }),
    () => props.session.queryClient,
  );
  const prediction = useQuery(
    () => ({
      queryKey: [...repoKeys.all(path), "pull-conflict", source(), targetRef()],
      queryFn: ({ signal }: { signal: AbortSignal }) => predictMerge(path, targetRef(), source(), signal, props.session.report),
      enabled: comparable(),
      retry: false,
    }),
    () => props.session.queryClient,
  );
  const template = useQuery(
    () => ({ queryKey: [...repoKeys.all(path), "pull-template"], queryFn: () => client.pullRequestTemplate(path), staleTime: Infinity }),
    () => props.session.queryClient,
  );
  createEffect(
    on(
      () => template.data,
      (text) => {
        if (text != null && !bodyTouched()) setBody(text);
      },
    ),
  );
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const aiReady = () => featureAvailable(features.data, "compose_pull_request");
  const disclosure = useQuery(
    () => ({
      queryKey: [...repoKeys.all(path), "pull-ai-context", source(), targetRef()],
      queryFn: () => client.aiPullRequestContext(path, source(), targetRef()),
      enabled: aiReady() && comparable(),
      retry: false,
    }),
    () => props.session.queryClient,
  );
  const generation = createAiRun(props.session.queryClient, (id) => client.aiComposePullRequest(path, id, source(), targetRef(), template.data ?? ""));
  onCleanup(generation.cancel);
  const [replaced, setReplaced] = createSignal<{ title: string; body: string }>();
  const unpushed = () => source() !== "" && remote() !== "" && !snapshot().remote_branches.includes(`${remote()}/${source()}`);
  const problems = () => pullProblems({ source: source(), target: target(), title: title(), body: body() });
  const branchProblem = () => problems().source ?? problems().target;
  const reason = (): string | undefined => {
    if (generation.running()) return "Generating a title and description…";
    if (branchProblem() !== undefined) return branchProblem();
    if (comparison.isFetching || comparison.data === undefined) return "Reading the comparison…";
    return problems().title;
  };
  const generateAction = () =>
    `Generate a title and description from ${comparison.data === undefined ? "the compared commits" : plural(comparison.data.commits.length, "commit")} and the diff of ${source()}`;
  const generateReason = (): string | undefined => {
    if (step() !== undefined) return "Creating pull request…";
    if (branchProblem() !== undefined) return branchProblem();
    if (disclosure.error != null) return "Could not read what Generate sends";
    if (disclosure.data === undefined || template.isPending) return "Reading what Generate sends…";
    return undefined;
  };
  const aiProblem = () => {
    const failure = generation.failure() ?? (disclosure.error == null ? undefined : aiFailure(disclosure.error));
    return failure === undefined ? undefined : { ...failure, action: failure.action ?? ("open_settings" as const) };
  };

  async function generate(): Promise<void> {
    if (generateReason() !== undefined || generation.running()) return;
    const previous = { title: title(), body: body() };
    const draft = await generation.start();
    if (draft === undefined) return;
    setReplaced(previous.title.trim() === "" && previous.body.trim() === "" ? undefined : previous);
    setBodyTouched(true);
    setTitle(draft.title);
    setBody(draft.description);
  }

  function restore(): void {
    const previous = replaced();
    if (previous === undefined) return;
    setTitle(previous.title);
    setBody(previous.body);
    setReplaced(undefined);
  }
  const conflictLine = (): { text: string; conflicted: boolean } => {
    if (prediction.error != null) {
      const message = prediction.error instanceof Error ? prediction.error.message : String(prediction.error);
      return { text: isUnsupported(prediction.error) ? `Conflict prediction is unavailable: ${message}` : `Could not predict conflicts: ${message}`, conflicted: false };
    }
    const found = prediction.data;
    if (found === undefined) return { text: `Checking for conflicts with ${targetRef()}…`, conflicted: false };
    if (found.conflicted_files.length === 0) return { text: `No conflicts with ${targetRef()}`, conflicted: false };
    return { text: conflictLabel({ target: targetRef(), files: found.conflicted_files }), conflicted: true };
  };

  async function submit(): Promise<void> {
    if (reason() !== undefined || step() !== undefined) return;
    setFailure(undefined);
    try {
      if (unpushed()) {
        setStep(`Pushing ${source()} to ${remote()}…`);
        if (!(await props.actions.publish(remote(), source()))) return;
      }
      setStep("Creating pull request…");
      await props.platform.createPull({ source_ref: source(), target_ref: target(), title: title().trim(), body: body(), draft: draft() });
    } catch (error) {
      setFailure(platformFailure(error).message);
    } finally {
      setStep(undefined);
    }
  }

  return (
    <section class="panel compose" aria-label="Create pull request">
      <div class="compose-scroll">
        <h2 class="compose-title">Create pull request</h2>
        <p class="setting-note">
          On {props.platform.platformTitle()} for{" "}
          <span class="mono">
            {props.platform.matched()?.repo.owner}/{props.platform.matched()?.repo.repo}
          </span>
        </p>
        <div class="compose-branches">
          <label class="field">
            <span class="field-label">Source branch</span>
            <Select label="Source branch" value={source()} options={snapshot().branches.map((name) => ({ value: name, label: name }))} placeholder="Choose…" onChange={setSource} />
            <Show when={unpushed()}>
              <span class="field-note">
                <Icon name="warning" size={14} /> {source()} is not on {remote()} yet. Create pushes it first.
              </span>
            </Show>
          </label>
          <label class="field">
            <span class="field-label">Target branch</span>
            <Select label="Target branch" value={target()} options={targets().map((name) => ({ value: name, label: name }))} placeholder="Choose…" onChange={setTarget} />
          </label>
        </div>
        <Show when={comparison.data}>
          {(found) => (
            <div class="compare">
              <p class="compare-summary">
                {plural(found().commits.length, "commit")} · {plural(found().files, "file")} · +{found().additions} −{found().deletions}
              </p>
              <ol class="compare-commits" aria-label="Commits in this pull request">
                <For each={found().commits}>
                  {(commit) => (
                    <li>
                      <span class="mono">{commit.sha.slice(0, 7)}</span> {commit.summary} <span class="compare-author">· {commit.author}</span>
                    </li>
                  )}
                </For>
              </ol>
            </div>
          )}
        </Show>
        <Show when={comparable()}>
          <p class="compose-conflict" role="status">
            <Show when={conflictLine().conflicted}>
              <span class="st st-conflicted" aria-hidden="true">
                !
              </span>
            </Show>
            {conflictLine().text}
          </p>
        </Show>
        <div class="compose-fields" aria-busy={generation.running()}>
          <label class="field">
            <span class="field-label">Title</span>
            <span class="input">
              <input type="text" aria-label="Title" value={title()} disabled={generation.running()} onInput={(event) => setTitle(event.currentTarget.value)} />
            </span>
          </label>
          <div class="field">
            <span class="field-label">Description</span>
            <TextArea
              label="Description"
              value={body()}
              minRows={6}
              maxRows={16}
              disabled={generation.running()}
              onInput={(value) => {
                setBodyTouched(true);
                setBody(value);
              }}
            />
          </div>
          <Show when={generation.running()}>
            <p class="field-note" role="status">
              Generation in progress; fields unlock when it completes.
            </p>
          </Show>
        </div>
        <div class="compose-draft">
          <Switch label="Draft" checked={draft()} onChange={setDraft} />
          <span>Draft</span>
        </div>
        <Show when={aiReady()}>
          <div class="compose-ai">
            <div class="compose-ai-row">
              <Show when={generation.running()} fallback={<AiTrigger action={generateAction()} reason={generateReason()} onRun={() => void generate()} />}>
                <button type="button" class="icon-btn dense ai-btn" aria-busy="true" aria-disabled="true" {...tip("Generating a title and description…")}>
                  <span class="busy-spinner" aria-hidden="true" />
                </button>
                <button type="button" class="btn sm" onClick={generation.cancel}>
                  Cancel generation
                </button>
              </Show>
              <Show when={replaced() !== undefined && !generation.running()}>
                <button type="button" class="btn sm" onClick={restore}>
                  Restore my text
                </button>
              </Show>
            </div>
            <Show when={disclosure.data}>
              {(sent) => (
                <>
                  <p class="field-note ai-disclosure">{disclosed(sent())}</p>
                  <Show when={fileNotes(sent()).length > 0}>
                    <ul class="draft-notes">
                      <For each={fileNotes(sent())}>{(note) => <li>{note}</li>}</For>
                    </ul>
                  </Show>
                </>
              )}
            </Show>
            <Show when={aiProblem()}>{(problem) => <AiFailureNote failure={problem()} onOpenAiSettings={props.onOpenAiSettings} />}</Show>
          </div>
        </Show>
      </div>
      <div class="foot compose-foot">
        <Show when={failure()}>
          {(message) => (
            <p class="field-note error" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={step()}>
          {(text) => (
            <p class="compose-step" role="status">
              {text()}
            </p>
          )}
        </Show>
        <Show when={step() === undefined ? reason() : undefined}>{(text) => <span class="compose-reason field-note">{text()}</span>}</Show>
        <button type="button" class="btn" onClick={props.platform.closeCompose}>
          Cancel
        </button>
        <button
          type="button"
          class="btn primary"
          aria-disabled={reason() !== undefined || step() !== undefined ? "true" : undefined}
          aria-busy={step() !== undefined}
          onClick={() => void submit()}
        >
          Create pull request
        </button>
      </div>
    </section>
  );
}
