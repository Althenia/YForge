import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { QueryClientProvider } from "@tanstack/solid-query";
import { createRoot } from "solid-js";
import { createQueryClient } from "../state/queryClient";
import { createRepoSession } from "../state/repoSession";
import { ConflictResolver } from "./ConflictResolver";

let dispose: (() => void) | undefined;
const opened: string[] = [];

Element.prototype.scrollIntoView = () => undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
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

async function mountResolver(conflict: ConflictFile, initial: RepoSnapshot = snapshot(), proposal: () => unknown = () => ({ regions: [] })) {
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "conflict_file") return conflict;
    if (cmd === "ai_propose_conflict") return proposal();
    if (cmd === "repo_open") return initial;
    return null;
  });
  const queryClient = createQueryClient();
  const session = createRoot(() => createRepoSession("/r", initial, queryClient));
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <QueryClientProvider client={queryClient}><ConflictResolver session={session} file="README.md" onClose={() => undefined} onOpenAiSettings={() => opened.push("ai")} /></QueryClientProvider>, host);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const panel = () => host.querySelector<HTMLElement>('[aria-label="Conflict resolver"]');
  const press = (key: string, init: KeyboardEventInit = {}) => panel()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  const result = () => [...host.querySelectorAll(".rline")].map((line) => `${line.querySelector(".gl")?.textContent || " "}|${line.children[2]?.textContent}`);
  const text = (selector: string) => host.querySelector(selector)?.textContent ?? "";
  return { calls, host, press, result, text, panel, tick: () => new Promise((resolve) => setTimeout(resolve, 20)) };
}

