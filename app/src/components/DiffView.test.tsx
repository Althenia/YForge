import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { FileDiff } from "../ipc/bindings/FileDiff";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { DiffTarget } from "../state/diffModel";
import { createDiffPrefs } from "../state/diffPrefs";
import { buttonNamed, flush, mountWithApp, stubLayout, testSession } from "./testkit";
import type { FileViewTarget } from "../state/fileView";
import { takeFileHistoryRequest, type FileHistoryRequest } from "../state/fileHistoryRequest";
import { DiffView } from "./DiffView";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let toolsStatus: unknown = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };

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
  calls = [];
  toolsStatus = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };
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

const line = (kind: DiffLine["kind"], text: string, old_number: number | null, new_number: number | null, no_newline = false): DiffLine => ({
  kind,
  old_number,
  new_number,
  text,
  no_newline,
});

const first: DiffHunk = {
  old_start: 3,
  old_lines: 3,
  new_start: 3,
  new_lines: 4,
  heading: "",
  lines: [
    line("context", "import { run } from './run';", 3, 3),
    line("removed", "const retries = 3;", 4, null),
    line("added", "const retries = 5;", null, 4),
    line("added", "const extra = true;", null, 5),
    line("context", "export {};", 5, 6),
  ],
};

const second: DiffHunk = {
  old_start: 40,
  old_lines: 3,
  new_start: 41,
  new_lines: 2,
  heading: "",
  lines: [line("context", "tail();", 40, 41), line("removed", "old();", 41, null), line("context", "done();", 42, 42)],
};

const diff: FileDiff = { path: "src/app.ts", original_path: null, binary: false, old_size: null, new_size: null, hunks: [first, second] };

const working = (area: "unstaged" | "staged" = "unstaged"): DiffTarget => ({ source: "working", area, file: "src/app.ts" });

function mount(target: DiffTarget, result: FileDiff | (() => FileDiff) = diff, prefs = createDiffPrefs(), viewed: FileViewTarget[] = []) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "external_tools_status") return toolsStatus;
    return cmd === "diff_file" || cmd === "commit_file_diff" || cmd === "stash_file_diff" || cmd === "revision_file_diff" ? (typeof result === "function" ? result() : result) : null;
  });
  const mounted = mountWithApp(() => (
    <DiffView session={testSession("/r", { root: "/r" } as RepoSnapshot)} target={target} prefs={prefs} onClose={() => undefined} onViewFile={(view) => viewed.push(view)} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, prefs };
}

const named = (host: ParentNode, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const called = (cmd: string) => calls.filter((call) => call.cmd === cmd);
const click = (element: Element | null | undefined, init: MouseEventInit = {}) =>
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
const press = (element: Element | null | undefined, key: string, init: KeyboardEventInit = {}) =>
  element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));

