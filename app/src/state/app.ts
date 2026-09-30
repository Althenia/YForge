import { createContext, createEffect, createSignal, onCleanup, useContext } from "solid-js";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { AuthReply } from "../ipc/bindings/AuthReply";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import { client, IpcError } from "../ipc/client";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { refreshToasts, undoState, upsertEntry, type Toast } from "./activityModel";
import { dropOperationPrompts, dropPrompt, enqueuePrompt, type PendingPrompt } from "./authModel";
import { buildCommands, commandForShortcut, shortcutLabel, type CommitChoice, type PaletteApp, type PaletteContext } from "./palette";
import type { RepoActions } from "./repoActions";
import { applyAppearance, defaultSettings, effectivePullMode } from "./settingsModel";
import { activateTab, closeTab, openLauncherTab, openRepoTab, restoreTabs, sessionOf, type Tab, type TabsState } from "./tabs";

export type Screen = { kind: "workspace" } | { kind: "settings"; section: string };

export type EntryDialog = "clone" | "create";

export type RepoBridge = {
  path: string;
  snapshot: () => RepoSnapshot;
  actions: RepoActions;
  selectedSha: () => string | undefined;
  revealCommit: (sha: string) => void;
  revealRef: (name: string) => void;
  openSearch: () => void;
  focusComposer: () => void;
  loadCommits: () => Promise<CommitChoice[]>;
};

