import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import { autoStashMessage, createRepoActions, restoreMessage } from "./repoActions";
import { testSession } from "../components/testkit";

let offline = false;
const inspected: string[] = [];
const openedWorktrees: string[] = [];

afterEach(() => {
  clearMocks();
  offline = false;
  inspected.length = 0;
  openedWorktrees.length = 0;
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "main", startPoint: "a" },
    upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
    counts,
    files: [],
    operation: null,
    operation_detail: null,
    last_fetch: null,
    branches: ["main", "feature"],
    remote_branches: ["origin/main", "origin/remote-only"],
    remotes: ["origin"],
    tags: ["v1"],
    stashes: [],
    worktrees: [],
    ...overrides,
  }) as RepoSnapshot;

type Call = { cmd: string; args: Record<string, unknown> };

function setup(handler: (call: Call) => unknown, initial: RepoSnapshot = snapshot(), selectedSha?: string, onSelectionGone: () => void = () => undefined, entries: ActivityEntry[] = []) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "repo_open") return initial;
    return handler(call);
  });
  const session = testSession("/r", initial);
  const actions = createRepoActions(session, { selectedSha: () => selectedSha, onSelectionGone, pullMode: () => "fast_forward_or_merge", offline: () => offline, inspectStash: (sha) => inspected.push(sha), openWorktree: async (target) => (openedWorktrees.push(target), true), undoEntry: (id) => entries.find((entry) => entry.id === id) });
  return { calls, session, actions, names: () => calls.map((call) => call.cmd) };
}

const noLoss = { count: 0, commits: [] };

const rejection = (kind: string, message: string, output: string | null = null) => ({ kind, message, output });

describe("checkout", () => {
  it("switches to a local branch and refreshes the snapshot", async () => {
    const { actions, calls } = setup(() => ({ auto_stash: "none" }));

    actions.checkout({ kind: "local_branch", name: "feature" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls[0]).toEqual({ cmd: "checkout", args: { path: "/r", target: { kind: "local_branch", name: "feature" }, stash: false } });
    expect(calls.some((call) => call.cmd === "repo_open")).toBe(true);
  });

  it("asks for confirmation before a detached checkout and states the consequence", async () => {
    const { actions, calls } = setup(() => ({ auto_stash: "none" }), snapshot({ counts: { ...counts, modified: 1 } }));

    actions.checkout({ kind: "tag", name: "v1" });

    expect(calls).toEqual([]);
    const dialog = actions.dialog();
    expect(dialog?.copy.title).toBe("Check out v1 as a detached HEAD?");
    expect(dialog?.copy.consequences.join(" ")).toMatch(/belong to no branch/);
    await dialog?.run();
    expect(calls[0]?.args).toMatchObject({ target: { kind: "tag", name: "v1" }, stash: false });
  });

  it("offers Stash and switch when local changes block the switch, then retries with stash", async () => {
    let attempt = 0;
    const { actions, calls, session } = setup((call) => {
      if (call.cmd !== "checkout") return null;
      attempt += 1;
      if (attempt === 1) throw rejection("local_changes", "Local changes would be overwritten", "error: overwritten");
      return { auto_stash: "stashed" };
    });

    actions.checkout({ kind: "local_branch", name: "feature" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = actions.dialog();
    expect(dialog?.copy.confirmLabel).toBe("Stash and switch");
    expect(session.notice()).toBeUndefined();
    await dialog?.run();
    const checkouts = calls.filter((call) => call.cmd === "checkout");
    expect(checkouts.map((call) => call.args.stash)).toEqual([false, true]);
    expect(checkouts.map((call) => call.args.leaveStashed)).toEqual([undefined, true]);
    expect(dialog?.copy.consequences.join(" ")).toMatch(/offered back when you return to main/);
    expect(session.notice()).toBe("Switched to feature. Your changes are stashed and will be offered back when you return to main.");
  });

  it("checks out a remote-only branch as a tracking branch and prefers an existing local branch", async () => {
    const { actions, calls } = setup(() => ({ auto_stash: "none" }));

    actions.openRefMenu({ kind: "remote_branch", name: "origin/remote-only", startPoint: "abc1234" }, { left: 1, top: 2 });
    actions.menu()?.run("checkout");
    actions.openRefMenu({ kind: "remote_branch", name: "origin/feature", startPoint: "abc1234" }, { left: 1, top: 2 });
    actions.menu()?.run("checkout");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.filter((call) => call.cmd === "checkout").map((call) => call.args.target)).toEqual([
      { kind: "remote_branch", name: "origin/remote-only" },
      { kind: "local_branch", name: "feature" },
    ]);
  });

  it("reports a failed switch and its git output", async () => {
    const { actions, session } = setup(() => {
      throw rejection("git_failed", "git switch failed", "fatal: bad\nmore");
    });

    actions.checkout({ kind: "local_branch", name: "feature" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.notice()).toBe("git switch failed: fatal: bad");
  });

  it("words each auto-stash outcome", () => {
    expect(autoStashMessage("none", "x")).toBeUndefined();
    expect(autoStashMessage("conflicts", "x")).toMatch(/kept in stash@\{0\}/);
    expect(autoStashMessage("kept", "x")).toMatch(/remain in stash@\{0\}/);
    expect(autoStashMessage("stashed", "x", "main")).toBe("Switched to x. Your changes are stashed and will be offered back when you return to main.");
    expect(autoStashMessage("stashed", "x", undefined)).toBe("Switched to x. Your changes are stashed in stash@{0}.");
  });
});

describe("branch creation, rename, and deletion", () => {
  it("sends the selected commit's id to create_branch when the form is submitted", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { actions, calls } = setup(() => null, snapshot(), sha);

    actions.openCreateBranch({ left: 5, top: 6 });
    expect(actions.popover()).toMatchObject({ kind: "create_branch", at: sha, atLabel: "0123456" });
    await actions.submitCreateBranch("topic", true);

    expect(calls[0]).toEqual({ cmd: "create_branch", args: { path: "/r", name: "topic", at: sha, checkout: true } });
    expect(actions.popover()).toBeUndefined();
  });

  it("sends a null start point, meaning HEAD, when no commit is selected", async () => {
    const { actions, calls } = setup(() => null);

    actions.openCreateBranch({ left: 5, top: 6 });
    await actions.submitCreateBranch("topic", false);

    expect(calls[0]).toEqual({ cmd: "create_branch", args: { path: "/r", name: "topic", at: null, checkout: false } });
  });

  it("creates at the commit of a commit row's context menu, not at the selection", async () => {
    const { actions, calls } = setup(() => null, snapshot(), "aaaaaaaaaaaa");

    actions.openCommitMenu("bbbbbbbbbbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("create_branch");
    await actions.submitCreateBranch("topic", true);

    expect(calls[0]?.args).toMatchObject({ name: "topic", at: "bbbbbbbbbbbbbbbb" });
  });

  it("does nothing when submitted without an open create form", async () => {
    const { actions, calls } = setup(() => null);

    await actions.submitCreateBranch("topic", true);

    expect(calls).toEqual([]);
  });

  it("opens the create form from a ref label at that label's commit", () => {
    const { actions } = setup(() => null);

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "abc1234def" }, { left: 1, top: 2 });
    actions.menu()?.run("create_branch");

    expect(actions.popover()).toMatchObject({ kind: "create_branch", at: "abc1234def", atLabel: "abc1234" });
  });

  it("deletes a fully merged branch without a dialog", async () => {
    const { actions, calls, names } = setup((call) => (call.cmd === "branch_delete_preview" ? noLoss : null));

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(actions.dialog()).toBeUndefined();
    expect(names().slice(0, 2)).toEqual(["branch_delete_preview", "delete_branch"]);
    expect(calls[1]?.args).toMatchObject({ name: "feature", force: false });
  });

  it("confirms deleting an unmerged branch, naming the lost commits, and forces only after confirmation", async () => {
    const lost = { count: 1, commits: [{ sha: "aaaaaaa1234", summary: "Topic work" }] };
    const { actions, calls } = setup((call) => (call.cmd === "branch_delete_preview" ? lost : null));

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = actions.dialog();
    expect(dialog?.copy.names).toEqual(["aaaaaaa Topic work"]);
    expect(calls.some((call) => call.cmd === "delete_branch")).toBe(false);
    await dialog?.run();
    expect(calls.find((call) => call.cmd === "delete_branch")?.args).toMatchObject({ name: "feature", force: true });
  });

  it("opens the rename form for a local branch", () => {
    const { actions } = setup(() => null);

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "a" }, { left: 3, top: 4 });
    actions.menu()?.run("rename");

    expect(actions.popover()).toMatchObject({ kind: "rename_branch", name: "feature" });
  });
});

