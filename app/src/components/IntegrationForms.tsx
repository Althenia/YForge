import { createSignal, For, Show } from "solid-js";
import type { MergeMode } from "../ipc/bindings/MergeMode";
import { mergeChoices } from "../state/integrationModel";
import { startPointText } from "../state/refMenu";
import type { PopoverState, RepoActions } from "../state/repoActions";
import { MenuLabel } from "./ContextMenu";
import { Popover } from "./Popover";

type MergePopover = Extract<PopoverState, { kind: "merge" }>;
type TagPopover = Extract<PopoverState, { kind: "create_tag" }>;

export function MergeForm(props: { state: MergePopover; actions: RepoActions }) {
  const model = mergeChoices(props.state.current, props.state.source, props.state.preview);
  const [mode, setMode] = createSignal<MergeMode>(model.initial);
  const commits = () => props.state.preview.incoming.commits;

  return (
    <Popover anchor={props.state.anchor} label="Merge" onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          void props.actions.submitMerge(mode());
        }}
      >
        <h3>
          <MenuLabel parts={["Merge ", { ref: props.state.source }, " into ", { ref: props.state.current }]} />
        </h3>
        <ul class="dialog-names" aria-label="Incoming commits">
          <For each={commits().slice(0, 5)}>{(commit) => <li class="ref">{`${commit.sha.slice(0, 7)} ${commit.summary}`}</li>}</For>
          <Show when={props.state.preview.incoming.count > 5}>
            <li>and {props.state.preview.incoming.count - 5} more</li>
          </Show>
        </ul>
        <div class="choices" role="radiogroup" aria-label="Merge type">
          <For each={model.choices}>
            {(choice) => (
              <label class="choice" classList={{ disabled: choice.disabledReason !== undefined }}>
                <input
                  type="radio"
                  name="merge-mode"
                  value={choice.mode}
                  checked={mode() === choice.mode}
                  disabled={choice.disabledReason !== undefined}
                  onChange={() => setMode(choice.mode)}
                />
                <span class="choice-text">
                  <span>{choice.label}</span>
                  <span class="reason">{choice.disabledReason ?? choice.detail}</span>
                </span>
              </label>
            )}
          </For>
        </div>
        <p class="start-point">{model.outcome(mode())}</p>
        <div class="hrow">
          <button type="submit" class="btn primary">
            Merge
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
        </div>
      </form>
    </Popover>
  );
}

export function TagForm(props: { state: TagPopover; actions: RepoActions }) {
  const [name, setName] = createSignal("");
  const [annotated, setAnnotated] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [push, setPush] = createSignal(false);
  const [problem, setProblem] = createSignal<string | undefined>();
  const reason = () => {
    if (name().trim() === "") return "Enter a tag name";
    if (annotated() && message().trim() === "") return "Enter a message for the annotated tag";
    return undefined;
  };

  const submit = async () => {
    if (reason() !== undefined) return;
    setProblem(await props.actions.submitCreateTag({ name: name().trim(), message: annotated() ? message().trim() : null, push: push() }));
  };

  return (
    <Popover anchor={props.state.anchor} label="Create tag" onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3>Create tag</h3>
        <p class="start-point ref">{startPointText(props.state.at)}</p>
        <label class="input">
          <input
            type="text"
            aria-label="Tag name"
            placeholder="Tag name"
            spellcheck={false}
            autocomplete="off"
            value={name()}
            aria-invalid={problem() !== undefined}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setProblem(undefined);
            }}
          />
        </label>
        <div class="choices" role="radiogroup" aria-label="Tag type">
          <label class="check">
            <input type="radio" name="tag-kind" checked={!annotated()} onChange={() => setAnnotated(false)} />
            Lightweight
          </label>
          <label class="check">
            <input type="radio" name="tag-kind" checked={annotated()} onChange={() => setAnnotated(true)} />
            Annotated
          </label>
        </div>
        <Show when={annotated()}>
          <label class="input area mtext">
            <textarea aria-label="Tag message" placeholder="Message" value={message()} onInput={(event) => setMessage(event.currentTarget.value)} />
          </label>
        </Show>
        <label class="check">
          <input type="checkbox" checked={push()} disabled={props.state.remote === undefined} onChange={(event) => setPush(event.currentTarget.checked)} />
          {props.state.remote === undefined ? "Push after creating (no remote)" : `Push to ${props.state.remote} after creating`}
        </label>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={reason() !== undefined}>
            Create
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
          <Show when={problem() ?? reason()}>{(text) => <span class="reason" role={problem() === undefined ? undefined : "alert"}>{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}
