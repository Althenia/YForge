import type { Hotkey } from "@tanstack/solid-hotkeys";
import type { IconName } from "../iconNames";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import { NOTHING_TO_UNDO, type UndoState } from "./activityModel";
import { commitMenu, localTarget, NOT_AVAILABLE, refMenu, remoteTarget, resetModeMenu, tagTarget, type MenuContext, type MenuEntry, type RefTarget } from "./refMenu";
import type { Anchor, RepoActions } from "./repoActions";
import { pullModes, syncMenu } from "./syncModel";

export type PickerOption = { value: string; label: string; note?: string; disabledReason?: string };

export type ArgSpec = { name: string; label: string; options: () => PickerOption[] | Promise<PickerOption[]> };

export type PaletteGroup = "Repository" | "Branches" | "Commits" | "Tags" | "Sync" | "Stash" | "Operation" | "Navigate" | "Application";

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
  "settings.theme": "theme",
  "activity.toggle": "activity",
  "search.commits": "search",
  "open.editor": "edit",
  "open.terminal": "terminal",
  "open.finder": "folder",
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
};

export function commandIcon(id: string): IconName | undefined {
  if (id.startsWith("go.branch.")) return "local";
  if (id.startsWith("go.settings.")) return SETTINGS_SECTIONS.find((section) => id === `go.settings.${section.id}`)?.icon;
  if (id.startsWith("go.commit.")) return "commit";
  if (id.startsWith("go.repository.")) return "folder";
  return commandIcons[id];
}

export type CommitChoice = { sha: string; summary: string; merge: boolean };

export type SettingsSection = { id: string; label: string; icon: IconName };

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "git", label: "Git", icon: "branch" },
  { id: "appearance", label: "Appearance", icon: "theme" },
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
  toggleDrawer: () => void;
  openSearch: () => void;
  openExternal: (with_: "editor" | "terminal" | "finder") => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  openRepository: (path: string) => void;
  repositories: () => string[];
};

export type PaletteContext = {
  snapshot: RepoSnapshot | undefined;
  actions: RepoActions | undefined;
  selectedSha: string | undefined;
  pullMode: PullMode;
  undo: UndoState;
  anchor: Anchor;
  app: PaletteApp;
  revealCommit: (sha: string) => void;
  revealRef: (name: string) => void;
  focusComposer: () => void;
  loadCommits: () => Promise<CommitChoice[]>;
};

const NO_REPOSITORY = "Open a repository first";

const shortSha = (sha: string): string => sha.slice(0, 7);

