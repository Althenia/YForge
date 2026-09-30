import type { TabSession } from "../ipc/bindings/TabSession";
import { basename } from "../format";

export type Tab = { kind: "repo"; path: string } | { kind: "launcher" };

export type TabsState = { tabs: Tab[]; active: number };

const launcher: Tab = { kind: "launcher" };

const isRepo = (tab: Tab, path: string): boolean => tab.kind === "repo" && tab.path === path;

export function openRepoTab(state: TabsState, path: string): TabsState {
  const existing = state.tabs.findIndex((tab) => isRepo(tab, path));
  if (existing >= 0) return { ...state, active: existing };
  const replaced = state.tabs[state.active]?.kind === "launcher" ? state.active : -1;
  if (replaced >= 0) return { tabs: state.tabs.map((tab, index) => (index === replaced ? { kind: "repo", path } : tab)), active: replaced };
  return { tabs: [...state.tabs, { kind: "repo", path }], active: state.tabs.length };
}

export function openLauncherTab(state: TabsState): TabsState {
  const existing = state.tabs.findIndex((tab) => tab.kind === "launcher");
  if (existing >= 0) return { ...state, active: existing };
  return { tabs: [...state.tabs, launcher], active: state.tabs.length };
}

export function closeTab(state: TabsState, index: number): TabsState {
  const tabs = state.tabs.filter((_, position) => position !== index);
  if (tabs.length === 0) return { tabs: [launcher], active: 0 };
  const active = index < state.active ? state.active - 1 : Math.min(state.active, tabs.length - 1);
  return { tabs, active: index === state.active ? Math.min(index, tabs.length - 1) : active };
}

export function activateTab(state: TabsState, index: number): TabsState {
  return index >= 0 && index < state.tabs.length ? { ...state, active: index } : state;
}

export const LAUNCHER_TAB_ID = "launcher";

export const tabId = (tab: Tab): string => (tab.kind === "repo" ? tab.path : LAUNCHER_TAB_ID);

export function tabLabel(tab: Tab): string {
  return tab.kind === "launcher" ? "New tab" : basename(tab.path);
}

export function sessionOf(state: TabsState): TabSession {
  const repos = state.tabs.filter((tab): tab is Extract<Tab, { kind: "repo" }> => tab.kind === "repo");
  const current = state.tabs[state.active];
  const active = current?.kind === "repo" ? repos.findIndex((tab) => tab.path === current.path) : repos.length - 1;
  return { tabs: repos.map((tab) => tab.path), active: Math.max(active, 0) };
}

export function restoreTabs(session: TabSession, launchPath: string | undefined): TabsState {
  let state: TabsState = { tabs: session.tabs.map((path): Tab => ({ kind: "repo", path })), active: session.active };
  if (state.tabs.length === 0) state = { tabs: [launcher], active: 0 };
  else state = { ...state, active: Math.min(session.active, state.tabs.length - 1) };
  return launchPath === undefined ? state : openRepoTab(state, launchPath);
}
