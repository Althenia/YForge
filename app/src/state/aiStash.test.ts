import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { testSession } from "../components/testkit";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StashDraft } from "../ipc/bindings/StashDraft";
import { createStashMessageAction } from "./aiStash";
import { createComposer } from "./composer";

afterEach(() => clearMocks());

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "a" }, files: [], operation: null } as unknown as RepoSnapshot;
const draft = (overrides: Partial<StashDraft> = {}): StashDraft => ({ summary: "WIP: greeting", description: "- src/a.ts", excluded: [], truncated: [], ...overrides });

function setup(handler: (cmd: string, args: Record<string, unknown>) => unknown) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    return handler(cmd, (args ?? {}) as Record<string, unknown>);
  });
  return createRoot(() => {
    const session = testSession("/r", snapshot);
    const composer = createComposer();
    return { calls, composer, action: createStashMessageAction({ session, composer }) };
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("generate stash message", () => {
  it("fills the stash title and description as an editable draft with the notes, and stashes nothing", async () => {
    const { calls, composer, action } = setup(() => draft({ excluded: [".env"] }));

    await action.run();

    expect(composer.stashTitle()).toBe("WIP: greeting");
    expect(composer.stashDescription()).toBe("- src/a.ts");
    expect(composer.summary()).toBe("");
    expect(action.drafted()).toBe(true);
    expect(action.notes()).toEqual(["Withheld from the provider because they look like secrets: .env"]);
    expect(calls.map((call) => call.cmd)).toEqual(["ai_stash_message"]);
    expect(calls[0]?.args).toMatchObject({ path: "/r" });
    expect(String(calls[0]?.args.id)).toMatch(/^ai-/);
  });

  it("keeps the text it replaced so it can be restored, and offers none when there was nothing to replace", async () => {
    const empty = setup(() => draft());
    await empty.action.run();
    expect(empty.action.replaced()).toBeUndefined();

    const { composer, action } = setup(() => draft());
    composer.setStashTitle("Mine");
    composer.setStashDescription("My body");
    await action.run();
    expect(action.replaced()).toEqual({ title: "Mine", description: "My body" });

    action.restore();
    expect(composer.stashTitle()).toBe("Mine");
    expect(composer.stashDescription()).toBe("My body");
    expect(action.replaced()).toBeUndefined();
  });

  it("stops calling the text a draft once the stash fields are emptied", async () => {
    const { composer, action } = setup(() => draft({ truncated: ["big.sql"] }));
    await action.run();
    expect(action.drafted()).toBe(true);

    composer.setStashTitle("");
    composer.setStashDescription("");
    await settle();

    expect(action.drafted()).toBe(false);
    expect(action.notes()).toEqual([]);
  });

  it("states a failure and leaves the fields alone", async () => {
    const { composer, action } = setup(() => Promise.reject({ kind: "ai_auth_required", message: "Sign in to Claude Code" }));
    composer.setStashTitle("Mine");

    await action.run();

    expect(action.failure()).toMatchObject({ action: "sign_in" });
    expect(composer.stashTitle()).toBe("Mine");
    expect(action.drafted()).toBe(false);
  });
});
