import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createAiSheet, AiSheetContext } from "../state/aiSheet";
import { createComposer } from "../state/composer";
import type { AppUiPrefs } from "../ipc/bindings/AppUiPrefs";
import { createRepoActions } from "../state/repoActions";
import type { AiFeature } from "../ipc/bindings/AiFeature";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { AiSheet } from "./AiSheet";
import { ChangesInspector } from "./ChangesInspector";
import { aiFeatureList, buttonNamed, flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let storedPrefs: AppUiPrefs;
let storedPrefsBefore: AppUiPrefs;
let savedPrefs: AppUiPrefs[] = [];

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
  storedPrefs = { palette_recents: [], last_parent_folder: null, file_list_mode: "path", zoom_percent: 100, sidebar_hidden: false, inspector_hidden: false, syntax_highlighting: true };
  storedPrefsBefore = storedPrefs;
  savedPrefs = [];
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

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "main", sha: "a".repeat(40) },
    upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
    counts: { modified: 0, added: 1, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
    files: [{ path: "a.txt", original_path: null, area: "staged", status: "added" }],
    operation: null,
    operation_detail: null,
    last_fetch: null,
    worktrees: [],
    branches: ["main"],
    remote_branches: ["origin/main"],
    remotes: ["origin"],
    tags: [],
    stashes: [],
    ...overrides,
  }) as RepoSnapshot;

function mount(current: RepoSnapshot, respond: (cmd: string) => unknown = () => null, features = aiFeatureList()) {
  mockIPC((cmd, args) => {
    if (cmd === "ai_feature_config_list") return features;
    if (cmd === "app_ui_prefs_load") return storedPrefs;
    if (cmd === "app_ui_prefs_save") {
      storedPrefs = (args as { prefs: AppUiPrefs }).prefs;
      savedPrefs.push(storedPrefs);
      return null;
    }
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "commit") return "c0ffee";
    if (cmd === "repo_open") return current;
    return respond(cmd);
  });
  const committed: string[] = [];
  const mounted = mountWithApp(() => {
    const session = testSession("/r", current);
    const composer = createComposer();
    const actions = createRoot(() => createRepoActions(session, { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", offline: () => false, inspectStash: () => undefined, undoEntry: () => undefined }));
    const sheet = createAiSheet(session);
    return (
      <AiSheetContext.Provider value={sheet}>
        <ChangesInspector
          session={session}
          actions={actions}
          composer={composer}
          activeTarget={undefined}
          onOpenDiff={() => undefined}
          onCommitted={(sha) => committed.push(sha)}
        />
        <AiSheet sheet={sheet} onOpenAiSettings={() => undefined} />
      </AiSheetContext.Provider>
    );
  });
  dispose = mounted.dispose;
  return { ...mounted, committed };
}

const summaryOf = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="Summary"]');
const commands = () => calls.map((call) => call.cmd).filter((cmd) => !["repo_open", "external_tools_status", "profiles_list"].includes(cmd));
const chord = (host: HTMLElement, init: KeyboardEventInit) =>
  summaryOf(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));

