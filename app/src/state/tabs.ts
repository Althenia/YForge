import type { TabGroup as UserGroup } from "../ipc/bindings/TabGroup";
import type { TabGroupColor } from "../ipc/bindings/TabGroupColor";
import type { TabSession } from "../ipc/bindings/TabSession";
import { basename } from "../format";

export type { UserGroup };

export type Tab = { kind: "repo"; path: string } | { kind: "launcher" };

export type TabsState = { tabs: Tab[]; active: number; groups: UserGroup[] };

export const GROUP_NAME_LIMIT = 40;

const launcher: Tab = { kind: "launcher" };

const isRepo = (tab: Tab, path: string): boolean => tab.kind === "repo" && tab.path === path;

const pathOf = (tab: Tab): string | undefined => (tab.kind === "repo" ? tab.path : undefined);

function revealTab(groups: UserGroup[], tab: Tab | undefined): UserGroup[] {
  const path = tab === undefined ? undefined : pathOf(tab);
  if (path === undefined || !groups.some((entry) => entry.collapsed && entry.tabs.includes(path))) return groups;
  return groups.map((entry) => (entry.tabs.includes(path) ? { ...entry, collapsed: false } : entry));
}

export function openRepoTab(state: TabsState, path: string): TabsState {
  const existing = state.tabs.findIndex((tab) => isRepo(tab, path));
  if (existing >= 0) return { ...state, active: existing, groups: revealTab(state.groups, state.tabs[existing]) };
  const replaced = state.tabs[state.active]?.kind === "launcher" ? state.active : -1;
  if (replaced >= 0) return { ...state, tabs: state.tabs.map((tab, index) => (index === replaced ? { kind: "repo", path } : tab)), active: replaced };
  return { ...state, tabs: [...state.tabs, { kind: "repo", path }], active: state.tabs.length };
}

export function openLauncherTab(state: TabsState): TabsState {
  const existing = state.tabs.findIndex((tab) => tab.kind === "launcher");
  if (existing >= 0) return { ...state, active: existing };
  return { ...state, tabs: [...state.tabs, launcher], active: state.tabs.length };
}

function withoutTabs(groups: UserGroup[], tabs: Tab[]): UserGroup[] {
  const open = new Set(tabs.flatMap((tab) => pathOf(tab) ?? []));
  return groups.map((entry) => ({ ...entry, tabs: entry.tabs.filter((path) => open.has(path)) })).filter((entry) => entry.tabs.length > 0);
}

export function closeTab(state: TabsState, index: number): TabsState {
  const tabs = state.tabs.filter((_, position) => position !== index);
  if (tabs.length === 0) return { tabs: [launcher], active: 0, groups: [] };
  const active = index < state.active ? state.active - 1 : Math.min(state.active, tabs.length - 1);
  return { tabs, active: index === state.active ? Math.min(index, tabs.length - 1) : active, groups: withoutTabs(state.groups, tabs) };
}

export function activateTab(state: TabsState, index: number): TabsState {
  return index >= 0 && index < state.tabs.length ? { ...state, active: index, groups: revealTab(state.groups, state.tabs[index]) } : state;
}

export const LAUNCHER_TAB_ID = "launcher";

export const tabId = (tab: Tab): string => (tab.kind === "repo" ? tab.path : LAUNCHER_TAB_ID);

export type Aliases = Readonly<Record<string, string>>;

export const ALIAS_LIMIT = 40;

export const repoName = (path: string, aliases: Aliases = {}): string => aliases[path] ?? basename(path);

export function tabLabel(tab: Tab, aliases: Aliases = {}): string {
  return tab.kind === "launcher" ? "New tab" : repoName(tab.path, aliases);
}

export function aliasProblem(alias: string): string | undefined {
  if (alias.trim() === "") return "Enter an alias";
  return [...alias.trim()].length > ALIAS_LIMIT ? `An alias is at most ${ALIAS_LIMIT} characters` : undefined;
}

export function sessionOf(state: TabsState): TabSession {
  const repos = state.tabs.filter((tab): tab is Extract<Tab, { kind: "repo" }> => tab.kind === "repo");
  const current = state.tabs[state.active];
  const active = current?.kind === "repo" ? repos.findIndex((tab) => tab.path === current.path) : repos.length - 1;
  return { tabs: repos.map((tab) => tab.path), active: Math.max(active, 0), groups: state.groups.map((entry) => ({ ...entry, tabs: [...entry.tabs] })) };
}

