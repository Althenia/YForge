import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlameRun } from "../ipc/bindings/BlameRun";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { FileDiff } from "../ipc/bindings/FileDiff";
import type { FileRevision } from "../ipc/bindings/FileRevision";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createDiffPrefs } from "../state/diffPrefs";
import type { FileHistoryRequest } from "../state/fileHistoryRequest";
import { FileHistory } from "./FileHistory";
import { flush, mountWithApp, stubLayout, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
  restoreLayout = stubLayout();
  Element.prototype.scrollIntoView = () => undefined;
  calls = [];
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
const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

const revision = (sha: string, summary: string, author: string, ago: number, path = "src/util.js"): FileRevision => ({
  sha: sha.repeat(40),
  short: sha.repeat(7),
  summary,
  author,
  email: `${author.split(" ")[0]?.toLowerCase()}@example.com`,
  time: now - ago,
  path,
  status: "modified",
});

const revisions: FileRevision[] = [
  revision("c", "Tune retries and clamp helper", "Yui Lin", 12 * MINUTE),
  revision("b", "Export shout helper", "Arjun Patel", 2 * DAY),
  revision("a", "Add shout helper", "Yui Lin", 28 * DAY, "src/old.js"),
];

const line = (kind: DiffLine["kind"], text: string, old_number: number | null, new_number: number | null): DiffLine => ({ kind, old_number, new_number, text, no_newline: false });

const hunks: DiffHunk[] = [
  { old_start: 1, old_lines: 2, new_start: 1, new_lines: 2, heading: "", lines: [line("context", "const a = 1;", 1, 1), line("removed", "const retries = 3;", 2, null), line("added", "const retries = 5;", null, 2)] },
  { old_start: 20, old_lines: 1, new_start: 20, new_lines: 2, heading: "", lines: [line("context", "tail();", 20, 20), line("added", "export const retryLimit = 5;", null, 21)] },
];

const diff: FileDiff = { path: "src/util.js", original_path: null, binary: false, old_size: null, new_size: null, hunks };

const runs: BlameRun[] = [
  { sha: "a".repeat(40), short: "aaaaaaa", author: "Yui Lin", email: "yui@example.com", time: now - 28 * DAY, summary: "Add shout helper", start: 1, lines: ["const a = 1;", ""] },
  { sha: "b".repeat(40), short: "bbbbbbb", author: "Arjun Patel", email: "arjun@example.com", time: now - 2 * DAY, summary: "Export shout helper", start: 3, lines: ["export const retryLimit = 5;"] },
];

type Respond = (cmd: string, args: Record<string, unknown>) => unknown;

function mount(request: FileHistoryRequest = { file: "src/util.js" }, respond: Respond = () => undefined) {
  mockIPC((cmd, raw) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    calls.push({ cmd, args });
    const custom = respond(cmd, args);
    if (custom !== undefined) return custom;
    if (cmd === "file_history") return revisions;
    if (cmd === "commit_file_diff") return diff;
    if (cmd === "file_blame") return runs;
    if (cmd === "file_at_revision") return { kind: "text", text: "const a = 1;\nexport const retryLimit = 5;\n", size: 42, eol: "\n" };
    return null;
  });
  const session = testSession("/r", { root: "/r" } as RepoSnapshot);
  const prefs = createDiffPrefs();
  const closed = vi.fn();
  const selected: string[] = [];
  const mounted = mountWithApp(() => <FileHistory session={session} request={request} prefs={prefs} onClose={closed} onSelectCommit={(sha) => selected.push(sha)} />);
  dispose = mounted.dispose;
  return { ...mounted, session, prefs, closed, selected };
}

