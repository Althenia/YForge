import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { testSession } from "../components/testkit";
import type { CommitDraft } from "../ipc/bindings/CommitDraft";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createGenerateAction, draftNotes } from "./aiGenerate";
import { createComposer } from "./composer";

afterEach(() => clearMocks());

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "a" }, files: [], operation: null } as unknown as RepoSnapshot;
const draft = (overrides: Partial<CommitDraft> = {}): CommitDraft => ({ summary: "Add greeting", description: "Body", summary_trimmed: false, excluded: [], truncated: [], ...overrides });

function setup(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    return handler(cmd, (args ?? {}) as Record<string, unknown>);
  });
  return createRoot(() => {
    const session = testSession("/r", snapshot);
    const composer = createComposer();
    const action = createGenerateAction({ session, composer });
    return { calls, composer, action };
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("draft notes", () => {
  it("names withheld and cut files and a trimmed summary, and says nothing for a clean draft", () => {
    expect(draftNotes(draft())).toEqual([]);
    expect(draftNotes(draft({ excluded: [".env", "id_rsa"], truncated: ["big.sql"], summary_trimmed: true }))).toEqual([
      "Withheld from the provider because they look like secrets: .env, id_rsa",
      "Cut to fit the size limit: big.sql",
      "The summary was shortened to fit the 72 character guide.",
    ]);
  });
});

describe("generate commit message", () => {
  it("fills the summary and description as an editable draft and never commits", async () => {
    const { calls, composer, action } = setup((cmd) => (cmd === "ai_generate_commit_message" ? draft({ excluded: [".env"] }) : null));

    await action.run();

    expect(composer.summary()).toBe("Add greeting");
    expect(composer.description()).toBe("Body");
    expect(action.drafted()).toBe(true);
    expect(action.notes()).toEqual(["Withheld from the provider because they look like secrets: .env"]);
    expect(calls.map((call) => call.cmd)).toEqual(["ai_generate_commit_message"]);
    expect(calls[0]?.args).toMatchObject({ path: "/r" });
    expect(String(calls[0]?.args.id)).toMatch(/^ai-/);
    composer.setSummary("Edited by hand");
    expect(composer.summary()).toBe("Edited by hand");
  });

  it("stops calling the text a draft once the composer is emptied by a commit", async () => {
    const { composer, action } = setup(() => draft({ excluded: [".env"] }));
    await action.run();
    expect(action.drafted()).toBe(true);

    composer.setSummary("");
    composer.setDescription("");
    await settle();

    expect(action.drafted()).toBe(false);
    expect(action.notes()).toEqual([]);
  });

  it("keeps the text it replaced so it can be restored", async () => {
    const { composer, action } = setup(() => draft());
    composer.setSummary("Mine");
    composer.setDescription("My body");

    await action.run();
    expect(composer.summary()).toBe("Add greeting");
    expect(action.replaced()).toEqual({ summary: "Mine", description: "My body" });

    action.restore();
    expect(composer.summary()).toBe("Mine");
    expect(composer.description()).toBe("My body");
    expect(action.replaced()).toBeUndefined();
  });

  it("does not offer a restore when there was no text to replace", async () => {
    const { action } = setup(() => draft());
    await action.run();
    expect(action.replaced()).toBeUndefined();
  });

  it("maps a missing provider to an actionable message that opens the AI settings", async () => {
    const { composer, action } = setup(() => Promise.reject({ kind: "ai_not_configured", message: "no provider" }));

    await action.run();

    expect(action.failure()).toEqual({ message: "No AI provider is set up. Choose one in Settings → AI.", action: "open_settings" });
    expect(composer.summary()).toBe("");
  });

  it("maps a revoked sign-in to Sign in, and stays silent when the run is cancelled", async () => {
    const auth = setup(() => Promise.reject({ kind: "ai_auth_required", message: "Sign in to Claude Code" }));
    await auth.action.run();
    expect(auth.action.failure()).toMatchObject({ action: "sign_in", detail: "Sign in to Claude Code" });

    const cancelled = setup(() => Promise.reject({ kind: "cancelled", message: "cancelled" }));
    await cancelled.action.run();
    expect(cancelled.action.failure()).toBeUndefined();
  });

  it("cancels the running call through its operation id", async () => {
    let release: (value: CommitDraft) => void = () => undefined;
    const { calls, action } = setup((cmd) => (cmd === "ai_generate_commit_message" ? new Promise<CommitDraft>((resolve) => (release = resolve)) : true));

    const running = action.run();
    await settle();
    expect(action.running()).toBe(true);
    action.cancel();
    await settle();
    release(draft());
    await running;

    const cancel = calls.find((call) => call.cmd === "operation_cancel");
    expect(cancel?.args.id).toBe(calls[0]?.args.id);
  });
});