describe("conflict resolver", () => {
  it("reads the header as file, conflict k of n, and the operation, and names both panes by branch and role", async () => {
    const { text, host } = await mountResolver(twoRegions);

    expect(text(".rhead")).toContain("README.md");
    expect(text(".rhead")).toContain("conflict 1 of 2");
    expect(text(".rhead")).toContain("Merging origin/main into main");
    const heads = [...host.querySelectorAll(".panes .chead")].map((head) => head.textContent);
    expect(heads).toEqual(["Current · main · your branch", "Incoming · origin/main · incoming"]);
  });

  it("names a rebase's panes by the rebase target and the replayed commit", async () => {
    const rebasing = snapshot({ operation: "rebase", operation_detail: { current: "main", incoming: "feature/greeting", message: "", step: { current: 1, total: 2 }, resolved: [] } });
    const { host } = await mountResolver(twoRegions, rebasing);

    const heads = [...host.querySelectorAll(".panes .chead")].map((head) => head.textContent);
    expect(heads).toEqual(["Current · main · rebase target", "Incoming · feature/greeting · your commit being replayed"]);
  });

  it("starts unresolved with unresolved markers and a disabled Mark resolved that says why", async () => {
    const { result, host } = await mountResolver(twoRegions);

    expect(result()).toEqual([
      " |# sample",
      "!|<<<<<<< main",
      "C|npm start",
      " |=======",
      "I|node app.js",
      " |>>>>>>> origin/main",
      " |## License",
      "!|<<<<<<< main",
      "C|MIT",
      " |=======",
      "I|Apache",
      " |>>>>>>> origin/main",
    ]);
    const mark = [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Mark resolved"));
    expect(mark?.disabled).toBe(true);
    expect(host.querySelector(".rfoot .reason")?.textContent).toBe("Resolve 2 conflict regions first");
  });

  it("chooses with 1, 2, and 3, navigates with N and P, and saves the assembled result with the command key", async () => {
    const { press, result, calls, tick } = await mountResolver(twoRegions);

    press("2");
    press("n");
    press("3");
    expect(result()).toEqual([" |# sample", "I|node app.js", " |## License", "C|MIT", "I|Apache"]);
    press("p");
    press("1");
    expect(result().slice(0, 3)).toEqual([" |# sample", "C|npm start", " |## License"]);
    press("s", { metaKey: true });
    await tick();

    const resolve = calls.find((call) => call.cmd === "conflict_resolve");
    expect(resolve?.args).toEqual({ path: "/r", file: "README.md", content: "# sample\nnpm start\n## License\nMIT\nApache\n" });
  });

  it("does not save while a region is unresolved", async () => {
    const { press, calls, tick } = await mountResolver(twoRegions);

    press("1");
    press("s", { metaKey: true });
    await tick();

    expect(calls.some((call) => call.cmd === "conflict_resolve")).toBe(false);
  });

  it("edits a region by hand with E, then applies the text as a manual result", async () => {
    const { press, result, host, calls, tick } = await mountResolver(twoRegions);

    press("e");
    const area = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(area?.value).toBe("npm start\nnode app.js");
    if (area === null) throw new Error("no editor");
    area.value = "hand\nwritten";
    area.dispatchEvent(new InputEvent("input", { bubbles: true }));
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply edit")?.click();
    await tick();

    expect(result().slice(0, 3)).toEqual([" |# sample", " |hand", " |written"]);
    expect(host.querySelector(".actions .state")?.textContent).toContain("Manual");
    press("n");
    press("2");
    press("s", { metaKey: true });
    await tick();
    expect(calls.find((call) => call.cmd === "conflict_resolve")?.args.content).toBe("# sample\nhand\nwritten\n## License\nApache\n");
  });

  it("takes every region from one side at once", async () => {
    const { host, result } = await mountResolver(twoRegions);

    [...host.querySelectorAll("button")].find((button) => button.textContent === "Take all incoming")?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result()).toEqual([" |# sample", "I|node app.js", " |## License", "I|Apache"]);
  });

  it("ignores the choice keys while typing in the editor", async () => {
    const { press, host, result } = await mountResolver(twoRegions);

    press("e");
    host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));

    expect(result()[1]).toBe("!|<<<<<<< main");
  });

  it("offers a whole-file choice for a binary conflict and resolves it through the core", async () => {
    const binary: ConflictFile = { ...twoRegions, binary: true, segments: [] };
    const { host, calls, tick } = await mountResolver(binary);

    expect(host.querySelector(".note")?.textContent).toMatch(/binary file/);
    const use = [...host.querySelectorAll("button")].find((button) => button.textContent === "Use incoming version");
    use?.click();
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
    const { host, calls, tick } = await mountResolver(clean);

    const mark = [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Mark resolved"));
    expect(mark?.disabled).toBe(false);
    mark?.click();
    await tick();

    expect(calls.find((call) => call.cmd === "mark_resolved")?.args).toEqual({ path: "/r", files: ["README.md"] });
  });

  it("resets the file through the core and reloads the regions", async () => {
    const { host, calls, press, tick } = await mountResolver(twoRegions);

    press("1");
    [...host.querySelectorAll("button")].find((button) => button.textContent === "Reset file")?.click();
    await tick();
    await tick();

    expect(calls.some((call) => call.cmd === "conflict_reset")).toBe(true);
    expect(calls.filter((call) => call.cmd === "conflict_file")).toHaveLength(2);
    expect(host.querySelector(".rfoot .reason")?.textContent).toBe("Resolve 2 conflict regions first");
  });

  it("keeps Reset file in the footer's leading group, before the reason text, so a notice over the far corner never hides it", async () => {
    const { host } = await mountResolver(twoRegions);

    const footer = [...(host.querySelector(".rfoot")?.children ?? [])].map((child) => child.textContent?.replace(/\s+/g, " ").trim());

    expect(footer.slice(0, 3)).toEqual(["Mark resolved ⌘S", "Reset file", "Resolve 2 conflict regions first"]);
    expect(host.querySelector(".rfoot .spacer")).toBeNull();
  });

  describe("AI proposals", () => {
    const proposals = { regions: [{ index: 0, text: "npm start\nnode app.js --verbose", rationale: "Keep both run modes." }, { index: 1, text: "Apache-2.0", rationale: "Newer license wins." }] };
    const named = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s+/g, " ").trim() === label);

    it("asks for a proposal of the whole file and shows the first region's proposal with its rationale, without changing the Result", async () => {
      const { host, calls, tick, result } = await mountResolver(twoRegions, snapshot(), () => proposals);

      named(host, "Propose resolution")?.click();
      await tick();
      await tick();

      expect(calls.find((call) => call.cmd === "ai_propose_conflict")?.args).toMatchObject({ path: "/r", file: "README.md" });
      const card = host.querySelector(".proposal");
      expect(card?.textContent).toContain("Keep both run modes.");
      expect(card?.textContent).toContain("node app.js --verbose");
      expect(host.querySelector(".rtool .reason")?.textContent).toContain("2 proposals to review");
      expect(result()[1]).toBe("!|<<<<<<< main");
    });

    it("puts an accepted proposal in the Result and joins it with the file's line ending when marked resolved by hand", async () => {
      const crlf: ConflictFile = { ...twoRegions, eol: "\r\n" };
      const { host, calls, tick, result, press } = await mountResolver(crlf, snapshot(), () => proposals);
      named(host, "Propose resolution")?.click();
      await tick();
      await tick();

      named(host, "Accept")?.click();
      await tick();
      expect(result().slice(0, 4)).toEqual([" |# sample", " |npm start", " |node app.js --verbose", " |## License"]);
      expect(host.querySelector(".proposal")).toBeNull();
      expect(calls.some((call) => call.cmd === "conflict_resolve" || call.cmd === "mark_resolved")).toBe(false);

      press("n");
      await tick();
      named(host, "Accept")?.click();
      await tick();
      const mark = [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Mark resolved"));
      expect(mark?.disabled).toBe(false);
      mark?.click();
      await tick();
      expect(calls.find((call) => call.cmd === "conflict_resolve")?.args).toEqual({ path: "/r", file: "README.md", content: "# sample\r\nnpm start\r\nnode app.js --verbose\r\n## License\r\nApache-2.0\r\n" });
    });

    it("rejects a proposal and leaves the region unresolved", async () => {
      const { host, tick, result } = await mountResolver(twoRegions, snapshot(), () => proposals);
      named(host, "Propose resolution")?.click();
      await tick();
      await tick();

      named(host, "Reject")?.click();
      await tick();

      expect(host.querySelector(".proposal")).toBeNull();
      expect(result()[1]).toBe("!|<<<<<<< main");
      expect(host.querySelector(".rtool .reason")?.textContent).toContain("1 proposal to review");
    });

    it("edits a proposal before accepting it, so it lands as a manual resolution", async () => {
      const { host, tick, result } = await mountResolver(twoRegions, snapshot(), () => proposals);
      named(host, "Propose resolution")?.click();
      await tick();
      await tick();

      named(host, "Edit")?.click();
      await tick();
      const editor = host.querySelector<HTMLTextAreaElement>("textarea");
      expect(editor?.value).toBe("npm start\nnode app.js --verbose");
      editor!.value = "npm start --quiet";
      editor!.dispatchEvent(new InputEvent("input", { bubbles: true }));
      named(host, "Apply edit")?.click();
      await tick();

      expect(result().slice(0, 3)).toEqual([" |# sample", " |npm start --quiet", " |## License"]);
      expect(host.querySelector(".actions .state")?.textContent).toContain("Manual");
    });

    it("explains a missing provider and opens the AI settings", async () => {
      opened.length = 0;
      const { host, tick } = await mountResolver(twoRegions, snapshot(), () => Promise.reject({ kind: "ai_not_configured", message: "none" }));

      named(host, "Propose resolution")?.click();
      await tick();
      await tick();

      expect(host.querySelector(".note.danger")?.textContent).toContain("No AI provider is set up. Choose one in Settings → AI.");
      named(host, "Open AI settings")?.click();
      expect(opened).toEqual(["ai"]);
    });
  });
});
