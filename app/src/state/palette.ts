import type { Hotkey } from "@tanstack/solid-hotkeys";
import type { IconName } from "../iconNames";
import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { LfsStatus } from "../ipc/bindings/LfsStatus";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import { NOTHING_TO_UNDO, type RedoState, type UndoState } from "./activityModel";
import { zoomBlockReason, type ZoomMove } from "./appUiPrefs";
import { commitMenu, localTarget, NOT_AVAILABLE, operationBlock, refMenu, remoteTarget, resetModeMenu, tagTarget, type MenuContext, type MenuEntry, type RefTarget } from "./refMenu";
import type { Anchor, RepoActions } from "./repoActions";
import { SHORTCUTS } from "./shortcuts";
import { THEME_OPTIONS } from "./settingsModel";
import { pullModes, syncMenu } from "./syncModel";
import type { PlatformActions } from "./platformActions";

export type PickerOption = { value: string; label: string; note?: string; disabledReason?: string };

export type ArgSpec = { name: string; label: string; options: () => PickerOption[] | Promise<PickerOption[]>; text?: boolean };

export type PaletteGroup = "Repository" | "Branches" | "Commits" | "Tags" | "Sync" | "Stash" | "Pull requests" | "Operation" | "Navigate" | "Application" | "Settings" | "View" | "History" | "File" | "Patch" | "Logs";

const REPOSITORY_FREE: readonly PaletteGroup[] = ["Application", "Navigate", "Settings", "View", "Logs"];

export type ExternalTools = { editor: string | null; diff: string | null; merge: string | null };

export type LogTab = "errors" | "performance";

export const NO_EDITOR = "Choose an external editor in Settings → External tools";
export const NO_DIFF_TOOL = "Choose an external diff tool in Settings → External tools";
export const NO_MERGE_TOOL = "Choose an external merge tool in Settings → External tools";
export const NO_CHANGED_FILES = "No changed files to open in a tool";
export const LFS_NOT_INSTALLED = "Git LFS is not installed on this Mac";
export const LFS_INITIALIZED = "Git LFS is already initialized in this repository";
export const ONE_PROFILE = "Create another profile in Settings to switch";
export const ACTIVE_PROFILE = "This is the active profile";

export type PaletteCommand = {
  id: string;
  title: string;
  group: PaletteGroup;
  shortcut?: string;
  note?: string;
  covers: string[];
  args: ArgSpec[];
  disabledReason?: string;
  run: (values: string[]) => void;
};

const commandIcons: Partial<Record<string, IconName>> = {
  "repository.open": "folder",
  "repository.clone": "remote",
  "repository.create": "plus",
  "tab.new": "plus",
  "tab.close": "close",
  "settings.open": "settings",
  "launchpad.open": "launchpad",
  "settings.theme": "theme",
  "theme.toggle": "theme",
  "theme.light": "theme",
  "theme.dark": "theme",
  "repository.search": "search",
  "open.diffmerge": "diff",
  "repository.maintain": "settings",
  "settings.git_flow": "branch",
  "settings.lfs_configure": "settings",
  "settings.lfs_init": "plus",
  "settings.signing": "key",
  "accounts.manage": "identity",
  "profile.switch": "identity",
  "zoom.in": "plus",
  "zoom.out": "minus",
  "zoom.reset": "search",
  "shortcuts.show": "key",
  "view.sidebar": "grip",
  "view.inspector": "grip",
  "view.syntax": "edit",
  "history.file": "history",
  "history.blame": "history",
  "file.create": "plus",
  "file.delete": "trash",
  "file.open_editor": "edit",
  "file.view": "file",
  "file.edit": "edit",
  "file.discard_all": "trash",
  "tag.create_annotated": "tag",
  "wip.view": "changes",
  "patch.create": "diff",
  "patch.apply": "diff",
  "logs.activity": "activity",
  "logs.errors": "warning",
  "logs.performance": "activity",
  "logs.release_notes": "open",
  redo: "redo",
  "activity.toggle": "activity",
  "search.commits": "search",
  "open.editor": "edit",
  "open.terminal": "terminal",
  "open.finder": "folder",
  "worktrees.show": "worktree",
  "worktrees.create": "worktree",
  "recovery.reflog": "history",
  "recovery.lost": "search",
  "recovery.snapshots": "stash",
  undo: "undo",
  "changes.stage_all": "plus",
  "changes.unstage_all": "minus",
  commit: "commit",
  "branch.checkout": "check",
  "branch.create": "branch",
  "branch.rename": "edit",
  "branch.delete": "trash",
  "branch.merge": "merge",
  "commit.revert": "undo",
  "history.rebase": "rebase",
  "history.squash": "squash",
  "history.recompose": "recompose",
  "tag.create": "tag",
  "tag.push": "push",
  "tag.delete": "trash",
  "tag.delete_remote": "trash",
  "sync.fetch": "fetch",
  "sync.pull": "pull",
  "sync.push": "push",
  "stash.push": "stash",
  "stash.apply": "stash",
  "stash.pop": "stash",
  "stash.drop": "trash",
  "pulls.create": "pullrequest",
  "pulls.merge": "merge",
  "pulls.open": "open",
  "platforms.add": "plug",
};

export function commandIcon(id: string): IconName | undefined {
  if (id.startsWith("go.branch.")) return "local";
  if (id.startsWith("go.settings.")) return SETTINGS_SECTIONS.find((section) => id === `go.settings.${section.id}`)?.icon;
  if (id.startsWith("go.commit.")) return "commit";
  if (id.startsWith("go.repository.")) return "folder";
  return commandIcons[id];
}

export type PanelRequest = "worktrees" | "create_worktree" | "reflog" | "lost" | "snapshots";

