import { createEffect, createSignal, Index, Match, on, Show, Switch } from "solid-js";
import { basename } from "../format";
import { useApp } from "../state/app";
import type { Anchor } from "../state/repoActions";
import { tabLabel, type SegmentCluster, type SegmentTab, type Tab, type TabSegment, type UserGroup } from "../state/tabs";
import { Icon } from "./Icon";
import { Mark } from "./Mark";
import { anchorBelow, laneOf, opensMenu, tabCountText, TabGroupLayer, type TabGroupOverlay } from "./TabGroupLayer";
import { tip } from "./Tooltip";

type GroupSegment = Extract<TabSegment, { kind: "group" }>;

const groupSegment = (segment: TabSegment): GroupSegment | undefined => (segment.kind === "group" ? segment : undefined);

const clusterSegment = (segment: TabSegment): SegmentCluster | undefined => (segment.kind === "cluster" ? segment.cluster : undefined);

const repositoryPath = (tab: Tab): string | undefined => (tab.kind === "repo" ? tab.path : undefined);

function TabItem(props: { entry: SegmentTab; count: number | undefined; onMenu: (path: string, anchor: Anchor) => void }) {
  const app = useApp();
  const settingsOpen = () => app.screen().kind === "settings";
  const active = () => props.entry.index === app.tabs().active && !settingsOpen() && !app.launchpadOpen();
  const path = () => repositoryPath(props.entry.tab);
  const aliased = () => {
    const repository = path();
    return repository !== undefined && app.aliasOf(repository) !== undefined;
  };
  const openMenu = (anchor: Anchor) => {
    const repository = path();
    if (repository !== undefined) props.onMenu(repository, anchor);
  };
  return (
    <span
      class="tab"
      classList={{ active: active(), linked: props.entry.linked }}
      onContextMenu={(event) => {
        if (path() === undefined) return;
        event.preventDefault();
        openMenu({ left: event.clientX, top: event.clientY });
      }}
    >
      <button
        type="button"
        class="tab-main"
        role="tab"
        aria-selected={active()}
        aria-current={active() ? "page" : undefined}
        title={path()}
        aria-description={aliased() ? basename(path() ?? "") : undefined}
        onClick={() => app.activate(props.entry.index)}
        onKeyDown={(event) => {
          if (!opensMenu(event)) return;
          event.preventDefault();
          openMenu(anchorBelow(event.currentTarget));
        }}
      >
        <Show when={path() !== undefined} fallback={<Icon name="plus" />}>
          <Show when={props.entry.linked} fallback={<Mark size={24} />}>
            <Icon name="worktree" />
          </Show>
        </Show>
        <span class="tab-label">{tabLabel(props.entry.tab, app.aliases())}</span>
        <Show when={active() && path() !== undefined && props.count !== undefined}>
          <span class="tab-count">
            {props.count} {props.count === 1 ? "worktree" : "worktrees"}
          </span>
        </Show>
      </button>
      <button
        type="button"
        class="tab-close"
        {...tip("Close tab", active() ? "⌘W" : undefined, `Close ${tabLabel(props.entry.tab, app.aliases())}`)}
        onClick={() => app.closeTabAt(props.entry.index)}
      >
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}

function ClusterView(props: { cluster: SegmentCluster; count: number | undefined; onMenu: (path: string, anchor: Anchor) => void }) {
  const shown = () => props.cluster.tabs.filter((entry) => !entry.hidden);
  return (
    <Show when={shown().length > 0}>
      <span
        class="tab-group"
        classList={{ grouped: shown().length > 1 }}
        role={shown().length > 1 ? "group" : undefined}
        aria-label={shown().length > 1 ? `${basename(props.cluster.main)} and its worktrees` : undefined}
      >
        <Index each={shown()}>{(entry) => <TabItem entry={entry()} count={props.count} onMenu={props.onMenu} />}</Index>
      </span>
    </Show>
  );
}

function GroupChip(props: { index: number; group: UserGroup; onMenu: (anchor: Anchor) => void }) {
  const app = useApp();
  return (
    <button
      type="button"
      class={`gchip lane-${laneOf(props.group.color)}`}
      data-group={props.index}
      aria-expanded={!props.group.collapsed}
      onClick={() => app.toggleTabGroup(props.index)}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu({ left: event.clientX, top: event.clientY });
      }}
      onKeyDown={(event) => {
        if (!opensMenu(event)) return;
        event.preventDefault();
        props.onMenu(anchorBelow(event.currentTarget));
      }}
    >
      {props.group.name}
      <Show when={props.group.collapsed}>
        {" "}
        <span class="count">· {tabCountText(props.group.tabs.length)}</span>
      </Show>
    </button>
  );
}