describe("sync", () => {
  it("fetches with a fresh operation id, tracks progress for that id only, and ends idle", async () => {
    let release: () => void = () => {};
    const { actions, calls } = setup((call) => (call.cmd === "fetch" ? new Promise((resolve) => (release = () => resolve(null))) : null));

    const done = actions.fetchAll();
    const running = actions.sync();
    expect(running.kind).toBe("running");
    const id = running.kind === "running" ? running.id : "";
    actions.onProgress({ id: "someone-else", phase: "Receiving objects", percent: 99 });
    actions.onProgress({ id, phase: "Receiving objects", percent: 42 });
    expect(actions.sync()).toMatchObject({ kind: "running", label: "Fetching", phase: "Receiving objects", percent: 42 });
    release();
    await done;

    expect(actions.sync()).toEqual({ kind: "idle" });
    expect(calls.find((call) => call.cmd === "fetch")?.args).toEqual({ path: "/r", id, prune: false });
  });

  it("updates submodules after a successful fetch only when the repository asks", async () => {
    const calls: Call[] = [];
    mockIPC((cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "repo_open") return snapshot();
      return null;
    });
    const session = testSession("/r", snapshot());
    const base = { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge" as const, offline: () => false, inspectStash: () => undefined, openWorktree: async () => true, undoEntry: () => undefined };
    await createRepoActions(session, base).fetchAll();
    expect(calls.some((call) => call.cmd === "submodule_update")).toBe(false);

    calls.length = 0;
    await createRepoActions(session, { ...base, submoduleUpdateOnFetch: () => true }).fetchAll();
    expect(calls.find((call) => call.cmd === "submodule_update")?.args).toEqual({ path: "/r", submodulePath: null });

    calls.length = 0;
    mockIPC((cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "fetch") throw rejection("cancelled", "The operation was cancelled");
      if (cmd === "repo_open") return snapshot();
      return null;
    });
    await createRepoActions(testSession("/r", snapshot()), { ...base, submoduleUpdateOnFetch: () => true }).fetchAll();
    expect(calls.some((call) => call.cmd === "submodule_update")).toBe(false);
  });

  it("reports a cancelled operation and returns to idle", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "fetch") throw rejection("cancelled", "The operation was cancelled");
      return true;
    });

    await actions.fetchAll();

    expect(session.notice()).toBe("Fetch cancelled.");
    expect(actions.sync()).toEqual({ kind: "idle" });
  });

  it("sends operation_cancel with the running id", async () => {
    let release: () => void = () => {};
    const { actions, calls } = setup((call) => (call.cmd === "fetch" ? new Promise((resolve) => (release = () => resolve(null))) : true));

    const done = actions.fetchAll();
    const state = actions.sync();
    actions.cancelSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await done;

    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: state.kind === "running" ? state.id : "" });
  });

  it("shows 'auth failed for <remote>' with the next action and retries the same operation", async () => {
    let attempts = 0;
    const { actions, session } = setup((call) => {
      if (call.cmd !== "fetch") return null;
      attempts += 1;
      if (attempts === 1) throw rejection("auth_failed", "Authentication failed for origin", "fatal: could not read Username");
      return null;
    });

    await actions.fetchAll();

    expect(actions.sync()).toMatchObject({ kind: "failed", message: "auth failed for origin" });
    expect(session.notice()).toBeUndefined();
    await actions.retrySync();
    expect(attempts).toBe(2);
    expect(actions.sync()).toEqual({ kind: "idle" });
  });

  it("pulls with the chosen mode and reports a conflicting pull", async () => {
    const { actions, calls, session } = setup((call) => (call.cmd === "pull" ? "conflicts" : null));

    actions.openPullMenu({ left: 0, top: 0 });
    actions.menu()?.run("pull:rebase");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.find((call) => call.cmd === "pull")?.args).toMatchObject({ path: "/r", mode: "rebase" });
    expect(session.notice()).toMatch(/stopped on conflicts/);
  });

  it("says so when a pull finds nothing new", async () => {
    const { actions, session } = setup((call) => (call.cmd === "pull" ? "up_to_date" : null));

    await actions.pull("fast_forward_or_merge");

    expect(session.notice()).toBe("Already up to date.");
  });

  it("pushes a tracked branch and lets a rejected push with local commits offer the force-with-lease dialog", async () => {
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "f86d53a" }, upstream: "origin/main", replaced: { count: 0, commits: [] } };
    const ahead = snapshot({ upstream: { name: "origin/main", ahead_behind: { ahead: 1, behind: 0 } } });
    const { actions, calls } = setup((call) => {
      if (call.cmd === "push") throw rejection("push_rejected", "The remote rejected the push");
      return call.cmd === "push_plan" ? plan : null;
    }, ahead);

    await actions.push();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.map((call) => call.cmd)).toContain("push_plan");
    expect(actions.dialog()?.copy.title).toBe("Force push with lease");
  });

  it("tells the user to pull when a rejected push has nothing of theirs to force", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "push") throw rejection("push_rejected", "The remote rejected the push");
      return null;
    });

    await actions.push();

    expect(session.notice()).toBe("The remote has commits you do not have. Pull first, then push.");
    expect(actions.dialog()).toBeUndefined();
  });

  it("keeps Push from opening a force dialog when the branch diverged and offers the lease from the strip notice", async () => {
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "c4d5e6f" }, upstream: "origin/main", replaced: { count: 1, commits: [{ sha: "c4d5e6fabc", summary: "Fix the proxy timeout" }] } };
    const diverged = snapshot({ upstream: { name: "origin/main", ahead_behind: { ahead: 2, behind: 1 } } });
    const { actions, names } = setup((call) => (call.cmd === "push_plan" ? plan : null), diverged);

    expect(actions.notices()[0]).toMatchObject({ text: "This branch has diverged", dismiss: false, detail: "Remote commits would be replaced." });
    await actions.push();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(names()).toEqual(["push_plan"]);
    expect(actions.dialog()).toBeUndefined();
    const notice = actions.notices()[0];
    expect(notice?.detail).toBe("c4d5e6f Fix the proxy timeout would be replaced");
    expect(notice?.actions[0]?.label).toBe("Force push with lease");
    await notice?.actions[0]?.run();

    expect(actions.dialog()?.copy.title).toBe("Force push with lease");
    expect(actions.dialog()?.copy.names).toContain("c4d5e6f Fix the proxy timeout");
  });

  it("force pushes with the lease from the plan and reports a rejected lease", async () => {
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "f86d53a" }, upstream: "origin/main", replaced: { count: 0, commits: [] } };
    const { actions, calls, session } = setup((call) => {
      if (call.cmd === "push_force") throw rejection("push_rejected", "The remote rejected the push");
      return null;
    });

    await actions.confirmForcePush(plan);

    expect(calls.find((call) => call.cmd === "push_force")?.args).toMatchObject({ lease: plan.lease });
    expect(session.notice()).toMatch(/nothing was replaced/);
    expect(actions.dialog()).toBeUndefined();
  });

  it("ignores a second sync while one is running", async () => {
    let release: () => void = () => {};
    const { actions, calls } = setup((call) => (call.cmd === "fetch" ? new Promise((resolve) => (release = () => resolve(null))) : null));

    const first = actions.fetchAll();
    await actions.fetchAll();
    release();
    await first;

    expect(calls.filter((call) => call.cmd === "fetch")).toHaveLength(1);
  });
});

