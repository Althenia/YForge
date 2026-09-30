import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { testSession } from "../components/testkit";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import { createWorktreeActions } from "./worktreeActions";

afterEach(() => clearMocks());

type Call = { cmd: string; args: Record<string, unknown> };

const lane = (overrides: Partial<WorktreeStatus>): WorktreeStatus => ({ path: "/w/repo", head: "a".repeat(40), branch: "main", bare: false, locked: false, prunable: false, current: true, dirty: false, ...overrides });
const main = lane({});
const feature = lane({ path: "/w/repo-feature", branch: "feature/x", current: false });
const fix = lane({ path: "/w/repo-fix", branch: "fix", current: false, dirty: true });
const rejection = (kind: string, message: string) => ({ kind, message, output: null });

function setup(handler: (call: Call) => unknown, worktrees: WorktreeStatus[] = [main, feature, fix]) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "worktree_list") return worktrees;
    if (cmd === "repo_open") return { root: "/r" };
    return handler(call);
  });
  const opened: string[] = [];
  const closed: string[] = [];
  const notices: Array<string | undefined> = [];
  const session = testSession("/r", { root: "/r", branches: ["main", "feature/x", "fix", "spare"], remote_branches: ["origin/main"] } as RepoSnapshot);
  const actions = createWorktreeActions(session, {
    openRepository: async (path) => (opened.push(path), true),
    closeTabsAt: (path) => closed.push(path),
    notify: (message) => notices.push(message),
  });
  return { actions, calls, opened, closed, notices, session, names: () => calls.map((call) => call.cmd) };
}

