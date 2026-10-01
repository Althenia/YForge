import { For, Show } from "solid-js";
import type { Restoring } from "../state/app";
import { laneOf, tabCountText } from "./TabGroupLayer";

const count = (amount: number, one: string, many: string): string => `${amount} ${amount === 1 ? one : many}`;

export function TabRestoring(props: { restoring: Restoring }) {
  const grouped = () => props.restoring.groups.reduce((total, group) => total + group.tabs.length, 0);
  const ungrouped = () => Array.from({ length: Math.max(0, props.restoring.tabs - grouped()) });
  const summary = () => {
    const tabs = count(props.restoring.tabs, "tab", "tabs");
    return props.restoring.groups.length === 0 ? `Restoring ${tabs}…` : `Restoring ${tabs} and ${count(props.restoring.groups.length, "group", "groups")}…`;
  };
  return (
    <div class="app tab-only">
      <div class="bar tabbar" role="status" aria-busy="true" aria-label="Restoring tabs">
        <For each={props.restoring.groups}>
          {(group) => (
            <>
              <span class={`gchip lane-${laneOf(group.color)}`}>
                {group.name}
                <Show when={group.collapsed}>
                  {" "}
                  <span class="count">· {tabCountText(group.tabs.length)}</span>
                </Show>
              </span>
              <Show when={!group.collapsed}>
                <For each={group.tabs}>{() => <span class="tab placeholder">…</span>}</For>
              </Show>
            </>
          )}
        </For>
        <For each={ungrouped()}>{() => <span class="tab placeholder">…</span>}</For>
        <span class="reason">{summary()}</span>
      </div>
      <Show when={props.restoring.groups.length > 0}>
        <p class="reason restoring-note">The groups come back exactly as you left them, including which are collapsed.</p>
      </Show>
    </div>
  );
}
