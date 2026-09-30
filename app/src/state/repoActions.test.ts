import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import { autoStashMessage, createRepoActions, restoreMessage } from "./repoActions";
import { testSession } from "../components/testkit";

afterEach(() => clearMocks());

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
  const actions = createRepoActions(session, { selectedSha: () => selectedSha, onSelectionGone, pullMode: () => "fast_forward_or_merge", undoEntry: (id) => entries.find((entry) => entry.id === id) });
  return { calls, session, actions, names: () => calls.map((call) => call.cmd) };
}

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
      return { auto_stash: "restored" };
    });

    actions.checkout({ kind: "local_branch", name: "feature" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dialog = actions.dialog();
    expect(dialog?.copy.confirmLabel).toBe("Stash and switch");
    expect(session.notice()).toBeUndefined();
    await dialog?.run();
    const checkouts = calls.filter((call) => call.cmd === "checkout");
    expect(checkouts.map((call) => call.args.stash)).toEqual([false, true]);
    expect(session.notice()).toBe("Switched to feature. Your stashed changes were restored.");
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
    const { actions, calls, names } = setup((call) => (call.cmd === "branch_delete_preview" ? [] : null));

    actions.openRefMenu({ kind: "local_branch", name: "feature", remoteName: undefined, startPoint: "a" }, { left: 0, top: 0 });
    actions.menu()?.run("delete");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(actions.dialog()).toBeUndefined();
    expect(names().slice(0, 2)).toEqual(["branch_delete_preview", "delete_branch"]);
    expect(calls[1]?.args).toMatchObject({ name: "feature", force: false });
  });

  it("confirms deleting an unmerged branch, naming the lost commits, and forces only after confirmation", async () => {
    const lost = [{ sha: "aaaaaaa1234", summary: "Topic work" }];
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

    actions.openSyncMenu({ left: 0, top: 0 });
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
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "f86d53a" }, upstream: "origin/main", replaced: [] };
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

  it("goes straight to the force-with-lease dialog when the branch diverged", async () => {
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "f86d53a" }, upstream: "origin/main", replaced: [{ sha: "f86d53a", summary: "Old" }] };
    const diverged = snapshot({ upstream: { name: "origin/main", ahead_behind: { ahead: 2, behind: 1 } } });
    const { actions, names } = setup((call) => (call.cmd === "push_plan" ? plan : null), diverged);

    await actions.push();

    expect(names()).toEqual(["push_plan"]);
    expect(actions.dialog()?.copy.title).toBe("Force push with lease");
  });

  it("force pushes with the lease from the plan and reports a rejected lease", async () => {
    const plan = { lease: { remote: "origin", branch: "main", remote_ref: "refs/heads/main", expected_sha: "f86d53a" }, upstream: "origin/main", replaced: [] };
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
  const stash: StashEntry = { index: 0, sha: "s0", base_sha: null, author_name: "Yui", message: "On main: wip", time: 1 };

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
    const rebasing = createRepoActions(testSession("/r", snapshot()), { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "rebase", undoEntry: () => undefined });

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

    const ok = await actions.autoFetch();

    expect(ok).toBe(true);
    expect(calls.find((call) => call.cmd === "fetch")?.args).toMatchObject({ interactive: false, prune: false });
  });

  it("stays silent when an auto-fetch fails but reports it as not ok and keeps the auth state", async () => {
    const { actions, session } = setup((call) => {
      if (call.cmd === "fetch") throw rejection("auth_failed", "Authentication failed for origin");
      return null;
    });

    const ok = await actions.autoFetch();

    expect(ok).toBe(false);
    expect(session.notice()).toBeUndefined();
    expect(actions.sync()).toMatchObject({ kind: "failed", message: "auth failed for origin" });
  });

  it("skips the auto-fetch when there are no remotes or an operation is in progress", async () => {
    const none = setup(() => null, snapshot({ remotes: [] }));
    const busy = setup(() => null, snapshot({ operation: "merge" }));

    expect(await none.actions.autoFetch()).toBe(true);
    expect(await busy.actions.autoFetch()).toBe(true);
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