const asMessage = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function createAppState() {
  const [settings, setSettings] = createSignal<AppSettings>(defaultSettings);
  const [tabs, setTabs] = createSignal<TabsState>({ tabs: [{ kind: "launcher" }], active: 0 });
  const [ready, setReady] = createSignal(false);
  const [fatal, setFatal] = createSignal<string | undefined>();
  const [screen, setScreen] = createSignal<Screen>({ kind: "workspace" });
  const [activity, setActivity] = createSignal<ActivityEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [prompts, setPrompts] = createSignal<PendingPrompt[]>([]);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [entryDialog, setEntryDialog] = createSignal<EntryDialog | undefined>();
  const [notice, setNotice] = createSignal<string | undefined>();
  const [repoSettings, setRepoSettings] = createSignal<Record<string, RepoSettings>>({});
  const [bridge, setBridge] = createSignal<RepoBridge | undefined>();
  const [recentPaths, setRecentPaths] = createSignal<string[]>([]);

  const activeTab = (): Tab | undefined => tabs().tabs[tabs().active];
  const activePath = (): string | undefined => {
    const tab = activeTab();
    return tab?.kind === "repo" ? tab.path : undefined;
  };

  function applyTabs(next: TabsState): void {
    setTabs(next);
    setScreen({ kind: "workspace" });
    client.sessionSave(sessionOf(next)).catch((failure) => setNotice(asMessage(failure)));
  }

  async function openRepository(path: string): Promise<boolean> {
    try {
      const snapshot = await client.repoOpen(path);
      applyTabs(openRepoTab(tabs(), snapshot.root));
      setRecentPaths((await client.recentAdd(snapshot.root)).map((recent) => recent.path));
      return true;
    } catch (failure) {
      setNotice(failure instanceof IpcError && failure.kind === "not_a_repository" ? `${path} is not a Git repository` : asMessage(failure));
      return false;
    }
  }

  async function boot(): Promise<void> {
    try {
      const [loaded, session, launch, entries] = await Promise.all([client.settingsLoad(), client.sessionLoad(), client.launchPath(), client.activityList()]);
      setSettings(loaded);
      setActivity(entries);
      setRecentPaths((await client.recentsList()).map((recent) => recent.path));
      const launchRoot = await client.repoOpen(launch).then(
        (snapshot) => snapshot.root,
        () => undefined,
      );
      setTabs(restoreTabs(session, launchRoot));
      setReady(true);
    } catch (failure) {
      setFatal(asMessage(failure));
    }
  }

  function record(entry: ActivityEntry): void {
    setActivity((entries) => upsertEntry(entries, entry));
    setToasts((current) => refreshToasts(current, entry, activePath()));
  }

  async function respondAuth(id: string, reply: AuthReply): Promise<void> {
    setPrompts((queue) => dropPrompt(queue, id));
    try {
      await client.authRespond(id, reply);
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  function cancelOperationPrompts(operation: string): void {
    setPrompts((queue) => dropOperationPrompts(queue, operation));
  }

  async function saveSettings(next: AppSettings): Promise<string | undefined> {
    try {
      setSettings(await client.settingsSave(next));
      return undefined;
    } catch (failure) {
      return asMessage(failure);
    }
  }

  async function loadRepoSettings(path: string): Promise<void> {
    try {
      const loaded = await client.repoSettingsLoad(path);
      setRepoSettings((current) => ({ ...current, [path]: loaded }));
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  async function saveRepoSettings(path: string, next: RepoSettings): Promise<string | undefined> {
    try {
      await client.repoSettingsSave(path, next);
      setRepoSettings((current) => ({ ...current, [path]: next }));
      return undefined;
    } catch (failure) {
      return asMessage(failure);
    }
  }

  function pickFolderAndOpen(): void {
    void client.pickFolder("Open a repository").then((picked) => (picked === undefined ? undefined : openRepository(picked)));
  }

  async function openExternal(with_: "editor" | "terminal" | "finder"): Promise<void> {
    const path = activePath();
    if (path === undefined) return;
    try {
      await client.openPath(path, with_);
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  const paletteApp = (): PaletteApp => ({
    openLauncher: () => applyTabs(openLauncherTab(tabs())),
    openFolder: pickFolderAndOpen,
    openClone: () => setEntryDialog("clone"),
    openCreate: () => setEntryDialog("create"),
    closeTab: () => applyTabs(closeTab(tabs(), tabs().active)),
    openSettings: (section) => setScreen({ kind: "settings", section }),
    toggleDrawer: () => setDrawerOpen((open) => !open),
    openSearch: () => bridge()?.openSearch(),
    openExternal: (with_) => void openExternal(with_),
    setTheme: (theme) => void saveSettings({ ...settings(), theme }),
    openRepository: (path) => void openRepository(path),
    repositories: () => [
      ...new Set([
        ...tabs().tabs.flatMap((tab) => (tab.kind === "repo" ? [tab.path] : [])),
        ...recentPaths(),
      ]),
    ],
  });

  function paletteContext(): PaletteContext {
    const current = bridge();
    const path = current?.path;
    return {
      snapshot: current?.snapshot(),
      actions: current?.actions,
      selectedSha: current?.selectedSha(),
      pullMode: effectivePullMode(settings(), path === undefined ? undefined : repoSettings()[path]).mode,
      undo: path === undefined ? { kind: "unavailable", reason: "Open a repository first" } : undoState(activity(), path),
      anchor: { left: Math.max(16, window.innerWidth / 2 - 160), top: 140 },
      app: paletteApp(),
      revealCommit: (sha) => current?.revealCommit(sha),
      revealRef: (name) => current?.revealRef(name),
      focusComposer: () => current?.focusComposer(),
      loadCommits: () => current?.loadCommits() ?? Promise.resolve([]),
    };
  }

  function onShortcut(event: KeyboardEvent): void {
    const label = shortcutLabel(event);
    if (label === undefined || event.defaultPrevented) return;
    if (label === "⌘K") {
      event.preventDefault();
      setPaletteOpen((open) => !open);
      return;
    }
    if (paletteOpen() || prompts().length > 0) return;
    const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
    if (label === "⌘Z" && editing) return;
    const command = commandForShortcut(buildCommands(paletteContext()), label);
    if (command === undefined) return;
    event.preventDefault();
    if (command.disabledReason === undefined) command.run([]);
  }

  function bind(): void {
    document.addEventListener("keydown", onShortcut);
    onCleanup(() => document.removeEventListener("keydown", onShortcut));
    const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
    const root = document.documentElement;
    const appearance = () => applyAppearance(root, settings(), colorScheme.matches);
    createEffect(appearance);
    colorScheme.addEventListener("change", appearance);
    onCleanup(() => colorScheme.removeEventListener("change", appearance));
    const listeners = [
      client.onActivity(record),
      client.onAuthPrompt((event) => setPrompts((queue) => enqueuePrompt(queue, event))),
    ];
    onCleanup(() => listeners.forEach((listener) => void listener.then((stop) => stop())));
    createEffect(() => {
      const path = activePath();
      setToasts((current) => current.filter((toast) => toast.entry.repo === path));
    });
  }

  return {
    settings,
    tabs,
    ready,
    fatal,
    screen,
    setScreen,
    activity,
    drawerOpen,
    toggleDrawer: () => setDrawerOpen((open) => !open),
    closeDrawer: () => setDrawerOpen(false),
    openDrawer: () => setDrawerOpen(true),
    clearActivity: async (repo: string | undefined) => {
      await client.activityClear(repo ?? null);
      setActivity(await client.activityList());
    },
    paletteOpen,
    setPaletteOpen,
    prompts,
    toasts,
    dismissToast: (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    entryDialog,
    setEntryDialog,
    notice,
    setNotice,
    repoSettings,
    activeTab,
    activePath,
    boot,
    bind,
    openRepository,
    openLauncher: () => applyTabs(openLauncherTab(tabs())),
    closeActiveTab: () => applyTabs(closeTab(tabs(), tabs().active)),
    closeTabAt: (index: number) => applyTabs(closeTab(tabs(), index)),
    activate: (index: number) => applyTabs(activateTab(tabs(), index)),
    openSettings: (section: string) => setScreen({ kind: "settings", section }),
    respondAuth,
    cancelOperationPrompts,
    saveSettings,
    loadRepoSettings,
    saveRepoSettings,
    setBridge,
    undoEntry: (id: number) => bridge()?.actions.undo(id),
    paletteContext,
    openExternal,
  };
}

export type AppState = ReturnType<typeof createAppState>;

export const AppContext = createContext<AppState>();

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (app === undefined) throw new Error("AppContext is not provided");
  return app;
}