describe("clean working tree", () => {
  const clean = (overrides: Partial<RepoSnapshot> = {}) => snapshot({ counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [], ...overrides });
  const amendButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Amend last commit");

  it("shows a centered clean state and collapses the composer to Amend last commit", async () => {
    const { host } = mount(clean(), (cmd) => (cmd === "amend_info" ? { sha: "b".repeat(40), summary: "Earlier work", description: "Why.", pushed: false } : null));
    await flush();

    const state = host.querySelector(".clean-state");
    expect(state?.querySelector("strong")?.textContent).toBe("Working tree clean");
    expect(state?.textContent).toContain("Nothing to commit on main");
    expect(host.querySelector(".empty")).toBeNull();
    expect(summaryOf(host)).toBeNull();
    expect(amendButton(host)?.disabled).toBe(false);

    amendButton(host)?.click();
    await flush(60);

    expect(summaryOf(host)?.value).toBe("Earlier work");
    expect(host.querySelector('.composer [role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("disables Amend last commit with its reason on an unborn branch and during an operation", async () => {
    const unborn = mount(clean({ head: { kind: "unborn", branch: "main" } }));
    await flush();
    expect(amendButton(unborn.host)?.disabled).toBe(true);
    expect(amendButton(unborn.host)?.title).toBe("There is no commit to amend yet");
    unborn.dispose();
    document.body.innerHTML = "";

    const merging = mount(clean({ operation: "merge" } as Partial<RepoSnapshot>));
    await flush();
    expect(amendButton(merging.host)?.disabled).toBe(true);
    expect(amendButton(merging.host)?.title).toBe("Finish the operation in progress first");
  });

  it("keeps the full composer while files changed", async () => {
    const { host } = mount(snapshot());
    await flush();

    expect(host.querySelector(".clean-state")).toBeNull();
    expect(summaryOf(host)).not.toBeNull();
    expect(amendButton(host)).toBeUndefined();
  });
});

describe("commit and push", () => {
  it("offers Commit and Commit & Push from the split button, with the shortcut on the second", async () => {
    const { host } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();

    const items = [...host.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => [item.querySelector(".label-text")?.textContent, item.querySelector(".note-k")?.textContent])).toEqual([
      ["Commit", "⌘↵"],
      ["Commit & Push", "⌘⇧↵"],
    ]);
  });

  it("commits and pushes the current branch to its upstream", async () => {
    const { host, committed } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();
    [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]?.click();
    await flush(80);

    expect(commands()).toEqual(["commit", "push"]);
    expect(committed).toEqual(["c0ffee"]);
  });

  it("creates the upstream through publish when the branch has none", async () => {
    const { host } = mount(snapshot({ upstream: null }));
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit", "publish"]);
    expect(calls.find((call) => call.cmd === "publish")?.args).toMatchObject({ path: "/r", remote: "origin" });
  });

  it("keeps the commit and shows the push error when the push is rejected", async () => {
    const { host, committed } = mount(snapshot(), (cmd) => {
      if (cmd === "push") throw { kind: "git_failed", message: "remote hung up", output: null };
      return null;
    });
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit", "push"]);
    expect(committed).toEqual(["c0ffee"]);
    expect(summaryOf(host)?.value).toBe("");
  });

  it("only commits for ⌘↵", async () => {
    const { host } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Local");
    await flush();

    chord(host, { metaKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit"]);
  });

  it("disables Commit & Push with the reason when the repository has no remote", async () => {
    const { host } = mount(snapshot({ remotes: [], upstream: null }));
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();
    const push = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')][1];
    expect(push?.getAttribute("aria-disabled")).toBe("true");
    expect(push?.textContent).toContain("This repository has no remotes");
    push?.click();
    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual([]);
  });
});

describe("file keyboard shortcuts", () => {
  const row = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>(".frow")].find((entry) => entry.textContent?.includes(name)) as HTMLElement;
  const press = (element: HTMLElement, key: string) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  it("stages the focused unstaged file with S and unstages the focused staged file with U", async () => {
    const both = snapshot({
      counts: { modified: 1, added: 1, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
      files: [
        { path: "a.txt", original_path: null, area: "staged", status: "added" },
        { path: "b.txt", original_path: null, area: "unstaged", status: "modified" },
      ],
    });
    const { host } = mount(both);
    await flush();

    press(row(host, "b.txt"), "s");
    await flush();
    press(row(host, "a.txt"), "u");
    await flush();

    expect(calls.filter((call) => call.cmd === "stage_files" || call.cmd === "unstage_files").map((call) => [call.cmd, call.args.files])).toEqual([
      ["stage_files", ["b.txt"]],
      ["unstage_files", ["a.txt"]],
    ]);
  });

  it("moves between files with J and K", async () => {
    const both = snapshot({
      counts: { modified: 2, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
      files: [
        { path: "a.txt", original_path: null, area: "unstaged", status: "modified" },
        { path: "b.txt", original_path: null, area: "unstaged", status: "modified" },
      ],
    });
    const { host } = mount(both);
    await flush();
    row(host, "a.txt").focus();

    press(row(host, "a.txt"), "j");
    expect(document.activeElement).toBe(row(host, "b.txt"));
    press(row(host, "b.txt"), "k");
    expect(document.activeElement).toBe(row(host, "a.txt"));
  });
});

describe("generate a commit message", () => {
  const generateButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Generate a commit message"));
  const draft = { summary: "Add greeting", description: "Say hello.", summary_trimmed: true, excluded: [".env"], truncated: [] };

  it("animates and locks the summary, description, and commit action while generation waits, but keeps Cancel available", async () => {
    let finish: ((value: typeof draft) => void) | undefined;
    const { host } = mount(snapshot(), (cmd) => cmd === "ai_generate_commit_message" ? new Promise<typeof draft>((resolve) => (finish = resolve)) : null);
    await flush();

    generateButton(host)?.click();
    await flush();
    expect(summaryOf(host)?.disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')?.disabled).toBe(true);
    expect(host.querySelector('.summary-field [role="status"]')?.textContent).toContain("Generating");
    expect(host.querySelector('.summary-field .busy-spinner')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.composer-go .btn.primary')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Cancel generating"]')?.disabled).toBe(false);

    finish?.(draft);
    await flush(80);
    expect(summaryOf(host)?.disabled).toBe(false);
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')?.disabled).toBe(false);
  });

  it("drafts the summary and description from the staged changes, shows the notes, and commits nothing", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "ai_generate_commit_message" ? draft : null));
    await flush();

    generateButton(host)?.click();
    await flush(60);

    expect(summaryOf(host)?.value).toBe("Add greeting");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')?.value).toBe("Say hello.");
    const notes = host.querySelector(".draft-notes")?.textContent ?? "";
    expect(notes).toContain("Withheld from the provider because they look like secrets: .env");
    expect(notes).toContain("The summary was shortened to fit the 72 character guide.");
    expect(commands()).toEqual(["ai_generate_commit_message"]);
  });

  it("marks the drafted field with a wand instead of a banner, even when no file was withheld or cut", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "ai_generate_commit_message" ? { summary: "Add greeting", description: "", summary_trimmed: false, excluded: [], truncated: [] } : null));
    await flush();

    generateButton(host)?.click();
    await flush(60);

    const mark = host.querySelector<HTMLElement>('.summary-field [role="img"]');
    expect(mark?.getAttribute("aria-label")).toBe("Draft from your staged changes. Review and edit it; nothing is committed until you commit.");
    expect(mark?.dataset.tip).toBe(mark?.getAttribute("aria-label"));
    expect(mark?.querySelector("svg")).not.toBeNull();
    expect(host.querySelector(".note.attention")).toBeNull();
    expect(host.querySelector(".draft-notes")).toBeNull();
    expect(generateButton(host)).toBeUndefined();
  });

  it("is not shown while the feature is off or its provider is not ready", async () => {
    const { host } = mount(snapshot(), () => null, aiFeatureList(["recompose", "conflict_fix"]));
    await flush(60);

    expect(generateButton(host)).toBeUndefined();
    expect(summaryOf(host)).not.toBeNull();
  });

  it("is disabled with its reason when nothing is staged", async () => {
    const { host } = mount(snapshot({ counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [{ path: "a.txt", original_path: null, area: "unstaged", status: "modified" }] }));
    await flush();

    const button = generateButton(host);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe("Generate a commit message from the staged changes. Stage files to generate a message");
    expect(button?.dataset.tip).toBe(button?.getAttribute("aria-label"));
    button?.click();
    await flush();
    expect(commands()).toEqual([]);
  });

  it("generates an amend message from the resulting HEAD commit even with nothing staged", async () => {
    const empty = snapshot({ counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [] });
    const { host } = mount(empty, (cmd) => {
      if (cmd === "amend_info") return { sha: "b".repeat(40), summary: "Earlier work", description: "Why.", pushed: false };
      if (cmd === "ai_generate_amend_message") return draft;
      return null;
    });
    await flush();
    buttonNamed(host, "Amend last commit")?.click();
    await flush(60);

    expect(generateButton(host)?.getAttribute("aria-disabled")).toBeNull();
    generateButton(host)?.click();
    await flush(80);
    expect(summaryOf(host)?.value).toBe("Add greeting");
    expect(commands()).toContain("ai_generate_amend_message");
    expect(commands()).not.toContain("commit");
  });

  it("is an icon-only wand button inside the summary field whose tooltip and name say what it does", async () => {
    const { host } = mount(snapshot());
    await flush();

    const button = generateButton(host);
    expect(button?.closest(".summary-field")?.querySelector('input[aria-label="Summary"]')).not.toBeNull();
    expect(button?.textContent?.trim()).toBe("");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Generate a commit message from the staged changes");
    expect(button?.dataset.tip).toBe("Generate a commit message from the staged changes");
  });

  it("points a missing provider at the AI settings, and a revoked sign-in at Sign in", async () => {
    const missing = mount(snapshot(), (cmd) => {
      if (cmd === "ai_generate_commit_message") throw { kind: "ai_not_configured", message: "Generate commit message is turned off in Settings → AI" };
      return null;
    });
    await flush();
    generateButton(missing.host)?.click();
    await flush(60);
    const note = missing.host.querySelector(".note.danger");
    expect(note?.textContent).toContain("Generate commit message is turned off in Settings → AI. Nothing was changed.");
    expect([...(note?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim())).toEqual(["Open AI settings"]);
    missing.dispose();
    document.body.innerHTML = "";

    const revoked = mount(snapshot(), (cmd) => {
      if (cmd === "ai_generate_commit_message") throw { kind: "ai_auth_required", message: "Sign in to ChatGPT" };
      return null;
    });
    await flush();
    generateButton(revoked.host)?.click();
    await flush(60);
    expect([...(revoked.host.querySelectorAll(".note.danger button") ?? [])].map((button) => button.textContent?.trim())).toEqual(["Sign in"]);
  });

  it("keeps the previous text so Restore my text brings it back", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "ai_generate_commit_message" ? draft : null));
    await flush();
    type(summaryOf(host), "My own summary");
    await flush();

    generateButton(host)?.click();
    await flush(60);
    expect(summaryOf(host)?.value).toBe("Add greeting");
    const restore = host.querySelector<HTMLButtonElement>('.summary-field button[aria-label="Restore my text"]');
    expect(restore?.textContent?.trim()).toBe("");
    expect(restore?.dataset.tip).toBeTruthy();
    restore?.click();
    await flush();

    expect(summaryOf(host)?.value).toBe("My own summary");
  });
});

const changed = (overrides: Partial<RepoSnapshot> = {}) =>
  snapshot({
    counts: { modified: 3, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 },
    files: [
      { path: "src/app.ts", original_path: null, area: "staged", status: "modified" },
      { path: "README.md", original_path: null, area: "unstaged", status: "modified" },
      { path: "src/app.ts", original_path: null, area: "unstaged", status: "modified" },
      { path: "src/ui/button.ts", original_path: null, area: "unstaged", status: "modified" },
      { path: "notes.txt", original_path: null, area: "untracked", status: "untracked" },
    ],
    ...overrides,
  });

