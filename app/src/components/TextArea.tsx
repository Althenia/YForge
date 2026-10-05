import { createSignal, Show } from "solid-js";

const MIN_ROWS = 3;

/// An owned multi-line field inside an `.input` frame, with a visible character count.
///
/// It grows with its content between `minRows` and `maxRows`, and the count turns to
/// attention ink past `limit`.
export function TextArea(props: {
  label: string;
  value: string;
  limit?: number;
  minRows?: number;
  maxRows?: number;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  onInput: (value: string) => void;
  onBlur?: () => void;
}) {
  const [rows, setRows] = createSignal(props.minRows ?? MIN_ROWS);
  const lineHeight = 22;
  const limit = () => props.limit;
  const over = () => {
    const cap = limit();
    return cap !== undefined && props.value.length > cap;
  };

  const measure = (element: HTMLTextAreaElement) => {
    const max = props.maxRows ?? 10;
    const lines = Math.ceil((element.scrollHeight - 12) / lineHeight);
    setRows(Math.min(max, Math.max(props.minRows ?? MIN_ROWS, lines)));
  };

  return (
    <span class="input area" classList={{ invalid: props.invalid === true }} style={{ height: `${rows() * lineHeight + 12}px` }}>
      <textarea
        aria-label={props.label}
        aria-invalid={props.invalid === true}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={props.value}
        rows={rows()}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          measure(event.currentTarget);
        }}
        onBlur={() => props.onBlur?.()}
        ref={(element) => queueMicrotask(() => measure(element))}
      />
      <Show when={limit()}>{(cap) => (
        <span class="count" classList={{ over: over() }} aria-live="polite">
          {cap() - props.value.length}
        </span>
      )}</Show>
    </span>
  );
}
