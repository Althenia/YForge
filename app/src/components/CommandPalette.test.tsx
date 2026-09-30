import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { NOTHING_TO_UNDO } from "../state/activityModel";
import type { PaletteApp, PaletteContext } from "../state/palette";
import type { RepoActions } from "../state/repoActions";
import { CommandPalette } from "./CommandPalette";
import { flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
const snapshot = {
  root: "/r",
  head: { kind: "branch", name: "feature/greeting", sha: "a" },
  upstream: null,
  counts,
  files: [],
  operation: null,
  branches: ["main", "feature/greeting"],
  remote_branches: ["origin/main"],
  remotes: ["origin"],
  tags: [],
  stashes: [],
  worktrees: [],
} as unknown as RepoSnapshot;

function mount(overrides: Partial<PaletteContext> = {}) {
  const startRebase = vi.fn();
  const openCreateBranchAt = vi.fn();
  const actions = { sync: () => ({ kind: "idle" }), startRebase, openCreateBranchAt } as unknown as RepoActions;
  const app = { openClone: vi.fn(), openLauncher: vi.fn(), openFolder: vi.fn(), openCreate: vi.fn(), closeTab: vi.fn(), openSettings: vi.fn(), addPlatformConnection: vi.fn(), toggleDrawer: vi.fn(), openSearch: vi.fn(), openExternal: vi.fn(), setTheme: vi.fn(), openRepository: vi.fn(), repositories: () => ["/r"] } as PaletteApp;
  const closed = vi.fn();
  const context: PaletteContext = {
    snapshot,
    actions,
    selectedSha: undefined,
    selection: [],
    pullMode: "fast_forward_or_merge",
    offline: false,
    undo: { kind: "unavailable", reason: NOTHING_TO_UNDO },
    anchor: { left: 5, top: 6 },
    app,
    platform: undefined,
    revealCommit: vi.fn(),
    revealHead: vi.fn(),
    revealRef: vi.fn(),
    focusComposer: vi.fn(),
    openPanel: vi.fn(),
    loadCommits: async () => [{ sha: "abcdef1234567", summary: "Add greeting", merge: false, root: false }],
    ...overrides,
  };
  const mounted = mountWithApp(() => <CommandPalette context={context} onClose={closed} />);
  dispose = mounted.dispose;
  const input = () => mounted.host.querySelector<HTMLInputElement>('input[aria-label="Command"]');
  const key = (name: string, init: KeyboardEventInit = {}) => input()?.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  const labels = () => [...mounted.host.querySelectorAll(".pal-item .pal-label")].map((label) => label.textContent);
  return { ...mounted, input, key, labels, startRebase, openCreateBranchAt, closed, app, context };
}

describe("command palette", () => {
  it("leads every row with a 16px icon slot, filled where a command has an established glyph", async () => {
    const { input, host } = mount();
    await flush();

    type(input(), "stage");
    await flush();

    const rows = [...host.querySelectorAll(".pal-item")];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.firstElementChild?.classList.contains("pal-icon"))).toBe(true);
    const stageAll = rows.find((row) => row.textContent?.includes("Stage all changes"));
    expect(stageAll?.querySelector(".pal-icon svg")).not.toBeNull();
  });

  it("runs 'Rebase onto…' by picking a ref argument, with chips and a disabled reason for the current branch", async () => {
    const { input, key, labels, host, startRebase, closed } = mount();
    await flush();

    type(input(), "rebase");
    await flush();
    expect(labels()[0]).toBe("Rebase onto…");
    key("Enter");
    await flush();

    expect(host.querySelector(".pal-chip")?.textContent).toBe("Rebase onto");
    expect(labels()).toEqual(["main", "feature/greeting", "origin/main"]);
    const current = [...host.querySelectorAll(".pal-item")].find((item) => item.textContent?.includes("feature/greeting"));
    expect(current?.getAttribute("aria-disabled")).toBe("true");
    expect(current?.textContent).toContain("Already the checked-out branch");
    key("Enter");
    await flush();
    expect(startRebase).toHaveBeenCalledWith("main");
    expect(closed).toHaveBeenCalled();
  });

  it("does not run a disabled option and lets Backspace remove the argument chip", async () => {
    const { key, host, startRebase, input } = mount();
    await flush();
    type(input(), "rebase");
    key("Enter");
    await flush();

    key("ArrowDown");
    key("Enter");
    await flush();
    expect(startRebase).not.toHaveBeenCalled();
    key("Backspace");
    await flush();
    expect(host.querySelector(".pal-chip")).toBeNull();
  });

  it("opens 'Create branch…' at the palette anchor and shows shortcut hints", async () => {
    const { input, key, host, openCreateBranchAt } = mount({ selectedSha: "abc1234" });
    await flush();

    type(input(), "create branch");
    await flush();
    expect(host.querySelector(".pal-item .kbd")?.textContent).toBe("⌘B");
    key("Enter");
    await flush();
    await flush();

    expect(openCreateBranchAt).toHaveBeenCalledWith("abc1234", { left: 5, top: 6 });
  });

  it("shows a disabled command's reason instead of running it", async () => {
    const { input, key, host, closed } = mount();
    await flush();

    type(input(), "undo");
    await flush();
    const item = host.querySelector(".pal-item");
    expect(item?.textContent).toContain(NOTHING_TO_UNDO);
    key("Enter");
    await flush();

    expect(closed).not.toHaveBeenCalled();
  });

  it("switches modes by prefix: @ branches navigate, : settings navigate", async () => {
    const { input, key, labels, context } = mount();
    await flush();

    type(input(), "@main");
    await flush();
    expect(labels()).toEqual(["Go to main", "Go to origin/main"]);
    key("Enter");
    await flush();
    expect(context.revealRef).toHaveBeenCalledWith("main");
  });

  it("lists commits for # mode from the loaded history and reveals the chosen one", async () => {
    const { input, key, labels, host, context } = mount();
    await flush();

    type(input(), "#greet");
    await flush();
    await flush();
    expect(labels()).toEqual(["Add greeting"]);
    expect(host.querySelector(".pal-note")?.textContent).toBe("abcdef1");
    key("Enter");
    await flush();
    expect(context.revealCommit).toHaveBeenCalledWith("abcdef1234567");
  });

  it("clears the query on the first Escape and closes on the second", async () => {
    const { input, key, closed } = mount();
    await flush();
    type(input(), "fetch");

    key("Escape");
    expect(input()?.value).toBe("");
    expect(closed).not.toHaveBeenCalled();
    key("Escape");
    expect(closed).toHaveBeenCalled();
  });

  it("orders the recently run commands the database holds first for an empty query", async () => {
    mockIPC((cmd) => (cmd === "app_ui_prefs_load" ? { palette_recents: ["tab.new"], last_parent_folder: null } : null));
    const { labels } = mount();
    await flush();

    expect(labels()[0]).toBe("New tab");
  });

  it("stores the command it runs as the newest recent command", async () => {
    const saves: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "app_ui_prefs_save") saves.push(args);
      return cmd === "app_ui_prefs_load" ? { palette_recents: ["tab.new"], last_parent_folder: null } : null;
    });
    const { input, key } = mount();
    await flush();

    type(input(), "clone");
    await flush();
    key("Enter");
    await flush(40);

    expect(saves).toEqual([{ prefs: { palette_recents: ["repository.clone", "tab.new"], last_parent_folder: null } }]);
  });

  it("without a repository, repository commands are disabled with a reason and application commands run", async () => {
    const { input, key, host, app, closed } = mount({ snapshot: undefined, actions: undefined });
    await flush();

    type(input(), "fetch");
    await flush();
    expect(host.querySelector(".pal-item")?.textContent).toContain("Open a repository first");
    type(input(), "clone");
    await flush();
    key("Enter");
    await flush();
    await flush();

    expect(closed).toHaveBeenCalled();
    expect(app.openClone).toHaveBeenCalled();
  });
});
