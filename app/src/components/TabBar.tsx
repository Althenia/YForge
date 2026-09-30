import { For, Show } from "solid-js";
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
      <For each={app.tabs().tabs}>
        {(tab, index) => {
          const active = () => index() === app.tabs().active && !settingsOpen();
          return (
            <span class="tab" classList={{ active: active() }}>
              <button
                type="button"
                class="tab-main"
                role="tab"
                aria-selected={active()}
                aria-current={active() ? "page" : undefined}
                title={tab.kind === "repo" ? tab.path : undefined}
                onClick={() => app.activate(index())}
              >
                <Show when={tab.kind === "repo"} fallback={<Icon name="plus" />}>
                  <Mark size={24} />
                </Show>
                {tabLabel(tab)}
                <Show when={active() && tab.kind === "repo" && props.count !== undefined}>
                  <span class="tab-count">
                    {props.count} {props.count === 1 ? "worktree" : "worktrees"}
                  </span>
                </Show>
              </button>
              <button type="button" class="tab-close" {...tip("Close tab", active() ? "⌘W" : undefined, `Close ${tabLabel(tab)}`)} onClick={() => app.closeTabAt(index())}>
                <Icon name="close" size={14} />
              </button>
            </span>
          );
        }}
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
