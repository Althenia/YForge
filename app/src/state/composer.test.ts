import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { amendDraft, amendWarning, commitButton, commitIdentityLabel, commitPushReason, createCommitAction, createComposer, stashButton, stashMessage, summaryRemaining } from "./composer";
import { testSession } from "../components/testkit";
import { IpcError } from "../ipc/client";

afterEach(() => clearMocks());

const ready = { staged: 2, summary: "Tune retries", amend: false, busy: false };

describe("commit button", () => {
  it("names the number of staged files and is enabled with a summary", () => {
    expect(commitButton(ready)).toEqual({ label: "Commit 2 files", disabledReason: undefined });
    expect(commitButton({ ...ready, staged: 1 }).label).toBe("Commit 1 file");
  });

  it("is disabled with a reason when nothing is staged", () => {
    expect(commitButton({ ...ready, staged: 0 })).toEqual({ label: "Commit", disabledReason: "Stage files to commit" });
  });

  it("is disabled with a reason when the summary is blank", () => {
    expect(commitButton({ ...ready, summary: "   " }).disabledReason).toBe("Write a summary to commit");
  });

  it("reports the missing stage before the missing summary", () => {
    expect(commitButton({ ...ready, staged: 0, summary: "" }).disabledReason).toBe("Stage files to commit");
  });

  it("lets an amend proceed with nothing staged but still needs a summary", () => {
    expect(commitButton({ ...ready, staged: 0, amend: true })).toEqual({ label: "Amend commit", disabledReason: undefined });
    expect(commitButton({ ...ready, staged: 0, amend: true, summary: "" }).disabledReason).toBe("Write a summary to commit");
  });

  it("is disabled while a commit is running", () => {
    expect(commitButton({ ...ready, busy: true })).toEqual({ label: "Committing…", disabledReason: "Committing…" });
  });
});

describe("stash button", () => {
  const files = [
    { path: "a.txt", area: "staged" },
    { path: "a.txt", area: "unstaged" },
    { path: "b.txt", area: "unstaged" },
    { path: "new.txt", area: "untracked" },
  ] as const;

  it("names the number of files the stash takes, untracked ones only when included", () => {
    expect(stashButton({ files, untracked: false, busy: false })).toEqual({ label: "Stash 2 files", disabledReason: undefined });
    expect(stashButton({ files, untracked: true, busy: false })).toEqual({ label: "Stash 3 files", disabledReason: undefined });
    expect(stashButton({ files: [files[2]], untracked: false, busy: false }).label).toBe("Stash 1 file");
  });

  it("is disabled with a reason when there is nothing to stash", () => {
    expect(stashButton({ files: [], untracked: true, busy: false })).toEqual({ label: "Stash", disabledReason: "No local changes to stash" });
  });

  it("asks to include untracked files when only untracked files changed", () => {
    expect(stashButton({ files: [files[3]], untracked: false, busy: false }).disabledReason).toBe("Only untracked files changed; include them to stash");
    expect(stashButton({ files: [files[3]], untracked: true, busy: false }).disabledReason).toBeUndefined();
  });

  it("is disabled while a stash is running", () => {
    expect(stashButton({ files, untracked: false, busy: true })).toEqual({ label: "Stashing…", disabledReason: "Stashing…" });
  });
});

describe("stash message", () => {
  it("joins the title and the description with a blank line and drops an empty part", () => {
    expect(stashMessage("Half done", "Login form\nstill failing")).toBe("Half done\n\nLogin form\nstill failing");
    expect(stashMessage("  Half done ", "  ")).toBe("Half done");
    expect(stashMessage("", "Only a body")).toBe("Only a body");
    expect(stashMessage(" ", "")).toBe("");
  });
});

describe("summary counter", () => {
  it("counts characters left against the 72 guide and goes negative past it", () => {
    expect(summaryRemaining("")).toBe(72);
    expect(summaryRemaining("Tune retries and clamp helper")).toBe(43);
    expect(summaryRemaining("x".repeat(75))).toBe(-3);
  });

  it("counts a character outside the BMP once", () => {
    expect(summaryRemaining("🚀")).toBe(71);
  });
});

