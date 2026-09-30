import { createHotkeys } from "@tanstack/solid-hotkeys";
import { useQuery } from "./query";
import { useRouterState } from "@tanstack/solid-router";
import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { AuthReply } from "../ipc/bindings/AuthReply";
import type { RecentRepo } from "../ipc/bindings/RecentRepo";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import { client, IpcError } from "../ipc/client";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { AppRouter } from "../routes";
import { viewOf } from "../routes";
import { createStoreValue } from "./clientStore";
import { createAppUiPrefs } from "./appUiPrefs";
import { createOnline } from "./online";
import { createQueryClient } from "./queryClient";
import { appKeys, diagnosticsKeys, repoKeys } from "./queryKeys";
import { refreshToasts, undoState, upsertEntry, type Toast } from "./activityModel";
import { dropOperationPrompts, dropPrompt, enqueuePrompt, type PendingPrompt } from "./authModel";
import { buildCommands, hotkeyOf, shortcutCommands, type CommitChoice, type PaletteApp, type PaletteContext, type PanelRequest } from "./palette";
import type { RepoActions } from "./repoActions";
import type { PlatformActions } from "./platformActions";
import { SHORTCUTS } from "./shortcuts";
import { applyAppearance, defaultSettings, effectivePullMode } from "./settingsModel";
import { activateTab, closeTab, groupTabs, LAUNCHER_TAB_ID, openLauncherTab, openRepoTab, restoreTabs, sessionOf, tabGroups, tabId, type MainRoots, type Tab, type TabsState } from "./tabs";

export type Screen = { kind: "workspace" } | { kind: "settings"; section: string };

export type EntryDialog = "clone" | "create";

export type RepoBridge = {
  path: string;
  snapshot: () => RepoSnapshot;
  actions: RepoActions;
  selectedSha: () => string | undefined;
  selectedShas: () => readonly string[];
  revealCommit: (sha: string) => void;
  revealRef: (name: string) => void;
  revealHead: () => void;
  openSearch: () => void;
  focusComposer: () => void;
  loadCommits: () => Promise<CommitChoice[]>;
  openPanel: (panel: PanelRequest) => void;
  platform: PlatformActions;
};

const PALETTE_SHORTCUT = SHORTCUTS.palette;
const UNDO_SHORTCUT = SHORTCUTS.undo;

