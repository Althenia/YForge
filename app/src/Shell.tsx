import { onCleanup, onMount, Show } from "solid-js";
import { Outlet } from "@tanstack/solid-router";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { AuthDialog } from "./components/AuthDialog";
import { CommandPalette } from "./components/CommandPalette";
import { CloneDialog, CreateDialog } from "./components/EntryDialogs";
import { EmptyState } from "./components/EmptyState";
import { Notice } from "./components/Notice";
import { Toasts } from "./components/Toasts";
import { TooltipHost } from "./components/Tooltip";
import { useApp } from "./state/app";

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

export function Shell() {
  const app = useApp();
  onMount(() => {
    app.bind();
    onCleanup(bindWindowEnvironment());
    void app.boot();
  });
  const settingsOpen = () => app.screen().kind === "settings";
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
        <Outlet />
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