describe("line selection and line commands", () => {
  it("sizes every row to the widest line, so a long line's tint reaches its end (S18)", async () => {
    const long = "x".repeat(140);
    const { host } = mount(working(), { ...diff, hunks: [{ ...first, lines: [...first.lines, line("added", long, null, 6)] }, second] });
    await flush(40);

    expect(host.querySelector<HTMLElement>(".dbody")?.style.getPropertyValue("--code-ch")).toBe("140");
  });

  it("selects with a click, extends with shift-click, and stages the chosen lines", async () => {
    const { host } = mount(working());
    await flush(60);

    click(named(host, "Select removed line 4"));
    await flush();
    expect(named(host, "Select removed line 4")?.getAttribute("aria-checked")).toBe("true");
    click(named(host, "Select added line 5"), { shiftKey: true });
    await flush();

    expect(host.querySelector('[aria-label="Selected lines"]')?.textContent).toContain("3 lines selected");
    click(named(host, "Stage lines"));
    await flush();

    expect(called("stage_lines")).toEqual([{ cmd: "stage_lines", args: { path: "/r", file: "src/app.ts", hunk: first, lines: [1, 2, 3] } }]);
  });

  it("toggles one line off again and clears the selection with the clear button", async () => {
    const { host } = mount(working());
    await flush(60);

    click(named(host, "Select removed line 4"));
    click(named(host, "Select added line 4"));
    await flush();
    click(named(host, "Select removed line 4"));
    await flush();
    expect(host.querySelector('[aria-label="Selected lines"]')?.textContent).toContain("1 line selected");
    click(named(host, "Clear selection"));
    await flush();

    expect(host.querySelector('[aria-label="Selected lines"]')).toBeNull();
  });

  it("moves between changed lines with the arrow keys, extends with shift, and stages with S", async () => {
    const { host } = mount(working());
    await flush(60);
    const firstLine = named(host, "Select removed line 4");
    firstLine?.focus();

    press(firstLine, "ArrowDown", { shiftKey: true });
    await flush();

    expect(document.activeElement).toBe(named(host, "Select added line 4"));
    expect(host.querySelector('[aria-label="Selected lines"]')?.textContent).toContain("2 lines selected");
    press(document.activeElement, "s");
    await flush();

    expect(called("stage_lines")[0]?.args.lines).toEqual([1, 2]);
  });

  it("stages just the focused line when nothing is selected", async () => {
    const { host } = mount(working());
    await flush(60);
    const target = named(host, "Select added line 5");
    target?.focus();

    press(target, "s");
    await flush();

    expect(called("stage_lines")[0]?.args.lines).toEqual([3]);
  });

  it("asks before discarding lines and discards them after confirming", async () => {
    const { host } = mount(working());
    await flush(60);
    click(named(host, "Select added line 5"));
    await flush();

    click(host.querySelector('[aria-label="Selected lines"] button.text-danger'));
    await flush();
    expect(called("discard_lines")).toEqual([]);
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Discard 1 selected line?");
    click(buttonNamed(dialog ?? document.body, "Discard lines"));
    await flush();

    expect(called("discard_lines")).toEqual([{ cmd: "discard_lines", args: { path: "/r", file: "src/app.ts", hunk: first, lines: [3] } }]);
  });

  it("offers only Unstage for a staged file", async () => {
    const { host } = mount(working("staged"));
    await flush(60);
    click(named(host, "Select removed line 4"));
    await flush();

    const group = host.querySelector('[aria-label="Selected lines"]');
    expect(named(group ?? host, "Unstage lines")).not.toBeNull();
    expect(named(group ?? host, "Stage lines")).toBeNull();
    click(named(group ?? host, "Unstage lines"));
    await flush();

    expect(called("unstage_lines")[0]?.args.lines).toEqual([1]);
  });

  it("keeps hunk actions working", async () => {
    const { host } = mount(working());
    await flush(60);

    click(host.querySelector('section.hunk button[aria-label="Stage hunk"]'));
    await flush();

    expect(called("stage_hunk")[0]?.args.hunk).toEqual(first);
  });

  it("offers no selection for a commit diff", async () => {
    const { host } = mount({ source: "commit", sha: "abc1234", file: "src/app.ts" });
    await flush(60);

    expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
    expect(host.querySelector(".dline")?.textContent).toContain("import");
  });
});

describe("ignore whitespace", () => {
  it("requests the diff again with ignoreWhitespace and disables staging with the reason", async () => {
    const { host } = mount(working());
    await flush(60);
    expect(called("diff_file")[0]?.args).toEqual({ path: "/r", file: "src/app.ts", area: "unstaged" });

    click(host.querySelector('button[role="switch"][aria-label="Ignore whitespace"]'));
    await flush(60);

    expect(called("diff_file").at(-1)?.args).toEqual({ path: "/r", file: "src/app.ts", area: "unstaged", ignoreWhitespace: true });
    expect(host.textContent).toContain("Turn off Ignore whitespace to stage changes");
    const stageHunk = named(host, "Stage hunk");
    expect(stageHunk?.getAttribute("aria-disabled")).toBe("true");
    expect(stageHunk?.getAttribute("data-tip")).toBe("Turn off Ignore whitespace to stage changes");
    click(stageHunk);
    click(named(host, "Select removed line 4"));
    await flush();
    expect(called("stage_hunk")).toEqual([]);
    expect(host.querySelector('[aria-label="Selected lines"]')).toBeNull();
  });

  it("is not offered for a commit diff, which has no whitespace option", async () => {
    const { host } = mount({ source: "commit", sha: "abc1234", file: "src/app.ts" });
    await flush(60);

    expect(host.querySelector('[aria-label="Ignore whitespace"]')).toBeNull();
  });
});