describe("stash", () => {
  const stash: StashEntry = { index: 0, sha: "s0", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: wip", time: 1 };

  it("applies, pops, and reports conflicts", async () => {
    const { actions, calls, session } = setup((call) => (call.cmd === "stash_pop" ? "conflicts" : "applied"));

    actions.openStashMenu(stash, { left: 0, top: 0 });
    actions.menu()?.run("apply");
    await new Promise((resolve) => setTimeout(resolve, 0));
    actions.openStashMenu(stash, { left: 0, top: 0 });
    actions.menu()?.run("pop");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls.filter((call) => call.cmd.startsWith("stash_")).map((call) => [call.cmd, call.args])).toEqual([
      ["stash_apply", { path: "/r", index: 0, sha: "s0" }],
      ["stash_pop", { path: "/r", index: 0, sha: "s0" }],
    ]);
    expect(session.notice()).toMatch(/kept/);
    expect(restoreMessage("apply", "applied")).toBeUndefined();
  });

  it("drops only after confirmation", async () => {
    const { actions, calls } = setup(() => null);

    actions.openStashMenu(stash, { left: 0, top: 0 });
    actions.menu()?.run("drop");
    const dialog = actions.dialog();

    expect(dialog?.copy.confirmLabel).toBe("Drop stash");
    expect(calls.some((call) => call.cmd === "stash_drop")).toBe(false);
    await dialog?.run();
    expect(calls.find((call) => call.cmd === "stash_drop")?.args).toEqual({ path: "/r", index: 0, sha: "s0" });
  });

  it("stashes changes with the message and the untracked choice", async () => {
    const { actions, calls } = setup(() => null);

    actions.openStashForm({ left: 0, top: 0 });
    expect(actions.popover()?.kind).toBe("stash");
    await actions.stashChanges("wip", true);

    expect(calls[0]).toEqual({ cmd: "stash_push", args: { path: "/r", message: "wip", untracked: true } });
  });
});

describe("operations in progress", () => {
  const merging = snapshot({ operation: "merge", operation_detail: { current: "main", incoming: "topic", message: "Merge topic", step: null, resolved: [] } });

  it("continues with the message and reports when a rebase stops at the next conflict", async () => {
    const { actions, calls, session } = setup((call) => (call.cmd === "operation_continue" ? "conflicts" : null), merging);

    await actions.continueOperation("Merge topic");

    expect(calls[0]).toEqual({ cmd: "operation_continue", args: { path: "/r", message: "Merge topic" } });
    expect(session.notice()).toBe("The next step stopped on conflicts.");
    expect(actions.operationBusy()).toBe(false);
  });

  it("skips a step", async () => {
    const { actions, names } = setup((call) => (call.cmd === "operation_skip" ? "completed" : null), merging);

    await actions.skipOperation();

    expect(names()[0]).toBe("operation_skip");
  });

  it("aborts only after a confirmation naming the operation", async () => {
    const { actions, calls } = setup(() => null, merging);

    actions.abortOperation();
    const dialog = actions.dialog();

    expect(dialog?.copy.title).toBe("Abort the merge?");
    expect(calls).toEqual([]);
    await dialog?.run();
    expect(calls[0]).toEqual({ cmd: "operation_abort", args: { path: "/r" } });
  });

  it("marks files resolved and reports the refusal while markers remain", async () => {
    const { actions, calls, session } = setup((call) => {
      if (call.cmd === "mark_resolved") throw rejection("conflict_markers", "a.txt still contains conflict markers");
      return null;
    }, merging);

    await actions.markResolved(["a.txt"]);

    expect(calls[0]).toEqual({ cmd: "mark_resolved", args: { path: "/r", files: ["a.txt"] } });
    expect(session.notice()).toBe("a.txt still contains conflict markers");
  });
});