describe("worktree actions", () => {
  it("opens a worktree as a tab and hands any worktree path to the configured terminal", async () => {
    const { actions, opened, calls } = setup(() => null);

    await actions.open("/w/repo-feature");
    await actions.openTerminal("/w/repo-feature");

    expect(opened).toEqual(["/w/repo-feature"]);
    expect(calls.find((call) => call.cmd === "open_path")?.args).toEqual({ path: "/w/repo-feature", with: "terminal" });
  });

  describe("create", () => {
    it("creates a new branch from the start point, opens the worktree as a tab, and closes the dialog", async () => {
      const { actions, calls, opened } = setup((call) => (call.cmd === "worktree_create" ? "/w/repo-fresh" : null));
      actions.openCreate();

      const failure = await actions.create({ mode: "new", branch: "fresh", start: "refs/heads/main", destination: "/w/repo-fresh" });

      expect(failure).toBeUndefined();
      expect(calls.find((call) => call.cmd === "worktree_create")?.args).toEqual({ path: "/r", branch: "fresh", create: true, start: "refs/heads/main", destination: "/w/repo-fresh" });
      expect(opened).toEqual(["/w/repo-fresh"]);
      expect(actions.dialog()).toBeUndefined();
    });

    it("creates from an existing branch without a start point, and returns the refusal for the dialog to show", async () => {
      const { actions, calls, opened } = setup((call) => {
        if (call.cmd !== "worktree_create") return null;
        if (call.args.branch === "taken") throw rejection("invalid_request", "taken is already checked out at /w/elsewhere");
        return "/w/repo-spare";
      });
      actions.openCreate();

      const refused = await actions.create({ mode: "existing", branch: "taken", start: "refs/heads/main", destination: "/w/repo-taken" });
      expect(refused).toBe("taken is already checked out at /w/elsewhere");
      expect(actions.dialog()).toEqual({ kind: "create" });
      expect(opened).toEqual([]);

      await actions.create({ mode: "existing", branch: "spare", start: "refs/heads/main", destination: "/w/repo-spare" });
      expect(calls.filter((call) => call.cmd === "worktree_create")[1]?.args).toEqual({ path: "/r", branch: "spare", create: false, start: null, destination: "/w/repo-spare" });
    });

    it("suggests the folder for a branch through the core", async () => {
      const { actions, calls } = setup((call) => (call.cmd === "worktree_suggest_path" ? "/w/repo-feature-y" : null));

      expect(await actions.suggest("feature/y")).toBe("/w/repo-feature-y");
      expect(calls.find((call) => call.cmd === "worktree_suggest_path")?.args).toEqual({ path: "/r", branch: "feature/y" });
    });
  });

  describe("remove", () => {
    it("confirms, removes the worktree, closes its tab, and refreshes", async () => {
      const { actions, calls, closed } = setup(() => null);

      await actions.remove("/w/repo-feature");
      expect(actions.confirm()?.copy.title).toBe("Remove the worktree at /w/repo-feature?");
      expect(calls.some((call) => call.cmd === "worktree_remove")).toBe(false);
      await actions.confirm()?.run();

      expect(calls.find((call) => call.cmd === "worktree_remove")?.args).toEqual({ path: "/r", worktree: "/w/repo-feature", force: false });
      expect(closed).toEqual(["/w/repo-feature"]);
      expect(calls.some((call) => call.cmd === "repo_open")).toBe(true);
    });

    it("asks for the forced removal up front when the worktree has changes, and never removes without the second confirmation", async () => {
      const { actions, calls, closed } = setup(() => null);

      await actions.remove("/w/repo-fix");

      expect(actions.confirm()?.copy).toMatchObject({ title: "Remove the worktree at /w/repo-fix and discard its changes?", confirmLabel: "Remove and discard changes" });
      await actions.confirm()?.run();
      expect(calls.find((call) => call.cmd === "worktree_remove")?.args).toEqual({ path: "/r", worktree: "/w/repo-fix", force: true });
      expect(closed).toEqual(["/w/repo-fix"]);
    });

    it("turns a dirty refusal from the core into the forced confirmation", async () => {
      const { actions, calls } = setup((call) => {
        if (call.cmd === "worktree_remove" && call.args.force === false) throw rejection("worktree_dirty", "/w/repo-feature has changes");
        return null;
      });
      await actions.remove("/w/repo-feature");

      await actions.confirm()?.run();

      expect(actions.confirm()?.copy.confirmLabel).toBe("Remove and discard changes");
      await actions.confirm()?.run();
      expect(calls.filter((call) => call.cmd === "worktree_remove").map((call) => call.args.force)).toEqual([false, true]);
    });

    it("refuses the main and the open worktree with the reason, asking nothing", async () => {
      const { actions, notices } = setup(() => null);

      await actions.remove("/w/repo");

      expect(actions.confirm()).toBeUndefined();
      expect(notices).toEqual(["This worktree is open here. Switch to another worktree to remove it"]);
    });
  });

  describe("integrate", () => {
    it("opens the target dialog for a worktree that can integrate, and refuses one that cannot with the reason", async () => {
      const { actions, notices } = setup(() => null);

      await actions.integrate("/w/repo-fix");
      expect(actions.dialog()).toBeUndefined();
      await actions.integrate("/w/repo-feature");

      expect(notices).toEqual(["Commit or stash the changes in this worktree first"]);
      const dialog = actions.dialog();
      expect(dialog?.kind === "integrate" && dialog.worktree.path).toBe("/w/repo-feature");
    });

    it("runs the core integration, reports the result, and closes the tab of a cleaned-up worktree", async () => {
      const { actions, calls, closed, notices } = setup((call) => (call.cmd === "worktree_integrate" ? { kind: "integrated", target_sha: "abcdef1234567", cleaned_up: true } : null));
      await actions.integrate("/w/repo-feature");

      const failure = await actions.submitIntegrate("feature/x", "/w/repo-feature", "main", true);

      expect(failure).toBeUndefined();
      expect(calls.find((call) => call.cmd === "worktree_integrate")?.args).toEqual({ path: "/r", worktree: "/w/repo-feature", target: "main", cleanup: true });
      expect(notices.at(-1)).toBe("Integrated feature/x into main at abcdef1 and removed the worktree.");
      expect(closed).toEqual(["/w/repo-feature"]);
      expect(actions.dialog()).toBeUndefined();
    });

    it("keeps the tab of a worktree that stays", async () => {
      const { actions, closed } = setup((call) => (call.cmd === "worktree_integrate" ? { kind: "integrated", target_sha: "abcdef1234567", cleaned_up: false } : null));
      await actions.integrate("/w/repo-feature");

      await actions.submitIntegrate("feature/x", "/w/repo-feature", "main", false);

      expect(closed).toEqual([]);
    });

    it("routes a rebase that stopped on conflicts to the worktree that holds it", async () => {
      const { actions, opened, notices } = setup((call) => (call.cmd === "worktree_integrate" ? { kind: "conflicts", worktree: "/w/repo-feature" } : null));
      await actions.integrate("/w/repo-feature");

      await actions.submitIntegrate("feature/x", "/w/repo-feature", "main", true);

      expect(opened).toEqual(["/w/repo-feature"]);
      expect(notices.at(-1)).toBe("The rebase of feature/x onto main stopped on conflicts. Resolve them in /w/repo-feature, then continue.");
      expect(actions.dialog()).toBeUndefined();
    });

    it("returns a refusal for the dialog and keeps it open", async () => {
      const { actions } = setup((call) => {
        if (call.cmd === "worktree_integrate") throw rejection("operation_in_progress", "a rebase is in progress in /w/repo");
        return null;
      });
      await actions.integrate("/w/repo-feature");

      expect(await actions.submitIntegrate("feature/x", "/w/repo-feature", "main", false)).toBe("a rebase is in progress in /w/repo");
      expect(actions.dialog()?.kind).toBe("integrate");
    });
  });
});
