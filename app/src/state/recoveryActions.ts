import { createSignal } from "solid-js";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import { client } from "../ipc/client";
import { restoreCheckoutCopy, restoreResetCopy } from "./recoveryModel";
import { resetModeMenu } from "./refMenu";
import type { Anchor, DialogState, MenuState } from "./repoActions";
import type { RepoSession } from "./repoSession";

export function createRestoreActions(session: RepoSession) {
  const path = session.path;
  const [menu, setMenu] = createSignal<MenuState | undefined>();
  const [naming, setNaming] = createSignal<{ sha: string; anchor: Anchor } | undefined>();
  const [dialog, setDialog] = createSignal<DialogState | undefined>();

  const head = () => session.snapshot().head;
  const resetBlock = (): string | undefined => {
    if (head().kind === "detached") return "HEAD is detached, so there is no branch to reset";
    return head().kind === "unborn" ? "This repository has no commits yet" : undefined;
  };
  const currentLabel = (): string => {
    const current = head();
    return current.kind === "branch" ? current.name : "HEAD";
  };

  return {
    menu,
    closeMenu: () => setMenu(undefined),
    naming,
    closeNaming: () => setNaming(undefined),
    dialog,
    closeDialog: () => setDialog(undefined),
    resetBlock,
    currentLabel,
    openBranch: (sha: string, anchor: Anchor) => setNaming({ sha, anchor }),
    async submitBranch(name: string): Promise<void> {
      const target = naming();
      if (target === undefined) return;
      setNaming(undefined);
      await session.mutate(() => client.restoreAsBranch(path, target.sha, name));
    },
    checkout: (sha: string) => setDialog({ copy: restoreCheckoutCopy(sha), run: () => void session.mutate(() => client.restoreCheckout(path, sha)) }),
    openReset(sha: string, anchor: Anchor): void {
      const reset = (mode: ResetMode) => session.mutate(() => client.restoreReset(path, sha, mode));
      setMenu({
        anchor,
        entries: resetModeMenu(),
        run: (id) => {
          const mode = id as ResetMode;
          if (mode === "hard") setDialog({ copy: restoreResetCopy(mode, currentLabel(), sha), run: () => void reset(mode) });
          else void reset(mode);
        },
      });
    },
  };
}

export type RestoreActions = ReturnType<typeof createRestoreActions>;
