import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { RebasePlan } from "../ipc/bindings/RebasePlan";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { RebaseEditor } from "./RebaseEditor";
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
  ({ root: "/r", head: { kind: "branch", name: "main", sha: "c" }, upstream: { name: "origin/main", ahead_behind: { ahead: 3, behind: 0 } }, counts, files: [], operation: null, operation_detail: null, remotes: ["origin"], ...overrides }) as RepoSnapshot;

const todo = (sha: string, summary: string, extra: Record<string, unknown> = {}) => ({ sha, summary, author: { name: "Yui", initials: "Y" }, is_merge: false, pushed: false, ...extra });
const plan = (overrides: Partial<RebasePlan> = {}): RebasePlan => ({ base: "base0000", commits: [todo("aaaaaaa1", "First"), todo("bbbbbbb2", "Second"), todo("ccccccc3", "Third")], pushed: false, ...overrides });
const bodies: Record<string, string> = { aaaaaaa1: "Why first", bbbbbbb2: "", ccccccc3: "Why third" };

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(config: { plan?: RebasePlan; snapshot?: RepoSnapshot; apply?: unknown | (() => unknown) } = {}) {
  const calls: Call[] = [];
  const current = config.snapshot ?? snapshot();
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "repo_open") return current;
    if (cmd === "rebase_plan") return config.plan ?? plan();
    if (cmd === "commit_details") return { sha: call.args.sha, summary: (config.plan ?? plan()).commits.find((c) => c.sha === call.args.sha)?.summary ?? "", body: bodies[String(call.args.sha)] ?? "", parents: [], refs: [], files: [] };
    if (cmd === "rebase_interactive") {
      const outcome = typeof config.apply === "function" ? (config.apply as () => unknown)() : (config.apply ?? { outcome: "completed", pushed: false, dropped_all: false });
      if (typeof outcome === "object" && outcome !== null && "reject" in outcome) throw (outcome as { reject: unknown }).reject;
      return outcome;
    }
    return null;
  });
  const closed: string[] = [];
  const view = createRoot(() => testSession("/r", current));
  const mounted = mountWithApp(() => <RebaseEditor session={view} base="base0000" from="aaaaaaa1" onClose={() => closed.push("closed")} />);
  dispose = mounted.dispose;
  await flush(60);
  const rows = () => [...mounted.host.querySelectorAll<HTMLElement>(".rrow")];
  const order = () => rows().map((row) => row.dataset.sha);
  const action = (sha: string, value: string) => {
    const select = mounted.host.querySelector<HTMLSelectElement>(`.rrow[data-sha="${sha}"] select`);
    if (select === null) throw new Error(`no select for ${sha}`);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const apply = () => buttonNamed(mounted.host, "Rewrite history");
  const stepsSent = () => calls.find((call) => call.cmd === "rebase_interactive")?.args;
  return { ...mounted, calls, closed, view, rows, order, action, apply, stepsSent };
}

