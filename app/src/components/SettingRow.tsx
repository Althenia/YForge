import type { JSX } from "solid-js";

export function SettingRow(props: { title: string; note: string; children: JSX.Element }) {
  return (
    <div class="setting">
      <div class="setting-text">
        <span class="setting-title">{props.title}</span>
        <span class="setting-note">{props.note}</span>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}
