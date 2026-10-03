import { For } from "solid-js";
import { SHORTCUT_GROUPS, SHORTCUTS } from "../state/shortcuts";
import { DialogFrame } from "./DialogFrame";

export function ShortcutsSheet(props: { onClose: () => void }) {
  return (
    <DialogFrame title="Keyboard shortcuts" onEscape={props.onClose}>
      <div class="shortcut-groups">
        <For each={SHORTCUT_GROUPS}>
          {(group) => (
            <section class="shortcut-group" aria-label={group.group}>
              <h4>{group.group}</h4>
              <ul>
                <For each={group.entries}>
                  {(entry) => (
                    <li>
                      <span>{entry.title}</span>
                      <span class="kbd">{SHORTCUTS[entry.key]}</span>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </div>
      <div class="foot">
        <button type="button" class="btn primary" onClick={props.onClose} ref={(button) => queueMicrotask(() => button.focus())}>
          Close
        </button>
      </div>
    </DialogFrame>
  );
}
