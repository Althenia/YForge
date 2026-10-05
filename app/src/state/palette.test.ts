import { describe, expect, it, vi } from "vitest";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { NOTHING_TO_REDO, NOTHING_TO_UNDO } from "./activityModel";
import {
  buildCommands,
  commandIcon,
  hotkeyOf,
  shortcutCommands,
  fuzzyMatch,
  navigationTargets,
  parseQuery,
  rank,
  refOptions,
  repositoryChoices,
  type PaletteApp,
  type PaletteContext,
} from "./palette";
import { commitMenu, dropPlan, localTarget, refMenu, remoteTarget, resetModeMenu, stashMenu, tagTarget, type MenuEntry, type RefTarget } from "./refMenu";
import type { RepoActions } from "./repoActions";
import type { PlatformActions } from "./platformActions";
import { SHORTCUTS } from "./shortcuts";
import { syncMenu } from "./syncModel";

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "feature", sha: "a" },
    upstream: { name: "origin/feature", ahead_behind: { ahead: 1, behind: 0 } },
    counts,
    files: [],
    operation: null,
    operation_detail: null,
    last_fetch: null,
    branches: ["main", "feature"],
    remote_branches: ["origin/main", "origin/remote-only"],
    remotes: ["origin"],
    tags: ["v1"],
    stashes: [{ index: 0, sha: "s0", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "WIP", time: 0 }],
    worktrees: [],
    ...overrides,
  }) as RepoSnapshot;

const app = (): PaletteApp => ({
  openLauncher: vi.fn(),
  openFolder: vi.fn(),
  openClone: vi.fn(),
  openCreate: vi.fn(),
  closeTab: vi.fn(),
  openSettings: vi.fn(),
  openLaunchpad: vi.fn(),
  addPlatformConnection: vi.fn(),
  toggleDrawer: vi.fn(),
  openSearch: vi.fn(),
  openExternal: vi.fn(),
  setTheme: vi.fn(),
  openRepository: vi.fn(),
  repositories: () => ["/r", "/other"],
  aliasOf: () => undefined,
  canReopenClosedTab: () => false,
  reopenClosedTab: vi.fn(),
  nextTab: vi.fn(),
  previousTab: vi.fn(),
  checkForUpdate: vi.fn(),
  openRepositorySearch: vi.fn(),
  openShortcuts: vi.fn(),
  openLogs: vi.fn(),
  openDrawer: vi.fn(),
  openReleaseNotes: vi.fn(),
  zoom: vi.fn(),
  toggleSidebar: vi.fn(),
  toggleInspector: vi.fn(),
  toggleSyntaxHighlighting: vi.fn(),
  toggleTheme: vi.fn(),
  switchProfile: vi.fn(),
  profileList: () => ({ active: "default", profiles: [{ id: "default", name: "Default", author_name: "Yui", author_email: "yui@example.test" }, { id: "work", name: "Work", author_name: "Yui Lin", author_email: "yui@work.test" }] }),
  profileOptions: async () => [{ value: "default", label: "Default", disabledReason: "This is the active profile" }, { value: "work", label: "Work" }],
  openFileInTool: vi.fn(),
  openFileInEditor: vi.fn(),
  initializeLfs: vi.fn(),
});

const fakeActions = () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const names = ["checkoutRef", "openMerge", "startRebase", "fastForward", "startReset", "openCreateBranchAt", "openCreateTag", "pushTag", "deleteBranch", "openRenameBranch", "deleteLocalTag", "deleteTagOnRemote", "dropStash", "restoreStash", "applyCommit", "fetchAll", "pull", "pullDefault", "push", "undo", "openStashForm", "continueOperation", "skipOperation", "abortOperation", "cancelSync", "stageAll", "unstageAll", "openSetUpstream", "unsetUpstream", "deleteRemoteBranch", "deleteBranchAndRemote", "openPushTo", "openRenameStash", "inspectStash", "openSquash", "openRecompose", "openRebaseEditor", "maintain", "createFile", "deleteFile", "viewFile", "editFile", "discardAll", "createPatch", "applyPatch"];
  const reasons = { discardAllReason: () => undefined as string | undefined, createPatchReason: () => undefined as string | undefined, maintainReason: () => undefined as string | undefined };
  const actions = { sync: () => ({ kind: "idle" as const }), ...reasons, ...Object.fromEntries(names.map((name) => [name, record(name)])) };
  return { actions: actions as unknown as RepoActions, calls };
};