const asMessage = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function createAppState(router: AppRouter) {
  const [settings, setSettings] = createStoreValue<AppSettings>(defaultSettings);
  const [tabList, setTabList] = createStoreValue<Tab[]>([{ kind: "launcher" }]);
  const [mainRoots, setMainRoots] = createStoreValue<MainRoots>({});
  const [ready, setReady] = createSignal(false);
  const [fatal, setFatal] = createSignal<string | undefined>();
  const [activity, setActivity] = createSignal<ActivityEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [prompts, setPrompts] = createSignal<PendingPrompt[]>([]);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  const [entryDialog, setEntryDialog] = createSignal<EntryDialog | undefined>();
  const [notice, setNotice] = createSignal<string | undefined>();
  const [bridge, setBridge] = createSignal<RepoBridge | undefined>();
  let platformAddRequested = false;
  const queryClient = createQueryClient();
  const online = createOnline();
  const uiPrefs = createAppUiPrefs(queryClient, (failure) => setNotice(asMessage(failure)));
  const recentPaths = (): string[] => (queryClient.getQueryData<RecentRepo[]>(appKeys.recents) ?? []).map((recent) => recent.path);
  const location = useRouterState({ router, select: (state) => state.location });
  const view = createMemo(() => viewOf(router.matchRoutes(location())));

  const activeTabId = (): string | undefined => {
    const current = view();
    if (current.kind === "launcher") return LAUNCHER_TAB_ID;
    return current.kind === "repo" || current.kind === "settings" ? current.tab : undefined;
  };
  const tabs = createMemo((): TabsState => ({ tabs: tabList(), active: Math.max(tabList().findIndex((tab) => tabId(tab) === activeTabId()), 0) }));
  const screen = (): Screen => {
    const current = view();
    return current.kind === "settings" ? { kind: "settings", section: current.section } : { kind: "workspace" };
  };
  const activeTab = (): Tab | undefined => tabs().tabs[tabs().active];
  const activePath = (): string | undefined => {
    const tab = activeTab();
    return tab?.kind === "repo" ? tab.path : undefined;
  };

  const activeRepoSettings = useQuery(
    () => ({
      queryKey: repoKeys.settings(activePath() ?? ""),
      queryFn: () => client.repoSettingsLoad(activePath() as string),
      enabled: activePath() !== undefined,
      staleTime: Infinity,
    }),
    () => queryClient,
  );
  const repoSettings = (path: string): RepoSettings | undefined => (path === activePath() ? activeRepoSettings.data : undefined);
  createEffect(() => {
    if (activeRepoSettings.error != null) setNotice(asMessage(activeRepoSettings.error));
  });

  function showTab(tab: Tab | undefined): void {
    if (tab?.kind === "repo") void router.navigate({ to: "/repo", search: { tab: tab.path }, replace: true });
    else void router.navigate({ to: "/launcher", replace: true });
  }

  function openSettings(section: string): void {
    void router.navigate({ to: "/settings/$section", params: { section }, search: { tab: activeTabId() }, replace: true });
  }

  function addPlatformConnection(): void {
    platformAddRequested = true;
    openSettings("platforms");
  }

  const tabGroupList = createMemo(() => tabGroups(tabs(), mainRoots()));

  function applyTabs(requested: TabsState): void {
    const next = groupTabs(requested, mainRoots());
    setTabList(next.tabs);
    showTab(next.tabs[next.active]);
    client.sessionSave(sessionOf(next)).catch((failure) => setNotice(asMessage(failure)));
  }

  const rememberMainRoot = (snapshot: RepoSnapshot): void => {
    if (typeof snapshot.main_root === "string") setMainRoots({ ...mainRoots(), [snapshot.root]: snapshot.main_root });
  };

  async function openRepository(path: string): Promise<boolean> {
    try {
      const snapshot = await client.repoOpen(path);
      rememberMainRoot(snapshot);
      applyTabs(openRepoTab(tabs(), snapshot.root));
      queryClient.setQueryData(appKeys.recents, await client.recentAdd(snapshot.root));
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
      await queryClient.fetchQuery({ queryKey: appKeys.recents, queryFn: () => client.recentsList() });
      const opened = await Promise.all([launch, ...session.tabs].map((path) => client.repoOpen(path).then((snapshot) => snapshot, () => undefined)));
      opened.forEach((snapshot) => snapshot !== undefined && rememberMainRoot(snapshot));
      const restored = groupTabs(restoreTabs(session, opened[0]?.root), mainRoots());
      setTabList(restored.tabs);
      showTab(restored.tabs[restored.active]);
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

  async function saveRepoSettings(path: string, next: RepoSettings): Promise<string | undefined> {
    try {
      await client.repoSettingsSave(path, next);
      queryClient.setQueryData(repoKeys.settings(path), next);
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
    openSettings,
    addPlatformConnection,
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
      selection: current?.selectedShas() ?? [],
      pullMode: effectivePullMode(settings(), path === undefined ? undefined : repoSettings(path)).mode,
      offline: !online(),
      undo: path === undefined ? { kind: "unavailable", reason: "Open a repository first" } : undoState(activity(), path),
      anchor: { left: Math.max(16, window.innerWidth / 2 - 160), top: 140 },
      app: paletteApp(),
      platform: current?.platform,
      revealCommit: (sha) => current?.revealCommit(sha),
      revealRef: (name) => current?.revealRef(name),
      revealHead: () => current?.revealHead(),
      focusComposer: () => current?.focusComposer(),
      loadCommits: () => current?.loadCommits() ?? Promise.resolve([]),
      openPanel: (panel) => current?.openPanel(panel),
    };
  }

  function bindShortcuts(): void {
    createHotkeys(
      () => [
        {
          hotkey: hotkeyOf(PALETTE_SHORTCUT),
          callback: (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            setPaletteOpen((open) => !open);
          },
        },
        ...shortcutCommands(buildCommands(paletteContext()))
          .filter((command) => command.shortcut !== PALETTE_SHORTCUT)
          .map((command) => ({
            hotkey: hotkeyOf(command.shortcut as string),
            options: { ignoreInputs: command.shortcut === UNDO_SHORTCUT },
            callback: (event: KeyboardEvent) => {
              if (event.defaultPrevented || paletteOpen() || prompts().length > 0) return;
              event.preventDefault();
              if (command.disabledReason === undefined) command.run([]);
            },
          })),
      ],
      { preventDefault: false, stopPropagation: false },
    );
  }

  function bind(): void {
    bindShortcuts();
    const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
    const root = document.documentElement;
    const appearance = () => applyAppearance(root, settings(), colorScheme.matches);
    createEffect(appearance);
    colorScheme.addEventListener("change", appearance);
    onCleanup(() => colorScheme.removeEventListener("change", appearance));
    const listeners = [
      client.onOpenPathRequested((request) => void openRepository(request.path)),
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
    queryClient,
    online,
    uiPrefs,
    settings,
    tabs,
    tabGroups: tabGroupList,
    ready,
    fatal,
    screen,
    closeSettings: () => showTab(activeTab()),
    activity,
    drawerOpen,
    toggleDrawer: () => setDrawerOpen((open) => !open),
    closeDrawer: () => setDrawerOpen(false),
    openDrawer: () => setDrawerOpen(true),
    clearActivity: async (repo: string | undefined) => {
      await client.activityClear(repo ?? null);
      setActivity(await client.activityList());
      await queryClient.invalidateQueries({ queryKey: diagnosticsKeys.allHistory });
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
    closeTabsAt: (path: string) => {
      const index = tabs().tabs.findIndex((tab) => tab.kind === "repo" && tab.path === path);
      if (index >= 0) applyTabs(closeTab(tabs(), index));
    },
    activate: (index: number) => applyTabs(activateTab(tabs(), index)),
    openSettings,
    addPlatformConnection,
    takePlatformAddRequest: (): boolean => {
      const requested = platformAddRequested;
      platformAddRequested = false;
      return requested;
    },
    respondAuth,
    cancelOperationPrompts,
    saveSettings,
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
