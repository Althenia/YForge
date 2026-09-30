import { createSignal } from "solid-js";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import { client, IpcError } from "../ipc/client";
import type { ConfirmCopy } from "./confirmCopy";
import type { RepoSession } from "./repoSession";
import {
  integrateBlock,
  integrationNotice,
  removeBlock,
  removeCopy,
  type CreateMode,
} from "./worktreeModel";

export type WorktreeDialog = { kind: "create" } | { kind: "integrate"; worktree: WorktreeStatus; all: readonly WorktreeStatus[] };

export type WorktreeConfirm = { copy: ConfirmCopy; run: () => Promise<void> };

export type CreateRequest = { mode: CreateMode; branch: string; start: string; destination: string };

export type WorktreeDeps = {
  openRepository: (path: string) => Promise<boolean>;
  closeTabsAt: (path: string) => void;
  notify: (message: string) => void;
};

const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function createWorktreeActions(session: RepoSession, deps: WorktreeDeps) {
  const path = session.path;
  const [dialog, setDialog] = createSignal<WorktreeDialog | undefined>();
  const [confirm, setConfirm] = createSignal<WorktreeConfirm | undefined>();

  const fresh = () => session.read(["worktrees"], () => client.worktreeList(path));

  async function find(target: string): Promise<{ worktree: WorktreeStatus; all: WorktreeStatus[] } | undefined> {
    try {
      const all = await fresh();
      const worktree = all.find((entry) => entry.path === target);
      if (worktree === undefined) deps.notify(`${target} is no longer a worktree of this repository.`);
      return worktree === undefined ? undefined : { worktree, all };
    } catch (failure) {
      session.report(failure);
      return undefined;
    }
  }

  async function runRemove(worktree: WorktreeStatus, force: boolean): Promise<void> {
    try {
      await client.worktreeRemove(path, worktree.path, force);
      deps.closeTabsAt(worktree.path);
    } catch (failure) {
      if (failure instanceof IpcError && failure.kind === "worktree_dirty" && !force) setConfirm({ copy: removeCopy(worktree, true), run: () => runRemove(worktree, true) });
      else session.report(failure);
    }
    await session.refresh();
  }

  return {
    dialog,
    closeDialog: () => setDialog(undefined),
    confirm,
    closeConfirm: () => setConfirm(undefined),
    openCreate: () => setDialog({ kind: "create" }),
    open: (target: string) => deps.openRepository(target),
    openTerminal: (target: string) => client.openPath(target, "terminal").catch(session.report),
    suggest: (branch: string) => client.worktreeSuggestPath(path, branch),
    async create(request: CreateRequest): Promise<string | undefined> {
      try {
        const location = await client.worktreeCreate(path, request.branch, request.mode === "new", request.mode === "new" && request.start !== "" ? request.start : null, request.destination);
        setDialog(undefined);
        await session.refresh();
        await deps.openRepository(location);
        return undefined;
      } catch (failure) {
        return messageOf(failure);
      }
    },
    async remove(target: string): Promise<void> {
      const found = await find(target);
      if (found === undefined) return;
      const block = removeBlock(found.worktree, found.all);
      if (block !== undefined) {
        deps.notify(block);
        return;
      }
      setConfirm({ copy: removeCopy(found.worktree, found.worktree.dirty), run: () => runRemove(found.worktree, found.worktree.dirty) });
    },
    async integrate(target: string): Promise<void> {
      const found = await find(target);
      if (found === undefined) return;
      const block = integrateBlock(found.worktree, found.all);
      if (block !== undefined) deps.notify(block);
      else setDialog({ kind: "integrate", worktree: found.worktree, all: found.all });
    },
    async submitIntegrate(branch: string, worktree: string, target: string, cleanup: boolean): Promise<string | undefined> {
      try {
        const outcome = await client.worktreeIntegrate(path, worktree, target, cleanup);
        setDialog(undefined);
        deps.notify(integrationNotice(outcome, branch, target));
        if (outcome.kind === "conflicts") await deps.openRepository(outcome.worktree);
        else if (outcome.cleaned_up) deps.closeTabsAt(worktree);
        await session.refresh();
        return undefined;
      } catch (failure) {
        return messageOf(failure);
      }
    },
  };
}

export type WorktreeActions = ReturnType<typeof createWorktreeActions>;