const menuContextOf = (snapshot: RepoSnapshot): MenuContext => ({
  current: snapshot.head.kind === "branch" ? snapshot.head.name : undefined,
  remotes: snapshot.remotes,
  operation: snapshot.operation,
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
    const { reason } = reasonOf(commitMenu({ ...context, sha: choice.sha, merge: choice.merge }), menuId);
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
    disabledReason: spec.disabledReason ?? (spec.group === "Application" || spec.group === "Navigate" ? undefined : repo === undefined ? NO_REPOSITORY : undefined),
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
    const { reason } = reasonOf(syncMenu(snapshot, busy === true, context.pullMode), id);
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

  return [
    command({ id: "repository.open", title: "Open repository…", group: "Application", shortcut: "⌘O", run: () => app.openFolder() }),
    command({ id: "repository.clone", title: "Clone repository…", group: "Application", shortcut: "⌘⇧C", run: () => app.openClone() }),
    command({ id: "repository.create", title: "Create repository…", group: "Application", shortcut: "⌘N", run: () => app.openCreate() }),
    command({ id: "tab.new", title: "New tab", group: "Application", shortcut: "⌘T", run: () => app.openLauncher() }),
    command({ id: "tab.close", title: "Close tab", group: "Application", shortcut: "⌘W", run: () => app.closeTab() }),
    command({ id: "settings.open", title: "Open settings", group: "Application", shortcut: "⌘,", run: () => app.openSettings("general") }),
    command({
      id: "settings.theme",
      title: "Change theme…",
      group: "Application",
      args: [{ name: "theme", label: "Theme", options: () => [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }] }],
      run: (values) => app.setTheme((values[0] ?? "system") as "light" | "dark" | "system"),
    }),
    command({ id: "activity.toggle", title: "Toggle Activity drawer", group: "Application", shortcut: "⌘⇧Y", run: () => app.toggleDrawer() }),
    command({ id: "search.commits", title: "Search commits", group: "Commits", shortcut: "⌘F", run: () => app.openSearch() }),
    command({ id: "open.editor", title: "Open repository in editor", group: "Repository", run: () => app.openExternal("editor") }),
    command({ id: "open.terminal", title: "Open repository in terminal", group: "Repository", run: () => app.openExternal("terminal") }),
    command({ id: "open.finder", title: "Reveal repository in Finder", group: "Repository", run: () => app.openExternal("finder") }),
    command({
      id: "undo",
      title: "Undo last operation",
      group: "Repository",
      shortcut: "⌘Z",
      ...(context.undo.kind === "available" ? {} : { disabledReason: context.undo.reason === "" ? NOTHING_TO_UNDO : context.undo.reason }),
      run: () => {
        if (context.undo.kind === "available") void repo?.actions.undo(context.undo.entry.id);
      },
    }),
    command({ id: "changes.stage_all", title: "Stage all changes", group: "Repository", run: () => void repo?.actions.stageAll() }),
    command({ id: "changes.unstage_all", title: "Unstage all changes", group: "Repository", run: () => void repo?.actions.unstageAll() }),
    command({ id: "commit", title: "Commit staged changes…", group: "Repository", shortcut: "⌘↵", run: () => context.focusComposer() }),
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
      shortcut: "⌘B",
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
      id: "tag.create",
      title: "Create tag…",
      group: "Tags",
      covers: ["create_tag"],
      run: () => repo?.actions.openCreateTag(context.selectedSha ?? null, context.anchor),
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
    command({ id: "sync.fetch", title: "Fetch all", group: "Sync", shortcut: "⌘⇧F", covers: ["fetch"], ...sync("fetch"), run: () => void repo?.actions.fetchAll() }),
    ...pullModes.map((entry) => modeCommand(entry.mode, entry.label)),
    command({
      id: "sync.pull",
      title: "Pull with the default mode",
      group: "Sync",
      shortcut: "⌘⇧L",
      ...sync(`pull:${context.pullMode}`),
      run: () => void repo?.actions.pullDefault(),
    }),
    command({ id: "sync.push", title: "Push", group: "Sync", shortcut: "⌘⇧P", covers: ["push"], ...sync("push"), run: () => void repo?.actions.push() }),
    command({
      id: "sync.cancel",
      title: "Cancel running sync",
      group: "Sync",
      ...(busy === true ? {} : { disabledReason: "No sync is running" }),
      run: () => repo?.actions.cancelSync(),
    }),
    unavailable("push_to", "Push to…", "Sync"),
    unavailable("set_upstream", "Set upstream…", "Sync"),
    command({ id: "stash.push", title: "Stash changes…", group: "Stash", shortcut: "⌘⇧S", run: () => repo?.actions.openStashForm(context.anchor) }),
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
      id: "stash.drop",
      title: "Drop stash…",
      group: "Stash",
      covers: ["drop"],
      args: [stashArg],
      ...(noStashes === undefined ? {} : { disabledReason: noStashes }),
      run: withStash((stash, actions) => actions.dropStash(stash)),
    }),
    command({ id: "operation.continue", title: "Continue operation", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => void repo?.actions.continueOperation(null) }),
    command({ id: "operation.skip", title: "Skip step", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => void repo?.actions.skipOperation() }),
    command({ id: "operation.abort", title: "Abort operation", group: "Operation", ...(noOperation === undefined ? {} : { disabledReason: noOperation }), run: () => repo?.actions.abortOperation() }),
    unavailable("create_worktree", "Create worktree…", "Branches"),
    unavailable("edit_message", "Edit commit message…", "Commits"),
    unavailable("delete_remote", "Delete remote branch…", "Branches"),
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
      title: path,
      group: "Navigate" as const,
      covers: [],
      args: [],
      mode: "/" as const,
      run: () => app.openRepository(path),
    })),
  ];
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

const RECENT_KEY = "yforge.palette.recent";
const RECENT_LIMIT = 8;

export function loadRecentCommands(): string[] {
  const stored = window.localStorage.getItem(RECENT_KEY);
  return stored === null ? [] : (JSON.parse(stored) as string[]);
}

export function rememberCommand(id: string): string[] {
  const next = [id, ...loadRecentCommands().filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

const HOTKEY_PARTS: Record<string, string> = { "⌘": "Mod", "⇧": "Shift", "↵": "Enter" };

export function hotkeyOf(shortcut: string): Hotkey {
  const key = [...shortcut].pop() ?? "";
  const modifiers = [...shortcut].slice(0, -1).map((symbol) => HOTKEY_PARTS[symbol] ?? symbol);
  return [...modifiers, HOTKEY_PARTS[key] ?? key.toUpperCase()].join("+") as Hotkey;
}

export function shortcutCommands(commands: readonly PaletteCommand[]): PaletteCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (command.shortcut === undefined || command.id === "commit" || command.args.length > 0 || seen.has(command.shortcut)) return false;
    seen.add(command.shortcut);
    return true;
  });
}
