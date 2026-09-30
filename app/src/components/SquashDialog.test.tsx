import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { SquashDialog } from "./SquashDialog";
import { buttonNamed, flush, mountWithApp, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({ root: "/r", head: { kind: "branch", name: "main", sha: "c" }, upstream: { name: "origin/main", ahead_behind: { ahead: 2, behind: 0 } }, counts, files: [], operation: null, operation_detail: null, remotes: ["origin"], ...overrides }) as RepoSnapshot;

const commits: Record<string, { summary: string; body: string; parents: string[] }> = {
  bbbbbbb2: { summary: "Second", body: "", parents: ["aaaaaaa1"] },
  ccccccc3: { summary: "Third", body: "Why third", parents: ["bbbbbbb2"] },
  eeeeeee5: { summary: "Fifth", body: "", parents: ["ddddddd4"] },
};
const todo = (sha: string, summary: string, pushed = false) => ({ sha, summary, author: { name: "Yui", initials: "Y" }, is_merge: false, pushed });

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(shas: string[], config: { snapshot?: RepoSnapshot; squash?: unknown; plan?: unknown } = {}) {
  const calls: Call[] = [];
  const current = config.snapshot ?? snapshot();
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "repo_open") return current;
    if (cmd === "commit_details") return { sha: call.args.sha, ...commits[String(call.args.sha)], refs: [], files: [] };
    if (cmd === "rebase_plan") return config.plan ?? { base: "aaaaaaa1", commits: [todo("bbbbbbb2", "Second"), todo("ccccccc3", "Third")], pushed: false };
    if (cmd === "squash_commits") {
      const outcome = config.squash ?? { outcome: "completed", pushed: false, dropped_all: false };
      if (typeof outcome === "object" && outcome !== null && "reject" in outcome) throw (outcome as { reject: unknown }).reject;
      return outcome;
    }
    return null;
  });
  const closed: string[] = [];
  const session = createRoot(() => testSession("/r", current));
  const mounted = mountWithApp(() => <SquashDialog session={session} shas={shas} onClose={() => closed.push("closed")} />);
  dispose = mounted.dispose;
  await flush(80);
  return { ...mounted, calls, closed, session, squash: () => buttonNamed(mounted.host, "Squash 2 commits"), message: () => mounted.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]') };
}

describe("squash dialog", () => {
  it("prefills the message with the selected commits' messages, oldest first, and names how many will be combined", async () => {
    const { host, message, calls } = await mount(["ccccccc3", "bbbbbbb2"]);

    expect(host.querySelector("h3")?.textContent).toBe("Squash 2 commits");
    expect(message()?.value).toBe("Second\n\nThird\n\nWhy third");
    expect(calls.find((call) => call.cmd === "rebase_plan")?.args).toEqual({ path: "/r", base: "aaaaaaa1" });
  });

  it("squashes with the edited message, oldest commit first, and closes", async () => {
    const { message, squash, calls, closed } = await mount(["ccccccc3", "bbbbbbb2"]);

    type(message() as unknown as HTMLInputElement, "Both, combined");
    await flush();
    squash()?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "squash_commits")?.args).toEqual({ path: "/r", shas: ["bbbbbbb2", "ccccccc3"], message: "Both, combined" });
    expect(closed).toEqual(["closed"]);
  });

  it("refuses a non-contiguous selection with the reason and never calls the core", async () => {
    const { host, calls } = await mount(["ccccccc3", "eeeeeee5"]);

    expect(host.querySelector(".foot .reason")?.textContent).toBe("The selected commits are not one contiguous run of the current branch");
    expect(buttonNamed(host, "Squash 2 commits")?.disabled).toBe(true);
    expect(calls.some((call) => call.cmd === "squash_commits")).toBe(false);
  });

  it("warns, in text, when a selected commit is already on the upstream", async () => {
    const { host } = await mount(["ccccccc3", "bbbbbbb2"], { plan: { base: "aaaaaaa1", commits: [todo("bbbbbbb2", "Second", true), todo("ccccccc3", "Third", true)], pushed: true } });

    expect(host.querySelector(".note.attention")?.textContent).toContain("2 of these commits are already on origin/main. Rewriting them means the next push needs a force push.");
  });

  it("refuses a blank message and a dirty working tree, each with its reason", async () => {
    const { host, message, squash } = await mount(["ccccccc3", "bbbbbbb2"]);
    type(message() as unknown as HTMLInputElement, "   ");
    await flush();
    expect(squash()?.disabled).toBe(true);
    expect(host.querySelector(".foot .reason")?.textContent).toBe("Enter a message");
    dispose?.();
    document.body.innerHTML = "";

    const dirty = await mount(["ccccccc3", "bbbbbbb2"], { snapshot: snapshot({ counts: { ...counts, modified: 1 } }) });
    expect(dirty.squash()?.disabled).toBe(true);
    expect(dirty.host.querySelector(".foot .reason")?.textContent).toContain("Commit, stash, or discard your changes first");
  });

  it("reports conflicts through the notice and shows a refusal from the core without closing", async () => {
    const conflicts = await mount(["ccccccc3", "bbbbbbb2"], { squash: { outcome: "conflicts", pushed: false, dropped_all: false } });
    conflicts.squash()?.click();
    await flush(60);
    expect(conflicts.session.notice()).toBe("Squash stopped on conflicts. Resolve them, then continue, or abort.");
    expect(conflicts.closed).toEqual(["closed"]);
    dispose?.();
    document.body.innerHTML = "";

    const refused = await mount(["ccccccc3", "bbbbbbb2"], { squash: { reject: { kind: "invalid_request", message: "bbbbbbb is not on the current branch", output: null } } });
    refused.squash()?.click();
    await flush(60);
    expect(refused.host.querySelector(".field-note.error")?.textContent).toContain("bbbbbbb is not on the current branch");
    expect(refused.closed).toEqual([]);
  });
});
