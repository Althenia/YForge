import { createEffect, createSignal } from "solid-js";
import type { CommitDraft } from "../ipc/bindings/CommitDraft";
import { client } from "../ipc/client";
import { createAiRun } from "./aiRun";
import { SUMMARY_GUIDE, type Composer } from "./composer";
import { fileList } from "./fileList";
import type { RepoSession } from "./repoSession";

export function draftNotes(draft: Pick<CommitDraft, "excluded" | "truncated" | "summary_trimmed">): string[] {
  const notes: string[] = [];
  if (draft.excluded.length > 0) notes.push(`Withheld from the provider because they look like secrets: ${fileList(draft.excluded)}`);
  if (draft.truncated.length > 0) notes.push(`Cut to fit the size limit: ${fileList(draft.truncated)}`);
  if (draft.summary_trimmed) notes.push(`The summary was shortened to fit the ${SUMMARY_GUIDE} character guide.`);
  return notes;
}

export function createGenerateAction(deps: { session: RepoSession; composer: Composer }) {
  const { session, composer } = deps;
  const [drafted, setDrafted] = createSignal(false);
  const [notes, setNotes] = createSignal<string[]>([]);
  const [replaced, setReplaced] = createSignal<{ summary: string; description: string } | undefined>();
  const run = createAiRun(session.queryClient, (id) => client.aiGenerateCommitMessage(session.path, id));

  createEffect(() => {
    if (composer.summary() === "" && composer.description() === "") {
      setDrafted(false);
      setNotes([]);
      setReplaced(undefined);
    }
  });

  async function generate(): Promise<void> {
    setNotes([]);
    setReplaced(undefined);
    const draft = await run.start();
    if (draft === undefined) return;
    setDrafted(true);
    const previous = { summary: composer.summary(), description: composer.description() };
    if (previous.summary.trim() !== "" || previous.description.trim() !== "") setReplaced(previous);
    composer.setSummary(draft.summary);
    composer.setDescription(draft.description);
    setNotes(draftNotes(draft));
  }

  function restore(): void {
    const previous = replaced();
    if (previous === undefined) return;
    composer.setSummary(previous.summary);
    composer.setDescription(previous.description);
    setReplaced(undefined);
  }

  return { run: generate, cancel: run.cancel, running: run.running, failure: run.failure, dismissFailure: run.dismiss, drafted, notes, replaced, restore };
}

export type GenerateAction = ReturnType<typeof createGenerateAction>;
