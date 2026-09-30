import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { AuthDialog } from "./components/AuthDialog";
import { CommandPalette } from "./components/CommandPalette";
import { CloneDialog, CreateDialog } from "./components/EntryDialogs";
import { EmptyState } from "./components/EmptyState";
import { Launcher } from "./components/Launcher";
import { Notice } from "./components/Notice";
import { SettingsView } from "./components/SettingsView";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { TooltipHost } from "./components/Tooltip";
import { Workspace } from "./components/Workspace";
import { readGeometry } from "./graph/geometry";
import { AppContext, createAppState, useApp } from "./state/app";
import { loadWorkspace, type WorkspaceView } from "./state/workspace";

const root = document.documentElement;

function bindWindowEnvironment(): () => void {
  const applyPause = () => {
    root.toggleAttribute("data-paused", document.hidden || !document.hasFocus());
  };
  applyPause();
  document.addEventListener("visibilitychange", applyPause);
  window.addEventListener("blur", applyPause);
  window.addEventListener("focus", applyPause);
  return () => {
    document.removeEventListener("visibilitychange", applyPause);
    window.removeEventListener("blur", applyPause);
    window.removeEventListener("focus", applyPause);
  };
}

const only = <S extends WorkspaceView["status"]>(view: WorkspaceView | undefined, status: S) =>
  view?.status === status ? (view as Extract<WorkspaceView, { status: S }>) : undefined;

function RepositoryTab(props: { path: string }) {
  const app = useApp();
  const [workspace, setWorkspace] = createSignal<WorkspaceView | undefined>();
  const geometry = createMemo(() => {
    app.settings().density;
    return readGeometry(getComputedStyle(root));
  });
  onMount(() => void loadWorkspace(props.path).then(setWorkspace));
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

function Shell() {
  const app = useApp();
  onMount(() => {
    app.bind();
    onCleanup(bindWindowEnvironment());
    void app.boot();
  });
  const settingsOpen = () => app.screen().kind === "settings";
  const section = () => {
    const current = app.screen();
    return current.kind === "settings" ? current.section : "general";
  };
  const paletteContext = () => app.paletteContext();
  return (
    <>
      <div class="aurora" aria-hidden="true">
        <i class="a1" />
        <i class="a2" />
        <i class="a4" />
      </div>
      <Show when={app.fatal()}>{(message) => <EmptyState title="YForge could not start" message={message()} danger />}</Show>
      <Show when={app.ready()}>
        <Switch>
          <Match when={settingsOpen()}>
            <div class="app settings-app">
              <TabBar />
              <SettingsView section={section()} />
            </div>
          </Match>
          <Match when={app.activeTab()?.kind === "launcher"}>
            <div class="app launcher-app">
              <TabBar />
              <Launcher />
            </div>
          </Match>
          <Match when={app.activeTab()}>
            {(tab) => <For each={[tab()]}>{(current) => <Show when={current.kind === "repo" && current}>{(repo) => <RepositoryTab path={(repo() as { path: string }).path} />}</Show>}</For>}
          </Match>
        </Switch>
        <Show when={app.drawerOpen()}>
          <ActivityDrawer repo={app.activePath()} onUndo={(id) => void app.undoEntry(id)} />
        </Show>
        <Toasts onUndo={(id) => void app.undoEntry(id)} />
        <TooltipHost />
        <Show when={app.paletteOpen()}>
          <CommandPalette context={paletteContext()} onClose={() => app.setPaletteOpen(false)} />
        </Show>
        <Show when={app.entryDialog() === "clone"}>
          <CloneDialog onClose={() => app.setEntryDialog(undefined)} />
        </Show>
        <Show when={app.entryDialog() === "create"}>
          <CreateDialog onClose={() => app.setEntryDialog(undefined)} />
        </Show>
        <Show when={app.prompts()[0]} keyed>
          {(pending) => <AuthDialog pending={pending} />}
        </Show>
        <Show when={settingsOpen() || app.activeTab()?.kind === "launcher"}>
          <Notice message={app.notice()} onDismiss={() => app.setNotice(undefined)} />
        </Show>
      </Show>
    </>
  );
}

export function App() {
  const app = createAppState();
  return (
    <AppContext.Provider value={app}>
      <Shell />
    </AppContext.Provider>
  );
}
