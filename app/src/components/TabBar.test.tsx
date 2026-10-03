import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import type { TabGroup } from "../ipc/bindings/TabGroup";
import { GROUPS_CANNOT_NEST } from "../state/tabs";
import { repoKeys } from "../state/queryKeys";
import { defaultSettings } from "../state/settingsModel";
import { TabBar } from "./TabBar";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

type Mount = { tabs?: string[]; mains?: Record<string, string>; groups?: TabGroup[]; active?: number; failSave?: () => boolean; failSettings?: () => boolean; aliases?: Array<{ path: string; alias: string }>; count?: () => number | undefined; profiles?: ProfileList };

async function mountBar({ tabs = ["/work/sample"], mains = {}, groups = [], active = 0, failSave = () => false, failSettings = () => false, aliases = [], count = () => 1, profiles }: Mount) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "settings_save") {
        if (failSettings()) throw { kind: "internal", message: "Settings could not be written: disk full", output: null };
        return (args as { settings: unknown }).settings;
      }
      if (cmd === "session_save" && failSave()) throw { kind: "internal", message: "disk full", output: null };
      if (cmd === "session_load") return { tabs, active, groups };
      if (cmd === "repo_aliases_list") return aliases;
      if (cmd === "repo_alias_set") {
        const { path, alias } = args as { path: string; alias: string | null };
        if (alias === "refuse") throw { kind: "invalid_request", message: "An alias is at most 40 characters", output: null };
        aliases = [...aliases.filter((entry) => entry.path !== path), ...(alias === null ? [] : [{ path, alias }])];
        return aliases;
      }
      if (cmd === "activity_list" || cmd === "recents_list") return [];
      if (cmd === "profiles_list") return profiles ?? null;
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") {
        const path = (args as { path: string }).path;
        if (!tabs.includes(path)) throw { kind: "not_a_repository", message: "no", output: null };
        return { root: path, main_root: mains[path] ?? path };
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => <TabBar count={count()} />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return { host: mounted.host, app: mounted.app, calls };
}

async function mountTabs(tabs = ["/work/sample"], mains: Record<string, string> = {}) {
  return (await mountBar({ tabs, mains })).host;
}

const group = (name: string, tabs: string[], extra: Partial<TabGroup> = {}): TabGroup => ({ name, color: "blue", collapsed: false, tabs, ...extra });

const tabTitles = (host: ParentNode) => [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("title"));

const tabButton = (host: ParentNode, title: string) => host.querySelector<HTMLElement>(`[role="tab"][title="${title}"]`) as HTMLElement;

const chip = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLButtonElement>("button.gchip")].find((entry) => entry.textContent?.startsWith(name)) as HTMLButtonElement;

const flat = (node: Element) => node.textContent?.replace(/\s+/g, " ").trim();

const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];

const menuItem = (label: string) => menuItems().find((entry) => flat(entry)?.startsWith(label)) as HTMLElement;

const rightClick = async (target: HTMLElement) => {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }));
  await flush();
};

const shiftF10 = async (target: HTMLElement) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
  await flush();
};

const pickMenuItem = async (label: string) => {
  menuItem(label).click();
  await flush();
};

const dialog = (name: string) => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${name}"]`) as HTMLElement;

const lastSession = (calls: Call[]) => calls.filter((call) => call.cmd === "session_save").at(-1)?.args;

const COLORS = ["Cyan", "Blue", "Purple", "Magenta", "Pink", "Red", "Orange", "Yellow", "Green", "Mint"];

const radios = (container: ParentNode) => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

const radioNamed = (container: ParentNode, color: string) => radios(container).find((entry) => entry.closest("label")?.textContent?.trim() === color) as HTMLInputElement;

