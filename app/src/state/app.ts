import { createHotkeys } from "@tanstack/solid-hotkeys";
import { useQuery } from "./query";
import { useRouterState } from "@tanstack/solid-router";
import { createContext, createEffect, createMemo, createSignal, on, onCleanup, useContext } from "solid-js";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { AuthReply } from "../ipc/bindings/AuthReply";
import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import type { RecentRepo } from "../ipc/bindings/RecentRepo";
import type { RepoAlias } from "../ipc/bindings/RepoAlias";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import { client, IpcError } from "../ipc/client";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { AppRouter } from "../routes";
import { viewOf } from "../routes";
import { createStoreValue } from "./clientStore";
import { createAppUiPrefs, DEFAULT_ZOOM_PERCENT, withInspectorToggled, withSidebarToggled, withSyntaxToggled, withZoom, type ZoomMove } from "./appUiPrefs";
import { requestFileHistory } from "./fileHistoryRequest";
import { setSyntaxHighlighting } from "./syntax";
import { createOnline } from "./online";
import { createQueryClient } from "./queryClient";
import { appKeys, diagnosticsKeys, repoKeys } from "./queryKeys";
import { redoState, refreshToasts, toastRepo, undoState, upsertEntry, withRedoChange, type RedoScopes, type Toast } from "./activityModel";
import { dropOperationPrompts, dropPrompt, enqueuePrompt, type PendingPrompt } from "./authModel";
import { buildCommands, hotkeyOf, shortcutCommands, type CommitChoice, type LogTab, type PaletteApp, type PaletteContext, type PanelRequest, type PickerOption } from "./palette";
import type { RepoActions } from "./repoActions";
import type { PlatformActions } from "./platformActions";
import { isEditable, menuChecked, menuEnabled, RELEASE_NOTES_URL, runMenuAction, type MenuDeps } from "./menuBar";
import { SHORTCUTS } from "./shortcuts";
import { applyAppearance, defaultSettings, effectivePullMode } from "./settingsModel";
import type { TabGroupColor } from "../ipc/bindings/TabGroupColor";
import type { Operation } from "../ipc/bindings/Operation";
import {
  activateTab,
  addToGroup,
  closedEntries,
  closeGroup,
  closeTabIds,
  groupTabs,
  idsOfOthers,
  idsToTheRight,
  LAUNCHER_TAB_ID,
  groupCanMove,
  moveGroupStep,
  moveTabStep,
  newGroup,
  nextClosed,
  openLauncherTab,
  openRepoTab,
  pushClosed,
  placeGroup,
  placeTab,
  recolorGroup,
  removeFromGroup,
  resolveTabDrag,
  renameGroup,
  reopenTab,
  restoreTabs,
  sessionOf,
  tabCanMove,
  tabId,
  tabSegments,
  toggleGroup,
  ungroup,
  type Aliases,
  type ClosedTab,
  type MainRoots,
  type Tab,
  type TabDragHit,
  type TabDragSource,
  type TabsState,
  type UserGroup,
} from "./tabs";

export type Screen = { kind: "workspace" } | { kind: "settings"; section: string };

export type EntryDialog = "clone" | "create";

export type RepoNotice = { message: () => string | undefined; dismiss: () => void };

export type Restoring = { tabs: number; groups: UserGroup[] };

export type ClosePlan = { ids: string[]; busy: Array<{ path: string; operation: Operation }> };

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
  viewChanges: () => void;
  redo: () => Promise<void>;
  refresh: () => Promise<void>;
  createTag: (name: string, message: string) => Promise<void>;
};

const PALETTE_SHORTCUT = SHORTCUTS.palette;
const UNDO_SHORTCUT = SHORTCUTS.undo;
const REDO_SHORTCUT = SHORTCUTS.redo;
const REPOSITORY_SEARCH_SHORTCUT = SHORTCUTS.openRepoSearch;
const NO_REPOSITORY_OPEN = "Open a repository first";