export type CommitChoice = { sha: string; summary: string; merge: boolean; root: boolean };

export type SettingsSection = { id: string; label: string; icon: IconName };

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "git", label: "Git", icon: "branch" },
  { id: "tools", label: "External tools", icon: "open" },
  { id: "repositories", label: "Repositories", icon: "folder" },
  { id: "appearance", label: "Appearance", icon: "theme" },
  { id: "ai", label: "AI", icon: "wand" },
  { id: "platforms", label: "Platforms", icon: "plug" },
  { id: "jira", label: "Jira", icon: "issue" },
  { id: "git-hosts", label: "Git hosts", icon: "identity" },
  { id: "privacy", label: "Privacy & diagnostics", icon: "lock" },
  { id: "repository", label: "This repository", icon: "folder" },
];

export type PaletteApp = {
  openLauncher: () => void;
  openFolder: () => void;
  openClone: () => void;
  openCreate: () => void;
  closeTab: () => void;
  openSettings: (section: string) => void;
  openLaunchpad: () => void;
  addPlatformConnection: () => void;
  toggleDrawer: () => void;
  openSearch: () => void;
  openExternal: (with_: "editor" | "terminal" | "finder") => void;
  setTheme: (theme: AppSettings["theme"]) => void;
  openRepository: (path: string) => void;
  repositories: () => string[];
  openRepositorySearch: () => void;
  openShortcuts: () => void;
  openLogs: (tab: LogTab) => void;
  openDrawer: () => void;
  openReleaseNotes: () => void;
  zoom: (move: ZoomMove) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleSyntaxHighlighting: () => void;
  toggleTheme: () => void;
  switchProfile: (id: string) => void;
  profileList: () => ProfileList | undefined;
  profileOptions: () => Promise<PickerOption[]>;
  openFileInTool: (file: string, area: ChangeArea) => void;
  openFileInEditor: (file: string) => void;
  initializeLfs: () => void;
  aliasOf: (path: string) => string | undefined;
  canReopenClosedTab: () => boolean;
  reopenClosedTab: () => void;
  nextTab: () => void;
  previousTab: () => void;
  checkForUpdate: () => void;
};

export type PaletteContext = {
  snapshot: RepoSnapshot | undefined;
  actions: RepoActions | undefined;
  selectedSha: string | undefined;
  selection: readonly string[];
  pullMode: PullMode;
  offline: boolean;
  undo: UndoState;
  redo: RedoState;
  zoomPercent: number;
  theme: AppSettings["theme"];
  externalTools: ExternalTools | undefined;
  lfs: LfsStatus | undefined;
  anchor: Anchor;
  app: PaletteApp;
  platform: PlatformActions | undefined;
  revealCommit: (sha: string) => void;
  revealRef: (name: string) => void;
  focusComposer: () => void;
  revealHead: () => void;
  loadCommits: () => Promise<CommitChoice[]>;
  openPanel: (panel: PanelRequest) => void;
  trackedFiles: () => Promise<string[]>;
  openFileHistory: (file: string, view: "diff" | "blame") => void;
  viewChanges: () => void;
  redoLast: () => void;
  createTag: (name: string, message: string) => void;
};

const NO_REPOSITORY = "Open a repository first";

export const NO_CLOSED_TABS = "No closed tabs";

const shortSha = (sha: string): string => sha.slice(0, 7);

const menuContextOf = (snapshot: RepoSnapshot): MenuContext => ({
  current: snapshot.head.kind === "branch" ? snapshot.head.name : undefined,
  remotes: snapshot.remotes,
  operation: snapshot.operation,
  upstream: snapshot.upstream?.name ?? null,
});

const reasonOf = (entries: MenuEntry[], id: string): { present: boolean; reason: string | undefined } => {
  const entry = entries.find((candidate) => candidate.kind === "item" && candidate.id === id);
  return entry?.kind === "item" ? { present: true, reason: entry.disabledReason } : { present: false, reason: undefined };
};

export function refTargets(snapshot: RepoSnapshot): RefTarget[] {
  return [
    ...snapshot.branches.map((name) => localTarget(snapshot, name)),
    ...snapshot.remote_branches.map((name) => remoteTarget(name)),
    ...snapshot.tags.map((name) => tagTarget(name)),
  ];
}

const kindNote = { local_branch: "local", remote_branch: "remote", tag: "tag" } as const;

export function refOptions(snapshot: RepoSnapshot, menuId: string): PickerOption[] {
  const context = menuContextOf(snapshot);
  return refTargets(snapshot).flatMap((target) => {
    const { present, reason } = reasonOf(refMenu(target, context), menuId);
    if (!present) return [];
    return [{ value: `${target.kind}:${target.name}`, label: target.name, note: kindNote[target.kind], ...(reason === undefined ? {} : { disabledReason: reason }) }];
  });
}

const targetFor = (snapshot: RepoSnapshot, value: string): RefTarget | undefined =>
  refTargets(snapshot).find((target) => `${target.kind}:${target.name}` === value);

export function commitOptions(snapshot: RepoSnapshot, choices: readonly CommitChoice[], menuId: string): PickerOption[] {
  const context = menuContextOf(snapshot);
  return choices.map((choice) => {
    const { reason } = reasonOf(commitMenu({ ...context, sha: choice.sha, merge: choice.merge, root: choice.root }), menuId);
    return { value: choice.sha, label: choice.summary === "" ? "(no message)" : choice.summary, note: shortSha(choice.sha), ...(reason === undefined ? {} : { disabledReason: reason }) };
  });
}