const commitBrief = (summary: string) => ({ sha: "1234567890abcdef", summary });
const previewOf = (incoming: number, outgoing: number) => ({
  incoming: { count: incoming, commits: incoming > 0 ? [commitBrief("Incoming")] : [] },
  outgoing: { count: outgoing, commits: outgoing > 0 ? [commitBrief("Mine")] : [] },
  fast_forward: incoming > 0 && outgoing === 0,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const feature = { kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "abc1234def" } as const;

describe("integration actions", () => {
  it("previews a merge, opens the merge form, and merges with the chosen mode", async () => {
    const { actions, calls, session } = setup((call) => (call.cmd === "integration_preview" ? previewOf(2, 0) : "completed"));

    actions.openRefMenu(feature, { left: 1, top: 2 });
    actions.menu()?.run("merge");
    await settle();

    expect(calls[0]).toEqual({ cmd: "integration_preview", args: { path: "/r", base: null, other: "feature" } });
    expect(actions.popover()).toMatchObject({ kind: "merge", source: "feature", current: "main" });
    await actions.submitMerge("merge_commit");
    expect(calls.find((call) => call.cmd === "merge")?.args).toEqual({ path: "/r", source: "feature", mode: "merge_commit" });
    expect(actions.popover()).toBeUndefined();
    expect(session.notice()).toBeUndefined();
  });

  it("says the branch is up to date instead of opening the merge form", async () => {
    const { actions, session } = setup(() => previewOf(0, 3));

    actions.openRefMenu(feature, { left: 1, top: 2 });
    actions.menu()?.run("merge");
    await settle();

    expect(actions.popover()).toBeUndefined();
    expect(session.notice()).toBe("Already up to date.");
  });

  it("lands a conflicting merge in the operation state with a notice", async () => {
    const { actions, session, names } = setup((call) => (call.cmd === "integration_preview" ? previewOf(1, 1) : "conflicts"));

    actions.openRefMenu(feature, { left: 1, top: 2 });
    actions.menu()?.run("merge");
    await settle();
    await actions.submitMerge("merge_commit");

    expect(session.notice()).toBe("Merge stopped on conflicts. Resolve them, then continue, or abort.");
    expect(names().at(-1)).toBe("repo_open");
  });

  it("confirms a rebase with the commits replayed and rebases the current branch onto the ref", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "integration_preview" ? previewOf(1, 2) : "completed"));

    actions.openRefMenu(feature, { left: 1, top: 2 });
    actions.menu()?.run("rebase");
    await settle();

    const dialog = actions.dialog();
    expect(dialog?.copy.title).toBe("Rebase main onto feature?");
    expect(dialog?.copy.names).toEqual(["1234567 Mine"]);
    expect(calls.some((call) => call.cmd === "rebase")).toBe(false);
    await dialog?.run();
    expect(calls.find((call) => call.cmd === "rebase")?.args).toEqual({ path: "/r", onto: "feature" });
  });

  it("explains a refused fast-forward without a raw git error", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "fast_forward") throw rejection("not_fast_forward", "diverged", "main has commits that feature does not contain");
      return null;
    });

    actions.openRefMenu(feature, { left: 1, top: 2 });
    actions.menu()?.run("fast_forward");
    await settle();

    expect(session.notice()).toBe("main cannot be fast-forwarded to feature: main has commits that feature does not contain");
  });

  it("cherry-picks and reverts the commit of a commit menu and reports conflicts", async () => {
    const { actions, calls, session } = setup((call) => (call.cmd === "cherry_pick" ? "conflicts" : "completed"));

    actions.openCommitMenu("bbbbbbbbbbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("cherry_pick");
    await settle();
    expect(calls[0]).toEqual({ cmd: "cherry_pick", args: { path: "/r", sha: "bbbbbbbbbbbbbbbb" } });
    expect(session.notice()).toBe("Cherry-pick stopped on conflicts. Resolve them, then continue, or abort.");

    actions.openCommitMenu("bbbbbbbbbbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("revert");
    await settle();
    expect(calls.some((call) => call.cmd === "revert" && call.args.sha === "bbbbbbbbbbbbbbbb")).toBe(true);
  });

  it("offers the three reset modes and confirms a hard reset with a danger dialog naming the lost changes", async () => {
    const dirty = snapshot({
      counts: { ...counts, modified: 1, untracked: 1 },
      files: [
        { path: "a.txt", original_path: null, area: "unstaged", status: "modified" },
        { path: "scratch.txt", original_path: null, area: "untracked", status: "untracked" },
      ],
    });
    const { actions, calls } = setup((call) => (call.cmd === "integration_preview" ? previewOf(0, 2) : null), dirty);

    actions.openCommitMenu("bbbbbbbbbbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("reset");
    expect(actions.menu()?.entries.flatMap((entry) => (entry.kind === "item" ? [entry.id] : []))).toEqual(["soft", "mixed", "hard"]);
    actions.menu()?.run("hard");
    await settle();

    const dialog = actions.dialog();
    expect(dialog?.copy.title).toBe("Hard reset main to bbbbbbb?");
    expect(dialog?.copy.neutral).toBe(false);
    expect(dialog?.copy.also?.names).toEqual(["a.txt"]);
    expect(calls.some((call) => call.cmd === "reset")).toBe(false);
    actions.closeDialog();
    expect(calls.some((call) => call.cmd === "reset")).toBe(false);

    await dialog?.run();
    expect(calls.find((call) => call.cmd === "reset")?.args).toEqual({ path: "/r", target: "bbbbbbbbbbbbbbbb", mode: "hard" });
  });

  it("creates a tag at the commit of the row and pushes it when asked", async () => {
    const { actions, calls } = setup(() => null);

    actions.openCommitMenu("bbbbbbbbbbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("create_tag");
    expect(actions.popover()).toMatchObject({ kind: "create_tag", at: "bbbbbbbbbbbbbbbb", remote: "origin" });
    const problem = await actions.submitCreateTag({ name: "v1", message: "Release", push: true });

    expect(problem).toBeUndefined();
    expect(calls[0]).toEqual({ cmd: "create_tag", args: { path: "/r", name: "v1", at: "bbbbbbbbbbbbbbbb", message: "Release" } });
    const pushed = calls.find((call) => call.cmd === "push_tag");
    expect(pushed?.args).toMatchObject({ path: "/r", remote: "origin", name: "v1" });
    expect(actions.popover()).toBeUndefined();
  });

  it("keeps the tag form open and returns the reason when the name is taken", async () => {
    const { actions } = setup((call) => {
      if (call.cmd === "create_tag") throw rejection("invalid_request", "Invalid request: a tag named v1 already exists");
      return null;
    });

    actions.openCreateBranch({ left: 0, top: 0 });
    actions.openRefMenu({ kind: "tag", name: "v0", startPoint: "refs/tags/v0" }, { left: 1, top: 2 });
    actions.menu()?.run("create_tag");
    const problem = await actions.submitCreateTag({ name: "v1", message: null, push: false });

    expect(problem).toBe("Invalid request: a tag named v1 already exists");
    expect(actions.popover()?.kind).toBe("create_tag");
  });

  it("confirms deleting a tag locally and from the remote separately", async () => {
    const { actions, calls } = setup(() => null);
    const tag = { kind: "tag", name: "v1", startPoint: "refs/tags/v1" } as const;

    actions.openRefMenu(tag, { left: 1, top: 2 });
    actions.menu()?.run("delete_tag");
    expect(actions.dialog()?.copy.title).toBe("Delete tag v1?");
    await actions.dialog()?.run();
    expect(calls[0]).toEqual({ cmd: "delete_tag", args: { path: "/r", name: "v1" } });

    actions.openRefMenu(tag, { left: 1, top: 2 });
    actions.menu()?.run("delete_remote_tag");
    expect(actions.dialog()?.copy.title).toBe("Delete v1 from origin?");
    await actions.dialog()?.run();
    expect(calls.find((call) => call.cmd === "delete_remote_tag")?.args).toMatchObject({ path: "/r", remote: "origin", name: "v1" });
  });

  it("pushes a tag to the default remote from the tag menu", async () => {
    const { actions, calls } = setup(() => null);

    actions.openRefMenu({ kind: "tag", name: "v1", startPoint: "refs/tags/v1" }, { left: 1, top: 2 });
    actions.menu()?.run("push_tag");
    await settle();

    expect(calls[0]?.cmd).toBe("push_tag");
    expect(calls[0]?.args).toMatchObject({ remote: "origin", name: "v1" });
  });

  it("opens the drop menu with a fast-forward preview and runs the chosen integration", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "integration_preview" ? previewOf(3, 0) : "completed"));

    await actions.openDropMenu(feature, { kind: "local_branch", name: "main", remoteName: undefined, startPoint: "def" }, { left: 1, top: 2 });

    const menu = actions.menu();
    expect(menu?.title).toEqual(["Drop ", { ref: "feature" }, " on ", { ref: "main" }]);
    expect(calls[0]?.args).toEqual({ path: "/r", base: null, other: "feature" });
    menu?.run("fast_forward");
    await settle();
    expect(calls.find((call) => call.cmd === "fast_forward")?.args).toEqual({ path: "/r", branch: "main", target: "feature" });
  });

  it("explains a drop that has no integration instead of opening a menu", async () => {
    const { actions, session } = setup(() => null);

    await actions.openDropMenu({ kind: "tag", name: "v1", startPoint: "x" }, feature, { left: 1, top: 2 });

    expect(actions.menu()).toBeUndefined();
    expect(session.notice()).toMatch(/no integration to offer/);
  });
});

