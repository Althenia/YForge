import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { QueryClientProvider } from "@tanstack/solid-query";
import { createRoot } from "solid-js";
import { createQueryClient } from "../state/queryClient";
import { createRepoActions } from "../state/repoActions";
import { createRepoSession } from "../state/repoSession";
import { ConflictResolver } from "./ConflictResolver";
import { aiFeatureList, buttonNamed, type } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

let dispose: (() => void) | undefined;
const opened: string[] = [];
const revealed: Element[] = [];
let toolsStatus: unknown = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };

Element.prototype.scrollIntoView = function (this: Element) {
  revealed.push(this);
};

let restoreLayout: (() => void) | undefined;

beforeEach(() => {
  restoreLayout = stubScrollLayout({ viewport: 600, row: 20, total: 50 });
  revealed.length = 0;
  toolsStatus = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 1 };

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "main", sha: "a" },
    counts,
    files: [{ path: "README.md", original_path: null, area: "conflicted", status: "conflicted" }],
    operation: "merge",
    operation_detail: { current: "main", incoming: "origin/main", message: "", step: null, resolved: [] },
    remotes: [],
    stashes: [],
    ...overrides,
  }) as RepoSnapshot;

const twoRegions: ConflictFile = {
  file: "README.md",
  eol: "\n",
  final_newline: true,
  binary: false,
  sides: { base: true, current: true, incoming: true },
  segments: [
    { kind: "text", lines: ["# sample"] },
    { kind: "conflict", current: ["npm start"], incoming: ["node app.js"], base: null },
    { kind: "text", lines: ["## License"] },
    { kind: "conflict", current: ["MIT"], incoming: ["Apache"], base: ["GPL"] },
  ],
};

const marked = [
  "# sample",
  "<<<<<<< main",
  "npm start",
  "=======",
  "node app.js",
  ">>>>>>> origin/main",
  "## License",
  "<<<<<<< main",
  "MIT",
  "=======",
  "Apache",
  ">>>>>>> origin/main",
].join("\n");

async function mountResolver(conflict: ConflictFile, initial: RepoSnapshot = snapshot(), proposal: () => unknown = () => ({ regions: [] }), features = aiFeatureList()) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "ai_feature_config_list") return features;
    if (cmd === "external_tools_status") return toolsStatus;
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "conflict_file") return conflict;
    if (cmd === "ai_propose_conflict") return proposal();
    if (cmd === "repo_open") return initial;
    if (cmd === "operation_continue") return "completed";
    return null;
  });
  const queryClient = createQueryClient();
  const { session, actions } = createRoot(() => {
    const repo = createRepoSession("/r", initial, queryClient);
    return {
      session: repo,
      actions: createRepoActions(repo, {
        selectedSha: () => undefined,
        onSelectionGone: () => undefined,
        pullMode: () => "fast_forward_or_merge",
        offline: () => false,
        inspectStash: () => undefined,
        undoEntry: () => undefined,
      }),
    };
  });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <ConflictResolver session={session} actions={actions} file="README.md" onClose={() => undefined} onOpenAiSettings={() => opened.push("ai")} />
      </QueryClientProvider>
    ),
    host,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const panel = () => host.querySelector<HTMLElement>('[aria-label="Conflict resolver"]');
  const press = (key: string, init: KeyboardEventInit = {}) => panel()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const pane = (name: "Yours" | "Theirs") => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  const box = (name: "Yours" | "Theirs", conflict: number) => pane(name)?.querySelector<HTMLElement>(`[role="checkbox"][data-region="${conflict}"]`);
  const selectAll = (name: "Yours" | "Theirs") => pane(name)?.querySelector<HTMLElement>(".mt-all");
  const output = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Output"]');
  const markButton = () => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Mark resolved"));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { calls, host, press, pane, box, selectAll, output, markButton, panel, session, actions, tick };
}