describe("tab bar", () => {
  it("leads a repository tab with the hidden YForge logo (small-size variant), so the tab is named by its repository alone", async () => {
    const host = await mountTabs();

    const tab = host.querySelector<HTMLElement>('[role="tab"]');
    const mark = tab?.querySelector("svg.brand-mark");
    expect(mark?.getAttribute("viewBox")).toBe("0 0 1024 1024");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("width")).toBe("24");
    expect(mark?.querySelector("circle")?.getAttribute("r")).toBe("96");
    expect(tab?.textContent).not.toContain("Y");
    expect(tab?.textContent?.replace(/\s+/g, " ").trim().startsWith("sample")).toBe(true);
  });

  it("groups a worktree's tab under its repository with the worktree glyph instead of the logo, and leaves single tabs ungrouped", async () => {
    const host = await mountTabs(["/work/sample", "/work/other", "/work/sample-feature"], { "/work/sample-feature": "/work/sample" });

    const groups = [...host.querySelectorAll(".tab-group")];
    const names = (group: Element) => [...group.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("title"));

    expect(groups.map(names)).toEqual([["/work/sample", "/work/sample-feature"], ["/work/other"]]);
    expect(groups[0]?.getAttribute("role")).toBe("group");
    expect(groups[0]?.getAttribute("aria-label")).toBe("sample and its worktrees");
    expect(groups[0]?.querySelectorAll("svg.brand-mark")).toHaveLength(1);
    expect(groups[0]?.querySelector(".tab.linked svg.brand-mark")).toBeNull();
    expect(groups[0]?.querySelector(".tab.linked .icon")).not.toBeNull();
    expect(groups[1]?.getAttribute("role")).toBeNull();
  });

  it("opens a tab's menu by right-click and by ⇧F10 with the close items, the group items, the alias, and Reopen closed tab in that order", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b"], groups: [group("Corp A", ["/work/a"])] });

    await rightClick(tabButton(host, "/work/b"));
    expect(menuItems().map(flat)).toEqual(["Close tab⌘W", "Close other tabs", "Close tabs to the right", "Move left", "Move right", "Add to new group…", "Add to group", "Alias tab…", "Reopen closed tab⌘⇧T"]);
    menuItem("Close tab").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await shiftF10(tabButton(host, "/work/a"));
    expect(menuItems().map(flat)).toEqual(["Close tab⌘W", "Close other tabs", "Close tabs to the right", "Move left", "Move right", "Add to new group…", "Add to groupNo other groups", "Remove from group", "Alias tab…", "Reopen closed tab⌘⇧T"]);
  });

  it("keeps the items that cannot act visible, aria-disabled, with their reason as the tooltip", async () => {
    const { host } = await mountBar({ tabs: ["/work/a"] });

    await rightClick(tabButton(host, "/work/a"));

    const disabled = menuItems().filter((entry) => entry.getAttribute("aria-disabled") === "true");
    expect(disabled.map((entry) => [flat(entry), entry.getAttribute("title")])).toEqual([
      ["Close other tabs", "No other tabs"],
      ["Close tabs to the right", "No tabs to the right"],
      ["Move left", "This tab is already first"],
      ["Move right", "This tab is already last"],
      ["Add to groupNo groups yet", "No groups yet"],
      ["Reopen closed tab⌘⇧T", "No closed tabs"],
    ]);
  });

  it("closes the other tabs or the tabs to the right without a confirmation when none has an operation in progress", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c", "/work/d"], active: 1 });

    await rightClick(tabButton(host, "/work/c"));
    await pickMenuItem("Close tabs to the right");
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b", "/work/c"]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    await rightClick(tabButton(host, "/work/b"));
    await pickMenuItem("Close other tabs");

    expect(tabTitles(host)).toEqual(["/work/b"]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title")).toBe("/work/b");
  });

  it("confirms closing several tabs only when one of them has an operation in progress, naming it", async () => {
    const { host, app } = await mountBar({ tabs: ["/work/a", "/work/gateway", "/work/c"] });
    app.queryClient.setQueryData(repoKeys.snapshot("/work/gateway"), { operation: "rebase" });

    await rightClick(tabButton(host, "/work/a"));
    await pickMenuItem("Close other tabs");
    const confirm = document.querySelector('[role="alertdialog"]') as HTMLElement;

    expect(confirm.textContent).toContain("Close 2 tabs?");
    expect(confirm.textContent).toContain("gateway is in the middle of a rebase.");
    expect(confirm.textContent).toContain("Closing its tab does not stop or undo the rebase; it stays in the repository until you continue or abort it there.");
    expect(document.activeElement).toBe(buttonNamed(confirm, "Cancel"));
    expect((buttonNamed(confirm, "Close 2 tabs") as HTMLButtonElement).classList.contains("danger")).toBe(true);
    (buttonNamed(confirm, "Cancel") as HTMLButtonElement).click();
    await flush();
    expect(tabTitles(host)).toHaveLength(3);

    await rightClick(tabButton(host, "/work/a"));
    await pickMenuItem("Close other tabs");
    (buttonNamed(document.querySelector('[role="alertdialog"]') as HTMLElement, "Close 2 tabs") as HTMLButtonElement).click();
    await flush();

    expect(tabTitles(host)).toEqual(["/work/a"]);
  });

  it("reopens the last closed tab from the menu into its former group", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a", "/work/b"])] });
    (tabButton(host, "/work/b").closest(".tab")?.querySelector(".tab-close") as HTMLElement).click();
    await flush();
    expect(tabTitles(host)).toEqual(["/work/a", "/work/c"]);

    await rightClick(tabButton(host, "/work/c"));
    expect(menuItem("Reopen closed tab").getAttribute("aria-disabled")).toBeNull();
    await pickMenuItem("Reopen closed tab");

    const grouped = host.querySelector('[role="group"][aria-label="Corp A tab group"]') as HTMLElement;
    expect(tabTitles(grouped)).toEqual(["/work/a", "/work/b"]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title")).toBe("/work/b");
  });

  it("sets an alias from a popover prefilled with the current name, and shows it on the tab with the folder in the tooltip and description", async () => {
    const { host, calls } = await mountBar({ tabs: ["/work/api", "/work/b"] });

    await rightClick(tabButton(host, "/work/api"));
    await pickMenuItem("Alias tab…");
    const form = dialog("Alias api");
    const input = form.querySelector<HTMLInputElement>("input[type=text]") as HTMLInputElement;
    const save = buttonNamed(form, "Save alias") as HTMLButtonElement;

    expect(form.textContent).toContain("Name shown for /work/api");
    expect(input.value).toBe("api");
    type(input, "   ");
    await flush();
    expect(save.disabled).toBe(true);
    expect(form.textContent).toContain("Enter an alias");
    type(input, "x".repeat(41));
    await flush();
    expect(save.disabled).toBe(true);
    expect(form.textContent).toContain("An alias is at most 40 characters");
    type(input, "Corp A · API");
    await flush();
    save.click();
    await flush();

    const tab = tabButton(host, "/work/api");
    expect(tab.textContent?.replace(/\s+/g, " ").trim().startsWith("Corp A · API")).toBe(true);
    expect(tab.getAttribute("title")).toBe("/work/api");
    expect(tab.getAttribute("aria-description")).toBe("api");
    expect(tabButton(host, "/work/b").getAttribute("aria-description")).toBeNull();
    expect(dialog("Alias api")).toBeNull();
    expect(calls.filter((call) => call.cmd === "repo_alias_set").map((call) => call.args)).toEqual([{ path: "/work/api", alias: "Corp A · API" }]);
  });

  it("prefills the alias popover with the alias and offers Remove alias, which restores the folder name", async () => {
    const { host } = await mountBar({ tabs: ["/work/api"], aliases: [{ path: "/work/api", alias: "Corp A · API" }] });
    expect(tabButton(host, "/work/api").textContent).toContain("Corp A · API");

    await rightClick(tabButton(host, "/work/api"));
    await pickMenuItem("Alias tab…");
    expect((dialog("Alias Corp A · API").querySelector("input[type=text]") as HTMLInputElement).value).toBe("Corp A · API");
    dialog("Alias Corp A · API").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    await rightClick(tabButton(host, "/work/api"));
    expect(menuItems().map(flat)).toContain("Remove alias");
    await pickMenuItem("Remove alias");

    expect(tabButton(host, "/work/api").textContent?.trim().startsWith("api")).toBe(true);
    expect(tabButton(host, "/work/api").textContent).not.toContain("Corp A");
    expect(tabButton(host, "/work/api").getAttribute("aria-description")).toBeNull();
  });

  it("opens the alias editor when a tab name is double-clicked", async () => {
    const { host } = await mountBar({ tabs: ["/work/api"] });

    tabButton(host, "/work/api").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();

    expect(dialog("Alias api").textContent).toContain("Name shown for /work/api");
  });

  it("aliases a hidden tab from the collapsed group chip and shows the alias on the chip", async () => {
    const { host, calls } = await mountBar({
      tabs: ["/work/a", "/work/b", "/work/c"],
      groups: [group("Corp A", ["/work/a", "/work/b"], { collapsed: true })],
    });

    await rightClick(chip(host, "Corp A"));
    expect(menuItems().map(flat)).toEqual(["Move left", "Move right", "Rename…", "Alias a…", "Alias b…", "Color…Blue", "Ungroup", "Close group…"]);
    await pickMenuItem("Alias a…");
    const form = dialog("Alias a");
    type(form.querySelector("input[type=text]"), "API");
    await flush();
    (buttonNamed(form, "Save alias") as HTMLButtonElement).click();
    await flush();

    expect(flat(chip(host, "Corp A"))).toBe("Corp A · 2 tabs · API");
    expect(calls.filter((call) => call.cmd === "repo_alias_set").map((call) => call.args)).toEqual([{ path: "/work/a", alias: "API" }]);
  });

  it("keeps the alias popover open and says why when the alias could not be saved", async () => {
    const { host } = await mountBar({ tabs: ["/work/api"] });

    await rightClick(tabButton(host, "/work/api"));
    await pickMenuItem("Alias tab…");
    type(dialog("Alias api").querySelector("input[type=text]"), "refuse");
    await flush();
    (buttonNamed(dialog("Alias api"), "Save alias") as HTMLButtonElement).click();
    await flush();

    expect(dialog("Alias api").textContent).toContain("An alias is at most 40 characters");
    expect(tabButton(host, "/work/api").textContent).toContain("api");
  });

  it("says there are no groups yet on Add to group while none exists", async () => {
    const { host } = await mountBar({ tabs: ["/work/a"] });

    await rightClick(tabButton(host, "/work/a"));

    expect(menuItem("Add to group").getAttribute("aria-disabled")).toBe("true");
    expect(menuItem("Add to group").textContent).toContain("No groups yet");
  });

  it("creates a group from the new-group form with a name of 1 to 40 characters and one of ten named colors, and saves it", async () => {
    const { host, calls } = await mountBar({ tabs: ["/work/a", "/work/b"] });

    await rightClick(tabButton(host, "/work/b"));
    await pickMenuItem("Add to new group…");
    const form = dialog("New tab group");
    const create = buttonNamed(form, "Create group") as HTMLButtonElement;

    expect(form.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Group color");
    expect(radios(form).map((entry) => entry.closest("label")?.textContent?.trim())).toEqual(COLORS);
    expect(radioNamed(form, "Blue").checked).toBe(true);
    expect(create.disabled).toBe(true);
    expect(form.textContent).toContain("Enter a group name");

    type(form.querySelector("input[type=text]"), "x".repeat(41));
    await flush();
    expect(create.disabled).toBe(true);
    expect(form.textContent).toContain("A group name is at most 40 characters");

    type(form.querySelector("input[type=text]"), "Corp A");
    radioNamed(form, "Red").click();
    await flush();
    expect(create.disabled).toBe(false);
    create.click();
    await flush();

    const entry = chip(host, "Corp A");
    expect(entry.getAttribute("aria-expanded")).toBe("true");
    expect(entry.classList.contains("lane-5")).toBe(true);
    expect(dialog("New tab group")).toBeNull();
    const grouped = host.querySelector('[role="group"][aria-label="Corp A tab group"]') as HTMLElement;
    expect(tabTitles(grouped)).toEqual(["/work/b"]);
    expect(lastSession(calls)).toEqual({ session: { tabs: ["/work/a", "/work/b"], active: 0, groups: [{ name: "Corp A", color: "red", collapsed: false, tabs: ["/work/b"] }] } });
  });

  it("allows repeated group names", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b"], groups: [group("Same", ["/work/a"])] });

    await rightClick(tabButton(host, "/work/b"));
    await pickMenuItem("Add to new group…");
    type(dialog("New tab group").querySelector("input[type=text]"), "Same");
    await flush();
    (buttonNamed(dialog("New tab group"), "Create group") as HTMLButtonElement).click();
    await flush();

    expect([...host.querySelectorAll("button.gchip")].map((entry) => entry.textContent)).toEqual(["Same", "Same"]);
  });

  it("collapses a group to its chip, hides every member including the open repository, and expands it again", async () => {
    const { host, app, calls } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a", "/work/b"])] });
    const entry = chip(host, "Corp A");

    expect(entry.getAttribute("aria-expanded")).toBe("true");
    expect(entry.textContent).toBe("Corp A");
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b", "/work/c"]);

    entry.click();
    await flush();

    expect(entry.getAttribute("aria-expanded")).toBe("false");
    expect(entry.getAttribute("aria-current")).toBe("true");
    expect(flat(entry)).toBe("Corp A · 2 tabs · a");
    expect(tabTitles(host)).toEqual(["/work/c"]);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')).toBeNull();
    expect(app.activePath()).toBe("/work/a");
    expect(lastSession(calls)).toMatchObject({ session: { groups: [{ name: "Corp A", collapsed: true }] } });

    entry.click();
    await flush();

    expect(entry.getAttribute("aria-expanded")).toBe("true");
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b", "/work/c"]);
  });

  it("leaves a collapsed group as a count chip when the open repository is outside it, and expands the group a previous tab lands in", async () => {
    const { host, app } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], active: 2, groups: [group("Corp A", ["/work/a", "/work/b"], { collapsed: true })] });

    expect(flat(chip(host, "Corp A"))).toBe("Corp A · 2 tabs");
    expect(chip(host, "Corp A").getAttribute("aria-current")).toBeNull();
    expect(tabTitles(host)).toEqual(["/work/c"]);

    app.previousTab();
    await flush();

    expect(chip(host, "Corp A").getAttribute("aria-expanded")).toBe("true");
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b", "/work/c"]);
    expect(app.activePath()).toBe("/work/b");

    app.activate(2);
    await flush();
    chip(host, "Corp A").click();
    await flush();
    app.activate(1);
    await flush();

    expect(chip(host, "Corp A").getAttribute("aria-expanded")).toBe("true");
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b", "/work/c"]);
  });

  it("restores the saved groups with their color and collapsed state at launch", async () => {
    const { host } = await mountBar({
      tabs: ["/work/a", "/work/b", "/work/c"],
      groups: [group("Corp A", ["/work/a"], { color: "cyan" }), group("Personal", ["/work/b", "/work/c"], { color: "mint", collapsed: true })],
    });

    const chips = [...host.querySelectorAll<HTMLButtonElement>("button.gchip")];

    expect(chips.map((entry) => [flat(entry), entry.getAttribute("aria-expanded"), [...entry.classList].find((name) => name.startsWith("lane-"))])).toEqual([
      ["Corp A", "true", "lane-0"],
      ["Personal · 2 tabs", "false", "lane-9"],
    ]);
    expect(host.querySelector('[role="group"][aria-label="Personal tab group"]')).not.toBeNull();
  });

  it("adds a tab to an existing group at its end and removes it again right after the group, keeping groups contiguous", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a"])] });

    await rightClick(tabButton(host, "/work/c"));
    await pickMenuItem("Add to group");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Corp A");
    await pickMenuItem("Corp A");

    const grouped = () => host.querySelector('[role="group"][aria-label="Corp A tab group"]') as HTMLElement;
    expect(tabTitles(grouped())).toEqual(["/work/a", "/work/c"]);
    expect(tabTitles(host)).toEqual(["/work/a", "/work/c", "/work/b"]);

    await rightClick(tabButton(host, "/work/c"));
    await pickMenuItem("Remove from group");

    expect(tabTitles(grouped())).toEqual(["/work/a"]);
    expect(tabTitles(host)).toEqual(["/work/a", "/work/c", "/work/b"]);
  });

  it("moves a repository together with its worktree tabs when it joins a group", async () => {
    const { host } = await mountBar({
      tabs: ["/work/a", "/work/b", "/work/b-feature"],
      mains: { "/work/b-feature": "/work/b" },
      groups: [group("Corp A", ["/work/a"])],
    });

    await rightClick(tabButton(host, "/work/b-feature"));
    await pickMenuItem("Add to group");
    await pickMenuItem("Corp A");

    expect(tabTitles(host.querySelector('[role="group"][aria-label="Corp A tab group"]') as HTMLElement)).toEqual(["/work/a", "/work/b", "/work/b-feature"]);
    expect(host.querySelector('[role="group"][aria-label="b and its worktrees"]')).not.toBeNull();
  });

  it("deletes a group left without tabs when its last tab is closed", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b"], groups: [group("Corp A", ["/work/b"])] });

    (tabButton(host, "/work/b").closest(".tab")?.querySelector(".tab-close") as HTMLElement).click();
    await flush();

    expect(host.querySelector("button.gchip")).toBeNull();
  });

  it("renames a group from the chip menu with the same name rule", async () => {
    const { host, calls } = await mountBar({ tabs: ["/work/a"], groups: [group("Corp A", ["/work/a"])] });

    await rightClick(chip(host, "Corp A"));
    expect(menuItems().map(flat)).toEqual(["Move left", "Move right", "Rename…", "Color…Blue", "Ungroup", "Close group…"]);
    await pickMenuItem("Rename…");
    const form = dialog("Rename group");
    const input = form.querySelector<HTMLInputElement>("input[type=text]") as HTMLInputElement;
    const save = buttonNamed(form, "Rename") as HTMLButtonElement;

    expect(input.value).toBe("Corp A");
    type(input, "   ");
    await flush();
    expect(save.disabled).toBe(true);
    expect(form.textContent).toContain("Enter a group name");

    type(input, "Corp B");
    await flush();
    save.click();
    await flush();

    expect(chip(host, "Corp B")).toBeDefined();
    expect(dialog("Rename group")).toBeNull();
    expect(lastSession(calls)).toMatchObject({ session: { groups: [{ name: "Corp B", color: "blue" }] } });
  });

  it("recolors a group from the Color popover with the ten swatches", async () => {
    const { host, calls } = await mountBar({ tabs: ["/work/a"], groups: [group("Corp A", ["/work/a"])] });

    await shiftF10(chip(host, "Corp A"));
    await pickMenuItem("Color…");
    const picker = dialog("Group color");

    expect(radios(picker).map((entry) => entry.closest("label")?.textContent?.trim())).toEqual(COLORS);
    expect(radioNamed(picker, "Blue").checked).toBe(true);
    radioNamed(picker, "Orange").click();
    await flush();

    expect(chip(host, "Corp A").classList.contains("lane-6")).toBe(true);
    expect(dialog("Group color")).toBeNull();
    expect(lastSession(calls)).toMatchObject({ session: { groups: [{ name: "Corp A", color: "orange" }] } });
  });

  it("ungroups without closing any tab", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b"], groups: [group("Corp A", ["/work/a", "/work/b"])] });

    await rightClick(chip(host, "Corp A"));
    await pickMenuItem("Ungroup");

    expect(host.querySelector("button.gchip")).toBeNull();
    expect(tabTitles(host)).toEqual(["/work/a", "/work/b"]);
  });

  it("confirms Close group naming its tabs with a text-labelled danger button that is not focused, then closes the tabs", async () => {
    const { host, calls } = await mountBar({ tabs: ["/work/ledger", "/work/gateway", "/work/scratch"], groups: [group("Corp B", ["/work/ledger", "/work/gateway"], { color: "orange" })] });

    await rightClick(chip(host, "Corp B"));
    await pickMenuItem("Close group…");
    const confirm = document.querySelector('[role="alertdialog"]') as HTMLElement;

    expect(confirm.textContent).toContain("Close the Corp B group?");
    expect(confirm.textContent).toContain("ledger");
    expect(confirm.textContent).toContain("gateway");
    expect(confirm.textContent).toContain("Uncommitted changes stay on disk; the repositories stay in Recent.");
    expect((buttonNamed(confirm, "Close 2 tabs") as HTMLButtonElement).classList.contains("danger")).toBe(true);
    expect(document.activeElement).toBe(buttonNamed(confirm, "Cancel"));
    expect(tabTitles(host)).toHaveLength(3);

    (buttonNamed(confirm, "Cancel") as HTMLButtonElement).click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(tabTitles(host)).toHaveLength(3);

    await rightClick(chip(host, "Corp B"));
    await pickMenuItem("Close group…");
    (buttonNamed(document.querySelector('[role="alertdialog"]') as HTMLElement, "Close 2 tabs") as HTMLButtonElement).click();
    await flush();

    expect(tabTitles(host)).toEqual(["/work/scratch"]);
    expect(host.querySelector("button.gchip")).toBeNull();
    expect(lastSession(calls)).toEqual({ session: { tabs: ["/work/scratch"], active: 0, groups: [] } });
  });

  it("returns focus to the group chip after Close group is cancelled with Escape or the button, and to the active tab once the confirmed close removed the chip", async () => {
    const { host } = await mountBar({ tabs: ["/work/ledger", "/work/gateway", "/work/scratch"], groups: [group("Corp B", ["/work/ledger", "/work/gateway"], { color: "orange" })], active: 2 });

    await rightClick(chip(host, "Corp B"));
    await pickMenuItem("Close group…");
    (document.querySelector('[role="alertdialog"]') as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(chip(host, "Corp B"));

    await rightClick(chip(host, "Corp B"));
    await pickMenuItem("Close group…");
    (buttonNamed(document.querySelector('[role="alertdialog"]') as HTMLElement, "Cancel") as HTMLButtonElement).click();
    await flush();
    expect(document.activeElement).toBe(chip(host, "Corp B"));

    await rightClick(chip(host, "Corp B"));
    await pickMenuItem("Close group…");
    (buttonNamed(document.querySelector('[role="alertdialog"]') as HTMLElement, "Close 2 tabs") as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector("button.gchip")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[role="tab"][aria-selected="true"]'));
  });

  it("shows the save-failure alert with Try again and removes it when the retry saves", async () => {
    let failing = false;
    const { host, calls } = await mountBar({ tabs: ["/work/a"], groups: [group("Corp A", ["/work/a"])], failSave: () => failing });
    expect(host.querySelector('[role="alert"]')).toBeNull();

    failing = true;
    chip(host, "Corp A").click();
    await flush();
    const alert = host.querySelector('[role="alert"]') as HTMLElement;

    expect(alert.textContent).toContain("The tab groups could not be saved");
    expect(alert.textContent).toContain("disk full");
    expect(alert.textContent).toContain("Your tabs and groups stay as they are now; after a restart they return to the last saved state.");
    expect(chip(host, "Corp A").getAttribute("aria-expanded")).toBe("false");

    failing = false;
    const before = calls.filter((call) => call.cmd === "session_save").length;
    (buttonNamed(alert, "Try again") as HTMLButtonElement).click();
    await flush();

    expect(calls.filter((call) => call.cmd === "session_save").length).toBe(before + 1);
    expect(lastSession(calls)).toMatchObject({ session: { groups: [{ name: "Corp A", collapsed: true }] } });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  async function dropOn(source: HTMLElement, target: HTMLElement, x: number) {
    target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 24, right: 100, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const previous = document.elementFromPoint;
    document.elementFromPoint = () => target;
    source.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 0, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: 8, button: 0 }));
    document.elementFromPoint = previous;
    await flush();
  }

  it("reorders a loose tab onto another without creating a group", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"] });

    await dropOn(tabButton(host, "/work/c"), host.querySelector<HTMLElement>("[data-tab-index='0']") as HTMLElement, 10);

    expect(tabTitles(host)).toEqual(["/work/c", "/work/a", "/work/b"]);
    expect(host.querySelector("button.gchip")).toBeNull();
  });

  it("adds a tab dropped on a chip and removes a member dropped outside the group", async () => {
    const added = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a"])] });

    await dropOn(tabButton(added.host, "/work/c"), chip(added.host, "Corp A"), 20);

    expect(tabTitles(added.host.querySelector("[aria-label='Corp A tab group']") as HTMLElement)).toEqual(["/work/a", "/work/c"]);
    dispose?.();
    await flush();

    const removed = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a", "/work/b"])] });
    await dropOn(tabButton(removed.host, "/work/b"), removed.host.querySelector<HTMLElement>("[data-tab-index='2']") as HTMLElement, 80);

    expect(removed.app.tabs().groups[0]?.tabs).toEqual(["/work/a"]);
    expect(removed.app.tabs().tabs.flatMap((tab) => (tab.kind === "repo" ? [tab.path] : []))).toEqual(["/work/a", "/work/c", "/work/b"]);
  });

  it("moves a collapsed group and its hidden members together, and refuses to nest groups", async () => {
    const { host, app } = await mountBar({
      tabs: ["/work/a", "/work/b", "/work/c"],
      groups: [group("Corp A", ["/work/a", "/work/b"], { collapsed: true })],
    });

    await dropOn(chip(host, "Corp A"), host.querySelector<HTMLElement>("[data-tab-index='2']") as HTMLElement, 80);

    expect(app.tabs().tabs.flatMap((tab) => (tab.kind === "repo" ? [tab.path] : []))).toEqual(["/work/c", "/work/a", "/work/b"]);
    expect(app.tabs().groups[0]?.tabs).toEqual(["/work/a", "/work/b"]);
    expect(app.tabs().groups[0]?.collapsed).toBe(true);
    dispose?.();
    await flush();

    const nested = await mountBar({
      tabs: ["/work/a", "/work/b"],
      groups: [group("One", ["/work/a"]), group("Two", ["/work/b"])],
    });
    const before = nested.app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : ""));
    await dropOn(chip(nested.host, "One"), chip(nested.host, "Two"), 20);

    expect(nested.app.notice()).toBe(GROUPS_CANNOT_NEST);
    expect(nested.app.tabs().tabs.map((tab) => (tab.kind === "repo" ? tab.path : ""))).toEqual(before);
  });

  it("moves a tab left from its menu and a group right from the chip menu", async () => {
    const { host } = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"] });

    await rightClick(tabButton(host, "/work/b"));
    await pickMenuItem("Move left");

    expect(tabTitles(host)).toEqual(["/work/b", "/work/a", "/work/c"]);
    dispose?.();
    await flush();

    const grouped = await mountBar({ tabs: ["/work/a", "/work/b", "/work/c"], groups: [group("Corp A", ["/work/a", "/work/b"])] });
    await rightClick(chip(grouped.host, "Corp A"));
    await pickMenuItem("Move right");

    expect(grouped.app.tabs().tabs.flatMap((tab) => (tab.kind === "repo" ? [tab.path] : []))).toEqual(["/work/c", "/work/a", "/work/b"]);
    expect(grouped.app.tabs().groups[0]?.tabs).toEqual(["/work/a", "/work/b"]);
  });
});