describe("diff modes", () => {
  it("shows split rows with the removed line beside the added one", async () => {
    const { host } = mount(working());
    await flush(60);

    click(buttonNamed(host, "Split"));
    await flush(60);

    const rows = [...host.querySelectorAll(".dsplit")];
    const changed = rows.find((row) => row.textContent?.includes("const retries = 3;"));
    expect(changed?.textContent).toContain("const retries = 5;");
    expect(changed?.querySelectorAll(".half")).toHaveLength(2);
    expect(changed?.querySelector(".half.old")?.textContent).toContain("const retries = 3;");
    expect(changed?.querySelector(".half.new")?.textContent).toContain("const retries = 5;");
    expect(buttonNamed(host, "Split")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows one continuous list with a gap between hunks in inline mode", async () => {
    const { host } = mount(working());
    await flush(60);

    click(buttonNamed(host, "Inline"));
    await flush(60);

    expect(host.querySelectorAll("section.hunk")).toHaveLength(0);
    expect([...host.querySelectorAll(".dgap")].map((gap) => gap.textContent)).toEqual(["2 unchanged lines", "34 unchanged lines"]);
    expect(host.querySelectorAll(".dhunk")).toHaveLength(2);
    expect(host.querySelector(".dline.del")?.textContent).toContain("const retries = 3;");
  });

  it("keeps the chosen mode when the view is mounted again", async () => {
    const prefs = createDiffPrefs();
    const opened = mount(working(), diff, prefs);
    await flush(60);
    click(buttonNamed(opened.host, "Split"));
    await flush();
    opened.dispose();
    document.body.innerHTML = "";

    const reopened = mount(working(), diff, prefs);
    await flush(60);

    expect(buttonNamed(reopened.host, "Split")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("stages selected lines from a split row", async () => {
    const { host } = mount(working());
    await flush(60);
    click(buttonNamed(host, "Split"));
    await flush(60);

    click(named(host, "Select added line 4"));
    await flush();
    click(named(host, "Stage lines"));
    await flush();

    expect(called("stage_lines")[0]?.args.lines).toEqual([2]);
  });

  it("removes the not-available stubs", async () => {
    const { host } = mount(working());
    await flush(60);

    expect(host.querySelectorAll("button[disabled][title='Not available yet']")).toHaveLength(0);
    expect(buttonNamed(host, "Inline")?.hasAttribute("disabled")).toBe(false);
    expect(buttonNamed(host, "Split")?.hasAttribute("disabled")).toBe(false);
  });
});

describe("change navigation", () => {
  it("steps to the next and previous changed block across hunks in inline mode", async () => {
    const { host } = mount(working());
    await flush(60);
    click(buttonNamed(host, "Inline"));
    await flush(60);

    click(named(host, "Next change"));
    await flush(30);
    expect(document.activeElement).toBe(named(host, "Select removed line 4"));
    click(named(host, "Next change"));
    await flush(30);
    expect(document.activeElement).toBe(named(host, "Select removed line 41"));
    click(named(host, "Previous change"));
    await flush(30);
    expect(document.activeElement).toBe(named(host, "Select removed line 4"));
  });

  it("steps changes with N and P while a line is focused", async () => {
    const { host } = mount(working());
    await flush(60);
    click(buttonNamed(host, "Inline"));
    await flush(60);
    const start = named(host, "Select removed line 4");
    start?.focus();

    press(start, "n");
    await flush(40);
    expect(document.activeElement).toBe(named(host, "Select removed line 41"));
    press(document.activeElement, "p");
    await flush(40);
    expect(document.activeElement).toBe(named(host, "Select removed line 4"));
  });

  it("keeps hunk stepping in hunk mode", async () => {
    const { host } = mount(working());
    await flush(60);

    click(named(host, "Next hunk"));
    await flush();

    expect(document.activeElement).toBe(host.querySelectorAll("section.hunk")[0]);
  });
});

describe("syntax and word highlighting", () => {
  it("marks keywords by kind and the changed words of a paired removed and added line", async () => {
    const { host } = mount(working());
    await flush(120);

    const removed = host.querySelector(".dline.del .code");
    expect(removed?.querySelector(".syn-keyword")?.textContent).toBe("const");
    expect(removed?.querySelector(".word")?.textContent).toBe("3");
    const added = [...host.querySelectorAll(".dline.add .code")].find((code) => code.textContent?.includes("retries"));
    expect(added?.querySelector(".word")?.textContent).toBe("5");
    expect(host.querySelectorAll(".dline.add .code")[1]?.querySelector(".word")).toBeNull();
  });

  it("renders plain text for a file type with no grammar", async () => {
    const { host } = mount({ source: "working", area: "unstaged", file: "notes.xyz" });
    await flush(60);

    expect(host.querySelector(".dline .code [class^='syn-']")).toBeNull();
    expect(host.querySelector(".dline.del .code")?.textContent).toBe("const retries = 3;");
  });
});

describe("binary and editor", () => {
  it("shows the binary placeholder instead of hunks", async () => {
    const { host } = mount(working(), { path: "logo.png", original_path: null, binary: true, old_size: null, new_size: null, hunks: [] });
    await flush(60);

    expect(host.querySelector(".empty")?.textContent).toBe("Binary file — no text diff");
    expect(host.querySelectorAll("section.hunk")).toHaveLength(0);
  });

  it("says why a diff over the limit is not shown, with its size, instead of rendering lines", async () => {
    const { host } = mount(working(), () => {
      throw { kind: "file_too_large", message: "src/app.ts is too large", output: "3145728" };
    });
    await flush(60);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This diff is 3.0 MiB, over the 2.0 MiB limit of the diff view. Open it in your editor instead.");
    expect(host.querySelectorAll("section.hunk, .dflat")).toHaveLength(0);
  });

  it("opens the file in the chosen editor from the toolbar", async () => {
    const { host } = mount(working());
    await flush(60);

    click(named(host, "Open in editor"));
    await flush();

    expect(called("open_in_editor")).toEqual([{ cmd: "open_in_editor", args: { path: "/r", file: "src/app.ts" } }]);
    expect(called("open_path")).toEqual([]);
  });

  it("keeps Open in editor visible but aria-disabled with its reason when no editor is chosen", async () => {
    toolsStatus = { editor: null, diff: "FileMerge", merge: "FileMerge" };
    const { host } = mount(working());
    await flush(60);

    const button = named(host, "Open in editor");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.dataset.tip).toBe("Open in editor. Choose an external editor in Settings → External tools");
    click(button);
    await flush();
    expect(called("open_in_editor")).toEqual([]);
  });
});

describe("open in external diff tool", () => {
  const sources: Array<[string, DiffTarget, unknown]> = [
    ["an unstaged diff", working("unstaged"), { kind: "unstaged" }],
    ["a staged diff", working("staged"), { kind: "staged" }],
    ["a commit diff", { source: "commit", sha: "abc1234", file: "src/app.ts" }, { kind: "commit", sha: "abc1234" }],
    ["a stash diff", { source: "stash", index: 2, sha: "5".repeat(40), file: "src/app.ts" }, { kind: "commit", sha: "5".repeat(40) }],
  ];

  it.each(sources)("opens %s with the source it shows", async (_name, target, source) => {
    const { host } = mount(target);
    await flush(60);

    const button = named(host, "Open in external diff tool");
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    click(button);
    await flush();

    expect(called("open_in_diff_tool")).toEqual([{ cmd: "open_in_diff_tool", args: { path: "/r", file: "src/app.ts", source } }]);
  });

  it("keeps the control visible but aria-disabled with its reason when no diff tool is chosen", async () => {
    toolsStatus = { editor: "Visual Studio Code", diff: null, merge: "FileMerge" };
    const { host } = mount(working());
    await flush(60);

    const button = named(host, "Open in external diff tool");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.dataset.tip).toBe("Open in external diff tool. Choose an external diff tool in Settings → External tools");
    click(button);
    await flush();
    expect(called("open_in_diff_tool")).toEqual([]);
  });
});

describe("large diffs", () => {
  const LINES = 3000;
  const bigHunk: DiffHunk = {
    old_start: 1,
    old_lines: 0,
    new_start: 1,
    new_lines: LINES,
    heading: "",
    lines: Array.from({ length: LINES }, (_, index) => line("added", `line ${index}`, null, index + 1)),
  };
  const big: FileDiff = { path: "big.txt", original_path: null, binary: false, old_size: null, new_size: null, hunks: [bigHunk] };
  const bigTarget: DiffTarget = { source: "working", area: "unstaged", file: "big.txt" };

  it("renders the window of a very large hunk while keeping the hunk focusable and labelled", async () => {
    const { host } = mount(bigTarget, big);
    await flush(80);

    const rows = host.querySelectorAll(".dline");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows[0]?.textContent).toContain("line 0");
    expect(host.querySelectorAll("section.hunk")).toHaveLength(1);
    expect(host.querySelector("section.hunk")?.getAttribute("aria-label")).toBe(`Hunk 1 of 1, lines 1–${LINES}`);
  });

  it.each(["Inline", "Split"])("windows the rows of a very large diff in %s mode", async (mode) => {
    const { host } = mount(bigTarget, big);
    await flush(80);

    click(buttonNamed(host, mode));
    await flush(80);

    const rows = host.querySelectorAll(".dline, .dsplit");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
  });
});

describe("stash diff", () => {
  const stashTarget: DiffTarget = { source: "stash", index: 2, sha: "5".repeat(40), file: "src/app.ts" };

  it("loads the file of a stash from the stash, offers no staging, and names the stash in the header", async () => {
    const { host } = mount(stashTarget);
    await flush(60);

    expect(called("stash_file_diff")).toEqual([{ cmd: "stash_file_diff", args: { path: "/r", index: 2, sha: "5".repeat(40), file: "src/app.ts" } }]);
    expect(called("commit_file_diff")).toEqual([]);
    expect(host.textContent).toContain("stash@{2}");
    expect(named(host, "Stage hunk")).toBeNull();
  });

  it("asks for a diff without whitespace changes when Ignore whitespace is on", async () => {
    const { prefs } = mount(stashTarget);
    await flush(60);
    prefs.setIgnoreWhitespace(true);
    await flush(60);

    expect(called("stash_file_diff").at(-1)?.args).toMatchObject({ ignoreWhitespace: true });
  });
});

describe("file view entry", () => {
  it("opens the full file at the revision the diff compares, for a working, staged, commit, or stash diff", async () => {
    const cases: Array<[DiffTarget, FileViewTarget]> = [
      [working("unstaged"), { file: "src/app.ts", rev: ":worktree", source: "Working tree" }],
      [working("staged"), { file: "src/app.ts", rev: ":index", source: "Staged" }],
      [{ source: "commit", sha: "abc1234", file: "src/app.ts" }, { file: "src/app.ts", rev: "abc1234", source: "abc1234" }],
      [{ source: "stash", index: 0, sha: "f".repeat(40), file: "src/app.ts" }, { file: "src/app.ts", rev: "f".repeat(40), source: "stash@{0}" }],
    ];
    for (const [target, expected] of cases) {
      const viewed: FileViewTarget[] = [];
      const { host, dispose: stop } = mount(target, diff, createDiffPrefs(), viewed);
      await flush(60);

      click(named(host, "View file"));

      expect(viewed).toEqual([expected]);
      stop();
    }
  });
});

describe("file history entry", () => {
  it("asks for the file's history from History and its blame from Blame, selecting the commit a commit diff shows", async () => {
    const cases: Array<[DiffTarget, string, FileHistoryRequest]> = [
      [working("unstaged"), "History", { file: "src/app.ts", view: "diff" }],
      [working("staged"), "Blame", { file: "src/app.ts", view: "blame" }],
      [{ source: "commit", sha: "abc1234", file: "src/app.ts" }, "History", { file: "src/app.ts", sha: "abc1234", view: "diff" }],
      [{ source: "commit", sha: "abc1234", file: "src/app.ts" }, "Blame", { file: "src/app.ts", sha: "abc1234", view: "blame" }],
      [{ source: "stash", index: 0, sha: "f".repeat(40), file: "src/app.ts" }, "History", { file: "src/app.ts", view: "diff" }],
    ];
    for (const [target, control, expected] of cases) {
      const { host, dispose: stop } = mount(target);
      await flush(60);

      expect(named(host, control)?.getAttribute("data-tip")).toBe(control);
      click(named(host, control));

      expect(takeFileHistoryRequest()).toEqual(expected);
      stop();
    }
  });
});

describe("diff continuity (S72)", () => {
  const commitTarget = (file: string): DiffTarget => ({ source: "commit", sha: "a".repeat(40), file });
  const fileDiff = (path: string, text: string): FileDiff => ({ ...diff, path, hunks: [{ ...first, lines: [line("added", text, null, 1)] }] });

  function mountSwitching(start: string) {
    const answers = new Map<string, { promise: Promise<FileDiff>; finish: (value: FileDiff) => void }>();
    const answer = (file: string) => {
      const known = answers.get(file);
      if (known !== undefined) return known;
      let settle: (value: FileDiff) => void = () => undefined;
      const promise = new Promise<FileDiff>((done) => {
        settle = done;
      });
      const entry = { promise, finish: (value: FileDiff) => settle(value) };
      answers.set(file, entry);
      return entry;
    };
    mockIPC((cmd, args) => {
      if (cmd === "external_tools_status") return toolsStatus;
      return cmd === "commit_file_diff" ? answer((args as { file: string }).file).promise : null;
    });
    const [file, setFile] = createSignal(start);
    const mounted = mountWithApp(() => (
      <DiffView session={testSession("/r", { root: "/r" } as RepoSnapshot)} target={commitTarget(file())} prefs={createDiffPrefs()} onClose={() => undefined} onViewFile={() => undefined} />
    ));
    dispose = mounted.dispose;
    const text = () => mounted.host.querySelector(".dbody")?.textContent ?? "";
    return { ...mounted, setFile, text, finish: (target: string, value: FileDiff) => answer(target).finish(value) };
  }

  async function settledOn(view: ReturnType<typeof mountSwitching>) {
    view.finish("a.ts", fileDiff("a.ts", "alpha line"));
    await flush();
    expect(view.text()).toContain("alpha line");
  }

  it("keeps the previous file's lines, undimmed, until the next file's diff arrives", async () => {
    const view = mountSwitching("a.ts");
    await settledOn(view);

    view.setFile("b.ts");
    await flush();
    expect(view.host.querySelector(".crumbs [aria-current='page']")?.textContent).toBe("b.ts");
    expect(view.text()).toContain("alpha line");

    view.finish("b.ts", fileDiff("b.ts", "beta line"));
    await flush();
    expect(view.text()).toContain("beta line");
    expect(view.text()).not.toContain("alpha line");
  });

  it("ends on the last file chosen and never renders a superseded diff", async () => {
    const view = mountSwitching("a.ts");
    await settledOn(view);

    view.setFile("b.ts");
    await flush();
    view.setFile("c.ts");
    await flush();
    view.finish("b.ts", fileDiff("b.ts", "beta line"));
    await flush();
    expect(view.text()).toContain("alpha line");
    expect(view.text()).not.toContain("beta line");

    view.finish("c.ts", fileDiff("c.ts", "gamma line"));
    await flush();
    expect(view.text()).toContain("gamma line");
  });

  it("shows the pending line only once a read has taken 150ms", async () => {
    const view = mountSwitching("a.ts");
    await settledOn(view);
    const indicator = () => view.host.querySelector(".dpanel [data-indicator]");

    view.setFile("b.ts");
    await flush(90);
    expect(indicator()).toBeNull();
    await flush(120);
    expect(indicator()?.getAttribute("role")).toBe("status");
  });

  it("holds off a first load for 150ms, then shows static skeleton lines", async () => {
    const view = mountSwitching("a.ts");
    await flush();
    expect(view.host.querySelector(".dbody .skeleton")).toBeNull();

    await flush(200);
    const skeleton = view.host.querySelector(".dbody .diff-skeleton[aria-hidden='true']");
    expect(skeleton?.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    const css = readFileSync(resolve(import.meta.dirname, "../styles/app.css"), "utf8");
    expect(css).toContain(".dpanel {\n  position: relative;");
  });

  it("replaces the first-load skeleton through view-swap", async () => {
    const animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: () => undefined }));
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    document.documentElement.style.setProperty("--motion-quick", "120ms");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      const view = mountSwitching("a.ts");
      await flush(200);
      view.finish("a.ts", fileDiff("a.ts", "alpha line"));
      await flush();
      const held = view.host.querySelector<HTMLElement>(".dbody[data-swap-held]");
      expect(held?.querySelector(".diff-skeleton")).not.toBeNull();
      expect(view.text()).toContain("alpha line");
      expect(animate.mock.contexts).toContain(held);
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      document.documentElement.style.removeProperty("--motion-quick");
    }
  });

  it("brings the next file in through view-swap", async () => {
    const animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: () => undefined }));
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    document.documentElement.style.setProperty("--motion-quick", "120ms");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      const view = mountSwitching("a.ts");
      await settledOn(view);
      view.setFile("b.ts");
      await flush();
      view.finish("b.ts", fileDiff("b.ts", "beta line"));
      await flush();
      const held = view.host.querySelector<HTMLElement>("[data-swap-held]");
      expect(held?.classList.contains("dbody")).toBe(true);
      expect(held?.textContent).toContain("alpha line");
      expect(view.text()).toContain("beta line");
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      document.documentElement.style.removeProperty("--motion-quick");
    }
  });
});

describe("comparison diffs (S76)", () => {
  const range: DiffTarget = { source: "range", base: "4d9e2f7".padEnd(40, "0"), head: "origin/main", label: "origin/main since 4d9e2f7", file: "src/app.ts" };

  it("reads one file between two revisions, names the range, and offers no line or hunk actions", async () => {
    const { host } = mount(range);
    await flush();

    expect(called("revision_file_diff")[0]?.args).toEqual({ path: "/r", base: range.base, head: "origin/main", file: "src/app.ts" });
    expect(host.querySelector(".crumbs")?.textContent).toContain("origin/main since 4d9e2f7");
    expect(host.querySelector(".dhead .chip")?.textContent).toBe("Comparison");
    expect(host.textContent).toContain("const retries = 5;");
    expect(host.querySelector('button[aria-label="Stage lines"], button[aria-label="Stage hunk"]')).toBeNull();
    const external = named(host, "Open in external diff tool");
    expect(external?.getAttribute("aria-disabled")).toBe("true");
  });
});
