import { Show } from "solid-js";
import { beginLabelDrag, labelAt, registerLabel } from "../graph/labelDrag";
import { refTarget, type LabelGroup } from "../graph/refLabels";
import type { RefTarget } from "../state/refMenu";
import type { RepoActions } from "../state/repoActions";
import { Icon } from "./Icon";

export function RefLabel(props: { group: LabelGroup; sha: string | null; actions: RepoActions; onHighlight?: (sha: string | undefined) => void; onDone?: () => void }) {
  const target = (): RefTarget | undefined => (props.sha === null ? undefined : refTarget(props.group, props.sha));
  return (
    <span
      class="label"
      classList={{ active: props.group.head, tag: props.group.tag }}
      title={props.group.title}
      data-ref-label
      ref={(element) => registerLabel(element, target)}
      onPointerEnter={() => props.onHighlight?.(props.group.tag || props.sha === null ? undefined : props.sha)}
      onPointerLeave={() => props.onHighlight?.(undefined)}
      onPointerDown={(event) => {
        const current = target();
        if (current !== undefined && !props.group.tag) {
          beginLabelDrag(event, current, labelAt, (dragged, dropped, at) => void props.actions.openDropMenu(dragged, dropped, at), props.group.title);
        }
      }}
      onContextMenu={(event) => {
        const current = target();
        if (current === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        props.actions.openRefMenu(current, { left: event.clientX, top: event.clientY });
      }}
      onDblClick={(event) => {
        const current = target();
        if (current === undefined || props.group.head) return;
        event.stopPropagation();
        props.actions.checkoutRef(current);
        props.onDone?.();
      }}
    >
      <Show when={props.group.head}>
        <Icon name="check" size={14} />
      </Show>
      <span class="name">{props.group.name}</span>
      <Show when={props.group.local}>
        <Icon name="local" size={14} />
      </Show>
      <Show when={props.group.remote}>
        <Icon name="remote" size={14} />
      </Show>
      <Show when={props.group.tag}>
        <Icon name="tag" size={14} />
      </Show>
    </span>
  );
}