const resetModeOptions = (): PickerOption[] =>
  resetModeMenu().flatMap((entry) => (entry.kind === "item" ? [{ value: entry.id, label: entry.label.map((part) => (typeof part === "string" ? part : part.ref)).join(""), ...(entry.note === undefined ? {} : { note: entry.note }) }] : []));

export function buildCommands(context: PaletteContext): PaletteCommand[] {
  const { snapshot, actions, app } = context;
  const repo = snapshot !== undefined && actions !== undefined ? { snapshot, actions } : undefined;
  const menuContext = snapshot === undefined ? undefined : menuContextOf(snapshot);
  const busy = actions?.sync().kind === "running";
  const current = menuContext?.current;

  const command = (spec: Omit<PaletteCommand, "covers" | "args" | "run"> & Partial<Pick<PaletteCommand, "covers" | "args" | "run">>): PaletteCommand => ({
    covers: [],
    args: [],
    run: () => undefined,
    ...spec,
    disabledReason: spec.disabledReason ?? (REPOSITORY_FREE.includes(spec.group) ? undefined : repo === undefined ? NO_REPOSITORY : undefined),
  });

  const refArg = (menuId: string, label: string): ArgSpec => ({
    name: "ref",
    label,
    options: () => (snapshot === undefined ? [] : refOptions(snapshot, menuId)),
  });

  const commitArg = (menuId: string, label: string): ArgSpec => ({
    name: "commit",
    label,
    options: async () => (snapshot === undefined ? [] : commitOptions(snapshot, await context.loadCommits(), menuId)),
  });

  const withTarget = (run: (target: RefTarget, actions: RepoActions, snapshot: RepoSnapshot) => void) => (values: string[]) => {
    if (repo === undefined) return;
    const target = targetFor(repo.snapshot, values[0] ?? "");
    if (target !== undefined) run(target, repo.actions, repo.snapshot);
  };

  const withCommit = (run: (sha: string, actions: RepoActions) => void) => (values: string[]) => {
    if (repo !== undefined && values[0] !== undefined) run(values[0], repo.actions);
  };

  const sync = (id: string): { disabledReason?: string } => {
    if (snapshot === undefined) return {};
    const { reason } = reasonOf(syncMenu(snapshot, busy === true, context.pullMode, context.offline), id);
    return reason === undefined ? {} : { disabledReason: reason };
  };

  const unavailable = (id: string, title: string, group: PaletteGroup): PaletteCommand => command({ id: `unavailable.${id}`, title, group, covers: [id], disabledReason: NOT_AVAILABLE });

  const stashOptions = (): PickerOption[] =>
    snapshot === undefined ? [] : snapshot.stashes.map((stash) => ({ value: String(stash.index), label: `stash@{${stash.index}}`, note: stash.message }));
  const stashArg: ArgSpec = { name: "stash", label: "Stash", options: stashOptions };
  const withStash = (run: (stash: RepoSnapshot["stashes"][number], actions: RepoActions) => void) => (values: string[]) => {
    const stash = repo?.snapshot.stashes.find((entry) => String(entry.index) === values[0]);
    if (repo !== undefined && stash !== undefined) run(stash, repo.actions);
  };
  const noStashes = snapshot !== undefined && snapshot.stashes.length === 0 ? "This repository has no stashes" : undefined;
  const localBranchOption = (id: string, label: string): ArgSpec => ({ ...refArg(id, label), options: () => (snapshot === undefined ? [] : refOptions(snapshot, id).filter((option) => option.value.startsWith("local_branch:"))) });
  const tagOption = (id: string, label: string): ArgSpec => ({ ...refArg(id, label), options: () => (snapshot === undefined ? [] : refOptions(snapshot, id).filter((option) => option.value.startsWith("tag:"))) });
  const platform = context.platform;
  const listedPulls = platform?.pulls() ?? [];
  const openPulls = listedPulls.filter((pull) => pull.state === "open");
  const noPlatform = repo !== undefined && platform?.matched() === undefined ? "No platform connection matches this repository's remotes" : undefined;
  const pullOptions = (pulls: typeof listedPulls): PickerOption[] => pulls.map((pull) => ({ value: String(pull.number), label: `#${pull.number} ${pull.title}`, note: `${pull.source_ref} → ${pull.target_ref}` }));
  const pullArg = (label: string, pulls: typeof listedPulls): ArgSpec => ({ name: "pull", label, options: () => pullOptions(pulls) });
  const withPull = (pulls: typeof listedPulls, run: (pull: (typeof listedPulls)[number], platform: PlatformActions) => void) => (values: string[]) => {
    const pull = pulls.find((entry) => String(entry.number) === values[0]);
    if (platform !== undefined && pull !== undefined) run(pull, platform);
  };
  const operation = snapshot?.operation ?? null;
  const noOperation = operation === null ? "No operation is in progress" : undefined;
  const modeCommand = (mode: PullMode, label: string): PaletteCommand =>
    command({
      id: `sync.pull.${mode}`,
      title: label,
      group: "Sync",
      covers: [`pull:${mode}`],
      ...sync(`pull:${mode}`),
      run: () => void repo?.actions.pull(mode),
    });

  const tools = context.externalTools;
  const noEditor = tools !== undefined && tools.editor === null ? NO_EDITOR : undefined;
  const changedFiles = snapshot?.files ?? [];
  const actionReason = (reason: string | undefined): { disabledReason?: string } => (reason === undefined ? {} : { disabledReason: reason });
  const fileArg: ArgSpec = { name: "file", label: "File", options: async () => (await context.trackedFiles()).map((file) => ({ value: file, label: file })) };
  const textArg = (name: string, label: string): ArgSpec => ({ name, label, options: () => [], text: true });
  const withFile = (run: (file: string, actions: RepoActions) => void) => (values: string[]) => {
    if (repo !== undefined && values[0] !== undefined) run(values[0], repo.actions);
  };
  const toolOptions = (): PickerOption[] =>
    changedFiles.map((file) => {
      const reason = file.area === "conflicted" ? (tools?.merge === null ? NO_MERGE_TOOL : undefined) : tools?.diff === null ? NO_DIFF_TOOL : undefined;
      return { value: `${file.area}:${file.path}`, label: file.path, note: file.area, ...(reason === undefined ? {} : { disabledReason: reason }) };
    });
  const withTool = (values: string[]) => {
    const [first = ""] = values;
    const at = first.indexOf(":");
    if (at > 0) app.openFileInTool(first.slice(at + 1), first.slice(0, at) as ChangeArea);
  };
  const needsRepository = repo === undefined ? { disabledReason: NO_REPOSITORY } : {};
  const lfsBlock = context.lfs === undefined ? {} : !context.lfs.installed ? { disabledReason: LFS_NOT_INSTALLED } : context.lfs.initialized ? { disabledReason: LFS_INITIALIZED } : {};
  const profiles = app.profileList();
  const themeNow = (target: "light" | "dark"): { disabledReason?: string } => (context.theme === target ? { disabledReason: `The theme is already ${target}` } : {});
  const zoom = (move: ZoomMove): { disabledReason?: string } => {
    const reason = zoomBlockReason(context.zoomPercent, move);
    return reason === undefined ? {} : { disabledReason: reason };
  };

  return [
    command({ id: "repository.open", title: "Open repository…", group: "Application", shortcut: SHORTCUTS.openRepository, run: () => app.openFolder() }),
    command({ id: "repository.clone", title: "Clone repository…", group: "Application", shortcut: SHORTCUTS.cloneRepository, run: () => app.openClone() }),
    command({ id: "repository.create", title: "Create repository…", group: "Application", shortcut: SHORTCUTS.createRepository, run: () => app.openCreate() }),
    command({ id: "tab.new", title: "New tab", group: "Application", shortcut: SHORTCUTS.newTab, run: () => app.openLauncher() }),
    command({ id: "tab.close", title: "Close tab", group: "Application", shortcut: SHORTCUTS.closeTab, run: () => app.closeTab() }),
    command({
      id: "tab.reopen",
      title: "Reopen closed tab",
      group: "Application",
      shortcut: SHORTCUTS.reopenClosedTab,
      ...(app.canReopenClosedTab() ? {} : { disabledReason: NO_CLOSED_TABS }),
      run: () => app.reopenClosedTab(),
    }),
    command({ id: "tab.next", title: "Show next tab", group: "Application", shortcut: SHORTCUTS.nextTab, run: () => app.nextTab() }),
    command({ id: "tab.previous", title: "Show previous tab", group: "Application", shortcut: SHORTCUTS.previousTab, run: () => app.previousTab() }),
    command({ id: "update.check", title: "Check for update…", group: "Application", run: () => app.checkForUpdate() }),
    command({ id: "launchpad.open", title: "Open Launchpad", group: "Application", run: () => app.openLaunchpad() }),
    command({ id: "settings.open", title: "Open settings", group: "Application", shortcut: SHORTCUTS.settings, run: () => app.openSettings("general") }),
    command({
      id: "settings.theme",
      title: "Change theme…",
      group: "Application",
      args: [{ name: "theme", label: "Theme", options: () => [...THEME_OPTIONS] }],
      run: (values) => {
        const chosen = THEME_OPTIONS.find((theme) => theme.value === values[0]);
        if (chosen !== undefined) app.setTheme(chosen.value);
      },
    }),
    command({ id: "activity.toggle", title: "Toggle Activity drawer", group: "Application", shortcut: SHORTCUTS.activity, run: () => app.toggleDrawer() }),
    command({ id: "head.reveal", title: "Reveal HEAD in the graph", group: "Repository", shortcut: SHORTCUTS.revealHead, run: () => context.revealHead() }),
    command({ id: "search.commits", title: "Search commits", group: "Commits", shortcut: SHORTCUTS.search, run: () => app.openSearch() }),
    command({ id: "repository.search", title: "Open repo…", group: "Application", shortcut: SHORTCUTS.openRepoSearch, run: () => app.openRepositorySearch() }),
    command({ id: "open.editor", title: "Open in external editor", group: "Repository", shortcut: SHORTCUTS.openInEditor, ...(noEditor === undefined ? {} : { disabledReason: noEditor }), run: () => app.openExternal("editor") }),
    command({
      id: "open.diffmerge",
      title: "Open in external diff or merge tool…",
      group: "Repository",
      args: [{ name: "file", label: "Changed file", options: toolOptions }],
      ...(changedFiles.length === 0 ? { disabledReason: NO_CHANGED_FILES } : {}),
      run: withTool,
    }),
    command({ id: "repository.maintain", title: "Perform repository maintenance", group: "Repository", ...actionReason(repo?.actions.maintainReason()), run: () => repo?.actions.maintain() }),
    command({ id: "open.terminal", title: "Open in terminal", group: "Repository", run: () => app.openExternal("terminal") }),
    command({ id: "open.finder", title: "Reveal in Finder", group: "Repository", run: () => app.openExternal("finder") }),
    command({ id: "worktrees.show", title: "Show worktrees", group: "Repository", run: () => context.openPanel("worktrees") }),
    command({ id: "worktrees.create", title: "Create worktree…", group: "Repository", run: () => context.openPanel("create_worktree") }),
    command({ id: "recovery.reflog", title: "Recovery: browse the reflog", group: "Repository", run: () => context.openPanel("reflog") }),
    command({ id: "recovery.lost", title: "Recovery: find lost commits", group: "Repository", run: () => context.openPanel("lost") }),
    command({ id: "recovery.snapshots", title: "Recovery: show safety snapshots", group: "Repository", run: () => context.openPanel("snapshots") }),
    command({
      id: "undo",
      title: "Undo last operation",
      group: "Repository",
      shortcut: SHORTCUTS.undo,
      ...(context.undo.kind === "available" ? {} : { disabledReason: context.undo.reason === "" ? NOTHING_TO_UNDO : context.undo.reason }),
      run: () => {
        if (context.undo.kind === "available") void repo?.actions.undo(context.undo.entry.id);
      },
    }),
    command({
      id: "redo",
      title: "Redo last operation",
      group: "Repository",
      shortcut: SHORTCUTS.redo,
      ...(context.redo.kind === "available" ? {} : { disabledReason: context.redo.reason }),
      run: () => context.redoLast(),
    }),
    command({ id: "wip.view", title: "View working directory changes", group: "Branches", run: () => context.viewChanges() }),
    command({ id: "changes.stage_all", title: "Stage all changes", group: "Repository", run: () => void repo?.actions.stageAll() }),
    command({ id: "changes.unstage_all", title: "Unstage all changes", group: "Repository", run: () => void repo?.actions.unstageAll() }),
    command({ id: "commit", title: "Commit staged changes…", group: "Repository", shortcut: SHORTCUTS.commit, run: () => context.focusComposer() }),
    command({
      id: "branch.checkout",
      title: "Checkout…",
      group: "Branches",
      covers: ["checkout"],
      args: [refArg("checkout", "Checkout")],
      run: withTarget((target, actions) => actions.checkoutRef(target)),
    }),
    command({
      id: "branch.create",
      title: "Create branch…",
      group: "Branches",
      shortcut: SHORTCUTS.createBranch,
      covers: ["create_branch"],
      ...(snapshot?.head.kind === "unborn" ? { disabledReason: "Make a first commit before creating branches" } : {}),
      run: () => repo?.actions.openCreateBranchAt(context.selectedSha ?? null, context.anchor),
    }),
    command({
      id: "branch.rename",
      title: "Rename branch…",
      group: "Branches",
      covers: ["rename"],
      args: [localBranchOption("rename", "Rename")],
      run: withTarget((target, actions) => actions.openRenameBranch(target.name, context.anchor)),
    }),
    command({
      id: "branch.delete",
      title: "Delete branch…",
      group: "Branches",
      covers: ["delete"],
      args: [localBranchOption("delete", "Delete")],
      run: withTarget((target, actions) => void actions.deleteBranch(target.name)),
    }),
    command({
      id: "branch.set_upstream",
      title: "Set upstream…",
      group: "Branches",
      covers: ["set_upstream"],
      args: [localBranchOption("set_upstream", "Set upstream of")],
      run: withTarget((target, actions) => actions.openSetUpstream(target.name, context.anchor)),
    }),
    command({
      id: "branch.unset_upstream",
      title: "Unset upstream",
      group: "Branches",
      covers: ["unset_upstream"],
      ...(snapshot?.head.kind === "branch" && snapshot.upstream === null ? { disabledReason: "The checked-out branch has no upstream" } : {}),
      run: () => void repo?.actions.unsetUpstream(),
    }),
    command({
      id: "branch.delete_remote",
      title: "Delete remote branch…",
      group: "Branches",
      covers: ["delete_remote"],
      args: [refArg("delete_remote", "Delete on the remote")],
      run: withTarget((target, actions) => actions.deleteRemoteBranch(target)),
    }),
    command({
      id: "branch.delete_both",
      title: "Delete branch and its remote branch…",
      group: "Branches",
      covers: ["delete_both"],
      args: [localBranchOption("delete_both", "Delete with its remote branch")],
      run: withTarget((target, actions) => void actions.deleteBranchAndRemote(target.name)),
    }),
    command({
      id: "branch.merge",
      title: "Merge into current branch…",
      group: "Branches",
      covers: ["merge"],
      args: [refArg("merge", "Merge")],
      run: withTarget((target, actions) => void actions.openMerge(target.name, context.anchor)),
    }),
    command({
      id: "branch.rebase",
      title: "Rebase onto…",
      group: "Branches",
      covers: ["rebase"],
      args: [refArg("rebase", "Rebase onto")],
      run: withTarget((target, actions) => void actions.startRebase(target.name)),
    }),
    command({
      id: "branch.fast_forward",
      title: "Fast-forward to…",
      group: "Branches",
      covers: ["fast_forward"],
      args: [refArg("fast_forward", "Fast-forward to")],
      run: withTarget((target, actions) => void actions.fastForward(current ?? "", target.name)),
    }),
    command({
      id: "branch.reset",
      title: "Reset current branch to ref…",
      group: "Branches",
      covers: ["reset", "soft", "mixed", "hard"],
      args: [refArg("reset", "Reset to"), { name: "mode", label: "Mode", options: resetModeOptions }],
      run: (values) => {
        const target = repo === undefined ? undefined : targetFor(repo.snapshot, values[0] ?? "");
        if (repo !== undefined && target !== undefined) void repo.actions.startReset(target.startPoint, target.name, (values[1] ?? "mixed") as ResetMode);
      },
    }),
    command({
      id: "commit.reset",
      title: "Reset current branch to commit…",
      group: "Commits",
      covers: ["reset"],
      args: [commitArg("reset", "Reset to"), { name: "mode", label: "Mode", options: resetModeOptions }],
      run: (values) => {
        const sha = values[0];
        if (repo !== undefined && sha !== undefined) void repo.actions.startReset(sha, shortSha(sha), (values[1] ?? "mixed") as ResetMode);
      },
    }),
    command({
      id: "commit.cherry_pick",
      title: "Cherry-pick commit…",
      group: "Commits",
      covers: ["cherry_pick"],
      args: [commitArg("cherry_pick", "Cherry-pick")],
      run: withCommit((sha, actions) => void actions.applyCommit(sha, "Cherry-pick")),
    }),
    command({
      id: "commit.revert",
      title: "Revert commit…",
      group: "Commits",
      covers: ["revert"],
      args: [commitArg("revert", "Revert")],
      run: withCommit((sha, actions) => void actions.applyCommit(sha, "Revert")),
    }),
    command({
      id: "history.rebase",
      title: "Edit history from commit…",
      group: "Commits",
      covers: ["edit_history"],
      args: [commitArg("edit_history", "Edit history from")],
      run: withCommit((sha, actions) => void actions.openRebaseEditor(sha)),
    }),
    command({
      id: "history.squash",
      title: "Squash selected commits…",
      group: "Commits",
      covers: ["squash"],
      disabledReason: operationBlock(operation) ?? (context.selection.length < 2 ? "Select at least two commits in the graph" : undefined),
      run: () => repo?.actions.openSquash(context.selection),
    }),
    command({
      id: "history.recompose",
      title: "Recompose unpushed commits…",
      group: "Commits",
      covers: ["recompose"],
      disabledReason: operationBlock(operation) ?? (snapshot?.head.kind === "unborn" ? "Make a first commit before rewriting history" : undefined),
      run: () => repo?.actions.openRecompose(undefined),
    }),
    command({
      id: "tag.create",
      title: "Create tag…",
      group: "Tags",
      covers: ["create_tag"],
      run: () => repo?.actions.openCreateTag(context.selectedSha ?? null, context.anchor),
    }),
    command({
      id: "tag.create_annotated",
      title: "Create annotated tag…",
      group: "Tags",
      args: [textArg("name", "Tag name"), textArg("message", "Annotation message")],
      run: (values) => context.createTag(values[0] ?? "", values[1] ?? ""),
    }),
    command({
      id: "tag.push",
      title: "Push tag…",
      group: "Tags",
      covers: ["push_tag"],
      args: [tagOption("push_tag", "Push tag")],
      run: withTarget((target, actions) => void actions.pushTag(target.name)),
    }),
    command({
      id: "tag.delete",
      title: "Delete tag…",
      group: "Tags",
      covers: ["delete_tag"],
      args: [tagOption("delete_tag", "Delete tag")],
      run: withTarget((target, actions) => actions.deleteLocalTag(target.name)),
    }),
    command({
      id: "tag.delete_remote",
      title: "Delete tag from remote…",
      group: "Tags",
      covers: ["delete_remote_tag"],
      args: [tagOption("delete_remote_tag", "Delete from remote")],
      run: withTarget((target, actions) => actions.deleteTagOnRemote(target.name)),
    }),
    command({ id: "sync.fetch", title: "Fetch all", group: "Sync", shortcut: SHORTCUTS.fetch, covers: ["fetch"], ...sync("fetch"), run: () => void repo?.actions.fetchAll() }),
    ...pullModes.map((entry) => modeCommand(entry.mode, entry.label)),
    command({
      id: "sync.pull",
      title: "Pull with the default mode",
      group: "Sync",
      shortcut: SHORTCUTS.pull,
      ...sync(`pull:${context.pullMode}`),
      run: () => void repo?.actions.pullDefault(),
    }),
    command({ id: "sync.push", title: "Push", group: "Sync", shortcut: SHORTCUTS.push, covers: ["push"], ...sync("push"), run: () => void repo?.actions.push() }),
    command({
      id: "sync.cancel",
      title: "Cancel running sync",
      group: "Sync",
      ...(busy === true ? {} : { disabledReason: "No sync is running" }),
      run: () => repo?.actions.cancelSync(),
    }),
    command({ id: "sync.fetch_prune", title: "Fetch all and prune", group: "Sync", covers: ["fetch_prune"], ...sync("fetch_prune"), run: () => void repo?.actions.fetchAll(true) }),
    command({ id: "sync.push_to", title: "Push to…", group: "Sync", covers: ["push_to"], ...sync("push_to"), run: () => repo?.actions.openPushTo(context.anchor) }),
    command({ id: "stash.push", title: "Stash changes…", group: "Stash", shortcut: SHORTCUTS.stash, run: () => repo?.actions.openStashForm(context.anchor) }),
    command({
      id: "stash.apply",
      title: "Apply stash…",
      group: "Stash",
      covers: ["apply"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => void actions.restoreStash("apply", stash)),
    }),
    command({
      id: "stash.pop",
      title: "Pop stash…",
      group: "Stash",
      covers: ["pop"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => void actions.restoreStash("pop", stash)),
    }),
    command({
      id: "stash.inspect",
      title: "Inspect stash…",
      group: "Stash",
      covers: ["inspect"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => actions.inspectStash(stash)),
    }),
    command({
      id: "stash.rename",
      title: "Rename stash…",
      group: "Stash",
      covers: ["rename_stash"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => actions.openRenameStash(stash, context.anchor)),
    }),
    command({
      id: "stash.drop",
      title: "Drop stash…",
      group: "Stash",
      covers: ["drop"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => actions.dropStash(stash)),
    }),
    command({
      id: "pulls.create",
      title: "Create pull request…",
      group: "Pull requests",
      ...(noPlatform === undefined ? {} : { disabledReason: noPlatform }),
      run: () => void platform?.openCreate(),
    }),
    command({
      id: "pulls.merge",
      title: "Merge pull request…",
      group: "Pull requests",
      args: [pullArg("Merge", openPulls)],
      ...(noPlatform === undefined && openPulls.length > 0 ? {} : { disabledReason: noPlatform ?? "This repository has no open pull requests" }),
      run: withPull(openPulls, (pull, actions) => actions.requestMerge(pull)),
    }),
    command({
      id: "pulls.open",
      title: "Open pull request in browser…",
      group: "Pull requests",
      args: [pullArg("Open", listedPulls)],
      ...(noPlatform === undefined && listedPulls.length > 0 ? {} : { disabledReason: noPlatform ?? "This repository has no listed pull requests" }),
      run: withPull(listedPulls, (pull, actions) => actions.openInBrowser(pull)),
    }),
    command({ id: "platforms.add", title: "Add platform connection…", group: "Application", run: () => app.addPlatformConnection() }),
    command({ id: "accounts.manage", title: "Manage accounts", group: "Settings", run: () => app.openSettings("platforms") }),
    command({ id: "settings.git_flow", title: "Configure Git Flow", group: "Settings", ...needsRepository, run: () => app.openSettings("repository") }),
    command({ id: "settings.lfs_configure", title: "Configure LFS", group: "Settings", ...needsRepository, run: () => app.openSettings("repository") }),
    command({ id: "settings.lfs_init", title: "Initialize LFS", group: "Settings", ...(repo === undefined ? needsRepository : lfsBlock), run: () => app.initializeLfs() }),
    command({ id: "settings.signing", title: "Configure commit signing", group: "Settings", run: () => app.openSettings("git") }),
    command({ id: "theme.light", title: "Join the light side", group: "Settings", ...themeNow("light"), run: () => app.setTheme("light") }),
    command({ id: "theme.dark", title: "Join the dark side", group: "Settings", ...themeNow("dark"), run: () => app.setTheme("dark") }),
    command({ id: "theme.toggle", title: "Toggle theme", group: "View", run: () => app.toggleTheme() }),
    command({
      id: "profile.switch",
      title: "Switch to profile…",
      group: "Settings",
      args: [{ name: "profile", label: "Profile", options: app.profileOptions }],
      ...(profiles !== undefined && profiles.profiles.length < 2 ? { disabledReason: ONE_PROFILE } : {}),
      run: (values) => app.switchProfile(values[0] ?? ""),
    }),
    command({ id: "zoom.in", title: "Zoom in", group: "View", shortcut: SHORTCUTS.zoomIn, ...zoom("in"), run: () => app.zoom("in") }),
    command({ id: "zoom.out", title: "Zoom out", group: "View", shortcut: SHORTCUTS.zoomOut, ...zoom("out"), run: () => app.zoom("out") }),
    command({ id: "zoom.reset", title: "Reset zoom", group: "View", shortcut: SHORTCUTS.zoomReset, ...zoom("reset"), run: () => app.zoom("reset") }),
    command({ id: "shortcuts.show", title: "Keyboard shortcuts", group: "View", run: () => app.openShortcuts() }),
    command({ id: "view.sidebar", title: "Toggle sidebar", group: "View", shortcut: SHORTCUTS.toggleSidebar, ...(repo === undefined ? { disabledReason: NO_REPOSITORY } : {}), run: () => app.toggleSidebar() }),
    command({ id: "view.inspector", title: "Toggle inspector", group: "View", shortcut: SHORTCUTS.toggleInspector, ...(repo === undefined ? { disabledReason: NO_REPOSITORY } : {}), run: () => app.toggleInspector() }),
    command({ id: "view.syntax", title: "Toggle syntax highlighting", group: "View", run: () => app.toggleSyntaxHighlighting() }),
    command({
      id: "history.file",
      title: "History of file…",
      group: "History",
      args: [fileArg],
      run: withFile((file) => context.openFileHistory(file, "diff")),
    }),
    command({
      id: "history.blame",
      title: "Blame of file…",
      group: "History",
      args: [fileArg],
      run: withFile((file) => context.openFileHistory(file, "blame")),
    }),
    command({ id: "file.create", title: "Create file…", group: "File", run: () => repo?.actions.createFile() }),
    command({ id: "file.delete", title: "Delete file…", group: "File", args: [fileArg], run: withFile((file, actions) => actions.deleteFile(file)) }),
    command({
      id: "file.open_editor",
      title: "Open file in editor…",
      group: "File",
      args: [fileArg],
      ...(noEditor === undefined ? {} : { disabledReason: noEditor }),
      run: withFile((file) => app.openFileInEditor(file)),
    }),
    command({ id: "file.view", title: "View file…", group: "File", args: [fileArg], run: withFile((file, actions) => actions.viewFile(file)) }),
    command({ id: "file.edit", title: "Edit file…", group: "File", args: [fileArg], run: withFile((file, actions) => actions.editFile(file)) }),
    command({
      id: "file.discard_all",
      title: "Discard all changes",
      group: "File",
      ...actionReason(repo?.actions.discardAllReason()),
      run: () => repo?.actions.discardAll(),
    }),
    command({
      id: "patch.create",
      title: "Create patch from working directory changes",
      group: "Patch",
      ...actionReason(repo?.actions.createPatchReason()),
      run: () => repo?.actions.createPatch(),
    }),
    command({ id: "patch.apply", title: "Apply patch…", group: "Patch", run: () => repo?.actions.applyPatch() }),
    command({ id: "logs.activity", title: "Activity log", group: "Logs", run: () => app.openDrawer() }),
    command({ id: "logs.errors", title: "Error log", group: "Logs", run: () => app.openLogs("errors") }),
    command({ id: "logs.performance", title: "Performance log", group: "Logs", run: () => app.openLogs("performance") }),
    command({ id: "logs.release_notes", title: "Release notes", group: "Logs", run: () => app.openReleaseNotes() }),
    command({ id: "operation.continue", title: "Continue operation", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => void repo?.actions.continueOperation(null) }),
    command({ id: "operation.skip", title: "Skip step", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => void repo?.actions.skipOperation() }),
    command({ id: "operation.abort", title: "Abort operation", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => repo?.actions.abortOperation() }),
    unavailable("create_worktree", "Create worktree…", "Branches"),
    unavailable("edit_message", "Edit commit message…", "Commits"),
    unavailable("copy", "Copy…", "Application"),
    unavailable("hide", "Hide in graph", "Application"),
  ];
}

