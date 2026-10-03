import { createEffect, createSignal } from "solid-js";
import { client } from "../ipc/client";
import { sourceNotes } from "./aiSheet";
import { createAiRun } from "./aiRun";
import type { Composer } from "./composer";
import type { RepoSession } from "./repoSession";

export function createStashMessageAction(deps: { session: RepoSession; composer: Composer }) {
  const { session, composer } = deps;
  const [drafted, setDrafted] = createSignal(false);
  const [notes, setNotes] = createSignal<string[]>([]);
  const [replaced, setReplaced] = createSignal<{ title: string; description: string } | undefined>();
  const run = createAiRun(session.queryClient, (id) => client.aiStashMessage(session.path, id));

  createEffect(() => {
    if (composer.stashTitle() === "" && composer.stashDescription() === "") {
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
    const previous = { title: composer.stashTitle(), description: composer.stashDescription() };
    if (previous.title.trim() !== "" || previous.description.trim() !== "") setReplaced(previous);
    composer.setStashTitle(draft.summary);
    composer.setStashDescription(draft.description);
    setNotes(sourceNotes(draft));
  }

  function restore(): void {
    const previous = replaced();
    if (previous === undefined) return;
    composer.setStashTitle(previous.title);
    composer.setStashDescription(previous.description);
    setReplaced(undefined);
  }

  return { run: generate, cancel: run.cancel, running: run.running, failure: run.failure, drafted, notes, replaced, restore };
}

export type StashMessageAction = ReturnType<typeof createStashMessageAction>;
