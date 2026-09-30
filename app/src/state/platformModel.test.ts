import { describe, expect, it } from "vitest";
import type { PrFile } from "../ipc/bindings/PrFile";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import { IpcError } from "../ipc/client";
import {
  cardOfPlatform,
  connectionProblems,
  defaultTarget,
  fileLetter,
  hostProblem,
  mergeabilityView,
  mergeCopy,
  platformFailure,
  PLATFORM_CARDS,
  prStateView,
  pullProblems,
  changeTotals,
} from "./platformModel";

const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 12,
  title: "Add retry helper",
  body: "",
  state: "open",
  source_ref: "feature/retry",
  target_ref: "main",
  author: "yui",
  created_at: "2026-09-30T08:00:00Z",
  updated_at: "2026-09-30T09:00:00Z",
  mergeable: true,
  web_url: "https://github.com/team/app/pull/12",
  ...overrides,
});

describe("platform cards", () => {
  it("offers GitHub, GitLab, and Bitbucket with the neutral glyphs and a host hint", () => {
    expect(PLATFORM_CARDS.map((card) => [card.kind, card.title, card.icon, card.hostPlaceholder])).toEqual([
      ["github", "GitHub", "github", "github.com"],
      ["gitlab", "GitLab", "gitlab", "gitlab.com"],
      ["bitbucket", "Bitbucket", "bitbucket", "bitbucket.org"],
    ]);
    expect(cardOfPlatform("gitlab").title).toBe("GitLab");
  });
});

describe("connection form validation", () => {
  it.each(["github.com", "ghe.example.com", "git.example.com:8443", "localhost:3000", "127.0.0.1:9000", " GitHub.com "])("accepts the host %s", (host) => {
    expect(hostProblem(host)).toBeUndefined();
  });

  it.each(["", "https://github.com", "github.com/team", "git@github.com", "github.com:", "github.com:70000", "git hub.com"])("rejects the host %j", (host) => {
    expect(hostProblem(host)).toBe("Enter the host only, such as github.com or git.example.com:8443, without https:// or a path");
  });

  it("requires a name of 1 to 80 characters and a non-empty token, trimmed", () => {
    const draft = { kind: "github" as const, host: "github.com", name: "Work", token: "ghp_x", insecureTls: false };

    expect(connectionProblems(draft)).toEqual({});
    expect(connectionProblems({ ...draft, name: "   " })).toEqual({ name: "Enter a name" });
    expect(connectionProblems({ ...draft, name: "x".repeat(81) })).toEqual({ name: "Use at most 80 characters" });
    expect(connectionProblems({ ...draft, name: "x".repeat(80) })).toEqual({});
    expect(connectionProblems({ ...draft, token: "  " })).toEqual({ token: "Paste an access token" });
    expect(connectionProblems({ ...draft, host: "" }).host).toContain("host only");
  });
});

describe("failure copy", () => {
  it("keeps the platform's own sentence and offers Edit connection only for a rejected token", () => {
    expect(platformFailure(new IpcError({ kind: "auth_failed", message: "Authentication failed for github.com" }))).toEqual({
      message: "Authentication failed for github.com",
      action: "edit_connection",
    });
    for (const [kind, message] of [
      ["not_found", "No GitHub repository found for team/app"],
      ["api_error", "github.com answered with HTTP 422: Validation Failed"],
      ["network", "Could not reach github.com: timed out"],
      ["invalid_request", "there is no platform connection `c9`"],
    ] as const) {
      expect(platformFailure(new IpcError({ kind, message }))).toEqual({ message });
    }
  });

  it("names the Keychain or database when storage fails, and passes other errors through", () => {
    expect(platformFailure(new IpcError({ kind: "storage_failed", message: "keychain locked" }))).toEqual({
      message: "YForge could not use its saved connections or the macOS Keychain: keychain locked",
    });
    expect(platformFailure(new Error("boom"))).toEqual({ message: "boom" });
    expect(platformFailure("odd")).toEqual({ message: "odd" });
  });
});

