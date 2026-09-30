import { describe, expect, it } from "vitest";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import {
  createBlock,
  defaultIntegrationTarget,
  destinationProblem,
  existingBranchChoices,
  flagsOf,
  integrateBlock,
  integrateCopy,
  integrationNotice,
  integrationTargets,
  laneLabel,
  newBranchProblem,
  removeBlock,
  removeCopy,
  startPointChoices,
} from "./worktreeModel";

const lane = (overrides: Partial<WorktreeStatus>): WorktreeStatus => ({ path: "/w/repo", head: "a".repeat(40), branch: "main", bare: false, locked: false, prunable: false, current: false, dirty: false, ...overrides });

const main = lane({});
const feature = lane({ path: "/w/repo-feature", branch: "feature/x", current: true });
const fix = lane({ path: "/w/repo-fix", branch: "fix", dirty: true });
const detached = lane({ path: "/w/repo-detached", branch: null });
const all = [main, feature, fix, detached];

describe("worktree lanes", () => {
  it("labels a lane with its branch, else bare or detached", () => {
    expect(laneLabel(feature)).toBe("feature/x");
    expect(laneLabel(detached)).toBe("detached");
    expect(laneLabel(lane({ branch: null, bare: true }))).toBe("bare");
  });

  it("names every state of a lane in text, in a fixed order", () => {
    expect(flagsOf(lane({ current: true, dirty: true, locked: true, prunable: true }))).toEqual(["current", "changes", "locked", "missing"]);
    expect(flagsOf(main)).toEqual([]);
  });
});

describe("removing a worktree", () => {
  it("is blocked for the worktree open here, the main worktree, and a locked worktree, each with its reason", () => {
    expect(removeBlock(feature, all)).toBe("This worktree is open here. Switch to another worktree to remove it");
    expect(removeBlock(main, all)).toBe("The main worktree cannot be removed");
    expect(removeBlock(lane({ path: "/w/repo-lock", locked: true }), all)).toBe("/w/repo-lock is locked. Unlock it first");
    expect(removeBlock(fix, all)).toBeUndefined();
  });

  it("asks once, and again with force for a worktree with changes, naming what is lost and the snapshot taken", () => {
    const plain = removeCopy(feature, false);
    expect(plain).toMatchObject({ title: "Remove the worktree at /w/repo-feature?", confirmLabel: "Remove worktree", names: ["/w/repo-feature"] });
    expect(plain.consequences.join(" ")).toContain("The folder is deleted from disk");
    expect(plain.consequences.join(" ")).toContain("feature/x stays");

    const forced = removeCopy(fix, true);
    expect(forced).toMatchObject({ title: "Remove the worktree at /w/repo-fix and discard its changes?", confirmLabel: "Remove and discard changes" });
    expect(forced.consequences.join(" ")).toContain("uncommitted changes and untracked files");
    expect(forced.consequences.join(" ")).toContain("safety snapshot");
  });
});

describe("integrating a worktree", () => {
  it("offers the branches checked out in the other worktrees as targets, preferring main", () => {
    expect(integrationTargets(feature, all).map((target) => target.branch)).toEqual(["main", "fix"]);
    expect(defaultIntegrationTarget(integrationTargets(feature, all))).toBe("main");
    expect(defaultIntegrationTarget(integrationTargets(main, all))).toBe("feature/x");
    expect(defaultIntegrationTarget([])).toBe("");
  });

  it("is blocked without a branch, with changes, while missing or locked, or without another worktree to integrate into", () => {
    expect(integrateBlock(detached, all)).toBe("Check out a branch in this worktree first");
    expect(integrateBlock(fix, all)).toBe("Commit or stash the changes in this worktree first");
    expect(integrateBlock(lane({ path: "/w/gone", branch: "gone", prunable: true }), all)).toBe("This worktree is missing from disk");
    expect(integrateBlock(main, [main])).toBe("No other worktree has a branch checked out to integrate into");
    expect(integrateBlock(feature, all)).toBeUndefined();
  });

  it("states the exact sequence, with and without cleanup", () => {
    const plain = integrateCopy(feature, "main", false);
    expect(plain.title).toBe("Integrate feature/x into main?");
    expect(plain.consequences).toEqual(["Rebases feature/x onto main in /w/repo-feature, then fast-forwards main to it, so the history stays linear.", "The worktree and feature/x are kept."]);
    expect(plain.confirmLabel).toBe("Integrate");

    const cleaned = integrateCopy(feature, "main", true);
    expect(cleaned.consequences[1]).toBe("Then removes the worktree at /w/repo-feature and deletes the branch feature/x.");
  });

  it("reports the outcome and routes a stopped rebase to the worktree that holds it", () => {
    expect(integrationNotice({ kind: "integrated", target_sha: "abcdef1234567890", cleaned_up: false }, "feature/x", "main")).toBe("Integrated feature/x into main at abcdef1.");
    expect(integrationNotice({ kind: "integrated", target_sha: "abcdef1234567890", cleaned_up: true }, "feature/x", "main")).toBe("Integrated feature/x into main at abcdef1 and removed the worktree.");
    expect(integrationNotice({ kind: "conflicts", worktree: "/w/repo-feature" }, "feature/x", "main")).toBe("The rebase of feature/x onto main stopped on conflicts. Resolve them in /w/repo-feature, then continue.");
  });
});

describe("creating a worktree", () => {
  const branches = ["main", "feature/x", "fix", "spare"];

  it("checks a new branch name against the existing names and requires a name", () => {
    expect(newBranchProblem("", branches)).toBe("Enter a branch name");
    expect(newBranchProblem("fix", branches)).toBe("A branch named fix already exists");
    expect(newBranchProblem("fresh", branches)).toBeUndefined();
  });

  it("offers only the local branches no worktree holds, and HEAD then the branches as start points", () => {
    expect(existingBranchChoices(branches, all)).toEqual(["spare"]);
    expect(startPointChoices(branches, ["origin/main"])).toEqual([
      { value: "", label: "Current HEAD" },
      { value: "refs/heads/main", label: "main" },
      { value: "refs/heads/feature/x", label: "feature/x" },
      { value: "refs/heads/fix", label: "fix" },
      { value: "refs/heads/spare", label: "spare" },
      { value: "refs/remotes/origin/main", label: "origin/main" },
    ]);
  });

  it("needs a full path for the folder", () => {
    expect(destinationProblem("")).toBe("Enter the folder for the worktree");
    expect(destinationProblem("relative/dir")).toBe("Use a full path, starting with /");
    expect(destinationProblem("/w/new")).toBeUndefined();
  });

  it("states why creating is not possible yet", () => {
    expect(createBlock("new", "", "/w/x", ["main"])).toBe("Enter a branch name");
    expect(createBlock("new", "fresh", "", ["main"])).toBe("Enter the folder for the worktree");
    expect(createBlock("existing", "", "/w/x", ["main"])).toBe("Choose a branch");
    expect(createBlock("new", "fresh", "/w/x", ["main"])).toBeUndefined();
    expect(createBlock("existing", "spare", "/w/x", ["main"])).toBeUndefined();
  });
});
