import { describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { SnapshotInfo } from "../ipc/bindings/SnapshotInfo";
import {
  headMoved,
  nextReflogCursor,
  REFLOG_PAGE,
  RECOVERY_LIMITS,
  referenceLabel,
  restoreAllCopy,
  restoreCheckoutCopy,
  restoreResetCopy,
  snapshotActionLabel,
  suggestBranchName,
} from "./recoveryModel";

const info = (overrides: Partial<SnapshotInfo> = {}): SnapshotInfo => ({ ref: "refs/yforge/snapshots/1-discard", time: 1, action: "discard", description: "", head_sha: "a".repeat(40), branch: "main", files_changed: 2, ...overrides });
const at = (head: RepoSnapshot["head"]) => ({ head }) as RepoSnapshot;

describe("recovery limits", () => {
  it("states what cannot be recovered and where snapshot refs show up, from MVP item 23", () => {
    expect(RECOVERY_LIMITS).toEqual([
      "Work changed outside YForge and never committed cannot be recovered.",
      "Objects Git has already pruned cannot be recovered.",
      "Snapshots are kept for 30 days. Their refs appear in git log --all in other tools and are pushed only by git push --mirror.",
    ]);
  });
});

describe("reflog browsing", () => {
  it("names a reference by its branch or HEAD", () => {
    expect(referenceLabel("HEAD")).toBe("HEAD");
    expect(referenceLabel("refs/heads/feature/x")).toBe("feature/x");
  });

  it("continues after the last entry shown while pages come back full, and stops at a short page", () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_, offset) => ({ index: from + offset }));

    expect(nextReflogCursor(page(0, REFLOG_PAGE) as never)).toBe(REFLOG_PAGE - 1);
    expect(nextReflogCursor(page(REFLOG_PAGE, REFLOG_PAGE) as never)).toBe(2 * REFLOG_PAGE - 1);
    expect(nextReflogCursor(page(0, REFLOG_PAGE - 1) as never)).toBeUndefined();
    expect(nextReflogCursor([])).toBeUndefined();
  });
});

describe("restoring a commit", () => {
  it("suggests a free branch name from the short id", () => {
    expect(suggestBranchName("abcdef1234567", ["main"])).toBe("restored-abcdef1");
    expect(suggestBranchName("abcdef1234567", ["restored-abcdef1"])).toBe("restored-abcdef1-2");
    expect(suggestBranchName("abcdef1234567", ["restored-abcdef1", "restored-abcdef1-2"])).toBe("restored-abcdef1-3");
  });

  it("warns before a hard reset, naming the discarded changes and the snapshot and undo, and keeps soft and mixed plain", () => {
    const hard = restoreResetCopy("hard", "main", "abcdef1234567");
    expect(hard).toMatchObject({ title: "Hard reset main to abcdef1?", confirmLabel: "Hard reset", warning: true });
    expect(hard.consequences.join(" ")).toContain("Uncommitted changes to tracked files are discarded");
    expect(hard.consequences.join(" ")).toContain("safety snapshot");
    expect(hard.consequences.join(" ")).toContain("Undo");

    expect(restoreResetCopy("soft", "main", "abcdef1234567").consequences.join(" ")).toContain("keeps your changes staged");
    expect(restoreResetCopy("mixed", "main", "abcdef1234567").consequences.join(" ")).toContain("keeps your changes in the working tree");
    expect(restoreResetCopy("mixed", "main", "abcdef1234567").warning).toBeUndefined();
  });

  it("explains a detached checkout and that the working tree must be clean", () => {
    const copy = restoreCheckoutCopy("abcdef1234567");
    expect(copy).toMatchObject({ title: "Check out abcdef1 as a detached HEAD?", confirmLabel: "Check out detached", neutral: true });
    expect(copy.consequences.join(" ")).toContain("working tree must be clean");
  });
});

describe("snapshots", () => {
  it("labels each recorded action in words", () => {
    expect(snapshotActionLabel("discard")).toBe("Discard");
    expect(snapshotActionLabel("reset_hard")).toBe("Hard reset");
    expect(snapshotActionLabel("drop_stash")).toBe("Drop stash");
    expect(snapshotActionLabel("remove_worktree")).toBe("Remove worktree");
    expect(snapshotActionLabel("something_new")).toBe("Something new");
  });

  it("finds that HEAD or the branch moved since a snapshot", () => {
    const sha = "a".repeat(40);
    expect(headMoved(info(), at({ kind: "branch", name: "main", sha }))).toBe(false);
    expect(headMoved(info(), at({ kind: "branch", name: "main", sha: "b".repeat(40) }))).toBe(true);
    expect(headMoved(info(), at({ kind: "branch", name: "other", sha }))).toBe(true);
    expect(headMoved(info(), at({ kind: "detached", sha }))).toBe(true);
    expect(headMoved(info({ head_sha: null, branch: null }), at({ kind: "unborn", branch: "main" }))).toBe(false);
    expect(headMoved(info({ head_sha: sha, branch: null }), at({ kind: "detached", sha }))).toBe(false);
  });

  it("makes the forced restore say where HEAD was and that it never moves HEAD", () => {
    const copy = restoreAllCopy(info(), true, at({ kind: "branch", name: "main", sha: "b".repeat(40) }));
    expect(copy.title).toBe("Restore everything from this snapshot?");
    expect(copy.consequences.join(" ")).toContain("HEAD moved from aaaaaaa to bbbbbbb");
    expect(copy.consequences.join(" ")).toContain("never moves HEAD");
    expect(copy.consequences.join(" ")).toContain("saved as a new snapshot");
    expect(copy.confirmLabel).toBe("Restore everything");
    expect(restoreAllCopy(info(), false, at({ kind: "branch", name: "main", sha: "a".repeat(40) })).consequences.join(" ")).not.toContain("HEAD moved");
  });
});
