import { Show } from "solid-js";
import type { AppInfo } from "../ipc/bindings/AppInfo";
import { useApp } from "../state/app";
import { entriesFor } from "../state/activityModel";
import { Icon } from "./Icon";

export function ActivityBar(props: { info: AppInfo; root: string }) {
  const app = useApp();
  const latest = () => entriesFor(app.activity(), props.root).at(-1);
  return (
    <div class="bar activity">
      <span class="chip">
        YForge {props.info.app_version} · git <code>{props.info.git_version}</code>
      </span>
      <button type="button" class="chip activity-toggle" aria-expanded={app.drawerOpen()} aria-controls="activity-drawer" title="Toggle the Activity drawer (⌘⇧Y)" onClick={app.toggleDrawer}>
        <Icon name="activity" size={14} />
        Activity
        <Show when={latest()}>{(entry) => <span class="activity-latest">· {entry().summary}</span>}</Show>
      </button>
      <span class="spacer" />
      <span class="path-line" title={props.root}>
        <bdi dir="ltr">{props.root}</bdi>
      </span>
    </div>
  );
}
