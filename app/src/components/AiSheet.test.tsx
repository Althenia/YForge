import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeProposal } from "../ipc/bindings/ComposeProposal";
import type { Explanation } from "../ipc/bindings/Explanation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createAiSheet } from "../state/aiSheet";
import { AiSheet } from "./AiSheet";
import { buttonNamed, flush, mountWithApp, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
  calls = [];
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: "a".repeat(40) }, files: [], operation: null } as unknown as RepoSnapshot;
const explanation: Explanation = {
  items: [
    { path: "src/a.ts", text: "Adds the greeting." },
    { path: "src/b.ts", text: "Wires it up." },
  ],
  excluded: [".env"],
  truncated: ["big.sql"],
};
const proposal: ComposeProposal = {
  groups: [
    { message: "Add greeting", files: ["src/a.ts"] },
    { message: "Wire it up", files: ["src/b.ts", "src/c.ts"] },
  ],
  excluded: [],
  truncated: [],
};

function mount(respond: (cmd: string) => unknown) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "repo_open") return snapshot;
    return respond(cmd);
  });
  const settings: string[] = [];
  let sheet: ReturnType<typeof createAiSheet> | undefined;
  const mounted = mountWithApp(() => {
    const session = testSession("/r", snapshot);
    sheet = createAiSheet(session);
    return <AiSheet sheet={sheet} onOpenAiSettings={() => settings.push("ai")} />;
  });
  dispose = mounted.dispose;
  return { ...mounted, settings, sheet: sheet as ReturnType<typeof createAiSheet> };
}

const sheetOf = (host: HTMLElement) => host.querySelector<HTMLElement>(".ai-sheet");
const press = (button: HTMLElement | null | undefined) => button?.click();

describe("explanation sheet", () => {
  it("is absent until a request opens it", async () => {
    const { host } = mount(() => null);
    await flush();
    expect(sheetOf(host)).toBeNull();
  });

  it("shows the title, one item per file with the path in mono, the notes, and a read-only tag", async () => {
    const { host, sheet } = mount((cmd) => (cmd === "ai_explain_changes" ? explanation : null));

    void sheet.explainChanges();
    await flush(60);

    const root = sheetOf(host);
    expect(root?.getAttribute("aria-label")).toBe("Explain changes");
    expect(root?.querySelector("h2")?.textContent).toBe("Explain changes");
    expect(root?.textContent).toContain("AI explanation · read only");
    const items = [...(root?.querySelectorAll(".ai-items li") ?? [])];
    expect(items.map((item) => [item.querySelector(".ref")?.textContent, item.querySelector(".ai-text")?.textContent])).toEqual([
      ["src/a.ts", "Adds the greeting."],
      ["src/b.ts", "Wires it up."],
    ]);
    const notes = root?.querySelector(".draft-notes")?.textContent ?? "";
    expect(notes).toContain("Withheld from the provider because they look like secrets: .env");
    expect(notes).toContain("Cut to fit the size limit: big.sql");
    expect(calls.map((call) => call.cmd).filter((cmd) => cmd !== "repo_open")).toEqual(["ai_explain_changes"]);
  });

  it("names the commit in the title of an explained commit", async () => {
    const { host, sheet } = mount(() => explanation);

    void sheet.explainCommit("b".repeat(40));
    await flush(60);

    expect(sheetOf(host)?.getAttribute("aria-label")).toBe(`Explain commit ${"b".repeat(7)}`);
  });

  it("shows a running state with Cancel, and Cancel stops the request and closes the sheet", async () => {
    const { host, sheet } = mount((cmd) => (cmd === "ai_explain_changes" ? new Promise(() => undefined) : true));

    void sheet.explainChanges();
    await flush(40);

    const root = sheetOf(host);
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.querySelector('[role="status"]')?.textContent).toContain("Explaining the changes…");
    expect(root?.querySelector(".ai-items")).toBeNull();
    press(buttonNamed(root as HTMLElement, "Cancel"));
    await flush(40);

    expect(calls.find((call) => call.cmd === "operation_cancel")?.args.id).toBe(calls.find((call) => call.cmd === "ai_explain_changes")?.args.id);
    expect(sheetOf(host)).toBeNull();
  });

  it("closes with Escape and with the close button, each named and with a tooltip", async () => {
    const { host, sheet } = mount(() => explanation);
    void sheet.explainChanges();
    await flush(60);

    const root = sheetOf(host) as HTMLElement;
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(sheetOf(host)).toBeNull();

    void sheet.explainChanges();
    await flush(60);
    const close = host.querySelector<HTMLButtonElement>('.ai-sheet button[aria-label="Close"]');
    expect(close?.dataset.tip).toBe("Close");
    expect(close?.dataset.shortcut).toBe("Esc");
    press(close);
    await flush();
    expect(sheetOf(host)).toBeNull();
  });

  it("states the cause with nothing changed and a text-labelled Open AI settings button", async () => {
    const { host, sheet, settings } = mount(() => Promise.reject({ kind: "ai_not_configured", message: "Choose a provider and model for Explain changes in Settings → AI" }));

    void sheet.explainChanges();
    await flush(60);

    const alert = sheetOf(host)?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Nothing was changed.");
    const open = buttonNamed(alert as HTMLElement, "Open AI settings");
    press(open);
    expect(settings).toEqual(["ai"]);
  });

  it("offers Sign in when the sign-in was revoked", async () => {
    const { host, sheet } = mount(() => Promise.reject({ kind: "ai_auth_required", message: "Sign in to Claude Code" }));

    void sheet.explainChanges();
    await flush(60);

    expect(buttonNamed(sheetOf(host) as HTMLElement, "Sign in")).toBeDefined();
  });
});

