import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { conflictChecks, conflictLabel, runPredictions } from "./conflicts";
import { pullLookup } from "./platformModel";

afterEach(() => clearMocks());

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    head: { kind: "branch", name: "feature", sha: "a".repeat(40) },
    upstream: { name: "origin/feature", ahead_behind: { ahead: 1, behind: 2 } },
    branches: ["feature", "main"],
    remote_branches: ["origin/feature", "origin/main", "origin/topic"],
    remotes: ["origin"],
    ...overrides,
  }) as RepoSnapshot;

const pull = (overrides: Partial<PullRequest>): PullRequest => ({ draft: false, number: 1, title: "t", body: "", state: "open", source_ref: "topic", target_ref: "main", author: "a", created_at: "", updated_at: "", mergeable: null, web_url: "", ...overrides });

describe("conflict prediction checks (S76)", () => {
  it("checks the checked-out branch against its upstream only while they have diverged", () => {
    expect(conflictChecks(snapshot(), undefined)).toEqual([{ ours: "feature", theirs: "origin/feature", target: "origin/feature", marks: ["feature"] }]);
    expect(conflictChecks(snapshot({ upstream: { name: "origin/feature", ahead_behind: { ahead: 0, behind: 2 } } }), undefined)).toEqual([]);
    expect(conflictChecks(snapshot({ head: { kind: "detached", sha: "b" } }), undefined)).toEqual([]);
  });

  it("checks each open pull request's head against its target, marking the local and remote branch", () => {
    const lookup = pullLookup("origin", [pull({ source_ref: "topic" }), pull({ number: 2, source_ref: "feature" }), pull({ number: 3, source_ref: "gone" })]);
    const level = snapshot({ upstream: { name: "origin/feature", ahead_behind: { ahead: 0, behind: 0 } } });
    expect(conflictChecks(level, lookup)).toEqual([
      { ours: "origin/main", theirs: "origin/topic", target: "origin/main", marks: ["origin/topic"] },
      { ours: "origin/main", theirs: "origin/feature", target: "origin/main", marks: ["feature", "origin/feature"] },
    ]);
  });

  it("names the target and the number of files", () => {
    expect(conflictLabel({ target: "origin/main", files: ["a"] })).toBe("Conflicts with origin/main · 1 file");
    expect(conflictLabel({ target: "origin/main", files: ["a", "b"] })).toBe("Conflicts with origin/main · 2 files");
  });
});

describe("conflict prediction runs (S76)", () => {
  const checks = [
    { ours: "feature", theirs: "origin/feature", target: "origin/feature", marks: ["feature"] },
    { ours: "origin/main", theirs: "origin/topic", target: "origin/main", marks: ["origin/topic"] },
  ];

  it("runs each check in turn and keeps only those that would conflict", async () => {
    const asked: Array<Record<string, unknown>> = [];
    mockIPC((cmd, args) => {
      if (cmd !== "merge_prediction") return null;
      asked.push(args as Record<string, unknown>);
      return (args as { theirs: string }).theirs === "origin/feature" ? { merge_base: "4d9e2f7", conflicted_files: ["app.css"] } : { merge_base: "1111111", conflicted_files: [] };
    });

    const found = await runPredictions("/r", checks, new AbortController().signal, () => undefined);

    expect(asked.map((args) => [args.ours, args.theirs])).toEqual([["feature", "origin/feature"], ["origin/main", "origin/topic"]]);
    expect(asked.every((args) => typeof args.id === "string" && args.path === "/r")).toBe(true);
    expect(found).toEqual([{ ...checks[0], files: ["app.css"], base: "4d9e2f7" }]);
  });

  it("predicts nothing where prediction is unsupported", async () => {
    mockIPC((cmd) => {
      if (cmd === "merge_prediction") throw { kind: "unsupported", message: "Merge prediction cannot safely execute configured external merge drivers. Nothing changed.", output: null };
      return null;
    });
    expect(await runPredictions("/r", checks, new AbortController().signal, () => undefined)).toEqual([]);
  });

  it("cancels the running prediction when the read is superseded", async () => {
    const cancelled: unknown[] = [];
    const abort = new AbortController();
    let release: (value: unknown) => void = () => undefined;
    mockIPC((cmd, args) => {
      if (cmd === "operation_cancel") cancelled.push((args as { id: string }).id);
      if (cmd !== "merge_prediction") return null;
      return new Promise((resolve) => (release = resolve));
    });

    const running = runPredictions("/r", checks, abort.signal, () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    release({ merge_base: "x", conflicted_files: [] });

    await expect(running).rejects.toThrow();
    expect(cancelled).toHaveLength(1);
  });
});
