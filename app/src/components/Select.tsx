import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "./Icon";
import { spacingPx, VIRTUAL_LIST_FROM, VirtualRows, type VirtualRow } from "./VirtualRows";

export type SelectOption = { value: string; label: string; hint?: string };

const MARGIN = 8;
const SEARCH_ABOVE = 8;
const OPTION_HEIGHT = 32;

/// An owned select: a button that opens a listbox, never the platform control.
///
/// Keyboard: ↓ and ↑ move, Home and End jump, Enter or Space choose, Esc closes and
/// returns focus to the button. The list starts on the chosen option, or on its search
/// field when it holds more than eight options; ↓ leaves the field for the first option
/// and Enter in the field chooses the first option that remains.
export function Select(props: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ left: 0, top: 0, width: 0 });
  const [query, setQuery] = createSignal("");
  let trigger: HTMLButtonElement | undefined;
  let element: HTMLDivElement | undefined;
  let field: HTMLInputElement | undefined;

  const searchable = () => props.options.length > SEARCH_ABOVE;
  const shown = createMemo(() => {
    const needle = query().toLowerCase();
    return needle === "" ? props.options : props.options.filter((option) => [option.label, option.hint ?? "", option.value].some((text) => text.toLowerCase().includes(needle)));
  });

  const chosen = () => props.options.find((option) => option.value === props.value);
  const label = () => chosen()?.label ?? props.placeholder ?? "Choose…";

  const [focused, setFocused] = createSignal<number | undefined>();
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();
  let options: HTMLDivElement | undefined;
  let pendingIndex: number | undefined;
  const virtual = () => shown().length > VIRTUAL_LIST_FROM;
  const optionAt = (index: number) => element?.querySelector<HTMLElement>(`[role="option"][data-index="${index}"]`);
  const focusedIndex = (): number => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.getAttribute("role") === "option" ? Number(active.dataset.index) : -1;
  };
  const focusOption = (index: number) => {
    setFocused(index);
    const mounted = optionAt(index);
    if (mounted !== null && mounted !== undefined) {
      mounted.focus();
      return;
    }
    pendingIndex = index;
    setReveal((current) => ({ nonce: (current?.nonce ?? 0) + 1, index }));
  };
  const mountOption = (index: number, option: HTMLElement, measure?: (element: Element | null) => void) => {
    measure?.(option);
    if (pendingIndex !== index) return;
    pendingIndex = undefined;
    queueMicrotask(() => option.focus());
  };

  const place = () => {
    if (trigger === undefined || element === undefined) return;
    const anchor = trigger.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    const width = Math.max(size.width, anchor.width);
    setPosition({
      left: Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(anchor.bottom + 4, window.innerHeight - size.height - MARGIN)),
      width: anchor.width,
    });
  };

  onMount(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !element?.contains(event.target) && !trigger?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => document.removeEventListener("pointerdown", dismiss, true));
  });

  const openList = () => {
    if (props.disabled === true) return;
    setQuery("");
    setFocused(undefined);
    setOpen(true);
    queueMicrotask(() => {
      place();
      if (searchable()) {
        field?.focus();
        return;
      }
      const at = shown().findIndex((option) => option.value === props.value);
      if (shown().length > 0) focusOption(at === -1 ? 0 : at);
    });
  };

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger?.focus();
  };

  const choose = (value: string) => {
    props.onChange(value);
    close(true);
  };

  const onSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (shown().length > 0) focusOption(0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = shown()[0];
      if (first !== undefined) choose(first.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target === field) return onSearchKeyDown(event);
    const count = shown().length;
    const at = focusedIndex();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      if (count > 0) focusOption((at + step + count) % count);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (count > 0) focusOption(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = shown()[at];
      if (option !== undefined) choose(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  function OptionRow(row: { option: SelectOption; index: number; row?: VirtualRow }) {
    return (
      <button
        type="button"
        role="option"
        class="select-option"
        data-value={row.option.value}
        data-index={row.index}
        aria-selected={row.option.value === props.value}
        ref={(button) => mountOption(row.index, button, row.row?.measure)}
        style={row.row?.style}
        onClick={() => choose(row.option.value)}
      >
        <span class="select-option-label">{row.option.label}</span>
        <Show when={row.option.hint}>{(hint) => <span class="select-option-hint">{hint()}</span>}</Show>
        <Show when={row.option.value === props.value}>
          <Icon name="check" size={16} />
        </Show>
      </button>
    );
  }

  return (
    <span class="select">
      <button
        type="button"
        class="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={props.label}
        disabled={props.disabled}
        title={props.disabled === true ? props.disabledReason : undefined}
        ref={trigger}
        onClick={() => (open() ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span class="select-value" classList={{ placeholder: chosen() === undefined }}>
          {label()}
        </span>
        <Icon name="chevron" size={16} />
      </button>
      <Show when={open()}>
        <div class="popover select-list" ref={element} style={{ left: `${position().left}px`, top: `${position().top}px`, "--select-anchor": `${position().width}px` }} onKeyDown={onKeyDown}>
          <Show when={searchable()}>
            <label class="input select-search">
              <Icon name="search" size={14} />
              <input type="text" aria-label={`Search ${props.label}`} placeholder="Search" value={query()} ref={field} onInput={(event) => setQuery(event.currentTarget.value)} />
            </label>
          </Show>
          <Show when={shown().length > 0} fallback={<div class="select-empty">No matches</div>}>
            <div class="select-options" role="listbox" aria-label={props.label} ref={options}>
              <Show
                when={virtual()}
                fallback={
                  <For each={shown()}>{(option, index) => <OptionRow option={option} index={index()} />}</For>
                }
              >
                <VirtualRows as="div" items={shown()} scroller={() => options} estimate={OPTION_HEIGHT} gap={spacingPx("0-5")} keepIndex={focused()} reveal={reveal()} measured>
                  {(option, row) => <OptionRow option={option} index={row.index} row={row} />}
                </VirtualRows>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </span>
  );
}
