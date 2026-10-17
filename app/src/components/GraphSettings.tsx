import { For, Show } from "solid-js";
import { columnLabels, OPTIONAL_COLUMNS } from "../graph/columns";
import type { GraphVisibility } from "../ipc/bindings/GraphVisibility";
import { columnVisibility, hiddenRefs, resetColumns, withColumn, withShown, withVisibility, type RepoUiPrefsStore } from "../state/repoUiPrefs";
import type { Anchor } from "../state/repoActions";
import { Popover } from "./Popover";

const BRANCH_CHOICES: ReadonlyArray<{ visibility: GraphVisibility; label: string; note: string }> = [
  { visibility: { kind: "all" }, label: "All branches", note: "every branch and tag" },
  { visibility: { kind: "current_and_upstream" }, label: "Current + upstream", note: "only the checked-out branch and its upstream" },
];

const kindNote = { local_branch: "local", remote_branch: "remote", tag: "tag" } as const;

export function GraphSettings(props: { anchor: Anchor; prefs: RepoUiPrefsStore; onClose: () => void }) {
  const shown = () => columnVisibility(props.prefs.prefs());
  const visibility = () => {
    const kind = props.prefs.prefs().branch_visibility.kind;
    return kind === "hidden" ? "all" : kind;
  };
  const hidden = () => hiddenRefs(props.prefs.prefs().branch_visibility);
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
        <Show when={hidden().length > 0}>
          <h3>Hidden in the graph</h3>
          <ul class="graph-hidden" aria-label="Hidden in the graph">
            <For each={hidden()}>
              {(ref) => (
                <li class="hrow">
                  <span class="ref">{ref.name}</span>
                  <span class="setting-note">{kindNote[ref.kind]}</span>
                  <button type="button" class="btn" aria-label={`Show ${ref.name} in the graph`} onClick={() => props.prefs.update((current) => withShown(current, ref))}>
                    Show
                  </button>
                </li>
              )}
            </For>
          </ul>
          <div class="hrow">
            <button type="button" class="btn" onClick={() => props.prefs.update((current) => withVisibility(current, { kind: "all" }))}>
              Show all
            </button>
          </div>
        </Show>
      </div>
    </Popover>
  );
}
