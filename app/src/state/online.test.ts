import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnline } from "./online";

afterEach(() => vi.restoreAllMocks());

describe("online state", () => {
  it("follows the browser's online and offline events", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    createRoot((dispose) => {
      const online = createOnline();
      expect(online()).toBe(true);
      window.dispatchEvent(new Event("offline"));
      expect(online()).toBe(false);
      window.dispatchEvent(new Event("online"));
      expect(online()).toBe(true);
      dispose();
    });
  });

  it("starts offline when the browser reports no connection and stops listening on cleanup", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    let online: () => boolean = () => true;
    createRoot((dispose) => {
      online = createOnline();
      expect(online()).toBe(false);
      dispose();
    });
    window.dispatchEvent(new Event("online"));
    expect(online()).toBe(false);
  });
});
