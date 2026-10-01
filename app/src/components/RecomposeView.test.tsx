import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { RecomposePreview } from "../ipc/bindings/RecomposePreview";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { RecomposeView } from "./RecomposeView";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { aiFeatureList, buttonNamed, flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubLayout();
});

afterEach(async () => {
  restoreLayout?.();
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({ root: "/r", head: { kind: "branch", name: "main", sha: "h" }, upstream: { name: "origin/main", ahead_behind: { ahead: 3, behind: 0 } }, counts, files: [], operation: null, operation_detail: null, remotes: ["origin"], remote_branches: ["origin/main"], branches: ["main"], ...overrides }) as RepoSnapshot;

const line = (kind: DiffLine["kind"], text: string, number: number): DiffLine => ({ kind, old_number: number, new_number: number, text, no_newline: false });
const hunk = (lines: DiffLine[]) => ({ old_start: 1, old_lines: 3, new_start: 1, new_lines: 3, heading: "", lines });
const preview = (overrides: Partial<RecomposePreview> = {}): RecomposePreview => ({
  base: "b",
  head: "h",
  pushed: false,
  files: [
    { path: "a.txt", status: "modified", binary: false, whole_file_only: false, hunks_omitted: null, hunks: [{ id: "a.txt@1,3+1,3", hunk: hunk([line("context", "x", 1), line("removed", "old", 2), line("added", "new", 2), line("added", "more", 3)]) }, { id: "a.txt@20,3+20,3", hunk: hunk([line("removed", "gone", 20)]) }] },
    { path: "logo.png", status: "added", binary: true, whole_file_only: true, hunks_omitted: null, hunks: [] },
  ],
  ...overrides,
});

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(config: { snapshot?: RepoSnapshot; preview?: RecomposePreview; apply?: unknown; propose?: unknown; base?: string; features?: AiFeatureSummary[] } = {}) {
  const calls: Call[] = [];
  const current = config.snapshot ?? snapshot();
  mockIPC((cmd, args) => {
    if (cmd === "ai_feature_config_list") return config.features ?? aiFeatureList();
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "repo_open") return current;
    if (cmd === "recompose_preview") return config.preview ?? preview();
    if (cmd === "repo_graph") return { rows: [{ sha: "h", parents: ["g"], summary: "Head commit", kind: "commit", refs: [], edges: [], column: 0, author: null, time: 0 }, { sha: "g", parents: [], summary: "Older commit", kind: "commit", refs: [], edges: [], column: 0, author: null, time: 0 }], carried: [], total: 2 };
    for (const [name, value] of [["recompose_apply", config.apply], ["ai_propose_recompose", config.propose]] as const) {
      if (cmd !== name) continue;
      if (typeof value === "object" && value !== null && "reject" in value) throw (value as { reject: unknown }).reject;
      return value ?? { head: "n", pushed: false };
    }
    return null;
  });
  const closed: string[] = [];
  const opened: string[] = [];
  const session = createRoot(() => testSession("/r", current));
  const mounted = mountWithApp(() => <RecomposeView session={session} base={config.base} onClose={() => closed.push("closed")} onOpenAiSettings={() => opened.push("ai")} />);
  dispose = mounted.dispose;
  await flush(80);
  const host = mounted.host;
  const unit = (label: string) => host.querySelector<HTMLElement>(`[data-unit="${label}"]`) as HTMLElement;
  const chip = (label: string) => unit(label).querySelector(".assign-chip")?.textContent?.trim();
  const assign = async (label: string, choice: string) => {
    unit(label).querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.click();
    await flush();
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith(choice))?.click();
    await flush();
  };
  const message = (index: number, text: string) => type(host.querySelectorAll<HTMLTextAreaElement>(".rgroup textarea")[index] as unknown as HTMLInputElement, text);
  const apply = () => [...host.querySelectorAll("button")].find((button) => button.textContent?.trim().startsWith("Recompose ") && button.classList.contains("primary"));
  return { ...mounted, calls, closed, opened, session, unit, chip, assign, message, apply };
}

