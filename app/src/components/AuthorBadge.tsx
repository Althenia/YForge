import { createResource, Show } from "solid-js";
import { gravatarEnabled, initialOf, loadAvatar } from "../state/avatar";

export function AuthorBadge(props: { name: string; email?: string | null }) {
  const [address] = createResource(() => (gravatarEnabled() && props.email ? props.email : undefined), loadAvatar);
  return (
    <span class="avatar" aria-hidden="true">
      <Show when={gravatarEnabled() ? address() : undefined} fallback={initialOf(props.name)}>
        {(source) => <img src={source()} alt="" referrerPolicy="no-referrer" decoding="async" />}
      </Show>
    </span>
  );
}
