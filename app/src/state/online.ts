import { createSignal, onCleanup } from "solid-js";

export function createOnline(): () => boolean {
  const [online, setOnline] = createSignal(navigator.onLine);
  const up = () => setOnline(true);
  const down = () => setOnline(false);
  window.addEventListener("online", up);
  window.addEventListener("offline", down);
  onCleanup(() => {
    window.removeEventListener("online", up);
    window.removeEventListener("offline", down);
  });
  return online;
}