describe("tab bar and the Launchpad", () => {
  it("does not mark the active repository tab as current while the Launchpad is open", async () => {
    const { host, app } = await mountBar({ tabs: ["/work/sample"] });
    expect(tabButton(host, "/work/sample").getAttribute("aria-selected")).toBe("true");

    app.openLaunchpad();
    await flush(60);

    expect(app.launchpadOpen()).toBe(true);
    expect(tabButton(host, "/work/sample").getAttribute("aria-selected")).toBe("false");
    expect(host.querySelector(".tab.active")).toBeNull();
    expect(host.querySelector('button[aria-label="Launchpad"]')?.getAttribute("aria-current")).toBe("page");

    host.querySelector<HTMLButtonElement>('button[aria-label="Launchpad"]')?.click();
    await flush(60);

    expect(app.launchpadOpen()).toBe(false);
    expect(tabButton(host, "/work/sample").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Launchpad tooltip names the active profile (S60)", () => {
  const launchpad = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[aria-label="Launchpad"]');

  it("names the active profile in the tooltip and keeps the accessible name Launchpad", async () => {
    const profiles: ProfileList = {
      active: "work",
      profiles: [
        { id: "default", name: "Default", author_name: "Yui", author_email: "yui@example.test" },
        { id: "work", name: "Work", author_name: "Yui Lin", author_email: "yui@work.test" },
      ],
    };

    const { host } = await mountBar({ profiles });

    expect(launchpad(host)?.getAttribute("data-tip")).toBe("Launchpad · profile Work");
    expect(launchpad(host)?.getAttribute("aria-label")).toBe("Launchpad");
  });

  it("shows the plain tooltip while no profile is known", async () => {
    const { host } = await mountBar({});

    expect(launchpad(host)?.getAttribute("data-tip")).toBe("Launchpad");
  });
});

describe("theme toggle", () => {
  const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Toggle theme"]');

  it("saves the other theme", async () => {
    const { host, calls } = await mountBar({});

    toggle(host)?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "settings_save").map((call) => (call.args.settings as { theme: string }).theme)).toEqual(["dark"]);
  });

  it("reports the refusal in the shell notice when the theme cannot be saved", async () => {
    const { host, app } = await mountBar({ failSettings: () => true });
    expect(app.notice()).toBeUndefined();

    toggle(host)?.click();
    await flush();

    expect(app.notice()).toBe("Settings could not be written: disk full");
  });
});

describe("tab bar with many tabs (S45)", () => {
  const many = Array.from({ length: 50 }, (_, index) => `/work/repository-${String(index).padStart(2, "0")}`);

  it("keeps New tab, Launchpad, Activity, Theme, and Settings outside the scrolling tab list", async () => {
    const { host } = await mountBar({ tabs: many });

    const list = host.querySelector(".tab-scroll") as HTMLElement;

    expect(list.querySelectorAll('[role="tab"]')).toHaveLength(50);
    for (const name of ["New tab", "Launchpad", "Activity", "Toggle theme", "Settings"]) {
      const control = host.querySelector(`button[aria-label="${name}"]`) as HTMLElement;
      expect(control, name).not.toBeNull();
      expect(list.contains(control), name).toBe(false);
    }
  });

  it("puts each tab's name in a truncating label and keeps the full path in the tooltip", async () => {
    const { host } = await mountBar({ tabs: many });

    const first = host.querySelector('[role="tab"]') as HTMLElement;

    expect(first.querySelector(".tab-label")?.textContent).toBe("repository-00");
    expect(first.getAttribute("title")).toBe("/work/repository-00");
  });

  it("brings the active tab into view when it changes", async () => {
    const seen: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      seen.push(this);
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const { host, app } = await mountBar({ tabs: many });
    seen.length = 0;

    app.activate(40);
    await flush();

    expect(seen.at(-1)).toBe(host.querySelectorAll('[role="tab"]')[40]?.closest(".tab"));
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  it("brings the active tab back into view when its worktree count widens it", async () => {
    const seen: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: Element) {
        seen.push(this);
      },
    });
    const [count, setCount] = createSignal<number | undefined>(undefined);
    const { host } = await mountBar({ tabs: many, active: 49, count });
    seen.length = 0;

    setCount(2);
    await flush();

    expect(seen.at(-1)).toBe(host.querySelectorAll('[role="tab"]')[49]?.closest(".tab"));
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });
});