export function restoreTabs(session: TabSession, launchPath: string | undefined): TabsState {
  let state: TabsState = { tabs: session.tabs.map((path): Tab => ({ kind: "repo", path })), active: session.active, groups: session.groups };
  if (state.tabs.length === 0) state = { tabs: [launcher], active: 0, groups: [] };
  else state = { ...state, active: Math.min(session.active, state.tabs.length - 1) };
  return launchPath === undefined ? state : openRepoTab(state, launchPath);
}

export type MainRoots = Readonly<Record<string, string>>;

export type TabCluster = { main: string; tabs: Array<{ tab: Tab; index: number; linked: boolean }> };

const mainOf = (path: string, mains: MainRoots): string => mains[path] ?? path;

const groupKey = (tab: Tab, mains: MainRoots): string => (tab.kind === "repo" ? mainOf(tab.path, mains) : LAUNCHER_TAB_ID);

const firstSeen = (keys: string[]): Map<string, number> => {
  const seen = new Map<string, number>();
  keys.forEach((key) => seen.has(key) || seen.set(key, seen.size));
  return seen;
};

function withTabs(state: TabsState, tabs: Tab[], groups: UserGroup[]): TabsState {
  return { tabs, active: Math.max(tabs.indexOf(state.tabs[state.active] as Tab), 0), groups };
}

export function groupTabs(state: TabsState, mains: MainRoots): TabsState {
  const clusterOf = state.tabs.map((tab) => groupKey(tab, mains));
  const groupOfCluster = new Map<string, number>();
  state.tabs.forEach((tab, position) => {
    const path = pathOf(tab);
    const owner = path === undefined ? -1 : state.groups.findIndex((entry) => entry.tabs.includes(path));
    const key = clusterOf[position] as string;
    if (owner >= 0 && !groupOfCluster.has(key)) groupOfCluster.set(key, owner);
  });
  const unitOf = clusterOf.map((key) => (groupOfCluster.has(key) ? `group:${groupOfCluster.get(key)}` : `cluster:${key}`));
  const unitRank = firstSeen(unitOf);
  const clusterRank = firstSeen(clusterOf);
  const order = state.tabs
    .map((tab, position) => ({ tab, unit: unitOf[position] as string, rank: [unitRank.get(unitOf[position] as string) as number, clusterRank.get(clusterOf[position] as string) as number, position] as const }))
    .sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.rank[2] - right.rank[2]);
  const groups = [...unitRank.keys()].flatMap((unit) => {
    const index = unit.startsWith("group:") ? Number(unit.slice("group:".length)) : -1;
    const entry = state.groups[index];
    return entry === undefined ? [] : [{ ...entry, tabs: order.filter((item) => item.unit === unit).flatMap((item) => pathOf(item.tab) ?? []) }];
  });
  return withTabs(state, order.map((item) => item.tab), groups);
}

export function tabGroups(state: TabsState, mains: MainRoots): TabCluster[] {
  const clusters = new Map<string, TabCluster>();
  state.tabs.forEach((tab, index) => {
    const key = groupKey(tab, mains);
    const cluster = clusters.get(key) ?? { main: key, tabs: [] };
    cluster.tabs.push({ tab, index, linked: tab.kind === "repo" && mainOf(tab.path, mains) !== tab.path });
    clusters.set(key, cluster);
  });
  return [...clusters.values()];
}

export type SegmentTab = TabCluster["tabs"][number] & { hidden: boolean };

export type SegmentCluster = { main: string; tabs: SegmentTab[] };

export type TabSegment = { kind: "cluster"; cluster: SegmentCluster } | { kind: "group"; index: number; group: UserGroup; clusters: SegmentCluster[] };

export function tabSegments(state: TabsState, mains: MainRoots): TabSegment[] {
  const visible = (cluster: TabCluster, collapsed: boolean): SegmentCluster => ({
    main: cluster.main,
    tabs: cluster.tabs.map((entry) => ({ ...entry, hidden: collapsed })),
  });
  const segments: TabSegment[] = [];
  for (const cluster of tabGroups(state, mains)) {
    const first = cluster.tabs[0]?.tab;
    const path = first === undefined ? undefined : pathOf(first);
    const index = path === undefined ? -1 : state.groups.findIndex((entry) => entry.tabs.includes(path));
    const group = state.groups[index];
    const open = segments.at(-1);
    if (group === undefined) segments.push({ kind: "cluster", cluster: visible(cluster, false) });
    else if (open?.kind === "group" && open.index === index) open.clusters.push(visible(cluster, group.collapsed));
    else segments.push({ kind: "group", index, group, clusters: [visible(cluster, group.collapsed)] });
  }
  return segments;
}

