import { createForm } from "@tanstack/solid-form";
import { createSignal, onMount, Show } from "solid-js";
import type { AmendInfo } from "../ipc/bindings/AmendInfo";
import type { MessageEdit } from "../ipc/bindings/MessageEdit";
import { client } from "../ipc/client";
import { draftNotes } from "../state/aiGenerate";
import { createAiRun } from "../state/aiRun";
import { useApp } from "../state/app";
import { amendWarning, summaryRemaining } from "../state/composer";
import type { RepoSession } from "../state/repoSession";
import { AiFailureNote } from "./AiFailureNote";
import { FieldAi } from "./Composer";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

const summaryProblem = (summary: string): string | undefined => (summary.trim() === "" ? "Enter a summary" : undefined);

function Fields(props: { session: RepoSession; info: AmendInfo; generateAvailable: boolean; onClose: () => void; onSaved: (sha: string) => void }) {
  const upstream = props.session.snapshot().upstream?.name;
  const app = useApp();
  const ai = createAiRun(props.session.queryClient, (id) => client.aiGenerateAmendMessage(props.session.path, id));
  const [drafted, setDrafted] = createSignal(false);
  const [replaced, setReplaced] = createSignal<{ summary: string; description: string } | undefined>();
  const [notes, setNotes] = createSignal<string[]>([]);
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

  const generate = async () => {
    const previous = { ...form.state.values };
    const draft = await ai.start();
    if (draft === undefined) return;
    setReplaced(previous);
    setDrafted(true);
    form.setFieldValue("summary", draft.summary);
    form.setFieldValue("description", draft.description);
    setNotes(draftNotes(draft));
  };
  const restore = () => {
    const previous = replaced();
    if (previous === undefined) return;
    form.setFieldValue("summary", previous.summary);
    form.setFieldValue("description", previous.description);
    setDrafted(false);
    setReplaced(undefined);
    setNotes([]);
  };

  return (
    <form
      class="msgform"
      aria-label="Edit message"
      aria-busy={busy() || ai.running()}
      onSubmit={(event) => {
        event.preventDefault();
        if (!ai.running() && !busy()) void form.handleSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (ai.running()) ai.cancel();
          else if (!busy()) props.onClose();
        }
      }}
    >
      <label class="input summary-field" classList={{ drafted: drafted() }}>
        <form.Field name="summary">
          {(field) => (
            <>
              <input
                type="text"
                autofocus
                aria-label="Summary"
                placeholder="Summary"
                disabled={busy() || ai.running()}
                value={field().state.value}
                onInput={(event) => field().handleChange(event.currentTarget.value)}
              />
              <span class="count" classList={{ over: summaryRemaining(field().state.value) < 0 }} aria-label={`${summaryRemaining(field().state.value)} characters left in the 72 character guide`}>
                {summaryRemaining(field().state.value)}
              </span>
              <Show when={drafted()} fallback={
                <FieldAi visible={props.generateAvailable} running={ai.running()} action="Generate a commit message from the resulting commit" reason={busy() ? "Saving message…" : undefined} busy="Generating a commit message…" cancel="Cancel generating" onRun={() => void generate()} onCancel={ai.cancel} />
              }>
                <span role="img" class="ai-mark" {...tip("Draft from the resulting commit. Review and edit it; nothing is saved until you save the message.")}><Icon name="wand" size={14} /></span>
                <button type="button" class="icon-btn dense field-btn" {...tip("Restore my text")} onClick={restore}><Icon name="undo" size={14} /></button>
              </Show>
            </>
          )}
        </form.Field>
      </label>
      <form.Field name="description">
        {(field) => <TextArea label="Description" placeholder="Description" value={field().state.value} disabled={busy() || ai.running()} onInput={(value) => field().handleChange(value)} />}
      </form.Field>
      <Show when={drafted() && notes().length > 0}><ul class="draft-notes" role="status">{notes().map((note) => <li>{note}</li>)}</ul></Show>
      <Show when={ai.failure()}>{(failure) => <AiFailureNote failure={failure()} onOpenAiSettings={() => app.openSettings("ai")} />}</Show>
      <Show when={props.info.pushed}>
        <div class="note attention" role="status">{amendWarning(true, upstream)}</div>
      </Show>
      <div class="hrow">
        <button type="submit" class="btn primary" disabled={reason() !== undefined || busy() || ai.running()}>
          Save message
        </button>
        <button type="button" class="btn" disabled={busy()} onClick={() => ai.running() ? ai.cancel() : props.onClose()}>
          Cancel
        </button>
        <Show when={reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
      </div>
    </form>
  );
}

export function MessageForm(props: { session: RepoSession; generateAvailable: boolean; onClose: () => void; onSaved: (sha: string) => void }) {
  const [info, setInfo] = createSignal<AmendInfo | undefined>();
  onMount(() => {
    props.session.read(["amend"], () => client.amendInfo(props.session.path)).then(setInfo, (failure) => {
      props.session.report(failure);
      props.onClose();
    });
  });
  return <Show when={info()}>{(loaded) => <Fields session={props.session} info={loaded()} generateAvailable={props.generateAvailable} onClose={props.onClose} onSaved={props.onSaved} />}</Show>;
}
