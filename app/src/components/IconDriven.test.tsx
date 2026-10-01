import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { defaultSettings } from "../state/settingsModel";
import type { MenuState } from "../state/repoActions";
import { ContextMenu } from "./ContextMenu";
import { Launcher } from "./Launcher";
import { SettingsView } from "./SettingsView";
import { TooltipHost } from "./Tooltip";
import { Workspace } from "./Workspace";
import { flush, mountWithApp, stubLayout } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  restoreLayout = stubLayout();
  mockWindows("main");
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  restoreLayout?.();
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
});

const setWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
};

const geometry = { row: 28, pitch: 22, gutter: 28, node: 22, mergeNode: 12, line: 2, arc: 11, refColumn: 200, refColumnMin: 32, refColumnMax: 300, authorColumn: 130, dateColumn: 130, shaColumn: 100, graphColumn: 160, laneColors: 10 };
const info: AppInfo = { app_version: "0.1.0", git_version: "2.50.0" };
const counts = { modified: 2, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 };

const snapshot: RepoSnapshot = {
  root: "/r",
  main_root: "/r",
  head: { kind: "branch", name: "feature/greeting", sha: "a".repeat(40) },
  upstream: { name: "origin/feature/greeting", ahead_behind: { ahead: 2, behind: 0 } },
  counts,
  files: [
    { path: "src/app.ts", original_path: null, area: "staged", status: "modified" },
    { path: "src/app.ts", original_path: null, area: "unstaged", status: "modified" },
    { path: "notes.txt", original_path: null, area: "untracked", status: "untracked" },
  ],
  operation: null,
  operation_detail: null,
  last_fetch: null,
  worktrees: [{ path: "/r", head: null, branch: "feature/greeting", bare: false, locked: false, prunable: false, current: true }],
  branches: ["feature/greeting", "main"],
  remote_branches: ["origin/main"],
  remotes: ["origin"],
  tags: ["v0.1.0"],
  stashes: [{ index: 0, sha: "b".repeat(40), base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "wip", time: 0 }],
};

const recent = { path: "/Users/yui/dev/sample", opened_at: Math.floor(Date.now() / 1000) };
const recentStatus = { path: recent.path, exists: true, branch: "main", unborn: false, ahead_behind: null, counts, worktrees: 1 };

function install() {
  mockIPC(
    (cmd) => {
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "repo_aliases_list") return [];
      if (cmd === "session_load") return { tabs: ["/r"], active: 0, groups: [] };
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") return snapshot;
      if (cmd === "repo_graph") return { rows: [], carried: [], total: 0 };
      if (cmd === "plugin:path|resolve_directory") return "/Users/yui";
      if (cmd === "recents_list") return [recent];
      if (cmd === "recent_statuses") return [recentStatus];
      if (cmd === "activity_list") return [];
      if (cmd === "remotes_list" || cmd === "switch_stashes") return [];
      if (cmd === "worktree_list") return snapshot.worktrees.map((entry) => ({ ...entry, dirty: false }));
      if (cmd === "reflog_refs") return ["HEAD"];
      if (cmd === "reflog_list") return [];
      if (cmd === "recompose_preview") return { base: "b", head: "h", pushed: false, files: [] };
      if (cmd === "identity_read") return { name: { value: null, source: "unset" }, email: { value: null, source: "unset" } };
      return null;
    },
    { shouldMockEvents: true },
  );
}

async function mountWorkspace(current: RepoSnapshot = snapshot) {
  install();
  const mounted = mountWithApp(() => (
    <>
      <Workspace view={{ status: "ready", path: "/r", snapshot: current, info }} geometry={geometry} />
      <TooltipHost />
    </>
  ));
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush(40);
  return mounted;
}

const textOf = (button: Element) => button.textContent?.replace(/\s+/g, " ").trim() ?? "";
const iconOnly = (host: ParentNode) => [...host.querySelectorAll("button")].filter((button) => textOf(button) === "" && button.querySelector("svg") !== null);
const commandButton = (host: ParentNode, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".commandbar button.btn")].find((button) => button.dataset.tip === label || textOf(button).startsWith(label));
const tooltip = () => document.querySelector('[role="tooltip"]');

const expectNamedWithTooltip = (host: ParentNode) => {
  const buttons = iconOnly(host);
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    const where = button.outerHTML.slice(0, 120);
    expect(button.getAttribute("aria-label")?.trim() ?? "", where).not.toBe("");
    expect(button.dataset.tip?.trim() ?? "", where).not.toBe("");
    if (!(button as HTMLButtonElement).disabled) expect(button.hasAttribute("title"), where).toBe(false);
  }
};

