import { createEffect, createSignal, Show } from "solid-js";

export function TextSetting(props: { label: string; value: string; placeholder?: string; disabled?: boolean; onCommit: (value: string) => void; suffix?: string }) {
  const [draft, setDraft] = createSignal<string | undefined>();
  const shown = () => draft() ?? props.value;
  createEffect(() => { if (draft() !== undefined && draft() === props.value) setDraft(undefined); });
  const commit = () => {
    if (props.disabled) return;
    const value = draft();
    if (value === props.value) setDraft(undefined);
    else if (value !== undefined) props.onCommit(value);
  };
  return (
    <span class="input">
      <input
        type="text"
        aria-label={props.label}
        value={shown()}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
      <Show when={props.suffix}>{(text) => <span class="value-source">{text()}</span>}</Show>
    </span>
  );
}
