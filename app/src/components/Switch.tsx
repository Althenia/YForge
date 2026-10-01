export function Switch(props: { label: string; checked: boolean; disabled?: boolean; disabledReason?: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      class="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      disabled={props.disabled}
      title={props.disabled === true ? props.disabledReason : undefined}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}