const aliasMap = (stored: readonly RepoAlias[]): Aliases => Object.fromEntries(stored.map((entry) => [entry.path, entry.alias]));

const asMessage = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const openFailureMessage = (path: string, failure: unknown): string =>
  failure instanceof IpcError && failure.kind === "not_a_repository" ? `${path} is not a Git repository` : asMessage(failure);

export function createAppState(router: AppRouter) {
  const [settings, setSettings] = createStoreValue<AppSettings>(defaultSettings);
  const [tabList, setTabList] = createStoreValue<Tab[]>([{ kind: "launcher" }]);
  const [groupList, setGroupList] = createStoreValue<UserGroup[]>([]);
  const [mainRoots, setMainRoots] = createStoreValue<MainRoots>({});
  const [aliases, setAliases] = createStoreValue<Aliases>({});
  const [ready, setReady] = createSignal(false);
  const [restoring, setRestoring] = createSignal<Restoring | undefined>();
  const [fatal, setFatal] = createSignal<string | undefined>();
  const [activity, setActivity] = createSignal<ActivityEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [paletteOpen, setPaletteOpenRaw] = createSignal(false);
  const [paletteScope, setPaletteScope] = createSignal<"repositories" | undefined>();
  const [paletteSession, setPaletteSession] = createSignal(1);
  const [redoScopes, setRedoScopes] = createSignal<RedoScopes>({});
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  const [logsTab, setLogsTab] = createSignal<LogTab | undefined>();
  const [profileList, setProfileList] = createSignal<ProfileList | undefined>();
  const [prompts, setPrompts] = createSignal<PendingPrompt[]>([]);
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let announced = 0;
  const [entryDialog, setEntryDialog] = createSignal<EntryDialog | undefined>();
  const [notice, setNotice] = createSignal<string | undefined>();
  const [repoNotice, setRepoNotice] = createSignal<RepoNotice | undefined>();
  const [tabGroupSaveFailure, setTabGroupSaveFailure] = createSignal<string | undefined>();
  const [closedTabs, setClosedTabs] = createSignal<ClosedTab[]>([]);
  const [updateDialogOpen, setUpdateDialogOpen] = createSignal(false);
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
    return current.kind === "repo" || current.kind === "settings" || current.kind === "launchpad" ? current.tab : undefined;
  };
  const tabs = createMemo((): TabsState => ({ tabs: tabList(), active: Math.max(tabList().findIndex((tab) => tabId(tab) === activeTabId()), 0), groups: groupList() }));
  const screen = (): Screen => {
    const current = view();
    return current.kind === "settings" ? { kind: "settings", section: current.section } : { kind: "workspace" };
  };
  const activeTab = (): Tab | undefined => tabs().tabs[tabs().active];
  const activePath = (): string | undefined => {
    const tab = activeTab();
    return tab?.kind === "repo" ? tab.path : undefined;
  };

  const setPaletteOpen = (open: boolean): void => {
    if (!open) setPaletteScope(undefined);
    setPaletteOpenRaw(open);
  };

  function openRepositorySearch(): void {
    setPaletteScope("repositories");
    setPaletteSession((session) => session + 1);
    setPaletteOpenRaw(true);
  }

  const externalTools = useQuery(
    () => ({
      queryKey: ["external-tools", activePath() ?? ""] as const,
      queryFn: () => client.externalToolsStatus(activePath() as string),
      enabled: activePath() !== undefined,
      staleTime: Infinity,
    }),
    () => queryClient,
  );

  const lfsStatus = useQuery(
    () => ({
      queryKey: ["lfs-status", activePath() ?? ""] as const,
      queryFn: () => client.lfsStatus(activePath() as string),
      enabled: activePath() !== undefined,
      staleTime: Infinity,
    }),
    () => queryClient,
  );

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

  function openLaunchpad(): void {
    void router.navigate({ to: "/launchpad", search: { tab: activeTabId() }, replace: true });
  }

  function addPlatformConnection(): void {
    platformAddRequested = true;
    openSettings("platforms");
  }

  const segments = createMemo(() => tabSegments(tabs(), mainRoots()));

  function persistSession(state: TabsState, onFailure: (message: string) => void): void {
    client.sessionSave(sessionOf(state)).then(
      () => setTabGroupSaveFailure(undefined),
      (failure) => onFailure(asMessage(failure)),
    );
  }

  function commitTabs(requested: TabsState): TabsState {
    const next = groupTabs(requested, mainRoots());
    setTabList(next.tabs);
    setGroupList(next.groups);
    return next;
  }

  function applyTabs(requested: TabsState): void {
    const next = commitTabs(requested);
    showTab(next.tabs[next.active]);
    persistSession(next, setNotice);
  }

  function forget(ids: readonly string[]): void {
    setClosedTabs(pushClosed(closedTabs(), closedEntries(tabs(), ids)));
  }

  function closeIds(ids: readonly string[]): void {
    forget(ids);
    applyTabs(closeTabIds(tabs(), ids));
  }

  const reopenable = () => nextClosed(closedTabs(), tabs());

  async function reopenClosedTab(): Promise<void> {
    const next = reopenable();
    if (next === undefined) return;
    setClosedTabs(next.rest);
    await openRepository(next.entry.path, next.entry);
  }

  function showTabAt(offset: number): void {
    const count = tabs().tabs.length;
    applyTabs(activateTab(tabs(), (tabs().active + offset + count) % count));
  }

  function planClose(scope: "others" | "right", path: string): ClosePlan {
    const state = tabs();
    const index = state.tabs.findIndex((tab) => tab.kind === "repo" && tab.path === path);
    if (index < 0) return { ids: [], busy: [] };
    const ids = scope === "others" ? idsOfOthers(state, index) : idsToTheRight(state, index);
    const busy = ids.flatMap((id) => {
      const operation = id === LAUNCHER_TAB_ID ? undefined : queryClient.getQueryData<RepoSnapshot>(repoKeys.snapshot(id))?.operation;
      return operation == null ? [] : [{ path: id, operation }];
    });
    return { ids, busy };
  }

  function applyGroups(requested: TabsState): void {
    const next = commitTabs(requested);
    const current = next.tabs[next.active];
    if (current !== undefined && tabId(current) !== activeTabId()) showTab(current);
    persistSession(next, setTabGroupSaveFailure);
  }

  function closeActive(): void {
    const tab = tabs().tabs[tabs().active];
    if (tab !== undefined) closeIds([tabId(tab)]);
  }

  const rememberMainRoot = (snapshot: RepoSnapshot): void => {
    if (typeof snapshot.main_root === "string") setMainRoots({ ...mainRoots(), [snapshot.root]: snapshot.main_root });
  };

  async function openRepository(path: string, closed?: ClosedTab): Promise<boolean> {
    try {
      const snapshot = await client.repoOpen(path);
      rememberMainRoot(snapshot);
      queryClient.setQueryData(repoKeys.snapshot(snapshot.root), snapshot);
      applyTabs(closed === undefined ? openRepoTab(tabs(), snapshot.root) : reopenTab(tabs(), mainRoots(), { ...closed, path: snapshot.root }));
      queryClient.setQueryData(appKeys.recents, await client.recentAdd(snapshot.root));
      return true;
    } catch (failure) {
      setNotice(openFailureMessage(path, failure));
      return false;
    }
  }

  async function boot(): Promise<void> {
    try {
      const [loaded, session, launch, entries, stored] = await Promise.all([client.settingsLoad(), client.sessionLoad(), client.launchPath(), client.activityList(), client.repoAliasesList()]);
      setSettings(loaded);
      setAliases(aliasMap(stored));
      setActivity(entries);
      if (session.tabs.length > 0) setRestoring({ tabs: session.tabs.length, groups: session.groups });
      await queryClient.fetchQuery({ queryKey: appKeys.recents, queryFn: () => client.recentsList() });
      const launchPaths = launch === null ? [] : [launch];
      const opened = await Promise.all([...launchPaths, ...session.tabs].map((path, index) => client.repoOpen(path).then((snapshot) => snapshot, (failure) => {
        if (index < launchPaths.length) setNotice(openFailureMessage(path, failure));
        return undefined;
      })));
      opened.forEach((snapshot) => snapshot !== undefined && rememberMainRoot(snapshot));
      const restored = groupTabs(restoreTabs(session, launch === null ? undefined : opened[0]?.root), mainRoots());
      setTabList(restored.tabs);
      setGroupList(restored.groups);
      showTab(restored.tabs[restored.active]);
      setReady(true);
      void loadProfiles();
    } catch (failure) {
      setFatal(asMessage(failure));
    } finally {
      setRestoring(undefined);
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

  async function setAlias(path: string, alias: string | null): Promise<string | undefined> {
    try {
      setAliases(aliasMap(await client.repoAliasSet(path, alias)));
      return undefined;
    } catch (failure) {
      return asMessage(failure);
    }
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
      await (with_ === "editor" ? client.openInEditor(path, null) : client.openPath(path, with_));
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  async function openFileInEditor(file: string): Promise<void> {
    const path = activePath();
    if (path === undefined) return;
    try {
      await client.openInEditor(path, file);
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  async function openFileInTool(file: string, area: ChangeArea): Promise<void> {
    const path = activePath();
    if (path === undefined) return;
    try {
      if (area === "conflicted") {
        await client.openInMergeTool(path, file);
        await bridge()?.refresh();
      } else await client.openInDiffTool(path, file, { kind: area === "staged" ? "staged" : "unstaged" });
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  async function initializeLfs(): Promise<void> {
    const path = activePath();
    if (path === undefined) return;
    try {
      await client.lfsInitialize(path);
      await lfsStatus.refetch();
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  const zoom = (move: ZoomMove): void => uiPrefs.update((prefs) => withZoom(prefs, move));

  function toggleTheme(): void {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    void saveSettings({ ...settings(), theme: next }).then((problem) => problem === undefined || setNotice(problem));
  }

  function openReleaseNotes(): void {
    try {
      client.openUrl(RELEASE_NOTES_URL);
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  async function loadProfiles(): Promise<ProfileList | undefined> {
    try {
      const list = await client.profiles();
      setProfileList(list ?? undefined);
      return list ?? undefined;
    } catch (failure) {
      setNotice(asMessage(failure));
      return undefined;
    }
  }

  const activeProfile = () => profileList()?.profiles.find((profile) => profile.id === profileList()?.active);

  async function profileOptions(): Promise<PickerOption[]> {
    const list = await loadProfiles();
    return (list?.profiles ?? []).map((profile) => ({
      value: profile.id,
      label: profile.name,
      note: `${profile.author_name} <${profile.author_email}>`,
      ...(profile.id === list?.active ? { disabledReason: "This is the active profile" } : {}),
    }));
  }

  async function switchProfile(id: string): Promise<void> {
    try {
      await client.sessionSave(sessionOf(tabs()));
      await client.profileSwitch(id);
      const [session, list] = await Promise.all([client.sessionLoad(), client.profiles()]);
      const opened = await Promise.all(session.tabs.map((path) => client.repoOpen(path).then((snapshot) => snapshot, () => undefined)));
      setMainRoots({});
      opened.forEach((snapshot) => snapshot !== undefined && rememberMainRoot(snapshot));
      const restored = groupTabs(restoreTabs(session, undefined), mainRoots());
      setProfileList(list ?? undefined);
      setClosedTabs([]);
      setTabList(restored.tabs);
      setGroupList(restored.groups);
      showTab(restored.tabs[restored.active]);
    } catch (failure) {
      setNotice(asMessage(failure));
    }
  }

  const paletteApp = (): PaletteApp => ({
    openLauncher: () => applyTabs(openLauncherTab(tabs())),
    openFolder: pickFolderAndOpen,
    openClone: () => setEntryDialog("clone"),
    openCreate: () => setEntryDialog("create"),
    closeTab: () => closeActive(),
    reopenClosedTab: () => void reopenClosedTab(),
    canReopenClosedTab: () => reopenable() !== undefined,
    nextTab: () => showTabAt(1),
    previousTab: () => showTabAt(-1),
    checkForUpdate: () => setUpdateDialogOpen(true),
    aliasOf: (path: string) => aliases()[path],
    openSettings,
    openLaunchpad,
    addPlatformConnection,
    toggleDrawer: () => setDrawerOpen((open) => !open),
    openSearch: () => bridge()?.openSearch(),
    openExternal: (with_) => void openExternal(with_),
    setTheme: (theme) => void saveSettings({ ...settings(), theme }),
    toggleTheme,
    openRepositorySearch,
    openShortcuts: () => setShortcutsOpen(true),
    openLogs: (tab) => setLogsTab(tab),
    openDrawer: () => setDrawerOpen(true),
    openReleaseNotes,
    zoom,
    toggleSidebar: () => uiPrefs.update(withSidebarToggled),
    toggleInspector: () => uiPrefs.update(withInspectorToggled),
    toggleSyntaxHighlighting: () => uiPrefs.update(withSyntaxToggled),
    switchProfile: (id) => void switchProfile(id),
    profileList,
    profileOptions,
    openFileInTool: (file, area) => void openFileInTool(file, area),
    openFileInEditor: (file) => void openFileInEditor(file),
    initializeLfs: () => void initializeLfs(),
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
      undo: path === undefined ? { kind: "unavailable", reason: NO_REPOSITORY_OPEN } : undoState(activity(), path),
      redo: path === undefined ? { kind: "unavailable", reason: NO_REPOSITORY_OPEN } : redoState(redoScopes(), path),
      zoomPercent: uiPrefs.prefs().zoom_percent,
      theme: settings().theme,
      externalTools: externalTools.data ?? undefined,
      lfs: lfsStatus.data ?? undefined,
      anchor: { left: Math.max(16, window.innerWidth / 2 - 160), top: 140 },
      app: paletteApp(),
      platform: current?.platform,
      revealCommit: (sha) => current?.revealCommit(sha),
      revealRef: (name) => current?.revealRef(name),
      revealHead: () => current?.revealHead(),
      focusComposer: () => current?.focusComposer(),
      loadCommits: () => current?.loadCommits() ?? Promise.resolve([]),
      openPanel: (panel) => current?.openPanel(panel),
      trackedFiles: () => (path === undefined ? Promise.resolve([]) : client.trackedFiles(path)),
      openFileHistory: (file, view) => requestFileHistory({ file, view }),
      viewChanges: () => current?.viewChanges(),
      redoLast: () => void current?.redo(),
      createTag: (name, message) => void current?.createTag(name, message),
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
            setPaletteOpen(!paletteOpen());
          },
        },
        ...shortcutCommands(buildCommands(paletteContext()))
          .filter((command) => command.shortcut !== PALETTE_SHORTCUT)
          .map((command) => ({
            hotkey: hotkeyOf(command.shortcut as string),
            options: { ignoreInputs: command.shortcut === UNDO_SHORTCUT || command.shortcut === REDO_SHORTCUT },
            callback: (event: KeyboardEvent) => {
              if (event.defaultPrevented || (paletteOpen() && command.shortcut !== REPOSITORY_SEARCH_SHORTCUT) || prompts().length > 0) return;
              event.preventDefault();
              if (command.disabledReason === undefined) command.run([]);
            },
          })),
      ],
      { preventDefault: false, stopPropagation: false },
    );
  }

  function bindMenuBar(): void {
    const [editable, setEditable] = createSignal(isEditable(document.activeElement));
    const track = () => queueMicrotask(() => setEditable(isEditable(document.activeElement)));
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", track);
    onCleanup(() => {
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", track);
    });
    let sent = "";
    const push = (force: boolean) => {
      const enabled = menuEnabled(buildCommands(paletteContext()), editable());
      const checked = menuChecked(settings());
      const state = JSON.stringify([enabled, checked]);
      if (!force && state === sent) return;
      sent = state;
      client.menuUpdate(enabled, checked).catch((failure) => setNotice(asMessage(failure)));
    };
    createEffect(() => push(false));
    const deps: MenuDeps = {
      commands: () => buildCommands(paletteContext()),
      settings,
      saveSettings: async (next) => {
        const failure = await saveSettings(next);
        if (failure !== undefined) setNotice(failure);
        push(true);
      },
      openPalette: () => setPaletteOpen(true),
      openShortcuts: () => setShortcutsOpen(true),
      openUrl: (url) => client.openUrl(url),
      editableFocused: () => isEditable(document.activeElement),
      editCommand: (name) => void document.execCommand(name),
    };
    const unlisten = client.onMenuAction((id) => runMenuAction(id, deps));
    onCleanup(() => void unlisten.then((stop) => stop()));
  }

  function bind(): void {
    bindShortcuts();
    bindMenuBar();
    uiPrefs.ensure();
    createEffect(
      on(
        () => uiPrefs.prefs().zoom_percent,
        (percent, previous) => {
          if (percent === (previous ?? DEFAULT_ZOOM_PERCENT)) return;
          client.setZoom(percent / 100).catch((failure) => setNotice(asMessage(failure)));
        },
      ),
    );
    createEffect(() => setSyntaxHighlighting(uiPrefs.prefs().syntax_highlighting));
    createEffect(
      on(
        () => [paletteOpen(), screen().kind] as const,
        () => {
          if (activePath() === undefined) return;
          void externalTools.refetch();
          void lfsStatus.refetch();
        },
        { defer: true },
      ),
    );
    const colorScheme = window.matchMedia("(prefers-color-scheme: light)");
    const root = document.documentElement;
    const appearance = () => applyAppearance(root, settings(), colorScheme.matches);
    createEffect(appearance);
    colorScheme.addEventListener("change", appearance);
    onCleanup(() => colorScheme.removeEventListener("change", appearance));
    const listeners = [
      client.onOpenPathRequested((request) => void openRepository(request.path)),
      client.onActivity(record),
      client.onRedoChanged((change) => setRedoScopes((scopes) => withRedoChange(scopes, change))),
      client.onAuthPrompt((event) => setPrompts((queue) => enqueuePrompt(queue, event))),
    ];
    onCleanup(() => listeners.forEach((listener) => void listener.then((stop) => stop())));
    createEffect(() => {
      const path = activePath();
      setToasts((current) => current.filter((toast) => toastRepo(toast) === path));
    });
  }

  return {
    queryClient,
    online,
    uiPrefs,
    settings,
    tabs,
    tabSegments: segments,
    aliases,
    aliasOf: (path: string): string | undefined => aliases()[path],
    setAlias,
    ready,
    restoring,
    fatal,
    screen,
    closeSettings: () => showTab(activeTab()),
    openLaunchpad,
    launchpadOpen: () => view().kind === "launchpad",
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
    paletteScope,
    paletteSession,
    openRepositorySearch,
    shortcutsOpen,
    closeShortcuts: () => setShortcutsOpen(false),
    logsTab,
    openLogs: (tab: LogTab) => setLogsTab(tab),
    closeLogs: () => setLogsTab(undefined),
    activeProfile,
    profileList,
    loadProfiles,
    switchProfile,
    zoomPercent: () => uiPrefs.prefs().zoom_percent,
    sidebarHidden: () => uiPrefs.prefs().sidebar_hidden,
    inspectorHidden: () => uiPrefs.prefs().inspector_hidden,
    showInspector: () => uiPrefs.update((prefs) => (prefs.inspector_hidden ? { ...prefs, inspector_hidden: false } : prefs)),
    redoScopes,
    prompts,
    toasts,
    dismissToast: (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    announce: (message: string, show: () => void) => {
      const repo = activePath();
      if (repo !== undefined) setToasts((current) => [...current, { kind: "done", id: -(announced += 1), repo, message, show }]);
    },
    entryDialog,
    setEntryDialog,
    notice,
    setNotice,
    repoNotice,
    showRepoNotice: (source: RepoNotice) => {
      setRepoNotice(() => source);
      return () => setRepoNotice((current) => (current === source ? undefined : current));
    },
    repoSettings,
    activeTab,
    activePath,
    boot,
    bind,
    openRepository,
    openLauncher: () => applyTabs(openLauncherTab(tabs())),
    closeActiveTab: closeActive,
    closeTabAt: (index: number) => {
      const tab = tabs().tabs[index];
      if (tab !== undefined) closeIds([tabId(tab)]);
    },
    closeTabsAt: (path: string) => applyTabs(closeTabIds(tabs(), [path])),
    closeTabIds: closeIds,
    closedTabs,
    planClose,
    reopenClosedTab,
    canReopenClosedTab: () => reopenable() !== undefined,
    nextTab: () => showTabAt(1),
    previousTab: () => showTabAt(-1),
    updateDialogOpen,
    checkForUpdate: () => setUpdateDialogOpen(true),
    closeUpdateDialog: () => setUpdateDialogOpen(false),
    activate: (index: number) => applyTabs(activateTab(tabs(), index)),
    tabGroupSaveFailure,
    retryTabGroupSave: () => persistSession(tabs(), setTabGroupSaveFailure),
    newTabGroup: (path: string, name: string, color: TabGroupColor) => applyGroups(newGroup(tabs(), mainRoots(), path, name, color)),
    addToTabGroup: (path: string, group: number) => applyGroups(addToGroup(tabs(), mainRoots(), path, group)),
    removeFromTabGroup: (path: string) => applyGroups(removeFromGroup(tabs(), mainRoots(), path)),
    moveTab: (path: string, direction: -1 | 1) => applyGroups(moveTabStep(tabs(), mainRoots(), path, direction)),
    moveGroup: (index: number, direction: -1 | 1) => applyGroups(moveGroupStep(tabs(), mainRoots(), index, direction)),
    tabCanMove: (path: string, direction: -1 | 1) => tabCanMove(tabs(), mainRoots(), path, direction),
    groupCanMove: (index: number, direction: -1 | 1) => groupCanMove(tabs(), mainRoots(), index, direction),
    applyTabDrag: (source: TabDragSource, hit: TabDragHit) => {
      const result = resolveTabDrag(tabs(), mainRoots(), source, hit);
      if (result.kind === "place-tab") applyGroups(placeTab(tabs(), mainRoots(), result.path, result.before));
      else if (result.kind === "place-group") applyGroups(placeGroup(tabs(), mainRoots(), result.index, result.before));
      else if (result.kind === "add") applyGroups(addToGroup(tabs(), mainRoots(), result.path, result.group));
      else if (result.kind === "refuse") setNotice(result.reason);
    },
    renameTabGroup: (group: number, name: string) => applyGroups(renameGroup(tabs(), group, name)),
    recolorTabGroup: (group: number, color: TabGroupColor) => applyGroups(recolorGroup(tabs(), group, color)),
    toggleTabGroup: (group: number) => applyGroups(toggleGroup(tabs(), group)),
    ungroupTabs: (group: number) => applyGroups(ungroup(tabs(), group)),
    closeTabGroup: (group: number) => {
      forget(tabs().groups[group]?.tabs ?? []);
      applyGroups(closeGroup(tabs(), group));
    },
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
