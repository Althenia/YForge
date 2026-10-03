import { createSignal, For } from "solid-js";
import { refTarget, type LabelGroup } from "../graph/refLabels";
import type { Anchor, RepoActions } from "../state/repoActions";
import { Popover } from "./Popover";
import { RefLabel } from "./RefLabel";

export function RefOverflow(props: {
  anchor: Anchor;
  sha: string;
  groups: readonly LabelGroup[];
  actions: RepoActions;
  onHighlight: (sha: string | undefined) => void;
  onClose: () => void;
}) {
  const [active, setActive] = createSignal(0);
  const optionId = (index: number) => `ref-overflow-${props.sha.slice(0, 7)}-${index}`;
  const targetOf = (index: number) => {
    const group = props.groups[index];
    return group === undefined ? undefined : refTarget(group, props.sha);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const last = props.groups.length - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), last));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : last);
    } else if (event.key === "Enter") {
      const target = targetOf(active());
      if (target === undefined || props.groups[active()]?.head === true || props.groups[active()]?.tag === true) return;
      event.preventDefault();
      props.onClose();
      props.actions.checkoutRef(target);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      const target = targetOf(active());
      const option = document.getElementById(optionId(active()));
      if (target === undefined || option === null) return;
      event.preventDefault();
      const rect = option.getBoundingClientRect();
      props.actions.openRefMenu(target, { left: rect.left, top: rect.bottom + 4 });
    }
  };
  return (
    <Popover anchor={props.anchor} label={`More refs on ${props.sha.slice(0, 7)}`} onClose={props.onClose}>
      <div class="ref-overflow" role="listbox" tabindex="0" data-autofocus aria-label="More refs" aria-activedescendant={optionId(active())} onKeyDown={onKeyDown}>
        <For each={props.groups}>
          {(group, index) => (
            <div id={optionId(index())} class="ref-overflow-option" classList={{ active: active() === index() }} role="option" aria-selected={active() === index()} onPointerEnter={() => setActive(index())}>
              <RefLabel group={group} sha={props.sha} actions={props.actions} onHighlight={props.onHighlight} onDone={props.onClose} />
            </div>
          )}
        </For>
      </div>
    </Popover>
  );
}