describe("amend", () => {
  it("warns only when HEAD is already on its upstream, naming the upstream", () => {
    expect(amendWarning(false, "origin/main")).toBeUndefined();
    expect(amendWarning(true, "origin/main")).toContain("origin/main");
    expect(amendWarning(true, undefined)).toContain("its upstream");
  });

  it("prefills an empty draft with the HEAD message and never overwrites typed text", () => {
    const info = { summary: "Old subject", description: "Old body" };
    expect(amendDraft({ summary: "", description: "" }, info)).toEqual(info);
    const typed = { summary: "New subject", description: "" };
    expect(amendDraft(typed, info)).toBe(typed);
  });
});

function commitFixture(staged: number, push: () => Promise<void> = () => Promise.resolve()) {
  const composer = createComposer();
  const session = testSession("/r", { root: "/r" } as RepoSnapshot);
  const committed: string[] = [];
  const pushes: string[] = [];
  const action = createCommitAction({
    session,
    composer,
    staged: () => staged,
    onCommitted: (sha) => committed.push(sha),
    push: () => {
      pushes.push("push");
      return push();
    },
  });
  return { composer, session, committed, pushes, action };
}

const pushable = { head: { kind: "branch", name: "main", sha: "a" }, remotes: ["origin"], operation: null } as Pick<RepoSnapshot, "head" | "remotes" | "operation">;
const pushInput = { button: { label: "Commit", disabledReason: undefined }, snapshot: pushable, amend: false, amendPushed: false, syncing: false };

describe("commit and push reason", () => {
  it("is enabled when the commit is enabled and a branch with a remote can push", () => {
    expect(commitPushReason(pushInput)).toBeUndefined();
  });

  it("repeats the commit reason first", () => {
    expect(commitPushReason({ ...pushInput, button: { label: "Commit", disabledReason: "Write a summary to commit" } })).toBe("Write a summary to commit");
  });

  it.each([
    [{ snapshot: { ...pushable, head: { kind: "detached", sha: "a" } } }, "Check out a branch to push"],
    [{ snapshot: { ...pushable, remotes: [] } }, "This repository has no remotes"],
    [{ snapshot: { ...pushable, operation: "rebase" } }, "Finish the operation in progress first"],
    [{ syncing: true }, "Another sync is running"],
    [{ amend: true, amendPushed: true }, "This amend rewrites a pushed commit. Amend first, then use Force push"],
  ])("explains why it is disabled: %#", (override, reason) => {
    expect(commitPushReason({ ...pushInput, ...override } as typeof pushInput)).toBe(reason);
  });

  it("allows pushing an amend of a commit that was not pushed", () => {
    expect(commitPushReason({ ...pushInput, amend: true, amendPushed: false })).toBeUndefined();
  });

  it("allows the first commit of an unborn branch", () => {
    expect(commitPushReason({ ...pushInput, snapshot: { ...pushable, head: { kind: "unborn", branch: "main" } } })).toBeUndefined();
  });
});

