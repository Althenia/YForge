import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createComposer } from "../state/composer";
import { createRepoActions } from "../state/repoActions";
import { ChangesInspector } from "./ChangesInspector";
import { flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

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

function mount(current: RepoSnapshot, respond: (cmd: string) => unknown = () => null) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "commit") return "c0ffee";
    if (cmd === "repo_open") return current;
    return respond(cmd);
  });
  const committed: string[] = [];
  const mounted = mountWithApp(() => {
    const session = testSession("/r", current);
    const composer = createComposer();
    const actions = createRoot(() => createRepoActions(session, { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", offline: () => false, inspectStash: () => undefined, openWorktree: async () => true, undoEntry: () => undefined }));
    return (
      <ChangesInspector
        session={session}
        actions={actions}
        composer={composer}
        activeTarget={undefined}
        onOpenDiff={() => undefined}
        onCommitted={(sha) => committed.push(sha)}
      />
    );
  });
  dispose = mounted.dispose;
  return { ...mounted, committed };
}

const summaryOf = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="Summary"]');
const commands = () => calls.map((call) => call.cmd).filter((cmd) => cmd !== "repo_open");
const chord = (host: HTMLElement, init: KeyboardEventInit) =>
  summaryOf(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));

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
  const generateButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Generate");
  const draft = { summary: "Add greeting", description: "Say hello.", summary_trimmed: true, excluded: [".env"], truncated: [] };

  it("drafts the summary and description from the staged changes, shows the notes, and commits nothing", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "ai_generate_commit_message" ? draft : null));
    await flush();

    generateButton(host)?.click();
    await flush(60);

    expect(summaryOf(host)?.value).toBe("Add greeting");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')?.value).toBe("Say hello.");
    const note = host.querySelector(".note.attention")?.textContent ?? "";
    expect(note).toContain("nothing is committed until you commit");
    expect(note).toContain("Withheld from the provider because they look like secrets: .env");
    expect(note).toContain("The summary was shortened to fit the 72 character guide.");
    expect(commands()).toEqual(["ai_generate_commit_message"]);
  });

  it("always says the text is a draft, even when no file was withheld or cut", async () => {
    const { host } = mount(snapshot(), (cmd) => (cmd === "ai_generate_commit_message" ? { summary: "Add greeting", description: "", summary_trimmed: false, excluded: [], truncated: [] } : null));
    await flush();

    generateButton(host)?.click();
    await flush(60);

    expect(host.querySelector(".note.attention")?.textContent).toContain("Draft from your staged changes. Review and edit it; nothing is committed until you commit.");
  });

  it("is disabled with its reason when nothing is staged", async () => {
    const { host } = mount(snapshot({ counts: { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 }, files: [{ path: "a.txt", original_path: null, area: "unstaged", status: "modified" }] }));
    await flush();

    expect(generateButton(host)?.disabled).toBe(true);
    expect(generateButton(host)?.title).toBe("Stage files to generate a message");
  });

  it("points a missing provider at the AI settings, and a revoked sign-in at Sign in", async () => {
    const missing = mount(snapshot(), (cmd) => {
      if (cmd === "ai_generate_commit_message") throw { kind: "ai_not_configured", message: "none" };
      return null;
    });
    await flush();
    generateButton(missing.host)?.click();
    await flush(60);
    const note = missing.host.querySelector(".note.danger");
    expect(note?.textContent).toContain("No AI provider is set up. Choose one in Settings → AI.");
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
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Restore my text")?.click();
    await flush();

    expect(summaryOf(host)?.value).toBe("My own summary");
  });
});
