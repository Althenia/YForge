import { createSignal } from "solid-js";
import type { PlatformKind } from "../ipc/bindings/PlatformKind";

export type PullRequestTarget = { path: string; number: number };

const [connectKind, setConnectKind] = createSignal<PlatformKind | undefined>();
const [pendingPull, setPendingPull] = createSignal<PullRequestTarget | undefined>();

/// The platform the Launchpad asked Settings → Platforms to add; read once when Settings opens.
export function requestConnectKind(kind: PlatformKind): void {
  setConnectKind(() => kind);
}

export function takeConnectKind(): PlatformKind | undefined {
  const kind = connectKind();
  setConnectKind(undefined);
  return kind;
}

/// The pull request the Launchpad asked a repository tab to show in its inspector.
export function requestPullInspector(target: PullRequestTarget): void {
  setPendingPull(() => target);
}

export function takePullInspector(path: string): number | undefined {
  const target = pendingPull();
  if (target?.path !== path) return undefined;
  setPendingPull(undefined);
  return target.number;
}
