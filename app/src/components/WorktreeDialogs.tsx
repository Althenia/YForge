import { createForm } from "@tanstack/solid-form";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import type { WorktreeActions } from "../state/worktreeActions";
import { createBlock, defaultIntegrationTarget, existingBranchChoices, integrateCopy, integrationTargets, newBranchProblem, startPointChoices, type CreateMode } from "../state/worktreeModel";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

export function CreateWorktreeDialog(props: { snapshot: RepoSnapshot; actions: WorktreeActions }) {
  const existing = () => existingBranchChoices(props.snapshot.branches, props.snapshot.worktrees);
  const [edited, setEdited] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  const form = createForm(() => ({
    defaultValues: { mode: "new" as CreateMode, branch: "", start: "", destination: "" },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setFailure(undefined);
      setFailure(await props.actions.create(value));
      setBusy(false);
    },
  }));
  const mode = form.useSelector((state) => state.values.mode);
  const branch = form.useSelector((state) => state.values.branch);
  const destination = form.useSelector((state) => state.values.destination);
  const block = () => createBlock(mode(), branch(), destination(), props.snapshot.branches);
  const ready = () => block() === undefined && !busy();

  createEffect(
    on([branch, mode], async ([name, current]) => {
      if (edited() || name === "" || (current === "new" && newBranchProblem(name, props.snapshot.branches) !== undefined)) return;
      try {
        const suggested = await props.actions.suggest(name);
        if (branch() === name && !edited()) form.setFieldValue("destination", suggested);
      } catch {
        return;
      }
    }),
  );

  const choose = (next: CreateMode) => {
    form.setFieldValue("mode", next);
    form.setFieldValue("branch", next === "existing" ? (existing()[0] ?? "") : "");
    setEdited(false);
  };

  return (
    <DialogFrame title="Create worktree" onEscape={props.actions.closeDialog}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready()) void form.handleSubmit();
        }}
      >
        <div class="segmented" role="radiogroup" aria-label="Branch source">
          <button type="button" role="radio" aria-checked={mode() === "new"} classList={{ on: mode() === "new" }} onClick={() => choose("new")}>
            New branch
          </button>
          <button type="button" role="radio" aria-checked={mode() === "existing"} classList={{ on: mode() === "existing" }} onClick={() => choose("existing")}>
            Existing branch
          </button>
        </div>
        <Show
          when={mode() === "new"}
          fallback={
            <label class="field">
              <span class="field-label">Branch</span>
              <span class="input">
                <form.Field name="branch">
                  {(field) => (
                    <select aria-label="Branch" value={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.value)}>
                      <For each={existing()}>{(name) => <option value={name}>{name}</option>}</For>
                    </select>
                  )}
                </form.Field>
              </span>
              <Show when={existing().length === 0}>
                <span class="field-note">Every local branch is already checked out in a worktree.</span>
              </Show>
            </label>
          }
        >
          <label class="field">
            <span class="field-label">Branch name</span>
            <span class="input" classList={{ invalid: branch() !== "" && newBranchProblem(branch(), props.snapshot.branches) !== undefined }}>
              <form.Field name="branch">
                {(field) => <input type="text" spellcheck={false} autocapitalize="off" ref={(element) => queueMicrotask(() => element.focus())} value={field().state.value} aria-label="Branch name" onInput={(event) => field().handleChange(event.currentTarget.value)} />}
              </form.Field>
            </span>
            <Show when={branch() !== "" && newBranchProblem(branch(), props.snapshot.branches)}>{(text) => <span class="field-note error">{text()}</span>}</Show>
          </label>
          <label class="field">
            <span class="field-label">Start from</span>
            <span class="input">
              <form.Field name="start">
                {(field) => (
                  <select aria-label="Start from" value={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.value)}>
                    <For each={startPointChoices(props.snapshot.branches, props.snapshot.remote_branches)}>{(choice) => <option value={choice.value}>{choice.label}</option>}</For>
                  </select>
                )}
              </form.Field>
            </span>
          </label>
        </Show>
        <label class="field">
          <span class="field-label">Folder</span>
          <span class="input">
            <form.Field name="destination">
              {(field) => (
                <input
                  type="text"
                  spellcheck={false}
                  autocapitalize="off"
                  value={field().state.value}
                  aria-label="Folder"
                  onInput={(event) => {
                    setEdited(true);
                    field().handleChange(event.currentTarget.value);
                  }}
                />
              )}
            </form.Field>
          </span>
          <span class="field-note">The folder must not exist or must be empty. It is created with <code>git worktree add</code>.</span>
        </label>
        <Show when={failure()}>
          {(text) => (
            <p class="field-note error" role="alert">
              {text()}
            </p>
          )}
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.actions.closeDialog}>
            Cancel
          </button>
          <Show when={block()}>{(reason) => <span class="reason">{reason()}</span>}</Show>
          <button type="submit" class="btn primary" disabled={!ready()}>
            <Icon name="plus" />
            Create worktree
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function IntegrateWorktreeDialog(props: { worktree: WorktreeStatus; all: readonly WorktreeStatus[]; actions: WorktreeActions }) {
  const targets = () => integrationTargets(props.worktree, props.all);
  const [target, setTarget] = createSignal(defaultIntegrationTarget(targets()));
  const [cleanup, setCleanup] = createSignal(true);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  const branch = () => props.worktree.branch ?? "";
  const copy = () => integrateCopy(props.worktree, target(), cleanup());

  async function submit(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setFailure(await props.actions.submitIntegrate(branch(), props.worktree.path, target(), cleanup()));
    setBusy(false);
  }

  return (
    <DialogFrame title={copy().title} onEscape={props.actions.closeDialog}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy()) void submit();
        }}
      >
        <label class="field">
          <span class="field-label">Integrate into</span>
          <span class="input">
            <select aria-label="Target branch" value={target()} onChange={(event) => setTarget(event.currentTarget.value)}>
              <For each={targets()}>{(entry) => <option value={entry.branch}>{entry.branch}</option>}</For>
            </select>
          </span>
          <span class="field-note">
            The target must be checked out in a worktree: <span class="ref">{targets().find((entry) => entry.branch === target())?.path}</span>
          </span>
        </label>
        <label class="choice">
          <input type="checkbox" checked={cleanup()} onChange={(event) => setCleanup(event.currentTarget.checked)} />
          <span class="choice-text">Remove the worktree and delete {branch()} afterwards</span>
        </label>
        <For each={copy().consequences}>{(line) => <p class="field-note">{line}</p>}</For>
        <Show when={failure()}>
          {(text) => (
            <p class="field-note error" role="alert">
              {text()}
            </p>
          )}
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.actions.closeDialog}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={busy() || target() === ""}>
            <Icon name="merge" />
            Integrate
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
