import { describe, expect, it } from "vitest";
import type { MenuEntry } from "./refMenu";
import { SHORTCUTS } from "./shortcuts";
import { tabMenuEntries, type TabMenuContext } from "./tabMenu";
import type { UserGroup } from "./tabs";

const group = (name: string, tabs: string[]): UserGroup => ({ name, color: "blue", collapsed: false, tabs });

const context = (overrides: Partial<TabMenuContext> = {}): TabMenuContext => ({ groups: [], path: "/a", others: 2, right: 1, aliased: false, canReopen: true, canMoveLeft: true, canMoveRight: true, ...overrides });

const summary = (entries: MenuEntry[]) => entries.map((entry) => (entry.kind === "separator" ? "-" : [entry.id, entry.disabledReason ?? null, entry.shortcut ?? null]));

describe("tab context menu entries", () => {
  it("lists Close tab, the close-others items, the group items, Alias tab…, and Reopen closed tab in that order", () => {
    expect(summary(tabMenuEntries(context()))).toEqual([
      ["close-tab", null, SHORTCUTS.closeTab],
      ["close-others", null, null],
      ["close-right", null, null],
      "-",
      ["move-left", null, null],
      ["move-right", null, null],
      ["new-group", null, null],
      ["add-to-group", "No groups yet", null],
      "-",
      ["alias", null, null],
      "-",
      ["reopen-tab", null, SHORTCUTS.reopenClosedTab],
    ]);
  });

  it("keeps the items that cannot act and gives each its reason", () => {
    const entries = tabMenuEntries(context({ others: 0, right: 0, canReopen: false }));

    expect(summary(entries).filter((row) => row !== "-" && row[1] !== null)).toEqual([
      ["close-others", "No other tabs", null],
      ["close-right", "No tabs to the right", null],
      ["add-to-group", "No groups yet", null],
      ["reopen-tab", "No closed tabs", SHORTCUTS.reopenClosedTab],
    ]);
  });

  it("keeps Move left and Move right visible when the tab cannot move", () => {
    const entries = tabMenuEntries(context({ canMoveLeft: false, canMoveRight: false }));

    expect(summary(entries).filter((row) => row !== "-" && (row[0] === "move-left" || row[0] === "move-right"))).toEqual([
      ["move-left", "This tab is already first", null],
      ["move-right", "This tab is already last", null],
    ]);
  });

  it("offers Remove from group on a grouped tab and counts only the other groups for Add to group", () => {
    const own = summary(tabMenuEntries(context({ groups: [group("A", ["/a"])] })));
    const other = summary(tabMenuEntries(context({ groups: [group("A", ["/a"]), group("B", ["/b"])] })));

    expect(own).toContainEqual(["remove-from-group", null, null]);
    expect(own).toContainEqual(["add-to-group", "No other groups", null]);
    expect(other).toContainEqual(["add-to-group", null, null]);
    expect(summary(tabMenuEntries(context({ groups: [group("A", ["/b"])] })))).not.toContainEqual(["remove-from-group", null, null]);
  });

  it("offers Remove alias next to Alias tab… when the repository has an alias", () => {
    const ids = (aliased: boolean) => tabMenuEntries(context({ aliased })).flatMap((entry) => (entry.kind === "item" ? [entry.id] : []));

    expect(ids(false)).not.toContain("remove-alias");
    expect(ids(true).slice(ids(true).indexOf("alias"), ids(true).indexOf("alias") + 2)).toEqual(["alias", "remove-alias"]);
  });
});
