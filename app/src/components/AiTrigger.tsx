import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function AiTrigger(props: { action: string; reason: string | undefined; onRun: () => void }) {
  const text = () => [props.action, props.reason].filter((part) => part !== undefined).join(". ");
  return (
    <button
      type="button"
      class="icon-btn dense ai-btn"
      {...tip(text())}
      aria-disabled={props.reason === undefined ? undefined : "true"}
      onClick={() => props.reason === undefined && props.onRun()}
    >
      <Icon name="wand" size={14} />
    </button>
  );
}
