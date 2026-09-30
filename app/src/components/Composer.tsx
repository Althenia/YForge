import { Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { amendWarning, summaryRemaining, type Composer as ComposerState, type createCommitAction } from "../state/composer";
import { Icon } from "./Icon";

type CommitAction = ReturnType<typeof createCommitAction>;

export function Composer(props: {
  snapshot: RepoSnapshot;
  state: ComposerState;
  action: CommitAction;
  summaryRef: (element: HTMLInputElement) => void;
}) {
  const remaining = () => summaryRemaining(props.state.summary());
  const button = () => props.action.button();
  const warning = () => amendWarning(props.state.pushed(), props.snapshot.upstream?.name);
  const unborn = () => props.snapshot.head.kind === "unborn";
  const failure = () => props.state.failure();
  return (
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
      <div class="hrow">
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
        <Show when={button().disabledReason}>{(reason) => <span class="reason" id="commit-reason">{reason()}</span>}</Show>
      </div>
    </div>
  );
}
