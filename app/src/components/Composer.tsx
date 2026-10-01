import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { GenerateAction } from "../state/aiGenerate";
import { amendWarning, summaryRemaining, type Composer as ComposerState, type createCommitAction } from "../state/composer";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

type CommitAction = ReturnType<typeof createCommitAction>;

export function Composer(props: {
  snapshot: RepoSnapshot;
  state: ComposerState;
  action: CommitAction;
  generate: GenerateAction;
  generateAvailable: boolean;
  clean: boolean;
  staged: number;
  onOpenAiSettings: () => void;
  pushReason: string | undefined;
  summaryRef: (element: HTMLInputElement) => void;
}) {
  const generateReason = () => (props.staged === 0 ? "Stage files to generate a message" : props.state.busy() ? "Committing…" : undefined);
  const remaining = () => summaryRemaining(props.state.summary());
  const button = () => props.action.button();
  const warning = () => amendWarning(props.state.pushed(), props.snapshot.upstream?.name);
  const unborn = () => props.snapshot.head.kind === "unborn";
  const amendReason = () =>
    unborn() ? "There is no commit to amend yet" : props.snapshot.operation !== null ? "Finish the operation in progress first" : undefined;
  const failure = () => props.state.failure();
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

  return (
    <Show
      when={!props.clean || props.state.amend()}
      fallback={
        <div class="composer compact" role="group" aria-label="Commit" aria-busy={props.state.busy()}>
          <button type="button" class="btn" disabled={amendReason() !== undefined || props.state.busy()} title={amendReason()} onClick={() => void props.action.toggleAmend(true)}>
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
    <div class="composer" role="group" aria-label="Commit" aria-busy={props.state.busy()}>
      <label class="input">
        <input
          type="text"
          ref={props.summaryRef}
          placeholder="Summary"
          aria-label="Summary"
          value={props.state.summary()}
          onInput={(event) => props.state.setSummary(event.currentTarget.value)}
        />
        <span class="count" classList={{ over: remaining() < 0 }} aria-label={`${remaining()} characters left in the 72 character guide`}>
          {remaining()}
        </span>
      </label>
      <label class="input area">
        <textarea
          placeholder="Description"
          aria-label="Description"
          value={props.state.description()}
          onInput={(event) => props.state.setDescription(event.currentTarget.value)}
        />
      </label>
      <label class="check" title={unborn() ? "There is no commit to amend yet" : undefined}>
        <input
          type="checkbox"
          checked={props.state.amend()}
          disabled={unborn() || props.state.busy()}
          onChange={(event) => void props.action.toggleAmend(event.currentTarget.checked)}
        />
        Amend last commit
      </label>
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
      <Show when={props.generate.drafted()}>
        <div class="note attention" role="status">
          <span>Draft from your staged changes. Review and edit it; nothing is committed until you commit.</span>
          <For each={props.generate.notes()}>{(note) => <span>{note}</span>}</For>
          <Show when={props.generate.replaced()}>
            <button type="button" class="btn sm" onClick={props.generate.restore}>
              <Icon name="undo" size={14} />
              Restore my text
            </button>
          </Show>
        </div>
      </Show>
      <div class="hrow">
        <Show when={props.generateAvailable || props.generate.running()}>
          <Show
            when={props.generate.running()}
            fallback={
              <button
                type="button"
                class="btn"
                disabled={generateReason() !== undefined}
                title={generateReason() ?? "Draft a message from the staged changes with your AI provider"}
                onClick={() => void props.generate.run()}
              >
                <Icon name="wand" />
                Generate
              </button>
            }
          >
            <button type="button" class="btn" aria-busy="true" disabled>
              <Icon name="wand" />
              Generating…
            </button>
            <button type="button" class="icon-btn dense" {...tip("Cancel generating")} onClick={props.generate.cancel}>
              <Icon name="close" />
            </button>
          </Show>
        </Show>
        <span class="split-btn">
          <button
            type="button"
            class="btn primary"
            disabled={button().disabledReason !== undefined}
            aria-describedby={button().disabledReason === undefined ? undefined : "commit-reason"}
            onClick={() => void props.action.submit()}
          >
            <Icon name="commit" />
            {button().label}
            <span class="hint">⌘↵</span>
          </button>
          <button
            type="button"
            class="btn primary chev"
            ref={trigger}
            {...tip("More commit actions")}
            aria-haspopup="menu"
            aria-expanded={open()}
            disabled={props.state.busy()}
            onClick={() => setOpen(!open())}
          >
            <Icon name="chevron" />
          </button>
        </span>
        <Show when={button().disabledReason}>{(reason) => <span class="reason" id="commit-reason">{reason()}</span>}</Show>
      </div>
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
  );
}
