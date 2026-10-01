import { createSignal } from "solid-js";
import type { MatchedRepo } from "../ipc/bindings/MatchedRepo";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import { client, type PrListState } from "../ipc/client";
import type { ConfirmCopy } from "./confirmCopy";
import { cardOfPlatform, defaultTarget, mergeCopy, platformFailure, type PlatformFailure, type PullDraft } from "./platformModel";
import { matchOptions, pullsOptions } from "./platformQueries";
import { cappedText, countOf } from "./listCount";
import { platformKeys } from "./queryKeys";
import { useQuery } from "./query";
import type { RepoSession } from "./repoSession";

export type PullDialog = { draft: PullDraft };

export type PullConfirm = { copy: ConfirmCopy; run: () => Promise<void> };

export type PlatformDeps = {
  notify: (message: string) => void;
  fetchAll: () => Promise<void>;
  openSettings: () => void;
};

export function createPlatformActions(session: RepoSession, deps: PlatformDeps) {
  const path = session.path;
  const match = useQuery(() => matchOptions(path), () => session.queryClient);
  const matched = (): MatchedRepo | undefined => match.data ?? undefined;
  const [listState, setListState] = createSignal<PrListState>("open");
  const pulls = useQuery(() => pullsOptions(path, listState(), matched() !== undefined), () => session.queryClient);
  const [dialog, setDialog] = createSignal<PullDialog | undefined>();
  const [confirm, setConfirm] = createSignal<PullConfirm | undefined>();

  const platformTitle = (): string => {
    const current = matched();
    return current === undefined ? "the platform" : cardOfPlatform(current.connection.kind).title;
  };

  const refreshPulls = () =>
    Promise.all([session.queryClient.invalidateQueries({ queryKey: platformKeys.prsOf(path) }), session.queryClient.invalidateQueries({ queryKey: platformKeys.prsDetailOf(path) })]);

  async function runMerge(pull: PullRequest): Promise<void> {
    try {
      await client.platformPrMerge(path, pull.number);
    } catch (failure) {
      session.inform(platformFailure(failure).message);
      return;
    }
    await refreshPulls();
    await deps.fetchAll();
    deps.notify(`Merged pull request #${pull.number} into ${pull.target_ref} on ${platformTitle()}.`);
  }

  async function headSubject(): Promise<string> {
    try {
      return (await session.read(["head-subject"], () => client.amendInfo(path))).summary;
    } catch (failure) {
      session.report(failure);
      return "";
    }
  }

  return {
    matched,
    matchFailure: (): PlatformFailure | undefined => (match.error == null ? undefined : platformFailure(match.error)),
    pulls: (): PullRequest[] => pulls.data?.pulls ?? [],
    pullsTotal: (): number => (pulls.data === undefined ? 0 : countOf(pulls.data.pulls.length, pulls.data)),
    pullsCappedText: (): string | undefined => (pulls.data === undefined ? undefined : cappedText(pulls.data)),
    loading: () => pulls.isFetching,
    failure: (): PlatformFailure | undefined => (pulls.error == null ? undefined : platformFailure(pulls.error)),
    listState,
    setListState,
    platformTitle,
    dialog,
    closeDialog: () => setDialog(undefined),
    confirm,
    closeConfirm: () => setConfirm(undefined),
    editConnection: deps.openSettings,
    async openCreate(): Promise<void> {
      const current = matched();
      if (current === undefined) return;
      const snapshot = session.snapshot();
      setDialog({
        draft: {
          source: snapshot.head.kind === "branch" ? snapshot.head.name : "",
          target: defaultTarget(snapshot.remote_branches, current.remote) ?? "",
          title: await headSubject(),
          body: "",
        },
      });
    },
    async create(draft: PullDraft): Promise<string | undefined> {
      try {
        const pull = await client.platformPrCreate(path, { source_ref: draft.source, target_ref: draft.target, title: draft.title.trim(), body: draft.body });
        setDialog(undefined);
        await refreshPulls();
        deps.notify(`Created pull request #${pull.number}: ${pull.web_url}`);
        return undefined;
      } catch (failure) {
        return platformFailure(failure).message;
      }
    },
    requestMerge(pull: PullRequest): void {
      if (pull.state !== "open") {
        deps.notify(`Pull request #${pull.number} is already ${pull.state}.`);
        return;
      }
      setConfirm({ copy: mergeCopy(pull, platformTitle()), run: () => runMerge(pull) });
    },
    openInBrowser(pull: Pick<PullRequest, "web_url">): void {
      try {
        client.openUrl(pull.web_url);
      } catch (failure) {
        session.report(failure);
      }
    },
  };
}

export type PlatformActions = ReturnType<typeof createPlatformActions>;
