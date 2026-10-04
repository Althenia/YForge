import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import { createSignal } from "solid-js";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { AutoStash } from "../ipc/bindings/AutoStash";
import type { CheckoutTarget } from "../ipc/bindings/CheckoutTarget";
import type { BatchOutcome } from "../ipc/bindings/BatchOutcome";
import type { ForcePushPlan } from "../ipc/bindings/ForcePushPlan";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import type { MergeMode } from "../ipc/bindings/MergeMode";
import type { OperationOutcome } from "../ipc/bindings/OperationOutcome";
import type { OperationProgress } from "../ipc/bindings/OperationProgress";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import type { RevisionRange } from "../ipc/bindings/RevisionRange";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { PullOutcome } from "../ipc/bindings/PullOutcome";
import type { PullStash } from "../ipc/bindings/PullStash";
import type { PushTarget } from "../ipc/bindings/PushTarget";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import type { StashRestore } from "../ipc/bindings/StashRestore";
import type { IconName } from "../iconNames";
import { client, IpcError } from "../ipc/client";
import { changeTotal } from "./changes";
import {
  deleteBranchAndRemoteCopy,
  deleteBranchCopy,
  deleteBranchesCopy,
  deleteRemoteBranchCopy,
  deleteRemoteTagCopy,
  deleteTagCopy,
  deleteTagsCopy,
  detachCopy,
  dropStashCopy,
  dropStashesCopy,
  forcePushCopy,
  pullStashKeptCopy,
  rebaseCopy,
  resetCopy,
  stashAndSwitchCopy,
  undoForcePushCopy,
  type ConfirmCopy,
} from "./confirmCopy";
import { abortCopy } from "./operationModel";
import {
  branchPickerMenu,
  commitMenu,
  dropBase,
  dropPlan,
  localTarget,
  pushRemote,
  refMenu,
  remoteOf,
  resetModeMenu,
  shortRefName,
  startLabel,
  stashMenu,
  type MenuContext,
  type MenuEntry,
  type MenuPart,
  type RefTarget,
} from "./refMenu";
import type { RepoSession } from "./repoSession";
import { announceOperation } from "./operationLabels";
import { createFileOps } from "./fileOps";
import type { FileViewTarget } from "./fileView";
import { authFailure, authFix, divergedPushDetail, fetchMenu, isDiverged, pullMenu, type AuthFix, type SyncState } from "./syncModel";

const PREVIEW_CONCURRENCY = 4;

async function inBatches<T, R>(items: readonly T[], size: number, load: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let at = 0; at < items.length; at += size) results.push(...(await Promise.all(items.slice(at, at + size).map(load))));
  return results;
}

export type Anchor = { left: number; top: number };

export type MenuState = { anchor: Anchor; entries: MenuEntry[]; run: (id: string) => void; title?: MenuPart[] };

export type PopoverState =
  | { kind: "create_branch"; anchor: Anchor; at: string | null; atLabel: string; name?: string }
  | { kind: "rename_branch"; anchor: Anchor; name: string }
  | { kind: "stash"; anchor: Anchor }
  | { kind: "merge"; anchor: Anchor; source: string; current: string; preview: IntegrationPreview }
  | { kind: "create_tag"; anchor: Anchor; at: string | null; atLabel: string; remote: string | undefined }
  | { kind: "set_upstream"; anchor: Anchor; branch: string }
  | { kind: "push_to"; anchor: Anchor }
  | { kind: "rename_stash"; anchor: Anchor; stash: StashEntry };

export type HistoryView =
  | { kind: "rebase"; base: string; from: string }
  | { kind: "squash"; shas: readonly string[] }
  | { kind: "recompose"; base: string | undefined };

export type HistoryRow = { root?: boolean; squashReason?: string };

export type StripNotice = { id: string; text: string; icon?: IconName; detail?: string; dismiss?: boolean; actions: Array<{ label: string; run: () => void | Promise<void> }> };

export type DialogState = { copy: ConfirmCopy; run: () => void | Promise<void> };

type SyncName = "Fetch" | "Pull" | "Push" | "Push to" | "Publish" | "Force push" | "Push tag" | "Delete remote tag" | "Delete remote branch" | "Maintain";

const progressive: Record<SyncName, string> = {
  Fetch: "Fetching",
  Pull: "Pulling",
  Push: "Pushing",
  "Push to": "Pushing to",
  Publish: "Publishing",
  "Force push": "Force pushing",
  "Push tag": "Pushing tag",
  "Delete remote tag": "Deleting remote tag",
  "Delete remote branch": "Deleting remote branch",
  Maintain: "Running maintenance",
};

export type TagRequest = { name: string; message: string | null; push: boolean };

const conflictNotice = (verb: string): string => `${verb} stopped on conflicts. Resolve them, then continue, or abort.`;

type SyncResult<T> = { value: T } | { error: IpcError };

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

const describe = (error: IpcError): string => {
  const detail = error.output?.split("\n").find((line) => line.trim() !== "");
  return detail === undefined ? error.message : `${error.message}: ${detail.trim()}`;
};