export function TabBar(props: { count?: number }) {
  const app = useApp();
  const [overlay, setOverlay] = createSignal<TabGroupOverlay | undefined>();
  const settingsOpen = () => app.screen().kind === "settings";
  const tabMenu = (path: string, anchor: Anchor) => setOverlay({ kind: "tab-menu", path, anchor });
  let scroller: HTMLDivElement | undefined;
  const returnFocus = (closed: TabGroupOverlay) => {
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    const tabs = scroller?.parentElement;
    const origin =
      "group" in closed
        ? tabs?.querySelector<HTMLElement>(`.gchip[data-group="${closed.group}"]`)
        : "path" in closed
          ? [...(tabs?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((tab) => tab.getAttribute("title") === closed.path)
          : undefined;
    (origin ?? tabs?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? tabs?.querySelector<HTMLElement>('[role="tab"]'))?.focus();
  };
  createEffect(
    on(overlay, (current, previous) => {
      if (current === undefined && previous !== undefined) queueMicrotask(() => returnFocus(previous));
    }),
  );
  createEffect(
    on(
      () => [app.tabs().active, settingsOpen(), app.launchpadOpen(), app.tabSegments(), app.aliases(), props.count] as const,
      () => scroller?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.closest(".tab")?.scrollIntoView?.({ inline: "nearest", block: "nearest" }),
    ),
  );
  return (
    <>
      <div class="bar tabbar" role="tablist" aria-label="Repositories">
        <div
          class="tab-scroll"
          ref={scroller}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          <Index each={app.tabSegments()}>
            {(segment) => (
              <Switch>
                <Match when={groupSegment(segment())}>
                  {(grouped) => (
                    <span class="tgroup" role="group" aria-label={`${grouped().group.name} tab group`}>
                      <GroupChip index={grouped().index} group={grouped().group} onMenu={(anchor) => setOverlay({ kind: "chip-menu", group: grouped().index, anchor })} />
                      <Index each={grouped().clusters}>{(cluster) => <ClusterView cluster={cluster()} count={props.count} onMenu={tabMenu} />}</Index>
                    </span>
                  )}
                </Match>
                <Match when={clusterSegment(segment())}>{(cluster) => <ClusterView cluster={cluster()} count={props.count} onMenu={tabMenu} />}</Match>
              </Switch>
            )}
          </Index>
        </div>
        <button type="button" class="icon-btn" {...tip("New tab", "⌘T")} onClick={app.openLauncher}>
          <Icon name="plus" />
        </button>
        <span class="spacer" />
        <button
          type="button"
          class="icon-btn"
          classList={{ on: app.launchpadOpen() }}
          {...tip("Launchpad")}
          aria-current={app.launchpadOpen() ? "page" : undefined}
          onClick={() => (app.launchpadOpen() ? app.closeSettings() : app.openLaunchpad())}
        >
          <Icon name="launchpad" />
        </button>
        <button
          type="button"
          class="icon-btn"
          classList={{ on: app.drawerOpen() }}
          {...tip("Activity", "⌘⇧Y")}
          aria-expanded={app.drawerOpen()}
          aria-controls="activity-drawer"
          onClick={app.toggleDrawer}
        >
          <Icon name="activity" />
        </button>
        <button
          type="button"
          class="icon-btn"
          {...tip("Toggle theme")}
          onClick={() => void app.saveSettings({ ...app.settings(), theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }).then((problem) => problem === undefined || app.setNotice(problem))}
        >
          <Icon name="theme" />
        </button>
        <button
          type="button"
          class="icon-btn"
          classList={{ on: settingsOpen() }}
          {...tip("Settings", "⌘,")}
          aria-current={settingsOpen() ? "page" : undefined}
          onClick={() => (settingsOpen() ? app.closeSettings() : app.openSettings("general"))}
        >
          <Icon name="settings" />
        </button>
      </div>
      <Show when={app.tabGroupSaveFailure()}>
        {(message) => (
          <div class="tab-alert" role="alert">
            <strong>The tab groups could not be saved</strong>
            <p>{message()}</p>
            <p>Your tabs and groups stay as they are now; after a restart they return to the last saved state.</p>
            <div class="acts">
              <button type="button" class="btn sm" onClick={() => app.retryTabGroupSave()}>
                Try again
              </button>
            </div>
          </div>
        )}
      </Show>
      <TabGroupLayer overlay={overlay()} onClose={() => setOverlay(undefined)} onOpen={setOverlay} />
    </>
  );
}