describe("compose sheet", () => {
  const respond = (cmd: string) => (cmd === "ai_compose_commits" ? proposal : cmd === "compose_apply" ? ["c1", "c2"] : null);
  const groupRows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".ai-groups li")];
  const createButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".ai-sheet .btn.primary");

  async function open(mounted: ReturnType<typeof mount>) {
    void mounted.sheet.compose();
    await flush(60);
  }

  it("lists groups with an include checkbox, an editable message, and the files", async () => {
    const mounted = mount(respond);
    await open(mounted);
    const { host } = mounted;

    expect(sheetOf(host)?.textContent).toContain("AI draft · nothing changed yet");
    const rows = groupRows(host);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('[role="checkbox"]')?.getAttribute("aria-label")).toBe("Include commit 1");
    expect(rows[0]?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    expect(rows[1]?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message for commit 2"]')?.value).toBe("Wire it up");
    expect(rows[1]?.querySelector(".ai-files")?.textContent).toBe("src/b.ts, src/c.ts");
    expect(createButton(host)?.textContent).toContain("Create 2 commits");
    expect(sheetOf(host)?.textContent).toContain("3 files will be committed.");
  });

  it("leaves an unchecked group uncommitted and creates the rest with the edited messages as one request", async () => {
    const mounted = mount(respond);
    await open(mounted);
    const { host } = mounted;

    type(groupRows(host)[1]?.querySelector("textarea"), "Wire it up properly");
    press(groupRows(host)[0]?.querySelector<HTMLElement>('[role="checkbox"]'));
    await flush();
    expect(groupRows(host)[0]?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false");
    expect(createButton(host)?.textContent).toContain("Create 1 commit");
    expect(sheetOf(host)?.textContent).toContain("Unchecked groups stay uncommitted: src/a.ts.");

    press(createButton(host));
    await flush(80);

    const apply = calls.filter((call) => call.cmd === "compose_apply");
    expect(apply).toHaveLength(1);
    expect(apply[0]?.args).toEqual({ path: "/r", groups: [{ message: "Wire it up properly", files: ["src/b.ts", "src/c.ts"] }] });
    expect(sheetOf(host)).toBeNull();
    expect(calls.map((call) => call.cmd)).toContain("repo_open");
  });

  it("disables Create with its reason in the label while a message is blank or nothing is included", async () => {
    const mounted = mount(respond);
    await open(mounted);
    const { host } = mounted;

    type(groupRows(host)[0]?.querySelector("textarea"), "  ");
    await flush();
    expect(createButton(host)?.disabled).toBe(true);
    expect(createButton(host)?.textContent).toContain("Write a message for commit 1");

    for (const row of groupRows(host)) press(row.querySelector<HTMLElement>('[role="checkbox"]'));
    await flush();
    expect(createButton(host)?.textContent).toContain("Include at least one commit");
    press(createButton(host));
    await flush();
    expect(calls.some((call) => call.cmd === "compose_apply")).toBe(false);
  });

  it("discards the proposal without creating anything", async () => {
    const mounted = mount(respond);
    await open(mounted);

    press(buttonNamed(sheetOf(mounted.host) as HTMLElement, "Discard"));
    await flush();

    expect(sheetOf(mounted.host)).toBeNull();
    expect(calls.some((call) => call.cmd === "compose_apply")).toBe(false);
  });
});
