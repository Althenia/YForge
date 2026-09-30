import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { IconName } from "../iconNames";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export type MenuItem = { label: string; icon?: IconName; danger?: boolean; onSelect: () => void };

export function ActionMenu(props: { label: string; items: MenuItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [position, setPosition] = createSignal({ top: 0, right: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const close = () => {
    props.onOpenChange(false);
    trigger?.closest<HTMLElement>(".frow")?.focus();
  };

  createEffect(() => {
    if (!props.open || trigger === undefined) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    queueMicrotask(() => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target) && !trigger?.contains(event.target)) props.onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss, true));
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      props.onOpenChange(false);
    }
  };

  return (
    <>
      <button
        type="button"
        class="icon-btn dense"
        ref={trigger}
        tabindex="-1"
        {...tip("More actions", undefined, props.label)}
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={(event) => {
          event.stopPropagation();
          props.onOpenChange(!props.open);
        }}
      >
        <Icon name="more" />
      </button>
      <Show when={props.open}>
        <div class="menu" role="menu" aria-label={props.label} ref={menu} style={{ top: `${position().top}px`, right: `${position().right}px` }} onKeyDown={onKeyDown}>
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="item"
                classList={{ danger: item.danger === true }}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenChange(false);
                  item.onSelect();
                }}
              >
                <span class="item-main">
                  <span class="item-icon" aria-hidden="true">
                    <Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>
                  </span>
                  <span class="label-text">{item.label}</span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
