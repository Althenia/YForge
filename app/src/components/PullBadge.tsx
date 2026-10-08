import { Show } from "solid-js";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import { client } from "../ipc/client";
import { pullBadgeName, type ChecksState } from "../state/platformModel";
import { useQuery } from "../state/query";
import { platformKeys } from "../state/queryKeys";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

const CHECKS_FRESH_MS = 30_000;

export function PullBadge(props: { path: string; pull: PullRequest; onOpen: (number: number) => void }) {
  const checks = useQuery(() => ({
    queryKey: platformKeys.checks(props.path, props.pull.number),
    queryFn: () => client.platformPrChecks(props.path, props.pull.number),
    staleTime: CHECKS_FRESH_MS,
  }));
  const state = (): ChecksState => (checks.isSuccess ? (checks.data ?? null) : checks.isError ? "unavailable" : "loading");
  const name = () => pullBadgeName(props.pull, state());
  return (
    <button
      type="button"
      class="pr-badge"
      tabindex="-1"
      {...tip(name())}
      onPointerDown={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen(props.pull.number);
      }}
    >
      <Icon name="pullrequest" size={14} />
      <span class="mono">#{props.pull.number}</span>
      <Show when={props.pull.draft}>
        <span class="pr-draft">Draft</span>
      </Show>
    </button>
  );
}