describe("pull request presentation", () => {
  it("pairs each state with a word and a glyph", () => {
    expect(prStateView("open")).toEqual({ label: "Open", tone: "ok", icon: "pullrequest" });
    expect(prStateView("merged")).toEqual({ label: "Merged", tone: "info", icon: "merge" });
    expect(prStateView("closed")).toEqual({ label: "Closed", tone: "danger", icon: "close" });
  });

  it("states mergeability in words and never as zero for an unknown value", () => {
    expect(mergeabilityView(pull({ mergeable: true }))).toEqual({ label: "Can be merged", tone: "ok" });
    expect(mergeabilityView(pull({ mergeable: false }))).toEqual({ label: "Cannot be merged yet", tone: "attention", detail: "The platform reports conflicts or a blocked merge." });
    expect(mergeabilityView(pull({ mergeable: null }))).toEqual({ label: "—", tone: "muted", detail: "The platform has not reported whether this can be merged." });
    expect(mergeabilityView(pull({ state: "merged", mergeable: true }))).toEqual({ label: "Already merged", tone: "info" });
    expect(mergeabilityView(pull({ state: "closed", mergeable: false }))).toEqual({ label: "Closed without merging", tone: "muted" });
  });

  it("letters file statuses and totals the change counts", () => {
    expect(["added", "modified", "removed", "renamed", "copied"].map(fileLetter)).toEqual(["A", "M", "D", "R", "M"]);
    const files: PrFile[] = [
      { filename: "a.ts", status: "added", additions: 10, deletions: 0 },
      { filename: "b.ts", status: "modified", additions: 3, deletions: 4 },
    ];
    expect(changeTotals(files)).toEqual({ additions: 13, deletions: 4 });
  });
});

describe("merge confirmation", () => {
  it("states what merges into what, where, and that the merge happens on the server", () => {
    const copy = mergeCopy(pull(), "GitHub");

    expect(copy.title).toBe("Merge pull request #12?");
    expect(copy.names).toEqual(["Add retry helper"]);
    expect(copy.confirmLabel).toBe("Merge pull request");
    expect(copy.neutral).toBe(true);
    expect(copy.consequences.join(" ")).toContain("Merges feature/retry into main on GitHub");
    expect(copy.consequences.join(" ")).toContain("cannot be undone from YForge");
    expect(copy.consequences.join(" ")).toContain("fetches all remotes");
  });

  it("warns when the platform reports the pull request cannot be merged", () => {
    expect(mergeCopy(pull({ mergeable: false }), "GitLab").lead).toBe("GitLab reports conflicts or a blocked merge, so the merge may be refused.");
    expect(mergeCopy(pull({ mergeable: true }), "GitLab").lead).toBeUndefined();
  });
});

describe("create pull request draft", () => {
  const remoteBranches = ["origin/HEAD", "origin/develop", "origin/main", "upstream/main"];

  it("defaults the target to the matched remote's main, then master, then its first branch", () => {
    expect(defaultTarget(remoteBranches, "origin")).toBe("main");
    expect(defaultTarget(["origin/master", "origin/x"], "origin")).toBe("master");
    expect(defaultTarget(["origin/HEAD", "origin/trunk"], "origin")).toBe("trunk");
    expect(defaultTarget(["upstream/main"], "origin")).toBeUndefined();
  });

  it("requires a source, a different target, and a title", () => {
    const draft = { source: "feature/x", target: "main", title: "Add x", body: "" };

    expect(pullProblems(draft)).toEqual({});
    expect(pullProblems({ ...draft, source: "" })).toEqual({ source: "Choose the branch to merge" });
    expect(pullProblems({ ...draft, target: "" })).toEqual({ target: "Choose the branch to merge into" });
    expect(pullProblems({ ...draft, target: "feature/x" })).toEqual({ target: "Choose a different target branch" });
    expect(pullProblems({ ...draft, title: "  " })).toEqual({ title: "Enter a title" });
  });
});