describe("icon-driven controls (S15)", () => {
  it("gives every icon-only button in the workspace an accessible name and a tooltip", async () => {
    const { host } = await mountWorkspace();

    expectNamedWithTooltip(host);
    const names = iconOnly(host).map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(
      expect.arrayContaining(["Close r", "New tab", "Activity", "Toggle theme", "Settings", "Search commits", "Open diff of notes.txt", "Open notes.txt in editor", "Stage notes.txt", "Unstage src/app.ts"]),
    );
  });

  it("gives every icon-only button in the launcher and settings an accessible name and a tooltip", async () => {
    install();
    const launcher = mountWithApp(() => <Launcher />);
    dispose = launcher.dispose;
    await flush(40);
    expect(launcher.host.querySelectorAll("button").length).toBeGreaterThan(0);
    expectNamedWithTooltip(launcher.host);
    dispose();

    install();
    const settings = mountWithApp(() => <SettingsView section="general" />);
    dispose = settings.dispose;
    await flush(40);
    expect(settings.host.querySelectorAll(".settings-nav button")).toHaveLength(8);
    for (const button of iconOnly(settings.host)) expect(button.dataset.tip).toBeTruthy();
  });

  it("shows the toolbar as icon and label at 1280 and above, and as named icon-only buttons below", async () => {
    setWidth(1280);
    const { host } = await mountWorkspace();
    const labelled = ["Sync", "Branch", "Stash", "Undo"].map((label) => commandButton(host, label));

    expect(labelled.map((button) => textOf(button as Element))).toEqual(["Sync↑2", "Branch", "Stash", "Undo"]);
    expect(labelled.map((button) => button?.querySelector("svg") !== null)).toEqual([true, true, true, true]);
    expect(labelled.map((button) => button?.hasAttribute("data-tip"))).toEqual([false, false, false, false]);

    setWidth(1279);
    await flush();
    const collapsed = ["Sync, 2 ahead", "Branch", "Stash", "Undo"].map((name) => host.querySelector<HTMLButtonElement>(`.commandbar button[aria-label="${name}"]`));
    expect(collapsed.map((button) => button !== null && button.dataset.tip === button.getAttribute("aria-label"))).toEqual([true, true, true, true]);
    expect(collapsed.map((button) => button?.querySelector("svg") !== null)).toEqual([true, true, true, true]);
    expect(collapsed.map((button) => button?.textContent?.replace("↑2", "").trim())).toEqual(["", "", "", ""]);

    setWidth(1440);
    await flush();
    expect(commandButton(host, "Sync")?.dataset.tip).toBeUndefined();
    expect(textOf(commandButton(host, "Sync") as Element)).toContain("Sync");
  });

  it("leads each sidebar section and inspector section header with an icon before the label", async () => {
    const { host } = await mountWorkspace();

    const sidebar = [...host.querySelectorAll(".sidebar .sec-title")].map((header) => [textOf(header), header.firstElementChild?.tagName]);
    expect(sidebar).toEqual([
      ["Branches", "svg"],
      ["Remotes", "svg"],
      ["Tags", "svg"],
      ["Stashes", "svg"],
      ["Worktrees", "svg"],
      ["Recovery", "svg"],
    ]);
    const inspector = [...host.querySelectorAll(".inspector .lhead-title")].map((header) => header.firstElementChild?.tagName);
    expect(inspector.length).toBeGreaterThan(0);
    expect(inspector.every((tag) => tag === "svg")).toBe(true);
    expect(host.querySelector(".composer .btn.primary svg")).not.toBeNull();
    expect(textOf(host.querySelector(".composer .btn.primary") as Element)).toContain("Commit");
  });

  it("keeps a text label on the operation banner actions", async () => {
    const merging: RepoSnapshot = {
      ...snapshot,
      operation: "rebase",
      operation_detail: { current: "main", incoming: "feature/greeting", message: "", step: { current: 1, total: 2 }, resolved: [] },
      counts: { ...counts, conflicted: 1 },
      files: [{ path: "src/app.ts", original_path: null, area: "conflicted", status: "conflicted" }],
    };
    const { host } = await mountWorkspace(merging);

    const actions = [...host.querySelectorAll(".op-bar button")];
    expect(actions.map(textOf)).toEqual(["Resolve", "Continue", "Skip", "Abort"]);
    expect(actions.some((button) => button.hasAttribute("data-tip"))).toBe(false);
  });

  it("keeps the discard action as a text menu item with a leading icon", async () => {
    const { host } = await mountWorkspace();

    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More actions for notes.txt"]');
    more?.click();
    await flush();
    const discard = document.querySelector('[role="menuitem"]');
    expect(textOf(discard as Element)).toBe("Delete untracked file…");
    expect(discard?.classList.contains("danger")).toBe(true);
    expect(discard?.querySelector(".item-icon svg")).not.toBeNull();
  });

  it("shows the tooltip with the action and its shortcut in mono on keyboard focus and hides it on Escape", async () => {
    setWidth(1100);
    const { host } = await mountWorkspace();
    const stash = host.querySelector<HTMLButtonElement>('.commandbar button[aria-label="Stash"]');

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    stash?.focus();
    await flush();

    expect(tooltip()?.textContent).toBe("Stash⌘⇧S");
    expect(tooltip()?.querySelector("kbd.tip-key")?.textContent).toBe("⌘⇧S");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(tooltip()).toBeNull();
  });

  it("shows the tooltip after hovering an icon-only control and hides it when the pointer leaves", async () => {
    const { host } = await mountWorkspace();
    const search = host.querySelector<HTMLButtonElement>('button[aria-label="Search commits"]');
    vi.useFakeTimers();

    search?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tooltip()).toBeNull();
    vi.advanceTimersByTime(600);
    await Promise.resolve();
    expect(tooltip()?.textContent).toBe("Search commits⌘F");

    search?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await Promise.resolve();
    expect(tooltip()).toBeNull();
  });

  it("does not show the tooltip after a pointer click focuses the control", async () => {
    const { host } = await mountWorkspace();
    const search = host.querySelector<HTMLButtonElement>('button[aria-label="Search commits"]');

    search?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    search?.focus();
    await flush();

    expect(tooltip()).toBeNull();
  });

  it("gives every menu item a leading 16px icon slot so labels stay aligned, empty when no glyph exists", async () => {
    const menu: MenuState = {
      anchor: { left: 10, top: 10 },
      entries: [
        { kind: "item", id: "fetch", label: ["Fetch all"], icon: "fetch" },
        { kind: "separator" },
        { kind: "item", id: "soft", label: ["Soft"], note: "keep changes staged" },
      ],
      run: () => undefined,
    };
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => <ContextMenu menu={menu} onClose={() => undefined} />, host);

    const items = [...host.querySelectorAll('[role="menuitem"]')];
    expect(items).toHaveLength(2);
    for (const item of items) {
      const main = item.firstElementChild;
      expect(main?.classList.contains("item-main")).toBe(true);
      expect(main?.firstElementChild?.classList.contains("item-icon")).toBe(true);
      expect(main?.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
      expect(main?.lastElementChild?.classList.contains("label-text")).toBe(true);
    }
    expect(items[0]?.querySelector(".item-icon svg")).not.toBeNull();
    expect(items[1]?.querySelector(".item-icon")?.children).toHaveLength(0);
  });

  it("hides the graph behind the recompose view and shows it again when the view closes", async () => {
    const { host, app } = await mountWorkspace();
    const actions = app.paletteContext().actions;

    actions?.openRecompose(undefined);
    await flush(40);
    expect(host.querySelector('[aria-label="Recompose"]')).not.toBeNull();
    expect(host.querySelector(".graph")?.classList.contains("covered")).toBe(true);

    actions?.closeHistory();
    await flush(40);
    expect(host.querySelector('[aria-label="Recompose"]')).toBeNull();
    expect(host.querySelector(".graph")?.classList.contains("covered")).toBe(false);
  });

  it("covers the graph with the Worktrees panel from the state strip and Recovery from the palette, and shows the graph again when each closes", async () => {
    const { host, app } = await mountWorkspace();
    const graph = () => host.querySelector(".graph");

    [...host.querySelectorAll<HTMLButtonElement>(".chips button.chip")].find((chip) => chip.textContent?.includes("worktree"))?.click();
    await flush(40);
    expect(host.querySelector('[aria-label="Worktrees"].rpanel')).not.toBeNull();
    expect(graph()?.classList.contains("covered")).toBe(true);
    [...host.querySelectorAll<HTMLButtonElement>(".rpanel button")].find((button) => textOf(button) === "Back to graph")?.click();
    await flush(40);
    expect(host.querySelector('[aria-label="Worktrees"].rpanel')).toBeNull();
    expect(graph()?.classList.contains("covered")).toBe(false);

    app.paletteContext().openPanel("lost");
    await flush(40);
    expect(host.querySelector('.rpanel[aria-label="Recovery"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Recovery sources"] [aria-selected="true"]')?.textContent).toContain("Lost commits");
    expect(graph()?.classList.contains("covered")).toBe(true);
    host.querySelector('.rpanel[aria-label="Recovery"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush(40);
    expect(host.querySelector('.rpanel[aria-label="Recovery"]')).toBeNull();
  });
});