export function groupNameProblem(name: string): string | undefined {
  if (name.trim() === "") return "Enter a group name";
  return [...name.trim()].length > GROUP_NAME_LIMIT ? `A group name is at most ${GROUP_NAME_LIMIT} characters` : undefined;
}

const clusterPaths = (state: TabsState, mains: MainRoots, path: string): Set<string> => {
  const key = mainOf(path, mains);
  return new Set(state.tabs.flatMap((tab) => (tab.kind === "repo" && mainOf(tab.path, mains) === key ? tab.path : [])));
};

function moveAfterGroup(state: TabsState, moving: Set<string>, group: UserGroup | undefined): Tab[] {
  const moved = state.tabs.filter((tab) => tab.kind === "repo" && moving.has(tab.path));
  const rest = state.tabs.filter((tab) => !moved.includes(tab));
  const anchor = group === undefined ? -1 : rest.findLastIndex((tab) => tab.kind === "repo" && group.tabs.includes(tab.path));
  return anchor < 0 ? state.tabs : [...rest.slice(0, anchor + 1), ...moved, ...rest.slice(anchor + 1)];
}

function leaveGroups(groups: UserGroup[], moving: Set<string>): UserGroup[] {
  return groups.map((entry) => ({ ...entry, tabs: entry.tabs.filter((path) => !moving.has(path)) }));
}

const groupIndexOf = (state: TabsState, path: string): number => state.groups.findIndex((entry) => entry.tabs.includes(path));

export function addToGroup(state: TabsState, mains: MainRoots, path: string, index: number): TabsState {
  const target = state.groups[index];
  if (target === undefined) return state;
  const moving = clusterPaths(state, mains, path);
  const others = { ...state, groups: leaveGroups(state.groups, moving) };
  const tabs = moveAfterGroup(others, moving, others.groups[index]);
  const groups = others.groups.map((entry, position) => (position === index ? { ...entry, tabs: [...entry.tabs, ...tabs.flatMap((tab) => (tab.kind === "repo" && moving.has(tab.path) ? tab.path : []))] } : entry));
  return groupTabs(withTabs(state, tabs, groups.filter((entry) => entry.tabs.length > 0)), mains);
}

export function removeFromGroup(state: TabsState, mains: MainRoots, path: string): TabsState {
  const index = groupIndexOf(state, path);
  if (index < 0) return state;
  const moving = clusterPaths(state, mains, path);
  const groups = leaveGroups(state.groups, moving);
  return groupTabs(withTabs(state, moveAfterGroup({ ...state, groups }, moving, groups[index]), groups.filter((entry) => entry.tabs.length > 0)), mains);
}

export const GROUPS_CANNOT_NEST = "Groups cannot nest.";

export type TabDragSource = { kind: "tab"; path: string } | { kind: "group"; index: number };

export type TabDragHit = { kind: "before"; index: number } | { kind: "end" } | { kind: "group"; index: number };

export type TabDragResult =
  | { kind: "place-tab"; path: string; before: number }
  | { kind: "place-group"; index: number; before: number }
  | { kind: "add"; path: string; group: number }
  | { kind: "refuse"; reason: string }
  | { kind: "none" };

type Span = { start: number; end: number };

const inMoving = (tab: Tab, moving: Set<string>): boolean => {
  const path = pathOf(tab);
  return path !== undefined && moving.has(path);
};

function indexesOf(tabs: readonly Tab[], moving: Set<string>): number[] {
  return tabs.flatMap((tab, index) => (inMoving(tab, moving) ? [index] : []));
}

function spanOf(indexes: readonly number[]): Span | undefined {
  const start = indexes[0];
  const last = indexes.at(-1);
  return start === undefined || last === undefined ? undefined : { start, end: last + 1 };
}

function extract(tabs: readonly Tab[], moving: Set<string>): { block: Tab[]; rest: Tab[] } {
  return {
    block: tabs.filter((tab) => inMoving(tab, moving)),
    rest: tabs.filter((tab) => !inMoving(tab, moving)),
  };
}

function restIndex(tabs: readonly Tab[], moving: Set<string>, before: number): number {
  return tabs.slice(0, Math.max(0, before)).filter((tab) => !inMoving(tab, moving)).length;
}

function insertBlock(rest: readonly Tab[], at: number, block: readonly Tab[]): Tab[] {
  const index = Math.max(0, Math.min(rest.length, at));
  return [...rest.slice(0, index), ...block, ...rest.slice(index)];
}