const named = (host: ParentNode, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const sectionOf = (host: HTMLElement, title: string) => host.querySelector<HTMLElement>(`section[aria-label="${title}"]`) as HTMLElement;
const press = (element: Element | null | undefined, key: string) => element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const expectIconControl = (button: HTMLButtonElement | null) => {
  expect(button).not.toBeNull();
  expect(button?.textContent?.trim()).toBe("");
  expect(button?.querySelector("svg")).not.toBeNull();
  expect(button?.dataset.tip).toBeTruthy();
};

describe("icon-driven Changes header and lists (S50)", () => {
  it("reads Changes with the count and offers Path / Tree as a segmented icon control", async () => {
    const { host } = mount(changed());
    await flush();

    const title = host.querySelector(".ihead h2");
    expect(title?.textContent?.replace(/\s+/g, " ").trim()).toBe("Changes 4");
    expect(title?.querySelector(".count")?.textContent).toBe("4");
    const view = host.querySelector('.ihead [role="group"][aria-label="File list view"]');
    expect([...(view?.querySelectorAll("button") ?? [])].map((button) => [button.getAttribute("aria-label"), button.getAttribute("aria-pressed")])).toEqual([
      ["Path view", "true"],
      ["Tree view", "false"],
    ]);
    for (const button of view?.querySelectorAll("button") ?? []) expectIconControl(button as HTMLButtonElement);
  });

  it("titles Unstaged and Staged with their counts and offers Stage all and Unstage all as icon controls", async () => {
    const { host } = mount(changed());
    await flush();

    expect(sectionOf(host, "Unstaged").querySelector(".lhead-title")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Unstaged 3");
    expect(sectionOf(host, "Staged").querySelector(".lhead-title")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Staged 1");
    const stageAll = named(sectionOf(host, "Unstaged"), "Stage all");
    const unstageAll = named(sectionOf(host, "Staged"), "Unstage all");
    expectIconControl(stageAll);
    expectIconControl(unstageAll);

    stageAll?.click();
    await flush();
    unstageAll?.click();
    await flush();
    expect(commands()).toEqual(["stage_all", "unstage_all"]);
  });

  it("keeps each row's Stage or Unstage icon outside the actions revealed on hover", async () => {
    const { host } = mount(changed());
    await flush();

    const stage = named(host, "Stage README.md");
    const unstage = named(host, "Unstage src/app.ts");
    expectIconControl(stage);
    expectIconControl(unstage);
    expect(stage?.closest(".acts")).toBeNull();
    expect(unstage?.closest(".acts")).toBeNull();
    expect(named(host, "Open diff of README.md")?.closest(".acts")).not.toBeNull();
  });
});

describe("file list tree (S49)", () => {
  const tree = (host: HTMLElement, title: string) => sectionOf(host, title).querySelector<HTMLElement>('[role="tree"]');
  const item = (host: HTMLElement, title: string, name: string) =>
    [...(tree(host, title)?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((row) => row.querySelector(".file")?.textContent === name);
  const levels = (host: HTMLElement, title: string) =>
    [...(tree(host, title)?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].map((row) => [row.querySelector(".file")?.textContent, row.getAttribute("aria-level"), row.getAttribute("aria-expanded")]);

  it("groups the files by folder as a tree with levels, expanded state, and the file count in text", async () => {
    const { host } = mount(changed());
    await flush();

    named(host, "Tree view")?.click();
    await flush();

    expect(named(host, "Tree view")?.getAttribute("aria-pressed")).toBe("true");
    expect(tree(host, "Unstaged")?.getAttribute("aria-label")).toBe("Unstaged files");
    expect(levels(host, "Unstaged")).toEqual([
      ["src", "1", "true"],
      ["ui", "2", "true"],
      ["button.ts", "3", null],
      ["app.ts", "2", null],
      ["README.md", "1", null],
    ]);
    expect(item(host, "Unstaged", "src")?.querySelector(".dcount")?.textContent).toBe("2");
    expect(item(host, "Unstaged", "ui")?.querySelectorAll(".guide")).toHaveLength(1);
  });

  it("toggles a folder with Enter, opens it with → and closes it with ←", async () => {
    const { host } = mount(changed());
    await flush();
    named(host, "Tree view")?.click();
    await flush();

    press(item(host, "Unstaged", "src"), "Enter");
    await flush();
    expect(levels(host, "Unstaged")).toEqual([
      ["src", "1", "false"],
      ["README.md", "1", null],
    ]);
    expect(item(host, "Unstaged", "src")?.querySelector(".tree-chev")?.classList.contains("closed")).toBe(true);

    press(item(host, "Unstaged", "src"), "ArrowRight");
    await flush();
    expect(item(host, "Unstaged", "src")?.getAttribute("aria-expanded")).toBe("true");
    expect(item(host, "Unstaged", "app.ts")).toBeDefined();

    press(item(host, "Unstaged", "src"), "ArrowLeft");
    await flush();
    expect(item(host, "Unstaged", "src")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("stages a folder from its icon control or Space, and unstages a staged folder", async () => {
    const { host } = mount(changed());
    await flush();
    named(host, "Tree view")?.click();
    await flush();

    const stageFolder = named(sectionOf(host, "Unstaged"), "Stage folder src");
    expectIconControl(stageFolder);
    stageFolder?.click();
    await flush();
    press(item(host, "Unstaged", "ui"), " ");
    await flush();
    named(sectionOf(host, "Staged"), "Unstage folder src")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "stage_files" || call.cmd === "unstage_files").map((call) => [call.cmd, call.args.files])).toEqual([
      ["stage_files", ["src/ui/button.ts", "src/app.ts"]],
      ["stage_files", ["src/ui/button.ts"]],
      ["unstage_files", ["src/app.ts"]],
    ]);
  });

  const menuOf = () => document.querySelector<HTMLElement>('[role="menu"]');
  const menuItems = () => [...(menuOf()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const labelOf = (entry: Element) => entry.querySelector(".label-text")?.textContent;
  const itemNamed = (name: string) => menuItems().find((entry) => labelOf(entry) === name);
  const openTree = async (current: RepoSnapshot) => {
    const mounted = mount(current);
    await flush();
    named(mounted.host, "Tree view")?.click();
    await flush();
    return mounted.host;
  };
  const withUntrackedInFolder = () =>
    changed({ files: [...changed().files, { path: "src/ui/new.ts", original_path: null, area: "untracked", status: "untracked" }] });

  it("opens the app's own folder menu on right-click, never the platform menu, with Stage, Stash, and Discard", async () => {
    const host = await openTree(changed());

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
    item(host, "Unstaged", "src")?.dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(menuItems().map(labelOf)).toEqual(["Stage folder", "Stash folder", "Discard all changes in folder"]);
    expect(itemNamed("Discard all changes in folder")?.classList.contains("danger")).toBe(true);
    expect(commands()).toEqual([]);
  });

  it("offers Unstage folder from a staged folder's menu, with Discard disabled and explained when the folder has nothing to discard", async () => {
    const host = await openTree(changed({ files: [{ path: "src/app.ts", original_path: null, area: "staged", status: "modified" }] }));

    item(host, "Staged", "src")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();

    expect(menuItems().map(labelOf)).toEqual(["Unstage folder", "Stash folder", "Discard all changes in folder"]);
    expect(itemNamed("Discard all changes in folder")?.getAttribute("aria-disabled")).toBe("true");
    expect(itemNamed("Discard all changes in folder")?.title).toBe("No unstaged or untracked changes in this folder");
    itemNamed("Unstage folder")?.click();
    await flush();
    expect(calls.filter((call) => call.cmd === "unstage_files").map((call) => call.args.files)).toEqual([["src/app.ts"]]);
  });

  it("opens the folder menu with Shift+F10 and from a More icon control that names the folder", async () => {
    const host = await openTree(changed());

    press(item(host, "Unstaged", "src"), "F10");
    await flush();
    expect(menuOf()).toBeNull();
    item(host, "Unstaged", "src")?.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(menuItems()).toHaveLength(3);
    press(menuOf(), "Escape");
    await flush();
    expect(menuOf()).toBeNull();

    const more = named(sectionOf(host, "Unstaged"), "More actions for folder src");
    expectIconControl(more);
    expect(more?.getAttribute("aria-haspopup")).toBe("menu");
    more?.click();
    await flush();
    expect(menuItems()).toHaveLength(3);
    expect(more?.getAttribute("aria-expanded")).toBe("true");
  });

  it("stages the folder from its menu", async () => {
    const host = await openTree(changed());

    item(host, "Unstaged", "ui")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    itemNamed("Stage folder")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "stage_files").map((call) => call.args.files)).toEqual([["src/ui/button.ts"]]);
  });

  it("stashes only the folder's staged, unstaged, and untracked files, named after the folder", async () => {
    const host = await openTree(withUntrackedInFolder());

    item(host, "Unstaged", "src")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    itemNamed("Stash folder")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "stash_push_paths")?.args).toEqual({
      path: "/r",
      message: "Stash src/",
      untracked: true,
      paths: ["src/app.ts", "src/ui/button.ts", "src/ui/new.ts"],
    });
    expect(commands()).not.toContain("stash_push");
  });

  it("names a nested folder in the stash message", async () => {
    const host = await openTree(changed());

    item(host, "Unstaged", "ui")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    itemNamed("Stash folder")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "stash_push_paths")?.args).toMatchObject({ message: "Stash src/ui/", paths: ["src/ui/button.ts"] });
  });

  it("confirms a folder discard in a dialog naming the folder and its file count, then discards its tracked and untracked files", async () => {
    const host = await openTree(withUntrackedInFolder());

    item(host, "Unstaged", "src")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    itemNamed("Discard all changes in folder")?.click();
    await flush();

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.querySelector("h3")?.textContent).toBe("Discard all changes in src/ (3 files)?");
    expect([...(dialog?.querySelectorAll(".dialog-names li") ?? [])].map((entry) => entry.textContent)).toEqual(["src/app.ts", "src/ui/button.ts", "src/ui/new.ts"]);
    expect(dialog?.textContent).toContain("untracked file is removed from disk");
    const danger = dialog?.querySelector<HTMLButtonElement>("button.danger");
    expect(danger?.textContent?.trim()).toBe("Discard all changes");
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");
    expect(commands()).toEqual([]);

    danger?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "discard_files")?.args).toEqual({ path: "/r", files: ["src/app.ts", "src/ui/button.ts", "src/ui/new.ts"] });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("discards nothing when the folder discard is cancelled", async () => {
    const host = await openTree(changed());

    item(host, "Unstaged", "ui")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    itemNamed("Discard all changes in folder")?.click();
    await flush();
    [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent?.trim() === "Cancel")?.click();
    await flush();

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("collapses and expands every folder from one icon control in the header", async () => {
    const { host } = mount(changed());
    await flush();
    expect(named(host, "Collapse all folders")).toBeNull();
    named(host, "Tree view")?.click();
    await flush();

    expectIconControl(named(host, "Collapse all folders"));
    named(host, "Collapse all folders")?.click();
    await flush();
    expect(levels(host, "Unstaged")).toEqual([
      ["src", "1", "false"],
      ["README.md", "1", null],
    ]);
    expect(item(host, "Staged", "src")?.getAttribute("aria-expanded")).toBe("false");

    named(host, "Expand all folders")?.click();
    await flush();
    expect(levels(host, "Unstaged")).toHaveLength(5);
    expect(named(host, "Collapse all folders")).not.toBeNull();
  });

  it("opens in the view stored in the app preferences", async () => {
    storedPrefs = { ...storedPrefs, file_list_mode: "tree" };
    const { host } = mount(changed());
    await flush(40);

    expect(named(host, "Tree view")?.getAttribute("aria-pressed")).toBe("true");
    expect(tree(host, "Unstaged")).not.toBeNull();
  });

  it("saves the chosen view in the app preferences so the next file list opens in it", async () => {
    const first = mount(changed());
    await flush(40);
    named(first.host, "Tree view")?.click();
    await flush(40);

    expect(savedPrefs.map((prefs) => prefs.file_list_mode)).toEqual(["tree"]);
    expect(savedPrefs[0]).toEqual({ ...storedPrefsBefore, file_list_mode: "tree" });
    first.dispose();
    document.body.innerHTML = "";

    const second = mount(changed());
    await flush(40);
    expect(tree(second.host, "Unstaged")).not.toBeNull();

    named(second.host, "Path view")?.click();
    await flush(40);
    expect(tree(second.host, "Unstaged")).toBeNull();
    expect(storedPrefs.file_list_mode).toBe("path");
  });
});

describe("composer (S50)", () => {
  const commitButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".composer .split-btn .btn.primary:not(.chev)");
  const labelOf = (host: HTMLElement) => commitButton(host)?.querySelector(".btn-label")?.textContent;
  const tab = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('.composer [role="tab"]')].find((entry) => entry.textContent?.trim() === name);

  it("states why Commit is disabled in its label", async () => {
    const unstaged = mount(snapshot({ files: [{ path: "a.txt", original_path: null, area: "unstaged", status: "modified" }] }));
    await flush();
    type(summaryOf(unstaged.host), "Ship it");
    await flush();
    expect(commitButton(unstaged.host)?.disabled).toBe(true);
    expect(labelOf(unstaged.host)).toBe("Stage files to commit");
    unstaged.dispose();
    document.body.innerHTML = "";

    const staged = mount(snapshot());
    await flush();
    expect(labelOf(staged.host)).toBe("Write a summary to commit");
    type(summaryOf(staged.host), "Ship it");
    await flush();
    expect(commitButton(staged.host)?.disabled).toBe(false);
    expect(labelOf(staged.host)).toBe("Commit 1 file");
  });

  it("keeps the summary on one line with the characters left inside the field", async () => {
    const { host } = mount(snapshot());
    await flush();

    const field = summaryOf(host)?.closest(".summary-field");
    expect(summaryOf(host)?.type).toBe("text");
    type(summaryOf(host), "x".repeat(70));
    await flush();
    expect(field?.querySelector(".count")?.textContent).toBe("2");
    expect(field?.querySelector(".count")?.getAttribute("aria-label")).toBe("2 characters left in the 72 character guide");
  });

  it("uses a fixed-height owned description field and keeps the composer's shape while typing", async () => {
    const { host } = mount(snapshot());
    await flush();
    const composer = host.querySelector(".composer") as HTMLElement;
    const description = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]');
    const frame = description?.closest<HTMLElement>(".input.area");
    const shape = () => [...composer.querySelectorAll("*")].map((element) => element.tagName).join(",");
    const before = shape();
    const height = frame?.style.height;

    type(summaryOf(host), "x".repeat(90));
    type(description, "one\ntwo\nthree\nfour\nfive\nsix");
    await flush();

    expect(height).toBeTruthy();
    expect(frame?.style.height).toBe(height);
    expect(shape()).toBe(before);
  });

  it("toggles Amend as a chip", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "amend_info" ? { sha: "b".repeat(40), summary: "Earlier work", description: "", pushed: false } : null));
    await flush();

    const chip = host.querySelector<HTMLButtonElement>('.composer button.chip-toggle[role="checkbox"]');
    expect(chip?.textContent?.trim()).toBe("Amend");
    expect(chip?.getAttribute("aria-checked")).toBe("false");
    chip?.click();
    await flush(60);

    expect(chip?.getAttribute("aria-checked")).toBe("true");
    expect(summaryOf(host)?.value).toBe("Earlier work");
    expect(commands()).toEqual(["amend_info"]);
  });

  it("offers Commit and Stash tabs and stashes with a title, a description, and untracked files on request", async () => {
    const { host } = mount(changed());
    await flush();

    expect(host.querySelector('.composer [role="tablist"]')?.getAttribute("aria-label")).toBe("Composer");
    expect(tab(host, "Commit")?.getAttribute("aria-selected")).toBe("true");
    tab(host, "Stash")?.click();
    await flush();

    expect(tab(host, "Stash")?.getAttribute("aria-selected")).toBe("true");
    expect(summaryOf(host)).toBeNull();
    const stash = buttonNamed(host, "Stash 3 files");
    expect(stash?.disabled).toBe(false);
    type(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]'), "Half done");
    type(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Stash description"]'), "Login still fails");
    const untracked = host.querySelector<HTMLButtonElement>('.composer button.chip-toggle[role="checkbox"]');
    expect(untracked?.textContent?.trim()).toBe("Include untracked");
    untracked?.click();
    await flush();
    expect(untracked?.getAttribute("aria-checked")).toBe("true");
    buttonNamed(host, "Stash 4 files")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "stash_push")?.args).toEqual({ path: "/r", message: "Half done\n\nLogin still fails", untracked: true });
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]')?.value).toBe("");
  });

  it("states why Stash is disabled in its label when only untracked files changed", async () => {
    const { host } = mount(snapshot({ counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 }, files: [{ path: "new.txt", original_path: null, area: "untracked", status: "untracked" }] }));
    await flush();
    tab(host, "Stash")?.click();
    await flush();

    const stash = buttonNamed(host, "Only untracked files changed; include them to stash");
    expect(stash?.disabled).toBe(true);
    stash?.click();
    await flush();
    expect(commands()).toEqual([]);
  });
});

