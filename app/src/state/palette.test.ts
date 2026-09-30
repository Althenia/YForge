import { describe, expect, it, vi } from "vitest";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { NOTHING_TO_UNDO } from "./activityModel";
import {
  buildCommands,
  commandForShortcut,
  shortcutLabel,
  fuzzyMatch,
  loadRecentCommands,
  navigationTargets,
  parseQuery,
  rank,
  refOptions,
  rememberCommand,
  type PaletteApp,
  type PaletteContext,
} from "./palette";
import { commitMenu, dropPlan, localTarget, refMenu, remoteTarget, resetModeMenu, stashMenu, tagTarget, type MenuEntry, type RefTarget } from "./refMenu";
import type { RepoActions } from "./repoActions";
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
    stashes: [{ index: 0, sha: "s0", base_sha: null, author_name: "Yui", message: "WIP", time: 0 }],
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
  toggleDrawer: vi.fn(),
  openSearch: vi.fn(),
  openExternal: vi.fn(),
  setTheme: vi.fn(),
  openRepository: vi.fn(),
  repositories: () => ["/r", "/other"],
});

const fakeActions = () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const names = ["checkoutRef", "openMerge", "startRebase", "fastForward", "startReset", "openCreateBranchAt", "openCreateTag", "pushTag", "deleteBranch", "openRenameBranch", "deleteLocalTag", "deleteTagOnRemote", "dropStash", "restoreStash", "applyCommit", "fetchAll", "pull", "pullDefault", "push", "undo", "openStashForm", "continueOperation", "skipOperation", "abortOperation", "cancelSync", "stageAll", "unstageAll"];
  const actions = { sync: () => ({ kind: "idle" as const }), ...Object.fromEntries(names.map((name) => [name, record(name)])) };
  return { actions: actions as unknown as RepoActions, calls };
};

function context(overrides: Partial<PaletteContext> = {}, repo: RepoSnapshot | null = snapshot()): PaletteContext & { calls: Array<[string, ...unknown[]]> } {
  const { actions, calls } = fakeActions();
  return {
    snapshot: repo ?? undefined,
    actions: repo === null ? undefined : actions,
    selectedSha: undefined,
    pullMode: "fast_forward_or_merge",
    undo: { kind: "unavailable", reason: NOTHING_TO_UNDO },
    anchor: { left: 10, top: 20 },
    app: app(),
    revealCommit: vi.fn(),
    revealRef: vi.fn(),
    focusComposer: vi.fn(),
    loadCommits: async () => [
      { sha: "abcdef1234567", summary: "Add greeting", merge: false },
      { sha: "1234567abcdef", summary: "Merge topic", merge: true },
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

  it("lists navigation targets for branches, commits, settings, and repositories", () => {
    const run = context();
    const targets = navigationTargets(run, [{ sha: "abcdef1234567", summary: "Add greeting", merge: false }]);
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

  it("remembers recently run commands, newest first, without duplicates", () => {
    window.localStorage.clear();
    rememberCommand("a");
    rememberCommand("b");
    rememberCommand("a");
    expect(loadRecentCommands()).toEqual(["a", "b"]);
  });
});

describe("keyboard shortcuts", () => {
  const press = (key: string, extra: Partial<KeyboardEvent> = {}) => shortcutLabel({ key, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

  it("labels command-key chords the way the palette shows them", () => {
    expect(press("k")).toBe("⌘K");
    expect(press("f", { shiftKey: true })).toBe("⌘⇧F");
    expect(press(",")).toBe("⌘,");
    expect(press("Enter")).toBe("⌘↵");
    expect(press("z", { metaKey: false, ctrlKey: true })).toBe("⌘Z");
  });

  it("ignores bare keys, option chords, and lone modifier presses", () => {
    expect(press("k", { metaKey: false })).toBeUndefined();
    expect(press("k", { altKey: true })).toBeUndefined();
    expect(press("Meta")).toBeUndefined();
    expect(press("Shift", { shiftKey: true })).toBeUndefined();
  });

  it("maps a chord to the command that shows it, skipping commit and commands that need arguments", () => {
    const commands = buildCommands(context());
    expect(commandForShortcut(commands, "⌘B")?.id).toBe("branch.create");
    expect(commandForShortcut(commands, "⌘⇧F")?.id).toBe("sync.fetch");
    expect(commandForShortcut(commands, "⌘↵")).toBeUndefined();
    expect(commandForShortcut(commands, "⌘⇧Q")).toBeUndefined();
  });
});
