import { NO_CLOSED_TABS } from "./palette";
import type { MenuEntry } from "./refMenu";
import { SHORTCUTS } from "./shortcuts";
import type { UserGroup } from "./tabs";

export type TabMenuAction = "close-tab" | "close-others" | "close-right" | "move-left" | "move-right" | "new-group" | "add-to-group" | "remove-from-group" | "alias" | "remove-alias" | "reopen-tab";

export type TabMenuContext = { groups: readonly UserGroup[]; path: string; others: number; right: number; aliased: boolean; canReopen: boolean; canMoveLeft: boolean; canMoveRight: boolean };

export const TAB_ALREADY_FIRST = "This tab is already first";

export const TAB_ALREADY_LAST = "This tab is already last";

type Item = Extract<MenuEntry, { kind: "item" }>;

const item = (id: TabMenuAction, label: string, extra: Partial<Item> = {}): MenuEntry => ({ kind: "item", id, label: [label], ...extra });

const unless = (reason: string, available: boolean): Partial<Item> => (available ? {} : { disabledReason: reason });

const separator: MenuEntry = { kind: "separator" };

export function tabMenuEntries(context: TabMenuContext): MenuEntry[] {
  const own = context.groups.findIndex((group) => group.tabs.includes(context.path));
  const others = context.groups.length - (own >= 0 ? 1 : 0);
  const noGroups = context.groups.length === 0 ? "No groups yet" : "No other groups";
  return [
    item("close-tab", "Close tab", { icon: "close", shortcut: SHORTCUTS.closeTab }),
    item("close-others", "Close other tabs", { icon: "close", ...unless("No other tabs", context.others > 0) }),
    item("close-right", "Close tabs to the right", { icon: "close", ...unless("No tabs to the right", context.right > 0) }),
    separator,
    item("move-left", "Move left", { icon: "previous", ...unless(TAB_ALREADY_FIRST, context.canMoveLeft) }),
    item("move-right", "Move right", { icon: "next", ...unless(TAB_ALREADY_LAST, context.canMoveRight) }),
    item("new-group", "Add to new group…", { icon: "plus" }),
    item("add-to-group", "Add to group", { icon: "folder", ...(others > 0 ? {} : { note: noGroups, disabledReason: noGroups }) }),
    ...(own >= 0 ? [item("remove-from-group", "Remove from group", { icon: "minus" })] : []),
    separator,
    item("alias", "Alias tab…", { icon: "edit" }),
    ...(context.aliased ? [item("remove-alias", "Remove alias", { icon: "undo" })] : []),
    separator,
    item("reopen-tab", "Reopen closed tab", { icon: "sync", shortcut: SHORTCUTS.reopenClosedTab, ...unless(NO_CLOSED_TABS, context.canReopen) }),
  ];
}
