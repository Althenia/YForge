import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DiffView } from "../components/DiffView";
import { FileView } from "../components/FileView";
import { flush, mountWithApp, stubLayout, testSession } from "../components/testkit";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createDiffPrefs } from "../state/diffPrefs";

let stylesheet: HTMLStyleElement;
let dispose: (() => void) | undefined;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const tooLarge = { kind: "file_too_large", message: "a.txt is too large", output: "3145728" };

describe("a size-limit message sits in the pane that could not show the content", () => {
  it("keeps the message of a diff over the limit and of a file over the limit in the flow of the pane body, not pinned over the window", async () => {
    vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
    const restoreLayout = stubLayout();
    mockIPC((cmd) => {
      if (cmd === "diff_file" || cmd === "file_at_revision") throw tooLarge;
      return null;
    });
    const session = testSession("/r", { root: "/r" } as RepoSnapshot);
    const mounted = mountWithApp(() => (
      <>
        <DiffView session={session} target={{ source: "working", area: "unstaged", file: "a.txt" }} prefs={createDiffPrefs()} onClose={() => undefined} onViewFile={() => undefined} />
        <FileView session={session} target={{ file: "a.txt", rev: ":worktree", source: "Working tree" }} onClose={() => undefined} />
      </>
    ));
    dispose = () => {
      mounted.dispose();
      restoreLayout();
    };
    await flush(80);

    const messages = [...mounted.host.querySelectorAll<HTMLElement>(".dbody .graph-error")];
    expect(messages.map((message) => message.textContent)).toEqual([
      "This diff is 3.0 MiB, over the 2.0 MiB limit of the diff view. Open it in your editor instead.",
      "This file is 3.0 MiB, over the 2.0 MiB limit of the file view. Open it in your editor instead.",
    ]);
    for (const message of messages) expect(getComputedStyle(message).position).not.toBe("absolute");
  });
});