function context(overrides: Partial<PaletteContext> = {}, repo: RepoSnapshot | null = snapshot()): PaletteContext & { calls: Array<[string, ...unknown[]]> } {
  const { actions, calls } = fakeActions();
  return {
    snapshot: repo ?? undefined,
    actions: repo === null ? undefined : actions,
    selectedSha: undefined,
    selection: [],
    pullMode: "fast_forward_or_merge",
    offline: false,
    undo: { kind: "unavailable", reason: NOTHING_TO_UNDO },
    redo: { kind: "unavailable", reason: NOTHING_TO_REDO },
    zoomPercent: 100,
    theme: "system",
    externalTools: { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" },
    lfs: undefined,
    anchor: { left: 10, top: 20 },
    app: app(),
    platform: undefined,
    revealCommit: vi.fn(),
    revealRef: vi.fn(),
    focusComposer: vi.fn(),
    revealHead: vi.fn(),
    openPanel: vi.fn(),
    trackedFiles: async () => ["README.md", "src/main.rs"],
    openFileHistory: vi.fn(),
    viewChanges: vi.fn(),
    redoLast: vi.fn(),
    createTag: vi.fn(),
    loadCommits: async () => [
      { sha: "abcdef1234567", summary: "Add greeting", merge: false, root: false },
      { sha: "1234567abcdef", summary: "Merge topic", merge: true, root: false },
      { sha: "0000000abcdef", summary: "Initial commit", merge: false, root: true },
    ],
    ...overrides,
    calls,
  };
}

const find = (commands: ReturnType<typeof buildCommands>, id: string) => {
  const found = commands.find((command) => command.id === id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
};

const itemIds = (entries: MenuEntry[]): string[] => entries.flatMap((entry) => (entry.kind === "item" ? [entry.id] : []));

function everyMenuActionId(): Set<string> {
  const ids = new Set<string>();
  const add = (entries: MenuEntry[]) => itemIds(entries).forEach((id) => ids.add(id));
  const base = snapshot();
  const contexts = [
    { current: "feature", remotes: ["origin"], operation: null },
    { current: undefined, remotes: [], operation: null },
    { current: "main", remotes: ["origin", "backup"], operation: "rebase" as const },
  ];
  const targets: RefTarget[] = [localTarget(base, "main"), localTarget(base, "feature"), remoteTarget("origin/main"), tagTarget("v1")];
  for (const menu of contexts) {
    for (const target of targets) add(refMenu(target, menu));
    add(commitMenu({ ...menu, sha: "abcdef1", merge: false }));
    add(commitMenu({ ...menu, sha: "abcdef1", merge: true }));
  }
  add(stashMenu({ index: 0 }));
  add(resetModeMenu());
  for (const shape of [snapshot(), snapshot({ upstream: null }), snapshot({ remotes: [] }), snapshot({ head: { kind: "detached", sha: "a" } }), snapshot({ operation: "merge" })]) {
    add(syncMenu(shape, false));
    add(syncMenu(shape, true));
  }
  const preview: IntegrationPreview = { incoming: { count: 2, commits: [] }, outgoing: { count: 0, commits: [] }, fast_forward: true };
  const dropped = dropPlan(localTarget(base, "main"), localTarget(base, "feature"), { current: "feature", remotes: ["origin"], operation: null }, preview);
  if (dropped !== undefined) add(dropped.entries);
  return ids;
}

describe("command palette registry", () => {
  it("registers every menu action id as a palette command (parity)", () => {
    const covered = new Set(buildCommands(context()).flatMap((command) => command.covers));
    const ids = everyMenuActionId();

    expect(ids.size).toBeGreaterThan(25);
    expect([...ids].filter((id) => !covered.has(id))).toEqual([]);
  });

  it("gives every command a unique id and a shortcut hint where the command has one", () => {
    const commands = buildCommands(context());
    expect(new Set(commands.map((command) => command.id)).size).toBe(commands.length);
    expect(find(commands, "branch.create").shortcut).toBe("⌘B");
    expect(find(commands, "search.commits").shortcut).toBe("⌘F");
    expect(find(commands, "undo").shortcut).toBe("⌘Z");
  });

  it("disables repository commands with a reason when no repository is open, keeping application commands usable", () => {
    const commands = buildCommands(context({}, null));
    expect(find(commands, "branch.create").disabledReason).toBe("Open a repository first");
    expect(find(commands, "sync.fetch").disabledReason).toBe("Open a repository first");
    expect(find(commands, "repository.clone").disabledReason).toBeUndefined();
    expect(find(commands, "settings.open").disabledReason).toBeUndefined();
  });

  it("shows why a command is disabled: unborn HEAD, no stashes, no operation, no remote, nothing to undo", () => {
    const unborn = buildCommands(context({}, snapshot({ head: { kind: "unborn", branch: "main" }, stashes: [], remotes: [], upstream: null })));
    expect(find(unborn, "branch.create").disabledReason).toBe("Make a first commit before creating branches");
    expect(find(unborn, "stash.pop").disabledReason).toBe("This repository has no stashes");
    expect(find(unborn, "operation.continue").disabledReason).toBe("No operation is in progress");
    expect(find(unborn, "sync.fetch").disabledReason).toBe("This repository has no remotes");
    expect(find(unborn, "undo").disabledReason).toBe(NOTHING_TO_UNDO);
    expect(find(unborn, "unavailable.create_worktree").disabledReason).toBe("Not available yet");
    const busy = buildCommands(context({}, snapshot({ operation: "merge" })));
    expect(find(busy, "operation.abort").disabledReason).toBeUndefined();
    expect(find(busy, "sync.push").disabledReason).toBe("Finish the operation in progress first");
  });

  it("enables Undo with the operation it will undo when one is available", () => {
    const run = context({ undo: { kind: "available", scope: "Undo commit", entry: { id: 9 } as never } });
    const undo = find(buildCommands(run), "undo");
    expect(undo.disabledReason).toBeUndefined();
    undo.run([]);
    expect(run.calls).toEqual([["undo", 9]]);
  });

  it("picks a ref argument for Rebase onto… with per-ref reasons, then rebases onto the chosen ref", async () => {
    const run = context();
    const rebase = find(buildCommands(run), "branch.rebase");

    const options = await rebase.args[0]?.options();

    expect(options?.map((option) => option.label)).toEqual(["main", "feature", "origin/main", "origin/remote-only"]);
    expect(options?.find((option) => option.label === "feature")?.disabledReason).toBe("Already the checked-out branch");
    expect(options?.find((option) => option.label === "main")?.disabledReason).toBeUndefined();
    rebase.run(["local_branch:main"]);
    expect(run.calls).toEqual([["startRebase", "main"]]);
  });

  it("offers commits for cherry-pick with the merge-commit reason and runs the chosen one", async () => {
    const run = context();
    const pick = find(buildCommands(run), "commit.cherry_pick");

    const options = await pick.args[0]?.options();

    expect(options?.[0]).toMatchObject({ value: "abcdef1234567", label: "Add greeting", note: "abcdef1" });
    expect(options?.[1]?.disabledReason).toContain("parent choice");
    pick.run(["abcdef1234567"]);
    expect(run.calls).toEqual([["applyCommit", "abcdef1234567", "Cherry-pick"]]);
  });

  it("resets to a ref in the chosen mode and to a commit with the commit's short label", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "branch.reset").run(["tag:v1", "hard"]);
    find(commands, "commit.reset").run(["abcdef1234567", "soft"]);
    expect(run.calls).toEqual([
      ["startReset", "refs/tags/v1", "v1", "hard"],
      ["startReset", "abcdef1234567", "abcdef1", "soft"],
    ]);
    expect(find(commands, "branch.reset").args[1]?.options()).toHaveLength(3);
  });

  it("runs the remote branch, upstream, Push to…, prune, stash rename, and stash inspect commands through their actions", async () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "branch.delete_remote").run(["remote_branch:origin/main"]);
    find(commands, "branch.delete_both").run(["local_branch:main"]);
    find(commands, "branch.set_upstream").run(["local_branch:main"]);
    find(commands, "branch.unset_upstream").run([]);
    find(commands, "sync.push_to").run([]);
    find(commands, "sync.fetch_prune").run([]);
    find(commands, "stash.rename").run(["0"]);
    find(commands, "stash.inspect").run(["0"]);
    expect(run.calls.map((call) => call[0])).toEqual([
      "deleteRemoteBranch",
      "deleteBranchAndRemote",
      "openSetUpstream",
      "unsetUpstream",
      "openPushTo",
      "fetchAll",
      "openRenameStash",
      "inspectStash",
    ]);
    expect(run.calls.find((call) => call[0] === "fetchAll")?.[1]).toBe(true);
    expect(run.calls.find((call) => call[0] === "openSetUpstream")?.slice(1)).toEqual(["main", { left: 10, top: 20 }]);
    const options = await find(commands, "branch.delete_remote").args[0]?.options();
    expect(options?.map((option) => option.label)).toEqual(["main", "origin/main", "origin/remote-only"]);
  });

  it("unsets an upstream only when the checked-out branch has one, and reveals HEAD with its shortcut", () => {
    const untracked = buildCommands(context({}, snapshot({ upstream: null })));
    expect(find(untracked, "branch.unset_upstream").disabledReason).toBe("The checked-out branch has no upstream");
    expect(find(buildCommands(context()), "branch.unset_upstream").disabledReason).toBeUndefined();
    const run = context();
    const reveal = find(buildCommands(run), "head.reveal");
    expect(reveal.shortcut).toBe("⌘⇧H");
    reveal.run([]);
    expect(run.revealHead).toHaveBeenCalledOnce();
  });

  it("uses the same shortcut in the menus as in the palette for fetch, the default pull, push, and Create branch", () => {
    const commands = buildCommands(context());
    const menuShortcut = (id: string) => {
      const entry = syncMenu(snapshot(), false).find((candidate) => candidate.kind === "item" && candidate.id === id);
      return entry?.kind === "item" ? entry.shortcut : undefined;
    };
    expect(menuShortcut("fetch")).toBe(find(commands, "sync.fetch").shortcut);
    expect(menuShortcut("pull:fast_forward_or_merge")).toBe(find(commands, "sync.pull").shortcut);
    expect(menuShortcut("push")).toBe(find(commands, "sync.push").shortcut);
    const create = commitMenu({ current: "feature", remotes: [], operation: null, sha: "abcdef1", merge: false }).find((entry) => entry.kind === "item" && entry.id === "create_branch");
    expect(create?.kind === "item" && create.shortcut).toBe(find(commands, "branch.create").shortcut);
  });

  it("creates a branch at the selected commit and opens the flow at the palette anchor", () => {
    const run = context({ selectedSha: "abc1234" });
    find(buildCommands(run), "branch.create").run([]);
    expect(run.calls).toEqual([["openCreateBranchAt", "abc1234", { left: 10, top: 20 }]]);
  });

  it("runs sync commands with the default pull mode and per-mode pulls", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "sync.pull").run([]);
    find(commands, "sync.pull.rebase").run([]);
    find(commands, "sync.fetch").run([]);
    expect(run.calls.map((call) => call[0])).toEqual(["pullDefault", "pull", "fetchAll"]);
    expect(run.calls[1]).toEqual(["pull", "rebase"]);
  });

  it("applies, pops, and drops the chosen stash", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "stash.apply").run(["0"]);
    find(commands, "stash.pop").run(["0"]);
    find(commands, "stash.drop").run(["0"]);
    expect(run.calls.map((call) => call[0])).toEqual(["restoreStash", "restoreStash", "dropStash"]);
    expect(run.calls[0]?.[1]).toBe("apply");
    expect(run.calls[1]?.[1]).toBe("pop");
  });

  it("opens application flows through the app hooks", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "repository.clone").run([]);
    find(commands, "tab.new").run([]);
    find(commands, "settings.theme").run(["light"]);
    find(commands, "open.editor").run([]);
    expect(run.app.openClone).toHaveBeenCalled();
    expect(run.app.openLauncher).toHaveBeenCalled();
    expect(run.app.setTheme).toHaveBeenCalledWith("light");
    expect(run.app.openExternal).toHaveBeenCalledWith("editor");
  });

  it("offers every named palette and System in the theme command", () => {
    const command = find(buildCommands(context()), "settings.theme");
    expect(command.args?.[0]?.options()).toEqual([
      { value: "system", label: "System" }, { value: "dark", label: "YForge Dark" }, { value: "light", label: "YForge Light" },
      { value: "classic", label: "Classic Dark" }, { value: "ocean", label: "Ocean" }, { value: "eighties", label: "Eighties" },
      { value: "gruvbox", label: "Gruvbox" }, { value: "nord", label: "Nord" }, { value: "dracula", label: "Dracula" },
      { value: "monokai", label: "Monokai" }, { value: "woodland", label: "Woodland" },
    ]);
  });

  it("lists navigation targets for branches, commits, settings, and repositories", () => {
    const run = context();
    const targets = navigationTargets(run, [{ sha: "abcdef1234567", summary: "Add greeting", merge: false, root: false }]);
    expect(targets.filter((target) => target.mode === "@").map((target) => target.title)).toEqual(["Go to main", "Go to feature", "Go to origin/main", "Go to origin/remote-only"]);
    expect(targets.filter((target) => target.mode === "#")[0]).toMatchObject({ title: "Add greeting", note: "abcdef1" });
    expect(targets.filter((target) => target.mode === ":").map((target) => target.title)).toContain("Settings: This repository");
    expect(targets.filter((target) => target.mode === "/").map((target) => target.title)).toEqual(["/r", "/other"]);
    targets.find((target) => target.mode === "@")?.run([]);
    targets.find((target) => target.mode === ":")?.run([]);
    targets.find((target) => target.mode === "/")?.run([]);
    expect(run.revealRef).toHaveBeenCalledWith("main");
    expect(run.app.openSettings).toHaveBeenCalledWith("general");
    expect(run.app.openRepository).toHaveBeenCalledWith("/r");
    expect(navigationTargets(context({}, null)).some((target) => target.id === "go.settings.repository")).toBe(false);
  });

  it("exposes only refs that the menu offers for the action", () => {
    const options = refOptions(snapshot(), "delete_tag");
    expect(options.map((option) => option.label)).toEqual(["v1"]);
    expect(refOptions(snapshot(), "checkout")).toHaveLength(5);
  });
});

