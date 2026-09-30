import { createForm } from "@tanstack/solid-form";
import { createSignal, For, Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { PlatformActions } from "../state/platformActions";
import { pullProblems, type PullDraft } from "../state/platformModel";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

export function CreatePullDialog(props: { snapshot: RepoSnapshot; platform: PlatformActions; draft: PullDraft }) {
  const [touched, setTouched] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  const matched = () => props.platform.matched();
  const targets = () => {
    const remote = matched()?.remote;
    return remote === undefined ? [] : props.snapshot.remote_branches.filter((name) => name.startsWith(`${remote}/`)).map((name) => name.slice(remote.length + 1)).filter((name) => name !== "HEAD");
  };
  const form = createForm(() => ({
    defaultValues: props.draft,
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      setFailure(await props.platform.create(value));
    },
  }));
  const values = form.useSelector((state) => state.values);
  const problems = () => pullProblems(values());
  const shown = (field: keyof ReturnType<typeof problems>) => (touched() ? problems()[field] : undefined);
  const unpushed = () => values().source !== "" && matched() !== undefined && !targets().includes(values().source);

  return (
    <DialogFrame title="New pull request" onEscape={props.platform.closeDialog}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (Object.keys(problems()).length === 0 && !form.state.isSubmitting) void form.handleSubmit();
        }}
      >
        <p class="setting-note">
          On {props.platform.platformTitle()} for{" "}
          <span class="mono">
            {matched()?.repo.owner}/{matched()?.repo.repo}
          </span>
        </p>
        <label class="field">
          <span class="field-label">Source branch</span>
          <span class="input" classList={{ invalid: shown("source") !== undefined }}>
            <form.Field name="source">
              {(field) => (
                <select aria-label="Source branch" value={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.value)}>
                  <option value="">Choose…</option>
                  <For each={props.snapshot.branches}>{(name) => <option value={name}>{name}</option>}</For>
                </select>
              )}
            </form.Field>
          </span>
          <Show when={shown("source")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
          <Show when={unpushed()}>
            <span class="field-note">
              <Icon name="warning" size={14} /> {values().source} is not on {matched()?.remote} yet. Push it first; the platform can only open a pull request from a pushed branch.
            </span>
          </Show>
        </label>
        <label class="field">
          <span class="field-label">Target branch</span>
          <span class="input" classList={{ invalid: shown("target") !== undefined }}>
            <form.Field name="target">
              {(field) => (
                <select aria-label="Target branch" value={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.value)}>
                  <option value="">Choose…</option>
                  <For each={targets()}>{(name) => <option value={name}>{name}</option>}</For>
                </select>
              )}
            </form.Field>
          </span>
          <Show when={shown("target")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <label class="field">
          <span class="field-label">Title</span>
          <span class="input" classList={{ invalid: shown("title") !== undefined }}>
            <form.Field name="title">
              {(field) => (
                <input
                  type="text"
                  aria-label="Title"
                  ref={(element) => queueMicrotask(() => element.focus())}
                  value={field().state.value}
                  aria-invalid={shown("title") !== undefined}
                  onInput={(event) => field().handleChange(event.currentTarget.value)}
                />
              )}
            </form.Field>
          </span>
          <Show when={shown("title")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <label class="field">
          <span class="field-label">Description</span>
          <span class="input area">
            <form.Field name="body">
              {(field) => <textarea aria-label="Description" rows={5} value={field().state.value} onInput={(event) => field().handleChange(event.currentTarget.value)} />}
            </form.Field>
          </span>
        </label>
        <Show when={failure()}>
          {(text) => (
            <p class="field-note error" role="alert">
              {text()}
            </p>
          )}
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.platform.closeDialog}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={form.state.isSubmitting} aria-busy={form.state.isSubmitting}>
            Create pull request
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
