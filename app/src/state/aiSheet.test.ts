import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { testSession } from "../components/testkit";
import type { ComposeProposal } from "../ipc/bindings/ComposeProposal";
import type { Explanation } from "../ipc/bindings/Explanation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { composeFoot, composeLabel, composeReason, createAiSheet, type ComposeDraftGroup } from "./aiSheet";

afterEach(() => clearMocks());

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "a" }, files: [], operation: null } as unknown as RepoSnapshot;
const explanation = (overrides: Partial<Explanation> = {}): Explanation => ({
  items: [
    { path: "src/a.ts", text: "Adds the greeting." },
    { path: "src/b.ts", text: "Wires it up." },
  ],
  excluded: [],
  truncated: [],
  ...overrides,
});
const proposal = (overrides: Partial<ComposeProposal> = {}): ComposeProposal => ({
  groups: [
    { message: "Add greeting", files: ["src/a.ts"] },
    { message: "Wire it up", files: ["src/b.ts", "src/c.ts"] },
  ],
  excluded: [],
  truncated: [],
  ...overrides,
});

function setup(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    return handler(cmd, (args ?? {}) as Record<string, unknown>);
  });
  return createRoot(() => {
    const session = testSession("/r", snapshot);
    return { calls, session, sheet: createAiSheet(session) };
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe("explain changes and explain commit", () => {
  it("opens the sheet with one item per file and the withheld and cut notes, and changes nothing in Git", async () => {
    const { calls, sheet } = setup(() => explanation({ excluded: [".env"], truncated: ["big.sql"] }));

    await sheet.explainChanges();

    expect(sheet.target()).toEqual({ kind: "explain_changes" });
    expect(sheet.items()?.map((item) => item.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(sheet.notes()).toEqual(["Withheld from the provider because they look like secrets: .env", "Cut to fit the size limit: big.sql"]);
    expect(calls.map((call) => call.cmd)).toEqual(["ai_explain_changes"]);
    expect(calls[0]?.args).toMatchObject({ path: "/r" });
    expect(String(calls[0]?.args.id)).toMatch(/^ai-/);
  });

  it("explains the selected commit by its sha", async () => {
    const { calls, sheet } = setup(() => explanation());

    await sheet.explainCommit("b".repeat(40));

    expect(sheet.target()).toEqual({ kind: "explain_commit", sha: "b".repeat(40) });
    expect(calls[0]).toMatchObject({ cmd: "ai_explain_commit", args: { path: "/r", sha: "b".repeat(40) } });
    expect(sheet.items()).toHaveLength(2);
  });

  it("keeps the sheet open with an actionable failure when the provider is missing, and shows no items", async () => {
    const { sheet } = setup(() => Promise.reject({ kind: "ai_not_configured", message: "Choose a provider and model for Explain changes in Settings → AI" }));

    await sheet.explainChanges();

    expect(sheet.target()).toEqual({ kind: "explain_changes" });
    expect(sheet.items()).toBeUndefined();
    expect(sheet.failure()).toEqual({ message: "Choose a provider and model for Explain changes in Settings → AI. Nothing was changed.", action: "open_settings" });
  });

  it("closes the sheet when the request is cancelled", async () => {
    const { sheet } = setup(() => Promise.reject({ kind: "cancelled", message: "cancelled" }));

    await sheet.explainChanges();

    expect(sheet.target()).toBeUndefined();
    expect(sheet.failure()).toBeUndefined();
  });

  it("cancels the running call through its operation id when the sheet is closed, and ignores the late answer", async () => {
    let release: (value: Explanation) => void = () => undefined;
    const { calls, sheet } = setup((cmd) => (cmd === "ai_explain_changes" ? new Promise<Explanation>((resolve) => (release = resolve)) : true));

    const opening = sheet.explainChanges();
    await settle();
    expect(sheet.running()).toBe(true);
    sheet.close();
    await settle();
    release(explanation());
    await opening;

    expect(calls.find((call) => call.cmd === "operation_cancel")?.args.id).toBe(calls[0]?.args.id);
    expect(sheet.target()).toBeUndefined();
    expect(sheet.items()).toBeUndefined();
  });

  it("refuses a second request while one is running", async () => {
    let release: (value: Explanation) => void = () => undefined;
    const { calls, sheet } = setup(() => new Promise<Explanation>((resolve) => (release = resolve)));

    const first = sheet.explainChanges();
    await settle();
    await sheet.explainCommit("c".repeat(40));
    release(explanation());
    await first;

    expect(calls.filter((call) => call.cmd.startsWith("ai_"))).toHaveLength(1);
    expect(sheet.target()).toEqual({ kind: "explain_changes" });
  });
});

describe("compose commits", () => {
  it("proposes every group included, with the notes, without creating anything", async () => {
    const { calls, sheet } = setup(() => proposal({ truncated: ["big.sql"] }));

    await sheet.compose();

    expect(sheet.target()).toEqual({ kind: "compose_commits" });
    expect(sheet.groups()?.map((group) => [group.message, group.files, group.include])).toEqual([
      ["Add greeting", ["src/a.ts"], true],
      ["Wire it up", ["src/b.ts", "src/c.ts"], true],
    ]);
    expect(sheet.notes()).toEqual(["Cut to fit the size limit: big.sql"]);
    expect(calls.map((call) => call.cmd)).toEqual(["ai_compose_commits"]);
  });

  it("creates only the included groups with their edited messages, closes the sheet, and refreshes the repository", async () => {
    const { calls, sheet } = setup((cmd) => (cmd === "ai_compose_commits" ? proposal() : cmd === "compose_apply" ? ["c1"] : cmd === "repo_open" ? snapshot : null));
    await sheet.compose();

    sheet.setMessage(1, "Wire it up properly");
    sheet.setInclude(0, false);
    await sheet.create();
    await settle();

    const apply = calls.filter((call) => call.cmd === "compose_apply");
    expect(apply).toHaveLength(1);
    expect(apply[0]?.args).toEqual({ path: "/r", groups: [{ message: "Wire it up properly", files: ["src/b.ts", "src/c.ts"] }] });
    expect(sheet.target()).toBeUndefined();
    expect(sheet.groups()).toBeUndefined();
    expect(calls.map((call) => call.cmd)).toContain("repo_open");
  });

  it("does not create anything while a group has no message or none is included", async () => {
    const { calls, sheet } = setup(() => proposal());
    await sheet.compose();

    sheet.setMessage(0, "  ");
    await sheet.create();
    sheet.setMessage(0, "Add greeting");
    sheet.setInclude(0, false);
    sheet.setInclude(1, false);
    await sheet.create();

    expect(calls.some((call) => call.cmd === "compose_apply")).toBe(false);
    expect(sheet.target()).toEqual({ kind: "compose_commits" });
  });

  it("keeps the sheet and the edits when creating fails, and reports the cause", async () => {
    const { session, sheet } = setup((cmd) => {
      if (cmd === "ai_compose_commits") return proposal();
      if (cmd === "compose_apply") return Promise.reject({ kind: "commit_failed", message: "The commit-msg hook refused the message" });
      return snapshot;
    });
    await sheet.compose();
    sheet.setMessage(0, "Refuse this");

    await sheet.create();
    await settle();

    expect(sheet.target()).toEqual({ kind: "compose_commits" });
    expect(sheet.groups()?.[0]?.message).toBe("Refuse this");
    expect(session.notice()).toBe("The commit-msg hook refused the message");
    expect(sheet.applying()).toBe(false);
  });
});

describe("compose copy", () => {
  const group = (id: number, message: string, files: string[], include = true): ComposeDraftGroup => ({ id, message, files, include });

  it("states why Create is unavailable and counts the included commits", () => {
    expect(composeReason([group(0, "A", ["a"], false)], false)).toBe("Include at least one commit");
    expect(composeReason([group(0, "A", ["a"]), group(1, " ", ["b"])], false)).toBe("Write a message for commit 2");
    expect(composeReason([group(0, "A", ["a"]), group(1, " ", ["b"], false)], false)).toBeUndefined();
    expect(composeReason([group(0, "A", ["a"])], true)).toBe("Creating commits…");
    expect(composeLabel([group(0, "A", ["a"])])).toBe("Create 1 commit");
    expect(composeLabel([group(0, "A", ["a"]), group(1, "B", ["b"]), group(2, "C", ["c"], false)])).toBe("Create 2 commits");
  });

  it("says how many files are committed and names the files left uncommitted", () => {
    expect(composeFoot([group(0, "A", ["a", "b"]), group(1, "B", ["c"], false)])).toBe("2 files will be committed. Unchecked groups stay uncommitted: c.");
    expect(composeFoot([group(0, "A", ["a"])])).toBe("1 file will be committed.");
  });
});
