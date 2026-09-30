import { createResource, createSignal, Show } from "solid-js";
import { client } from "../ipc/client";
import { createBranchNameField } from "../state/branchName";
import { changeTotal } from "../state/changes";
import { startPointText } from "../state/refMenu";
import type { PopoverState, RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { Popover } from "./Popover";

type BranchPopover = Extract<PopoverState, { kind: "create_branch" | "rename_branch" }>;
type StashPopover = Extract<PopoverState, { kind: "stash" }>;

export function BranchNameForm(props: { state: BranchPopover; session: RepoSession; actions: RepoActions }) {
  const renaming = () => (props.state.kind === "rename_branch" ? props.state.name : undefined);
  const field = createBranchNameField(props.session.path, props.session.snapshot().branches, renaming() ?? "", renaming());
  const [checkOut, setCheckOut] = createSignal(true);
  const startSha = () => (props.state.kind === "create_branch" && /^[0-9a-f]{4,64}$/.test(props.state.at ?? "") ? props.state.at : null);
  const [summary] = createResource(startSha, (sha) => client.commitDetails(props.session.path, sha).then((details) => details.summary, () => undefined));
  const startText = () => (props.state.kind === "create_branch" ? startPointText(props.state.at, summary()) : undefined);
  const title = () => (props.state.kind === "rename_branch" ? `Rename ${props.state.name}` : "Create branch");
  const reason = () => {
    if (field.value() === "") return "Enter a branch name";
    return field.problem() ?? (field.valid() ? undefined : "Checking the name…");
  };

  const submit = () => {
    if (!field.valid()) return;
    const state = props.state;
    if (state.kind === "rename_branch") {
      props.actions.closePopover();
      void props.actions.renameBranch(state.name, field.value());
    } else void props.actions.submitCreateBranch(field.value(), checkOut());
  };

  return (
    <Popover anchor={props.state.anchor} label={title()} onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h3>{title()}</h3>
        <Show when={startText()}>{(text) => <p class="start-point ref">{text()}</p>}</Show>
        <label class="input">
          <input
            type="text"
            aria-label="Branch name"
            placeholder="Branch name"
            spellcheck={false}
            autocomplete="off"
            value={field.value()}
            aria-invalid={field.problem() !== undefined}
            onInput={(event) => void field.setValue(event.currentTarget.value)}
            ref={(element) => queueMicrotask(() => element.select())}
          />
        </label>
        <Show when={props.state.kind === "create_branch"}>
          <label class="check">
            <input type="checkbox" checked={checkOut()} onChange={(event) => setCheckOut(event.currentTarget.checked)} />
            Check out the new branch
          </label>
        </Show>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={!field.valid()}>
            {props.state.kind === "rename_branch" ? "Rename" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
          <Show when={reason()}>{(text) => <span class="reason" role={field.problem() === undefined ? undefined : "alert"}>{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}

export function StashForm(props: { state: StashPopover; session: RepoSession; actions: RepoActions }) {
  const [message, setMessage] = createSignal("");
  const [untracked, setUntracked] = createSignal(false);
  const counts = () => props.session.snapshot().counts;
  const reason = () => {
    if (changeTotal(counts()) === 0) return "No local changes to stash";
    if (changeTotal(counts()) === counts().untracked && !untracked()) return "Only untracked files changed; include them to stash";
    return undefined;
  };

  const submit = () => {
    if (reason() !== undefined) return;
    props.actions.closePopover();
    void props.actions.stashChanges(message(), untracked());
  };

  return (
    <Popover anchor={props.state.anchor} label="Stash changes" onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h3>Stash changes</h3>
        <label class="input">
          <input
            type="text"
            aria-label="Stash message"
            placeholder="Message (optional)"
            autocomplete="off"
            value={message()}
            onInput={(event) => setMessage(event.currentTarget.value)}
          />
        </label>
        <label class="check">
          <input type="checkbox" checked={untracked()} onChange={(event) => setUntracked(event.currentTarget.checked)} />
          Include untracked files
        </label>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={reason() !== undefined}>
            Stash
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
          <Show when={reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}