const named = (host: ParentNode, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const pressed = (host: ParentNode, group: string) => [...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button[aria-pressed="true"]`)].map((button) => button.textContent);
const groupButton = (host: ParentNode, group: string, text: string) => [...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find((button) => button.textContent === text);
const called = (cmd: string) => calls.filter((call) => call.cmd === cmd);
const press = (element: Element | null | undefined, key: string) => element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const listbox = (host: ParentNode) => host.querySelector<HTMLElement>('[role="listbox"]');
const activeOption = (host: ParentNode) => {
  const id = listbox(host)?.getAttribute("aria-activedescendant");
  return id === null || id === undefined ? null : document.getElementById(id);
};

describe("file history list", () => {
  it("lists every commit that changed the file with its SHA in mono, summary, author, and age, newest selected", async () => {
    const { host, selected } = mount();
    await flush(80);

    expect(called("file_history")[0]?.args).toEqual({ path: "/r", file: "src/util.js" });
    expect(listbox(host)?.getAttribute("aria-label")).toBe("Commits that changed src/util.js");
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(3);
    expect(options[0]?.querySelector(".mono")?.textContent).toBe("ccccccc");
    expect(options[0]?.textContent).toContain("Tune retries and clamp helper");
    expect(options[0]?.textContent).toContain("Yui Lin");
    expect(options[0]?.textContent).toContain("12m ago");
    expect(options[1]?.textContent).toContain("Arjun Patel");
    expect(options[1]?.textContent).toContain("2d ago");
    expect(activeOption(host)).toBe(options[0]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(selected.at(-1)).toBe("c".repeat(40));
  });

  it("moves the selection with the arrow keys, Home, and End, and shows that commit's change to the file", async () => {
    const { host, selected } = mount();
    await flush(80);
    const list = listbox(host);

    press(list, "ArrowDown");
    await flush(60);
    expect(activeOption(host)?.textContent).toContain("Export shout helper");
    expect(called("commit_file_diff").at(-1)?.args).toMatchObject({ path: "/r", sha: "b".repeat(40), file: "src/util.js" });
    expect(selected.at(-1)).toBe("b".repeat(40));

    press(list, "End");
    await flush(60);
    expect(activeOption(host)?.textContent).toContain("Add shout helper");
    expect(called("commit_file_diff").at(-1)?.args).toMatchObject({ sha: "a".repeat(40), file: "src/old.js" });

    press(list, "ArrowUp");
    await flush(20);
    expect(activeOption(host)?.textContent).toContain("Export shout helper");
    press(list, "Home");
    await flush(20);
    expect(activeOption(host)?.textContent).toContain("Tune retries and clamp helper");
  });

  it("selects the requested commit and opens the requested view", async () => {
    const { host } = mount({ file: "src/util.js", sha: "b".repeat(40), view: "blame" });
    await flush(80);

    expect(activeOption(host)?.textContent).toContain("Export shout helper");
    expect(pressed(host, "View")).toEqual(["Blame"]);
    expect(called("file_blame")[0]?.args).toEqual({ path: "/r", file: "src/util.js", revision: "b".repeat(40) });
  });

  it("says so when no commit changed the file", async () => {
    const { host } = mount({ file: "notes.txt" }, (cmd) => (cmd === "file_history" ? [] : undefined));
    await flush(80);

    expect(host.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(host.textContent).toContain("No commit has changed notes.txt yet.");
  });

  it("closes with Escape and with the close control", async () => {
    const { host, closed } = mount();
    await flush(80);

    press(listbox(host), "Escape");
    expect(closed).toHaveBeenCalledTimes(1);
    named(host, "Close file history")?.click();
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe("file history views", () => {
  it("switches between File, Diff, and Blame", async () => {
    const { host } = mount();
    await flush(80);
    expect(pressed(host, "View")).toEqual(["Diff"]);
    expect(host.querySelectorAll("section.hunk")).toHaveLength(2);

    groupButton(host, "View", "File")?.click();
    await flush(80);
    expect(called("file_at_revision").at(-1)?.args).toEqual({ path: "/r", file: "src/util.js", rev: "c".repeat(40) });
    expect([...host.querySelectorAll(".fline")].map((row) => row.querySelector(".code")?.textContent)).toEqual(["const a = 1;", "export const retryLimit = 5;"]);

    groupButton(host, "View", "Blame")?.click();
    await flush(80);
    expect(host.querySelectorAll(".bgut button")).toHaveLength(2);
    expect(host.querySelectorAll("section.hunk")).toHaveLength(0);
  });

  it("shows a blame gutter per run with SHA, author, and age, and choosing an entry selects that commit", async () => {
    const { host } = mount({ file: "src/util.js", view: "blame" });
    await flush(80);

    const rows = [...host.querySelectorAll(".blame .fline")];
    expect(rows.map((row) => row.querySelector(".code")?.textContent)).toEqual(["const a = 1;", "", "export const retryLimit = 5;"]);
    const entries = [...host.querySelectorAll<HTMLButtonElement>(".bgut button")];
    expect(entries[0]?.querySelector(".mono")?.textContent).toBe("aaaaaaa");
    expect(entries[0]?.textContent).toContain("Yui Lin");
    expect(entries[0]?.textContent).toContain("4w ago");
    expect(entries[1]?.textContent).toContain("Arjun Patel");
    expect(rows[1]?.querySelector(".bgut button")).toBeNull();

    entries[1]?.click();
    await flush(80);

    expect(activeOption(host)?.textContent).toContain("Export shout helper");
    expect(activeOption(host)?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("file history diff", () => {
  it("offers Hunk, Inline, and Split through the shared diff preferences", async () => {
    const { host, prefs } = mount();
    await flush(80);

    expect(pressed(host, "Diff mode")).toEqual(["Hunk"]);
    groupButton(host, "Diff mode", "Split")?.click();
    await flush(60);
    expect(prefs.mode()).toBe("split");
    expect(host.querySelectorAll(".dsplit").length).toBeGreaterThan(0);
    groupButton(host, "Diff mode", "Inline")?.click();
    await flush(60);
    expect(prefs.mode()).toBe("inline");
    expect(host.querySelectorAll(".dflat .dline").length).toBeGreaterThan(0);
  });

  it("moves between hunks with previous and next hunk", async () => {
    const { host } = mount();
    await flush(80);
    const sections = () => host.querySelectorAll("section.hunk");

    named(host, "Next hunk")?.click();
    expect(document.activeElement).toBe(sections()[0]);
    named(host, "Next hunk")?.click();
    expect(document.activeElement).toBe(sections()[1]);
    named(host, "Previous hunk")?.click();
    expect(document.activeElement).toBe(sections()[0]);
  });

  it("asks for the diff without whitespace changes and blocks Revert hunk with the reason while Ignore whitespace is on", async () => {
    const { host, prefs } = mount();
    await flush(80);

    host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Ignore whitespace"]')?.click();
    await flush(80);

    expect(prefs.ignoreWhitespace()).toBe(true);
    expect(called("commit_file_diff").at(-1)?.args).toMatchObject({ sha: "c".repeat(40), file: "src/util.js", ignoreWhitespace: true });
    const revert = named(host, "Revert hunk");
    expect(revert?.getAttribute("aria-disabled")).toBe("true");
    expect(revert?.getAttribute("data-tip")).toBe("Turn off Ignore whitespace to revert a hunk");
    revert?.click();
    await flush();
    expect(called("revert_hunk")).toEqual([]);
  });

  it("reverts one hunk of the selected commit into the working tree", async () => {
    const { host, session } = mount();
    await flush(80);

    const reverts = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Revert hunk"]')];
    expect(reverts).toHaveLength(2);
    expect(reverts[1]?.textContent).toContain("Revert hunk");
    reverts[1]?.click();
    await flush(60);

    expect(called("revert_hunk")).toEqual([{ cmd: "revert_hunk", args: { path: "/r", sha: "c".repeat(40), file: "src/util.js", hunk: 1 } }]);
    expect(session.notice()).toBe("Reverted a hunk of src/util.js from ccccccc. The change is in Unstaged; nothing is committed.");
  });

  it("shows the core's refusal when the hunk no longer applies", async () => {
    const refusal = "This hunk changed again after ccccccc, so it cannot be reverted. Nothing was changed.";
    const { host, session } = mount({ file: "src/util.js" }, (cmd) => {
      if (cmd === "revert_hunk") throw { kind: "stale_hunk", message: refusal, output: null };
      return undefined;
    });
    await flush(80);

    named(host, "Revert hunk")?.click();
    await flush(60);

    expect(session.notice()).toBe(refusal);
  });
});