describe("conflict resolver", () => {
  it("shows Yours and Theirs side by side, each titled by branch and role", async () => {
    const { host } = await mountResolver(twoRegions);

    const titles = [...host.querySelectorAll(".mt-sides .mt-title")].map((title) => title.textContent);
    expect(titles).toEqual(["Yours · main · your branch", "Theirs · origin/main · incoming"]);
    expect(host.querySelector(".rhead")?.textContent).toContain("README.md");
    expect(host.querySelector(".rhead")?.textContent).toContain("Merging origin/main into main");
  });

  it("names a rebase's panes by the rebase target and the replayed commit", async () => {
    const rebasing = snapshot({ operation: "rebase", operation_detail: { current: "main", incoming: "feature/greeting", message: "", step: { current: 1, total: 2 }, resolved: [] } });
    const { host } = await mountResolver(twoRegions, rebasing);

    const titles = [...host.querySelectorAll(".mt-sides .mt-title")].map((title) => title.textContent);
    expect(titles).toEqual(["Yours · main · rebase target", "Theirs · feature/greeting · your commit being replayed"]);
  });

  it("gives every conflict a checkbox in each pane and each pane header a Select all, the position, and named conflict controls", async () => {
    const { pane, selectAll } = await mountResolver(twoRegions);

    for (const name of ["Yours", "Theirs"] as const) {
      const boxes = [...(pane(name)?.querySelectorAll('.mt-code [role="checkbox"]') ?? [])];
      expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "false"]);
      expect(selectAll(name)?.getAttribute("role")).toBe("checkbox");
      expect(selectAll(name)?.getAttribute("aria-checked")).toBe("false");
      expect(selectAll(name)?.textContent?.trim()).toBe("Select all");
      expect(pane(name)?.querySelector(".mt-pos")?.textContent).toBe("Conflict 1 of 2");
      const nav = [...(pane(name)?.querySelectorAll<HTMLButtonElement>(".mt-nav button") ?? [])];
      expect(nav.map((button) => [button.getAttribute("aria-label"), button.dataset.shortcut, button.textContent?.trim()])).toEqual([
        ["Previous conflict", "P", ""],
        ["Next conflict", "N", ""],
      ]);
    }
    expect(pane("Yours")?.querySelector(".mt-code")?.textContent).toContain("npm start");
    expect(pane("Theirs")?.querySelector(".mt-code")?.textContent).toContain("node app.js");
  });

  it("starts with an Output holding the file with Git's markers, numbered lines, and a disabled Mark resolved that says why", async () => {
    const { output, host, markButton } = await mountResolver(twoRegions);

    expect(output()?.value).toBe(marked);
    expect(output()?.closest(".input.area")).not.toBeNull();
    expect(host.querySelector(".out-ln")?.textContent).toBe(Array.from({ length: 12 }, (_, index) => index + 1).join("\n"));
    expect(markButton()?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toBe("2 conflicts left: pick a side or remove the <<<<<<< ======= >>>>>>> markers");
  });

  it("builds the Output from the checkboxes, both sides meaning yours then theirs", async () => {
    const { box, output, selectAll, tick } = await mountResolver(twoRegions);

    box("Yours", 0)?.click();
    await tick();
    expect(box("Yours", 0)?.getAttribute("aria-checked")).toBe("true");
    expect(selectAll("Yours")?.getAttribute("aria-checked")).toBe("mixed");
    expect(output()?.value.split("\n").slice(0, 3)).toEqual(["# sample", "npm start", "## License"]);

    box("Theirs", 0)?.click();
    await tick();
    expect(output()?.value.split("\n").slice(0, 4)).toEqual(["# sample", "npm start", "node app.js", "## License"]);
  });

  it("selects a whole side with its tri-state Select all and clears it again", async () => {
    const { selectAll, output, markButton, tick } = await mountResolver(twoRegions);

    selectAll("Theirs")?.click();
    await tick();
    expect(selectAll("Theirs")?.getAttribute("aria-checked")).toBe("true");
    expect(selectAll("Yours")?.getAttribute("aria-checked")).toBe("false");
    expect(output()?.value).toBe("# sample\nnode app.js\n## License\nApache");
    expect(markButton()?.disabled).toBe(false);

    selectAll("Theirs")?.click();
    await tick();
    expect(output()?.value).toBe(marked);
  });

  it("moves both panes and the Output to the next conflict with N and keeps focus on the resolver", async () => {
    const { press, pane, output, host, panel, tick } = await mountResolver(twoRegions);

    press("n");
    await tick();

    for (const name of ["Yours", "Theirs"] as const) {
      expect(pane(name)?.querySelector(".mt-pos")?.textContent).toBe("Conflict 2 of 2");
      expect(pane(name)?.querySelector(".mt-hunk.is-cur")?.getAttribute("data-region")).toBe("1");
      expect(revealed).toContain(pane(name)?.querySelector(".mt-hunk.is-cur"));
    }
    expect(output()?.scrollTop).toBe(7 * 20);
    expect(host.querySelector<HTMLElement>(".out-ln")?.scrollTop).toBe(7 * 20);
    expect(document.activeElement).toBe(panel());

    [...(pane("Theirs")?.querySelectorAll<HTMLButtonElement>(".mt-nav button") ?? [])][0]?.click();
    await tick();
    expect(pane("Yours")?.querySelector(".mt-pos")?.textContent).toBe("Conflict 1 of 2");
    expect(output()?.scrollTop).toBe(20);
  });

  it("chooses with 1, 2, and 3, navigates with N and P, and saves the Output with the command key", async () => {
    const { press, output, calls, tick } = await mountResolver(twoRegions);

    press("2");
    press("n");
    press("3");
    await tick();
    expect(output()?.value).toBe("# sample\nnode app.js\n## License\nMIT\nApache");
    press("p");
    press("1");
    press("s", { metaKey: true });
    await tick();

    expect(calls.find((call) => call.cmd === "conflict_resolve")?.args).toEqual({ path: "/r", file: "README.md", content: "# sample\nnpm start\n## License\nMIT\nApache\n" });
  });

  it("does not save while markers remain", async () => {
    const { press, calls, tick } = await mountResolver(twoRegions);

    press("1");
    press("s", { metaKey: true });
    await tick();

    expect(calls.some((call) => call.cmd === "conflict_resolve")).toBe(false);
  });

  it("saves exactly the hand-edited Output, in the file's line endings, once no markers remain", async () => {
    const crlf: ConflictFile = { ...twoRegions, eol: "\r\n" };
    const { output, markButton, host, calls, tick } = await mountResolver(crlf);

    type(output(), "# sample\nby hand\n## License\nMIT");
    await tick();
    expect(markButton()?.disabled).toBe(false);
    expect(host.querySelector(".rfoot .reason")).toBeNull();
    markButton()?.click();
    await tick();

    expect(calls.find((call) => call.cmd === "conflict_resolve")?.args).toEqual({ path: "/r", file: "README.md", content: "# sample\r\nby hand\r\n## License\r\nMIT\r\n" });
  });

  it("rebuilds the Output from the choices when a side is picked after a hand edit, and offers Undo in place", async () => {
    const { output, box, host, tick } = await mountResolver(twoRegions);

    type(output(), "my own text");
    await tick();
    box("Yours", 1)?.click();
    await tick();

    expect(output()?.value.split("\n").slice(-2)).toEqual(["## License", "MIT"]);
    expect(output()?.value).toContain("<<<<<<< main");
    const undo = host.querySelector(".mt-out .note")?.querySelector("button");
    expect(host.querySelector(".mt-out .note")?.textContent).toContain("Rebuilt the Output from your choices");
    expect(undo?.textContent?.trim()).toBe("Undo");
    undo?.click();
    await tick();

    expect(output()?.value).toBe("my own text");
    expect(box("Yours", 1)?.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector(".mt-out .note")).toBeNull();
  });

  it("rebuilds without offering Undo when the Output was never edited by hand", async () => {
    const { box, host, tick } = await mountResolver(twoRegions);

    box("Yours", 0)?.click();
    await tick();

    expect(host.querySelector(".mt-out .note")).toBeNull();
  });

  it("ignores the choice keys while typing in the Output", async () => {
    const { output, box } = await mountResolver(twoRegions);

    output()?.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));

    expect(box("Yours", 0)?.getAttribute("aria-checked")).toBe("false");
    expect(output()?.value).toBe(marked);
  });

  it("shows the base of the current conflict when it has one", async () => {
    const { press, host, tick } = await mountResolver(twoRegions);

    expect(host.querySelector(".cbase")).toBeNull();
    press("n");
    await tick();

    expect(host.querySelector(".cbase summary")?.textContent).toBe("Show base of conflict 2");
    expect(host.querySelector(".cbase pre")?.textContent).toBe("GPL");
  });

  it("offers a whole-file choice for a binary conflict and resolves it through the core", async () => {
    const binary: ConflictFile = { ...twoRegions, binary: true, segments: [] };
    const { host, calls, tick } = await mountResolver(binary);

    expect(host.querySelector(".note")?.textContent).toMatch(/binary file/);
    buttonNamed(host, "Use incoming version")?.click();
    await tick();

    expect(calls.find((call) => call.cmd === "conflict_take_side")?.args).toEqual({ path: "/r", file: "README.md", side: "incoming" });
  });

  it("offers to accept the deletion when one side deleted the file", async () => {
    const deleted: ConflictFile = { ...twoRegions, segments: [{ kind: "text", lines: ["kept"] }], sides: { base: true, current: true, incoming: false } };
    const { host } = await mountResolver(deleted);

    const labels = [...host.querySelectorAll(".actions button")].map((button) => button.textContent);
    expect(labels).toEqual(["Use current version", "Accept incoming deletion"]);
    expect(host.querySelector(".note")?.textContent).toMatch(/origin\/main deleted this file/);
  });

  it("stages a text file whose markers are already gone through Mark resolved", async () => {
    const clean: ConflictFile = { ...twoRegions, segments: [{ kind: "text", lines: ["done"] }] };
    const { calls, markButton, tick } = await mountResolver(clean);

    expect(markButton()?.disabled).toBe(false);
    markButton()?.click();
    await tick();

    expect(calls.find((call) => call.cmd === "mark_resolved")?.args).toEqual({ path: "/r", files: ["README.md"] });
  });

  it("resets the file through the core and reloads the conflicts", async () => {
    const { host, calls, press, output, tick } = await mountResolver(twoRegions);

    press("1");
    buttonNamed(host, "Reset file")?.click();
    await tick();
    await tick();

    expect(calls.some((call) => call.cmd === "conflict_reset")).toBe(true);
    expect(calls.filter((call) => call.cmd === "conflict_file")).toHaveLength(2);
    expect(output()?.value).toBe(marked);
  });

  it("keeps Reset file in the footer's leading group, before the reason text", async () => {
    const { host } = await mountResolver(twoRegions);

    const footer = [...(host.querySelector(".rfoot")?.children ?? [])].map((child) => child.textContent?.replace(/\s+/g, " ").trim());

    expect(footer.slice(0, 3)).toEqual(["Mark resolved ⌘S", "Reset file", "2 conflicts left: pick a side or remove the <<<<<<< ======= >>>>>>> markers"]);
    expect(host.querySelector(".rfoot .spacer")).toBeNull();
  });

  describe("merge bar", () => {
    const bar = (host: HTMLElement) => host.querySelector<HTMLElement>('.rpanel section[aria-label="Finish the merge"]');

    it("states the files resolved and keeps Commit merge disabled with its reason while a file has conflicts", async () => {
      const { host } = await mountResolver(twoRegions);

      expect(bar(host)?.textContent).toContain("0 of 1 files resolved");
      const commit = bar(host) === null ? undefined : buttonNamed(bar(host)!, "Commit merge");
      expect(commit?.disabled).toBe(true);
      expect(bar(host)?.querySelector(".reason")?.textContent).toBe("Resolve 1 file first");
      expect(buttonNamed(bar(host)!, "Abort merge")?.disabled).toBe(false);
    });

    it("commits the merge through the operation's continue once every file is resolved", async () => {
      const done = snapshot({ files: [], counts: { ...counts, conflicted: 0 }, operation_detail: { current: "main", incoming: "origin/main", message: "", step: null, resolved: ["README.md", "src/app.js"] } });
      const { host, calls, tick } = await mountResolver(twoRegions, done);

      expect(bar(host)?.textContent).toContain("2 of 2 files resolved");
      const commit = buttonNamed(bar(host)!, "Commit merge");
      expect(commit?.disabled).toBe(false);
      commit?.click();
      await tick();

      expect(calls.find((call) => call.cmd === "operation_continue")?.args).toEqual({ path: "/r", message: null });
    });

    it("aborts the merge through the operation's confirmed abort", async () => {
      const { host, actions, calls, tick } = await mountResolver(twoRegions);

      buttonNamed(bar(host)!, "Abort merge")?.click();
      expect(actions.dialog()?.copy.confirmLabel).toBe("Abort merge");
      expect(calls.some((call) => call.cmd === "operation_abort")).toBe(false);
      await actions.dialog()?.run();
      await tick();

      expect(calls.find((call) => call.cmd === "operation_abort")?.args).toEqual({ path: "/r" });
    });

    it("is absent outside a merge", async () => {
      const rebasing = snapshot({ operation: "rebase", operation_detail: { current: "main", incoming: "feature/greeting", message: "", step: { current: 1, total: 2 }, resolved: [] } });
      const { host } = await mountResolver(twoRegions, rebasing);

      expect(bar(host)).toBeNull();
    });
  });

  describe("AI proposals", () => {
    const proposals = { regions: [{ index: 0, text: "npm start\nnode app.js --verbose", rationale: "Keep both run modes." }, { index: 1, text: "Apache-2.0", rationale: "Newer license wins." }] };
    const proposeButton = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "Propose a resolution for every conflict in this file");

    it("offers Propose as an icon-only wand button whose tooltip and name say what it does", async () => {
      const { host } = await mountResolver(twoRegions, snapshot(), () => proposals);
      const button = proposeButton(host);
      expect(button?.textContent?.trim()).toBe("");
      expect(button?.dataset.tip).toBe("Propose a resolution for every conflict in this file");
    });

    it("fills the Output with the proposal, shows each rationale, and changes nothing in Git", async () => {
      const { host, calls, output, tick } = await mountResolver(twoRegions, snapshot(), () => proposals);

      proposeButton(host)?.click();
      await tick();
      await tick();

      expect(calls.find((call) => call.cmd === "ai_propose_conflict")?.args).toMatchObject({ path: "/r", file: "README.md" });
      expect(output()?.value).toBe("# sample\nnpm start\nnode app.js --verbose\n## License\nApache-2.0");
      const note = host.querySelector(".mt-out .note");
      expect(note?.textContent).toContain("Conflict 1: Keep both run modes.");
      expect(note?.textContent).toContain("Conflict 2: Newer license wins.");
      expect(calls.some((call) => call.cmd === "conflict_resolve" || call.cmd === "mark_resolved")).toBe(false);
    });

    it("restores the replaced Output with Restore my text", async () => {
      const { host, output, tick } = await mountResolver(twoRegions, snapshot(), () => proposals);
      type(output(), "mine");
      await tick();

      proposeButton(host)?.click();
      await tick();
      await tick();
      buttonNamed(host, "Restore my text")?.click();
      await tick();

      expect(output()?.value).toBe("mine");
      expect(buttonNamed(host, "Restore my text")).toBeUndefined();
    });

    it("saves an accepted proposal in the file's line endings", async () => {
      const crlf: ConflictFile = { ...twoRegions, eol: "\r\n" };
      const { host, calls, tick, markButton } = await mountResolver(crlf, snapshot(), () => proposals);
      proposeButton(host)?.click();
      await tick();
      await tick();

      markButton()?.click();
      await tick();

      expect(calls.find((call) => call.cmd === "conflict_resolve")?.args).toEqual({ path: "/r", file: "README.md", content: "# sample\r\nnpm start\r\nnode app.js --verbose\r\n## License\r\nApache-2.0\r\n" });
    });

    it("hides Propose resolution while the feature is off or its provider is not ready", async () => {
      const { host, tick } = await mountResolver(twoRegions, snapshot(), () => ({ regions: [] }), aiFeatureList(["generate_commit", "recompose"]));
      await tick();

      expect(proposeButton(host)).toBeUndefined();
    });

    it("explains a missing provider and opens the AI settings", async () => {
      opened.length = 0;
      const { host, output, tick } = await mountResolver(twoRegions, snapshot(), () => Promise.reject({ kind: "ai_not_configured", message: "Propose conflict resolution is turned off in Settings → AI" }));

      proposeButton(host)?.click();
      await tick();
      await tick();

      expect(host.querySelector(".note.danger")?.textContent).toContain("Propose conflict resolution is turned off in Settings → AI. Nothing was changed.");
      expect(output()?.value).toBe(marked);
      buttonNamed(host, "Open AI settings")?.click();
      expect(opened).toEqual(["ai"]);
    });
  });

  describe("external merge tool (S54)", () => {
    const toolButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Open in external merge tool"]');

    it("opens the file in the merge tool, reloads the conflict when the tool exits, and never marks the file resolved", async () => {
      const { calls, host, tick } = await mountResolver(twoRegions);
      const loads = () => calls.filter((call) => call.cmd === "conflict_file").length;
      const before = loads();

      expect(toolButton(host)?.getAttribute("aria-disabled")).toBeNull();
      toolButton(host)?.click();
      await tick();
      await tick();

      expect(calls.find((call) => call.cmd === "open_in_merge_tool")?.args).toEqual({ path: "/r", file: "README.md" });
      expect(loads()).toBeGreaterThan(before);
      expect(calls.some((call) => call.cmd === "mark_resolved" || call.cmd === "conflict_resolve")).toBe(false);
    });

    it("keeps the control visible but aria-disabled with its reason when no merge tool is chosen", async () => {
      toolsStatus = { editor: "Visual Studio Code", diff: "FileMerge", merge: null };
      const { calls, host, tick } = await mountResolver(twoRegions);

      const button = toolButton(host);
      expect(button?.getAttribute("aria-disabled")).toBe("true");
      expect(button?.dataset.tip).toBe("Open in external merge tool. Choose an external merge tool in Settings → External tools");
      button?.click();
      await tick();
      expect(calls.some((call) => call.cmd === "open_in_merge_tool")).toBe(false);
    });
  });
});
