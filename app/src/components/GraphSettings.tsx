import { For } from "solid-js";
import { columnLabels, OPTIONAL_COLUMNS } from "../graph/columns";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import { columnVisibility, resetColumns, withColumn, withVisibility, type RepoUiPrefsStore } from "../state/repoUiPrefs";
import type { Anchor } from "../state/repoActions";
import { Popover } from "./Popover";

const BRANCH_CHOICES: ReadonlyArray<{ visibility: GraphVisibility; label: string; note: string }> = [
  { visibility: { kind: "all" }, label: "All branches", note: "every branch and tag" },
  { visibility: { kind: "current_and_upstream" }, label: "Current + upstream", note: "only the checked-out branch and its upstream" },
];

export function GraphSettings(props: { anchor: Anchor; prefs: RepoUiPrefsStore; onClose: () => void }) {
  const shown = () => columnVisibility(props.prefs.prefs());
  const visibility = () => props.prefs.prefs().branch_visibility.kind;
  return (
    <Popover anchor={props.anchor} label="Graph columns and branches" onClose={props.onClose}>
      <div class="popform">
        <h3>Columns</h3>
        <For each={OPTIONAL_COLUMNS}>
          {(id) => (
            <label class="check">
              <input type="checkbox" checked={shown()[id]} onChange={(event) => props.prefs.update((current) => withColumn(current, id, { visible: event.currentTarget.checked }))} />
              {columnLabels[id]}
            </label>
          )}
        </For>
        <div class="hrow">
          <button type="button" class="btn" onClick={() => props.prefs.update(resetColumns)}>
            Reset columns
          </button>
        </div>
        <h3>Branches</h3>
        <div role="radiogroup" aria-label="Branch visibility" class="graph-branches">
          <For each={BRANCH_CHOICES}>
            {(choice) => (
              <label class="check">
                <input
                  type="radio"
                  name="graph-branches"
                  checked={visibility() === choice.visibility.kind}
                  onChange={() => props.prefs.update((current) => withVisibility(current, choice.visibility))}
                />
                <span>
                  {choice.label}
                  <span class="setting-note"> {choice.note}</span>
                </span>
              </label>
            )}
          </For>
        </div>
      </div>
    </Popover>
  );
}
