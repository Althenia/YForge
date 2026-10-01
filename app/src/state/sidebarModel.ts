import type { RepoUiPrefs } from "../ipc/bindings/RepoUiPrefs";
import type { MenuEntry } from "./refMenu";
import { toggleFolder } from "./repoUiPrefs";

export type SectionId = "branches" | "remotes" | "tags" | "stashes" | "worktrees" | "pulls" | "issues" | "recovery";

export type BulkGroup = "branches" | "remotes" | "tags" | "stashes" | "worktrees";

export type RowSelection = { group: BulkGroup; ids: readonly string[]; anchor: string };

const sectionKey = (id: SectionId): string => `@section:${id}`;

export const isSectionOpen = (prefs: RepoUiPrefs, id: SectionId): boolean => !prefs.collapsed_folders.includes(sectionKey(id));

export const toggleSection = (prefs: RepoUiPrefs, id: SectionId): RepoUiPrefs => toggleFolder(prefs, sectionKey(id));

export const matchesFilter = (query: string, ...texts: readonly string[]): boolean => {
  const needle = query.toLowerCase();
  return needle === "" || texts.some((text) => text.toLowerCase().includes(needle));
};

export const countLabel = (total: number, matched: number, filtering: boolean): string => (filtering ? `${matched}/${total}` : String(total));

export const selectedIn = (current: RowSelection | undefined, group: BulkGroup): readonly string[] => (current?.group === group ? current.ids : []);

export const selectOnly = (group: BulkGroup, id: string): RowSelection => ({ group, ids: [id], anchor: id });

export function toggleRow(current: RowSelection | undefined, group: BulkGroup, id: string): RowSelection | undefined {
  const chosen = selectedIn(current, group);
  if (!chosen.includes(id)) return { group, ids: [...chosen, id], anchor: id };
  const remaining = chosen.filter((entry) => entry !== id);
  return remaining.length === 0 ? undefined : { group, ids: remaining, anchor: id };
}

export function extendRange(current: RowSelection | undefined, group: BulkGroup, order: readonly string[], id: string): RowSelection {
  const anchor = current?.group === group ? current.anchor : id;
  const to = order.indexOf(id);
  const from = order.includes(anchor) ? order.indexOf(anchor) : to;
  return { group, ids: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: order.includes(anchor) ? anchor : id };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function bulkMenu(group: BulkGroup, count: number, disabledReason?: string): MenuEntry[] {
  const reason = disabledReason === undefined ? {} : { disabledReason };
  switch (group) {
    case "branches":
      return [{ kind: "item", id: "delete", label: [`Delete ${plural(count, "branch", "branches")}…`], icon: "trash", danger: true, ...reason }];
    case "tags":
      return [{ kind: "item", id: "delete", label: [`Delete ${plural(count, "tag", "tags")}…`], icon: "trash", danger: true, ...reason }];
    case "remotes":
      return [{ kind: "item", id: "fetch", label: [`Fetch ${plural(count, "remote", "remotes")}`], icon: "fetch", note: "fetches every remote", ...reason }];
    case "stashes":
      return [{ kind: "item", id: "drop", label: [`Drop ${plural(count, "stash", "stashes")}…`], icon: "trash", danger: true, ...reason }];
    case "worktrees":
      return [{ kind: "item", id: "remove", label: [`Remove ${plural(count, "worktree", "worktrees")}…`], icon: "trash", danger: true, ...reason }];
  }
}
