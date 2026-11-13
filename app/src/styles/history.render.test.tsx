import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FileHistory } from "../components/FileHistory";
import { flush, mountWithApp, stubLayout, testSession } from "../components/testkit";
import type { BlameRun } from "../ipc/bindings/BlameRun";
import type { FileRevision } from "../ipc/bindings/FileRevision";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createDiffPrefs } from "../state/diffPrefs";
import type { FileHistoryRequest } from "../state/fileHistoryRequest";

let stylesheet: HTMLStyleElement;
let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css", "history.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
  restoreLayout = stubLayout();
  Element.prototype.scrollIntoView = () => undefined;
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

const now = Math.floor(Date.now() / 1000);

const revision = (sha: string, summary: string, path: string): FileRevision => ({
  sha: sha.repeat(40),
  short: sha.repeat(7),
  summary,
  author: "Yui Lin",
  email: "yui@example.com",
  time: now - 3600,
  path,
  status: "modified",
});

const longLine = "    if (len(unknownVouchers) == 0 && validateBy(updateBy, assessor)) { return settle(vouchers, assessor); }";

const runs: BlameRun[] = [
  { sha: "a".repeat(40), short: "aaaaaaa", author: "Yui Lin", email: "yui@example.com", time: now - 7200, summary: "Add check", start: 1, lines: ["func check() {", longLine] },
  { sha: "b".repeat(40), short: "bbbbbbb", author: "Arjun Patel", email: "arjun@example.com", time: now - 3600, summary: "Close check", start: 3, lines: ["}"] },
];

function mount(request: FileHistoryRequest, file: string, text = "") {
  mockIPC((cmd) => {
    if (cmd === "file_history") return [revision("b", "Close check", file), revision("a", "Add check", file)];
    if (cmd === "file_blame") return runs;
    if (cmd === "file_at_revision") return { kind: "text", text, size: text.length, eol: "\n" };
    if (cmd === "preview_start") return ["preview-token", `http://127.0.0.1:4321/preview-token/${file}`];
    return null;
  });
  const session = testSession("/r", { root: "/r" } as RepoSnapshot);
  const mounted = mountWithApp(() => <FileHistory session={session} request={request} prefs={createDiffPrefs()} onClose={() => undefined} onSelectCommit={() => undefined} onViewFile={() => undefined} />);
  dispose = mounted.dispose;
  return mounted.host;
}

const pinned = (cell: Element, row: Element): boolean => {
  for (let element: Element | null = cell; element !== null && element !== row; element = element.parentElement) {
    if (getComputedStyle(element).position === "sticky") return true;
  }
  return false;
};

const providedCodeColumns = (row: Element): string | undefined => {
  for (let element: HTMLElement | null = row.parentElement; element !== null; element = element.parentElement) {
    const value = element.style.getPropertyValue("--code-ch");
    if (value !== "") return value;
  }
  return undefined;
};

describe("blame code layout", () => {
  it("scrolls code sideways in the blame body itself, keeping the blame gutter and line numbers pinned beside the code", async () => {
    const host = mount({ file: "check.go", sha: "a".repeat(40), view: "blame" }, "check.go");
    await flush(80);

    const body = host.querySelector<HTMLElement>(".dbody.blame");
    const lines = body?.querySelector<HTMLElement>(".dflat");
    const row = body?.querySelectorAll<HTMLElement>(".fline")[1];
    if (body == null || lines == null || row === undefined) throw new Error("the blame view drew no lines");

    expect(getComputedStyle(body).overflow).toBe("auto");
    expect(getComputedStyle(lines).overflowX).toBe("visible");
    expect(pinned(row.querySelector(".bgut") as Element, row)).toBe(true);
    expect(pinned(row.querySelector(".ln") as Element, row)).toBe(true);
    expect(pinned(row.querySelector(".code") as Element, row)).toBe(false);
  });

  it("sizes every blame row to its widest line so the selected commit's fill spans the whole line", async () => {
    const host = mount({ file: "check.go", sha: "a".repeat(40), view: "blame" }, "check.go");
    await flush(80);

    const selected = [...host.querySelectorAll<HTMLElement>(".blame .fline.blame-selected")];
    expect(selected.map((row) => row.querySelector(".code")?.textContent)).toEqual(["func check() {", longLine]);
    const row = selected[1] as HTMLElement;
    expect(providedCodeColumns(row)).toBe(String(longLine.length));
    expect(getComputedStyle(row).width).toContain("var(--code-ch");
    expect(getComputedStyle(row).minWidth).toBe("100%");
  });
});

describe("history file view layout", () => {
  it("gives the Preview and Source toolbar its own row above the file body", async () => {
    const host = mount({ file: "docs/README.md" }, "docs/README.md", "# Title\n\nText\n");
    await flush(80);
    [...host.querySelectorAll<HTMLButtonElement>('[aria-label="View"] button')].find((button) => button.textContent === "File")?.click();
    await flush(80);

    const pane = host.querySelector<HTMLElement>(".hmain > .hpane");
    if (pane == null) throw new Error("the file view did not open");
    expect(pane.querySelector('[role="toolbar"][aria-label="File view mode"]')).not.toBeNull();
    const placed = [...pane.children].filter((child) => getComputedStyle(child).position !== "absolute");
    const tracks = getComputedStyle(pane).gridTemplateRows.match(/minmax\([^)]*\)|\S+/g) ?? [];
    expect(tracks).toHaveLength(placed.length);
    expect(tracks.at(-1)).toBe("minmax(0, 1fr)");
    expect(placed.at(-1)?.classList.contains("dbody")).toBe(true);
  });
});