describe("phase 3b actions", () => {
  it("pulls with the effective default mode", async () => {
    const { actions, calls } = setup(() => null, snapshot(), undefined);
    const rebasing = createRepoActions(testSession("/r", snapshot()), { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "rebase", offline: () => false, inspectStash: () => undefined, openWorktree: async () => true, undoEntry: () => undefined });

    await rebasing.pullDefault();
    await actions.pullDefault();

    expect(calls.filter((call) => call.cmd === "pull").map((call) => call.args.mode)).toEqual(["rebase", "fast_forward_or_merge"]);
  });

  it("publishes to the chosen remote as a tracked operation and ends idle", async () => {
    const { actions, calls } = setup(() => null);

    await actions.publish("backup");

    const publish = calls.find((call) => call.cmd === "publish");
    expect(publish?.args).toMatchObject({ path: "/r", remote: "backup" });
    expect(actions.sync()).toEqual({ kind: "idle" });
  });

  it("auto-fetches without prompting and reports success", async () => {
    const { actions, calls } = setup(() => null);

    await actions.autoFetch();

    expect(calls.find((call) => call.cmd === "fetch")?.args).toMatchObject({ interactive: false, prune: false });
    expect(actions.autoFetchPause()).toBeUndefined();
  });

  it("pauses auto-fetch with the reason in state, not a toast, when an auto-fetch fails, and keeps the auth state", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "fetch") throw rejection("auth_failed", "Authentication failed for origin");
      return null;
    });

    await actions.autoFetch();

    expect(actions.autoFetchPause()).toBe("Authentication failed for origin");
    expect(session.notice()).toBeUndefined();
    expect(actions.sync()).toMatchObject({ kind: "failed", message: "auth failed for origin" });
  });

  it("pauses with the first line of git's output when an auto-fetch fails for another reason", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "fetch") throw rejection("internal", "git fetch failed", "\nfatal: unable to access 'https://host/r.git/': Could not resolve host\n");
      return null;
    });

    await actions.autoFetch();

    expect(actions.autoFetchPause()).toBe("git fetch failed: fatal: unable to access 'https://host/r.git/': Could not resolve host");
    expect(session.notice()).toBeUndefined();
  });

  it("does not pause when the user cancels the auto-fetch", async () => {
    const { actions } = setup((call) => {
      if (call.cmd === "fetch") throw rejection("cancelled", "Cancelled");
      return null;
    });

    await actions.autoFetch();

    expect(actions.autoFetchPause()).toBeUndefined();
  });

  it("stops auto-fetching while paused, and a successful manual fetch clears the pause and resumes it", async () => {
    let failing = true;
    const { actions, calls } = setup((call) => {
      if (call.cmd === "fetch" && failing) throw rejection("internal", "git fetch failed");
      return null;
    });
    const fetches = () => calls.filter((call) => call.cmd === "fetch").length;

    await actions.autoFetch();
    await actions.autoFetch();
    expect(fetches()).toBe(1);
    expect(actions.autoFetchPause()).toBe("git fetch failed");

    await actions.fetchAll();
    expect(fetches()).toBe(2);
    expect(actions.autoFetchPause()).toBe("git fetch failed");

    failing = false;
    await actions.fetchAll();
    expect(actions.autoFetchPause()).toBeUndefined();

    await actions.autoFetch();
    expect(fetches()).toBe(4);
  });

  it("skips the auto-fetch when there are no remotes or an operation is in progress", async () => {
    const none = setup(() => null, snapshot({ remotes: [] }));
    const busy = setup(() => null, snapshot({ operation: "merge" }));

    await none.actions.autoFetch();
    await busy.actions.autoFetch();
    expect(none.actions.autoFetchPause()).toBeUndefined();
    expect(busy.actions.autoFetchPause()).toBeUndefined();
    expect(none.calls.some((call) => call.cmd === "fetch")).toBe(false);
    expect(busy.calls.some((call) => call.cmd === "fetch")).toBe(false);
  });

  it("undoes an operation by id and refreshes, or reports the refusal", async () => {
    const ok = setup(() => "Moved main back to abc1234");
    await ok.actions.undo(7);
    expect(ok.calls.find((call) => call.cmd === "undo_last")?.args).toEqual({ path: "/r", id: 7 });
    expect(ok.names()).toContain("repo_open");

    const refused = setup((call) => {
      if (call.cmd === "undo_last") throw rejection("invalid_request", "Invalid request: HEAD is no longer where the operation left it. Nothing was changed");
      return null;
    });
    await refused.actions.undo(7);
    expect(refused.session.notice()).toContain("Nothing was changed");
  });

  it("asks for confirmation that states the consequence before undoing a force push, and runs the undo only when confirmed", async () => {
    const scope = "Undo force push: force-pushes origin/main back to f86d53a with a lease on e2b1c09, so it is refused if the remote moved since";
    const forcePush = { id: 7, operation: "Force push", local: true, ok: true, undo: { kind: "available", scope } } as ActivityEntry;
    const { actions, calls } = setup(() => "Restored refs/heads/main on origin to f86d53a", snapshot(), undefined, () => undefined, [forcePush]);

    await actions.undo(7);

    expect(calls).toEqual([]);
    const dialog = actions.dialog();
    expect(dialog?.copy.title).toBe("Undo the force push?");
    expect(dialog?.copy.lead).toBe(scope);
    await dialog?.run();
    expect(calls.find((call) => call.cmd === "undo_last")?.args).toEqual({ path: "/r", id: 7 });
  });

  it("drops a selected commit that the undo removed from the graph, and keeps one that is still in it", async () => {
    const searched: unknown[] = [];
    const searchRows = (rows: number[]) => (call: Call) => {
      if (call.cmd !== "search_commits") return null;
      searched.push(call.args);
      return { total: 3, rows };
    };
    let gone = 0;
    const undone = setup(searchRows([]), snapshot(), "abc1234", () => (gone += 1));
    await undone.actions.undo(7);
    expect(searched).toEqual([{ path: "/r", query: "sha:abc1234" }]);
    expect(gone).toBe(1);

    const kept = setup(searchRows([1]), snapshot(), "abc1234", () => (gone += 1));
    await kept.actions.undo(7);
    expect(gone).toBe(1);

    const unselected = setup(searchRows([]), snapshot(), undefined, () => (gone += 1));
    await unselected.actions.undo(7);
    expect(unselected.names()).not.toContain("search_commits");
    expect(gone).toBe(1);
  });

  it("opens the create tag, rename, and delete flows used by the palette", () => {
    const { actions } = setup(() => null);

    actions.openRenameBranch("feature", { left: 1, top: 2 });
    expect(actions.popover()).toMatchObject({ kind: "rename_branch", name: "feature" });
    actions.openCreateBranchAt("abc1234", { left: 1, top: 2 });
    expect(actions.popover()).toMatchObject({ kind: "create_branch", at: "abc1234", atLabel: "abc1234" });
    actions.deleteLocalTag("v1");
    expect(actions.dialog()?.copy.title).toContain("v1");
    actions.deleteTagOnRemote("v1");
    expect(actions.dialog()?.copy.title).toContain("origin");
  });
});

const dirty = () => snapshot({ counts: { ...counts, modified: 2 } });
const later = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("fetch and prune", () => {
  it("fetches with prune from the fetch menu and the plain fetch never prunes", async () => {
    const { actions, calls } = setup(() => null);

    actions.openFetchMenu({ left: 0, top: 0 });
    actions.menu()?.run("fetch_prune");
    await later();
    actions.openFetchMenu({ left: 0, top: 0 });
    actions.menu()?.run("fetch");
    await later();

    expect(calls.filter((call) => call.cmd === "fetch").map((call) => call.args.prune)).toEqual([true, false]);
  });

  it("disables fetch while offline and does not auto-fetch", async () => {
    offline = true;
    const { actions, calls } = setup(() => null);

    actions.openFetchMenu({ left: 0, top: 0 });
    const fetch = actions.menu()?.entries.find((entry) => entry.kind === "item" && entry.id === "fetch");
    expect(fetch).toMatchObject({ disabledReason: "You are offline" });
    await actions.autoFetch();
    expect(actions.autoFetchPause()).toBeUndefined();
    expect(calls.some((call) => call.cmd === "fetch")).toBe(false);
  });
});