export function autoStashMessage(outcome: AutoStash, label: string, left?: string): string | undefined {
  switch (outcome) {
    case "none":
      return undefined;
    case "restored":
      return `Switched to ${label}. Your stashed changes were restored.`;
    case "conflicts":
      return `Switched to ${label}. Restoring your changes conflicted; they are kept in stash@{0}.`;
    case "kept":
      return `Switched to ${label}. Your changes could not be restored automatically and remain in stash@{0}.`;
    case "stashed":
      return left === undefined
        ? `Switched to ${label}. Your changes are stashed in stash@{0}.`
        : `Switched to ${label}. Your changes are stashed and will be offered back when you return to ${left}.`;
  }
}

export function restoreMessage(kind: "apply" | "pop", restore: StashRestore): string | undefined {
  if (restore === "applied") return undefined;
  return kind === "pop"
    ? "The stash applied with conflicts and was kept. Resolve them in the Changes list."
    : "The stash applied with conflicts. Resolve them in the Changes list.";
}

const PULL_STASH_NOTICE = "pull-stash";
const BRANCH_WORKTREE_NOTICE = "branch-worktree";
const worktreeOfMessage = (message: string): string | undefined => /^\S+ is checked out in worktree (.+)$/.exec(message)?.[1];

let sequence = 0;
const nextId = (): string => `op-${Date.now()}-${(sequence += 1)}`;

export type RepoActionDeps = {
  selectedSha: () => string | undefined;
  onSelectionGone: () => void;
  pullMode: () => PullMode;
  offline: () => boolean;
  inspectStash: (sha: string) => void;
  openWorktree: (path: string) => Promise<boolean>;
  undoEntry: (id: number) => ActivityEntry | undefined;
  submoduleUpdateOnFetch?: () => boolean;
  showFile?: (target: FileViewTarget) => void;
};

