import { createResource, Show } from "solid-js";
import { useApp } from "../state/app";
import { avatarsEnabled, avatarInitial, loadAvatar } from "../state/avatar";

export function AuthorBadge(props: { name: string; email?: string | null }) {
  const app = useApp();
  const requested = () => (app.ready() && avatarsEnabled(app.settings()) && props.email ? props.email : undefined);
  const [address] = createResource(requested, loadAvatar);
  return (
    <span class="avatar" aria-hidden="true">
      <Show when={address()} fallback={avatarInitial(props.name)}>
        {(url) => <img src={url()} alt="" referrerPolicy="no-referrer" decoding="async" />}
      </Show>
    </span>
  );
}