describe("pull with a dirty working tree", () => {
  it("pulls without stashing when the tree is clean", async () => {
    const { actions, names } = setup(() => "updated");

    await actions.pull("rebase");

    expect(names()).toContain("pull");
    expect(names()).not.toContain("pull_with_autostash");
    expect(actions.notices()).toEqual([]);
  });

  it("stashes and restores around the pull and says so until dismissed", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "pull_with_autostash" ? { outcome: "updated", stash: { kind: "restored" } } : null), dirty());

    await actions.pull("rebase");

    expect(calls.find((call) => call.cmd === "pull_with_autostash")?.args).toMatchObject({ path: "/r", mode: "rebase" });
    expect(calls.some((call) => call.cmd === "pull")).toBe(false);
    expect(actions.notices()).toMatchObject([{ text: "Your changes were stashed and restored", actions: [] }]);
    actions.dismissNotice(actions.notices()[0]?.id ?? "");
    expect(actions.notices()).toEqual([]);
  });

  it("keeps the notice with Apply and Pop when the changes stay in the stash, and each acts on that stash", async () => {
    const kept = { outcome: "conflicts", stash: { kind: "kept", reference: "stash@{2}", sha: "abc123", reason: "pull_conflicts" } };
    const { actions, calls } = setup((call) => (call.cmd === "pull_with_autostash" ? kept : "applied"), dirty());

    await actions.pull("fast_forward_or_merge");

    const notice = actions.notices()[0];
    expect(notice?.text).toBe("Your changes are kept in stash@{2}");
    expect(notice?.detail).toBe("The pull stopped on conflicts. Your changes come back when you complete or abort it.");
    expect(notice?.actions.map((action) => action.label)).toEqual(["Apply", "Pop"]);
    await notice?.actions[1]?.run();
    expect(calls.find((call) => call.cmd === "stash_pop")?.args).toEqual({ path: "/r", index: 2, sha: "abc123" });
    expect(actions.notices()).toEqual([]);
  });

  describe("a pull that stopped on conflicts with the changes kept in the stash", () => {
    const stashes = [{ index: 2, sha: "abc123", base_sha: "b", author_name: "Ada", author_email: "a@example.test", message: "On main: YForge: auto-stash before pulling origin/main", time: 1 }];
    const resting = () => snapshot({ counts: { ...counts, modified: 2 }, operation: "merge", operation_detail: { current: "main", incoming: "origin/main", message: "Merge", step: null, resolved: [] }, stashes });
    const kept = { outcome: "conflicts", stash: { kind: "kept", reference: "stash@{2}", sha: "abc123", reason: "pull_conflicts" } };

    async function pulled(outcomeOf: (cmd: string) => unknown) {
      const made = setup((call) => (call.cmd === "pull_with_autostash" ? kept : (outcomeOf(call.cmd) ?? null)), resting());
      await made.actions.pull("fast_forward_or_merge");
      return made;
    }

    it("pops that stash when the operation completes and dismisses the notice", async () => {
      const { actions, calls, session } = await pulled((cmd) => (cmd === "operation_continue" ? "completed" : cmd === "stash_pop" ? "applied" : undefined));

      await actions.continueOperation(null);

      expect(calls.find((call) => call.cmd === "stash_pop")?.args).toEqual({ path: "/r", index: 2, sha: "abc123" });
      expect(actions.notices()).toEqual([]);
      expect(session.notice()).toBe("Restored your stashed changes.");
    });

    it("pops that stash after the operation is aborted", async () => {
      const { actions, calls } = await pulled((cmd) => (cmd === "stash_pop" ? "applied" : undefined));

      actions.abortOperation();
      await actions.dialog()?.run();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(calls.some((call) => call.cmd === "operation_abort")).toBe(true);
      expect(calls.find((call) => call.cmd === "stash_pop")?.args).toEqual({ path: "/r", index: 2, sha: "abc123" });
      expect(actions.notices()).toEqual([]);
    });

    it("keeps the stash while the next step is still in conflict", async () => {
      const { actions, calls } = await pulled((cmd) => (cmd === "operation_continue" ? "conflicts" : undefined));

      await actions.continueOperation(null);

      expect(calls.some((call) => call.cmd === "stash_pop")).toBe(false);
      expect(actions.notices()[0]?.text).toBe("Your changes are kept in stash@{2}");
    });

    it("leaves the stash alone once the user dismissed the notice", async () => {
      const { actions, calls } = await pulled((cmd) => (cmd === "operation_continue" ? "completed" : undefined));

      actions.dismissNotice(actions.notices()[0]?.id ?? "");
      await actions.continueOperation(null);

      expect(calls.some((call) => call.cmd === "stash_pop")).toBe(false);
    });

    it("reports a restore that conflicts and keeps the stash", async () => {
      const { actions, session } = await pulled((cmd) => (cmd === "operation_continue" ? "completed" : cmd === "stash_pop" ? "conflicts" : undefined));

      await actions.continueOperation(null);

      expect(session.notice()).toBe("The stash applied with conflicts and was kept. Resolve them in the Changes list.");
    });
  });

  it("still reports a conflicting or up-to-date pull", async () => {
    const stash = { kind: "none" };
    const { actions, session } = setup(() => ({ outcome: "up_to_date", stash }), dirty());

    await actions.pull("fast_forward_or_merge");

    expect(session.notice()).toBe("Already up to date.");
    expect(actions.notices()).toEqual([]);
  });
});

describe("stash and switch", () => {
  it("offers to restore the changes stashed when the user left this branch, and restores them", async () => {
    const recorded = [{ branch: "main", sha: "s1", message: "On main: wip", created_at: 5, index: 0 }];
    const { actions, calls } = setup((call) => (call.cmd === "switch_stashes" ? recorded : call.cmd === "switch_stash_restore" ? "applied" : null));

    await actions.offerSwitchStashes();

    const notice = actions.notices()[0];
    expect(notice?.text).toBe("Restore the changes stashed when you left main?");
    expect(notice?.detail).toBe("On main: wip");
    expect(notice?.actions.map((action) => action.label)).toEqual(["Restore", "Keep in stash"]);
    await notice?.actions[0]?.run();
    expect(calls.find((call) => call.cmd === "switch_stash_restore")?.args).toEqual({ path: "/r", branch: "main", sha: "s1" });
    expect(actions.notices()).toEqual([]);
  });

  it("keeps the changes in the stash and forgets the prompt on Keep in stash", async () => {
    const recorded = [{ branch: "main", sha: "s1", message: "wip", created_at: 5, index: 0 }];
    const { actions, calls } = setup((call) => (call.cmd === "switch_stashes" ? recorded : null));

    await actions.offerSwitchStashes();
    await actions.notices()[0]?.actions[1]?.run();

    expect(calls.find((call) => call.cmd === "switch_stash_dismiss")?.args).toEqual({ path: "/r", branch: "main", sha: "s1" });
    expect(calls.some((call) => call.cmd === "switch_stash_restore")).toBe(false);
    expect(actions.notices()).toEqual([]);
  });

  it("reports a conflicting restore and asks once per recorded stash", async () => {
    const recorded = [{ branch: "main", sha: "s1", message: "wip", created_at: 5, index: 0 }];
    const { actions, session } = setup((call) => (call.cmd === "switch_stashes" ? recorded : call.cmd === "switch_stash_restore" ? "conflicts" : null));

    await actions.offerSwitchStashes();
    await actions.offerSwitchStashes();
    expect(actions.notices()).toHaveLength(1);
    await actions.notices()[0]?.actions[0]?.run();

    expect(session.notice()).toMatch(/applied with conflicts/);
  });

  it("asks nothing when no stash was recorded or HEAD is detached", async () => {
    const { actions, names } = setup(() => []);
    await actions.offerSwitchStashes();
    expect(actions.notices()).toEqual([]);

    const detached = setup(() => [], snapshot({ head: { kind: "detached", sha: "a" } as never }));
    await detached.actions.offerSwitchStashes();
    expect(detached.names()).not.toContain("switch_stashes");
    expect(names()).toContain("switch_stashes");
  });
});

