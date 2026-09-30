import { createSignal } from "solid-js";

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21] as const;
const SINES = Uint32Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));
const HEX_DIGITS = 2;

const rotateLeft = (value: number, shift: number): number => (value << shift) | (value >>> (32 - shift));

export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(length - 4, Math.floor((bytes.length * 8) / 2 ** 32), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < length; offset += 64) {
    let [a, b, c, d] = state as [number, number, number, number];
    for (let step = 0; step < 64; step++) {
      let mixed: number;
      let word: number;
      if (step < 16) {
        mixed = (b & c) | (~b & d);
        word = step;
      } else if (step < 32) {
        mixed = (d & b) | (~d & c);
        word = (5 * step + 1) % 16;
      } else if (step < 48) {
        mixed = b ^ c ^ d;
        word = (3 * step + 5) % 16;
      } else {
        mixed = c ^ (b | ~d);
        word = (7 * step) % 16;
      }
      const sum = (a + mixed + (SINES[step] as number) + view.getUint32(offset + word * 4, true)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[(step >> 4) * 4 + (step % 4)] as number)) >>> 0;
    }
    [a, b, c, d].forEach((value, index) => {
      state[index] = ((state[index] as number) + value) >>> 0;
    });
  }
  return state
    .map((word) => [0, 1, 2, 3].map((byte) => ((word >>> (8 * byte)) & 0xff).toString(16).padStart(HEX_DIGITS, "0")).join(""))
    .join("");
}

export const gravatarUrl = (email: string): string => `https://www.gravatar.com/avatar/${md5Hex(email.trim().toLowerCase())}?s=48&d=identicon`;

export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
}

const [enabled, setEnabled] = createSignal(true);

export const gravatarEnabled = enabled;
export const setGravatarEnabled = setEnabled;

const loaded = new Map<string, Promise<string | undefined>>();

export function loadAvatar(email: string): Promise<string | undefined> {
  const url = gravatarUrl(email);
  let pending = loaded.get(url);
  if (pending === undefined) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.onload = () => resolve(url);
      image.onerror = () => resolve(undefined);
      image.src = url;
    });
    loaded.set(url, pending);
  }
  return pending;
}
