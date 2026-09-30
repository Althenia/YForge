import { useQuery } from "./state/query";
import { createMemo, onCleanup, Show } from "solid-js";
import { EmptyState } from "./components/EmptyState";
import { TabBar } from "./components/TabBar";
import { Workspace } from "./components/Workspace";
import { readGeometry } from "./graph/geometry";
import { useApp } from "./state/app";
import { repoKeys } from "./state/queryKeys";
import { appInfoOptions, snapshotOptions, workspaceView, type WorkspaceView } from "./state/workspace";

const root = document.documentElement;

const only = <S extends WorkspaceView["status"]>(view: WorkspaceView | undefined, status: S) =>
  view?.status === status ? (view as Extract<WorkspaceView, { status: S }>) : undefined;

export function RepositoryTab(props: { path: string }) {
  const app = useApp();
  const info = useQuery(appInfoOptions);
  const snapshot = useQuery(() => snapshotOptions(props.path));
  const workspace = createMemo(() => workspaceView(props.path, { data: info.data, error: info.error }, { data: snapshot.data, error: snapshot.error }));
  onCleanup(() => {
    app.queryClient.removeQueries({ queryKey: repoKeys.snapshot(props.path) });
    app.queryClient.removeQueries({ queryKey: repoKeys.graphPages(props.path) });
  });
  const geometry = createMemo(() => {
    app.settings().density;
    return readGeometry(getComputedStyle(root));
  });
  const ready = () => only(workspace(), "ready");
  const missing = () => only(workspace(), "not_a_repository");
  const failed = () => only(workspace(), "failed");
  return (
    <>
      <Show when={workspace() === undefined}>
        <div class="app tab-only">
          <TabBar />
          <EmptyState title="Opening repository…" message="Reading the repository state with git." />
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
