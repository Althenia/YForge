import { createForm } from "@tanstack/solid-form";
import { Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { pushRemote } from "../state/refMenu";
import type { PopoverState, RepoActions } from "../state/repoActions";
import { bareStashMessage } from "../state/stashName";
import { Popover } from "./Popover";
import { Select } from "./Select";

type SetUpstreamState = Extract<PopoverState, { kind: "set_upstream" }>;
type PushToState = Extract<PopoverState, { kind: "push_to" }>;
type RenameStashState = Extract<PopoverState, { kind: "rename_stash" }>;

const remoteBranchFor = (snapshot: RepoSnapshot, branch: string): string | undefined => {
  const preferred = pushRemote(snapshot.remotes);
  return snapshot.remote_branches.find((name) => name === `${preferred}/${branch}`) ?? snapshot.remote_branches.find((name) => snapshot.remotes.some((remote) => name === `${remote}/${branch}`));
};

export function SetUpstreamForm(props: { state: SetUpstreamState; snapshot: RepoSnapshot; actions: RepoActions }) {
  const choices = () => props.snapshot.remote_branches;
  const form = createForm(() => ({
    defaultValues: { upstream: remoteBranchFor(props.snapshot, props.state.branch) ?? choices()[0] ?? "" },
    onSubmit: ({ value }) => void props.actions.setUpstream(props.state.branch, value.upstream),
  }));
  const chosen = form.useSelector((state) => state.values.upstream);
  const reason = () => (choices().length === 0 ? "No remote branches yet. Fetch first, or push the branch to create one." : undefined);
  return (
    <Popover anchor={props.state.anchor} label={`Set upstream of ${props.state.branch}`} onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason() === undefined) void form.handleSubmit();
        }}
      >
        <h3>Set upstream of {props.state.branch}</h3>
        <label class="field">
          <form.Field name="upstream">
            {(field) => (
              <Select
                label="Upstream branch"
                value={field().state.value}
                options={choices().map((name) => ({ value: name, label: name }))}
                placeholder="Choose a branch…"
                disabled={choices().length === 0}
                disabledReason="This repository has no remote branch to track"
                onChange={(value) => field().handleChange(value)}
              />
            )}
          </form.Field>
        </label>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={reason() !== undefined || chosen() === ""}>
            Set upstream
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

const nameProblem = (name: string): string | undefined => {
  if (name.trim() === "") return "Enter a branch name";
  return /\s/.test(name) ? "A branch name cannot contain spaces" : undefined;
};

export function PushToForm(props: { state: PushToState; snapshot: RepoSnapshot; actions: RepoActions }) {
  const head = props.snapshot.head;
  const form = createForm(() => ({
    defaultValues: {
      remote: pushRemote(props.snapshot.remotes) ?? "",
      name: head.kind === "branch" ? head.name : "",
      setUpstream: props.snapshot.upstream === null,
    },
    validators: { onMount: ({ value }) => nameProblem(value.name), onChange: ({ value }) => nameProblem(value.name) },
    onSubmit: ({ value }) => void props.actions.pushTo({ remote: value.remote, name: value.name, set_upstream: value.setUpstream }),
  }));
  const problem = form.useSelector((state) => state.errors[0] as string | undefined);
  return (
    <Popover anchor={props.state.anchor} label="Push to" onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem() === undefined) void form.handleSubmit();
        }}
      >
        <h3>Push {head.kind === "branch" ? head.name : "HEAD"} to…</h3>
        <label class="field">
          <form.Field name="remote">
            {(field) => (
              <Select
                label="Remote"
                value={field().state.value}
                options={props.snapshot.remotes.map((name) => ({ value: name, label: name }))}
                placeholder="Choose a remote…"
                onChange={(value) => field().handleChange(value)}
              />
            )}
          </form.Field>
        </label>
        <label class="input">
          <form.Field name="name">
            {(field) => (
              <input
                type="text"
                aria-label="Remote branch name"
                placeholder="Remote branch name"
                spellcheck={false}
                autocomplete="off"
                value={field().state.value}
                aria-invalid={problem() !== undefined}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
              />
            )}
          </form.Field>
        </label>
        <label class="check">
          <form.Field name="setUpstream">
            {(field) => <input type="checkbox" aria-label="Set as upstream" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
          Set as upstream
        </label>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={problem() !== undefined}>
            Push
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
          <Show when={problem()}>{(text) => <span class="reason">{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}

export function RenameStashForm(props: { state: RenameStashState; actions: RepoActions }) {
  const original = bareStashMessage(props.state.stash.message);
  const problem = (message: string): string | undefined => (message.trim() === "" ? "Enter a name for the stash" : message.trim() === original ? "Enter a different name" : undefined);
  const form = createForm(() => ({
    defaultValues: { message: original },
    validators: { onMount: ({ value }) => problem(value.message), onChange: ({ value }) => problem(value.message) },
    onSubmit: ({ value }) => void props.actions.renameStash(props.state.stash, value.message.trim()),
  }));
  const reason = form.useSelector((state) => state.errors[0] as string | undefined);
  const label = `Rename stash@{${props.state.stash.index}}`;
  return (
    <Popover anchor={props.state.anchor} label={label} onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason() === undefined) void form.handleSubmit();
        }}
      >
        <h3>{label}</h3>
        <label class="input">
          <form.Field name="message">
            {(field) => (
              <input
                type="text"
                aria-label="Stash message"
                autocomplete="off"
                value={field().state.value}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
                ref={(element) => queueMicrotask(() => element.select())}
              />
            )}
          </form.Field>
        </label>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={reason() !== undefined}>
            Rename
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
