export function Switch(props: { label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" class="switch" aria-label={props.label} aria-checked={props.checked} disabled={props.disabled} onClick={() => props.onChange(!props.checked)} />
  );
}
