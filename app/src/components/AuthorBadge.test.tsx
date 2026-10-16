import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Suspense } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAvatars } from "../state/avatar";
import { AuthorBadge } from "./AuthorBadge";
import { flush, mountWithApp } from "./testkit";

const ADDRESS = "https://www.gravatar.com/avatar/2befe04c9ff31d77bff2c10f99ffaa3b?s=48&d=identicon";

const requested: string[] = [];
let asked: string[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = "";
  set src(address: string) {
    requested.push(address);
    queueMicrotask(() => (address === ADDRESS && asked.includes("missing@example.com") ? this.onerror?.() : this.onload?.()));
  }
}

let view: { host: HTMLElement; app: { boot: () => Promise<void> }; dispose: () => void } | undefined;

const mount = async (name: string, email?: string | null, avatars = true, options: { answerAfter?: number; suspense?: boolean } = {}) => {
  asked = [];
  mockIPC(
    (cmd, args) => {
      if (cmd === "avatar_url") {
        const address = String((args as { email: string }).email);
        asked.push(address);
        if (options.answerAfter !== undefined) return new Promise((resolve) => setTimeout(() => resolve(ADDRESS), options.answerAfter));
        return address.includes("missing") ? null : ADDRESS;
      }
      if (cmd === "settings_load") {
        return {
          theme: "system",
          density: "default",
          default_branch: "main",
          pull_mode: "fast_forward_or_merge",
          auto_fetch_minutes: 0,
          editor_command: "",
          terminal_command: "",
          telemetry_opt_in: false,
          gravatar_avatars: avatars,
        };
      }
      if (cmd === "repo_aliases_list") return [];
      if (cmd === "session_load") return { tabs: [], active: null, groups: [] };
      if (cmd === "activity_list") return [];
      if (cmd === "recents_list") return [];
      if (cmd === "launch_path") return null;
      if (cmd === "repo_open") {
        return {
          main_root: "/r",
          path: "/r",
          head: null,
          branches: [],
          remote_branches: [],
          remotes: [],
          tags: [],
          stashes: [],
          worktrees: [],
          counts: { changed: 0, staged: 0 },
          operation: null,
          fetched_at: null,
          ahead: 0,
          behind: 0,
        };
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  view = mountWithApp(() =>
    options.suspense === true ? (
      <Suspense fallback={<p>fallback</p>}>
        <AuthorBadge name={name} email={email} />
      </Suspense>
    ) : (
      <AuthorBadge name={name} email={email} />
    ),
  );
  await view.app.boot();
};

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  forgetAvatars();
  view?.dispose();
  view = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  clearMocks();
});

const badge = () => view?.host.querySelector(".avatar") as HTMLElement;

describe("author badge", () => {
  it("shows the initial at once, then the gravatar once it has loaded, asking the core for the address", async () => {
    await mount("Yui", "yui@example.com");
    expect(badge().textContent).toBe("Y");

    await flush(150);

    expect(badge().querySelector("img")?.getAttribute("src")).toBe(ADDRESS);
    expect(asked).toEqual(["yui@example.com"]);
    expect(badge().getAttribute("aria-hidden")).toBe("true");
  });

  it("makes no request and shows the initial while the privacy setting is off", async () => {
    await mount("Bo", "bo@example.com", false);
    await flush(120);

    expect(asked).toEqual([]);
    expect(requested).toEqual([]);
    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("B");
  });

  it("falls back to the initial when the core finds no address", async () => {
    await mount("Missing", "missing@example.com");
    await flush(150);

    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("M");
  });

  it("never shows an enclosing Suspense fallback while the picture loads", async () => {
    await mount("Yui", "yui@example.com", true, { answerAfter: 60, suspense: true });
    expect(view?.host.textContent).not.toContain("fallback");
    expect(badge().textContent).toBe("Y");

    await flush(20);
    expect(view?.host.textContent).not.toContain("fallback");
    expect(badge().querySelector("img")).toBeNull();

    await flush(150);
    expect(view?.host.textContent).not.toContain("fallback");
    expect(badge().querySelector("img")?.getAttribute("src")).toBe(ADDRESS);
  });

  it("shows the initial when only the name is known", async () => {
    await mount("Ada");
    await flush(150);

    expect(asked).toEqual([]);
    expect(badge().querySelector("img")).toBeNull();
    expect(badge().textContent).toBe("A");
  });
});
