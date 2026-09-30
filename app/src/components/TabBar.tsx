import { For, Show } from "solid-js";
import { basename } from "../format";
import { useApp } from "../state/app";
import { tabLabel } from "../state/tabs";
import { Icon } from "./Icon";
import { Mark } from "./Mark";
import { tip } from "./Tooltip";

export function TabBar(props: { count?: number }) {
  const app = useApp();
  const settingsOpen = () => app.screen().kind === "settings";
  return (
    <div class="bar tabbar" role="tablist" aria-label="Repositories">
      <For each={app.tabGroups()}>
        {(group) => (
          <span
            class="tab-group"
            classList={{ grouped: group.tabs.length > 1 }}
            role={group.tabs.length > 1 ? "group" : undefined}
            aria-label={group.tabs.length > 1 ? `${basename(group.main)} and its worktrees` : undefined}
          >
            <For each={group.tabs}>
              {(entry) => {
                const active = () => entry.index === app.tabs().active && !settingsOpen();
                return (
                  <span class="tab" classList={{ active: active(), linked: entry.linked }}>
                    <button
                      type="button"
                      class="tab-main"
                      role="tab"
                      aria-selected={active()}
                      aria-current={active() ? "page" : undefined}
                      title={entry.tab.kind === "repo" ? entry.tab.path : undefined}
                      onClick={() => app.activate(entry.index)}
                    >
                      <Show when={entry.tab.kind === "repo"} fallback={<Icon name="plus" />}>
                        <Show when={entry.linked} fallback={<Mark size={24} />}>
                          <Icon name="worktree" />
                        </Show>
                      </Show>
                      {tabLabel(entry.tab)}
                      <Show when={active() && entry.tab.kind === "repo" && props.count !== undefined}>
                        <span class="tab-count">
                          {props.count} {props.count === 1 ? "worktree" : "worktrees"}
                        </span>
                      </Show>
                    </button>
                    <button type="button" class="tab-close" {...tip("Close tab", active() ? "⌘W" : undefined, `Close ${tabLabel(entry.tab)}`)} onClick={() => app.closeTabAt(entry.index)}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                );
              }}
            </For>
          </span>
        )}
      </For>
      <button type="button" class="icon-btn" {...tip("New tab", "⌘T")} onClick={app.openLauncher}>
        <Icon name="plus" />
      </button>
      <span class="spacer" />
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
        onClick={() => void app.saveSettings({ ...app.settings(), theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" })}
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
  );
}
