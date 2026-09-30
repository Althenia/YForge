import { describe, expect, it } from "vitest";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import {
  MERGE_COMMIT_REASON,
  NOT_AVAILABLE,
  NO_REMOTE,
  SINGLE_COMMIT_REASON,
  commitMenu,
  dropPlan,
  operationBlock,
  pushRemote,
  refMenu,
  resetModeMenu,
  shortRefName,
  startLabel,
  startPointText,
  stashMenu,
  type MenuContext,
  type MenuEntry,
  type MenuPart,
  type RefTarget,
} from "./refMenu";

const text = (label: MenuPart[]) => label.map((part) => (typeof part === "string" ? part : part.ref)).join("");
const layout = (entries: MenuEntry[]) => entries.map((entry) => (entry.kind === "separator" ? "-" : text(entry.label)));
const item = (entries: MenuEntry[], id: string) => {
  const found = entries.find((entry) => entry.kind === "item" && entry.id === id);
  if (found === undefined || found.kind !== "item") throw new Error(`no ${id}`);
  return found;
};

const context = (current: string | undefined, remotes: readonly string[] = [], operation: MenuContext["operation"] = null): MenuContext => ({ current, remotes, operation });

const local: RefTarget = { kind: "local_branch", name: "feature/greeting", remoteName: "origin/feature/greeting", startPoint: "abc1234" };

describe("menu icons", () => {
  it("assign an established glyph to create, integrate, delete, and push items and leave the others empty", () => {
    const entries = refMenu(local, context("main", ["origin"]));

    expect(item(entries, "create_branch").icon).toBe("branch");
    expect(item(entries, "create_tag").icon).toBe("tag");
    expect(item(entries, "merge").icon).toBe("merge");
    expect(item(entries, "delete").icon).toBe("trash");
    expect(item(entries, "rebase").icon).toBeUndefined();
    expect(item(resetModeMenu(), "soft").icon).toBeUndefined();
  });
});