describe("recompose view", () => {
  it("renders only the files near the viewport of a long file list and still counts every file", async () => {
    const files = Array.from({ length: 600 }, (_, index) => ({ path: `src/file${index}.ts`, status: "added" as const, binary: true, whole_file_only: true, hunks_omitted: null, hunks: [] }));
    const { host, unit } = await mount({ preview: preview({ files }) });

    const rendered = host.querySelectorAll('[data-unit^="file:"]').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(60);
    expect(unit("file:src/file0.ts")).not.toBeNull();
    expect(host.querySelector('[data-unit="file:src/file599.ts"]')).toBeNull();
    expect(host.querySelector(".rhead")?.textContent).toContain("600 files");
    expect(host.querySelector(".rtool .reason")?.textContent).toContain("0 of 600 changes assigned");
  });

  it("says in text why a file over the size limit shows no hunks and assigns it whole", async () => {
    const reason = "The diff of big.sql is 3000000 bytes, over the 2097152 byte limit, so its hunks are not shown and it can only be assigned as a whole file.";
    const files = [{ path: "big.sql", status: "modified" as const, binary: false, whole_file_only: true, hunks_omitted: reason, hunks: [] }];
    const { host, unit, chip, assign } = await mount({ preview: preview({ files }) });

    expect(host.querySelector('[data-unit="file:big.sql"] button[aria-label^="Show hunks"]')).toBeNull();
    expect(host.textContent).toContain(reason);
    await assign("file:big.sql", "Commit 1");
    expect(chip("file:big.sql")).toBe("Commit 1");
    expect(unit("file:big.sql")).not.toBeNull();
  });

  it("reads the preview from the upstream by default and lists each file with its hunks, everything unassigned", async () => {
    const { host, calls, chip } = await mount();

    expect(calls.find((call) => call.cmd === "recompose_preview")?.args).toEqual({ path: "/r", base: "refs/remotes/origin/main" });
    expect(host.querySelector(".rhead")?.textContent).toContain("2 files");
    expect(chip("file:a.txt")).toBe("Unassigned");
    expect(chip("file:logo.png")).toBe("Unassigned");
    expect(host.querySelector(".rtool .reason")?.textContent).toContain("0 of 5 changes assigned");
    expect(host.querySelectorAll(".rgroup")).toHaveLength(1);
  });

  it("shows the chosen base commit in the Base select once the commits are loaded", async () => {
    const { host, calls } = await mount({ base: "g" });

    expect(calls.find((call) => call.cmd === "recompose_preview")?.args).toEqual({ path: "/r", base: "g" });
    expect(host.querySelector('button[aria-label="Base"] .select-value')?.textContent).toContain("Older commit");
  });

  it("assigns a file, a hunk, and a whole-file unit through the menu and shows the commit each belongs to", async () => {
    const { host, chip, assign } = await mount();

    buttonNamed(host, "Add commit")?.click();
    await flush();
    await assign("file:logo.png", "Commit 2");
    expect(chip("file:logo.png")).toBe("Commit 2");

    host.querySelector<HTMLElement>('[data-unit="file:a.txt"] button[aria-label^="Show hunks"]')?.click();
    await flush();
    await assign("hunk:a.txt@20,3+20,3", "Commit 2");
    await assign("hunk:a.txt@1,3+1,3", "Commit 1");
    expect(chip("hunk:a.txt@20,3+20,3")).toBe("Commit 2");
    expect(chip("file:a.txt")).toBe("Split");
    expect(host.querySelector(".rtool .reason")?.textContent).toContain("5 of 5 changes assigned");
  });

  it("assigns from the keyboard with the commit number and unassigns with 0", async () => {
    const { host, chip, unit } = await mount();
    buttonNamed(host, "Add commit")?.click();
    await flush();
    const press = (label: string, key: string) => unit(label).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    press("file:logo.png", "2");
    await flush();
    expect(chip("file:logo.png")).toBe("Commit 2");
    press("file:logo.png", "0");
    await flush();
    expect(chip("file:logo.png")).toBe("Unassigned");
  });

  it("assigns chosen lines of a hunk to different commits, so the hunk reads Split, and sends them as lines", async () => {
    const { host, chip, assign, message, apply, calls } = await mount();
    buttonNamed(host, "Add commit")?.click();
    await flush();
    host.querySelector<HTMLElement>('[data-unit="file:a.txt"] button[aria-label^="Show hunks"]')?.click();
    await flush();
    host.querySelector<HTMLElement>('[data-unit="hunk:a.txt@1,3+1,3"] button[aria-label^="Show lines"]')?.click();
    await flush();
    const box = (index: number) => [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')][index];
    const labels = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')].map((entry) => entry.getAttribute("aria-label"));
    expect(labels).toEqual(["Select removed line 2", "Select added line 2", "Select added line 3"]);
    const assignLines = async (count: string, commit: string) => {
      buttonNamed(host, count)?.click();
      await flush();
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith(commit))?.click();
      await flush();
    };

    box(1)?.click();
    box(2)?.click();
    await flush();
    await assignLines("Assign 2 selected lines…", "Commit 2");
    box(0)?.click();
    await flush();
    await assignLines("Assign 1 selected line…", "Commit 1");
    expect(chip("hunk:a.txt@1,3+1,3")).toBe("Split");

    await assign("hunk:a.txt@20,3+20,3", "Commit 1");
    await assign("file:logo.png", "Commit 1");
    message(0, "Rest");
    message(1, "New text");
    await flush();
    apply()?.click();
    await flush(60);

    expect((calls.find((call) => call.cmd === "recompose_apply")?.args.groups as unknown[]) ?? []).toEqual([
      { message: "Rest", changes: [{ kind: "lines", id: "a.txt@1,3+1,3", lines: [1] }, { kind: "hunk", id: "a.txt@20,3+20,3" }, { kind: "file", path: "logo.png" }] },
      { message: "New text", changes: [{ kind: "lines", id: "a.txt@1,3+1,3", lines: [2, 3] }] },
    ]);
  });

  it("applies the recomposition with every change exactly once and closes", async () => {
    const { host, assign, message, apply, calls, closed } = await mount();
    buttonNamed(host, "Add commit")?.click();
    await flush();
    await assign("file:a.txt", "Commit 1");
    await assign("file:logo.png", "Commit 2");
    expect(apply()?.disabled).toBe(true);
    message(0, "Edit text");
    message(1, "Add logo");
    await flush();
    apply()?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "recompose_apply")?.args).toEqual({
      path: "/r",
      base: "refs/remotes/origin/main",
      groups: [
        { message: "Edit text", changes: [{ kind: "file", path: "a.txt" }] },
        { message: "Add logo", changes: [{ kind: "file", path: "logo.png" }] },
      ],
    });
    expect(closed).toEqual(["closed"]);
  });

  it("keeps the same commit message editor, and its focus, while the user types", async () => {
    const { host, message } = await mount();
    const editor = host.querySelector<HTMLTextAreaElement>(".rgroup textarea") as HTMLTextAreaElement;
    editor.focus();

    message(0, "A");
    await flush();
    message(0, "Ab");
    await flush();

    expect(host.querySelector(".rgroup textarea")).toBe(editor);
    expect(document.activeElement).toBe(editor);
  });

  it("names what blocks Apply: unassigned changes, blank messages, and a dirty tree", async () => {
    const { host, apply } = await mount();
    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Changes not assigned to any commit: a.txt, logo.png");
    dispose?.();
    document.body.innerHTML = "";

    const dirty = await mount({ snapshot: snapshot({ counts: { ...counts, modified: 1 } }) });
    expect(dirty.apply()?.disabled).toBe(true);
    dirty.host.querySelector<HTMLElement>('[data-unit="file:logo.png"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    dirty.host.querySelector<HTMLElement>('[data-unit="file:a.txt"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    dirty.message(0, "All in one");
    await flush();
    expect(dirty.host.querySelector(".rfoot .reason")?.textContent).toContain("Commit, stash, or discard your changes first");
  });

  it("warns in text when the range holds pushed commits", async () => {
    const { host } = await mount({ preview: preview({ pushed: true }) });

    expect(host.querySelector(".note.attention")?.textContent).toContain("Some of these commits are already on origin/main. Recomposing them means the next push needs a force push.");
  });

  it("fills the commits from an AI proposal as an editable draft, lists withheld files, and restores the previous grouping", async () => {
    const proposal = { groups: [{ message: "Edit text", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "hunk", id: "a.txt@20,3+20,3" }] }, { message: "Add logo", changes: [{ kind: "file", path: "logo.png" }] }], excluded: [".env"] };
    const { host, chip, message, calls } = await mount({ propose: proposal });
    message(0, "My message");
    await flush();

    buttonNamed(host, "Propose with AI")?.click();
    await flush(80);

    expect(calls.find((call) => call.cmd === "ai_propose_recompose")?.args).toMatchObject({ path: "/r", base: "refs/remotes/origin/main" });
    expect([...host.querySelectorAll<HTMLTextAreaElement>(".rgroup textarea")].map((area) => area.value)).toEqual(["Edit text", "Add logo"]);
    expect(chip("file:a.txt")).toBe("Commit 1");
    expect(chip("file:logo.png")).toBe("Commit 2");
    expect(host.textContent).toContain("Withheld from the provider because they look like secrets: .env");
    expect(calls.some((call) => call.cmd === "recompose_apply")).toBe(false);

    buttonNamed(host, "Restore my grouping")?.click();
    await flush();
    expect([...host.querySelectorAll<HTMLTextAreaElement>(".rgroup textarea")].map((area) => area.value)).toEqual(["My message"]);
  });

  it("hides Propose with AI while the feature is off or its provider is not ready", async () => {
    const { host } = await mount({ features: aiFeatureList(["generate_commit", "conflict_fix"]) });

    expect(buttonNamed(host, "Propose with AI")).toBeUndefined();
    expect(host.textContent).toContain("changes assigned");
  });

  it("points a missing provider at the AI settings", async () => {
    const { host, opened } = await mount({ propose: { reject: { kind: "ai_not_configured", message: "Propose with AI in Recompose is turned off in Settings → AI" } } });

    buttonNamed(host, "Propose with AI")?.click();
    await flush(60);

    expect(host.querySelector(".note.danger")?.textContent).toContain("Propose with AI in Recompose is turned off in Settings → AI. Nothing was changed.");
    buttonNamed(host, "Open AI settings")?.click();
    expect(opened).toEqual(["ai"]);
  });

  it("shows a refusal from the core and stays open", async () => {
    const { host, assign, message, apply, closed } = await mount({ apply: { reject: { kind: "local_changes", message: "the working tree has changes", output: null } } });
    await assign("file:a.txt", "Commit 1");
    await assign("file:logo.png", "Commit 1");
    message(0, "All");
    await flush();

    apply()?.click();
    await flush(60);

    expect(host.querySelector(".rfoot .field-note.error")?.textContent).toContain("the working tree has changes");
    expect(closed).toEqual([]);
  });

  it("moves a change to a commit by dragging its row onto the commit", async () => {
    const { host, chip, unit } = await mount();
    const target = host.querySelector<HTMLElement>(".rgroup") as HTMLElement;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
      unit("file:logo.png").querySelector<HTMLElement>(".rgrip")?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, clientY: 40 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 40, clientY: 40 }));
      await flush();
    } finally {
      document.elementFromPoint = original;
    }

    expect(chip("file:logo.png")).toBe("Commit 1");
  });
});
