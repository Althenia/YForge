import { createSignal } from "solid-js";
import type { AmendInfo } from "../ipc/bindings/AmendInfo";
import { client, IpcError } from "../ipc/client";
import type { RepoSession } from "./repoSession";

export const SUMMARY_GUIDE = 72;

export const summaryRemaining = (summary: string): number => SUMMARY_GUIDE - Array.from(summary).length;

export type CommitButton = { label: string; disabledReason: string | undefined };

export function commitButton(input: { staged: number; summary: string; amend: boolean; busy: boolean }): CommitButton {
  if (input.busy) return { label: "Committing…", disabledReason: "Committing…" };
  const label = input.amend ? "Amend commit" : input.staged > 0 ? `Commit ${input.staged} ${input.staged === 1 ? "file" : "files"}` : "Commit";
  if (!input.amend && input.staged === 0) return { label, disabledReason: "Stage files to commit" };
  if (input.summary.trim() === "") return { label, disabledReason: "Enter a summary" };
  return { label, disabledReason: undefined };
}

export function amendWarning(pushed: boolean, upstream: string | undefined): string | undefined {
  if (!pushed) return undefined;
  return `This commit is already on ${upstream ?? "its upstream"}. Amending rewrites it, and the next push needs a force push.`;
}

export type Draft = { summary: string; description: string };

export const amendDraft = (current: Draft, info: Pick<AmendInfo, "summary" | "description">): Draft =>
  current.summary.trim() === "" && current.description.trim() === ""
    ? { summary: info.summary, description: info.description }
    : current;

export function createComposer() {
  const [summary, setSummary] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [amend, setAmend] = createSignal(false);
  const [pushed, setPushed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<IpcError | undefined>();
  return { summary, setSummary, description, setDescription, amend, setAmend, pushed, setPushed, busy, setBusy, failure, setFailure };
}

export type Composer = ReturnType<typeof createComposer>;

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

export function createCommitAction(deps: {
  session: RepoSession;
  composer: Composer;
  staged: () => number;
  onCommitted: (sha: string) => void;
}) {
  const { session, composer } = deps;
  const button = () =>
    commitButton({ staged: deps.staged(), summary: composer.summary(), amend: composer.amend(), busy: composer.busy() });

  async function submit(): Promise<void> {
    if (button().disabledReason !== undefined) return;
    composer.setBusy(true);
    composer.setFailure(undefined);
    let sha: string;
    try {
      sha = await client.commit(session.path, composer.summary(), composer.description(), composer.amend());
    } catch (failure) {
      composer.setFailure(asIpcError(failure));
      return;
    } finally {
      composer.setBusy(false);
    }
    composer.setSummary("");
    composer.setDescription("");
    composer.setAmend(false);
    composer.setPushed(false);
    await session.refresh();
    deps.onCommitted(sha);
  }

  async function toggleAmend(on: boolean): Promise<void> {
    composer.setFailure(undefined);
    if (!on) {
      composer.setAmend(false);
      composer.setPushed(false);
      return;
    }
    try {
      const info = await client.amendInfo(session.path);
      const draft = amendDraft({ summary: composer.summary(), description: composer.description() }, info);
      composer.setSummary(draft.summary);
      composer.setDescription(draft.description);
      composer.setPushed(info.pushed);
      composer.setAmend(true);
    } catch (failure) {
      composer.setFailure(asIpcError(failure));
    }
  }

  return { button, submit, toggleAmend };
}
