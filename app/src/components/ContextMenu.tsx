import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MenuState } from "../state/repoActions";
import type { MenuEntry, MenuPart } from "../state/refMenu";
import { Icon } from "./Icon";
import { VIRTUAL_LIST_FROM, VirtualRows, type VirtualRow } from "./VirtualRows";

const MARGIN = 8;
const ITEM_HEIGHT = 28;

const plainText = (parts: MenuPart[]): string => parts.map((part) => (typeof part === "string" ? part : part.ref)).join("");

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
  let pendingOrdinal: number | undefined;
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();
  const [focused, setFocused] = createSignal<number | undefined>();

  const entries = () => props.menu.entries;
  const virtual = () => entries().length > VIRTUAL_LIST_FROM;
  const itemIndexes = createMemo(() => entries().flatMap((entry, index) => (entry.kind === "item" ? [index] : [])));
  const ordinalOf = createMemo(() => new Map(itemIndexes().map((index, ordinal) => [index, ordinal])));
  const keepIndex = () => itemIndexes()[focused() ?? -1];
  const activeOrdinal = (): number => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.getAttribute("role") === "menuitem" ? Number(active.dataset.nav) : -1;
  };
  const focusItem = (ordinal: number) => {
    setFocused(ordinal);
    const mounted = element?.querySelector<HTMLElement>(`[role="menuitem"][data-nav="${ordinal}"]`);
    if (mounted !== null && mounted !== undefined) {
      mounted.focus();
      return;
    }
    const index = itemIndexes()[ordinal];
    if (index === undefined) return;
    pendingOrdinal = ordinal;
    setReveal((current) => ({ nonce: (current?.nonce ?? 0) + 1, index }));
  };
  const mountItem = (ordinal: number, item: HTMLElement, measure?: (element: Element | null) => void) => {
    measure?.(item);
    if (pendingOrdinal !== ordinal) return;
    pendingOrdinal = undefined;
    queueMicrotask(() => item.focus());
  };

  onMount(() => {
    if (element === undefined) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(props.menu.anchor.left, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(props.menu.anchor.top, window.innerHeight - rect.height - MARGIN)),
    });
    const enabled = itemIndexes().findIndex((index) => (entries()[index] as { disabledReason?: string }).disabledReason === undefined);
    if (itemIndexes().length > 0) focusItem(Math.max(enabled, 0));
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
    const count = itemIndexes().length;
    const at = activeOrdinal();
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      if (count > 0) focusItem((at + step + count) % count);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (count > 0) focusItem(event.key === "Home" ? 0 : count - 1);
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

  function EntryRow(row: { entry: MenuEntry; ordinal: number | undefined; row?: VirtualRow }) {
    return (
      <Show when={row.entry.kind === "item" && row.entry} fallback={<div class="sep" role="separator" ref={(separator) => row.row?.measure(separator)} style={row.row?.style} />}>
        {(item) => (
          <button
            type="button"
            role="menuitem"
            class="item"
            classList={{ danger: item().danger === true }}
            aria-disabled={item().disabledReason === undefined ? undefined : "true"}
            title={item().disabledReason ?? (virtual() ? plainText(item().label) : undefined)}
            data-nav={row.ordinal}
            ref={(button) => mountItem(row.ordinal ?? -1, button, row.row?.measure)}
            style={row.row?.style}
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
    );
  }

  return (
    <div
      class="menu"
      classList={{ long: virtual() }}
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
      <Show when={virtual()} fallback={<For each={entries()}>{(entry, index) => <EntryRow entry={entry} ordinal={ordinalOf().get(index())} />}</For>}>
        <VirtualRows as="div" items={entries()} scroller={() => element} estimate={ITEM_HEIGHT} keepIndex={keepIndex()} reveal={reveal()} measured>
          {(entry, row) => <EntryRow entry={entry} ordinal={ordinalOf().get(row.index)} row={row} />}
        </VirtualRows>
      </Show>
    </div>
  );
}