describe("commit action", () => {
  it("commits the draft, clears it, refreshes, and reports the new sha", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "commit" ? "c0ffee" : { root: "/after" };
    });
    const { composer, session, committed, action } = commitFixture(2);
    composer.setSummary("Tune retries");
    composer.setDescription("Because.");

    await action.submit();

    expect(calls).toEqual([
      { cmd: "commit", args: { path: "/r", summary: "Tune retries", description: "Because.", amend: false } },
      { cmd: "repo_open", args: { path: "/r" } },
    ]);
    expect(committed).toEqual(["c0ffee"]);
    expect([composer.summary(), composer.description(), composer.busy(), composer.failure()]).toEqual(["", "", false, undefined]);
    expect(session.snapshot().root).toBe("/after");
  });

  it("does nothing while the button is disabled", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return null;
    });
    const { composer, action } = commitFixture(0);
    composer.setSummary("Summary");

    await action.submit();

    expect(calls).toEqual([]);
  });

  it("keeps the draft and exposes the hook output when the commit fails", async () => {
    mockIPC(() => {
      throw { kind: "commit_failed", message: "`git commit` exited with status 1", output: "lint: aborting" };
    });
    const { composer, committed, action } = commitFixture(1);
    composer.setSummary("Blocked");

    await action.submit();

    expect(composer.failure()).toMatchObject({ kind: "commit_failed", output: "lint: aborting" });
    expect(composer.summary()).toBe("Blocked");
    expect(composer.busy()).toBe(false);
    expect(committed).toEqual([]);
  });

  it("enables amend with the HEAD message and the pushed flag, and clears the flag when turned off", async () => {
    mockIPC(() => ({ sha: "abc", summary: "Old subject", description: "Old body", pushed: true }));
    const { composer, action } = commitFixture(0);

    await action.toggleAmend(true);

    expect([composer.amend(), composer.summary(), composer.description(), composer.pushed()]).toEqual([true, "Old subject", "Old body", true]);
    await action.toggleAmend(false);
    expect([composer.amend(), composer.pushed()]).toEqual([false, false]);
  });

  it("leaves amend off and reports the error when there is no commit to amend", async () => {
    mockIPC(() => {
      throw { kind: "invalid_request", message: "Invalid request: there is no commit to amend yet", output: null };
    });
    const { composer, action } = commitFixture(0);

    await action.toggleAmend(true);

    expect(composer.amend()).toBe(false);
    expect(composer.failure()?.kind).toBe("invalid_request");
  });

  it("pushes after the commit when asked, once the draft is cleared and the commit reported", async () => {
    const order: string[] = [];
    mockIPC((cmd) => {
      order.push(cmd);
      return cmd === "commit" ? "c0ffee" : { root: "/after" };
    });
    const { composer, committed, pushes, action } = commitFixture(1, async () => {
      order.push("push");
    });
    composer.setSummary("Ship it");

    await action.submit({ push: true });

    expect(order).toEqual(["commit", "repo_open", "push"]);
    expect(committed).toEqual(["c0ffee"]);
    expect(pushes).toEqual(["push"]);
    expect(composer.summary()).toBe("");
  });

  it("does not push for a plain commit", async () => {
    mockIPC((cmd) => (cmd === "commit" ? "c0ffee" : { root: "/after" }));
    const { composer, pushes, action } = commitFixture(1);
    composer.setSummary("Local only");

    await action.submit();

    expect(pushes).toEqual([]);
  });

  it("keeps the commit and reports the error when the push then fails", async () => {
    mockIPC((cmd) => (cmd === "commit" ? "c0ffee" : { root: "/after" }));
    const { composer, session, committed, action } = commitFixture(1, () =>
      Promise.reject(new IpcError({ kind: "push_rejected", message: "The remote rejected the push", output: null })),
    );
    composer.setSummary("Ship it");

    await action.submit({ push: true });

    expect(committed).toEqual(["c0ffee"]);
    expect(composer.summary()).toBe("");
    expect(composer.busy()).toBe(false);
    expect(session.notice()).toBe("The remote rejected the push");
  });

  it("does not push when the commit fails", async () => {
    mockIPC(() => {
      throw { kind: "commit_failed", message: "hook failed", output: "lint" };
    });
    const { composer, pushes, action } = commitFixture(1);
    composer.setSummary("Blocked");

    await action.submit({ push: true });

    expect(pushes).toEqual([]);
    expect(composer.failure()?.kind).toBe("commit_failed");
  });
});

describe("committing as", () => {
  const profiles = (author_name: string, author_email: string) => ({
    active: "work",
    profiles: [
      { id: "default", name: "Default", author_name: "", author_email: "" },
      { id: "work", name: "Work", author_name, author_email },
    ],
  });

  it("states the active profile's author name and email", () => {
    expect(commitIdentityLabel(profiles("Ada Lovelace", "ada@example.com"))).toBe("Committing as Ada Lovelace ada@example.com");
  });

  it("states nothing while the profiles are unknown or the active profile has no author", () => {
    expect(commitIdentityLabel(undefined)).toBeUndefined();
    expect(commitIdentityLabel(profiles("", ""))).toBeUndefined();
    expect(commitIdentityLabel({ active: "gone", profiles: [] })).toBeUndefined();
  });
});
