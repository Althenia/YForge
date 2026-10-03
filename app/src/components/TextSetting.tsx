import { createSignal, Show } from "solid-js";

export function TextSetting(props: { label: string; value: string; placeholder?: string; onCommit: (value: string) => void; suffix?: string }) {
  const [draft, setDraft] = createSignal<string | undefined>();
  const shown = () => draft() ?? props.value;
  const commit = () => {
    const value = draft();
    setDraft(undefined);
    if (value !== undefined && value !== props.value) props.onCommit(value);
  };
  return (
    <span class="input">
      <input
        type="text"
        aria-label={props.label}
        value={shown()}
        placeholder={props.placeholder}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
      <Show when={props.suffix}>{(text) => <span class="value-source">{text()}</span>}</Show>
    </span>
  );
}
