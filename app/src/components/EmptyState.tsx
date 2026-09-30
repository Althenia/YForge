import { Show } from "solid-js";

export function EmptyState(props: { title: string; message: string; path?: string; danger?: boolean }) {
  return (
    <main class="empty-view">
      <div class="empty-box" classList={{ danger: props.danger === true }} role={props.danger ? "alert" : "status"}>
        <h1>{props.title}</h1>
        <Show when={props.path}>{(path) => <p class="ref path-line"><bdi dir="ltr">{path()}</bdi></p>}</Show>
        <p>{props.message}</p>
      </div>
    </main>
  );
}
