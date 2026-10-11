import { createMemo, createSignal } from "solid-js";
import type { CreatePull } from "../ipc/bindings/CreatePull";
import type { MatchedRepo } from "../ipc/bindings/MatchedRepo";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import { client, type PrListState } from "../ipc/client";
import type { ConfirmCopy } from "./confirmCopy";
import { cardOfPlatform, defaultTarget, mergeCopy, platformFailure, pullLookup, type PlatformFailure, type PullLookup } from "./platformModel";
import { matchOptions, pullsOptions } from "./platformQueries";
import { cappedText, countOf } from "./listCount";
import { platformKeys } from "./queryKeys";
import { useQuery } from "./query";
import type { RepoSession } from "./repoSession";

export type ComposeRequest = { source: string; target: string; title: string };

export type PullConfirm = { copy: ConfirmCopy; run: () => Promise<void> };

export type PlatformDeps = {
  notify: (message: string) => void;
  fetchAll: () => Promise<void>;
  openSettings: () => void;
  announce: (message: string, show: () => void) => void;
  showPull: (number: number) => void;
};

export function createPlatformActions(session: RepoSession, deps: PlatformDeps) {
  const path = session.path;
  const match = useQuery(() => matchOptions(path), () => session.queryClient);
  const matched = (): MatchedRepo | undefined => match.data ?? undefined;
  const [listState, setListState] = createSignal<PrListState>("open");
  const pulls = useQuery(() => pullsOptions(path, listState(), matched() !== undefined), () => session.queryClient);
  const lookup = createMemo((): PullLookup | undefined => {
    const current = matched();
    return current === undefined ? undefined : pullLookup(current.remote, pulls.data?.pulls ?? []);
  });
  const [compose, setCompose] = createSignal<ComposeRequest | undefined>();
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
      session.report(failure);
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
    pullLookup: lookup,
    pullsTotal: (): number => (pulls.data === undefined ? 0 : countOf(pulls.data.pulls.length, pulls.data)),
    pullsCappedText: (): string | undefined => (pulls.data === undefined ? undefined : cappedText(pulls.data)),
    loading: () => pulls.isFetching,
    failure: (): PlatformFailure | undefined => (pulls.error == null ? undefined : platformFailure(pulls.error)),
    listState,
    setListState,
    platformTitle,
    compose,
    closeCompose: () => setCompose(undefined),
    confirm,
    closeConfirm: () => setConfirm(undefined),
    editConnection: deps.openSettings,
    async openCompose(defaults: { source?: string; target?: string } = {}): Promise<void> {
      const current = matched();
      if (current === undefined) return;
      const snapshot = session.snapshot();
      setCompose({
        source: defaults.source ?? (snapshot.head.kind === "branch" ? snapshot.head.name : ""),
        target: defaults.target ?? defaultTarget(snapshot.remote_branches, current.remote) ?? "",
        title: await headSubject(),
      });
    },
    async createPull(input: CreatePull): Promise<PullRequest> {
      const pull = await client.platformPrCreate(path, input);
      setCompose(undefined);
      await refreshPulls();
      deps.announce(`Created pull request #${pull.number}`, () => deps.showPull(pull.number));
      return pull;
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
