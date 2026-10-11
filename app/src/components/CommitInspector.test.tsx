import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot, createSignal, Show } from "solid-js";
import type { GraphRow } from "../ipc/bindings/GraphRow";
import { repoKeys } from "../state/queryKeys";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiFeature } from "../ipc/bindings/AiFeature";
import { AiSheetContext, createAiSheet } from "../state/aiSheet";
import type { DiffTarget } from "../state/diffModel";
import type { FileViewTarget } from "../state/fileView";
import type { CommitDetails } from "../ipc/bindings/CommitDetails";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { takeFileHistoryRequest } from "../state/fileHistoryRequest";
import { createRepoActions } from "../state/repoActions";
import { AiSheet } from "./AiSheet";
import { BranchNameForm } from "./BranchForms";
import { CommitInspector } from "./CommitInspector";
import { ContextMenu } from "./ContextMenu";
import { buttonNamed, flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let toolsStatus: unknown = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };
let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css", "markdown.css"].map((name) => readFileSync(resolve(import.meta.dirname, "../styles", name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

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
  takeFileHistoryRequest();
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

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const person = { name: "Ada", email: "ada@example.test", time: 1_700_000_000 };

const details = (sha: string): CommitDetails => ({ sha, summary: "Tune retries", body: "Because.", author: person, committer: person, parents: [OLDER], refs: [], files: [] });

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: HEAD }, upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } }, operation: null, remotes: ["origin"], remote_branches: [], branches: ["main"], files: [] } as unknown as RepoSnapshot;

function mount(sha: string, options: { body?: string; pushed?: boolean; operation?: boolean; files?: CommitDetails["files"]; parents?: string[]; author?: CommitDetails["author"]; jira?: { summary: string | null; failure?: string }; tree?: string[]; ai?: AiFeature[]; explain?: unknown; amendDraft?: unknown } = {}) {
  const selected: string[] = [];
  const opened: DiffTarget[] = [];
  const viewed: FileViewTarget[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "external_tools_status") return toolsStatus;
    if (cmd === "app_ui_prefs_load") return { palette_recents: [], last_parent_folder: null, file_list_mode: "path" };
    if (cmd === "ai_feature_config_list") return (options.ai ?? []).map((feature) => ({ feature, config: { feature, provider_id: "p1", model_id: "m", prompt_template: "{context}" }, enabled: true, available: true, default_prompt_template: "{context}" }));
    if (cmd === "ai_explain_commit") return options.explain ?? { items: [], excluded: [], truncated: [] };
    if (cmd === "ai_generate_amend_message") return options.amendDraft;
    if (cmd === "commit_tree_paths") return options.tree ?? [];
    if (cmd === "jira_connections_list") return options.jira === undefined ? [] : [{ id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "V", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 }];
    if (cmd === "jira_branch_name") return `${(args as { key: string }).key}-show-the-account-switcher`;
    if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map((text) => text.match(/ABC-\d+/g) ?? []);
    if (cmd === "jira_issues_lookup") {
      const found = options.jira?.summary ?? null;
      return (args as { keys: string[] }).keys.map((key) => ({ key, issue: found === null ? null : { key, summary: found, status: "Done", status_category: "done", issue_type: "Bug", project: "ABC", updated_at: "", web_url: "", connection_id: "j1" }, failure: options.jira?.failure ?? null }));
    }
    if (cmd === "commit_details") return { ...details(sha), body: options.body ?? "Because.", summary: options.jira === undefined ? "Tune retries" : "Retry login (ABC-142)", author: options.author ?? person, files: options.files ?? [], parents: options.parents ?? [OLDER] };
    if (cmd === "amend_info") return { sha: HEAD, summary: "Tune retries", description: "Because.", pushed: options.pushed ?? false };
    if (cmd === "repo_open") return options.operation === true ? { ...snapshot, operation: "rebase" } : snapshot;
    if (cmd === "integration_preview") return { incoming: { count: 0, commits: [] }, outgoing: { count: 1, commits: [] }, fast_forward: false };
    if (cmd === "edit_head_message") return { sha: "c".repeat(40), pushed: options.pushed ?? false };
    return null;
  });
  const current = options.operation === true ? ({ ...snapshot, operation: "rebase" } as unknown as RepoSnapshot) : snapshot;
  const session = testSession("/r", current);
  const actions = createRepoActions(session, { selectedSha: () => sha, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", offline: () => false, inspectStash: () => undefined, undoEntry: () => undefined });
  const sheet = createRoot(() => createAiSheet(session));
  const mounted = mountWithApp(() => (
    <AiSheetContext.Provider value={sheet}>
      <CommitInspector session={session} actions={actions} sha={sha} activeTarget={undefined} onSelectCommit={(next) => selected.push(next)} onOpenDiff={(target) => opened.push(target)} onViewFile={(view) => viewed.push(view)} />
      <Show when={actions.menu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={actions.closeMenu} />}
      </Show>
      <Show when={actions.popover()} keyed>
        {(state) => (state.kind === "create_branch" ? <BranchNameForm state={state} session={session} actions={actions} /> : null)}
      </Show>
      <AiSheet sheet={sheet} onOpenAiSettings={() => undefined} />
    </AiSheetContext.Provider>
  ));
  dispose = mounted.dispose;
  return { ...mounted, selected, viewed, opened, actions };
}

const editButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
const field = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);