const EVERY_FEATURE: readonly AiFeature[] = ["generate_commit", "recompose", "conflict_fix", "explain_changes", "explain_commit", "compose_commits", "stash_message"];
const featuresWith = (available: readonly AiFeature[]): AiFeatureSummary[] =>
  EVERY_FEATURE.map((feature) => ({
    feature,
    config: available.includes(feature) ? { feature, provider_id: "p1", model_id: "m", prompt_template: "{context}" } : null,
    enabled: available.includes(feature),
    available: available.includes(feature),
    default_prompt_template: "{context}",
  }));

describe("explain, compose, and stash message with AI (S53)", () => {
  const EXPLAIN = "Explain the working-tree changes";
  const COMPOSE = "Compose the changes into commits";
  const STASH = "Generate a stash message from the changes";
  const label = (host: ParentNode, prefix: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith(prefix));
  const explanation = { items: [{ path: "src/app.ts", text: "Wires the app." }, { path: "README.md", text: "Documents it." }], excluded: [".env"], truncated: [] };
  const proposal = { groups: [{ message: "Wire the app", files: ["src/app.ts"] }, { message: "Document it", files: ["README.md", "notes.txt"] }], excluded: [], truncated: ["big.sql"] };
  const stashDraft = { summary: "WIP: app", description: "- src/app.ts", excluded: [".env"], truncated: [] };
  const respond = (cmd: string) =>
    cmd === "ai_explain_changes" ? explanation : cmd === "ai_compose_commits" ? proposal : cmd === "compose_apply" ? ["c1", "c2"] : cmd === "ai_stash_message" ? stashDraft : null;
  const withAi = (current = changed(), handler = respond, available: readonly AiFeature[] = EVERY_FEATURE) => mount(current, handler, featuresWith(available));

  it("puts an icon-only wand in the Changes header that explains the working tree in a sheet and changes nothing", async () => {
    const { host } = withAi();
    await flush(60);

    const button = label(host, EXPLAIN);
    expect(button?.closest(".changes-head")).not.toBeNull();
    expectIconControl(button as HTMLButtonElement);
    expect(button?.getAttribute("aria-label")).toBe(EXPLAIN);
    expect(button?.dataset.tip).toBe(EXPLAIN);
    const before = host.querySelector<HTMLElement>(".panel.changes")?.outerHTML.length;
    button?.click();
    await flush(60);

    const sheet = host.querySelector(".ai-sheet");
    expect(sheet?.getAttribute("aria-label")).toBe("Explain changes");
    expect([...(sheet?.querySelectorAll(".ai-items li") ?? [])].map((item) => item.querySelector(".ref")?.textContent)).toEqual(["src/app.ts", "README.md"]);
    expect(sheet?.querySelector(".draft-notes")?.textContent).toContain("Withheld from the provider because they look like secrets: .env");
    expect(commands()).toEqual(["ai_explain_changes"]);
    expect(host.querySelector<HTMLElement>(".panel.changes")?.outerHTML.length).toBe(before);
  });

  it("hides the explain, compose, and stash controls while their features are off", async () => {
    const { host } = withAi(changed(), respond, ["generate_commit", "recompose", "conflict_fix"]);
    await flush(60);
    buttonNamed(host, "Stash")?.click();
    await flush();

    expect(label(host, EXPLAIN)).toBeUndefined();
    expect(label(host, COMPOSE)).toBeUndefined();
    expect(label(host, STASH)).toBeUndefined();
  });

  it("disables explain with its reason when the working tree is clean", async () => {
    const clean = snapshot({ counts: { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [] });
    const { host } = withAi(clean);
    await flush(60);

    const button = label(host, EXPLAIN);
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe(`${EXPLAIN}. There are no changes to explain`);
    button?.click();
    await flush();
    expect(commands()).toEqual([]);
  });

  it("puts an icon-only wand in the composer that composes commits, and creates only the checked groups with Create <n> commits", async () => {
    const { host } = withAi();
    await flush(60);

    const button = label(host, COMPOSE);
    expect(button?.closest(".composer")).not.toBeNull();
    expectIconControl(button as HTMLButtonElement);
    expect(button?.getAttribute("aria-label")).toBe(COMPOSE);
    button?.click();
    await flush(60);

    const sheet = host.querySelector<HTMLElement>(".ai-sheet") as HTMLElement;
    expect(sheet.getAttribute("aria-label")).toBe("Compose commits");
    expect(sheet.querySelector(".draft-notes")?.textContent).toContain("Cut to fit the size limit: big.sql");
    expect(sheet.querySelectorAll(".ai-groups li")).toHaveLength(2);
    expect(buttonNamed(sheet, "Create 2 commits")).toBeDefined();
    expect(commands()).toEqual(["ai_compose_commits"]);

    type(sheet.querySelectorAll<HTMLTextAreaElement>(".ai-groups textarea")[1], "Document the app");
    sheet.querySelectorAll<HTMLElement>('.ai-groups [role="checkbox"]')[0]?.click();
    await flush();
    buttonNamed(sheet, "Create 1 commit")?.click();
    await flush(80);

    const apply = calls.filter((call) => call.cmd === "compose_apply");
    expect(apply.map((call) => call.args)).toEqual([{ path: "/r", groups: [{ message: "Document the app", files: ["README.md", "notes.txt"] }] }]);
    expect(host.querySelector(".ai-sheet")).toBeNull();
    expect(calls.filter((call) => call.cmd === "repo_open").length).toBeGreaterThan(0);
  });

  it("fills the stash title and description from a wand inside the title field, shows the wand mark and Restore my text, and stashes nothing", async () => {
    const { host } = withAi();
    await flush(60);
    buttonNamed(host, "Stash")?.click();
    await flush();
    type(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]'), "My stash");
    await flush();

    const button = label(host, STASH);
    expect(button?.closest(".summary-field")?.querySelector('input[aria-label="Stash title"]')).not.toBeNull();
    expectIconControl(button as HTMLButtonElement);
    expect(button?.getAttribute("aria-label")).toBe(STASH);
    button?.click();
    await flush(60);

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]')?.value).toBe("WIP: app");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Stash description"]')?.value).toBe("- src/app.ts");
    expect(host.querySelector('.summary-field [role="img"]')).not.toBeNull();
    expect(host.querySelector(".draft-notes")?.textContent).toContain("Withheld from the provider because they look like secrets: .env");
    expect(commands()).toEqual(["ai_stash_message"]);
    host.querySelector<HTMLButtonElement>('.summary-field button[aria-label="Restore my text"]')?.click();
    await flush();

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]')?.value).toBe("My stash");
  });

  it("states a stash message failure with its fix and leaves the fields alone", async () => {
    const { host } = withAi(changed(), (cmd) => {
      if (cmd === "ai_stash_message") throw { kind: "ai_not_configured", message: "Generate stash message is turned off in Settings → AI" };
      return null;
    });
    await flush(60);
    buttonNamed(host, "Stash")?.click();
    await flush();

    label(host, STASH)?.click();
    await flush(60);

    const note = host.querySelector(".composer .note.danger");
    expect(note?.textContent).toContain("Generate stash message is turned off in Settings → AI. Nothing was changed.");
    expect([...(note?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim())).toEqual(["Open AI settings"]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Stash title"]')?.value).toBe("");
  });
});

