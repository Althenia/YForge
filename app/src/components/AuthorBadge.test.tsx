import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { gravatarUrl, setGravatarEnabled } from "../state/avatar";
import { AuthorBadge } from "./AuthorBadge";
import { flush } from "./testkit";

const requested: string[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = "";
  set src(address: string) {
    requested.push(address);
    queueMicrotask(() => (address === gravatarUrl("missing@example.com") ? this.onerror?.() : this.onload?.()));
  }
}

let host: HTMLElement;
let dispose: () => void;

const mount = (name: string, email?: string | null) => {
  host = document.createElement("div");
  document.body.append(host);
  dispose = createRoot(() => render(() => <AuthorBadge name={name} email={email} />, host));
};

beforeEach(() => {
  requested.length = 0;
  setGravatarEnabled(true);
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  dispose();
  host.remove();
  vi.unstubAllGlobals();
  setGravatarEnabled(true);
});

const badge = () => host.querySelector(".avatar") as HTMLElement;

describe("author badge", () => {
  it("shows the initial at once, then the gravatar once it has loaded, requesting only the hashed address", async () => {
    mount("Yui", "yui@example.com");
    expect(badge().textContent).toBe("Y");

    await flush();

    expect(badge().querySelector("img")?.getAttribute("src")).toBe(gravatarUrl("yui@example.com"));
    expect(requested).toEqual([gravatarUrl("yui@example.com")]);
    expect(requested.join()).not.toContain("yui@example.com");
    expect(badge().getAttribute("aria-hidden")).toBe("true");
  });

  it("makes no request and shows the initial while the privacy toggle is off, and stops showing a loaded image when it is turned off", async () => {
    setGravatarEnabled(false);
    mount("Bo", "bo@example.com");
    await flush();
    expect(requested).toEqual([]);
    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("B");

    setGravatarEnabled(true);
    await flush();
    expect(badge().querySelector("img")).not.toBeNull();
    setGravatarEnabled(false);
    await flush();
    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("B");
  });

  it("falls back to the initial when the image fails to load", async () => {
    mount("Mia", "missing@example.com");
    await flush();

    expect(requested).toEqual([gravatarUrl("missing@example.com")]);
    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("M");
  });

  it("shows only the initial, with no request, when the author has no email", async () => {
    mount("chen");
    await flush();

    expect(requested).toEqual([]);
    expect(badge().textContent).toBe("C");
  });

  it("requests an address once per session however many badges show it", async () => {
    mount("Kai", "kai@example.com");
    await flush();
    const first = dispose;
    const firstHost = host;
    mount("Kai", "KAI@example.com ");
    await flush();

    expect(requested).toEqual([gravatarUrl("kai@example.com")]);
    first();
    firstHost.remove();
  });
});
