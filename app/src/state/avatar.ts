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
}
