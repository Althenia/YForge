import { describe, expect, it } from "vitest";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { RevisionRange } from "../ipc/bindings/RevisionRange";
import {
  clearCrashesCopy,
  clearHistoryCopy,
  clearUsageCopy,
  deleteBranchAndRemoteCopy,
  deleteBranchCopy,
  deleteRemoteBranchCopy,
  deleteRemoteTagCopy,
  deleteTagCopy,
  detachCopy,
  removeRemoteCopy,
  discardFilesCopy,
  discardHunkCopy,
  discardLinesCopy,
  dropStashCopy,
  forcePushCopy,
  pullStashKeptCopy,
  rebaseCopy,
  resetCopy,
  stashAndSwitchCopy,
  uncommittedTracked,
  undoForcePushCopy,
} from "./confirmCopy";

const file = (path: string, area: FileChange["area"]): FileChange => ({ path, original_path: null, area, status: area === "untracked" ? "untracked" : "modified" });

describe("discard confirmation copy", () => {
  it("names the file and the consequence for a tracked change", () => {
    const copy = discardFilesCopy([file("src/util.js", "unstaged")]);
    expect(copy.title).toBe("Discard changes to src/util.js?");
    expect(copy.names).toEqual(["src/util.js"]);
    expect(copy.confirmLabel).toBe("Discard changes");
    expect(copy.consequences).toHaveLength(1);
    expect(copy.consequences[0]).toBe(
      "The file returns to its staged content, or to the last commit where nothing is staged. Undo can restore the unstaged edits from a snapshot taken before discarding, while the file is unchanged since; without a snapshot they are lost.",
    );
  });

  it("says an untracked file is deleted from disk", () => {
    const copy = discardFilesCopy([file("notes/todo.md", "untracked")]);
    expect(copy.title).toBe("Delete notes/todo.md?");
    expect(copy.confirmLabel).toBe("Delete file");
    expect(copy.consequences[0]).toBe(
      "This untracked file is removed from disk. It is in no commit, so Git cannot recover it. Undo can restore it from a snapshot taken before deleting; without a snapshot it is gone.",
    );
  });

  it("states both consequences when tracked and untracked files are mixed", () => {
    const copy = discardFilesCopy([file("a", "unstaged"), file("b", "untracked"), file("c", "untracked")]);
    expect(copy.title).toBe("Discard changes to 3 files?");
    expect(copy.consequences).toHaveLength(2);
    expect(copy.consequences[1]).toContain("2 untracked files are removed from disk");
    expect(copy.consequences[1]).toContain("Undo can restore them from a snapshot taken before deleting");
    expect(copy.confirmLabel).toBe("Discard changes");
  });

  it("describes a hunk discard with its line range", () => {
    const hunk: DiffHunk = { old_start: 3, old_lines: 7, new_start: 3, new_lines: 7, heading: "", lines: [] };
    const copy = discardHunkCopy("src/util.js", hunk);
    expect(copy.title).toBe("Discard this hunk?");
    expect(copy.names).toEqual(["src/util.js · lines 3–9"]);
    expect(copy.confirmLabel).toBe("Discard hunk");
    expect(copy.consequences).toEqual([
      "Its lines return to their content in the index. Undo can restore the edit from a snapshot taken before discarding, while the file is unchanged since; without a snapshot it is lost.",
    ]);
  });
});

describe("line discard confirmation copy", () => {
  const hunk: DiffHunk = { old_start: 3, old_lines: 7, new_start: 3, new_lines: 7, heading: "", lines: [] };

  it("counts the selected lines and names the hunk range", () => {
    const copy = discardLinesCopy("src/util.js", hunk, 2);
    expect(copy.title).toBe("Discard 2 selected lines?");
    expect(copy.names).toEqual(["src/util.js · lines 3–9"]);
    expect(copy.confirmLabel).toBe("Discard lines");
    expect(copy.consequences[0]).toContain("Undo can restore");
  });

  it("uses the singular for one line", () => {
    expect(discardLinesCopy("a.txt", hunk, 1).title).toBe("Discard 1 selected line?");
  });
});

