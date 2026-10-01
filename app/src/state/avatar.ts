import { createSignal } from "solid-js";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import { client } from "../ipc/client";

const SESSION_LIMIT = 200;
const loaded = new Map<string, Promise<string | undefined>>();

export function avatarsEnabled(settings: AppSettings | undefined): boolean {
  return settings?.gravatar_avatars !== false;
}

export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
}

export async function avatarUrl(email: string): Promise<string | undefined> {
  return (await client.avatarUrl(email)) ?? undefined;
}

export function loadAvatar(email: string): Promise<string | undefined> {
  const cached = loaded.get(email);
  if (cached !== undefined) return cached;
  const pending = (async () => {
    const url = await avatarUrl(email);
    if (url === undefined) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => resolve(url);
      image.onerror = () => resolve(undefined);
      image.src = url;
    });
  })();
  if (loaded.size >= SESSION_LIMIT) loaded.clear();
  loaded.set(email, pending);
  return pending;
}

export function forgetAvatars(): void {
  loaded.clear();
  inGraph.clear();
  setReady(0);
}

/// The addresses already fetched, and whether each image has finished loading.
const inGraph = new Map<string, { url: string; loaded: boolean }>();
const [ready, setReady] = createSignal(0);

/// The address to draw for an email, kicking off the lookup on first call.
///
/// Returns undefined until the image has loaded, so the caller can keep drawing
/// the initials until the picture is really available.
export function ensureGraphAvatar(email: string | undefined): string | undefined {
  if (email === undefined || email === "") return undefined;
  const known = inGraph.get(email);
  if (known !== undefined) return known.loaded ? known.url : undefined;
  inGraph.set(email, { url: "", loaded: false });
  void avatarUrl(email).then(
    (url) => {
      if (url === undefined) return;
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        inGraph.set(email, { url, loaded: true });
        setReady((value: number) => value + 1);
      };
      image.src = url;
    },
    () => undefined,
  );
  return undefined;
}

export const graphAvatarRevision = ready;
