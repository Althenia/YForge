import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import { createWorktreeActions, type WorktreeActions } from "../state/worktreeActions";
import { CreateWorktreeDialog, IntegrateWorktreeDialog } from "./WorktreeDialogs";
import { WorktreePanel } from "./WorktreePanel";
import { buttonNamed, flush, mountWithApp, type, testSession } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const lane = (overrides: Partial<WorktreeStatus>): WorktreeStatus => ({ path: "/w/repo", head: "a".repeat(40), branch: "main", bare: false, locked: false, prunable: false, current: true, dirty: false, ...overrides });
const main = lane({});
const feature = lane({ path: "/w/repo-feature", branch: "feature/x", current: false });
const fix = lane({ path: "/w/repo-fix", branch: "fix", current: false, dirty: true, locked: true });
const snapshot = { root: "/w/repo", branches: ["main", "feature/x", "fix", "spare"], remote_branches: ["origin/main"], worktrees: [main, feature, fix] } as unknown as RepoSnapshot;

function setup(worktrees: WorktreeStatus[], handler: (call: Call) => unknown = () => null) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "worktree_list") return worktrees;
    if (cmd === "worktree_suggest_path") return `/w/repo-${String(call.args.branch).replace("/", "-")}`;
    return handler(call);
  });
  const opened: string[] = [];
  const notices: Array<string | undefined> = [];
  let actions!: WorktreeActions;
  let session!: ReturnType<typeof testSession>;
  createRoot(() => {
    session = testSession("/w/repo", snapshot);
    actions = createWorktreeActions(session, { openRepository: async (path) => (opened.push(path), true), closeTabsAt: () => undefined, notify: (message) => notices.push(message) });
  });
  return { calls, opened, notices, actions, session };
}

describe("worktree panel", () => {
  async function mountPanel(worktrees: WorktreeStatus[], handler?: (call: Call) => unknown) {
    const context = setup(worktrees, handler);
    const mounted = mountWithApp(() => <WorktreePanel session={context.session} actions={context.actions} onClose={() => undefined} />);
    dispose = mounted.dispose;
    await flush(40);
    return { ...mounted, ...context };
  }

  it("lists each worktree with its branch, the main worktree, the text flags, and its path", async () => {
    const { host } = await mountPanel([main, feature, fix]);

    const rows = [...host.querySelectorAll('ul[aria-label="Worktrees"] > li')];
    const text = (row: Element) => [...row.querySelectorAll(".wbranch, .chip, .wpath")].map((part) => part.textContent?.trim());
    expect(rows.map(text)).toEqual([
      ["main", "Main worktree", "current", "/w/repo"],
      ["feature/x", "/w/repo-feature"],
      ["fix", "changes", "locked", "/w/repo-fix"],
    ]);
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");
  });

  it("says there are no linked worktrees when only the main one exists, and offers Create worktree…", async () => {
    const { host, calls } = await mountPanel([main]);

    expect(host.textContent).toContain("No linked worktrees. Create one to work on another branch in parallel.");
    buttonNamed(host, "Create worktree…")?.click();
    expect(calls.some((call) => call.cmd === "worktree_list")).toBe(true);
  });

  it("opens a worktree as a tab, opens any worktree in the terminal, and disables Open for the one open here", async () => {
    const { host, opened, calls } = await mountPanel([main, feature]);

    const open = (path: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Open ${path} as a tab"]`) as HTMLButtonElement;
    expect(open("/w/repo").disabled).toBe(true);
    expect(open("/w/repo").title).toBe("This worktree is open here");
    open("/w/repo-feature").click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Open /w/repo in terminal"]')?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Open /w/repo-feature in terminal"]')?.click();
    await flush();

    expect(opened).toEqual(["/w/repo-feature"]);
    expect(calls.filter((call) => call.cmd === "open_path").map((call) => call.args)).toEqual([
      { path: "/w/repo", with: "terminal" },
      { path: "/w/repo-feature", with: "terminal" },
    ]);
  });

  it("marks Integrate and Remove unavailable with the reason and opens the matching flow when available", async () => {
    const { host, actions } = await mountPanel([main, feature, fix]);

    const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
    expect(button("Remove /w/repo").getAttribute("aria-disabled")).toBe("true");
    expect(button("Remove /w/repo").title).toBe("This worktree is open here. Switch to another worktree to remove it");
    expect(button("Remove /w/repo-fix").title).toBe("/w/repo-fix is locked. Unlock it first");
    expect(button("Integrate fix").title).toBe("Commit or stash the changes in this worktree first");
    expect(button("Integrate feature/x").hasAttribute("title")).toBe(false);

    button("Integrate feature/x").click();
    await flush(40);
    expect(actions.dialog()?.kind).toBe("integrate");
    button("Remove /w/repo-feature").click();
    await flush(40);
    expect(actions.confirm()?.copy.title).toBe("Remove the worktree at /w/repo-feature?");
  });
});

