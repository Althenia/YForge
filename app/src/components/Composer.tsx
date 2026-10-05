import { createEffect, createResource, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";
import { client } from "../ipc/client";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { GenerateAction } from "../state/aiGenerate";
import type { StashMessageAction } from "../state/aiStash";
import { amendWarning, commitIdentityLabel, stashButton, stashMessage, summaryRemaining, type Composer as ComposerState, type ComposerTab, type createCommitAction } from "../state/composer";
import { AiFailureNote } from "./AiFailureNote";
import { AiTrigger } from "./AiTrigger";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

type CommitAction = ReturnType<typeof createCommitAction>;

const GENERATE_ACTION = "Generate a commit message from the staged changes";
const DRAFT_NOTE = "Draft from your staged changes. Review and edit it; nothing is committed until you commit.";
const STASH_DRAFT_NOTE = "Draft from your changes. Review and edit it; nothing is stashed until you stash.";
const COMPOSE_ACTION = "Compose the changes into commits";
const STASH_ACTION = "Generate a stash message from the changes";
const DESCRIPTION_ROWS = 3;

export function FieldAi(props: {
  visible: boolean;
  running: boolean;
  action: string;
  reason: string | undefined;
  busy: string;
  cancel: string;
  onRun: () => void;
  onCancel: () => void;
}) {
  const text = () => [props.action, props.reason].filter((part) => part !== undefined).join(". ");
  return (
    <Show when={props.visible || props.running}>
      <Show
        when={props.running}
        fallback={
          <button
            type="button"
            class="icon-btn dense ai-btn field-btn"
            {...tip(text())}
            aria-disabled={props.reason === undefined ? undefined : "true"}
            onClick={() => props.reason === undefined && props.onRun()}
          >
            <Icon name="wand" size={14} />
          </button>
        }
      >
        <span class="field-busy-text" role="status">Generating…</span>
        <button type="button" class="icon-btn dense ai-btn field-btn" aria-busy="true" disabled {...tip(props.busy)}>
          <span class="busy-spinner" aria-hidden="true" />
        </button>
        <button type="button" class="icon-btn dense field-btn" {...tip(props.cancel)} onClick={props.onCancel}>
          <Icon name="close" size={14} />
        </button>
      </Show>
    </Show>
  );
}

function DraftTools(props: { note: string; replaced: boolean; onRestore: () => void }) {
  return (
    <>
      <span class="ai-mark" role="img" {...tip(props.note)}>
        <Icon name="wand" size={14} />
      </span>
      <Show when={props.replaced}>
        <button type="button" class="icon-btn dense field-btn" {...tip("Restore my text")} onClick={props.onRestore}>
          <Icon name="undo" size={14} />
        </button>
      </Show>
    </>
  );
}

export function Composer(props: {
  snapshot: RepoSnapshot;
  state: ComposerState;
  action: CommitAction;
  generate: GenerateAction;
  generateAvailable: boolean;
  stashDraft: StashMessageAction;
  stashDraftAvailable: boolean;
  compose: { available: boolean; reason: string | undefined; run: () => void };
  clean: boolean;
  staged: number;
  onOpenAiSettings: () => void;
  pushReason: string | undefined;
  summaryRef: (element: HTMLInputElement) => void;
  stash: (message: string, untracked: boolean) => Promise<boolean>;
}) {
  const id = createUniqueId();
  const [profiles] = createResource(() => client.profiles().catch(() => undefined));
  const identity = () => commitIdentityLabel(profiles());
  const generateReason = () => (!props.state.amend() && props.staged === 0 ? "Stage files to generate a message" : props.state.busy() ? "Committing…" : undefined);
  const stashDraftReason = () => (props.state.stashing() ? "Stashing…" : props.snapshot.files.length === 0 ? "No local changes to stash" : undefined);
  const remaining = () => summaryRemaining(props.state.summary());
  const button = () => props.action.button();
  const warning = () => amendWarning(props.state.pushed(), props.snapshot.upstream?.name);
  const unborn = () => props.snapshot.head.kind === "unborn";
  const amendReason = () =>
    unborn() ? "There is no commit to amend yet" : props.snapshot.operation !== null ? "Finish the operation in progress first" : undefined;
  const chipReason = () => (unborn() ? "There is no commit to amend yet" : props.state.busy() ? "Committing…" : props.generate.running() ? "Generating a commit message…" : undefined);
  const failure = () => props.state.failure();
  const tab = (): ComposerTab => (props.snapshot.operation === null ? props.state.tab() : "commit");
  const stashState = () => stashButton({ files: props.snapshot.files, untracked: props.state.stashUntracked(), busy: props.state.stashing() });
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ bottom: 0, right: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  createEffect(() => {
    if (!open() || trigger === undefined) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
    queueMicrotask(() => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target) && !trigger?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss, true));
  });

  const choices = () => [
    { label: "Commit", hint: "⌘↵", push: false, reason: button().disabledReason },
    { label: "Commit & Push", hint: "⌘⇧↵", push: true, reason: props.pushReason },
  ];

  const choose = (push: boolean, reason: string | undefined) => {
    if (reason !== undefined) return;
    setOpen(false);
    trigger?.focus();
    void props.action.submit({ push });
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger?.focus();
    } else if (event.key === "Tab") setOpen(false);
  };

  const runStash = async () => {
    if (stashState().disabledReason !== undefined) return;
    props.state.setStashing(true);
    const done = await props.stash(stashMessage(props.state.stashTitle(), props.state.stashDescription()), props.state.stashUntracked());
    props.state.setStashing(false);
    if (!done) return;
    props.state.setStashTitle("");
    props.state.setStashDescription("");
  };

  const tabs: ReadonlyArray<{ key: ComposerTab; label: string; icon: "commit" | "stash" }> = [
    { key: "commit", label: "Commit", icon: "commit" },
    { key: "stash", label: "Stash", icon: "stash" },
  ];

  const onTabKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab() === "commit" ? "stash" : "commit";
    props.state.setTab(next);
    queueMicrotask(() => document.getElementById(`${id}-${next}-tab`)?.focus());
  };

  return (
    <Show
      when={!props.clean || props.state.amend()}
      fallback={
        <div class="composer compact" role="group" aria-label="Commit" aria-busy={props.state.busy()}>
          <button
            type="button"
            class="btn"
            disabled={amendReason() !== undefined || props.state.busy()}
            title={amendReason()}
            onClick={() => {
              props.state.setTab("commit");
              void props.action.toggleAmend(true);
            }}
          >
            <Icon name="edit" size={14} />
            Amend last commit
          </button>
          <Show when={failure()}>
            {(error) => (
              <div class="note danger" role="alert">
                <strong>{error().message}</strong>
              </div>
            )}
          </Show>
        </div>
      }
    >
      <div class="composer" role="group" aria-label="Commit" aria-busy={props.state.busy() || props.state.stashing() || props.generate.running() || props.stashDraft.running()}>
        <Show when={props.snapshot.operation === null}>
          <div class="composer-tabs" role="tablist" aria-label="Composer">
            <For each={tabs}>
              {(entry) => (
                <button
                  type="button"
                  role="tab"
                  class="composer-tab"
                  classList={{ on: tab() === entry.key }}
                  id={`${id}-${entry.key}-tab`}
                  aria-selected={tab() === entry.key}
                  aria-controls={`${id}-${entry.key}-panel`}
                  tabindex={tab() === entry.key ? 0 : -1}
                  aria-disabled={props.generate.running() || props.stashDraft.running() || props.state.busy() || props.state.stashing() ? "true" : undefined}
                  onClick={() => !(props.generate.running() || props.stashDraft.running() || props.state.busy() || props.state.stashing()) && props.state.setTab(entry.key)}
                  onKeyDown={onTabKey}
                >
                  <Icon name={entry.icon} size={14} />
                  {entry.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show
          when={tab() === "commit"}
          fallback={
            <div class="composer-panel" role="tabpanel" id={`${id}-stash-panel`} aria-labelledby={`${id}-stash-tab`}>
              <label class="input summary-field" classList={{ drafted: props.stashDraft.drafted() }}>
                <input
                  type="text"
                  placeholder="Stash title (optional)"
                  aria-label="Stash title"
                  disabled={props.stashDraft.running() || props.state.stashing()}
                  value={props.state.stashTitle()}
                  onInput={(event) => props.state.setStashTitle(event.currentTarget.value)}
                />
                <span class="field-tools">
                  <Show
                    when={props.stashDraft.drafted() && !props.stashDraft.running()}
                    fallback={
                      <FieldAi
                        visible={props.stashDraftAvailable}
                        running={props.stashDraft.running()}
                        action={STASH_ACTION}
                        reason={stashDraftReason()}
                        busy="Generating a stash message…"
                        cancel="Cancel generating"
                        onRun={() => void props.stashDraft.run()}
                        onCancel={props.stashDraft.cancel}
                      />
                    }
                  >
                    <DraftTools note={STASH_DRAFT_NOTE} replaced={props.stashDraft.replaced() !== undefined} onRestore={props.stashDraft.restore} />
                  </Show>
                </span>
              </label>
              <Show when={props.stashDraft.drafted() && props.stashDraft.notes().length > 0}>
                <ul class="draft-notes" role="status">
                  <For each={props.stashDraft.notes()}>{(note) => <li>{note}</li>}</For>
                </ul>
              </Show>
              <TextArea
                label="Stash description"
                placeholder="Description"
                value={props.state.stashDescription()}
                minRows={DESCRIPTION_ROWS}
                maxRows={DESCRIPTION_ROWS}
                onInput={props.state.setStashDescription}
              />
              <div class="composer-row">
                <button
                  type="button"
                  class="chip-toggle"
                  role="checkbox"
                  aria-checked={props.state.stashUntracked()}
                  title="Also stash files Git does not track yet"
                  onClick={() => props.state.setStashUntracked(!props.state.stashUntracked())}
                >
                  <Icon name="plus" size={14} />
                  Include untracked
                </button>
              </div>
              <Show when={props.stashDraft.failure()}>
                {(error) => <AiFailureNote failure={error()} onOpenAiSettings={props.onOpenAiSettings} />}
              </Show>
              <button type="button" class="btn primary composer-go" disabled={stashState().disabledReason !== undefined} onClick={() => void runStash()}>
                <Icon name="stash" />
                <span class="btn-label">{stashState().disabledReason ?? stashState().label}</span>
              </button>
            </div>
          }
        >
          <div class="composer-panel" role="tabpanel" id={`${id}-commit-panel`} aria-labelledby={props.snapshot.operation === null ? `${id}-commit-tab` : undefined}>
            <label class="input summary-field" classList={{ drafted: props.generate.drafted() }}>
                <input
                  type="text"
                  ref={props.summaryRef}
                  placeholder="Summary"
                  aria-label="Summary"
                  disabled={props.generate.running() || props.state.busy()}
                value={props.state.summary()}
                onInput={(event) => props.state.setSummary(event.currentTarget.value)}
              />
              <span class="field-tools">
                <span class="count" classList={{ over: remaining() < 0 }} aria-label={`${remaining()} characters left in the 72 character guide`}>
                  {remaining()}
                </span>
                <Show
                  when={props.generate.drafted() && !props.generate.running()}
                  fallback={
                    <FieldAi
                      visible={props.generateAvailable}
                      running={props.generate.running()}
                      action={props.state.amend() ? "Generate a commit message from the resulting commit" : GENERATE_ACTION}
                      reason={generateReason()}
                      busy="Generating a commit message…"
                      cancel="Cancel generating"
                      onRun={() => void props.generate.run()}
                      onCancel={props.generate.cancel}
                    />
                  }
                >
                  <DraftTools note={props.state.amend() ? "Draft from the resulting commit. Review and edit it; nothing is committed until you commit." : DRAFT_NOTE} replaced={props.generate.replaced() !== undefined} onRestore={props.generate.restore} />
                </Show>
              </span>
            </label>
            <Show when={props.generate.drafted() && props.generate.notes().length > 0}>
              <ul class="draft-notes" role="status">
                <For each={props.generate.notes()}>{(note) => <li>{note}</li>}</For>
              </ul>
            </Show>
            <TextArea
              label="Description"
              placeholder="Description"
              value={props.state.description()}
              minRows={DESCRIPTION_ROWS}
              maxRows={DESCRIPTION_ROWS}
              disabled={props.generate.running() || props.state.busy()}
              onInput={props.state.setDescription}
            />
            <div class="composer-row">
              <button
                type="button"
                class="chip-toggle"
                role="checkbox"
                aria-checked={props.state.amend()}
                aria-disabled={chipReason() === undefined ? undefined : "true"}
                title={chipReason() ?? "Amend the previous commit instead of creating a new one"}
                onClick={() => chipReason() === undefined && void props.action.toggleAmend(!props.state.amend())}
              >
                <Icon name="edit" size={14} />
                Amend
              </button>
              <Show when={props.compose.available}>
                <AiTrigger action={COMPOSE_ACTION} reason={props.state.busy() ? "Committing…" : props.compose.reason} onRun={props.compose.run} />
              </Show>
            </div>
            <Show when={warning()}>{(text) => <div class="note attention" role="status">{text()}</div>}</Show>
            <Show when={failure()}>
              {(error) => (
                <div class="note danger" role="alert">
                  <strong>{error().message}</strong>
                  <Show when={error().output}>{(output) => <pre class="out">{output()}</pre>}</Show>
                </div>
              )}
            </Show>
            <Show when={props.generate.failure()}>
              {(error) => <AiFailureNote failure={error()} onOpenAiSettings={props.onOpenAiSettings} />}
            </Show>
            <Show when={identity()}>{(text) => <div class="composer-identity" role="status">{text()}</div>}</Show>
            <span class="split-btn composer-go">
              <button type="button" class="btn primary" disabled={button().disabledReason !== undefined} onClick={() => void props.action.submit()}>
                <Icon name="commit" />
                <span class="btn-label">{button().disabledReason ?? button().label}</span>
                <span class="hint">⌘↵</span>
              </button>
              <button
                type="button"
                class="btn primary chev"
                ref={trigger}
                {...tip("More commit actions")}
                aria-haspopup="menu"
                aria-expanded={open()}
                disabled={props.state.busy() || props.generate.running()}
                onClick={() => setOpen(!open())}
              >
                <Icon name="chevron" />
              </button>
            </span>
            <Show when={open()}>
              <div class="menu" role="menu" aria-label="Commit actions" ref={menu} style={{ bottom: `${position().bottom}px`, right: `${position().right}px` }} onKeyDown={onMenuKey}>
                <For each={choices()}>
                  {(choice) => (
                    <button
                      type="button"
                      role="menuitem"
                      class="item"
                      aria-disabled={choice.reason === undefined ? undefined : "true"}
                      onClick={() => choose(choice.push, choice.reason)}
                    >
                      <span class="item-main">
                        <span class="label-text">{choice.label}</span>
                      </span>
                      <span class="note-k">{choice.hint}</span>
                      <Show when={choice.reason}>{(reason) => <span class="note-k reason-k">{reason()}</span>}</Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
