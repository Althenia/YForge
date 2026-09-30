import { createSignal } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";

const asIpcError = (failure: unknown): IpcError =>
  failure instanceof IpcError ? failure : new IpcError({ kind: "internal", message: String(failure) });

export function createRepoSession(path: string, initial: RepoSnapshot) {
  const [snapshot, setSnapshot] = createSignal(initial);
  const [revision, setRevision] = createSignal(0);
  const [notice, setNotice] = createSignal<string | undefined>();
  let running: Promise<void> | undefined;
  let again = false;

  async function reload(): Promise<void> {
    do {
      again = false;
      try {
        setSnapshot(await client.repoOpen(path));
        setRevision((value) => value + 1);
      } catch (failure) {
        setNotice(asIpcError(failure).message);
      }
    } while (again);
  }

  function refresh(): Promise<void> {
    if (running !== undefined) {
      again = true;
      return running;
    }
    running = reload().finally(() => {
      running = undefined;
    });
    return running;
  }

  async function mutate(action: () => Promise<unknown>): Promise<boolean> {
    let succeeded = true;
    try {
      await action();
    } catch (failure) {
      succeeded = false;
      setNotice(asIpcError(failure).message);
    }
    await refresh();
    return succeeded;
  }

  return {
    path,
    snapshot,
    revision,
    notice,
    dismissNotice: () => setNotice(undefined),
    report: (failure: unknown) => setNotice(asIpcError(failure).message),
    inform: (message: string) => setNotice(message),
    refresh,
    mutate,
  };
}

export type RepoSession = ReturnType<typeof createRepoSession>;