describe("branch and stash confirmations", () => {
  it("states the consequence of a detached checkout and mentions stashing only when dirty", () => {
    const clean = detachCopy("v1.0", false);
    const dirty = detachCopy("abc1234", true);

    expect(clean.title).toBe("Check out v1.0 as a detached HEAD?");
    expect(clean.consequences.join(" ")).toMatch(/belong to no branch/);
    expect(clean.consequences.join(" ")).not.toMatch(/stash/);
    expect(dirty.consequences.join(" ")).toMatch(/stash them/);
    expect(clean.neutral).toBe(true);
  });

  it("explains that stash and switch keeps the changes in the stash list and offers them back on return", () => {
    const copy = stashAndSwitchCopy("feature/x", "main");

    expect(copy.title).toBe("Stash your changes and switch to feature/x?");
    expect(copy.confirmLabel).toBe("Stash and switch");
    expect(copy.consequences.join(" ")).toMatch(/stashed first, kept in the stash list, and offered back when you return to main/);
    expect(stashAndSwitchCopy("feature/x", undefined).consequences.join(" ")).toMatch(/kept in the stash list/);
  });

  it("names the remote and the undo limit when deleting a remote branch", () => {
    const copy = deleteRemoteBranchCopy("origin", "feature/x");

    expect(copy.title).toBe("Delete origin/feature/x from origin?");
    expect(copy.confirmLabel).toBe("Delete from origin");
    expect(copy.consequences[0]).toMatch(/removed from origin for everyone who fetches from it/);
    expect(copy.consequences.join(" ")).toMatch(/Undo/);
  });

  it("lists the commits only the local branch holds when deleting a branch with its remote branch", () => {
    const copy = deleteBranchAndRemoteCopy("topic", "origin", [{ sha: "0123456789abcdef", summary: "Topic work" }]);

    expect(copy.title).toBe("Delete topic and origin/topic?");
    expect(copy.confirmLabel).toBe("Delete both");
    expect(copy.namesHeading).toBe("This commit is only on the local branch");
    expect(copy.names).toEqual(["0123456 Topic work"]);
    expect(copy.consequences.join(" ")).toMatch(/local branch is deleted first/);
    expect(deleteBranchAndRemoteCopy("topic", "origin", []).names).toEqual([]);
  });

  it("explains why a pull left the changes in the stash", () => {
    const copy = pullStashKeptCopy("pull_conflicts");
    expect(copy).toBe("The pull stopped on conflicts, so your changes were not restored.");
    expect(pullStashKeptCopy("restore_conflicts")).toBe("Restoring them conflicted with the pulled changes.");
    expect(pullStashKeptCopy("restore_failed")).toBe("Git could not restore them.");
  });

  it("names every commit a branch deletion would leave without a name", () => {
    const one = deleteBranchCopy("topic", [{ sha: "0123456789abcdef", summary: "Topic work" }]);
    const two = deleteBranchCopy("topic", [
      { sha: "aaaaaaaa1", summary: "Two" },
      { sha: "bbbbbbbb2", summary: "One" },
    ]);

    expect(one.names).toEqual(["0123456 Topic work"]);
    expect(one.consequences[0]).toMatch(/^This commit is on no other branch/);
    expect(two.names).toEqual(["aaaaaaa Two", "bbbbbbb One"]);
    expect(two.consequences[0]).toMatch(/^These 2 commits are on no other branch/);
    expect(two.confirmLabel).toBe("Delete branch");
    expect(two.neutral).toBeUndefined();
  });

  it("confirms a stash drop by naming the stash and its message", () => {
    const copy = dropStashCopy({ index: 1, message: "On main: wip" });

    expect(copy.title).toBe("Drop stash@{1}?");
    expect(copy.names).toEqual(["On main: wip"]);
    expect(copy.confirmLabel).toBe("Drop stash");
  });
});

describe("force push with lease copy", () => {
  const lease = { remote: "origin", branch: "feature/greeting", remote_ref: "refs/heads/feature/greeting", expected_sha: "f86d53a9999" };

  it("lists the remote commits that will be replaced and states the lease", () => {
    const copy = forcePushCopy({
      lease,
      upstream: "origin/feature/greeting",
      replaced: [
        { sha: "f86d53a9999", summary: "Personalize greeting" },
        { sha: "e2b1c09aaaa", summary: "Tweak greeting" },
      ],
    });

    expect(copy.title).toBe("Force push with lease");
    expect(copy.confirmLabel).toBe("Force push with lease");
    expect(copy.namesHeading).toBe("These remote commits will be replaced");
    expect(copy.names).toEqual(["f86d53a Personalize greeting", "e2b1c09 Tweak greeting"]);
    expect(copy.lead).toBe("Your local feature/greeting has diverged from origin/feature/greeting; its history no longer contains these remote commits.");
    expect(copy.consequences[0]).toMatch(/^Lease: origin\/feature\/greeting must still be at f86d53a\./);
    expect(copy.warning).toBe(true);
  });

  it("uses the singular for one replaced commit", () => {
    const copy = forcePushCopy({ lease, upstream: "origin/x", replaced: [{ sha: "f86d53a9999", summary: "Only" }] });

    expect(copy.namesHeading).toBe("This remote commit will be replaced");
    expect(copy.lead).toMatch(/this remote commit\.$/);
  });
});

const range = (...summaries: string[]): RevisionRange => ({ count: summaries.length, commits: summaries.map((summary, index) => ({ sha: `${index}abcdef0123`, summary })) });

describe("rebase confirmation", () => {
  it("names the branches and lists the commits that are replayed", () => {
    const copy = rebaseCopy("feature", "origin/main", range("One", "Two"));

    expect(copy.title).toBe("Rebase feature onto origin/main?");
    expect(copy.lead).toBe("2 commits on feature are replayed on top of origin/main.");
    expect(copy.names).toEqual(["0abcdef One", "1abcdef Two"]);
    expect(copy.neutral).toBe(true);
    expect(copy.consequences.join(" ")).toMatch(/reflog/);
  });

  it("says the branch only moves forward when it has no commits of its own", () => {
    const copy = rebaseCopy("feature", "main", range());

    expect(copy.lead).toBe("feature has no commits of its own, so it simply moves forward to main.");
    expect(copy.names).toEqual([]);
  });
});