const verb = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`.ihead button[aria-label="${name}"]`);

describe("commit age", () => {
  it("renders the message body as Markdown and gives only the commit summary the strong role", async () => {
    const { host, viewed } = mount(OLDER, { body: "- First\n- **Second**\n\n[File](src/app.ts#notes) [Visit](https://example.test)" });
    await flush(80);
    expect(host.querySelector(".ihead h2")?.classList.contains("commit-summary")).toBe(true);
    const summary = getComputedStyle(host.querySelector(".commit-summary")!);
    expect(summary.font).toBe("var(--font-ui-strong)");
    expect(summary.color).toBe("var(--colors-text)");
    expect(summary.cursor).toBe("var(--cursors-text)");
    const body = getComputedStyle(host.querySelector(".commit-message")!);
    expect(body.font).toBe("var(--font-ui-body)");
    expect(body.color).toBe("var(--colors-text)");
    expect(body.cursor).toBe("var(--cursors-text)");
    expect(body.borderTopWidth).toBe("1px");
    expect(body.borderTopStyle).toBe("solid");
    expect(body.borderTopColor).toBe("var(--colors-rule)");
    expect([...host.querySelectorAll(".commit-message ul li")].map((item) => item.textContent)).toEqual(["First", "Second"]);
    expect(host.querySelector(".commit-message strong")?.textContent).toBe("Second");
    expect(host.querySelector(".cbody")).toBeNull();
    [...host.querySelectorAll<HTMLAnchorElement>(".commit-message a")].find((link) => link.textContent === "File")?.click();
    expect(viewed).toEqual([{ file: "src/app.ts", rev: OLDER, source: OLDER.slice(0, 7), fragment: "notes" }]);
    const external = [...host.querySelectorAll<HTMLAnchorElement>(".commit-message a")].find((link) => link.textContent === "Visit");
    expect(external?.hasAttribute("href")).toBe(false);
    expect(external?.title).toBe("https://example.test");
  });

  it("ages the committer time as the clock ticks", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date((person.time + 20) * 1000));
      const { host } = mount(OLDER);
      await flush(60);
      const age = () => host.querySelector(".ago")?.textContent;
      expect(age()).toBe("· 20s ago");

      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
      await flush();

      expect(age()).toBe("· 2h ago");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("commit verbs in the header", () => {
  it("offers Branch here, Cherry-pick, Revert, and Reset for any selected commit", async () => {
    const { host } = mount(OLDER);
    await flush(60);

    expect(["Branch here", "Cherry-pick", "Revert", "Reset main to here"].map((name) => verb(host, name)?.getAttribute("aria-disabled"))).toEqual([null, null, null, null]);
    expect(["Branch here", "Cherry-pick", "Revert", "Reset main to here"].map((name) => verb(host, name)?.textContent === "")).toEqual([true, true, true, true]);
    expect(["Branch here", "Cherry-pick", "Revert", "Reset main to here"].map((name) => verb(host, name)?.querySelector("svg") !== null)).toEqual([true, true, true, true]);
    expect(verb(host, "Cherry-pick")?.getAttribute("data-tip")).toBe(`Cherry-pick ${OLDER.slice(0, 7)} onto main`);
    expect(verb(host, "Reset main to here")?.getAttribute("data-tip")).toBe(`Reset main to ${OLDER.slice(0, 7)}`);
  });

  it("creates a branch at the commit: button, name, Enter", async () => {
    const { host } = mount(OLDER);
    await flush(60);

    verb(host, "Branch here")?.click();
    await flush(60);
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Branch name"]');
    expect(document.body.textContent).toContain(`from ${OLDER.slice(0, 7)}`);
    type(input, "topic/here");
    await flush(60);
    (document.querySelector("form.popform") as HTMLFormElement).requestSubmit();
    await flush(80);

    expect(calls.find((call) => call.cmd === "create_branch")?.args).toEqual({ path: "/r", name: "topic/here", at: OLDER, checkout: true });
  });

  it("cherry-picks and reverts the commit through the core", async () => {
    const { host } = mount(OLDER);
    await flush(60);

    verb(host, "Cherry-pick")?.click();
    verb(host, "Revert")?.click();
    await flush(60);

    expect(calls.filter((call) => call.cmd === "cherry_pick" || call.cmd === "revert").map((call) => [call.cmd, call.args.sha])).toEqual([
      ["cherry_pick", OLDER],
      ["revert", OLDER],
    ]);
  });

  it("disables Cherry-pick and Revert on a merge commit with the stated reason, while Branch here and Reset stay available", async () => {
    const { host } = mount(OLDER, { parents: [HEAD, "c".repeat(40)] });
    await flush(60);

    for (const name of ["Cherry-pick", "Revert"]) {
      expect(verb(host, name)?.getAttribute("aria-disabled")).toBe("true");
      expect(verb(host, name)?.getAttribute("data-tip")).toBe("A merge commit needs a parent choice, which is not available yet");
    }
    verb(host, "Cherry-pick")?.click();
    await flush(40);
    expect(calls.some((call) => call.cmd === "cherry_pick")).toBe(false);
    expect(verb(host, "Branch here")?.getAttribute("aria-disabled")).toBeNull();
    expect(verb(host, "Reset main to here")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("disables Cherry-pick, Revert, and Reset while an operation is in progress", async () => {
    const { host } = mount(OLDER, { operation: true });
    await flush(60);

    for (const name of ["Cherry-pick", "Revert", "Reset main to here"]) {
      expect(verb(host, name)?.getAttribute("aria-disabled")).toBe("true");
      expect(verb(host, name)?.getAttribute("data-tip")).toBe("Finish or abort the rebase first");
    }
  });

  it("resets through Soft, Mixed, Hard, then a confirmation", async () => {
    const { host, actions } = mount(OLDER);
    await flush(60);

    verb(host, "Reset main to here")?.click();
    await flush(40);
    expect([...document.querySelectorAll('[role="menuitem"]')].map((entry) => entry.textContent?.replace(/keep changes.*|discard changes/, "").trim())).toEqual(["Soft", "Mixed", "Hard"]);
    (document.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    await flush(80);

    expect(actions.dialog()?.copy.title).toContain(OLDER.slice(0, 7));
    expect(calls.some((call) => call.cmd === "reset")).toBe(false);
    await actions.dialog()?.run();
    await flush(60);
    expect(calls.find((call) => call.cmd === "reset")?.args).toMatchObject({ path: "/r", target: OLDER, mode: "mixed" });
  });
});

describe("edit the HEAD message", () => {
  it("generates an editable amend draft from the resulting commit, locks fields while waiting, and restores prior text", async () => {
    let finish: ((draft: unknown) => void) | undefined;
    const draft = new Promise((resolve) => (finish = resolve));
    const { host } = mount(HEAD, { ai: ["generate_commit"], amendDraft: draft });
    await flush(60);
    editButton(host)?.click();
    await flush(60);
    const generate = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Generate a commit message"));
    expect(generate).not.toBeUndefined();
    generate?.click();
    await flush();
    expect(field(host, "Summary")?.disabled).toBe(true);
    expect(field(host, "Description")?.disabled).toBe(true);
    expect(buttonNamed(host, "Save message")?.disabled).toBe(true);
    expect(host.querySelector('.msgform [role="status"]')?.textContent).toContain("Generating");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Cancel generating"]')?.disabled).toBe(false);

    finish?.({ summary: "Describe the result", description: "Why it matters.", summary_trimmed: false, excluded: [], truncated: [] });
    await flush(80);
    expect(field(host, "Summary")?.value).toBe("Describe the result");
    expect(field(host, "Description")?.value).toBe("Why it matters.");
    expect(calls.some((call) => call.cmd === "edit_head_message")).toBe(false);
    host.querySelector<HTMLButtonElement>('button[aria-label="Restore my text"]')?.click();
    expect(field(host, "Summary")?.value).toBe("Tune retries");
    expect(field(host, "Description")?.value).toBe("Because.");
  });
  it("is offered only for the HEAD commit", async () => {
    const head = mount(HEAD);
    await flush(60);
    expect(editButton(head.host)).not.toBeNull();
    head.dispose();
    document.body.innerHTML = "";

    const older = mount(OLDER);
    await flush(60);
    expect(editButton(older.host)).toBeNull();
  });

  it("is disabled with the reason while an operation is in progress", async () => {
    const { host } = mount(HEAD, { operation: true });
    await flush(60);

    expect(editButton(host)?.getAttribute("aria-disabled")).toBe("true");
    expect(editButton(host)?.getAttribute("data-tip")).toBe("Finish the operation in progress first");
    editButton(host)?.click();
    await flush();
    expect(field(host, "Summary")).toBeNull();
  });

  it("opens a form prefilled with the current message and saves the edited one", async () => {
    const { host, selected } = mount(HEAD);
    await flush(60);

    editButton(host)?.click();
    await flush(60);
    expect(field(host, "Summary")?.value).toBe("Tune retries");
    expect(field(host, "Description")?.value).toBe("Because.");
    type(field(host, "Summary") as HTMLInputElement, "Tune retry limits");
    await flush();
    buttonNamed(host, "Save message")?.click();
    await flush(80);

    expect(calls.filter((call) => call.cmd === "edit_head_message")).toEqual([
      { cmd: "edit_head_message", args: { path: "/r", sha: HEAD, summary: "Tune retry limits", description: "Because." } },
    ]);
    expect(selected).toEqual(["c".repeat(40)]);
    expect(field(host, "Summary")).toBeNull();
  });

  it("warns that the commit is already on its upstream", async () => {
    const { host } = mount(HEAD, { pushed: true });
    await flush(60);

    editButton(host)?.click();
    await flush(60);

    expect(host.querySelector(".note.attention")?.textContent).toContain("origin/main");
  });

  it("keeps Save disabled without a summary and closes on Cancel without saving", async () => {
    const { host } = mount(HEAD);
    await flush(60);
    editButton(host)?.click();
    await flush(60);

    type(field(host, "Summary") as HTMLInputElement, "  ");
    await flush();
    expect(buttonNamed(host, "Save message")?.disabled).toBe(true);
    expect(host.textContent).toContain("Enter a summary");
    buttonNamed(host, "Cancel")?.click();
    await flush();

    expect(field(host, "Summary")).toBeNull();
    expect(calls.some((call) => call.cmd === "edit_head_message")).toBe(false);
  });
});

describe("file view entry", () => {
  const files: CommitDetails["files"] = [
    { path: "src/a.ts", original_path: null, status: "modified", additions: 1, deletions: 1 },
    { path: "src/gone.ts", original_path: null, status: "deleted", additions: 0, deletions: 4 },
  ];

  it("opens a file of the commit in the file view at that commit, and offers nothing for a file the commit deleted", async () => {
    const { host, viewed } = mount(HEAD, { files });
    await flush(80);

    host.querySelector<HTMLButtonElement>('button[aria-label="View src/a.ts"]')?.click();

    expect(viewed).toEqual([{ file: "src/a.ts", rev: HEAD, source: HEAD.slice(0, 7) }]);
    expect(host.querySelector('button[aria-label="View src/gone.ts"]')).toBeNull();
  });
});

describe("author badge", () => {
  const grace = { name: "Grace", email: "Grace@Example.test", time: 1_700_000_000 };

  const rowOf = (host: HTMLElement, label: string) => [...host.querySelectorAll(".mrow")].find((row) => row.querySelector(".k")?.textContent === label) as HTMLElement;

  it("shows the author badge beside the author and nothing beside the committer", async () => {
    const { host } = mount(OLDER, { author: grace });
    await flush(60);

    expect(rowOf(host, "Author").querySelector(".avatar")).not.toBeNull();
    expect(rowOf(host, "Author").textContent).toContain("Grace");
    expect(rowOf(host, "Committer").querySelector(".avatar")).toBeNull();
  });
});

describe("Jira issue chips", () => {
  it("shows the key as a chip with the issue summary and status word in the inspector", async () => {
    const { host } = mount(OLDER, { jira: { summary: "Retry login when the refresh races" } });
    await flush(100);

    const row = host.querySelector(".issue-chips") as HTMLElement;
    expect(row.querySelector(".chip.key .mono")?.textContent).toBe("ABC-142");
    expect(row.querySelector(".chip.key")?.getAttribute("data-tip")).toBe("ABC-142 · Retry login when the refresh races · Done");
    expect(row.textContent).toContain("ABC-142 Retry login when the refresh races · Done");
  });

  it("shows the key alone, with the failure in text, when the site could not be reached", async () => {
    const { host } = mount(OLDER, { jira: { summary: null, failure: "Could not reach your-site.atlassian.net: could not connect" } });
    await flush(100);

    const row = host.querySelector(".issue-chips") as HTMLElement;
    expect(row.querySelector(".chip.key")?.getAttribute("data-tip")).toBe("ABC-142 · issue details unavailable: Could not reach your-site.atlassian.net: could not connect");
    expect(row.textContent).toContain("issue details unavailable: Could not reach your-site.atlassian.net");
  });

  it("shows no chip row without a Jira connection", async () => {
    const { host } = mount(OLDER);
    await flush(80);

    expect(host.querySelector(".issue-chips")).toBeNull();
  });
});

describe("create branch from an issue", () => {
  it("opens the create-branch popover prefilled with the core's branch name, editable, and creates it from HEAD", async () => {
    const { actions } = mount(OLDER);
    await flush(60);

    await actions.openCreateBranchFromIssue({ key: "ABC-155", summary: "Show the account switcher" }, { left: 10, top: 10 });
    await flush(60);

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Branch name"]') as HTMLInputElement;
    expect(input.value).toBe("ABC-155-show-the-account-switcher");
    expect(calls.find((call) => call.cmd === "jira_branch_name")?.args).toEqual({ key: "ABC-155", summary: "Show the account switcher" });
    type(input, "ABC-155-switcher");
    await flush(60);
    (document.querySelector("form.popform") as HTMLFormElement).requestSubmit();
    await flush(80);

    expect(calls.find((call) => call.cmd === "create_branch")?.args).toEqual({ path: "/r", name: "ABC-155-switcher", at: null, checkout: true });
  });
});

describe("commit files", () => {
  const files: CommitDetails["files"] = [
    { path: "src/ui/button.ts", original_path: null, status: "modified", additions: 2, deletions: 1 },
    { path: "README.md", original_path: null, status: "modified", additions: 1, deletions: 0 },
    { path: "src/app.ts", original_path: null, status: "added", additions: 5, deletions: 0 },
  ];
  const named = (host: ParentNode, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  it("opens the file history at the commit from the History icon on a file row", async () => {
    const { host } = mount(OLDER, { files });
    await flush(80);

    const history = named(host, "History of src/app.ts");
    expect(history?.textContent?.trim()).toBe("");
    expect(history?.dataset.tip).toBe("History");
    history?.click();

    expect(takeFileHistoryRequest()).toEqual({ file: "src/app.ts", sha: OLDER });
  });

  it("switches the files between paths and a folder tree that toggles with the keyboard", async () => {
    const { host } = mount(OLDER, { files });
    await flush(80);

    const view = host.querySelector('section[aria-label="Files"] [role="group"][aria-label="File list view"]');
    expect([...(view?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label"))).toEqual(["Path view", "Tree view"]);
    named(host, "Tree view")?.click();
    await flush();

    const tree = host.querySelector('section[aria-label="Files"] [role="tree"]');
    const rows = () => [...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].map((row) => [row.querySelector(".file")?.textContent, row.getAttribute("aria-level")]);
    expect(rows()).toEqual([
      ["src", "1"],
      ["ui", "2"],
      ["button.ts", "3"],
      ["app.ts", "2"],
      ["README.md", "1"],
    ]);
    tree?.querySelector('[role="treeitem"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();
    expect(rows()).toEqual([
      ["src", "1"],
      ["README.md", "1"],
    ]);
    named(host, "Expand all folders")?.click();
    await flush();
    expect(rows()).toHaveLength(5);
    expect(named(host, "Stage folder src")).toBeNull();
  });

  it("lists the files the commit did not change with View all files, marked unchanged and not openable", async () => {
    const { host, opened } = mount(OLDER, { files, tree: ["README.md", "src/app.ts", "src/ui/button.ts", "src/util.ts"] });
    await flush(80);

    const viewAll = host.querySelector<HTMLButtonElement>('section[aria-label="Files"] button.chip-toggle[role="checkbox"]');
    expect(viewAll?.textContent?.trim()).toBe("View all files");
    expect(viewAll?.getAttribute("aria-checked")).toBe("false");
    expect(calls.some((call) => call.cmd === "commit_tree_paths")).toBe(false);
    viewAll?.click();
    await flush(80);

    expect(viewAll?.getAttribute("aria-checked")).toBe("true");
    expect(calls.find((call) => call.cmd === "commit_tree_paths")?.args).toEqual({ path: "/r", sha: OLDER });
    const rows = [...host.querySelectorAll<HTMLElement>('section[aria-label="Files"] .frow')];
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Modified README.md", "Added src/app.ts", "Modified src/ui/button.ts", "Unchanged src/util.ts"]);
    const unchanged = rows[3] as HTMLElement;
    expect(unchanged.textContent).toContain("unchanged");
    expect(unchanged.classList.contains("openable")).toBe(false);
    unchanged.click();
    unchanged.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(opened).toEqual([]);
    expect(named(host, "History of src/util.ts")).toBeNull();

    viewAll?.click();
    await flush();
    expect(host.querySelectorAll('section[aria-label="Files"] .frow')).toHaveLength(3);
  });
});

describe("explain commit with AI (S53)", () => {
  const EXPLAIN = "Explain this commit";
  const explain = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(`.ihead button[aria-label="${EXPLAIN}"]`);

  it("puts an icon-only wand in the commit header that explains the selected commit in a sheet", async () => {
    const { host } = mount(OLDER, { ai: ["explain_commit"], explain: { items: [{ path: "src/a.ts", text: "Tunes the retries." }], excluded: [], truncated: ["big.sql"] } });
    await flush(60);

    const button = explain(host);
    expect(button?.textContent?.trim()).toBe("");
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.dataset.tip).toBe(EXPLAIN);
    button?.click();
    await flush(60);

    const sheet = host.querySelector(".ai-sheet");
    expect(sheet?.getAttribute("aria-label")).toBe(`Explain commit ${OLDER.slice(0, 7)}`);
    expect(sheet?.querySelector(".ai-items .ref")?.textContent).toBe("src/a.ts");
    expect(sheet?.querySelector(".ai-text")?.textContent).toBe("Tunes the retries.");
    expect(sheet?.querySelector(".draft-notes")?.textContent).toContain("Cut to fit the size limit: big.sql");
    expect(calls.find((call) => call.cmd === "ai_explain_commit")?.args).toMatchObject({ path: "/r", sha: OLDER });
  });

  it("is shown for the HEAD commit beside Edit message, and hidden while the feature is off", async () => {
    const on = mount(HEAD, { ai: ["explain_commit"] });
    await flush(60);
    expect(explain(on.host)).not.toBeNull();
    expect(editButton(on.host)).not.toBeNull();
    on.dispose();
    document.body.innerHTML = "";

    const off = mount(HEAD, { ai: ["explain_changes"] });
    await flush(60);
    expect(explain(off.host)).toBeNull();
  });
});

describe("open in editor (S54)", () => {
  const files = [
    { path: "src/a.ts", original_path: null, status: "modified", additions: 1, deletions: 1 },
    { path: "src/gone.ts", original_path: null, status: "deleted", additions: 0, deletions: 4 },
  ] as CommitDetails["files"];

  it("offers Open in editor on every file row of a commit and opens the file", async () => {
    const { host } = mount(OLDER, { files });
    await flush(60);

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Open src/a.ts in editor"]');
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    expect(host.querySelector('button[aria-label="Open src/gone.ts in editor"]')).not.toBeNull();
    button?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "open_in_editor")?.args).toEqual({ path: "/r", file: "src/a.ts" });
  });

  it("keeps Open in editor visible but aria-disabled with its reason when no editor is chosen", async () => {
    toolsStatus = { editor: null, diff: null, merge: null };
    const { host } = mount(OLDER, { files });
    await flush(60);

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Open src/a.ts in editor"]');
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.dataset.tip).toBe("Open in editor. Choose an external editor in Settings → External tools");
    button?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "open_in_editor")).toBe(false);
  });
});

describe("commit continuity (S72)", () => {
  const NEXT = "c".repeat(40);
  const THIRD = "d".repeat(40);
  const graphRow = (sha: string, summary: string): GraphRow => ({ sha, parents: [HEAD], summary, body: "", author: null, time: person.time, refs: [], kind: "commit", column: 0, edges: [] });
  const loaded = (sha: string, summary: string, body: string): CommitDetails => ({ ...details(sha), summary, body });

  function mountSwitching(start: string) {
    const answers = new Map<string, { promise: Promise<CommitDetails>; resolve: (value: CommitDetails) => void }>();
    const answer = (sha: string) => {
      const known = answers.get(sha);
      if (known !== undefined) return known;
      let settle: (value: CommitDetails) => void = () => undefined;
      const promise = new Promise<CommitDetails>((done) => {
        settle = done;
      });
      const entry = { promise, resolve: (value: CommitDetails) => settle(value) };
      answers.set(sha, entry);
      return entry;
    };
    mockIPC((cmd, args) => {
      if (cmd === "commit_details") return answer((args as { sha: string }).sha).promise;
      if (cmd === "external_tools_status") return toolsStatus;
      if (cmd === "app_ui_prefs_load") return { palette_recents: [], last_parent_folder: null, file_list_mode: "path" };
      if (cmd === "ai_feature_config_list" || cmd === "jira_connections_list") return [];
      if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map(() => []);
      return null;
    });
    const session = testSession("/r", snapshot as unknown as RepoSnapshot);
    session.queryClient.setQueryData(repoKeys.graph("/r", 0, "all"), { rows: [graphRow(NEXT, "Next summary"), graphRow(THIRD, "Third summary")], carried: [], total: 2 });
    const [sha, setSha] = createSignal(start);
    const actions = createRepoActions(session, { selectedSha: sha, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", offline: () => false, inspectStash: () => undefined, undoEntry: () => undefined });
    const mounted = mountWithApp(() => (
      <CommitInspector session={session} actions={actions} sha={sha()} activeTarget={undefined} onSelectCommit={() => undefined} onOpenDiff={() => undefined} onViewFile={() => undefined} />
    ));
    dispose = mounted.dispose;
    const title = () => mounted.host.querySelector(".ihead h2")?.textContent;
    const body = () => mounted.host.querySelector(".commit-message")?.textContent.trim();
    return { ...mounted, setSha, title, body, finish: (target: string, value: CommitDetails) => answer(target).resolve(value) };
  }

  async function settledOn(view: ReturnType<typeof mountSwitching>) {
    view.finish(HEAD, loaded(HEAD, "Head summary", "Head body"));
    await flush();
    expect(view.title()).toBe("Head summary");
  }

  it("names the selected commit at once from its graph row and keeps the previous body, undimmed, until its details arrive", async () => {
    const view = mountSwitching(HEAD);
    await settledOn(view);

    view.setSha(NEXT);
    await flush();
    expect(view.title()).toBe("Next summary");
    expect(view.body()).toBe("Head body");
    expect(view.host.textContent).not.toContain("Loading commit");

    view.finish(NEXT, loaded(NEXT, "Next summary", "Next body"));
    await flush();
    expect(view.body()).toBe("Next body");
  });

  it("ends on the last choice and never renders a superseded read", async () => {
    const view = mountSwitching(HEAD);
    await settledOn(view);

    view.setSha(NEXT);
    await flush();
    view.setSha(THIRD);
    await flush();
    view.finish(NEXT, loaded(NEXT, "Next summary", "Next body"));
    await flush();
    expect(view.title()).toBe("Third summary");
    expect(view.body()).toBe("Head body");

    view.finish(THIRD, loaded(THIRD, "Third summary", "Third body"));
    await flush();
    expect(view.body()).toBe("Third body");
  });

  it("shows the pending line only once a read has taken 150ms", async () => {
    const view = mountSwitching(HEAD);
    await settledOn(view);
    const line = () => view.host.querySelector("[data-indicator]");

    view.setSha(NEXT);
    await flush(90);
    expect(line()).toBeNull();
    await flush(120);
    expect(line()?.getAttribute("role")).toBe("status");
  });

  it("holds off any indicator on a first load, then fills the body with static skeletons in its final geometry", async () => {
    const view = mountSwitching(NEXT);
    await flush();
    expect(view.title()).toBe("Next summary");
    expect(view.host.querySelector(".skeleton")).toBeNull();
    expect(view.host.textContent).not.toContain("Loading commit");

    await flush(200);
    const skeleton = view.host.querySelector(".commit-body[aria-hidden='true']");
    expect(skeleton?.querySelectorAll(".cmeta .mrow .skeleton").length).toBeGreaterThan(0);
    expect(skeleton?.querySelectorAll(".flist .frow .skeleton").length).toBeGreaterThan(0);
    const css = readFileSync(resolve(import.meta.dirname, "../styles/app.css"), "utf8");
    const rule = css.slice(css.indexOf(".skeleton {"), css.indexOf("}", css.indexOf(".skeleton {")));
    expect(rule).toContain("background: var(--colors-surface-2);");
    expect(rule).not.toMatch(/animation|gradient|opacity|color-mix/);
  });

  it("shows the short hash at once and a skeleton title when the commit has no graph row", async () => {
    const view = mountSwitching(OLDER);
    await flush();
    expect(view.host.querySelector(".ihead .ref")?.textContent).toBe(OLDER.slice(0, 7));
    expect(view.host.querySelector(".ihead .skeleton")).toBeNull();
    await flush(200);
    expect(view.host.querySelector(".ihead .skeleton")).not.toBeNull();
  });

  it("replaces the first-load skeleton through view-swap", async () => {
    const animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: () => undefined }));
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    document.documentElement.style.setProperty("--motion-quick", "120ms");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      const view = mountSwitching(NEXT);
      await flush(200);
      view.finish(NEXT, loaded(NEXT, "Next summary", "Next body"));
      await flush();
      const held = view.host.querySelector<HTMLElement>(".inspector[data-swap-held]");
      expect(held?.querySelector(".commit-body[aria-hidden='true'] .skeleton")).not.toBeNull();
      expect(view.body()).toBe("Next body");
      expect(animate.mock.contexts).toContain(held);
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      document.documentElement.style.removeProperty("--motion-quick");
    }
  });

  it("brings the arriving details in through view-swap", async () => {
    const animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: () => undefined }));
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    document.documentElement.style.setProperty("--motion-quick", "120ms");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    try {
      const view = mountSwitching(HEAD);
      await settledOn(view);
      view.setSha(NEXT);
      await flush();
      view.finish(NEXT, loaded(NEXT, "Next summary", "Next body"));
      await flush();
      const held = view.host.querySelector<HTMLElement>("[data-swap-held]");
      expect(held?.querySelector(".commit-message")?.textContent.trim()).toBe("Head body");
      expect(view.body()).toBe("Next body");
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      document.documentElement.style.removeProperty("--motion-quick");
    }
  });
});
