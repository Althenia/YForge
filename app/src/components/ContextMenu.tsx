import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MenuState } from "../state/repoActions";
import type { MenuPart } from "../state/refMenu";
import { Icon } from "./Icon";

const MARGIN = 8;

export function MenuLabel(props: { parts: MenuPart[] }) {
  return (
    <span class="label-text">
      <For each={props.parts}>{(part) => (typeof part === "string" ? part : <span class="r">{part.ref}</span>)}</For>
    </span>
  );
}

export function ContextMenu(props: { menu: MenuState; onClose: () => void }) {
  const [position, setPosition] = createSignal(props.menu.anchor);
  const opener = document.activeElement;
  let element: HTMLDivElement | undefined;

  const items = () => [...(element?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  onMount(() => {
    if (element === undefined) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(props.menu.anchor.left, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(props.menu.anchor.top, window.innerHeight - rect.height - MARGIN)),
    });
    (items().find((item) => item.getAttribute("aria-disabled") !== "true") ?? items()[0])?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !element?.contains(event.target)) props.onClose();
    };
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("resize", props.onClose);
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("resize", props.onClose);
    });
  });

  const restoreFocus = () => {
    if (opener instanceof HTMLElement) opener.focus();
  };

  const select = (id: string) => {
    props.onClose();
    restoreFocus();
    props.menu.run(id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      all[(at + step + all.length) % all.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      all[event.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      restoreFocus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      props.onClose();
      restoreFocus();
    }
  };

  return (
    <div
      class="menu"
      role="menu"
      ref={element}
      style={{ left: `${position().left}px`, top: `${position().top}px` }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Show when={props.menu.title}>
        {(title) => (
          <div class="title" role="presentation">
            <MenuLabel parts={title()} />
          </div>
        )}
      </Show>
      <For each={props.menu.entries}>
        {(entry) => (
          <Show when={entry.kind === "item" && entry} fallback={<div class="sep" role="separator" />}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="item"
                classList={{ danger: item().danger === true }}
                aria-disabled={item().disabledReason === undefined ? undefined : "true"}
                title={item().disabledReason}
                onClick={() => item().disabledReason === undefined && select(item().id)}
              >
                <span class="item-main">
                  <span class="item-icon" aria-hidden="true">
                    <Show when={item().icon}>{(name) => <Icon name={name()} />}</Show>
                  </span>
                  <MenuLabel parts={item().label} />
                </span>
                <Show when={item().note}>{(note) => <span class="note-k">{note()}</span>}</Show>
                <Show when={item().shortcut}>{(shortcut) => <span class="kbd">{shortcut()}</span>}</Show>
              </button>
            )}
          </Show>
        )}
      </For>
    </div>
  );
}