describe("fuzzy search and modes", () => {
  it("matches subsequences case-insensitively and returns highlight positions", () => {
    expect(fuzzyMatch("rbo", "Rebase onto…")?.positions).toEqual([0, 2, 7]);
    expect(fuzzyMatch("xyz", "Rebase onto…")).toBeUndefined();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("ranks contiguous and word-start matches first and keeps ties in registry order", () => {
    const items = ["Push tag…", "Pull with the default mode", "Push"];
    expect(rank(items, "push", (item) => item).map((entry) => entry.item)).toEqual(["Push tag…", "Push"]);
    expect(rank(items, "pl", (item) => item).map((entry) => entry.item)[0]).toBe("Pull with the default mode");
  });

  it("puts recent commands first for an empty query only", () => {
    const items = ["a", "b", "c"];
    const recent = ["c", "b"];
    expect(rank(items, "", (item) => item, recent, (item) => item).map((entry) => entry.item)).toEqual(["c", "b", "a"]);
    expect(rank(items, "a", (item) => item, recent, (item) => item).map((entry) => entry.item)).toEqual(["a"]);
  });

  it("parses prefix modes", () => {
    expect(parseQuery(">fetch")).toEqual({ mode: ">", text: "fetch" });
    expect(parseQuery("@ma")).toEqual({ mode: "@", text: "ma" });
    expect(parseQuery("#fix")).toEqual({ mode: "#", text: "fix" });
    expect(parseQuery(":app")).toEqual({ mode: ":", text: "app" });
    expect(parseQuery("/sam")).toEqual({ mode: "/", text: "sam" });
    expect(parseQuery("plain")).toEqual({ mode: undefined, text: "plain" });
  });
});

describe("worktree and recovery commands", () => {
  it("opens the Worktrees panel, the create dialog, and each Recovery tab through the open repository", () => {
    const openPanel = vi.fn();
    const commands = buildCommands(context({ openPanel }));

    for (const [id, panel] of [
      ["worktrees.show", "worktrees"],
      ["worktrees.create", "create_worktree"],
      ["recovery.reflog", "reflog"],
      ["recovery.lost", "lost"],
      ["recovery.snapshots", "snapshots"],
    ] as const) {
      find(commands, id).run([]);
      expect(openPanel).toHaveBeenLastCalledWith(panel);
    }
    expect(find(commands, "worktrees.create").title).toBe("Create worktree…");
    expect(find(commands, "recovery.lost").title).toBe("Recovery: find lost commits");
  });

  it("disables them without a repository, with the reason, and gives each an icon", () => {
    const commands = buildCommands(context({}, null));

    for (const id of ["worktrees.show", "worktrees.create", "recovery.reflog", "recovery.lost", "recovery.snapshots"]) {
      expect(find(commands, id).disabledReason).toBe("Open a repository first");
      expect(commandIcon(id)).toBeDefined();
    }
  });
});

describe("keyboard shortcuts", () => {
  it("turns the chord the palette shows into a hotkey", () => {
    expect(hotkeyOf("⌘K")).toBe("Mod+K");
    expect(hotkeyOf("⌘⇧F")).toBe("Mod+Shift+F");
    expect(hotkeyOf("⌘,")).toBe("Mod+,");
    expect(hotkeyOf("⌘↵")).toBe("Mod+Enter");
  });

  it("binds each shown chord once, including ⌘↵ to go to the commit message, and skipping commands that need arguments", () => {
    const commands = shortcutCommands(buildCommands(context()));
    const shortcuts = commands.map((command) => command.shortcut);
    expect(commands.find((command) => command.shortcut === "⌘B")?.id).toBe("branch.create");
    expect(commands.find((command) => command.shortcut === "⌘⇧F")?.id).toBe("sync.fetch");
    expect(commands.find((command) => command.shortcut === "⌘↵")?.id).toBe("commit");
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(commands.every((command) => command.args.length === 0)).toBe(true);
  });
});

describe("history editing commands", () => {
  it("offers Edit history from a commit, disabling a merge commit and the root commit with their reasons", async () => {
    const commands = buildCommands(context());
    const edit = find(commands, "history.rebase");
    expect(edit.covers).toEqual(["edit_history"]);
    const options = await edit.args[0]?.options();
    expect(options?.map((option) => [option.note, option.disabledReason])).toEqual([
      ["abcdef1", undefined],
      ["1234567", "A merge commit cannot be rewritten"],
      ["0000000", "The root commit has no parent to rebase onto"],
    ]);
  });

  it("runs Edit history from the chosen commit", () => {
    const ctx = context();
    find(buildCommands(ctx), "history.rebase").run(["abcdef1234567"]);
    expect(ctx.calls).toEqual([["openRebaseEditor", "abcdef1234567"]]);
  });

  it("squashes the selected commits and says to select at least two when fewer are selected", () => {
    const none = find(buildCommands(context()), "history.squash");
    expect(none.disabledReason).toBe("Select at least two commits in the graph");
    expect(none.covers).toEqual(["squash"]);
    const ctx = context({ selection: ["a1", "b2"] });
    const squash = find(buildCommands(ctx), "history.squash");
    expect(squash.disabledReason).toBeUndefined();
    squash.run([]);
    expect(ctx.calls).toEqual([["openSquash", ["a1", "b2"]]]);
  });

  it("recomposes the unpushed commits from the upstream and is blocked during an operation", () => {
    const ctx = context();
    const recompose = find(buildCommands(ctx), "history.recompose");
    expect(recompose.title).toBe("Recompose unpushed commits…");
    expect(recompose.disabledReason).toBeUndefined();
    recompose.run([]);
    expect(ctx.calls).toEqual([["openRecompose", undefined]]);
    expect(find(buildCommands(context({}, snapshot({ operation: "rebase" }))), "history.recompose").disabledReason).toBe("Finish or abort the rebase first");
    expect(find(buildCommands(context({}, snapshot({ head: { kind: "unborn", branch: "main" } }))), "history.recompose").disabledReason).toBe("Make a first commit before rewriting history");
  });
});

describe("platform commands", () => {
  const open = { number: 7, title: "Add retry", state: "open", source_ref: "feature/retry", target_ref: "main", web_url: "https://x/7" };
  const merged = { number: 3, title: "Old", state: "merged", source_ref: "old", target_ref: "main", web_url: "https://x/3" };
  const fakePlatform = (matched: boolean, pulls: unknown[]) => {
    const calls: Array<[string, ...unknown[]]> = [];
    const platform = {
      matched: () => (matched ? { remote: "origin" } : undefined),
      pulls: () => pulls,
      openCreate: () => calls.push(["create"]),
      requestMerge: (pull: { number: number }) => calls.push(["merge", pull.number]),
      openInBrowser: (pull: { number: number }) => calls.push(["browser", pull.number]),
    } as unknown as PlatformActions;
    return { platform, calls };
  };

  it("disables the pull request commands with a reason when no connection matches, but keeps Add platform connection available", () => {
    const commands = buildCommands(context({ platform: fakePlatform(false, []).platform }));

    for (const id of ["pulls.create", "pulls.merge", "pulls.open"]) expect(find(commands, id).disabledReason).toBe("No platform connection matches this repository's remotes");
    const add = find(commands, "platforms.add");
    expect(add.disabledReason).toBeUndefined();
    expect(add.group).toBe("Application");
  });

  it("creates, merges only open pull requests, and opens any listed pull request in the browser", async () => {
    const { platform, calls } = fakePlatform(true, [open, merged]);
    const commands = buildCommands(context({ platform }));

    find(commands, "pulls.create").run([]);
    expect(await find(commands, "pulls.merge").args[0]?.options()).toEqual([{ value: "7", label: "#7 Add retry", note: "feature/retry → main" }]);
    expect((await find(commands, "pulls.open").args[0]?.options())?.map((option) => option.value)).toEqual(["7", "3"]);
    find(commands, "pulls.merge").run(["7"]);
    find(commands, "pulls.merge").run(["3"]);
    find(commands, "pulls.open").run(["3"]);

    expect(calls).toEqual([["create"], ["merge", 7], ["browser", 3]]);
  });

  it("disables Merge when nothing is open, and opens Settings → Platforms for Add platform connection", () => {
    const ctx = context({ platform: fakePlatform(true, [merged]).platform });
    const commands = buildCommands(ctx);

    expect(find(commands, "pulls.merge").disabledReason).toBe("This repository has no open pull requests");
    expect(find(commands, "pulls.open").disabledReason).toBeUndefined();
    find(commands, "platforms.add").run([]);
    expect(ctx.app.addPlatformConnection).toHaveBeenCalledTimes(1);
  });

  it("opens the Launchpad with the launchpad glyph and lists Jira among the settings sections", () => {
    const ctx = context();
    const commands = buildCommands(ctx);

    find(commands, "launchpad.open").run([]);

    expect(ctx.app.openLaunchpad).toHaveBeenCalledTimes(1);
    expect(find(commands, "launchpad.open").title).toBe("Open Launchpad");
    expect(commandIcon("launchpad.open")).toBe("launchpad");
    expect(navigationTargets(context()).some((target) => target.title === "Settings: Jira")).toBe(true);
    expect(commandIcon("go.settings.jira")).toBe("issue");
  });

  it("lists Git hosts among the settings sections with the identity glyph", () => {
    expect(navigationTargets(context()).some((target) => target.id === "go.settings.git-hosts" && target.title === "Settings: Git hosts")).toBe(true);
    expect(commandIcon("go.settings.git-hosts")).toBe("identity");
  });

  it("lists Platforms among the settings sections a user can jump to", () => {
    expect(navigationTargets(context()).some((target) => target.id === "go.settings.platforms" && target.title === "Settings: Platforms")).toBe(true);
    expect(commandIcon("pulls.create")).toBe("pullrequest");
    expect(commandIcon("go.settings.platforms")).toBe("plug");
  });
});

describe("tab and menu-bar commands", () => {
  it("reopens the last closed tab with ⌘⇧T, and says why it cannot while none was closed", () => {
    expect(find(buildCommands(context()), "tab.reopen")).toMatchObject({ title: "Reopen closed tab", shortcut: SHORTCUTS.reopenClosedTab, disabledReason: "No closed tabs" });
    const reopen = vi.fn();

    const command = find(buildCommands(context({ app: { ...app(), canReopenClosedTab: () => true, reopenClosedTab: reopen } })), "tab.reopen");
    command.run([]);

    expect(command.disabledReason).toBeUndefined();
    expect(reopen).toHaveBeenCalledOnce();
  });

  it("shows the next and previous tab with ⌃⇥ and ⌃⇧⇥", () => {
    const next = vi.fn();
    const previous = vi.fn();
    const commands = buildCommands(context({ app: { ...app(), nextTab: next, previousTab: previous } }));

    find(commands, "tab.next").run([]);
    find(commands, "tab.previous").run([]);

    expect([find(commands, "tab.next").shortcut, find(commands, "tab.previous").shortcut]).toEqual([SHORTCUTS.nextTab, SHORTCUTS.previousTab]);
    expect([next, previous].map((spy) => spy.mock.calls.length)).toEqual([1, 1]);
  });

  it("checks for an update", () => {
    const check = vi.fn();

    find(buildCommands(context({ app: { ...app(), checkForUpdate: check } })), "update.check").run([]);

    expect(check).toHaveBeenCalledOnce();
    expect(find(buildCommands(context()), "update.check").title).toBe("Check for update…");
  });

  it("lists a repository by its alias with the folder path as the note, and by its path otherwise", () => {
    const targets = navigationTargets(context({ app: { ...app(), aliasOf: (path) => (path === "/r" ? "Corp A · API" : undefined) } }));

    const repositories = targets.filter((target) => target.mode === "/").map((target) => [target.title, target.note]);

    expect(repositories).toEqual([
      ["Corp A · API", "/r"],
      ["/other", undefined],
    ]);
  });

  it("takes every command shortcut from the shortcut registry and gives no two commands the same one", () => {
    const shortcuts = buildCommands(context()).flatMap((command) => command.shortcut ?? []);

    expect(shortcuts.filter((shortcut) => !Object.values(SHORTCUTS).includes(shortcut as never))).toEqual([]);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("turns a control or tab shortcut into a hotkey", () => {
    expect(hotkeyOf("⌃⇥")).toBe("Control+Tab");
    expect(hotkeyOf("⌃⇧⇥")).toBe("Control+Shift+Tab");
    expect(hotkeyOf("⌘⇧T")).toBe("Mod+Shift+T");
  });
});


describe("repository scope (S55)", () => {
  it("lists open tabs and recents first, then scanned folders, each once, with its alias", () => {
    const choices = repositoryChoices({ repositories: () => ["/open", "/recent"], aliasOf: (path) => (path === "/recent" ? "Recent API" : undefined) }, ["/recent", "/scanned/a", "/open"]);

    expect(choices).toEqual([
      { path: "/open", alias: undefined },
      { path: "/recent", alias: "Recent API" },
      { path: "/scanned/a", alias: undefined },
    ]);
  });

  it("registers Open repo with ⇧⌘O from the registry and runs the scoped search through the app", () => {
    const run = context({}, null);
    const search = find(buildCommands(run), "repository.search");

    expect(search.shortcut).toBe("⌘⇧O");
    expect(search.disabledReason).toBeUndefined();
    search.run([]);
    expect(run.app.openRepositorySearch).toHaveBeenCalledOnce();
  });
});

describe("external tool commands (S54, S61)", () => {
  it("opens the repository in the external editor with ⇧⌘E and says why it cannot when none is chosen", () => {
    const run = context();
    const open = find(buildCommands(run), "open.editor");
    expect(open.title).toBe("Open in external editor");
    expect(open.shortcut).toBe("⌘⇧E");
    open.run([]);
    expect(run.app.openExternal).toHaveBeenCalledWith("editor");

    const none = buildCommands(context({ externalTools: { editor: null, diff: null, merge: null } }));
    expect(find(none, "open.editor").disabledReason).toBe("Choose an external editor in Settings → External tools");
    expect(find(none, "file.open_editor").disabledReason).toBe("Choose an external editor in Settings → External tools");
  });

  it("picks a changed file and opens it in the diff tool, or the merge tool when it is conflicted", async () => {
    const files = [
      { path: "a.txt", original_path: null, area: "unstaged", status: "modified" },
      { path: "b.txt", original_path: null, area: "staged", status: "added" },
      { path: "c.txt", original_path: null, area: "conflicted", status: "conflicted" },
    ] as RepoSnapshot["files"];
    const run = context({}, snapshot({ files }));
    const pick = find(buildCommands(run), "open.diffmerge");

    expect(pick.title).toBe("Open in external diff or merge tool…");
    expect((await pick.args[0]?.options())?.map((option) => [option.value, option.disabledReason])).toEqual([
      ["unstaged:a.txt", undefined],
      ["staged:b.txt", undefined],
      ["conflicted:c.txt", undefined],
    ]);
    pick.run(["conflicted:c.txt"]);
    pick.run(["staged:b.txt"]);
    expect(run.app.openFileInTool).toHaveBeenNthCalledWith(1, "c.txt", "conflicted");
    expect(run.app.openFileInTool).toHaveBeenNthCalledWith(2, "b.txt", "staged");
  });

  it("disables a file per option when its tool is missing and the whole command when nothing changed", async () => {
    const files = [
      { path: "a.txt", original_path: null, area: "unstaged", status: "modified" },
      { path: "c.txt", original_path: null, area: "conflicted", status: "conflicted" },
    ] as RepoSnapshot["files"];
    const tools = { editor: "Zed", diff: null, merge: null };
    const pick = find(buildCommands(context({ externalTools: tools }, snapshot({ files }))), "open.diffmerge");

    expect((await pick.args[0]?.options())?.map((option) => option.disabledReason)).toEqual(["Choose an external diff tool in Settings → External tools", "Choose an external merge tool in Settings → External tools"]);
    expect(find(buildCommands(context()), "open.diffmerge").disabledReason).toBe("No changed files to open in a tool");
  });
});

describe("settings and appearance commands (S61)", () => {
  it("sends Git Flow, LFS, signing, and accounts to their Settings sections", () => {
    const run = context();
    const commands = buildCommands(run);
    for (const id of ["settings.git_flow", "settings.lfs_configure", "settings.signing", "accounts.manage"]) find(commands, id).run([]);

    expect((run.app.openSettings as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual(["repository", "repository", "git", "platforms"]);
    expect(find(commands, "settings.lfs_init").title).toBe("Initialize LFS");
    expect(find(commands, "accounts.manage").title).toBe("Manage accounts");
  });

  it("initializes LFS through the app and says why it cannot when Git LFS is missing or already set up", () => {
    const run = context();
    find(buildCommands(run), "settings.lfs_init").run([]);
    expect(run.app.initializeLfs).toHaveBeenCalledOnce();

    const missing = buildCommands(context({ lfs: { installed: false, version: null, initialized: false, patterns: [] } }));
    expect(find(missing, "settings.lfs_init").disabledReason).toBe("Git LFS is not installed on this Mac");
    const done = buildCommands(context({ lfs: { installed: true, version: "3.5.1", initialized: true, patterns: ["*.psd"] } }));
    expect(find(done, "settings.lfs_init").disabledReason).toBe("Git LFS is already initialized in this repository");
    const ready = buildCommands(context({ lfs: { installed: true, version: "3.5.1", initialized: false, patterns: [] } }));
    expect(find(ready, "settings.lfs_init").disabledReason).toBeUndefined();
    expect(find(done, "settings.lfs_configure").disabledReason).toBeUndefined();
  });

  it("needs a repository for Git Flow and LFS but not for signing or accounts", () => {
    const commands = buildCommands(context({}, null));

    expect(find(commands, "settings.git_flow").disabledReason).toBe("Open a repository first");
    expect(find(commands, "settings.lfs_configure").disabledReason).toBe("Open a repository first");
    expect(find(commands, "settings.lfs_init").disabledReason).toBe("Open a repository first");
    expect(find(commands, "settings.signing").disabledReason).toBeUndefined();
    expect(find(commands, "accounts.manage").disabledReason).toBeUndefined();
  });

  it("joins a side, disables the side already chosen with the reason, and toggles the theme", () => {
    const run = context({ theme: "dark" });
    const commands = buildCommands(run);

    find(commands, "theme.light").run([]);
    find(commands, "theme.toggle").run([]);

    expect(run.app.setTheme).toHaveBeenCalledWith("light");
    expect(run.app.toggleTheme).toHaveBeenCalledOnce();
    expect(find(commands, "theme.dark").disabledReason).toBe("The theme is already dark");
    expect(find(commands, "theme.light").title).toBe("Join the light side");
    expect(find(commands, "theme.dark").title).toBe("Join the dark side");
    expect(find(buildCommands(context({ theme: "light" })), "theme.light").disabledReason).toBe("The theme is already light");
  });

  it("switches profile through a profile argument that disables the active one, and needs a second profile", async () => {
    const run = context();
    const commands = buildCommands(run);
    const switcher = find(commands, "profile.switch");

    expect(switcher.title).toBe("Switch to profile…");
    expect((await switcher.args[0]?.options())?.map((option) => [option.label, option.disabledReason])).toEqual([
      ["Default", "This is the active profile"],
      ["Work", undefined],
    ]);
    switcher.run(["work"]);
    expect(run.app.switchProfile).toHaveBeenCalledWith("work");
    const lone = context({ app: { ...app(), profileList: () => ({ active: "default", profiles: [{ id: "default", name: "Default", author_name: "", author_email: "" }] }) } });
    expect(find(buildCommands(lone), "profile.switch").disabledReason).toBe("Create another profile in Settings to switch");
  });
});

describe("view commands (S61)", () => {
  it("zooms in, out, and back with the registry shortcuts", () => {
    const run = context({ zoomPercent: 125 });
    const commands = buildCommands(run);

    expect([find(commands, "zoom.in").shortcut, find(commands, "zoom.out").shortcut, find(commands, "zoom.reset").shortcut]).toEqual(["⌘=", "⌘-", "⌘0"]);
    find(commands, "zoom.in").run([]);
    find(commands, "zoom.out").run([]);
    find(commands, "zoom.reset").run([]);
    expect((run.app.zoom as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual(["in", "out", "reset"]);
  });

  it("disables zooming past 80 and 200 percent and resetting at 100 percent, each with its reason, even without a repository", () => {
    expect(find(buildCommands(context({ zoomPercent: 200 }, null)), "zoom.in").disabledReason).toBe("Already at 200%, the largest size");
    expect(find(buildCommands(context({ zoomPercent: 80 }, null)), "zoom.out").disabledReason).toBe("Already at 80%, the smallest size");
    expect(find(buildCommands(context({ zoomPercent: 100 }, null)), "zoom.reset").disabledReason).toBe("Already at 100%");
    expect(find(buildCommands(context({ zoomPercent: 125 }, null)), "zoom.in").disabledReason).toBeUndefined();
  });

  it("opens the shortcuts sheet, toggles the panels and syntax highlighting, and needs a repository only for the panels", () => {
    const run = context();
    const commands = buildCommands(run);
    for (const id of ["shortcuts.show", "view.sidebar", "view.inspector", "view.syntax"]) find(commands, id).run([]);

    expect(run.app.openShortcuts).toHaveBeenCalledOnce();
    expect(run.app.toggleSidebar).toHaveBeenCalledOnce();
    expect(run.app.toggleInspector).toHaveBeenCalledOnce();
    expect(run.app.toggleSyntaxHighlighting).toHaveBeenCalledOnce();
    expect(find(commands, "view.sidebar").shortcut).toBe("⌘\\");
    expect(find(commands, "view.inspector").shortcut).toBe("⌥⌘\\");
    const none = buildCommands(context({}, null));
    expect(find(none, "view.sidebar").disabledReason).toBe("Open a repository first");
    expect(find(none, "view.inspector").disabledReason).toBe("Open a repository first");
    expect(find(none, "view.syntax").disabledReason).toBeUndefined();
    expect(find(none, "shortcuts.show").disabledReason).toBeUndefined();
  });
});

describe("history, core, and branch commands (S61)", () => {
  it("picks a tracked file for the file history and for the blame, and asks the right view", async () => {
    const run = context();
    const commands = buildCommands(run);

    expect(await find(commands, "history.file").args[0]?.options()).toEqual([
      { value: "README.md", label: "README.md" },
      { value: "src/main.rs", label: "src/main.rs" },
    ]);
    find(commands, "history.file").run(["src/main.rs"]);
    find(commands, "history.blame").run(["README.md"]);

    expect((run.openFileHistory as ReturnType<typeof vi.fn>).mock.calls).toEqual([["src/main.rs", "diff"], ["README.md", "blame"]]);
    expect(find(commands, "history.file").title).toBe("History of file…");
    expect(find(commands, "history.blame").title).toBe("Blame of file…");
  });

  it("redoes the last undone operation with ⇧⌘Z and says Nothing to redo otherwise", () => {
    expect(find(buildCommands(context()), "redo").disabledReason).toBe("Nothing to redo");
    const run = context({ redo: { kind: "available", scope: "Redo: moves main forward" } });
    const redo = find(buildCommands(run), "redo");

    expect(redo.shortcut).toBe("⌘⇧Z");
    expect(redo.disabledReason).toBeUndefined();
    redo.run([]);
    expect(run.redoLast).toHaveBeenCalledOnce();
  });

  it("creates an annotated tag from a name and a message and views the working directory changes", () => {
    const run = context();
    const commands = buildCommands(run);
    const annotated = find(commands, "tag.create_annotated");

    expect(annotated.title).toBe("Create annotated tag…");
    expect(annotated.args.map((arg) => [arg.name, arg.text])).toEqual([["name", true], ["message", true]]);
    annotated.run(["v2", "Second release"]);
    find(commands, "wip.view").run([]);

    expect(run.createTag).toHaveBeenCalledWith("v2", "Second release");
    expect(run.viewChanges).toHaveBeenCalledOnce();
    expect(find(buildCommands(context({}, null)), "tag.create_annotated").disabledReason).toBe("Open a repository first");
  });
});

describe("file, patch, maintenance, and log commands (S61)", () => {
  it("runs the file commands through the repository actions with the chosen tracked file", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "file.create").run([]);
    find(commands, "file.delete").run(["README.md"]);
    find(commands, "file.view").run(["README.md"]);
    find(commands, "file.edit").run(["src/main.rs"]);
    find(commands, "file.open_editor").run(["src/main.rs"]);

    expect(run.calls).toEqual([["createFile"], ["deleteFile", "README.md"], ["viewFile", "README.md"], ["editFile", "src/main.rs"]]);
    expect(run.app.openFileInEditor).toHaveBeenCalledWith("src/main.rs");
    for (const id of ["file.delete", "file.view", "file.edit", "file.open_editor"]) expect(find(commands, id).args).toHaveLength(1);
  });

  it("takes the reasons for Discard all, Create patch, and maintenance from the repository actions", () => {
    const run = context();
    const blocked = {
      discardAllReason: () => "No changes to discard",
      createPatchReason: () => "There are no changes to put in a patch",
      maintainReason: () => "Another operation is running",
    };
    Object.assign(run.actions as object, blocked);
    const commands = buildCommands(run);

    expect(find(commands, "file.discard_all").disabledReason).toBe("No changes to discard");
    expect(find(commands, "patch.create").disabledReason).toBe("There are no changes to put in a patch");
    expect(find(commands, "repository.maintain").disabledReason).toBe("Another operation is running");
    expect(find(buildCommands(context()), "file.discard_all").disabledReason).toBeUndefined();
    expect(find(buildCommands(context()), "patch.create").disabledReason).toBeUndefined();
    expect(find(buildCommands(context()), "repository.maintain").disabledReason).toBeUndefined();
    expect(find(buildCommands(context({}, null)), "repository.maintain").disabledReason).toBe("Open a repository first");
  });

  it("runs discard all, create patch, apply patch, and maintenance through the actions", () => {
    const run = context();
    const commands = buildCommands(run);
    find(commands, "file.discard_all").run([]);
    find(commands, "patch.create").run([]);
    find(commands, "patch.apply").run([]);
    find(commands, "repository.maintain").run([]);

    expect(run.calls).toEqual([["discardAll"], ["createPatch"], ["applyPatch"], ["maintain"]]);
    expect(find(commands, "patch.create").title).toBe("Create patch from working directory changes");
    expect(find(commands, "repository.maintain").title).toBe("Perform repository maintenance");
  });

  it("opens the activity, error, and performance logs and the release notes without a repository", () => {
    const run = context({}, null);
    const commands = buildCommands(run);
    for (const id of ["logs.activity", "logs.errors", "logs.performance", "logs.release_notes"]) {
      expect(find(commands, id).disabledReason).toBeUndefined();
      find(commands, id).run([]);
    }

    expect(run.app.openDrawer).toHaveBeenCalledOnce();
    expect((run.app.openLogs as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual(["errors", "performance"]);
    expect(run.app.openReleaseNotes).toHaveBeenCalledOnce();
  });

  it("gives every command a title that names its S61 action", () => {
    const titles = new Set(buildCommands(context()).map((command) => command.title));
    for (const title of [
      "Open repo…", "Open in external editor", "Open in external diff or merge tool…", "Open in terminal", "Reveal in Finder", "Close tab", "Clone repository…", "Create repository…", "Open repository…", "Open settings",
      "Configure Git Flow", "Configure LFS", "Initialize LFS", "Configure commit signing", "Join the light side", "Join the dark side", "Manage accounts", "Switch to profile…",
      "Zoom in", "Zoom out", "Reset zoom", "Keyboard shortcuts", "Toggle sidebar", "Toggle inspector", "Toggle syntax highlighting", "Toggle theme",
      "History of file…", "Blame of file…", "Undo last operation", "Redo last operation",
      "Create file…", "Delete file…", "Open file in editor…", "View file…", "Edit file…", "Discard all changes", "Stage all changes", "Unstage all changes",
      "Stash changes…", "Apply stash…", "Pop stash…", "Create tag…", "Create annotated tag…", "Fetch all", "Rename branch…", "Create pull request…", "View working directory changes", "Checkout…",
      "Create patch from working directory changes", "Apply patch…", "Activity log", "Error log", "Performance log", "Release notes", "Perform repository maintenance",
    ]) expect(titles.has(title), title).toBe(true);
  });
});
