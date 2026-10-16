import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createEffect, createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avatarAddress, avatarsEnabled, avatarInitial, forgetAvatars, loadAvatar } from "./avatar";

const ADDRESS = "https://www.gravatar.com/avatar/2befe04c9ff31d77bff2c10f99ffaa3b?s=48&d=identicon";

let asked: string[] = [];
let images: Array<{ load: () => void; fail: () => void }> = [];

class HeldImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = "";
  set src(_address: string) {
    images.push({ load: () => this.onload?.(), fail: () => this.onerror?.() });
  }
}

beforeEach(() => {
  asked = [];
  images = [];
  vi.stubGlobal("Image", HeldImage);
  mockIPC((cmd, args) => {
    if (cmd !== "avatar_url") return null;
    const email = String((args as { email: string }).email);
    asked.push(email);
    return email.startsWith("none") ? null : ADDRESS;
  });
});

afterEach(() => {
  forgetAvatars();
  vi.unstubAllGlobals();
  clearMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function track(email: string | null | undefined) {
  const seen: Array<string | undefined> = [];
  const dispose = createRoot((disposeRoot) => {
    createEffect(() => seen.push(avatarAddress(email)));
    return disposeRoot;
  });
  return { seen, dispose };
}

describe("graph avatar address", () => {
  it("is undefined and asks for nothing when the email is missing or empty", async () => {
    expect(avatarAddress(undefined)).toBeUndefined();
    expect(avatarAddress(null)).toBeUndefined();
    expect(avatarAddress("")).toBeUndefined();
    await settle();
    expect(asked).toEqual([]);
    expect(images).toEqual([]);
  });

  it("stays undefined until the picture has loaded, then re-runs a tracking computation with the address", async () => {
    const { seen, dispose } = track("yui@example.com");
    await settle();
    expect(seen).toEqual([undefined]);
    expect(images).toHaveLength(1);

    images[0]?.load();
    await settle();

    expect(seen).toEqual([undefined, ADDRESS]);
    dispose();
  });

  it("makes one lookup per email across repeated reads and loadAvatar", async () => {
    const first = track("yui@example.com");
    const second = track("yui@example.com");
    avatarAddress("yui@example.com");
    void loadAvatar("yui@example.com");
    await settle();

    expect(asked).toEqual(["yui@example.com"]);
    expect(images).toHaveLength(1);

    images[0]?.load();
    await settle();
    expect(first.seen.at(-1)).toBe(ADDRESS);
    expect(second.seen.at(-1)).toBe(ADDRESS);
    expect(await loadAvatar("yui@example.com")).toBe(ADDRESS);
    expect(asked).toEqual(["yui@example.com"]);
    first.dispose();
    second.dispose();
  });

  it("stays undefined when the image fails to load", async () => {
    const { seen, dispose } = track("yui@example.com");
    await settle();
    images[0]?.fail();
    await settle();

    expect(seen).toEqual([undefined]);
    expect(avatarAddress("yui@example.com")).toBeUndefined();
    dispose();
  });

  it("stays undefined when the core has no address, loading no image", async () => {
    const { seen, dispose } = track("none@example.com");
    await settle();

    expect(asked).toEqual(["none@example.com"]);
    expect(images).toEqual([]);
    expect(seen).toEqual([undefined]);
    dispose();
  });

  it("starts a new lookup after forgetAvatars", async () => {
    avatarAddress("yui@example.com");
    await settle();
    images[0]?.load();
    await settle();
    expect(avatarAddress("yui@example.com")).toBe(ADDRESS);

    forgetAvatars();
    expect(avatarAddress("yui@example.com")).toBeUndefined();
    await settle();

    expect(asked).toEqual(["yui@example.com", "yui@example.com"]);
  });
});

describe("author initial", () => {
  it("uses the first letter of the name, upper-cased, and a question mark for no name", () => {
    expect(avatarInitial("yui")).toBe("Y");
    expect(avatarInitial("  Étienne")).toBe("É");
    expect(avatarInitial("")).toBe("?");
  });
});

describe("avatar preference", () => {
  it("is on unless the saved setting turns it off", () => {
    expect(avatarsEnabled(undefined)).toBe(true);
    expect(avatarsEnabled({ gravatar_avatars: true } as never)).toBe(true);
    expect(avatarsEnabled({ gravatar_avatars: false } as never)).toBe(false);
  });
});
