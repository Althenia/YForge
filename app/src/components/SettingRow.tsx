import type { JSX } from "solid-js";
import { settingAnchor } from "../state/settingsSearch";

export function SettingRow(props: { id?: string; title: string; note: string; children: JSX.Element }) {
  return (
    <div class="setting" id={props.id === undefined ? undefined : settingAnchor(props.id)} tabindex={props.id === undefined ? undefined : -1}>
      <div class="setting-text">
        <span class="setting-title">{props.title}</span>
        <span class="setting-note">{props.note}</span>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}
