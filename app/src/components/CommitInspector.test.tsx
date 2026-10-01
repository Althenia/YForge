import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileViewTarget } from "../state/fileView";
import type { CommitDetails } from "../ipc/bindings/CommitDetails";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createRepoActions } from "../state/repoActions";
import { BranchNameForm } from "./BranchForms";
import { CommitInspector } from "./CommitInspector";
import { ContextMenu } from "./ContextMenu";
import { buttonNamed, flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

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

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const person = { name: "Ada", email: "ada@example.test", time: 1_700_000_000 };

const details = (sha: string): CommitDetails => ({ sha, summary: "Tune retries", body: "Because.", author: person, committer: person, parents: [OLDER], refs: [], files: [] });

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: HEAD }, upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } }, operation: null, remotes: ["origin"], remote_branches: [], branches: ["main"], files: [] } as unknown as RepoSnapshot;

function mount(sha: string, options: { pushed?: boolean; operation?: boolean; files?: CommitDetails["files"]; parents?: string[]; author?: CommitDetails["author"]; jira?: { summary: string | null; failure?: string } } = {}) {
  const selected: string[] = [];
  const viewed: FileViewTarget[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "jira_connections_list") return options.jira === undefined ? [] : [{ id: "j1", kind: "cloud", site: "https://your-site.atlassian.net", host: "your-site.atlassian.net", email: "a@b.c", display_name: "V", projects: [{ key: "ABC", name: "Accounts" }], created_at: 1 }];
    if (cmd === "jira_branch_name") return `${(args as { key: string }).key}-show-the-account-switcher`;
    if (cmd === "jira_issue_keys") return (args as { texts: string[] }).texts.map((text) => text.match(/ABC-\d+/g) ?? []);
    if (cmd === "jira_issues_lookup") {
      const found = options.jira?.summary ?? null;
      return (args as { keys: string[] }).keys.map((key) => ({ key, issue: found === null ? null : { key, summary: found, status: "Done", status_category: "done", issue_type: "Bug", project: "ABC", updated_at: "", web_url: "", connection_id: "j1" }, failure: options.jira?.failure ?? null }));
    }
    if (cmd === "commit_details") return { ...details(sha), summary: options.jira === undefined ? "Tune retries" : "Retry login (ABC-142)", author: options.author ?? person, files: options.files ?? [], parents: options.parents ?? [OLDER] };
    if (cmd === "amend_info") return { sha: HEAD, summary: "Tune retries", description: "Because.", pushed: options.pushed ?? false };
    if (cmd === "repo_open") return options.operation === true ? { ...snapshot, operation: "rebase" } : snapshot;
    if (cmd === "integration_preview") return { incoming: { count: 0, commits: [] }, outgoing: { count: 1, commits: [] }, fast_forward: false };
    if (cmd === "edit_head_message") return { sha: "c".repeat(40), pushed: options.pushed ?? false };
    return null;
  });
  const current = options.operation === true ? ({ ...snapshot, operation: "rebase" } as unknown as RepoSnapshot) : snapshot;
  const session = testSession("/r", current);
  const actions = createRepoActions(session, { selectedSha: () => sha, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", offline: () => false, inspectStash: () => undefined, openWorktree: async () => true, undoEntry: () => undefined });
  const mounted = mountWithApp(() => (
    <>
      <CommitInspector session={session} actions={actions} sha={sha} activeTarget={undefined} onSelectCommit={(next) => selected.push(next)} onOpenDiff={() => undefined} onViewFile={(view) => viewed.push(view)} />
      <Show when={actions.menu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={actions.closeMenu} />}
      </Show>
      <Show when={actions.popover()} keyed>
        {(state) => (state.kind === "create_branch" ? <BranchNameForm state={state} session={session} actions={actions} /> : null)}
      </Show>
    </>
  ));
  dispose = mounted.dispose;
  return { ...mounted, selected, viewed, actions };
}

const editButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
const field = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);

const verb = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`.ihead button[aria-label="${name}"]`);

describe("commit age", () => {
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
