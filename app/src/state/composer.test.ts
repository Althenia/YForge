import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { amendDraft, amendWarning, commitButton, createCommitAction, createComposer, summaryRemaining } from "./composer";
import { createRepoSession } from "./repoSession";

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
    expect(commitButton({ ...ready, summary: "   " }).disabledReason).toBe("Enter a summary");
  });

  it("reports the missing stage before the missing summary", () => {
    expect(commitButton({ ...ready, staged: 0, summary: "" }).disabledReason).toBe("Stage files to commit");
  });

  it("lets an amend proceed with nothing staged but still needs a summary", () => {
    expect(commitButton({ ...ready, staged: 0, amend: true })).toEqual({ label: "Amend commit", disabledReason: undefined });
    expect(commitButton({ ...ready, staged: 0, amend: true, summary: "" }).disabledReason).toBe("Enter a summary");
  });

  it("is disabled while a commit is running", () => {
    expect(commitButton({ ...ready, busy: true })).toEqual({ label: "Committing…", disabledReason: "Committing…" });
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

function commitFixture(staged: number) {
  const composer = createComposer();
  const session = createRepoSession("/r", { root: "/r" } as RepoSnapshot);
  const committed: string[] = [];
  const action = createCommitAction({ session, composer, staged: () => staged, onCommitted: (sha) => committed.push(sha) });
  return { composer, session, committed, action };
}

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
});
