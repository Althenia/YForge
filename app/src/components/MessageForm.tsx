import { createForm } from "@tanstack/solid-form";
import { createSignal, onMount, Show } from "solid-js";
import type { AmendInfo } from "../ipc/bindings/AmendInfo";
import type { MessageEdit } from "../ipc/bindings/MessageEdit";
import { client } from "../ipc/client";
import { amendWarning, summaryRemaining } from "../state/composer";
import type { RepoSession } from "../state/repoSession";

const summaryProblem = (summary: string): string | undefined => (summary.trim() === "" ? "Enter a summary" : undefined);

function Fields(props: { session: RepoSession; info: AmendInfo; onClose: () => void; onSaved: (sha: string) => void }) {
  const upstream = props.session.snapshot().upstream?.name;
  const form = createForm(() => ({
    defaultValues: { summary: props.info.summary, description: props.info.description },
    validators: { onMount: ({ value }) => summaryProblem(value.summary), onChange: ({ value }) => summaryProblem(value.summary) },
    onSubmit: async ({ value }) => {
      let edit: MessageEdit | undefined;
      const saved = await props.session.mutate(async () => {
        edit = await client.editHeadMessage(props.session.path, props.info.sha, value.summary, value.description);
      });
      if (!saved || edit === undefined) return;
      const warning = edit.pushed ? amendWarning(true, upstream) : undefined;
      if (warning !== undefined) props.session.inform(warning);
      props.onSaved(edit.sha);
      props.onClose();
    },
  }));
  const reason = form.useSelector((state) => state.errors[0] as string | undefined);
  const busy = form.useSelector((state) => state.isSubmitting);

  return (
    <form
      class="msgform"
      aria-label="Edit message"
      aria-busy={busy()}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <label class="input">
        <form.Field name="summary">
          {(field) => (
            <>
              <input
                type="text"
                autofocus
                aria-label="Summary"
                placeholder="Summary"
                value={field().state.value}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
              />
              <span class="count" classList={{ over: summaryRemaining(field().state.value) < 0 }} aria-label={`${summaryRemaining(field().state.value)} characters left in the 72 character guide`}>
                {summaryRemaining(field().state.value)}
              </span>
            </>
          )}
        </form.Field>
      </label>
      <label class="input area">
        <form.Field name="description">
          {(field) => (
            <textarea
              aria-label="Description"
              placeholder="Description"
              value={field().state.value}
              onInput={(event) => field().handleChange(event.currentTarget.value)}
            />
          )}
        </form.Field>
      </label>
      <Show when={props.info.pushed}>
        <div class="note attention" role="status">{amendWarning(true, upstream)}</div>
      </Show>
      <div class="hrow">
        <button type="submit" class="btn primary" disabled={reason() !== undefined || busy()}>
          Save message
        </button>
        <button type="button" class="btn" onClick={props.onClose}>
          Cancel
        </button>
        <Show when={reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
      </div>
    </form>
  );
}

export function MessageForm(props: { session: RepoSession; onClose: () => void; onSaved: (sha: string) => void }) {
  const [info, setInfo] = createSignal<AmendInfo | undefined>();
  onMount(() => {
    props.session.read(["amend"], () => client.amendInfo(props.session.path)).then(setInfo, (failure) => {
      props.session.report(failure);
      props.onClose();
    });
  });
  return <Show when={info()}>{(loaded) => <Fields session={props.session} info={loaded()} onClose={props.onClose} onSaved={props.onSaved} />}</Show>;
}
