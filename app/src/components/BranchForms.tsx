import { createForm } from "@tanstack/solid-form";
import { useQuery } from "../state/query";
import { createEffect, Show } from "solid-js";
import { client } from "../ipc/client";
import { branchNameProblem } from "../state/branchName";
import { repoKeys } from "../state/queryKeys";
import { changeTotal } from "../state/changes";
import { startPointText } from "../state/refMenu";
import type { PopoverState, RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { Popover } from "./Popover";

type BranchPopover = Extract<PopoverState, { kind: "create_branch" | "rename_branch" }>;
type StashPopover = Extract<PopoverState, { kind: "stash" }>;

export function BranchNameForm(props: { state: BranchPopover; session: RepoSession; actions: RepoActions }) {
  const renaming = () => (props.state.kind === "rename_branch" ? props.state.name : undefined);
  const existing = props.session.snapshot().branches;
  const startSha = () => (props.state.kind === "create_branch" && /^[0-9a-f]{4,64}$/.test(props.state.at ?? "") ? props.state.at : null);
  const summary = useQuery(() => ({
    queryKey: repoKeys.commit(props.session.path, startSha() ?? ""),
    queryFn: () => client.commitDetails(props.session.path, startSha() as string),
    enabled: startSha() !== null,
  }));
  const startText = () => (props.state.kind === "create_branch" ? startPointText(props.state.at, summary.data?.summary) : undefined);
  const title = () => (props.state.kind === "rename_branch" ? `Rename ${props.state.name}` : "Create branch");

  const form = createForm(() => ({
    defaultValues: { name: renaming() ?? "", checkOut: true },
    onSubmit: ({ value }) => {
      const state = props.state;
      if (state.kind === "rename_branch") {
        props.actions.closePopover();
        void props.actions.renameBranch(state.name, value.name);
      } else void props.actions.submitCreateBranch(value.name, value.checkOut);
    },
  }));
  const nameState = form.useSelector((state) => state.fieldMeta.name);
  const name = form.useSelector((state) => state.values.name);
  const problem = () => nameState()?.errors.find((error): error is string => typeof error === "string");
  const valid = () => name() !== "" && nameState()?.isValidating !== true && problem() === undefined;
  const reason = () => {
    if (name() === "") return "Enter a branch name";
    return problem() ?? (valid() ? undefined : "Checking the name…");
  };
  const checkName = async (value: string): Promise<string | undefined> => {
    if (value === "") return undefined;
    try {
      await props.session.read(["branch-name", value], () => client.checkBranchName(props.session.path, value));
      return undefined;
    } catch {
      return `${value} is not a valid branch name`;
    }
  };

  return (
    <Popover anchor={props.state.anchor} label={title()} onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid()) void form.handleSubmit();
        }}
      >
        <h3>{title()}</h3>
        <Show when={startText()}>{(text) => <p class="start-point ref">{text()}</p>}</Show>
        <label class="input">
          <form.Field
            name="name"
            validators={{
              onMount: ({ value }) => branchNameProblem(value, existing, renaming()),
              onChange: ({ value }) => branchNameProblem(value, existing, renaming()),
              onChangeAsync: ({ value }) => checkName(value),
            }}
          >
            {(field) => (
              <input
                type="text"
                aria-label="Branch name"
                placeholder="Branch name"
                spellcheck={false}
                autocomplete="off"
                value={field().state.value}
                aria-invalid={problem() !== undefined}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
                ref={(element) => queueMicrotask(() => element.select())}
              />
            )}
          </form.Field>
        </label>
        <Show when={props.state.kind === "create_branch"}>
          <label class="check">
            <form.Field name="checkOut">
              {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
            </form.Field>
            Check out the new branch
          </label>
        </Show>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={!valid()}>
            {props.state.kind === "rename_branch" ? "Rename" : "Create"}
          </button>
          <button type="button" class="btn" onClick={props.actions.closePopover}>
            Cancel
          </button>
          <Show when={reason()}>{(text) => <span class="reason" role={problem() === undefined ? undefined : "alert"}>{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}

export function StashForm(props: { state: StashPopover; session: RepoSession; actions: RepoActions }) {
  const counts = () => props.session.snapshot().counts;
  const stashProblem = (untracked: boolean): string | undefined => {
    if (changeTotal(counts()) === 0) return "No local changes to stash";
    if (changeTotal(counts()) === counts().untracked && !untracked) return "Only untracked files changed; include them to stash";
    return undefined;
  };
  const form = createForm(() => ({
    defaultValues: { message: "", untracked: false },
    validators: { onMount: ({ value }) => stashProblem(value.untracked), onChange: ({ value }) => stashProblem(value.untracked) },
    onSubmit: ({ value }) => {
      props.actions.closePopover();
      void props.actions.stashChanges(value.message, value.untracked);
    },
  }));
  createEffect(() => {
    counts();
    void form.validate("change");
  });
  const reason = form.useSelector((state) => state.errors[0] as string | undefined);

  return (
    <Popover anchor={props.state.anchor} label="Stash changes" onClose={props.actions.closePopover}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h3>Stash changes</h3>
        <label class="input">
          <form.Field name="message">
            {(field) => (
              <input
                type="text"
                aria-label="Stash message"
                placeholder="Message (optional)"
                autocomplete="off"
                value={field().state.value}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
              />
            )}
          </form.Field>
        </label>
        <label class="check">
          <form.Field name="untracked">
            {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
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