describe("remote branches", () => {
  it("confirms before deleting a remote branch, then deletes it through the sync runner", async () => {
    const { actions, calls } = setup(() => null);

    actions.openRefMenu({ kind: "remote_branch", name: "origin/remote-only", startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete_remote");

    expect(actions.dialog()?.copy.title).toBe("Delete origin/remote-only from origin?");
    expect(calls.some((call) => call.cmd === "delete_remote_branch")).toBe(false);
    await actions.dialog()?.run();
    expect(calls.find((call) => call.cmd === "delete_remote_branch")?.args).toMatchObject({ path: "/r", remote: "origin", name: "remote-only" });
    expect(actions.sync()).toEqual({ kind: "idle" });
  });

  it("deletes the remote branch of a local branch from the local branch's menu", async () => {
    const { actions, calls } = setup(() => null);

    actions.openRefMenu({ kind: "local_branch", name: "main", remoteName: "origin/main", startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete_remote");
    await actions.dialog()?.run();

    expect(calls.find((call) => call.cmd === "delete_remote_branch")?.args).toMatchObject({ remote: "origin", name: "main" });
  });

  it("deletes a local branch and its remote branch together after one confirmation naming both", async () => {
    const lost = { count: 1, commits: [{ sha: "aaaaaaa1234", summary: "Topic work" }] };
    const { actions, names, calls } = setup((call) => (call.cmd === "branch_delete_preview" ? lost : null), snapshot({ remote_branches: ["origin/feature"] }));

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: "origin/feature", startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete_both");
    await later();

    expect(actions.dialog()?.copy.title).toBe("Delete feature and origin/feature?");
    expect(actions.dialog()?.copy.names).toEqual(["aaaaaaa Topic work"]);
    await actions.dialog()?.run();
    const order = names().filter((name) => name === "delete_branch" || name === "delete_remote_branch");
    expect(order).toEqual(["delete_branch", "delete_remote_branch"]);
    expect(calls.find((call) => call.cmd === "delete_branch")?.args).toMatchObject({ name: "feature", force: true });
  });

  it("does not touch the remote when the local deletion fails", async () => {
    const { actions, names, session } = setup((call) => {
      if (call.cmd === "delete_branch") throw rejection("invalid_request", "Cannot delete");
      return call.cmd === "branch_delete_preview" ? noLoss : null;
    }, snapshot({ remote_branches: ["origin/feature"] }));

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: "origin/feature", startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete_both");
    await later();
    await actions.dialog()?.run();

    expect(names()).not.toContain("delete_remote_branch");
    expect(session.notice()).toBe("Cannot delete");
  });
});

describe("upstream and Push to…", () => {
  it("sets and unsets an upstream through the branch commands", async () => {
    const { actions, calls } = setup(() => null);

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "a" }, { left: 1, top: 2 });
    actions.menu()?.run("set_upstream");
    expect(actions.popover()).toMatchObject({ kind: "set_upstream", branch: "feature", anchor: { left: 1, top: 2 } });
    await actions.setUpstream("feature", "origin/remote-only");
    await actions.unsetUpstream();

    expect(calls.filter((call) => call.cmd === "set_upstream").map((call) => call.args)).toEqual([
      { path: "/r", branch: "feature", upstream: "origin/remote-only" },
      { path: "/r", branch: "main", upstream: null },
    ]);
    expect(actions.popover()).toBeUndefined();
  });

  it("opens the upstream form for the checked-out branch from the branch menu", () => {
    const { actions } = setup(() => null);

    actions.openBranchPicker({ left: 4, top: 5 });
    actions.menu()?.run("set_upstream");

    expect(actions.popover()).toMatchObject({ kind: "set_upstream", branch: "main" });
  });

  it("pushes the current branch to a chosen remote and name with the set-upstream choice", async () => {
    const { actions, calls } = setup(() => null);

    actions.openPushTo({ left: 0, top: 0 });
    expect(actions.popover()).toMatchObject({ kind: "push_to" });
    await actions.pushTo({ remote: "origin", name: "topic", set_upstream: true });

    expect(calls.find((call) => call.cmd === "push_to")?.args).toMatchObject({ path: "/r", target: { remote: "origin", name: "topic", set_upstream: true } });
    expect(actions.popover()).toBeUndefined();
    expect(actions.sync()).toEqual({ kind: "idle" });
  });

  it("explains a rejected Push to… instead of offering a force", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "push_to") throw rejection("push_rejected", "The remote rejected the push");
      return null;
    });

    await actions.pushTo({ remote: "origin", name: "main", set_upstream: false });

    expect(session.notice()).toBe("origin/main has commits this branch does not. Pull first, or push to another name.");
    expect(actions.dialog()).toBeUndefined();
  });

  it("lists every local branch in the branch picker with the checked-out one marked, and switches on selection", async () => {
    const { actions, calls } = setup(() => ({ auto_stash: "none" }));

    actions.openBranchPicker({ left: 0, top: 0 });
    const entries = actions.menu()?.entries ?? [];
    const checkout = entries.filter((entry) => entry.kind === "item" && entry.id.startsWith("checkout:"));
    expect(checkout.map((entry) => (entry.kind === "item" ? [entry.id, entry.disabledReason, entry.icon] : []))).toEqual([
      ["checkout:main", "Already checked out", "check"],
      ["checkout:feature", undefined, "local"],
    ]);
    expect(entries.some((entry) => entry.kind === "item" && entry.id === "unset_upstream")).toBe(true);
    actions.menu()?.run("checkout:feature");
    await later();

    expect(calls.find((call) => call.cmd === "checkout")?.args).toMatchObject({ target: { kind: "local_branch", name: "feature" } });
  });
});

describe("stash rename and inspect", () => {
  const stash: StashEntry = { index: 1, sha: "s1", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: wip", time: 1 };

  it("opens the rename form and renames through the stash command", async () => {
    const { actions, calls } = setup(() => null);

    actions.openStashMenu(stash, { left: 0, top: 0 });
    actions.menu()?.run("rename_stash");
    expect(actions.popover()).toMatchObject({ kind: "rename_stash", stash });
    await actions.renameStash(stash, "better name");

    expect(calls.find((call) => call.cmd === "stash_rename")?.args).toEqual({ path: "/r", index: 1, sha: "s1", message: "better name" });
    expect(actions.popover()).toBeUndefined();
  });

  it("hands the stash to the inspector", () => {
    const { actions } = setup(() => null);

    actions.openStashMenu(stash, { left: 0, top: 0 });
    actions.menu()?.run("inspect");

    expect(inspected).toEqual(["s1"]);
  });
});

describe("authentication failure fix", () => {
  const failing = (remoteUrl: string) =>
    setup((call) => {
      if (call.cmd === "fetch") throw rejection("auth_failed", "Authentication failed for origin", "fatal");
      return call.cmd === "remotes_list" ? [{ name: "origin", fetch_url: remoteUrl, push_url: null }] : null;
    });

  it("points an SSH remote at the SSH key setting", async () => {
    const { actions } = failing("git@github.com:o/r.git");

    await actions.fetchAll();

    expect(actions.sync()).toMatchObject({ kind: "failed", fix: { section: "git", label: "Choose an SSH key" } });
  });

  it("points an HTTPS remote at the repository's remotes", async () => {
    const { actions } = failing("https://github.com/o/r.git");

    await actions.fetchAll();

    expect(actions.sync()).toMatchObject({ kind: "failed", fix: { section: "repository" } });
  });
});

describe("commit menu with a multi-selection", () => {
  it("titles the menu with the selection size and disables single-commit verbs", () => {
    const { actions } = setup(() => null);

    actions.openCommitMenu("a1", false, { left: 0, top: 0 }, ["a1", "b2", "c3"]);

    expect(actions.menu()?.title).toEqual(["3 commits selected"]);
    const cherry = actions.menu()?.entries.find((entry) => entry.kind === "item" && entry.id === "cherry_pick");
    expect(cherry).toMatchObject({ disabledReason: "Select a single commit" });
  });
});

describe("stale pull notice", () => {
  it("drops the pull's stash notice when the user switches branch", async () => {
    const { actions } = setup((call) => (call.cmd === "pull_with_autostash" ? { outcome: "updated", stash: { kind: "restored" } } : { auto_stash: "none" }), dirty());

    await actions.pull("rebase");
    expect(actions.notices()).toHaveLength(1);
    actions.checkout({ kind: "local_branch", name: "feature" });
    await later();

    expect(actions.notices()).toEqual([]);
  });
});

describe("history editing entries", () => {
  const details = (parents: string[]) => ({ sha: "bbbbbbbb", summary: "Second", body: "", author: {}, committer: {}, parents, refs: [], files: [] });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  it("opens the rebase editor from a commit's menu with the commit's parent as the base", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "commit_details" ? details(["aaaaaaaa"]) : null));

    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("edit_history");
    await tick();

    expect(calls.find((call) => call.cmd === "commit_details")?.args).toEqual({ path: "/r", sha: "bbbbbbbb" });
    expect(actions.history()).toEqual({ kind: "rebase", base: "aaaaaaaa", from: "bbbbbbbb" });
  });

  it("says so, and opens nothing, when the commit has no parent", async () => {
    const { actions, session } = setup((call) => (call.cmd === "commit_details" ? details([]) : null));

    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("edit_history");
    await tick();

    expect(actions.history()).toBeUndefined();
    expect(session.notice()).toBe("bbbbbbb is the root commit, so there is no parent to rebase onto.");
  });

  it("opens the squash dialog for the selected commits and recompose from a commit's parent", async () => {
    const { actions } = setup((call) => (call.cmd === "commit_details" ? details(["aaaaaaaa"]) : null));

    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 }, ["bbbbbbbb", "cccccccc"]);
    actions.menu()?.run("squash");
    expect(actions.history()).toEqual({ kind: "squash", shas: ["bbbbbbbb", "cccccccc"] });

    actions.closeHistory();
    expect(actions.history()).toBeUndefined();
    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 });
    actions.menu()?.run("recompose");
    await tick();
    expect(actions.history()).toEqual({ kind: "recompose", base: "aaaaaaaa" });
  });

  it("opens recompose with no base so the view can default to the upstream", () => {
    const { actions } = setup(() => null);

    actions.openRecompose(undefined);

    expect(actions.history()).toEqual({ kind: "recompose", base: undefined });
  });

  it("passes the squash reason and the root flag of the row to the menu", () => {
    const { actions } = setup(() => null);

    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 }, ["bbbbbbbb", "dddddddd"], { squashReason: "The selected commits are not one contiguous run of the current branch" });
    const squash = actions.menu()?.entries.find((entry) => entry.kind === "item" && entry.id === "squash");
    expect(squash).toMatchObject({ disabledReason: "The selected commits are not one contiguous run of the current branch" });

    actions.openCommitMenu("bbbbbbbb", false, { left: 1, top: 2 }, ["bbbbbbbb"], { root: true });
    const edit = actions.menu()?.entries.find((entry) => entry.kind === "item" && entry.id === "edit_history");
    expect(edit).toMatchObject({ disabledReason: "The root commit has no parent to rebase onto" });
  });
});