export type NavigationMode = ">" | "@" | "#" | ":" | "/";

export const NAVIGATION_HINTS: ReadonlyArray<{ prefix: NavigationMode; label: string }> = [
  { prefix: ">", label: "actions" },
  { prefix: "@", label: "branches" },
  { prefix: "#", label: "commits" },
  { prefix: ":", label: "settings" },
  { prefix: "/", label: "repositories" },
];

export function navigationTargets(context: PaletteContext, choices: readonly CommitChoice[] = []): Array<PaletteCommand & { mode: NavigationMode }> {
  const { snapshot, app } = context;
  const branches = snapshot === undefined ? [] : [...snapshot.branches, ...snapshot.remote_branches];
  return [
    ...branches.map((name) => ({
      id: `go.branch.${name}`,
      title: `Go to ${name}`,
      group: "Navigate" as const,
      covers: [],
      args: [],
      mode: "@" as const,
      run: () => context.revealRef(name),
    })),
    ...choices.map((choice) => ({
      id: `go.commit.${choice.sha}`,
      title: choice.summary === "" ? "(no message)" : choice.summary,
      group: "Navigate" as const,
      covers: [],
      args: [],
      mode: "#" as const,
      note: shortSha(choice.sha),
      run: () => context.revealCommit(choice.sha),
    })),
    ...SETTINGS_SECTIONS.filter((section) => section.id !== "repository" || snapshot !== undefined).map((section) => ({
      id: `go.settings.${section.id}`,
      title: `Settings: ${section.label}`,
      group: "Navigate" as const,
      covers: [],
      args: [],
      mode: ":" as const,
      run: () => app.openSettings(section.id),
    })),
    ...app.repositories().map((path) => ({
      id: `go.repository.${path}`,
      title: app.aliasOf(path) ?? path,
      group: "Navigate" as const,
      covers: [],
      args: [],
      mode: "/" as const,
      ...(app.aliasOf(path) === undefined ? {} : { note: path }),
      run: () => app.openRepository(path),
    })),
  ];
}

