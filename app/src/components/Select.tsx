import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "./Icon";

export type SelectOption = { value: string; label: string; hint?: string };

const MARGIN = 8;

/// An owned select: a button that opens a listbox, never the platform control.
///
/// Keyboard: ↓ and ↑ move, Home and End jump, Enter or Space choose, Esc closes and
/// returns focus to the button. The list starts on the chosen option.
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
  const [position, setPosition] = createSignal({ left: 0, top: 0 });
  let trigger: HTMLButtonElement | undefined;
  let element: HTMLDivElement | undefined;

  const chosen = () => props.options.find((option) => option.value === props.value);
  const label = () => chosen()?.label ?? props.placeholder ?? "Choose…";

  const items = () => [...(element?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];

  const place = () => {
    if (trigger === undefined || element === undefined) return;
    const anchor = trigger.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - size.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(anchor.bottom + 4, window.innerHeight - size.height - MARGIN)),
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
    setOpen(true);
    queueMicrotask(() => {
      place();
      const all = items();
      const at = all.findIndex((item) => item.getAttribute("aria-selected") === "true");
      (all[at === -1 ? 0 : at] ?? all[0])?.focus();
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

  const onKeyDown = (event: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      all[(at + step + all.length) % all.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      all[event.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const focused = all[at];
      if (focused !== undefined) choose(focused.dataset.value ?? "");
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

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
        <div
          class="popover select-list"
          role="listbox"
          aria-label={props.label}
          ref={element}
          style={{ left: `${position().left}px`, top: `${position().top}px` }}
          onKeyDown={onKeyDown}
        >
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                role="option"
                class="select-option"
                data-value={option.value}
                aria-selected={option.value === props.value}
                onClick={() => choose(option.value)}
              >
                <span class="select-option-label">
                  {option.label}
                  <Show when={option.hint}>{(hint) => <span class="select-option-hint">{hint()}</span>}</Show>
                </span>                <Show when={option.value === props.value}>
                  <Icon name="check" size={16} />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}