describe("branch context menu", () => {
  it("follows the order and grouping of specimen 05 for a local branch with a remote", () => {
    expect(layout(refMenu(local, context("main", ["origin"])))).toEqual([
      "Checkout feature/greeting",
      "Merge feature/greeting into main",
      "Rebase main onto feature/greeting",
      "Fast-forward main to feature/greeting",
      "-",
      "Create branch here…",
      "Create worktree from feature/greeting…",
      "Create tag here…",
      "-",
      "Reset main to feature/greeting",
      "Edit commit message",
      "-",
      "Set upstream of feature/greeting…",
      "-",
      "Rename feature/greeting…",
      "Delete feature/greeting…",
      "Delete origin/feature/greeting…",
      "Delete feature/greeting and origin/feature/greeting…",
      "-",
      "Copy",
      "-",
      "Hide in graph",
    ]);
  });

  it("enables the integration, create, reset, rename, and delete actions and disables only the out-of-scope ones with the reason", () => {
    const entries = refMenu(local, context("main"));

    for (const id of ["checkout", "merge", "rebase", "fast_forward", "create_branch", "create_tag", "reset", "rename", "delete"]) {
      expect(item(entries, id).disabledReason).toBeUndefined();
    }
    for (const id of ["create_worktree", "edit_message", "copy", "hide"]) {
      expect(item(entries, id).disabledReason).toBe(NOT_AVAILABLE);
    }
    expect(item(entries, "delete").danger).toBe(true);
    expect(item(entries, "delete_remote").danger).toBe(true);
    expect(item(entries, "delete_remote").disabledReason).toBeUndefined();
    expect(item(entries, "delete_both").danger).toBe(true);
  });

  it("disables the integration items on the checked-out branch and while an operation is in progress", () => {
    const own = refMenu({ ...local, name: "main", remoteName: undefined }, context("main"));
    for (const id of ["merge", "rebase", "fast_forward"]) expect(item(own, id).disabledReason).toBe("Already the checked-out branch");
    expect(item(own, "reset").disabledReason).toBeUndefined();

    const busy = refMenu(local, context("main", [], "rebase"));
    for (const id of ["merge", "rebase", "fast_forward", "reset"]) expect(item(busy, id).disabledReason).toBe("Finish or abort the rebase first");
  });

  it("cannot fast-forward a detached HEAD", () => {
    expect(item(refMenu(local, context(undefined)), "fast_forward").disabledReason).toBe("HEAD is detached");
  });

  it("disables checkout and delete for the checked-out branch with their reasons", () => {
    const entries = refMenu({ ...local, name: "main", remoteName: undefined }, context("main"));

    expect(item(entries, "checkout").disabledReason).toBe("Already checked out");
    expect(item(entries, "delete").disabledReason).toMatch(/Checked out/);
    expect(entries.some((entry) => entry.kind === "item" && entry.id === "delete_remote")).toBe(false);
    expect(entries.some((entry) => entry.kind === "item" && entry.id === "delete_both")).toBe(false);
  });

  it("names HEAD as the merge target when nothing is checked out", () => {
    expect(text(item(refMenu(local, context(undefined)), "merge").label)).toBe("Merge feature/greeting into HEAD");
  });

  it("checks a remote-only branch out by its short name as a tracking branch and omits local-only actions", () => {
    const remote: RefTarget = { kind: "remote_branch", name: "origin/feature/x", startPoint: "abc1234" };
    const entries = refMenu(remote, context("main", ["origin"]));

    expect(text(item(entries, "checkout").label)).toBe("Checkout feature/x");
    expect(item(entries, "checkout").note).toBe("creates a tracking branch");
    expect(entries.some((entry) => entry.kind === "item" && (entry.id === "rename" || entry.id === "delete"))).toBe(false);
    expect(text(item(entries, "delete_remote").label)).toBe("Delete origin/feature/x…");
    expect(item(entries, "delete_remote").danger).toBe(true);
    expect(item(entries, "delete_remote").disabledReason).toBeUndefined();
    expect(entries.some((entry) => entry.kind === "item" && (entry.id === "set_upstream" || entry.id === "delete_both"))).toBe(false);
  });

  it("offers set upstream on any local branch and unset upstream and Push to… only on the checked-out branch that tracks one", () => {
    const other = refMenu(local, { ...context("main", ["origin"]), upstream: "origin/main" });
    expect(item(other, "set_upstream").disabledReason).toBeUndefined();
    expect(other.some((entry) => entry.kind === "item" && (entry.id === "unset_upstream" || entry.id === "push_to"))).toBe(false);

    const own = refMenu({ ...local, name: "main", remoteName: undefined }, { ...context("main", ["origin"]), upstream: "origin/main" });
    expect(text(item(own, "unset_upstream").label)).toBe("Unset upstream of main");
    expect(text(item(own, "push_to").label)).toBe("Push main to…");
    const untracked = refMenu({ ...local, name: "main", remoteName: undefined }, { ...context("main", ["origin"]), upstream: null });
    expect(untracked.some((entry) => entry.kind === "item" && entry.id === "unset_upstream")).toBe(false);
    expect(item(untracked, "push_to").disabledReason).toBeUndefined();
  });

  it("disables set upstream and Push to… without a remote", () => {
    const entries = refMenu({ ...local, name: "main", remoteName: undefined }, context("main"));
    expect(item(entries, "set_upstream").disabledReason).toBe(NO_REMOTE);
    expect(item(entries, "push_to").disabledReason).toBe(NO_REMOTE);
  });

  it("disables deleting both on the checked-out branch", () => {
    const entries = refMenu({ ...local, name: "main", remoteName: "origin/main" }, context("main", ["origin"]));
    expect(item(entries, "delete_both").disabledReason).toMatch(/Checked out/);
    expect(item(entries, "delete_remote").disabledReason).toBeUndefined();
  });

  it("offers a tag a detached checkout and no merge or reset actions", () => {
    const entries = refMenu({ kind: "tag", name: "v1.0", startPoint: "abc1234" }, context("main", ["origin"]));

    expect(item(entries, "checkout").note).toBe("detached");
    expect(entries.some((entry) => entry.kind === "item" && ["merge", "rebase", "reset"].includes(entry.id))).toBe(false);
    expect(item(entries, "create_branch").disabledReason).toBeUndefined();
  });

  it("gives a tag only tag verbs: create here, push, and local and remote delete", () => {
    const entries = refMenu({ kind: "tag", name: "v1.0", startPoint: "abc1234" }, context("main", ["upstream", "origin"]));

    expect(layout(entries)).toEqual([
      "Checkout v1.0",
      "-",
      "Create branch here…",
      "Create worktree from v1.0…",
      "Create tag here…",
      "-",
      "Push v1.0 to origin",
      "-",
      "Delete v1.0…",
      "Delete v1.0 from origin…",
      "-",
      "Copy",
      "-",
      "Hide in graph",
    ]);
    for (const id of ["create_tag", "push_tag", "delete_tag", "delete_remote_tag"]) expect(item(entries, id).disabledReason).toBeUndefined();
    expect(item(entries, "delete_tag").danger).toBe(true);
    expect(item(entries, "delete_remote_tag").danger).toBe(true);
  });

  it("disables the tag remote verbs when the repository has no remote", () => {
    const entries = refMenu({ kind: "tag", name: "v1.0", startPoint: "abc1234" }, context("main"));

    expect(item(entries, "push_tag").disabledReason).toBe(NO_REMOTE);
    expect(item(entries, "delete_remote_tag").disabledReason).toBe(NO_REMOTE);
  });

  it("pushes to origin when it exists and to the first remote otherwise", () => {
    expect(pushRemote(["upstream", "origin"])).toBe("origin");
    expect(pushRemote(["upstream"])).toBe("upstream");
    expect(pushRemote([])).toBeUndefined();
  });

  it("labels a start point by its short ref name or its short commit id", () => {
    expect(startLabel("refs/heads/feature/x")).toBe("feature/x");
    expect(startLabel("refs/remotes/origin/main")).toBe("origin/main");
    expect(startLabel("refs/tags/v1")).toBe("v1");
    expect(startLabel("0123456789abcdef")).toBe("0123456");
  });

  it("strips the longest matching remote prefix from a remote branch", () => {
    const target: RefTarget = { kind: "remote_branch", name: "origin/fork/main", startPoint: "refs/remotes/origin/fork/main" };
    expect(shortRefName(target, ["origin", "origin/fork"])).toBe("main");
    expect(shortRefName(local, ["origin"])).toBe("feature/greeting");
  });
});

