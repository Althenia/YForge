import { useQuery } from "./state/query";
import { createEffect, createMemo, Index, onCleanup, Show } from "solid-js";
import { EmptyState } from "./components/EmptyState";
import { TabBar } from "./components/TabBar";
import { Workspace } from "./components/Workspace";
import { readGeometry } from "./graph/geometry";
import { IpcError } from "./ipc/client";
import { useApp } from "./state/app";
import { createPendingIndicator } from "./state/pending";
import { repoKeys } from "./state/queryKeys";
import { appInfoOptions, snapshotOptions, workspaceView, type WorkspaceView } from "./state/workspace";

const root = document.documentElement;

const only = <S extends WorkspaceView["status"]>(view: WorkspaceView | undefined, status: S) =>
  view?.status === status ? (view as Extract<WorkspaceView, { status: S }>) : undefined;

const SKELETON_ROWS = Array.from({ length: 24 }, (_, index) => index);
const SKELETON_WIDTHS = ["46%", "62%", "38%", "55%", "70%", "42%", "58%", "50%"];

function WorkspaceSkeleton() {
  return (
    <div class="panel workspace-skeleton" aria-hidden="true">
      <Index each={SKELETON_ROWS}>
        {(index) => (
          <div class="workspace-skeleton-row">
            <span class="skeleton" style={{ width: SKELETON_WIDTHS[index() % SKELETON_WIDTHS.length] }} />
          </div>
        )}
      </Index>
    </div>
  );
}

export function RepositoryTab(props: { path: string; onSettled?: () => void }) {
  const app = useApp();
  const info = useQuery(appInfoOptions);
  const snapshot = useQuery(() => snapshotOptions(props.path));
  const workspace = createMemo(() => {
    const missing = snapshot.error instanceof IpcError && snapshot.error.kind === "not_a_repository";
    return workspaceView(props.path, { data: info.data, error: info.error }, { data: missing ? undefined : snapshot.data, error: snapshot.error });
  });
  onCleanup(() => void app.queryClient.invalidateQueries({ queryKey: repoKeys.snapshot(props.path), refetchType: "none" }));
  const geometry = createMemo(() => {
    app.settings().density;
    return readGeometry(getComputedStyle(root));
  });
  const waiting = createPendingIndicator(() => workspace() === undefined);
  createEffect(() => {
    if (workspace() !== undefined) props.onSettled?.();
  });
  const ready = () => only(workspace(), "ready");
  const missing = () => only(workspace(), "not_a_repository");
  const failed = () => only(workspace(), "failed");
  return (
    <>
      <Show when={workspace() === undefined}>
        <div class="app tab-only">
          <TabBar />
          <Show when={waiting()}>
            <WorkspaceSkeleton />
          </Show>
        </div>
      </Show>
      <Show when={missing()}>
        {(view) => (
          <div class="app tab-only">
            <TabBar />
            <EmptyState title="This folder is not a Git repository" path={view().path} message="Nothing was changed. Close this tab, or open another repository from a new tab." />
          </div>
        )}
      </Show>
      <Show when={failed()}>
        {(view) => (
          <div class="app tab-only">
            <TabBar />
            <EmptyState title="YForge could not read the repository" message={view().message} danger />
          </div>
        )}
      </Show>
      <Show when={ready()}>{(view) => <Workspace view={view()} geometry={geometry()} />}</Show>
    </>
  );
}
