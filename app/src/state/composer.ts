import type { AmendInfo } from "../ipc/bindings/AmendInfo";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";
import { createStoreFields } from "./clientStore";
import type { RepoSession } from "./repoSession";

export const SUMMARY_GUIDE = 72;

export const summaryRemaining = (summary: string): number => SUMMARY_GUIDE - Array.from(summary).length;

export type CommitButton = { label: string; disabledReason: string | undefined };

export function commitButton(input: { staged: number; summary: string; amend: boolean; busy: boolean }): CommitButton {
  if (input.busy) return { label: "Committing…", disabledReason: "Committing…" };
  const label = input.amend ? "Amend commit" : input.staged > 0 ? `Commit ${input.staged} ${input.staged === 1 ? "file" : "files"}` : "Commit";
  if (!input.amend && input.staged === 0) return { label, disabledReason: "Stage files to commit" };
  if (input.summary.trim() === "") return { label, disabledReason: "Write a summary to commit" };
  return { label, disabledReason: undefined };
}

export function stashButton(input: { files: ReadonlyArray<Pick<FileChange, "path" | "area">>; untracked: boolean; busy: boolean }): CommitButton {
  if (input.busy) return { label: "Stashing…", disabledReason: "Stashing…" };
  if (input.files.length === 0) return { label: "Stash", disabledReason: "No local changes to stash" };
  const taken = new Set(input.files.filter((file) => input.untracked || file.area !== "untracked").map((file) => file.path)).size;
  if (taken === 0) return { label: "Stash", disabledReason: "Only untracked files changed; include them to stash" };
  return { label: `Stash ${taken} ${taken === 1 ? "file" : "files"}`, disabledReason: undefined };
}

export const stashMessage = (title: string, description: string): string =>
  [title.trim(), description.trim()].filter((part) => part !== "").join("\n\n");

export function commitIdentityLabel(list: ProfileList | undefined): string | undefined {
  const profile = list?.profiles.find((candidate) => candidate.id === list.active);
  if (profile === undefined || (profile.author_name === "" && profile.author_email === "")) return undefined;
  return `Committing as ${profile.author_name} ${profile.author_email}`.trim();
}

export type ComposerTab = "commit" | "stash";

export function commitPushReason(input: {
  button: CommitButton;
  snapshot: Pick<RepoSnapshot, "head" | "remotes" | "operation">;
  amend: boolean;
  amendPushed: boolean;
  syncing: boolean;
}): string | undefined {
  if (input.button.disabledReason !== undefined) return input.button.disabledReason;
  if (input.snapshot.head.kind === "detached") return "Check out a branch to push";
  if (input.snapshot.remotes.length === 0) return "This repository has no remotes";
  if (input.snapshot.operation !== null) return "Finish the operation in progress first";
  if (input.syncing) return "Another sync is running";
  if (input.amend && input.amendPushed) return "This amend rewrites a pushed commit. Amend first, then use Force push";
  return undefined;
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
  const field = createStoreFields<{
    summary: string;
    description: string;
    amend: boolean;
    pushed: boolean;
    busy: boolean;
    failure: IpcError | undefined;
    tab: ComposerTab;
    stashTitle: string;
    stashDescription: string;
    stashUntracked: boolean;
    stashing: boolean;
  }>({
    summary: "",
    description: "",
    amend: false,
    pushed: false,
    busy: false,
    failure: undefined,
    tab: "commit",
    stashTitle: "",
    stashDescription: "",
    stashUntracked: false,
    stashing: false,
  });
  const [summary, setSummary] = field("summary");
  const [description, setDescription] = field("description");
  const [amend, setAmend] = field("amend");
  const [pushed, setPushed] = field("pushed");
  const [busy, setBusy] = field("busy");
  const [failure, setFailure] = field("failure");
  const [tab, setTab] = field("tab");
  const [stashTitle, setStashTitle] = field("stashTitle");
  const [stashDescription, setStashDescription] = field("stashDescription");
  const [stashUntracked, setStashUntracked] = field("stashUntracked");
  const [stashing, setStashing] = field("stashing");
  return {
    summary,
    setSummary,
    description,
    setDescription,
    amend,
    setAmend,
    pushed,
    setPushed,
    busy,
    setBusy,
    failure,
    setFailure,
    tab,
    setTab,
    stashTitle,
    setStashTitle,
    stashDescription,
    setStashDescription,
    stashUntracked,
    setStashUntracked,
    stashing,
    setStashing,
  };
}

export type Composer = ReturnType<typeof createComposer>;

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

export function createCommitAction(deps: {
  session: RepoSession;
  composer: Composer;
  staged: () => number;
  onCommitted: (sha: string) => void;
  push: () => Promise<void>;
}) {
  const { session, composer } = deps;
  const button = () =>
    commitButton({ staged: deps.staged(), summary: composer.summary(), amend: composer.amend(), busy: composer.busy() });

  async function submit(options: { push: boolean } = { push: false }): Promise<void> {
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
    if (!options.push) return;
    try {
      await deps.push();
    } catch (failure) {
      session.report(failure);
    }
  }

  async function toggleAmend(on: boolean): Promise<void> {
    composer.setFailure(undefined);
    if (!on) {
      composer.setAmend(false);
      composer.setPushed(false);
      return;
    }
    try {
      const info = await session.read(["amend"], () => client.amendInfo(session.path));
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