function sameState(left: TabsState, right: TabsState): boolean {
  const sameTab = (tab: Tab, index: number) => pathOf(tab) === pathOf(right.tabs[index] as Tab) && tab.kind === right.tabs[index]?.kind;
  return left.active === right.active && left.tabs.length === right.tabs.length && left.tabs.every(sameTab) && JSON.stringify(left.groups) === JSON.stringify(right.groups);
}

/** Moves a repository and its worktree tabs to sit before `before`. Landing beside a group does not join it. A grouped tab leaves its group only when other members stay and the place is outside them. */
export function placeTab(state: TabsState, mains: MainRoots, path: string, before: number): TabsState {
  const moving = clusterPaths(state, mains, path);
  if (indexesOf(state.tabs, moving).length === 0) return state;
  const owner = groupIndexOf(state, path);
  const { block, rest } = extract(state.tabs, moving);
  const at = restIndex(state.tabs, moving, before);
  const nextTabs = insertBlock(rest, at, block);
  let groups = state.groups;
  if (owner >= 0) {
    const remaining = spanOf(indexesOf(rest, new Set(groups[owner]?.tabs ?? [])));
    const stays = remaining === undefined || (at >= remaining.start && at <= remaining.end);
    if (!stays) groups = leaveGroups(groups, moving).filter((entry) => entry.tabs.length > 0);
  }
  return groupTabs(withTabs(state, nextTabs, groups), mains);
}

/** Moves a whole group, hidden members included, to sit before `before`. Membership stays; groups do not nest. */
export function placeGroup(state: TabsState, mains: MainRoots, index: number, before: number): TabsState {
  const group = state.groups[index];
  if (group === undefined) return state;
  const moving = new Set(group.tabs);
  const { block, rest } = extract(state.tabs, moving);
  if (block.length === 0) return state;
  return groupTabs(withTabs(state, insertBlock(rest, restIndex(state.tabs, moving, before), block), state.groups), mains);
}

function unitAt(state: TabsState, mains: MainRoots, index: number): string {
  const tab = state.tabs[index];
  if (tab === undefined) return `missing:${index}`;
  const path = pathOf(tab);
  if (path !== undefined) {
    const owner = groupIndexOf(state, path);
    if (owner >= 0) return `group:${owner}`;
  }
  return `cluster:${groupKey(tab, mains)}`;
}

function unitSpan(state: TabsState, mains: MainRoots, index: number): Span {
  const key = unitAt(state, mains, index);
  let start = index;
  let end = index + 1;
  while (start > 0 && unitAt(state, mains, start - 1) === key) start -= 1;
  while (end < state.tabs.length && unitAt(state, mains, end) === key) end += 1;
  return { start, end };
}

export function moveTabStep(state: TabsState, mains: MainRoots, path: string, direction: -1 | 1): TabsState {
  const span = spanOf(indexesOf(state.tabs, clusterPaths(state, mains, path)));
  if (span === undefined) return state;
  if (direction < 0) return span.start === 0 ? state : placeTab(state, mains, path, span.start - 1);
  return span.end >= state.tabs.length ? state : placeTab(state, mains, path, span.end + 1);
}

export function moveGroupStep(state: TabsState, mains: MainRoots, index: number, direction: -1 | 1): TabsState {
  const group = state.groups[index];
  if (group === undefined) return state;
  const span = spanOf(indexesOf(state.tabs, new Set(group.tabs)));
  if (span === undefined) return state;
  if (direction < 0) return span.start === 0 ? state : placeGroup(state, mains, index, unitSpan(state, mains, span.start - 1).start);
  return span.end >= state.tabs.length ? state : placeGroup(state, mains, index, unitSpan(state, mains, span.end).end);
}

export const tabCanMove = (state: TabsState, mains: MainRoots, path: string, direction: -1 | 1): boolean => !sameState(state, moveTabStep(state, mains, path, direction));

export const groupCanMove = (state: TabsState, mains: MainRoots, index: number, direction: -1 | 1): boolean => !sameState(state, moveGroupStep(state, mains, index, direction));

export function resolveTabDrag(state: TabsState, mains: MainRoots, source: TabDragSource, hit: TabDragHit): TabDragResult {
  if (source.kind === "group" && hit.kind === "group") return source.index === hit.index ? { kind: "none" } : { kind: "refuse", reason: GROUPS_CANNOT_NEST };
  if (source.kind === "tab" && hit.kind === "group") return groupIndexOf(state, source.path) === hit.index ? { kind: "none" } : { kind: "add", path: source.path, group: hit.index };
  const before = hit.kind === "end" ? state.tabs.length : hit.kind === "before" ? hit.index : state.tabs.length;
  if (source.kind === "group") {
    const next = placeGroup(state, mains, source.index, before);
    return sameState(state, next) ? { kind: "none" } : { kind: "place-group", index: source.index, before };
  }
  const next = placeTab(state, mains, source.path, before);
  return sameState(state, next) ? { kind: "none" } : { kind: "place-tab", path: source.path, before };
}