export const REPOSITORY_SCOPE_CHIP = "Open repo";

export const REPOSITORY_SCOPE_PLACEHOLDER = "Search for a repository to open";

export type RepositoryChoice = { path: string; alias: string | undefined };

export function repositoryChoices(app: Pick<PaletteApp, "repositories" | "aliasOf">, managed: readonly string[]): RepositoryChoice[] {
  return [...new Set([...app.repositories(), ...managed])].map((path) => ({ path, alias: app.aliasOf(path) }));
}

export type Match = { score: number; positions: number[] };

export function fuzzyMatch(query: string, text: string): Match | undefined {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    if (char === " ") continue;
    const at = haystack.indexOf(char, from);
    if (at < 0) return undefined;
    const boundary = at === 0 || /[\s/_.:-]/.test(haystack[at - 1] ?? "");
    score += 10 + (at === previous + 1 ? 8 : 0) + (boundary ? 6 : 0) - Math.min(at, 20) * 0.1;
    positions.push(at);
    previous = at;
    from = at + 1;
  }
  return { score, positions };
}

export type Ranked<T> = { item: T; match: Match };

export function rank<T>(items: readonly T[], query: string, text: (item: T) => string, recent: readonly string[] = [], id: (item: T) => string = () => ""): Array<Ranked<T>> {
  return items
    .flatMap((item, index) => {
      const match = fuzzyMatch(query, text(item));
      if (match === undefined) return [];
      const recency = recent.indexOf(id(item));
      const bonus = query.trim() === "" && recency >= 0 ? 1000 - recency : 0;
      return [{ item, match, order: index, key: match.score + bonus }];
    })
    .sort((left, right) => right.key - left.key || left.order - right.order)
    .map(({ item, match }) => ({ item, match }));
}

export function parseQuery(query: string): { mode: NavigationMode | undefined; text: string } {
  const first = query.charAt(0);
  const mode = NAVIGATION_HINTS.find((hint) => hint.prefix === first)?.prefix;
  return mode === undefined ? { mode: undefined, text: query } : { mode, text: query.slice(1) };
}

const HOTKEY_PARTS: Record<string, string> = { "⌘": "Mod", "⇧": "Shift", "⌃": "Control", "⌥": "Alt", "↵": "Enter", "⇥": "Tab" };

export function hotkeyOf(shortcut: string): Hotkey {
  const key = [...shortcut].pop() ?? "";
  const modifiers = [...shortcut].slice(0, -1).map((symbol) => HOTKEY_PARTS[symbol] ?? symbol);
  return [...modifiers, HOTKEY_PARTS[key] ?? key.toUpperCase()].join("+") as Hotkey;
}

export function shortcutCommands(commands: readonly PaletteCommand[]): PaletteCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (command.shortcut === undefined || command.args.length > 0 || seen.has(command.shortcut)) return false;
    seen.add(command.shortcut);
    return true;
  });
}
