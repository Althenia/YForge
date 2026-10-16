import { Show } from "solid-js";
import { useApp } from "../state/app";
import { avatarAddress, avatarsEnabled, avatarInitial } from "../state/avatar";

export function AuthorBadge(props: { name: string; email?: string | null }) {
  const app = useApp();
  const address = () => (app.ready() && avatarsEnabled(app.settings()) ? avatarAddress(props.email) : undefined);
  return (
    <span class="avatar" aria-hidden="true">
      <Show when={address()} fallback={avatarInitial(props.name)}>
        {(url) => <img src={url()} alt="" referrerPolicy="no-referrer" decoding="async" />}
      </Show>
    </span>
  );
}
