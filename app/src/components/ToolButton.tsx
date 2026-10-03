import type { IconName } from "../iconNames";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function ToolButton(props: { action: string; name?: string; icon: IconName; reason: string | undefined; row?: boolean; onRun: () => void }) {
  const text = () => [props.action, props.reason].filter((part) => part !== undefined).join(". ");
  return (
    <button
      type="button"
      class="icon-btn dense"
      tabindex={props.row === true ? "-1" : undefined}
      {...tip(text(), undefined, props.name ?? props.action)}
      aria-disabled={props.reason === undefined ? undefined : "true"}
      onClick={(event) => {
        event.stopPropagation();
        if (props.reason === undefined) props.onRun();
      }}
    >
      <Icon name={props.icon} />
    </button>
  );
}