export function createRepoActions(session: RepoSession, deps: RepoActionDeps) {
  const path = session.path;
  const [menu, setMenu] = createSignal<MenuState | undefined>();
  const [popover, setPopover] = createSignal<PopoverState | undefined>();
  const [dialog, setDialog] = createSignal<DialogState | undefined>();
  const [sync, setSync] = createSignal<SyncState>({ kind: "idle" });
  const [operationBusy, setOperationBusy] = createSignal(false);
  const [noticeList, setNotices] = createSignal<StripNotice[]>([]);
  const [replaced, setReplaced] = createSignal<{ key: string; count: number; commits: Array<{ sha: string; summary: string }> } | undefined>();
  let pendingKey = "";
  const DIVERGED_NOTICE = "diverged-push";
  const divergedKey = () => {
    const counts = snapshot().upstream?.ahead_behind;
    return isDiverged(snapshot()) && counts != null ? `${counts.ahead}:${counts.behind}:${snapshot().upstream?.name ?? ""}` : "";
  };
  const refreshDiverged = () => {
    const key = divergedKey();
    if (key === "") {
      pendingKey = "";
      if (replaced() !== undefined) queueMicrotask(() => setReplaced(undefined));
      return;
    }
    if (pendingKey === key || replaced()?.key === key) return;
    pendingKey = key;
    void session
      .read(["push-plan"], () => client.pushPlan(path))
      .then((plan) => {
        if (divergedKey() !== key) return;
        setReplaced({ key, count: plan.replaced.count, commits: plan.replaced.commits.map((commit) => ({ sha: commit.sha, summary: commit.summary })) });
      })
      .catch(() => {
        if (pendingKey === key) pendingKey = "";
      });
  };
  const notices = (): StripNotice[] => {
    refreshDiverged();
    const list = noticeList();
    const key = divergedKey();
    if (key === "") return list;
    const plan = replaced();
    return [
      {
        id: DIVERGED_NOTICE,
        icon: "warning",
        text: "This branch has diverged",
        detail: plan?.key === key ? divergedPushDetail(plan.commits, plan.count) : "Remote commits would be replaced.",
        dismiss: false,
        actions: [{ label: "Force push with lease", run: () => openForcePush() }],
      },
      ...list,
    ];
  };
  const [autoFetchPause, setAutoFetchPause] = createSignal<string | undefined>();
  const [history, setHistory] = createSignal<HistoryView | undefined>();
  let retry: (() => Promise<void>) | undefined;

  const snapshot = session.snapshot;
  const currentBranch = () => {
    const head = snapshot().head;
    return head.kind === "branch" ? head.name : undefined;
  };
  const fail = (failure: unknown) => session.inform(describe(asIpcError(failure)));
  const confirm = (copy: ConfirmCopy, run: () => void | Promise<void>) => setDialog({ copy, run });
  const busy = () => sync().kind === "running";
  const addNotice = (notice: StripNotice) => setNotices((list) => [...list.filter((entry) => entry.id !== notice.id), notice]);
  let pendingPullStash: string | undefined;
  const dismissNotice = (id: string) => {
    if (id === PULL_STASH_NOTICE) pendingPullStash = undefined;
    setNotices((list) => list.filter((entry) => entry.id !== id));
  };

  async function authFixFor(remote: string | undefined): Promise<AuthFix> {
    try {
      const remotes = await session.read(["remotes"], () => client.remotesList(path));
      return authFix(remotes.find((entry) => entry.name === remote)?.fetch_url);
    } catch {
      return authFix(undefined);
    }
  }

  async function runSync<T>(
    name: SyncName,
    start: (id: string) => Promise<T>,
    onError?: (error: IpcError) => boolean,
  ): Promise<SyncResult<T>> {
    const running = sync();
    if (running.kind === "running") return { error: new IpcError({ kind: "invalid_request", message: "Another sync is running" }) };
    const id = nextId();
    dismissNotice(PULL_STASH_NOTICE);
    announceOperation(id, name.toLowerCase());
    setSync({ kind: "running", id, label: progressive[name], phase: undefined, percent: null });
    retry = undefined;
    try {
      const value = await start(id);
      setSync({ kind: "idle" });
      if (name === "Fetch") setAutoFetchPause(undefined);
      await session.refresh();
      return { value };
    } catch (failure) {
      const error = asIpcError(failure);
      setSync({ kind: "idle" });
      if (error.kind === "cancelled") session.inform(`${name} cancelled.`);
      else if (error.kind === "auth_failed") {
        const copy = authFailure(error.message);
        setSync({ kind: "failed", message: copy.text, hint: copy.hint, fix: await authFixFor(copy.remote) });
        retry = async () => void (await runSync(name, start, onError));
      } else if (onError?.(error) !== true) fail(error);
      await session.refresh();
      return { error };
    }
  }

  async function fetchAll(prune = false): Promise<void> {
    const result = await runSync("Fetch", (id) => client.fetch(path, id, prune));
    if (!("value" in result) || deps.submoduleUpdateOnFetch?.() !== true) return;
    try {
      await client.submoduleUpdate(path, null);
      await session.refresh();
    } catch (failure) {
      fail(failure);
    }
  }

  function reportPull(outcome: PullOutcome): void {
    if (outcome === "conflicts") session.inform("Pull stopped on conflicts. Resolve them, then continue, or abort.");
    else if (outcome === "up_to_date") session.inform("Already up to date.");
  }

  function showPullStash(stash: PullStash): void {
    if (stash.kind === "restored") {
      addNotice({ id: PULL_STASH_NOTICE, text: "Your changes were stashed and restored", actions: [] });
    } else if (stash.kind === "kept") {
      const index = Number(/\{(\d+)\}/.exec(stash.reference)?.[1] ?? 0);
      if (stash.reason === "pull_conflicts") pendingPullStash = stash.sha;
      const restore = (kind: "apply" | "pop") => async () => {
        dismissNotice(PULL_STASH_NOTICE);
        await restoreStash(kind, { index, sha: stash.sha });
      };
      addNotice({
        id: PULL_STASH_NOTICE,
        text: `Your changes are kept in ${stash.reference}`,
        detail: pullStashKeptCopy(stash.reason),
        actions: [
          { label: "Apply", run: restore("apply") },
          { label: "Pop", run: restore("pop") },
        ],
      });
    }
  }

  async function pull(mode: PullMode): Promise<void> {
    if (changeTotal(snapshot().counts) > 0) {
      const stashing = await runSync("Pull", (id) => client.pullWithAutostash(path, id, mode));
      if (!("value" in stashing)) return;
      reportPull(stashing.value.outcome);
      showPullStash(stashing.value.stash);
      return;
    }
    const result = await runSync("Pull", (id) => client.pull(path, id, mode));
    if ("value" in result) reportPull(result.value);
  }

  const pullDefault = () => pull(deps.pullMode());

  async function publish(remote: string): Promise<void> {
    await runSync("Publish", (id) => client.publish(path, id, remote));
  }

  async function autoFetch(): Promise<void> {
    if (autoFetchPause() !== undefined || deps.offline() || sync().kind === "running" || snapshot().operation !== null || snapshot().remotes.length === 0) return;
    const result = await runSync("Fetch", (id) => client.fetch(path, id, false, false), () => true);
    if ("error" in result && result.error.kind !== "cancelled") setAutoFetchPause(describe(result.error));
  }

  async function undo(id: number): Promise<void> {
    const entry = deps.undoEntry(id);
    if (entry?.operation === "Force push" && entry.undo.kind === "available") {
      confirm(undoForcePushCopy(entry.undo.scope), () => runUndo(id));
      return;
    }
    await runUndo(id);
  }

  async function runUndo(id: number): Promise<void> {
    try {
      await client.undoLast(path, id);
    } catch (failure) {
      fail(failure);
    }
    await session.refresh();
    await dropUndoneSelection();
  }

  async function dropUndoneSelection(): Promise<void> {
    const sha = deps.selectedSha();
    if (sha === undefined) return;
    try {
      if ((await session.searchCommits(`sha:${sha}`)).rows.length === 0) deps.onSelectionGone();
    } catch (failure) {
      fail(failure);
    }
  }

  async function openForcePush(): Promise<void> {
    try {
      const plan = await session.read(["push-plan"], () => client.pushPlan(path));
      confirm(forcePushCopy(plan), () => confirmForcePush(plan));
    } catch (failure) {
      fail(failure);
    }
  }

  async function push(): Promise<void> {
    if (isDiverged(snapshot())) return;
    await runSync("Push", (id) => client.push(path, id), (error) => {
      if (error.kind !== "push_rejected") return false;
      if ((snapshot().upstream?.ahead_behind?.ahead ?? 0) > 0) void openForcePush();
      else session.inform("The remote has commits you do not have. Pull first, then push.");
      return true;
    });
  }

  async function confirmForcePush(plan: ForcePushPlan): Promise<void> {
    await runSync("Force push", (id) => client.pushForce(path, id, plan.lease), (error) => {
      if (error.kind !== "push_rejected") return false;
      session.inform("The remote changed after these commits were listed, so nothing was replaced. Fetch and review again.");
      return true;
    });
  }

  function cancelSync(): void {
    const state = sync();
    if (state.kind === "running") void client.operationCancel(state.id).catch(fail);
  }

  function onProgress(progress: OperationProgress): void {
    const state = sync();
    if (state.kind === "running" && state.id === progress.id) setSync({ ...state, phase: progress.phase, percent: progress.percent });
  }

  function offerOpenWorktree(error: IpcError): void {
    const worktree = worktreeOfMessage(error.message);
    if (worktree === undefined) {
      fail(error);
      return;
    }
    addNotice({
      id: BRANCH_WORKTREE_NOTICE,
      text: error.message,
      icon: "worktree",
      actions: [
        {
          label: "Open worktree",
          run: async () => {
            dismissNotice(BRANCH_WORKTREE_NOTICE);
            await deps.openWorktree(worktree);
          },
        },
      ],
    });
  }

  async function switchTo(target: CheckoutTarget, label: string, stash: boolean): Promise<void> {
    dismissNotice(PULL_STASH_NOTICE);
    dismissNotice(BRANCH_WORKTREE_NOTICE);
    try {
      const left = currentBranch();
      const outcome = await client.checkout(path, target, stash, stash);
      const message = autoStashMessage(outcome.auto_stash, label, left);
      if (message !== undefined) session.inform(message);
    } catch (failure) {
      const error = asIpcError(failure);
      if (error.kind === "local_changes" && !stash) confirm(stashAndSwitchCopy(label, currentBranch()), () => switchTo(target, label, true));
      else if (error.kind === "branch_in_worktree") offerOpenWorktree(error);
      else fail(error);
    }
    await session.refresh();
  }

  function checkout(target: CheckoutTarget): void {
    if (target.kind === "tag" || target.kind === "commit") {
      const label = target.kind === "tag" ? target.name : target.sha.slice(0, 7);
      confirm(detachCopy(label, changeTotal(snapshot().counts) > 0), () => switchTo(target, label, false));
      return;
    }
    const label = target.kind === "local_branch" ? target.name : shortRefName(target, snapshot().remotes);
    void switchTo(target, label, false);
  }

  function checkoutRef(target: RefTarget): void {
    if (target.kind === "local_branch") checkout({ kind: "local_branch", name: target.name });
    else if (target.kind === "tag") checkout({ kind: "tag", name: target.name });
    else {
      const short = shortRefName(target, snapshot().remotes);
      if (snapshot().branches.includes(short)) checkout({ kind: "local_branch", name: short });
      else checkout({ kind: "remote_branch", name: target.name });
    }
  }

  async function deleteBranch(name: string): Promise<void> {
    let lost;
    try {
      lost = await session.read(["delete-preview", name], () => client.branchDeletePreview(path, name));
    } catch (failure) {
      fail(failure);
      return;
    }
    if (lost.count === 0) {
      await session.mutate(() => client.deleteBranch(path, name, false));
      return;
    }
    confirm(deleteBranchCopy(name, lost), () => void session.mutate(() => client.deleteBranch(path, name, true)));
  }

  async function runBatch(total: number, verb: string, run: () => Promise<BatchOutcome>): Promise<void> {
    const outcomes: BatchOutcome[] = [];
    await session.mutate(async () => void outcomes.push(await run()));
    const failed = outcomes[0]?.failed ?? [];
    const [first] = failed;
    if (first !== undefined) session.inform(`${failed.length} of ${total} could not be ${verb}. ${first.name}: ${first.reason}`);
  }

  async function deleteBranches(names: readonly string[]): Promise<void> {
    let previews: Array<{ branch: string; range: RevisionRange }>;
    try {
      previews = await inBatches(names, PREVIEW_CONCURRENCY, async (branch) => ({ branch, range: await session.read(["delete-preview", branch], () => client.branchDeletePreview(path, branch)) }));
    } catch (failure) {
      fail(failure);
      return;
    }
    const lost = previews.filter((preview) => preview.range.count > 0);
    confirm(deleteBranchesCopy(names, lost), () =>
      runBatch(
        names.length,
        "deleted",
        () =>
          client.deleteBranches(
            path,
            names,
            lost.map((preview) => preview.branch),
          ),
      ),
    );
  }

  function remoteBranchOf(target: RefTarget): { remote: string; name: string } | undefined {
    const ref = target.kind === "remote_branch" ? target.name : target.kind === "local_branch" ? target.remoteName : undefined;
    const remote = ref === undefined ? undefined : remoteOf({ kind: "remote_branch", name: ref }, snapshot().remotes);
    return ref === undefined || remote === undefined ? undefined : { remote, name: ref.slice(remote.length + 1) };
  }

  const removeRemoteBranch = (remote: string, name: string) =>
    runSync("Delete remote branch", (id) => client.deleteRemoteBranch(path, id, remote, name));

  function deleteRemoteBranch(target: RefTarget): void {
    const found = remoteBranchOf(target);
    if (found === undefined) return;
    confirm(deleteRemoteBranchCopy(found.remote, found.name), async () => void (await removeRemoteBranch(found.remote, found.name)));
  }

  async function deleteBranchAndRemote(name: string): Promise<void> {
    const found = remoteBranchOf(localTarget(snapshot(), name));
    if (found === undefined) {
      session.inform(`${name} has no remote branch.`);
      return;
    }
    let lost;
    try {
      lost = await session.read(["delete-preview", name], () => client.branchDeletePreview(path, name));
    } catch (failure) {
      fail(failure);
      return;
    }
    confirm(deleteBranchAndRemoteCopy(name, found.remote, lost), async () => {
      if (await session.mutate(() => client.deleteBranch(path, name, true))) await removeRemoteBranch(found.remote, found.name);
    });
  }

  const openSetUpstream = (branch: string, anchor: Anchor) => setPopover({ kind: "set_upstream", anchor, branch });

  async function setUpstream(branch: string, upstream: string | null): Promise<void> {
    setPopover(undefined);
    await session.mutate(() => client.setUpstream(path, branch, upstream));
  }

  async function unsetUpstream(): Promise<void> {
    const branch = currentBranch();
    if (branch !== undefined) await setUpstream(branch, null);
  }

  const openPushTo = (anchor: Anchor) => setPopover({ kind: "push_to", anchor });

  async function pushTo(target: PushTarget): Promise<void> {
    setPopover(undefined);
    await runSync("Push to", (id) => client.pushTo(path, id, target), (error) => {
      if (error.kind !== "push_rejected") return false;
      session.inform(`${target.remote}/${target.name} has commits this branch does not. Pull first, or push to another name.`);
      return true;
    });
  }

  function openBranchPicker(anchor: Anchor): void {
    const upstream = snapshot().upstream?.name ?? null;
    setMenu({
      anchor,
      entries: branchPickerMenu(snapshot().branches, currentBranch(), upstream, snapshot().remotes),
      run: (id) => {
        if (id.startsWith("checkout:")) checkoutRef(localTarget(snapshot(), id.slice("checkout:".length)));
        else if (id === "set_upstream") openSetUpstream(currentBranch() ?? "", anchor);
        else if (id === "unset_upstream") void unsetUpstream();
      },
    });
  }

  async function offerSwitchStashes(): Promise<void> {
    const branch = currentBranch();
    setNotices((list) => list.filter((entry) => !entry.id.startsWith("switch:") || (branch !== undefined && entry.id.startsWith(`switch:${branch}:`))));
    if (branch === undefined) return;
    let recorded;
    try {
      recorded = await client.switchStashes(path, branch);
    } catch (failure) {
      fail(failure);
      return;
    }
    for (const entry of recorded) {
      const id = `switch:${branch}:${entry.sha}`;
      const settle = async (act: () => Promise<StashRestore | null>) => {
        dismissNotice(id);
        try {
          const restore = await act();
          const message = restore === null ? undefined : restoreMessage("pop", restore);
          if (message !== undefined) session.inform(message);
        } catch (failure) {
          fail(failure);
        }
        await session.refresh();
      };
      addNotice({
        id,
        text: `Restore the changes stashed when you left ${branch}?`,
        detail: entry.message,
        actions: [
          { label: "Restore", run: () => settle(() => client.switchStashRestore(path, branch, entry.sha)) },
          { label: "Keep in stash", run: () => settle(async () => (await client.switchStashDismiss(path, branch, entry.sha), null)) },
        ],
      });
    }
  }

  const menuContext = (): MenuContext => ({
    current: currentBranch(),
    remotes: snapshot().remotes,
    operation: snapshot().operation,
    upstream: snapshot().upstream?.name ?? null,
  });
  const currentLabel = () => currentBranch() ?? "HEAD";

  async function integrate(verb: string, step: () => Promise<OperationOutcome>): Promise<void> {
    try {
      if ((await step()) === "conflicts") session.inform(conflictNotice(verb));
    } catch (failure) {
      fail(failure);
    }
    await session.refresh();
  }

  async function previewOf(base: string | null, other: string): Promise<IntegrationPreview | undefined> {
    try {
      return await session.read(["integration-preview", base ?? "", other], () => client.integrationPreview(path, base, other));
    } catch (failure) {
      fail(failure);
      return undefined;
    }
  }

  async function openMerge(source: string, anchor: Anchor): Promise<void> {
    const preview = await previewOf(null, source);
    if (preview === undefined) return;
    if (preview.incoming.count === 0) session.inform("Already up to date.");
    else setPopover({ kind: "merge", anchor, source, current: currentLabel(), preview });
  }

  async function submitMerge(mode: MergeMode): Promise<void> {
    const state = popover();
    if (state?.kind !== "merge") return;
    setPopover(undefined);
    await integrate("Merge", () => client.merge(path, state.source, mode));
  }

  async function startRebase(onto: string): Promise<void> {
    const preview = await previewOf(null, onto);
    if (preview === undefined) return;
    if (preview.incoming.count === 0) session.inform("Already up to date.");
    else confirm(rebaseCopy(currentLabel(), onto, preview.outgoing), () => integrate("Rebase", () => client.rebase(path, onto)));
  }

  async function fastForward(branch: string, target: string): Promise<void> {
    try {
      await client.fastForward(path, branch, target);
    } catch (failure) {
      const error = asIpcError(failure);
      if (error.kind === "not_fast_forward") session.inform(`${branch} cannot be fast-forwarded to ${target}: ${error.output ?? error.message}`);
      else fail(error);
    }
    await session.refresh();
  }

  const applyCommit = (sha: string, verb: "Cherry-pick" | "Revert") =>
    integrate(verb, () => (verb === "Revert" ? client.revert(path, sha) : client.cherryPick(path, sha)));

  async function startReset(target: string, label: string, mode: ResetMode): Promise<void> {
    const preview = await previewOf(null, target);
    if (preview === undefined) return;
    const copy = resetCopy(mode, currentLabel(), label, preview.outgoing, snapshot().files);
    confirm(copy, () => void session.mutate(() => client.reset(path, target, mode)));
  }

  function openResetModes(target: string, label: string, anchor: Anchor): void {
    setMenu({ anchor, entries: resetModeMenu(), run: (id) => void startReset(target, label, id as ResetMode) });
  }

  function openCreateTag(at: string | null, anchor: Anchor): void {
    setPopover({ kind: "create_tag", anchor, at, atLabel: at === null ? "HEAD" : startLabel(at), remote: pushRemote(snapshot().remotes) });
  }

  async function pushTag(name: string): Promise<void> {
    const remote = pushRemote(snapshot().remotes);
    if (remote === undefined) return;
    await runSync("Push tag", (id) => client.pushTag(path, id, remote, name));
  }

  async function submitCreateTag(request: TagRequest): Promise<string | undefined> {
    const state = popover();
    if (state?.kind !== "create_tag") return undefined;
    try {
      await client.createTag(path, request.name, state.at, request.message);
    } catch (failure) {
      return asIpcError(failure).message;
    }
    setPopover(undefined);
    await session.refresh();
    if (request.push) await pushTag(request.name);
    return undefined;
  }

  function openRefMenu(target: RefTarget, anchor: Anchor): void {
    setMenu({
      anchor,
      entries: refMenu(target, menuContext()),
      run: (id) => {
        if (id === "checkout") checkoutRef(target);
        else if (id === "merge") void openMerge(target.name, anchor);
        else if (id === "rebase") void startRebase(target.name);
        else if (id === "fast_forward") void fastForward(currentBranch() ?? "", target.name);
        else if (id === "reset") openResetModes(target.startPoint, target.name, anchor);
        else if (id === "create_tag") openCreateTag(target.startPoint, anchor);
        else if (id === "push_tag") void pushTag(target.name);
        else if (id === "delete_tag") deleteLocalTag(target.name);
        else if (id === "delete_remote_tag") deleteTagOnRemote(target.name);
        else if (id === "create_branch") openCreateBranchAt(target.startPoint, anchor);
        else if (id === "rename" && target.kind === "local_branch") openRenameBranch(target.name, anchor);
        else if (id === "delete" && target.kind === "local_branch") void deleteBranch(target.name);
        else if (id === "delete_remote") deleteRemoteBranch(target);
        else if (id === "delete_both") void deleteBranchAndRemote(target.name);
        else if (id === "set_upstream") openSetUpstream(target.name, anchor);
        else if (id === "unset_upstream") void unsetUpstream();
        else if (id === "push_to") openPushTo(anchor);
      },
    });
  }

  function openCreateBranch(anchor: Anchor): void {
    const at = deps.selectedSha();
    setPopover({ kind: "create_branch", anchor, at: at ?? null, atLabel: at === undefined ? "HEAD" : startLabel(at) });
  }

  async function submitCreateBranch(name: string, checkoutNew: boolean): Promise<void> {
    const state = popover();
    if (state?.kind !== "create_branch") return;
    setPopover(undefined);
    await session.mutate(() => client.createBranch(path, name, state.at, checkoutNew));
  }

  async function parentOf(sha: string, purpose: string): Promise<string | undefined> {
    try {
      const details = await session.read(["details", sha], () => client.commitDetails(path, sha));
      const parent = details.parents[0];
      if (parent === undefined) session.inform(`${sha.slice(0, 7)} is the root commit, so there is no parent to ${purpose}.`);
      return parent;
    } catch (failure) {
      fail(failure);
      return undefined;
    }
  }

  async function openRebaseEditor(sha: string): Promise<void> {
    const base = await parentOf(sha, "rebase onto");
    if (base !== undefined) setHistory({ kind: "rebase", base, from: sha });
  }

  async function openRecomposeFrom(sha: string): Promise<void> {
    const base = await parentOf(sha, "recompose from");
    if (base !== undefined) setHistory({ kind: "recompose", base });
  }

  const commitEntries = (sha: string, merge: boolean, selection: readonly string[] = [sha], row: HistoryRow = {}): MenuEntry[] =>
    commitMenu({ ...menuContext(), sha, merge, selection, ...row });

  function runCommitItem(id: string, sha: string, anchor: Anchor, selection: readonly string[] = [sha]): void {
    if (id === "create_branch") openCreateBranchAt(sha, anchor);
    else if (id === "create_tag") openCreateTag(sha, anchor);
    else if (id === "cherry_pick") void applyCommit(sha, "Cherry-pick");
    else if (id === "revert") void applyCommit(sha, "Revert");
    else if (id === "reset") openResetModes(sha, sha.slice(0, 7), anchor);
    else if (id === "edit_history") void openRebaseEditor(sha);
    else if (id === "squash") setHistory({ kind: "squash", shas: selection });
    else if (id === "recompose") void openRecomposeFrom(sha);
  }

  function openCommitMenu(sha: string, merge: boolean, anchor: Anchor, selection: readonly string[] = [sha], row: HistoryRow = {}): void {
    setMenu({
      anchor,
      entries: commitEntries(sha, merge, selection, row),
      ...(selection.length > 1 ? { title: [`${selection.length} commits selected`] } : {}),
      run: (id) => runCommitItem(id, sha, anchor, selection),
    });
  }

  async function openDropMenu(dragged: RefTarget, dropped: RefTarget, anchor: Anchor): Promise<void> {
    const base = dropBase(dragged, dropped, currentBranch());
    if (base === undefined) {
      session.inform("That drop has no integration to offer. Drop a branch on the checked-out branch, or the checked-out branch on another branch.");
      return;
    }
    const preview = await previewOf(base.into === currentBranch() ? null : base.into, base.other);
    if (preview === undefined) return;
    const plan = dropPlan(dragged, dropped, menuContext(), preview);
    if (plan === undefined) return;
    setMenu({
      anchor,
      title: plan.title,
      entries: plan.entries,
      run: (id) => {
        if (id === "fast_forward") void fastForward(plan.into, plan.other);
        else if (id === "merge") void openMerge(plan.other, anchor);
        else if (id === "rebase") void startRebase(plan.other);
      },
    });
  }

  const renameBranch = (from: string, to: string) => session.mutate(() => client.renameBranch(path, from, to));

  const openRenameBranch = (name: string, anchor: Anchor) => setPopover({ kind: "rename_branch", anchor, name });

  const deleteLocalTag = (name: string) => confirm(deleteTagCopy(name), () => void session.mutate(() => client.deleteTag(path, name)));

  const deleteTags = (names: readonly string[]) => confirm(deleteTagsCopy(names), () => runBatch(names.length, "deleted", () => client.deleteTags(path, names)));

  function deleteTagOnRemote(name: string): void {
    const remote = pushRemote(snapshot().remotes);
    if (remote === undefined) return;
    confirm(deleteRemoteTagCopy(name, remote), () => void runSync("Delete remote tag", (opId) => client.deleteRemoteTag(path, opId, remote, name)));
  }

  const dropStash = (stash: StashEntry) => confirm(dropStashCopy(stash), () => void session.mutate(() => client.stashDrop(path, stash.index, stash.sha)));

  const dropStashes = (stashes: readonly StashEntry[]) =>
    confirm(dropStashesCopy(stashes), () =>
      runBatch(stashes.length, "dropped", () =>
        client.dropStashes(
          path,
          stashes.map(({ index, sha }) => ({ index, sha })),
        ),
      ),
    );

  const openCreateBranchAt = (at: string | null, anchor: Anchor) =>
    setPopover({ kind: "create_branch", anchor, at, atLabel: at === null ? "HEAD" : startLabel(at) });

  async function openCreateBranchFromIssue(issue: Pick<JiraIssue, "key" | "summary">, anchor: Anchor): Promise<void> {
    try {
      const name = await client.jiraBranchName(issue.key, issue.summary);
      setPopover({ kind: "create_branch", anchor, at: null, atLabel: "HEAD", name });
    } catch (failure) {
      fail(failure);
    }
  }

  const openStashForm = (anchor: Anchor) => setPopover({ kind: "stash", anchor });

  const openRenameStash = (stash: StashEntry, anchor: Anchor) => setPopover({ kind: "rename_stash", anchor, stash });

  const renameStash = async (stash: StashEntry, message: string) => {
    setPopover(undefined);
    await session.mutate(() => client.stashRename(path, stash.index, stash.sha, message));
  };

  const stashChanges = (message: string, untracked: boolean) => session.mutate(() => client.stashPush(path, message, untracked));

  async function restoreStash(kind: "apply" | "pop", stash: Pick<StashEntry, "index" | "sha">): Promise<StashRestore | undefined> {
    let restore: StashRestore | undefined;
    try {
      restore = await (kind === "apply" ? client.stashApply : client.stashPop)(path, stash.index, stash.sha);
      const message = restoreMessage(kind, restore);
      if (message !== undefined) session.inform(message);
    } catch (failure) {
      fail(failure);
    }
    await session.refresh();
    return restore;
  }

  async function restorePullStash(): Promise<void> {
    const sha = pendingPullStash;
    if (sha === undefined) return;
    dismissNotice(PULL_STASH_NOTICE);
    const stash = snapshot().stashes.find((entry) => entry.sha === sha);
    if (stash !== undefined && (await restoreStash("pop", stash)) === "applied") session.inform("Restored your stashed changes.");
  }

  function openStashMenu(stash: StashEntry, anchor: Anchor): void {
    setMenu({
      anchor,
      entries: stashMenu(stash),
      run: (id) => {
        if (id === "apply" || id === "pop") void restoreStash(id, stash);
        else if (id === "drop") dropStash(stash);
        else if (id === "inspect") deps.inspectStash(stash.sha);
        else if (id === "rename_stash") openRenameStash(stash, anchor);
      },
    });
  }

  function openFetchMenu(anchor: Anchor): void {
    setMenu({
      anchor,
      entries: fetchMenu(snapshot(), busy(), deps.offline()),
      run: (id) => {
        if (id === "fetch") void fetchAll();
        else if (id === "fetch_prune") void fetchAll(true);
      },
    });
  }

  function openPullMenu(anchor: Anchor): void {
    setMenu({
      anchor,
      entries: pullMenu(snapshot(), busy(), deps.pullMode(), deps.offline()),
      run: (id) => {
        if (id.startsWith("pull:")) void pull(id.slice("pull:".length) as PullMode);
      },
    });
  }

  async function finishOperation(step: () => Promise<"completed" | "conflicts">): Promise<void> {
    setOperationBusy(true);
    let outcome: "completed" | "conflicts" | undefined;
    try {
      outcome = await step();
      if (outcome === "conflicts") session.inform("The next step stopped on conflicts.");
    } catch (failure) {
      fail(failure);
    } finally {
      setOperationBusy(false);
    }
    await session.refresh();
    if (outcome === "completed") await restorePullStash();
  }

  const continueOperation = (message: string | null) => finishOperation(() => client.operationContinue(path, message));

  const skipOperation = () => finishOperation(() => client.operationSkip(path));

  function abortOperation(): void {
    const copy = abortCopy(snapshot());
    if (copy !== undefined) confirm(copy, () => void abortAndRestore());
  }

  async function abortAndRestore(): Promise<void> {
    if (await session.mutate(() => client.operationAbort(path))) await restorePullStash();
  }

  const stageAll = () => session.mutate(() => client.stageAll(path));

  const unstageAll = () => session.mutate(() => client.unstageAll(path));

  const files = createFileOps(session, { confirm, fail, showFile: deps.showFile });

  async function maintain(): Promise<void> {
    if (busy()) return;
    const result = await runSync("Maintain", (id) => client.maintenanceRun(path, id));
    if ("value" in result) session.inform("Repository maintenance finished");
  }

  const maintainReason = () => (busy() ? "Another operation is running" : undefined);

  const createPatchReason = () => (changeTotal(snapshot().counts) === 0 ? "There are no changes to put in a patch" : undefined);

  const markResolved = (files: string[]) => session.mutate(() => client.markResolved(path, files));

  return {
    menu,
    closeMenu: () => setMenu(undefined),
    history,
    closeHistory: () => setHistory(undefined),
    openRebaseEditor,
    openSquash: (shas: readonly string[]) => setHistory({ kind: "squash", shas }),
    openRecompose: (base: string | undefined) => setHistory({ kind: "recompose", base }),
    popover,
    closePopover: () => setPopover(undefined),
    dialog,
    closeDialog: () => setDialog(undefined),
    sync,
    dismissSync: () => setSync({ kind: "idle" }),
    notices,
    dismissNotice,
    retrySync: () => retry?.(),
    operationBusy,
    checkout,
    checkoutRef,
    openRefMenu,
    openCreateBranch,
    submitCreateBranch,
    openCommitMenu,
    commitEntries,
    runCommitItem,
    openDropMenu,
    submitMerge,
    submitCreateTag,
    renameBranch,
    openStashForm,
    stashChanges,
    openStashMenu,
    openRenameStash,
    renameStash,
    inspectStash: (stash: Pick<StashEntry, "sha">) => deps.inspectStash(stash.sha),
    openFetchMenu,
    openPullMenu,
    openBranchPicker,
    openSetUpstream,
    setUpstream,
    unsetUpstream,
    openPushTo,
    pushTo,
    deleteRemoteBranch,
    deleteBranchAndRemote,
    offerSwitchStashes,
    fetchAll,
    pull,
    pullDefault,
    push,
    publish,
    autoFetch,
    autoFetchPause,
    undo,
    openMerge,
    startRebase,
    fastForward,
    applyCommit,
    startReset,
    openCreateTag,
    pushTag,
    deleteBranch,
    deleteBranches,
    deleteTags,
    openRenameBranch,
    openCreateBranchAt,
    openCreateBranchFromIssue,
    deleteLocalTag,
    deleteTagOnRemote,
    dropStash,
    dropStashes,
    restoreStash,
    confirmForcePush,
    cancelSync,
    onProgress,
    continueOperation,
    skipOperation,
    abortOperation,
    markResolved,
    stageAll,
    unstageAll,
    files,
    createFile: files.createFile,
    deleteFile: files.deleteFile,
    viewFile: files.viewFile,
    editFile: (file?: string): void => void files.editFile(file),
    discardAll: files.discardAll,
    discardAllReason: files.discardAllReason,
    createPatch: (selected?: string[]): void => void files.createPatch(selected),
    createPatchReason,
    applyPatch: (): void => void files.applyPatch(),
    maintain,
    maintainReason,
  };
}

export type RepoActions = ReturnType<typeof createRepoActions>;