describe("reset confirmation", () => {
  const files = [file("a.txt", "unstaged"), file("b.txt", "staged"), file("b.txt", "unstaged"), file("scratch.txt", "untracked")];

  it("lists only tracked uncommitted paths once each", () => {
    expect(uncommittedTracked(files)).toEqual(["a.txt", "b.txt"]);
  });

  it("states what each non-destructive mode keeps and keeps the primary action neutral", () => {
    const soft = resetCopy("soft", "main", "abc1234", range("One"), files);
    const mixed = resetCopy("mixed", "main", "abc1234", range("One"), files);

    expect(soft.title).toBe("Soft reset main to abc1234?");
    expect(soft.consequences[0]).toMatch(/stay staged/);
    expect(mixed.consequences[0]).toMatch(/unstaged/);
    for (const copy of [soft, mixed]) {
      expect(copy.neutral).toBe(true);
      expect(copy.also).toBeUndefined();
      expect(copy.names).toEqual(["0abcdef One"]);
    }
  });

  it("makes a hard reset a danger confirmation that names the uncommitted changes that would be discarded", () => {
    const copy = resetCopy("hard", "main", "abc1234", range("One", "Two"), files);

    expect(copy.title).toBe("Hard reset main to abc1234?");
    expect(copy.neutral).toBe(false);
    expect(copy.warning).toBe(true);
    expect(copy.confirmLabel).toBe("Hard reset");
    expect(copy.also).toEqual({ heading: "2 uncommitted changes will be lost", names: ["a.txt", "b.txt"] });
    expect(copy.namesHeading).toBe("2 commits leave main");
    expect(copy.consequences.join(" ")).toMatch(/Untracked files are kept/);
  });

  it("says a clean hard reset loses no uncommitted changes and that nothing leaves when the target is ahead", () => {
    const copy = resetCopy("hard", "main", "abc1234", range(), [file("x", "untracked")]);

    expect(copy.also).toBeUndefined();
    expect(copy.consequences).toContain("There are no uncommitted changes to lose.");
    expect(copy.consequences.join(" ")).toMatch(/No commits leave main/);
    expect(copy.namesHeading).toBeUndefined();
  });
});

describe("tag delete confirmations", () => {
  it("separates the local delete from the remote delete and names the remote", () => {
    expect(deleteTagCopy("v1").consequences[0]).toMatch(/remote stays there/);
    const remote = deleteRemoteTagCopy("v1", "origin");
    expect(remote.title).toBe("Delete v1 from origin?");
    expect(remote.confirmLabel).toBe("Delete from origin");
    expect(remote.consequences[0]).toMatch(/Your local tag stays/);
    expect(remote.neutral).toBeUndefined();
  });
});

describe("remove remote copy", () => {
  it("names the remote and its address and states what is and is not deleted", () => {
    const copy = removeRemoteCopy("origin", "https://example.test/a.git");
    expect(copy.title).toBe("Remove remote origin");
    expect(copy.names).toEqual(["origin → https://example.test/a.git"]);
    expect(copy.consequences.join(" ")).toContain("Nothing changes on the remote itself");
    expect(copy.confirmLabel).toBe("Remove remote");
    expect(copy.neutral).toBeUndefined();
  });
});

describe("undo force push confirmation copy", () => {
  it("states the plan from the undo scope and what the remote and local branch end up as", () => {
    const scope = "Undo force push: force-pushes origin/main back to f86d53a with a lease on e2b1c09, so it is refused if the remote moved since";

    const copy = undoForcePushCopy(scope);

    expect(copy.title).toBe("Undo the force push?");
    expect(copy.warning).toBe(true);
    expect(copy.lead).toBe(scope);
    expect(copy.confirmLabel).toBe("Force push back");
    expect(copy.consequences.join(" ")).toMatch(/removed from it for everyone who fetches/);
    expect(copy.consequences.join(" ")).toMatch(/local branch is not changed/);
    expect(copy.consequences.join(" ")).toMatch(/moved since your force push, git refuses the push and nothing changes/);
  });
});

describe("diagnostics confirmation copy", () => {
  it("states what each clear deletes and that it cannot be undone from the diagnostics lists", () => {
    expect(clearUsageCopy()).toMatchObject({ title: "Delete all usage data?", confirmLabel: "Delete usage data" });
    expect(clearUsageCopy().consequences.join(" ")).toContain("cannot be undone");
    expect(clearCrashesCopy()).toMatchObject({ title: "Clear crash reports?", confirmLabel: "Clear crash reports" });
    expect(clearCrashesCopy().consequences.join(" ")).toContain("Export them first");
  });

  it("names the repository and warns that Undo stops reaching this session's operations", () => {
    const copy = clearHistoryCopy("sample");

    expect(copy.title).toBe("Clear activity history for sample?");
    expect(copy.consequences.join(" ")).toContain("Undo no longer reaches them");
    expect(copy.confirmLabel).toBe("Clear history");
  });
});
