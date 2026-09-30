import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createRepoSession } from "../state/repoSession";
import { DiffView } from "./DiffView";
import { flush, mountWithApp, stubLayout } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
  restoreLayout = stubLayout();
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const LINES = 3000;

const bigHunk: DiffHunk = {
  old_start: 1,
  old_lines: 0,
  new_start: 1,
  new_lines: LINES,
  heading: "",
  lines: Array.from({ length: LINES }, (_, index) => ({ kind: "added", old_number: null, new_number: index + 1, text: `line ${index}`, no_newline: false })),
};

describe("diff view", () => {
  it("renders the window of a very large hunk while keeping the hunk focusable and labelled", async () => {
    mockIPC((cmd) => (cmd === "diff_file" ? { path: "big.txt", original_path: null, binary: false, hunks: [bigHunk] } : null));
    const mounted = mountWithApp((app) => (
      <DiffView session={createRoot(() => createRepoSession("/r", { root: "/r" } as RepoSnapshot, app.queryClient))} target={{ source: "working", area: "unstaged", file: "big.txt" }} onClose={() => undefined} />
    ));
    dispose = mounted.dispose;
    await flush(80);

    const rows = mounted.host.querySelectorAll(".dline");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]?.textContent).toContain("line 0");
    expect(mounted.host.querySelectorAll("section.hunk")).toHaveLength(1);
    expect(mounted.host.querySelector("section.hunk")?.getAttribute("aria-label")).toBe(`Hunk 1 of 1, lines 1–${LINES}`);
  });
});