describe("create worktree dialog", () => {
  async function mountCreate(handler?: (call: Call) => unknown) {
    const context = setup([main, feature], handler);
    const mounted = mountWithApp(() => <CreateWorktreeDialog snapshot={snapshot} actions={context.actions} />);
    dispose = mounted.dispose;
    await flush(40);
    return { ...mounted, ...context };
  }
  const field = (name: string) => document.querySelector(`[aria-label="${name}"]`) as HTMLInputElement & HTMLSelectElement;

  it("suggests the folder from the new branch name, refuses a name in use, and creates from the chosen start point", async () => {
    const { calls, opened, actions } = await mountCreate((call) => (call.cmd === "worktree_create" ? "/w/repo-fresh" : null));
    actions.openCreate();
    const create = buttonNamed(document, "Create worktree") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(document.body.textContent).toContain("Enter a branch name");

    type(field("Branch name"), "fix");
    await flush(40);
    expect(document.body.textContent).toContain("A branch named fix already exists");
    expect(create.disabled).toBe(true);

    type(field("Branch name"), "fresh");
    await flush(60);
    expect(field("Folder").value).toBe("/w/repo-fresh");
    expect(calls.find((call) => call.cmd === "worktree_suggest_path")?.args).toEqual({ path: "/w/repo", branch: "fresh" });
    field("Start from").value = "refs/heads/main";
    field("Start from").dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(create.disabled).toBe(false);
    create.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "worktree_create")?.args).toEqual({ path: "/w/repo", branch: "fresh", create: true, start: "refs/heads/main", destination: "/w/repo-fresh" });
    expect(opened).toEqual(["/w/repo-fresh"]);
  });

  it("keeps a folder the user typed instead of the suggestion, and requires a full path", async () => {
    const { calls } = await mountCreate();

    type(field("Folder"), "relative");
    type(field("Branch name"), "fresh");
    await flush(60);

    expect(field("Folder").value).toBe("relative");
    expect(document.body.textContent).toContain("Use a full path, starting with /");
    expect((buttonNamed(document, "Create worktree") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((call) => call.cmd === "worktree_suggest_path")).toBe(false);
  });

  it("offers only branches no worktree holds for an existing branch, and shows the core's refusal", async () => {
    const { calls } = await mountCreate((call) => {
      if (call.cmd === "worktree_create") throw { kind: "invalid_request", message: "the folder is not empty", output: null };
      return null;
    });

    buttonNamed(document, "Existing branch")?.click();
    await flush(60);
    expect([...field("Branch").options].map((option) => option.value)).toEqual(["spare"]);
    expect(field("Folder").value).toBe("/w/repo-spare");
    buttonNamed(document, "Create worktree")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "worktree_create")?.args).toMatchObject({ branch: "spare", create: false, start: null });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("the folder is not empty");
  });
});

describe("integrate worktree dialog", () => {
  async function mountIntegrate(handler?: (call: Call) => unknown) {
    const context = setup([main, feature, fix], handler);
    const mounted = mountWithApp(() => <IntegrateWorktreeDialog worktree={feature} all={[main, feature, fix]} actions={context.actions} />);
    dispose = mounted.dispose;
    await flush(40);
    return { ...mounted, ...context };
  }

  it("defaults to main with the removal ticked and states the exact sequence, and changes the statement when it is unticked", async () => {
    await mountIntegrate();

    const target = document.querySelector<HTMLSelectElement>('select[aria-label="Target branch"]') as HTMLSelectElement;
    expect([...target.options].map((option) => option.value)).toEqual(["main", "fix"]);
    expect(target.value).toBe("main");
    const cleanup = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(cleanup.checked).toBe(true);
    expect(document.body.textContent).toContain("Rebase feature/x onto main in /w/repo-feature, fast-forward main to it");
    expect(document.body.textContent).toContain("Remove the worktree at /w/repo-feature and delete the branch feature/x.");
    cleanup.click();
    await flush();
    expect(cleanup.checked).toBe(false);
    expect(document.body.textContent).toContain("The worktree and feature/x are kept.");
  });

  it("integrates into main and removes the worktree with one confirmation, then closes", async () => {
    const { calls, notices, actions } = await mountIntegrate((call) => (call.cmd === "worktree_integrate" ? { kind: "integrated", target_sha: "abcdef1234567", cleaned_up: true } : null));
    actions.openCreate();

    buttonNamed(document, "Integrate")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "worktree_integrate")?.args).toEqual({ path: "/w/repo", worktree: "/w/repo-feature", target: "main", cleanup: true });
    expect(notices.at(-1)).toBe("Integrated feature/x into main at abcdef1 and removed the worktree.");
    expect(actions.dialog()).toBeUndefined();
  });

  it("keeps the worktree when the removal is unticked", async () => {
    const { calls, notices } = await mountIntegrate((call) => (call.cmd === "worktree_integrate" ? { kind: "integrated", target_sha: "abcdef1234567", cleaned_up: false } : null));

    (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    await flush();
    buttonNamed(document, "Integrate")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "worktree_integrate")?.args).toEqual({ path: "/w/repo", worktree: "/w/repo-feature", target: "main", cleanup: false });
    expect(notices.at(-1)).toBe("Integrated feature/x into main at abcdef1.");
  });

  it("shows the refusal and stays open", async () => {
    await mountIntegrate((call) => {
      if (call.cmd === "worktree_integrate") throw { kind: "worktree_dirty", message: "/w/repo has changes", output: null };
      return null;
    });

    buttonNamed(document, "Integrate")?.click();
    await flush(60);

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("/w/repo has changes");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