describe("stash menu", () => {
  it("lists inspect, apply, pop, rename, and a danger drop that asks for confirmation", () => {
    const entries = stashMenu({ index: 2 });

    expect(layout(entries)).toEqual(["Inspect stash@{2}", "Apply stash@{2}", "Pop stash@{2}", "Rename stash@{2}…", "-", "Drop stash@{2}…"]);
    expect(item(entries, "drop").danger).toBe(true);
  });
});

describe("start point text", () => {
  it("says HEAD when nothing is selected and names the selected commit with its summary", () => {
    expect(startPointText(null)).toBe("from HEAD");
    expect(startPointText("45d26bb0123456789", "Export shout helper")).toBe("from 45d26bb Export shout helper");
    expect(startPointText("45d26bb0123456789")).toBe("from 45d26bb");
    expect(startPointText("refs/heads/feature/x", "Work")).toBe("from feature/x Work");
  });
});

describe("commit row context menu", () => {
  const menu = (overrides: Partial<Parameters<typeof commitMenu>[0]> = {}) => commitMenu({ ...context("main"), sha: "abcdef0123456", merge: false, ...overrides });

  it("groups integrate, create, and rewrite actions and names the branch and commit", () => {
    const entries = menu();

    expect(layout(entries)).toEqual([
      "Cherry-pick abcdef0 onto main",
      "Revert abcdef0",
      "-",
      "Create branch here…",
      "Create tag here…",
      "-",
      "Reset main to abcdef0",
      "-",
      "Edit history from abcdef0…",
      "Recompose from abcdef0…",
    ]);
    for (const id of ["cherry_pick", "revert", "create_branch", "create_tag", "reset", "edit_history", "recompose"]) expect(item(entries, id).disabledReason).toBeUndefined();
  });

  it("gives the history verbs their glyphs", () => {
    const entries = menu();
    expect(item(entries, "edit_history").icon).toBe("rebase");
    expect(item(entries, "recompose").icon).toBe("recompose");
  });

  it("disables the history verbs for a merge commit, the root commit, and during an operation, each with its reason", () => {
    expect(item(menu({ merge: true }), "edit_history").disabledReason).toBe("A merge commit cannot be rewritten");
    expect(item(menu({ merge: true }), "recompose").disabledReason).toBe("A merge commit cannot be rewritten");
    expect(item(menu({ root: true }), "edit_history").disabledReason).toBe("The root commit has no parent to rebase onto");
    expect(item(menu({ root: true }), "recompose").disabledReason).toBe("The root commit has no parent to recompose from");
    const busy = menu({ operation: "rebase" });
    expect(item(busy, "edit_history").disabledReason).toBe("Finish or abort the rebase first");
    expect(item(busy, "recompose").disabledReason).toBe("Finish or abort the rebase first");
  });

  it("disables pick and revert for a merge commit and everything integrating during an operation", () => {
    const merge = menu({ merge: true });
    expect(item(merge, "cherry_pick").disabledReason).toBe(MERGE_COMMIT_REASON);
    expect(item(merge, "revert").disabledReason).toBe(MERGE_COMMIT_REASON);
    expect(item(merge, "reset").disabledReason).toBeUndefined();

    const busy = menu({ operation: "merge" });
    for (const id of ["cherry_pick", "revert", "reset"]) expect(item(busy, id).disabledReason).toBe("Finish or abort the merge first");
    expect(item(busy, "create_tag").disabledReason).toBeUndefined();
  });
});

