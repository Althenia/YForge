import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiffLine } from "../ipc/bindings/DiffLine";
import type { RecomposePreview } from "../ipc/bindings/RecomposePreview";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { RecomposeView } from "./RecomposeView";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { aiFeatureList, buttonNamed, choose, flush, mountWithApp, stubLayout, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubLayout();
});

afterEach(async () => {
  restoreLayout?.();
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({ root: "/r", head: { kind: "branch", name: "main", sha: "h" }, upstream: { name: "origin/main", ahead_behind: { ahead: 3, behind: 0 } }, counts, files: [], operation: null, operation_detail: null, remotes: ["origin"], remote_branches: ["origin/main"], branches: ["main"], ...overrides }) as RepoSnapshot;

const line = (kind: DiffLine["kind"], text: string, number: number): DiffLine => ({ kind, old_number: number, new_number: number, text, no_newline: false });
const hunk = (lines: DiffLine[]) => ({ old_start: 1, old_lines: 3, new_start: 1, new_lines: 3, heading: "", lines });
const preview = (overrides: Partial<RecomposePreview> = {}): RecomposePreview => ({
  base: "b",
  head: "h",
  pushed: false,
  files: [
    { path: "a.txt", status: "modified", binary: false, whole_file_only: false, hunks_omitted: null, hunks: [{ id: "a.txt@1,3+1,3", hunk: hunk([line("context", "x", 1), line("removed", "old", 2), line("added", "new", 2), line("added", "more", 3)]) }, { id: "a.txt@20,3+20,3", hunk: hunk([line("removed", "gone", 20)]) }] },
    { path: "logo.png", status: "added", binary: true, whole_file_only: true, hunks_omitted: null, hunks: [] },
  ],
  ...overrides,
});

type Call = { cmd: string; args: Record<string, unknown> };

const proposal = {
  groups: [
    { message: "Edit text\n\nExplain the change", changes: [{ kind: "hunk", id: "a.txt@1,3+1,3" }, { kind: "hunk", id: "a.txt@20,3+20,3" }] },
    { message: "Add logo", changes: [{ kind: "file", path: "logo.png" }] },
  ],
  excluded: [] as string[],
};

async function mount(config: { snapshot?: RepoSnapshot; preview?: RecomposePreview; apply?: unknown; applyGate?: Promise<void>; propose?: unknown | ((attempt: number) => unknown); gate?: Promise<void> | ((attempt: number) => Promise<void> | undefined); base?: string; features?: AiFeatureSummary[] } = {}) {
  const calls: Call[] = [];
  const current = config.snapshot ?? snapshot();
  let attempts = 0;
  mockIPC(async (cmd, args) => {
    if (cmd === "ai_feature_config_list") return config.features ?? aiFeatureList();
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "repo_open") return current;
    if (cmd === "recompose_preview") return config.preview ?? preview();
    if (cmd === "repo_graph") return { rows: [{ sha: "h", parents: ["g"], summary: "Head commit", kind: "commit", refs: [], edges: [], column: 0, author: null, time: 0 }, { sha: "g", parents: [], summary: "Older commit", kind: "commit", refs: [], edges: [], column: 0, author: null, time: 0 }], carried: [], total: 2 };
    for (const [name, value] of [["recompose_apply", config.apply], ["ai_propose_recompose", config.propose]] as const) {
      if (cmd !== name) continue;
      if (name === "recompose_apply") await config.applyGate;
      if (name === "ai_propose_recompose") {
        attempts += 1;
        await (typeof config.gate === "function" ? config.gate(attempts) : config.gate);
        if (typeof value === "function") return (value as (attempt: number) => unknown)(attempts);
      }
      if (typeof value === "object" && value !== null && "reject" in value) throw (value as { reject: unknown }).reject;
      return value ?? (name === "recompose_apply" ? { head: "n", pushed: false } : proposal);
    }
    return null;
  });
  const closed: string[] = [];
  const opened: string[] = [];
  const session = createRoot(() => testSession("/r", current));
  const mounted = mountWithApp(() => <RecomposeView session={session} base={config.base} onClose={() => closed.push("closed")} onOpenAiSettings={() => opened.push("ai")} />);
  dispose = mounted.dispose;
  await flush(80);
  const host = mounted.host;
  const apply = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().startsWith("Recompose ") && button.classList.contains("primary"));
  const propose = async (wait = 80) => {
    proposeButton(host)?.click();
    await flush(wait);
  };
  const commits = () => [...host.querySelectorAll(".rgroup")].map((card) => card.getAttribute("aria-label"));
  return { ...mounted, calls, closed, opened, session, apply, propose, commits };
}

const proposeButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Propose a grouping of these changes into commits"));

const called = (calls: Call[], cmd: string) => calls.filter((call) => call.cmd === cmd);

describe("recompose view", () => {
  it("reads the changes from the upstream and waits for the user: no provider call and no history rewrite on open", async () => {
    const { host, calls, apply } = await mount();

    expect(called(calls, "recompose_preview")[0]?.args).toEqual({ path: "/r", base: "refs/remotes/origin/main" });
    expect(host.querySelector(".rhead")?.textContent).toContain("2 files");
    expect(called(calls, "ai_propose_recompose")).toEqual([]);
    expect(called(calls, "recompose_apply")).toEqual([]);
    expect(host.querySelectorAll(".rgroup")).toHaveLength(0);
    expect(host.textContent).toContain("No plan yet");
    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Propose a plan with AI first");
  });

  it("has no manual composition controls: no editor, no add, move, remove, assign, drag, or hunk and line pickers", async () => {
    const { host, propose } = await mount();
    await propose();

    expect(host.querySelectorAll(".rgroup")).toHaveLength(2);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector(".rgrip, .assign-chip, .line-check, [data-unit], [role='checkbox'], [data-group]")).toBeNull();
    expect(buttonNamed(host, "Add commit")).toBeUndefined();
    for (const label of ["Move earlier", "Move later", "Remove commit", "Assign", "Restore my grouping"]) expect(host.querySelector(`button[aria-label*="${label}"]`)).toBeNull();
  });

  it("shows the shared base select with the chosen commit once loaded", async () => {
    const { host, calls } = await mount({ base: "g" });

    expect(called(calls, "recompose_preview")[0]?.args).toEqual({ path: "/r", base: "g" });
    expect(host.querySelector('button[aria-label="Base"] .select-value')?.textContent).toContain("Older commit");
  });

  it("offers Propose as an icon-only wand button whose tooltip and name say what it does", async () => {
    const { host } = await mount();

    const button = proposeButton(host);
    expect(button?.textContent?.trim()).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Propose a grouping of these changes into commits");
    expect(button?.dataset.tip).toBe("Propose a grouping of these changes into commits");
  });

  it("proposes only when pressed and shows the plan read-only: each commit's message and the changes it holds", async () => {
    const { host, calls, propose } = await mount({ propose: { ...proposal, excluded: [".env"] } });

    await propose();

    expect(called(calls, "ai_propose_recompose")[0]?.args).toMatchObject({ path: "/r", base: "refs/remotes/origin/main" });
    expect(called(calls, "recompose_apply")).toEqual([]);
    const cards = [...host.querySelectorAll(".rgroup")];
    expect(cards.map((card) => card.querySelector(".rgroup-message")?.textContent)).toEqual(["Edit text\n\nExplain the change", "Add logo"]);
    expect(cards[0]?.querySelector(".rgroup-items")?.textContent).toContain("a.txt");
    expect(cards[0]?.textContent).toContain("whole file");
    expect(cards[1]?.textContent).toContain("logo.png");
    expect(host.textContent).toContain("Withheld from the provider because they look like secrets: .env");
    expect(host.textContent).toContain("Applying replaces the commits after");
  });

  it("applies the proposed groups exactly once on the explicit button and closes", async () => {
    const { host, calls, propose, apply, closed } = await mount();
    await propose();
    expect(apply()?.disabled).toBe(false);
    expect(apply()?.textContent?.trim()).toBe("Recompose 2 commits");

    apply()?.click();
    await flush(60);

    expect(called(calls, "recompose_apply")).toHaveLength(1);
    expect(called(calls, "recompose_apply")[0]?.args).toEqual({
      path: "/r",
      base: "refs/remotes/origin/main",
      groups: [
        { message: "Edit text\n\nExplain the change", changes: [{ kind: "file", path: "a.txt" }] },
        { message: "Add logo", changes: [{ kind: "file", path: "logo.png" }] },
      ],
    });
    expect(closed).toEqual(["closed"]);
    expect(host.querySelector(".rfoot .field-note.error")).toBeNull();
  });

  it("locks Apply while proposing and cancels the proposal through the operation, so a result that still arrives is dropped", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, calls, propose, apply } = await mount({ gate });
    await propose();

    expect(called(calls, "ai_propose_recompose")).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>('button.ai-btn[aria-busy="true"]')?.disabled).toBe(true);
    expect(proposeButton(host)).toBeUndefined();
    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Proposing a plan…");
    host.querySelector<HTMLButtonElement>('button[aria-label="Cancel proposing"]')?.click();
    await flush();
    expect(called(calls, "operation_cancel")).toHaveLength(1);
    release();
    await flush(60);
    expect(host.querySelectorAll(".rgroup")).toHaveLength(0);
    expect(apply()?.disabled).toBe(true);
  });

  it("treats a cancelled proposal as no plan and no error, and unlocks Propose and the footer reason", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, calls, propose, apply, commits } = await mount({ gate, propose: { reject: { kind: "cancelled", message: "cancelled" } } });
    await propose();
    host.querySelector<HTMLButtonElement>('button[aria-label="Cancel proposing"]')?.click();
    release();
    await flush(80);

    expect(called(calls, "operation_cancel")).toHaveLength(1);
    expect(commits()).toEqual([]);
    expect(host.querySelector(".note.danger")).toBeNull();
    expect(proposeButton(host)).toBeDefined();
    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Propose a plan with AI first");
  });

  it("keeps the plan that arrived before the cancel and offers no cancel once the proposal has settled", async () => {
    const { host, calls, propose, apply, commits } = await mount();
    await propose();

    expect(host.querySelector('button[aria-label="Cancel proposing"]')).toBeNull();
    expect(called(calls, "operation_cancel")).toEqual([]);
    expect(commits()).toEqual(["Commit 1", "Commit 2"]);
    expect(apply()?.disabled).toBe(false);
  });

  const discardNote = "The base or the commits changed, so the earlier proposal was discarded. Propose again.";
  const gated = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { gate, release };
  };

  it("does not bring a discarded plan back when the base is switched away and back", async () => {
    const { host, propose, apply, commits } = await mount();
    await propose();
    expect(commits()).toHaveLength(2);

    await choose(host, "Base", "g · Older commit");
    await choose(host, "Base", "Upstream · origin/main");

    expect(commits()).toEqual([]);
    expect(apply()?.disabled).toBe(true);
    expect(host.textContent).toContain(discardNote);
    expect(host.textContent).toContain("No plan yet");
  });

  it("ignores a proposal requested before the base was switched away and back", async () => {
    const { gate, release } = gated();
    const { host, propose, apply, commits } = await mount({ gate });
    await propose();

    await choose(host, "Base", "g · Older commit");
    await choose(host, "Base", "Upstream · origin/main");
    release();
    await flush(80);

    expect(commits()).toEqual([]);
    expect(apply()?.disabled).toBe(true);
    expect(host.textContent).toContain(discardNote);
  });

  it("ignores a successful result that arrives after Cancel, with no plan and no error", async () => {
    const { gate, release } = gated();
    const { host, propose, apply, commits } = await mount({ gate });
    await propose();

    host.querySelector<HTMLButtonElement>('button[aria-label="Cancel proposing"]')?.click();
    release();
    await flush(80);

    expect(commits()).toEqual([]);
    expect(host.querySelector(".note.danger")).toBeNull();
    expect(host.textContent).not.toContain(discardNote);
    expect(apply()?.disabled).toBe(true);
    expect(proposeButton(host)).toBeDefined();
  });

  it("keeps the earlier valid plan when a later proposal is cancelled and still succeeds", async () => {
    const second = gated();
    const later = { groups: [{ message: "Everything at once", changes: [{ kind: "file", path: "a.txt" }, { kind: "file", path: "logo.png" }] }], excluded: [] };
    const { host, propose, apply, commits } = await mount({ gate: (attempt) => (attempt === 2 ? second.gate : undefined), propose: (attempt: number) => (attempt === 1 ? proposal : later) });
    await propose();
    expect(commits()).toEqual(["Commit 1", "Commit 2"]);

    await propose();
    host.querySelector<HTMLButtonElement>('button[aria-label="Cancel proposing"]')?.click();
    second.release();
    await flush(80);

    expect(commits()).toEqual(["Commit 1", "Commit 2"]);
    expect(host.textContent).not.toContain("Everything at once");
    expect(apply()?.disabled).toBe(false);
  });

  it("blocks Propose and the Base change with a reason while the rewrite is applying", async () => {
    const { gate, release } = gated();
    const { host, calls, propose, apply, commits } = await mount({ applyGate: gate });
    await propose();

    apply()?.click();
    await flush(40);

    const wand = proposeButton(host);
    expect(wand?.getAttribute("aria-disabled")).toBe("true");
    expect(wand?.getAttribute("aria-label")).toBe("Propose a grouping of these changes into commits. Recomposing…");
    wand?.click();
    await flush(40);
    expect(called(calls, "ai_propose_recompose")).toHaveLength(1);
    const base = host.querySelector<HTMLButtonElement>('button[aria-label="Base"]');
    expect(base?.disabled).toBe(true);
    expect(base?.title).toBe("Recomposing…");
    expect(commits()).toHaveLength(2);
    release();
    await flush(60);
  });

  it("discards the plan when the base changes and asks to propose again", async () => {
    const { host, propose, apply, commits } = await mount();
    await propose();
    expect(commits()).toEqual(["Commit 1", "Commit 2"]);

    await choose(host, "Base", "g · Older commit");

    expect(commits()).toEqual([]);
    expect(apply()?.disabled).toBe(true);
    expect(host.textContent).toContain("The base or the commits changed, so the earlier proposal was discarded. Propose again.");
  });

  it("ignores a proposal that arrives after the base changed", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { host, calls, propose, apply, commits } = await mount({ gate });
    await propose();

    await choose(host, "Base", "g · Older commit");
    release();
    await flush(80);

    expect(called(calls, "ai_propose_recompose")).toHaveLength(1);
    expect(commits()).toEqual([]);
    expect(apply()?.disabled).toBe(true);
    expect(host.textContent).toContain("The base or the commits changed, so the earlier proposal was discarded. Propose again.");
  });

  it("blocks Apply for a proposal that leaves changes unassigned and says which", async () => {
    const { host, propose, apply, calls } = await mount({ propose: { groups: [{ message: "Only logo", changes: [{ kind: "file", path: "logo.png" }] }], excluded: [] } });
    await propose();

    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Changes not assigned to any commit: a.txt");
    apply()?.click();
    await flush();
    expect(called(calls, "recompose_apply")).toEqual([]);
  });

  it("names a dirty working tree as the reason Apply is blocked, before and after a proposal", async () => {
    const { host, propose, apply } = await mount({ snapshot: snapshot({ counts: { ...counts, modified: 1 } }) });
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Commit, stash, or discard your changes first");

    await propose();

    expect(apply()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toContain("Commit, stash, or discard your changes first");
  });

  it("warns in text when the range holds pushed commits", async () => {
    const { host } = await mount({ preview: preview({ pushed: true }) });

    expect(host.querySelector(".note.attention")?.textContent).toContain("Some of these commits are already on origin/main. Recomposing them means the next push needs a force push.");
  });

  it("points an unavailable AI feature at the AI settings and offers no proposal", async () => {
    const { host, opened, apply } = await mount({ features: aiFeatureList(["generate_commit", "conflict_fix"]) });

    expect(proposeButton(host)).toBeUndefined();
    expect(host.textContent).toContain("Recompose needs an AI provider");
    buttonNamed(host, "Open AI settings")?.click();
    expect(opened).toEqual(["ai"]);
    expect(apply()?.disabled).toBe(true);
  });

  it("points a missing provider at the AI settings after a failed proposal and changes nothing", async () => {
    const { host, opened, propose, calls } = await mount({ propose: { reject: { kind: "ai_not_configured", message: "Propose with AI in Recompose is turned off in Settings → AI" } } });

    await propose(60);

    expect(host.querySelector(".note.danger")?.textContent).toContain("Propose with AI in Recompose is turned off in Settings → AI. Nothing was changed.");
    buttonNamed(host, "Open AI settings")?.click();
    expect(opened).toEqual(["ai"]);
    expect(called(calls, "recompose_apply")).toEqual([]);
    expect(host.querySelectorAll(".rgroup")).toHaveLength(0);
  });

  it("shows a refusal from the core and stays open", async () => {
    const { host, propose, apply, closed } = await mount({ apply: { reject: { kind: "local_changes", message: "the working tree has changes", output: null } } });
    await propose();

    apply()?.click();
    await flush(60);

    expect(host.querySelector(".rfoot .field-note.error")?.textContent).toContain("the working tree has changes");
    expect(closed).toEqual([]);
  });
});