describe("interactive rebase editor", () => {
  it("lists the commits of base..HEAD newest first with their SHAs, and says how many", async () => {
    const { host, order, calls } = await mount();

    expect(calls.find((call) => call.cmd === "rebase_plan")?.args).toEqual({ path: "/r", base: "base0000" });
    expect(order()).toEqual(["ccccccc3", "bbbbbbb2", "aaaaaaa1"]);
    expect(host.querySelector(".rrow .rsha")?.textContent).toBe("ccccccc");
    expect(host.querySelector(".rhead")?.textContent).toContain("3 commits");
    expect(host.querySelector(".rhead")?.textContent).toContain("base000..HEAD");
  });

  it("warns, in text, that pushed commits will need a force push, naming the count and the upstream", async () => {
    const { host } = await mount({ plan: plan({ pushed: true, commits: [todo("aaaaaaa1", "First", { pushed: true }), todo("bbbbbbb2", "Second", { pushed: true }), todo("ccccccc3", "Third")] }) });

    expect(host.querySelector(".note.attention")?.textContent).toContain("2 of these commits are already on origin/main. Rewriting them means the next push needs a force push.");
    expect(host.querySelectorAll(".rrow .chip-pushed")).toHaveLength(2);
    expect(host.querySelector(".rrow .chip-pushed")?.textContent).toContain("Pushed");
  });

  it("keeps Rewrite history disabled until something changes, and says why", async () => {
    const { apply, host } = await mount();

    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toBe("Change an action or reorder a commit first");
  });

  it("rewords a commit with its full message prefilled, then sends the steps oldest first", async () => {
    const { host, action, apply, stepsSent, closed } = await mount();

    action("aaaaaaa1", "reword");
    await flush(40);
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message for aaaaaaa"]');
    expect(editor?.value).toBe("First\n\nWhy first");
    type(editor as unknown as HTMLInputElement, "First, reworded");
    await flush();
    apply()?.click();
    await flush(60);

    expect(stepsSent()).toEqual({
      path: "/r",
      base: "base0000",
      steps: [
        { kind: "reword", sha: "aaaaaaa1", message: "First, reworded" },
        { kind: "pick", sha: "bbbbbbb2" },
        { kind: "pick", sha: "ccccccc3" },
      ],
    });
    expect(closed).toEqual(["closed"]);
  });

  it("keeps the same message editor, and its focus, while the user types", async () => {
    const { host, action } = await mount();
    action("aaaaaaa1", "reword");
    await flush(40);
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message for aaaaaaa"]') as HTMLTextAreaElement;
    editor.focus();

    type(editor as unknown as HTMLInputElement, "F");
    await flush();
    type(editor as unknown as HTMLInputElement, "Fi");
    await flush();

    expect(host.querySelector('textarea[aria-label="Message for aaaaaaa"]')).toBe(editor);
    expect(document.activeElement).toBe(editor);
  });

  it("squashes into the commit below, edits the combined message once, and previews the result", async () => {
    const { host, action, apply, stepsSent } = await mount();

    action("ccccccc3", "squash");
    await flush(40);
    const preview = host.querySelector('[aria-label="Resulting history"]')?.textContent ?? "";
    expect(preview).toContain("Second");
    expect(preview).toContain("bbbbbbb + ccccccc");
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message for ccccccc"]');
    expect(editor?.value).toBe("Second\n\nThird\n\nWhy third");
    apply()?.click();
    await flush(60);

    expect(stepsSent()?.steps).toEqual([
      { kind: "pick", sha: "aaaaaaa1" },
      { kind: "pick", sha: "bbbbbbb2" },
      { kind: "squash", sha: "ccccccc3", message: "Second\n\nThird\n\nWhy third" },
    ]);
  });

  it("refuses a squash with nothing below it and names the row", async () => {
    const { host, action, apply } = await mount();

    action("aaaaaaa1", "fixup");
    await flush(40);

    expect(host.querySelector('.rrow[data-sha="aaaaaaa1"] .row-problem')?.textContent).toBe("Nothing below to combine with. Move it above another kept commit, or pick it.");
    expect(apply()?.disabled).toBe(true);
  });

  it("moves a row with the buttons and with ⌥↑ and ⌥↓, keeping focus on it", async () => {
    const { host, order, apply, stepsSent } = await mount();

    host.querySelector<HTMLElement>('.rrow[data-sha="bbbbbbb2"] button[aria-label="Move Second up"]')?.click();
    await flush();
    expect(order()).toEqual(["bbbbbbb2", "ccccccc3", "aaaaaaa1"]);

    const row = host.querySelector<HTMLElement>('.rrow[data-sha="bbbbbbb2"]') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(order()).toEqual(["ccccccc3", "bbbbbbb2", "aaaaaaa1"]);
    expect(document.activeElement?.getAttribute("data-sha")).toBe("bbbbbbb2");

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true, cancelable: true }));
    await flush();
    apply()?.click();
    await flush(60);
    expect((stepsSent()?.steps as Array<{ sha: string }>).map((step) => step.sha)).toEqual(["aaaaaaa1", "ccccccc3", "bbbbbbb2"]);
  });

  it("sets an action from the keyboard with p, r, s, f, d, and e", async () => {
    const { host, rows } = await mount();
    const press = (sha: string, key: string) => host.querySelector(`.rrow[data-sha="${sha}"]`)?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    press("ccccccc3", "d");
    press("bbbbbbb2", "e");
    await flush();

    expect(rows().map((row) => row.querySelector("select")?.value)).toEqual(["drop", "edit", "pick"]);
  });

  it("previews dropped commits and the stop for an edit", async () => {
    const { host, action } = await mount();

    action("ccccccc3", "drop");
    action("bbbbbbb2", "edit");
    await flush(40);

    const preview = host.querySelector('[aria-label="Resulting history"]')?.textContent ?? "";
    expect(preview).toContain("Stops here so you can amend it");
    expect(preview).toContain("Dropped");
    expect(preview).toContain("Third");
  });

  it("refuses a range with a merge commit and states why", async () => {
    const { host, action, apply } = await mount({ plan: plan({ commits: [todo("aaaaaaa1", "First"), todo("bbbbbbb2", "Merge", { is_merge: true })] }) });

    action("aaaaaaa1", "drop");
    await flush(40);

    expect(host.querySelector(".note.danger")?.textContent).toContain("This range contains a merge commit. Interactive rebase does not support merge commits.");
    expect(apply()?.disabled).toBe(true);
  });

  it("blocks Rewrite history while tracked files have changes", async () => {
    const { action, apply, host } = await mount({ snapshot: snapshot({ counts: { ...counts, modified: 1 } }) });

    action("ccccccc3", "drop");
    await flush(40);

    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Commit, stash, or discard your changes first");
  });

  it("leaves the editor open with the core's message when the rewrite is refused", async () => {
    const { action, apply, host, closed } = await mount({ apply: { reject: { kind: "local_changes", message: "Your local changes would be overwritten", output: null } } });
    action("ccccccc3", "drop");
    await flush(40);
    apply()?.click();
    await flush(60);

    expect(host.querySelector(".rfoot .field-note.error")?.textContent).toContain("Your local changes would be overwritten");
    expect(closed).toEqual([]);
  });

  it("reports a stop on conflicts and closes so the banner and resolver take over", async () => {
    const { action, apply, closed, view } = await mount({ apply: { outcome: "conflicts", pushed: false, dropped_all: false } });

    action("ccccccc3", "drop");
    await flush(40);
    apply()?.click();
    await flush(80);

    expect(closed).toEqual(["closed"]);
    expect(view.notice()).toBe("Interactive rebase stopped on conflicts. Resolve them, then continue, or abort.");
  });

  it("reports a stop to edit", async () => {
    const { action, apply, view } = await mount({ apply: { outcome: "stopped_to_edit", pushed: false, dropped_all: false } });

    action("ccccccc3", "edit");
    await flush(40);
    apply()?.click();
    await flush(80);

    expect(view.notice()).toBe("Interactive rebase stopped to edit a commit. Amend it or change files, then Continue.");
  });

  it("shows why the plan could not be read", async () => {
    mockIPC((cmd) => {
      if (cmd === "rebase_plan") throw { kind: "invalid_request", message: "abc is not an ancestor of HEAD", output: null };
      return snapshot();
    });
    const view = createRoot(() => testSession("/r", snapshot()));
    const mounted = mountWithApp(() => <RebaseEditor session={view} base="abc" from="def" onClose={() => undefined} />);
    dispose = mounted.dispose;
    await flush(60);

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("abc is not an ancestor of HEAD");
  });
});