describe("commit menu with a multi-selection", () => {
  const selected = { ...context("main"), sha: "abcdef0123456", merge: false, selection: ["abcdef0123456", "1234567abcdef"] };

  it("disables the verbs that act on one commit and says to select a single commit", () => {
    const entries = commitMenu(selected);
    for (const id of ["cherry_pick", "revert", "create_branch", "create_tag", "reset", "edit_history", "recompose"]) {
      expect(item(entries, id).disabledReason).toBe(SINGLE_COMMIT_REASON);
    }
  });

  it("offers Squash N commits… and enables it for a contiguous selection", () => {
    const entries = commitMenu(selected);
    expect(text(item(entries, "squash").label)).toBe("Squash 2 commits…");
    expect(item(entries, "squash").icon).toBe("squash");
    expect(item(entries, "squash").disabledReason).toBeUndefined();
  });

  it("disables Squash with the reason for a non-contiguous selection or a running operation", () => {
    const reason = "The selected commits are not one contiguous run of the current branch";
    expect(item(commitMenu({ ...selected, squashReason: reason }), "squash").disabledReason).toBe(reason);
    expect(item(commitMenu({ ...selected, operation: "merge" }), "squash").disabledReason).toBe("Finish or abort the merge first");
  });

  it("does not offer Squash for a single commit", () => {
    expect(commitMenu({ ...context("main"), sha: "abcdef0123456", merge: false }).some((entry) => entry.kind === "item" && entry.id === "squash")).toBe(false);
  });

  it("keeps the verbs enabled for a selection of one", () => {
    const entries = commitMenu({ ...selected, selection: ["abcdef0123456"] });
    expect(item(entries, "cherry_pick").disabledReason).toBeUndefined();
  });
});

describe("menu shortcut hints", () => {
  it("shows the branch shortcut on Create branch here in the commit menu", () => {
    expect(item(commitMenu({ ...context("main"), sha: "abcdef0123456", merge: false }), "create_branch").shortcut).toBe("⌘B");
  });
});