describe("multi-select in the file lists (S62)", () => {
  const manyFiles = () =>
    snapshot({
      counts: { modified: 6, added: 0, deleted: 0, renamed: 0, untracked: 2, conflicted: 0 },
      files: [
        { path: "a.ts", original_path: null, area: "unstaged", status: "modified" },
        { path: "b.ts", original_path: null, area: "unstaged", status: "modified" },
        { path: "c.ts", original_path: null, area: "unstaged", status: "modified" },
        { path: "d.ts", original_path: null, area: "unstaged", status: "modified" },
        { path: "u1.txt", original_path: null, area: "untracked", status: "untracked" },
        { path: "u2.txt", original_path: null, area: "untracked", status: "untracked" },
        { path: "s1.ts", original_path: null, area: "staged", status: "modified" },
        { path: "s2.ts", original_path: null, area: "staged", status: "modified" },
      ],
    });
  const rowOf = (host: ParentNode, area: string, name: string) => host.querySelector<HTMLElement>(`[data-row="${area}:${name}"]`) as HTMLElement;
  const click = (element: HTMLElement, init: MouseEventInit = {}) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  const chosen = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('[data-row][aria-selected="true"]')].map((row) => row.dataset.row);
  const menuOf = () => document.querySelector<HTMLElement>('[role="menu"]');
  const menuItems = () => [...(menuOf()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const labelOf = (entry: Element) => entry.querySelector(".label-text")?.textContent;
  const itemNamed = (name: string) => menuItems().find((entry) => labelOf(entry) === name);
  const rightClick = (element: HTMLElement) => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
  const keyOn = (element: Element | null | undefined, key: string, init: KeyboardEventInit = {}) =>
    element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const argsOf = (cmd: string) => calls.find((call) => call.cmd === cmd)?.args;
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const dialogButton = (label: string) => [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => button.textContent?.trim() === label);

  const open = async (current = manyFiles(), respond: (cmd: string) => unknown = () => null) => {
    const mounted = mount(current, respond);
    await flush();
    return mounted.host;
  };

  it("marks each list as multi-selectable and every row as not selected until chosen", async () => {
    const host = await open();

    for (const title of ["Unstaged", "Untracked", "Staged"]) {
      const list = sectionOf(host, title).querySelector(".flist");
      expect(list?.getAttribute("aria-multiselectable")).toBe("true");
      expect([...(list?.querySelectorAll(".frow") ?? [])].every((row) => row.getAttribute("aria-selected") === "false")).toBe(true);
    }
  });

  it("selects one file on click, toggles with ⌘-click, and extends the range with ⇧-click", async () => {
    const host = await open();

    click(rowOf(host, "unstaged", "b.ts"));
    await flush();
    expect(chosen(host)).toEqual(["unstaged:b.ts"]);

    click(rowOf(host, "unstaged", "d.ts"), { metaKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:b.ts", "unstaged:d.ts"]);

    click(rowOf(host, "unstaged", "b.ts"), { metaKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:d.ts"]);

    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "c.ts"), { shiftKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:a.ts", "unstaged:b.ts", "unstaged:c.ts"]);
  });

  it("never spans two lists: choosing in another list replaces the selection", async () => {
    const host = await open();

    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "untracked", "u1.txt"), { metaKey: true });
    await flush();
    expect(chosen(host)).toEqual(["untracked:u1.txt"]);

    click(rowOf(host, "staged", "s2.ts"), { shiftKey: true });
    await flush();
    expect(chosen(host)).toEqual(["staged:s2.ts"]);
  });

  it("extends the range with ⇧↓ and ⇧↑ from the focused file, moving focus along", async () => {
    const host = await open();
    rowOf(host, "unstaged", "b.ts").focus();

    keyOn(rowOf(host, "unstaged", "b.ts"), "ArrowDown", { shiftKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:b.ts", "unstaged:c.ts"]);
    expect(document.activeElement).toBe(rowOf(host, "unstaged", "c.ts"));

    keyOn(rowOf(host, "unstaged", "c.ts"), "ArrowUp", { shiftKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:b.ts"]);

    keyOn(rowOf(host, "unstaged", "b.ts"), "ArrowUp", { shiftKey: true });
    await flush();
    expect(chosen(host)).toEqual(["unstaged:a.ts", "unstaged:b.ts"]);
  });

  it("selects the whole list with ⌘A, only the list that holds focus, and clears with Escape", async () => {
    const host = await open();
    rowOf(host, "untracked", "u1.txt").focus();

    keyOn(rowOf(host, "untracked", "u1.txt"), "a", { metaKey: true });
    await flush();
    expect(chosen(host)).toEqual(["untracked:u1.txt", "untracked:u2.txt"]);

    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    rowOf(host, "untracked", "u1.txt").dispatchEvent(escape);
    await flush();
    expect(chosen(host)).toEqual([]);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("lets Escape fall through to the surrounding handling, such as closing the diff, when only one file is selected", async () => {
    const host = await open();
    const reached: string[] = [];
    const listener = (event: KeyboardEvent) => reached.push(event.key);
    window.addEventListener("keydown", listener);
    try {
      click(rowOf(host, "unstaged", "b.ts"));
      await flush();
      expect(chosen(host)).toEqual(["unstaged:b.ts"]);

      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      rowOf(host, "unstaged", "b.ts").dispatchEvent(escape);
      await flush();

      expect(escape.defaultPrevented).toBe(false);
      expect(reached).toEqual(["Escape"]);
      expect(chosen(host)).toEqual([]);

      keyOn(rowOf(host, "unstaged", "a.ts"), "a", { metaKey: true });
      await flush();
      reached.length = 0;
      rowOf(host, "unstaged", "a.ts").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await flush();
      expect(reached).toEqual([]);
      expect(chosen(host)).toEqual([]);
    } finally {
      window.removeEventListener("keydown", listener);
    }
  });

  it("turns the list header action into a text-labelled Stage <n> files or Unstage <n> files button", async () => {
    const host = await open();
    expect(buttonNamed(sectionOf(host, "Unstaged"), "Stage 2 files")).toBeUndefined();

    click(rowOf(host, "unstaged", "a.ts"));
    expect(buttonNamed(sectionOf(host, "Unstaged"), "Stage 2 files")).toBeUndefined();
    click(rowOf(host, "unstaged", "c.ts"), { metaKey: true });
    await flush();

    expect(named(sectionOf(host, "Unstaged"), "Stage all")).toBeNull();
    buttonNamed(sectionOf(host, "Unstaged"), "Stage 2 files")?.click();
    await flush();
    expect(argsOf("stage_files")).toEqual({ path: "/r", files: ["a.ts", "c.ts"] });

    click(rowOf(host, "staged", "s1.ts"));
    click(rowOf(host, "staged", "s2.ts"), { shiftKey: true });
    await flush();
    buttonNamed(sectionOf(host, "Staged"), "Unstage 2 files")?.click();
    await flush();
    expect(argsOf("unstage_files")).toEqual({ path: "/r", files: ["s1.ts", "s2.ts"] });
  });

  it("stages the selected untracked files from the Untracked header", async () => {
    const host = await open();

    keyOn(rowOf(host, "untracked", "u1.txt"), "a", { metaKey: true });
    await flush();
    buttonNamed(sectionOf(host, "Untracked"), "Stage 2 files")?.click();
    await flush();

    expect(argsOf("stage_files")).toEqual({ path: "/r", files: ["u1.txt", "u2.txt"] });
  });

  it("opens the owned menu on a selected row with every item acting on the whole selection, in order", async () => {
    const host = await open();
    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "c.ts"), { metaKey: true });
    await flush();

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    rowOf(host, "unstaged", "c.ts").dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(menuOf()?.querySelector('[role="separator"]')).not.toBeNull();
    expect(menuItems().map(labelOf)).toEqual(["Stage 2 files", "Discard 2 files", "Ignore 2 files", "Stash 2 files", "Create patch from changes in 2 files"]);
    expect(itemNamed("Discard 2 files")?.classList.contains("danger")).toBe(true);
    expect(chosen(host)).toEqual(["unstaged:a.ts", "unstaged:c.ts"]);
    expect(commands()).toEqual([]);
  });

  it("acts on just the row when the right-clicked row is outside the selection, and words the menu for that file", async () => {
    const host = await open();
    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "b.ts"), { metaKey: true });
    await flush();

    rightClick(rowOf(host, "untracked", "u2.txt"));
    await flush();

    expect(chosen(host)).toEqual(["untracked:u2.txt"]);
    expect(menuItems().map(labelOf)).toEqual(["Stage u2.txt", "Discard u2.txt", "Ignore u2.txt", "Stash u2.txt", "Create patch from changes in u2.txt"]);
  });

  it("opens the menu with ⇧F10 and from the More icon control, and words a staged selection with Unstage", async () => {
    const host = await open();

    keyOn(rowOf(host, "staged", "s1.ts"), "F10", { shiftKey: true });
    await flush();
    expect(menuItems().map(labelOf)[0]).toBe("Unstage s1.ts");
    keyOn(menuOf(), "Escape");
    await flush();
    expect(menuOf()).toBeNull();

    const more = named(rowOf(host, "unstaged", "a.ts"), "More actions for a.ts");
    expectIconControl(more);
    expect(more?.getAttribute("aria-haspopup")).toBe("menu");
    more?.click();
    await flush();
    expect(menuItems().map(labelOf)[0]).toBe("Stage a.ts");
    expect(more?.getAttribute("aria-expanded")).toBe("true");
  });

  it("stages the whole selection from the menu", async () => {
    const host = await open();
    keyOn(rowOf(host, "unstaged", "a.ts"), "a", { metaKey: true });
    await flush();

    rightClick(rowOf(host, "unstaged", "b.ts"));
    await flush();
    itemNamed("Stage 4 files")?.click();
    await flush();

    expect(argsOf("stage_files")).toEqual({ path: "/r", files: ["a.ts", "b.ts", "c.ts", "d.ts"] });
  });

  it("confirms Discard <n> files by count and name with a text-labelled danger button, then discards unstaged and untracked files", async () => {
    const host = await open();
    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "b.ts"), { metaKey: true });
    await flush();
    rightClick(rowOf(host, "unstaged", "b.ts"));
    await flush();

    itemNamed("Discard 2 files")?.click();
    await flush();

    expect(dialog()?.querySelector("h3")?.textContent).toBe("Discard changes to 2 files?");
    expect([...(dialog()?.querySelectorAll(".dialog-names li") ?? [])].map((entry) => entry.textContent)).toEqual(["a.ts", "b.ts"]);
    expect(dialogButton("Discard changes")?.classList.contains("danger")).toBe(true);
    expect(commands()).toEqual([]);

    dialogButton("Discard changes")?.click();
    await flush();
    expect(argsOf("discard_files")).toEqual({ path: "/r", files: ["a.ts", "b.ts"] });
    expect(commands()).not.toContain("discard_staged_files");
  });

  it("discards a staged selection through the staged discard, which also loses unstaged changes, and states the Undo", async () => {
    const host = await open();
    keyOn(rowOf(host, "staged", "s1.ts"), "a", { metaKey: true });
    await flush();
    rightClick(rowOf(host, "staged", "s1.ts"));
    await flush();

    itemNamed("Discard 2 files")?.click();
    await flush();

    expect(dialog()?.textContent).toContain("lose their staged and unstaged changes");
    expect(dialog()?.textContent).toContain("Undo can restore their staged and working tree content");
    expect([...(dialog()?.querySelectorAll(".dialog-names li") ?? [])].map((entry) => entry.textContent)).toEqual(["s1.ts", "s2.ts"]);
    dialogButton("Discard changes")?.click();
    await flush();
    expect(argsOf("discard_staged_files")).toEqual({ path: "/r", files: ["s1.ts", "s2.ts"] });
    expect(commands()).not.toContain("discard_files");
  });

  it("discards nothing when the confirmation is cancelled", async () => {
    const host = await open();
    rightClick(rowOf(host, "unstaged", "a.ts"));
    await flush();
    itemNamed("Discard a.ts")?.click();
    await flush();

    dialogButton("Cancel")?.click();
    await flush();

    expect(dialog()).toBeNull();
    expect(commands()).toEqual([]);
  });

  it("ignores untracked files straight away, leaving .gitignore to the core and untracking nothing", async () => {
    const host = await open();
    keyOn(rowOf(host, "untracked", "u1.txt"), "a", { metaKey: true });
    await flush();
    rightClick(rowOf(host, "untracked", "u1.txt"));
    await flush();

    itemNamed("Ignore 2 files")?.click();
    await flush();

    expect(dialog()).toBeNull();
    expect(argsOf("ignore_paths")).toEqual({ path: "/r", files: ["u1.txt", "u2.txt"], untrack: false });
  });

  it("untracks a tracked file only after confirmation", async () => {
    const host = await open();
    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "b.ts"), { shiftKey: true });
    await flush();
    rightClick(rowOf(host, "unstaged", "b.ts"));
    await flush();

    itemNamed("Ignore 2 files")?.click();
    await flush();

    expect(dialog()?.querySelector("h3")?.textContent).toBe("Ignore 2 files and stop tracking them?");
    expect(commands()).toEqual([]);
    dialogButton("Ignore and untrack")?.click();
    await flush();
    expect(argsOf("ignore_paths")).toEqual({ path: "/r", files: ["a.ts", "b.ts"], untrack: true });
  });

  it("changes nothing when the untrack confirmation is cancelled", async () => {
    const host = await open();
    rightClick(rowOf(host, "staged", "s1.ts"));
    await flush();
    itemNamed("Ignore s1.ts")?.click();
    await flush();

    dialogButton("Cancel")?.click();
    await flush();

    expect(commands()).toEqual([]);
  });

  it("stashes the selection into one stash named Stash <n> files, through the paths stash", async () => {
    const host = await open();
    click(rowOf(host, "unstaged", "a.ts"));
    click(rowOf(host, "unstaged", "d.ts"), { shiftKey: true });
    await flush();
    rightClick(rowOf(host, "unstaged", "d.ts"));
    await flush();

    itemNamed("Stash 4 files")?.click();
    await flush();

    expect(argsOf("stash_push_paths")).toEqual({ path: "/r", message: "Stash 4 files", untracked: false, paths: ["a.ts", "b.ts", "c.ts", "d.ts"] });
    expect(commands()).not.toContain("stash_push");
  });

  it("includes untracked files when the selection is of untracked files", async () => {
    const host = await open();
    rightClick(rowOf(host, "untracked", "u1.txt"));
    await flush();

    itemNamed("Stash u1.txt")?.click();
    await flush();

    expect(argsOf("stash_push_paths")).toEqual({ path: "/r", message: "Stash u1.txt", untracked: true, paths: ["u1.txt"] });
  });

  it("creates a patch of the selected files where the user chooses", async () => {
    const host = await open(manyFiles(), (cmd) => (cmd === "plugin:dialog|save" ? "/tmp/two.patch" : null));
    keyOn(rowOf(host, "staged", "s1.ts"), "a", { metaKey: true });
    await flush();
    rightClick(rowOf(host, "staged", "s2.ts"));
    await flush();

    itemNamed("Create patch from changes in 2 files")?.click();
    await flush();

    expect(argsOf("patch_create")).toEqual({ path: "/r", files: ["s1.ts", "s2.ts"], destination: "/tmp/two.patch" });
  });

  it("creates no patch when the save dialog is dismissed", async () => {
    const host = await open();
    rightClick(rowOf(host, "unstaged", "a.ts"));
    await flush();

    itemNamed("Create patch from changes in a.ts")?.click();
    await flush();

    expect(commands()).not.toContain("patch_create");
  });

  it("multi-selects the file rows of a tree, never its folders", async () => {
    const mounted = mount(
      snapshot({
        counts: { modified: 3, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
        files: [
          { path: "src/a.ts", original_path: null, area: "unstaged", status: "modified" },
          { path: "src/b.ts", original_path: null, area: "unstaged", status: "modified" },
          { path: "top.ts", original_path: null, area: "unstaged", status: "modified" },
        ],
      }),
    );
    await flush();
    named(mounted.host, "Tree view")?.click();
    await flush();
    const list = sectionOf(mounted.host, "Unstaged").querySelector('[role="tree"]');
    expect(list?.getAttribute("aria-multiselectable")).toBe("true");

    click(rowOf(mounted.host, "unstaged", "src/a.ts"));
    click(rowOf(mounted.host, "unstaged", "top.ts"), { shiftKey: true });
    await flush();

    expect(chosen(mounted.host)).toEqual(["unstaged:src/a.ts", "unstaged:src/b.ts", "unstaged:top.ts"]);
    expect([...(list?.querySelectorAll('[role="treeitem"][aria-expanded]') ?? [])].every((folder) => folder.getAttribute("aria-selected") === null)).toBe(true);
    expect(list?.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(3);
  });
});

describe("open in editor and the external merge tool (S54)", () => {
  const withConflict = () =>
    snapshot({
      counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 1 },
      files: [
        { path: "merge.ts", original_path: null, area: "conflicted", status: "conflicted" },
        { path: "a.ts", original_path: null, area: "unstaged", status: "modified" },
      ],
    });
  const status = (overrides: Partial<{ editor: string | null; diff: string | null; merge: string | null }> = {}) => ({ editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge", ...overrides });
  const respondWith = (value: unknown) => (cmd: string) => (cmd === "external_tools_status" ? value : null);
  const argsOf = (cmd: string) => calls.find((call) => call.cmd === cmd)?.args;

  it("opens the file in the chosen editor from every file row", async () => {
    const { host } = mount(withConflict(), respondWith(status()));
    await flush();

    const button = named(host, "Open a.ts in editor");
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    button?.click();
    await flush();

    expect(argsOf("open_in_editor")).toEqual({ path: "/r", file: "a.ts" });
    expect(commands()).not.toContain("open_path");
  });

  it("keeps Open in editor visible but aria-disabled with its reason when no editor is chosen", async () => {
    const { host } = mount(withConflict(), respondWith(status({ editor: null })));
    await flush();

    const button = named(host, "Open a.ts in editor");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.dataset.tip).toBe("Open in editor. Choose an external editor in Settings → External tools");
    button?.click();
    await flush();
    expect(commands()).not.toContain("open_in_editor");
  });

  it("offers Open in external merge tool on a conflicted row, refreshes when it exits, and never marks the file resolved", async () => {
    const { host } = mount(withConflict(), respondWith(status()));
    await flush();

    const button = named(host, "Open merge.ts in external merge tool");
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    const before = calls.filter((call) => call.cmd === "repo_open").length;
    button?.click();
    await flush(60);

    expect(argsOf("open_in_merge_tool")).toEqual({ path: "/r", file: "merge.ts" });
    expect(calls.filter((call) => call.cmd === "repo_open").length).toBeGreaterThan(before);
    expect(commands()).not.toContain("mark_resolved");
    expect(commands()).not.toContain("conflict_resolve");
  });

  it("disables Open in external merge tool with its reason when no merge tool is chosen", async () => {
    const { host } = mount(withConflict(), respondWith(status({ merge: null })));
    await flush();

    const button = named(host, "Open merge.ts in external merge tool");
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.dataset.tip).toBe("Open in external merge tool. Choose an external merge tool in Settings → External tools");
    button?.click();
    await flush();
    expect(commands()).not.toContain("open_in_merge_tool");
  });
});

describe("committing as the active profile (S60)", () => {
  const profiles = (author_name: string, author_email: string) => ({
    active: "work",
    profiles: [
      { id: "default", name: "Default", author_name: "", author_email: "" },
      { id: "work", name: "Work", author_name, author_email },
    ],
  });

  it("states who the next commit is made as when the active profile has an author", async () => {
    let current = profiles("Ada Lovelace", "ada@example.com");
    const { app, host } = mount(snapshot(), (cmd) => (cmd === "profiles_list" ? current : null));
    await app.loadProfiles();
    await flush();

    expect(host.querySelector(".composer-identity")?.textContent).toBe("Committing as Ada Lovelace ada@example.com");
    current = profiles("Updated author", "author@example.test");
    await app.loadProfiles();
    await flush();
    expect(host.querySelector(".composer-identity")?.textContent).toBe("Committing as Updated author author@example.test");
    current = profiles("", "");
    await app.loadProfiles();
    await flush();
    expect(host.querySelector(".composer-identity")).toBeNull();
  });

  it("states nothing when the active profile has no author", async () => {
    const { app, host } = mount(snapshot(), (cmd) => (cmd === "profiles_list" ? profiles("", "") : null));
    await app.loadProfiles();
    await flush();

    expect(host.querySelector(".composer-identity")).toBeNull();
  });
});
