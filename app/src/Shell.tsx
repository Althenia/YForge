import { onCleanup, onMount, Show } from "solid-js";
import { Outlet } from "@tanstack/solid-router";
import { ActivityDrawer } from "./components/ActivityDrawer";
import { AuthDialog } from "./components/AuthDialog";
import { CommandPalette } from "./components/CommandPalette";
import { CloneDialog, CreateDialog } from "./components/EntryDialogs";
import { EmptyState } from "./components/EmptyState";
import { LogsSheet } from "./components/LogsSheet";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { TabRestoring } from "./components/TabRestoring";
import { Toasts } from "./components/Toasts";
import { TooltipHost } from "./components/Tooltip";
import { UpdateDialog } from "./components/UpdateDialog";
import { useApp } from "./state/app";

const root = document.documentElement;

function bindWindowEnvironment(): () => void {
  const applyPause = () => {
    root.toggleAttribute("data-paused", document.hidden || !document.hasFocus());
  };
  applyPause();
  const ownMenusOnly = (event: MouseEvent) => event.preventDefault();
  document.addEventListener("contextmenu", ownMenusOnly);
  document.addEventListener("visibilitychange", applyPause);
  window.addEventListener("blur", applyPause);
  window.addEventListener("focus", applyPause);
  return () => {
    document.removeEventListener("contextmenu", ownMenusOnly);
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
  const paletteContext = () => app.paletteContext();
  return (
    <>
      <Show when={app.fatal()}>{(message) => <EmptyState title="YForge could not start" message={message()} danger />}</Show>
      <Show when={!app.ready() ? app.restoring() : undefined}>{(restoring) => <TabRestoring restoring={restoring()} />}</Show>
      <Show when={app.ready()}>
        <Outlet />
        <Show when={app.drawerOpen()}>
          <ActivityDrawer repo={app.activePath()} onUndo={(id) => void app.undoEntry(id)} />
        </Show>
        <Toasts onUndo={(id) => void app.undoEntry(id)} />
        <TooltipHost />
        <Show when={app.paletteOpen() ? app.paletteSession() : undefined} keyed>
          {(_session) => <CommandPalette context={paletteContext()} scope={app.paletteScope()} onClose={() => app.setPaletteOpen(false)} />}
        </Show>
        <Show when={app.shortcutsOpen()}>
          <ShortcutsSheet onClose={app.closeShortcuts} />
        </Show>
        <Show when={app.logsTab()}>{(tab) => <LogsSheet tab={tab()} onTab={app.openLogs} onClose={app.closeLogs} />}</Show>
        <Show when={app.entryDialog() === "clone"}>
          <CloneDialog onClose={() => app.setEntryDialog(undefined)} />
        </Show>
        <Show when={app.entryDialog() === "create"}>
          <CreateDialog onClose={() => app.setEntryDialog(undefined)} />
        </Show>
        <Show when={app.updateDialogOpen()}>
          <UpdateDialog onClose={app.closeUpdateDialog} />
        </Show>
        <Show when={app.prompts()[0]} keyed>
          {(pending) => <AuthDialog pending={pending} />}
        </Show>
      </Show>
    </>
  );
}