describe("reset mode menu", () => {
  it("lists soft, mixed, and a danger hard with what each keeps", () => {
    const entries = resetModeMenu();

    expect(layout(entries)).toEqual(["Soft", "Mixed", "-", "Hard"]);
    expect(item(entries, "soft").note).toBe("keep changes staged");
    expect(item(entries, "mixed").note).toBe("keep changes unstaged");
    expect(item(entries, "hard").danger).toBe(true);
    expect(item(entries, "soft").danger).toBeUndefined();
  });
});

describe("drop menu", () => {
  const preview = (incoming: number, outgoing: number): IntegrationPreview => ({
    incoming: { count: incoming, commits: [] },
    outgoing: { count: outgoing, commits: [] },
    fast_forward: incoming > 0 && outgoing === 0,
  });
  const branch = (name: string): RefTarget => ({ kind: "local_branch", name, remoteName: undefined, startPoint: "abc1234" });
  const remote = (name: string): RefTarget => ({ kind: "remote_branch", name, startPoint: "abc1234" });

  it("previews the fast-forward and offers merge and rebase when dropping a branch on the checked-out branch", () => {
    const plan = dropPlan(branch("feature/greeting"), branch("main"), context("main"), preview(3, 0));

    expect(plan && text(plan.title)).toBe("Drop feature/greeting on main");
    expect(plan && layout(plan.entries)).toEqual(["Fast-forward main by 3 commits", "Merge feature/greeting into main", "Rebase main onto feature/greeting"]);
    expect(plan && plan.entries.every((entry) => entry.kind === "separator" || entry.disabledReason === undefined)).toBe(true);
    expect([plan?.into, plan?.other]).toEqual(["main", "feature/greeting"]);
  });

  it("acts on the checked-out branch when it is the dragged one", () => {
    const plan = dropPlan(branch("main"), remote("origin/main"), context("main"), preview(1, 2));

    expect([plan?.into, plan?.other]).toEqual(["main", "origin/main"]);
    const ff = plan?.entries[0];
    expect(ff && ff.kind === "item" && ff.disabledReason).toBe("main has commits that origin/main does not");
  });

  it("offers only a fast-forward when neither branch is checked out", () => {
    const plan = dropPlan(branch("feature/a"), branch("feature/b"), context("main"), preview(2, 0));

    expect(plan && layout(plan.entries)).toEqual(["Fast-forward feature/b by 2 commits"]);
    expect([plan?.into, plan?.other]).toEqual(["feature/b", "feature/a"]);
  });

  it("offers nothing for tags, remote-only targets, or the same branch", () => {
    const tag: RefTarget = { kind: "tag", name: "v1", startPoint: "abc1234" };
    expect(dropPlan(tag, branch("main"), context("main"), preview(1, 0))).toBeUndefined();
    expect(dropPlan(branch("main"), tag, context("main"), preview(1, 0))).toBeUndefined();
    expect(dropPlan(branch("feature/a"), remote("origin/b"), context("main"), preview(1, 0))).toBeUndefined();
    expect(dropPlan(branch("main"), branch("main"), context("main"), preview(0, 0))).toBeUndefined();
  });

  it("disables every option when there is nothing to integrate or an operation is running", () => {
    const upToDate = dropPlan(branch("topic"), branch("main"), context("main"), preview(0, 4));
    expect(upToDate?.entries.map((entry) => entry.kind === "item" && entry.disabledReason)).toEqual(["Already up to date", "Already up to date", "Already up to date"]);

    const busy = dropPlan(branch("topic"), branch("main"), context("main", [], "merge"), preview(2, 0));
    expect(busy?.entries.every((entry) => entry.kind === "item" && entry.disabledReason === "Finish or abort the merge first")).toBe(true);
  });
});

describe("operation block reason", () => {
  it("names the operation in progress and is empty otherwise", () => {
    expect(operationBlock(null)).toBeUndefined();
    expect(operationBlock("cherry_pick")).toBe("Finish or abort the cherry-pick first");
    expect(operationBlock("cherry_pick_sequence")).toBe("Finish or abort the cherry-pick first");
    expect(operationBlock("revert_sequence")).toBe("Finish or abort the revert first");
    expect(operationBlock("bisect")).toBe("Reset the bisect first");
  });
});