export function newGroup(state: TabsState, mains: MainRoots, path: string, name: string, color: TabGroupColor): TabsState {
  const moving = clusterPaths(state, mains, path);
  const previous = groupIndexOf(state, path);
  const groups = leaveGroups(state.groups, moving);
  const tabs = previous < 0 ? state.tabs : moveAfterGroup({ ...state, groups }, moving, groups[previous]);
  const members = tabs.flatMap((tab) => (tab.kind === "repo" && moving.has(tab.path) ? tab.path : []));
  return groupTabs(withTabs(state, tabs, [...groups.filter((entry) => entry.tabs.length > 0), { name: name.trim(), color, collapsed: false, tabs: members }]), mains);
}

const editGroup = (state: TabsState, index: number, change: Partial<UserGroup>): TabsState => ({
  ...state,
  groups: state.groups.map((entry, position) => (position === index ? { ...entry, ...change } : entry)),
});

export const renameGroup = (state: TabsState, index: number, name: string): TabsState => editGroup(state, index, { name: name.trim() });

export const recolorGroup = (state: TabsState, index: number, color: TabGroupColor): TabsState => editGroup(state, index, { color });

export const toggleGroup = (state: TabsState, index: number): TabsState => editGroup(state, index, { collapsed: !(state.groups[index]?.collapsed ?? false) });

export const ungroup = (state: TabsState, index: number): TabsState => ({ ...state, groups: state.groups.filter((_, position) => position !== index) });

export function closeTabIds(state: TabsState, ids: readonly string[]): TabsState {
  const closing = new Set(ids);
  const closed = (tab: Tab): boolean => closing.has(tabId(tab));
  const tabs = state.tabs.filter((tab) => !closed(tab));
  if (tabs.length === state.tabs.length) return state;
  if (tabs.length === 0) return { tabs: [launcher], active: 0, groups: [] };
  const current = state.tabs[state.active] as Tab;
  const first = state.tabs.findIndex(closed);
  const active = closed(current) ? Math.min(first, tabs.length - 1) : tabs.indexOf(current);
  return { tabs, active, groups: withoutTabs(state.groups, tabs) };
}

export const closeGroup = (state: TabsState, index: number): TabsState => closeTabIds(state, state.groups[index]?.tabs ?? []);

export const idsOfOthers = (state: TabsState, index: number): string[] => state.tabs.flatMap((tab, position) => (position === index ? [] : [tabId(tab)]));

export const idsToTheRight = (state: TabsState, index: number): string[] => state.tabs.slice(index + 1).map(tabId);

export const CLOSED_LIMIT = 20;

export type ClosedTab = { path: string; siblings: string[] };

export function closedEntries(state: TabsState, ids: readonly string[]): ClosedTab[] {
  const closing = new Set(ids);
  return state.tabs.flatMap((tab) => {
    const path = pathOf(tab);
    if (path === undefined || !closing.has(path)) return [];
    const group = state.groups.find((entry) => entry.tabs.includes(path));
    return [{ path, siblings: (group?.tabs ?? []).filter((member) => !closing.has(member)) }];
  });
}

export const pushClosed = (stack: readonly ClosedTab[], entries: readonly ClosedTab[]): ClosedTab[] => [...stack, ...entries].slice(-CLOSED_LIMIT);

export function nextClosed(stack: readonly ClosedTab[], state: TabsState): { entry: ClosedTab; rest: ClosedTab[] } | undefined {
  const open = new Set(state.tabs.flatMap((tab) => pathOf(tab) ?? []));
  const index = stack.findLastIndex((entry) => !open.has(entry.path));
  const entry = stack[index];
  return entry === undefined ? undefined : { entry, rest: stack.slice(0, index) };
}

export function reopenTab(state: TabsState, mains: MainRoots, closed: ClosedTab): TabsState {
  const opened = openRepoTab(state, closed.path);
  if (opened.groups.some((entry) => entry.tabs.includes(closed.path))) return opened;
  const former = opened.groups.findIndex((entry) => closed.siblings.some((sibling) => entry.tabs.includes(sibling)));
  return former < 0 ? opened : addToGroup(opened, mains, closed.path, former);
}