describe("checkout of a branch owned by another worktree", () => {
  const owned = () =>
    setup((call) => {
      if (call.cmd === "checkout") throw rejection("branch_in_worktree", "web-model-sort is checked out in worktree /w/my repo");
      return null;
    });

  it("shows the core's message with an Open worktree action that opens that worktree and clears the notice", async () => {
    const { actions, session } = owned();

    actions.checkout({ kind: "local_branch", name: "web-model-sort" });
    await settle();

    const notice = actions.notices()[0];
    expect(notice?.text).toBe("web-model-sort is checked out in worktree /w/my repo");
    expect(notice?.actions.map((action) => action.label)).toEqual(["Open worktree"]);
    expect(session.notice()).toBeUndefined();
    await notice?.actions[0]?.run();
    expect(openedWorktrees).toEqual(["/w/my repo"]);
    expect(actions.notices()).toEqual([]);
  });

  it("drops the notice when the next switch starts", async () => {
    let refuse = true;
    const { actions } = setup((call) => {
      if (call.cmd !== "checkout") return null;
      if (refuse) throw rejection("branch_in_worktree", "web-model-sort is checked out in worktree /w/other");
      return { auto_stash: "none" };
    });
    actions.checkout({ kind: "local_branch", name: "web-model-sort" });
    await settle();
    expect(actions.notices()).toHaveLength(1);

    refuse = false;
    actions.checkout({ kind: "local_branch", name: "feature" });
    await settle();

    expect(actions.notices()).toEqual([]);
  });

  it("reports a refusal that names no worktree as plain text", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "checkout") throw rejection("branch_in_worktree", "unexpected wording");
      return null;
    });

    actions.checkout({ kind: "local_branch", name: "feature" });
    await settle();

    expect(actions.notices()).toEqual([]);
    expect(session.notice()).toBe("unexpected wording");
  });
});

describe("bulk branch and stash actions", () => {
  const stashes = [
    { index: 0, sha: "s0", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: one", time: 0 },
    { index: 1, sha: "s1", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: two", time: 0 },
    { index: 2, sha: "s2", base_sha: null, author_name: "Yui", author_email: "a@example.test", message: "On main: three", time: 0 },
  ];

  const batch = (done: string[], failed: Array<{ name: string; reason: string }> = []) => ({ done, failed });

  it("confirms deleting several branches once, naming them and the commits that would lose their name, then forces only those in one call", async () => {
    const lost = { count: 1, commits: [{ sha: "aaaaaaa1234", summary: "Topic work" }] };
    const { actions, calls } = setup((call) => {
      if (call.cmd === "branch_delete_preview") return call.args.name === "feature" ? lost : noLoss;
      return call.cmd === "delete_branches" ? batch(["feature", "spare"]) : null;
    });

    await actions.deleteBranches(["feature", "spare"]);

    const dialog = actions.dialog();
    expect(dialog?.copy).toMatchObject({ title: "Delete 2 branches?", names: ["feature", "spare"], confirmLabel: "Delete branches", warning: true });
    expect(dialog?.copy.also).toEqual({ heading: "Commits left without a name", names: ["feature: aaaaaaa Topic work"], total: 1 });
    expect(calls.some((call) => call.cmd === "delete_branches")).toBe(false);
    await dialog?.run();
    expect(calls.filter((call) => call.cmd === "delete_branches").map((call) => call.args)).toEqual([{ path: "/r", names: ["feature", "spare"], forced: ["feature"] }]);
    expect(calls.some((call) => call.cmd === "delete_branch")).toBe(false);
    expect(calls.some((call) => call.cmd === "repo_open")).toBe(true);
  });

  it("previews many branches with a bounded number of requests at a time", async () => {
    const names = Array.from({ length: 40 }, (_, index) => `topic-${index}`);
    let running = 0;
    let busiest = 0;
    const { actions, calls } = setup(async (call) => {
      if (call.cmd !== "branch_delete_preview") return null;
      running += 1;
      busiest = Math.max(busiest, running);
      await new Promise((resolve) => setTimeout(resolve, 0));
      running -= 1;
      return noLoss;
    });

    await actions.deleteBranches(names);

    expect(calls.filter((call) => call.cmd === "branch_delete_preview")).toHaveLength(40);
    expect(busiest).toBeGreaterThan(1);
    expect(busiest).toBeLessThanOrEqual(4);
    expect(actions.dialog()?.copy.title).toBe("Delete 40 branches?");
  });

  it("says which branches could not be deleted when only some were", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "branch_delete_preview") return noLoss;
      return call.cmd === "delete_branches" ? batch(["spare"], [{ name: "feature", reason: "feature is checked out in worktree /w/x" }]) : null;
    });

    await actions.deleteBranches(["feature", "spare"]);
    await actions.dialog()?.run();
    await settle();

    expect(session.notice()).toBe("1 of 2 could not be deleted. feature: feature is checked out in worktree /w/x");
  });

  it("shows the refusal when no branch could be deleted", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "branch_delete_preview") return noLoss;
      if (call.cmd === "delete_branches") throw rejection("branch_in_worktree", "feature is checked out in worktree /w/x");
      return null;
    });

    await actions.deleteBranches(["feature"]);
    await actions.dialog()?.run();
    await settle();

    expect(session.notice()).toBe("feature is checked out in worktree /w/x");
  });

  it("deletes several tags after one confirmation that names them, in one call", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "delete_tags" ? batch(["v1.0", "v2.0"]) : null));

    actions.deleteTags(["v1.0", "v2.0"]);
    const dialog = actions.dialog();

    expect(dialog?.copy).toMatchObject({ title: "Delete 2 tags?", names: ["v1.0", "v2.0"], confirmLabel: "Delete tags" });
    expect(calls.some((call) => call.cmd === "delete_tags")).toBe(false);
    await dialog?.run();
    expect(calls.filter((call) => call.cmd === "delete_tags").map((call) => call.args)).toEqual([{ path: "/r", names: ["v1.0", "v2.0"] }]);
    expect(calls.some((call) => call.cmd === "delete_tag")).toBe(false);
  });

  it("says which tags could not be deleted when only some were", async () => {
    const { actions, session } = setup((call) => (call.cmd === "delete_tags" ? batch(["v1.0"], [{ name: "v2.0", reason: "there is no tag v2.0" }]) : null));

    actions.deleteTags(["v1.0", "v2.0"]);
    await actions.dialog()?.run();
    await settle();

    expect(session.notice()).toBe("1 of 2 could not be deleted. v2.0: there is no tag v2.0");
  });

  it("drops several stashes in one call after one confirmation", async () => {
    const { actions, calls } = setup((call) => (call.cmd === "drop_stashes" ? batch(["stash@{2}", "stash@{0}"]) : null));

    actions.dropStashes([stashes[0], stashes[2]] as never);
    const dialog = actions.dialog();

    expect(dialog?.copy).toMatchObject({ title: "Drop 2 stashes?", names: ["stash@{0} On main: one", "stash@{2} On main: three"], confirmLabel: "Drop stashes" });
    expect(calls.some((call) => call.cmd === "drop_stashes")).toBe(false);
    await dialog?.run();
    expect(calls.filter((call) => call.cmd === "drop_stashes").map((call) => call.args)).toEqual([
      {
        path: "/r",
        targets: [
          { index: 0, sha: "s0" },
          { index: 2, sha: "s2" },
        ],
      },
    ]);
    expect(calls.some((call) => call.cmd === "stash_drop")).toBe(false);
  });
});
