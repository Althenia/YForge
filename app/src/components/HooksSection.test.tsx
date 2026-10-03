import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { HookEntry } from "../ipc/bindings/HookEntry";
import type { HookList } from "../ipc/bindings/HookList";
import type { HookOutcome } from "../ipc/bindings/HookOutcome";
import { HooksSection } from "./HooksSection";
import { buttonNamed, flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const hook = (name: string, overrides: Partial<HookEntry> = {}): HookEntry => ({
  name,
  path: `/work/app/.git/hooks/${name}`,
  active: true,
  reason: null,
  hash: `hash-${name}`,
  approved: false,
  ...overrides,
});

const listing = (hooks: HookEntry[]): HookList => ({ directory: "/work/app/.git/hooks", hooks });

const defaults: HookEntry[] = [
  hook("pre-commit"),
  hook("commit-msg", { approved: true }),
  hook("post-merge", { active: false, reason: "Not executable: Git skips this hook" }),
  hook("deploy", { active: false, reason: "Not a Git hook name" }),
];

function mount(options: { hooks?: HookEntry[]; filter?: string; message?: string; expanded?: boolean } = {}) {
  const calls: Call[] = [];
  let finish: ((outcome: HookOutcome) => void) | undefined;
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "hooks_list") return listing(options.hooks ?? defaults);
      if (cmd === "hook_read") {
        const name = String(call.args.name);
        return { hook: (options.hooks ?? defaults).find((entry) => entry.name === name), content: `#!/bin/sh\necho ${name}\n`, truncated: false };
      }
      if (cmd === "hook_approve") return null;
      if (cmd === "hook_run") return new Promise<HookOutcome>((resolve) => (finish = resolve));
      if (cmd === "operation_cancel") return true;
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => (
    <HooksSection root="/work/app" expanded={options.expanded ?? true} onToggle={() => calls.push({ cmd: "toggle", args: {} })} filter={options.filter ?? ""} commitMessage={() => options.message ?? "Fix login\n\nBody text"} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls, finish: (outcome: HookOutcome) => finish?.(outcome) };
}

const row = (host: ParentNode, name: string) => host.querySelector<HTMLElement>(`[data-nav="hook:${name}"]`) as HTMLElement;
const control = (host: ParentNode, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes(label));
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"].hook-sheet');
const runCall = (calls: Call[]) => calls.find((call) => call.cmd === "hook_run");

describe("hooks section", () => {
  it("states the hooks directory in the header and lists each hook with its state", async () => {
    const { host } = mount();
    await flush();

    const header = host.querySelector<HTMLButtonElement>("button.sec-title");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".sec-note")?.textContent).toBe(".git/hooks");
    expect(host.querySelector(".sec-note")?.getAttribute("title")).toBe("/work/app/.git/hooks");
    expect(host.querySelector(".count")?.textContent).toBe("4");
    expect(row(host, "pre-commit").getAttribute("aria-label")).toBe("Hook pre-commit, Active");
    expect(row(host, "post-merge").getAttribute("aria-label")).toBe("Hook post-merge, Inactive, Not executable: Git skips this hook");
    expect(row(host, "deploy").getAttribute("aria-label")).toBe("Hook deploy, Inactive, Not a Git hook name");
  });

  it("says when the directory holds no hooks and hides the rows while collapsed", async () => {
    const empty = mount({ hooks: [] });
    await flush();
    expect(empty.host.textContent).toContain("No hooks");
    empty.dispose();

    const collapsed = mount({ expanded: false });
    await flush();
    expect(collapsed.host.querySelector("button.sec-title")?.getAttribute("aria-expanded")).toBe("false");
    expect(collapsed.host.querySelector('[data-nav^="hook:"]')).toBeNull();
    collapsed.host.querySelector<HTMLButtonElement>("button.sec-title")?.click();
    expect(collapsed.calls.some((call) => call.cmd === "toggle")).toBe(true);
  });

  it("offers View, Run, and Test as icon controls and disables an inactive hook's Run and Test with its reason", async () => {
    const { host } = mount();
    await flush();

    for (const name of ["pre-commit", "post-merge"]) {
      for (const verb of ["View", "Run", "Test"]) expect(control(row(host, name), `${verb} ${name}`)).not.toBeNull();
    }
    expect(control(row(host, "pre-commit"), "Run pre-commit").getAttribute("aria-disabled")).toBe("false");
    for (const verb of ["Run", "Test"]) {
      const button = control(row(host, "post-merge"), `${verb} post-merge`);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.getAttribute("data-tip")).toBe("Not executable: Git skips this hook");
    }
    expect(control(row(host, "deploy"), "Run deploy").getAttribute("data-tip")).toBe("Not a Git hook name");
    control(row(host, "post-merge"), "Run post-merge").click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(sheet()).toBeNull();
  });

  it("opens an owned menu with View, Run, and Test and disables the last two for an inactive hook", async () => {
    const { host, calls } = mount();
    await flush();

    row(host, "post-merge").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 12 }));
    await flush();
    expect(["View", "Run", "Test"].map((label) => menuItem(label)?.getAttribute("aria-disabled"))).toEqual([null, "true", "true"]);
    expect(menuItem("Run")?.getAttribute("title")).toBe("Not executable: Git skips this hook");
    menuItem("Run")?.click();
    await flush();
    expect(runCall(calls)).toBeUndefined();

    row(host, "commit-msg").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 12 }));
    await flush();
    menuItem("Test")?.click();
    await flush();
    expect(runCall(calls)?.args.mode).toBe("test");
  });

  it("views the script read-only in mono with its path and state", async () => {
    const { host, calls } = mount();
    await flush();

    control(row(host, "post-merge"), "View post-merge").click();
    await flush();

    expect(calls.find((call) => call.cmd === "hook_read")?.args).toEqual({ path: "/work/app", name: "post-merge" });
    const dialog = sheet() as HTMLElement;
    expect(dialog.querySelector(".hook-script")?.tagName).toBe("PRE");
    expect(dialog.querySelector(".hook-script")?.textContent).toContain("echo post-merge");
    expect(dialog.querySelector('[aria-label="Script path"]')?.textContent).toBe("/work/app/.git/hooks/post-merge");
    expect(dialog.textContent).toContain("Inactive");
    expect(dialog.textContent).toContain("Not executable: Git skips this hook");
    expect(dialog.querySelector("textarea, input")).toBeNull();
    expect(calls.some((call) => call.cmd === "hook_run")).toBe(false);
    buttonNamed(dialog, "Close")?.click();
    await flush();
    expect(sheet()).toBeNull();
  });

  it("asks for confirmation naming the script path before the first run and runs nothing when it is declined", async () => {
    const { host, calls } = mount();
    await flush();

    control(row(host, "pre-commit"), "Run pre-commit").click();
    await flush();

    const confirm = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(confirm.textContent).toContain("/work/app/.git/hooks/pre-commit");
    expect(calls.some((call) => call.cmd === "hook_approve" || call.cmd === "hook_run")).toBe(false);
    buttonNamed(confirm, "Cancel")?.click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(calls.some((call) => call.cmd === "hook_approve" || call.cmd === "hook_run")).toBe(false);
  });

  it("approves the script then runs it with the composer's message and streams stdout and stderr into the sheet", async () => {
    const { host, calls, finish } = mount();
    await flush();

    control(row(host, "pre-commit"), "Run pre-commit").click();
    await flush();
    buttonNamed(document.querySelector('[role="alertdialog"]') as HTMLElement, "Run")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "hook_approve")?.args).toEqual({ path: "/work/app", name: "pre-commit" });
    const started = runCall(calls);
    expect(started?.args).toMatchObject({ path: "/work/app", name: "pre-commit", mode: "run", message: "Fix login\n\nBody text" });
    const id = started?.args.id;
    await emit("hook-output", { id, stream: "stdout", text: "checking\n" });
    await emit("hook-output", { id, stream: "stderr", text: "warning: slow\n" });
    await emit("hook-output", { id: "someone-else", stream: "stdout", text: "not mine\n" });
    await flush();

    const log = (sheet() as HTMLElement).querySelector('[role="log"]') as HTMLElement;
    expect([...log.querySelectorAll(".hook-line")].map((line) => [line.textContent, line.classList.contains("err")])).toEqual([
      ["checking\n", false],
      ["warning: slow\n", true],
    ]);
    expect(buttonNamed(sheet() as HTMLElement, "Stop")).toBeDefined();

    finish({ end: "exited", exit_code: 1, stops_git: true });
    await flush();
    expect((sheet() as HTMLElement).querySelector(".hook-result")?.textContent).toBe("Exit code 1. Git would stop the action.");
    expect(buttonNamed(sheet() as HTMLElement, "Stop")).toBeUndefined();
  });

  it("runs an approved hook without asking again and reports that Git would not stop on success", async () => {
    const { host, calls, finish } = mount();
    await flush();

    control(row(host, "commit-msg"), "Run commit-msg").click();
    await flush(40);

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(calls.some((call) => call.cmd === "hook_approve")).toBe(false);
    expect(runCall(calls)?.args.mode).toBe("run");
    finish({ end: "exited", exit_code: 0, stops_git: false });
    await flush();
    expect((sheet() as HTMLElement).querySelector(".hook-result")?.textContent).toBe("Exit code 0. Git would not stop the action.");
  });

  it("tests in a temporary worktree and states that nothing in the repository changed", async () => {
    const { host, calls, finish } = mount();
    await flush();

    control(row(host, "commit-msg"), "Test commit-msg").click();
    await flush(40);

    expect(runCall(calls)?.args.mode).toBe("test");
    expect((sheet() as HTMLElement).textContent).toContain("Ran in a temporary worktree; nothing in the repository changed.");
    finish({ end: "exited", exit_code: 0, stops_git: false });
    await flush();
  });

  it("stops a running hook through the operation's id and reports the stop", async () => {
    const { host, calls, finish } = mount();
    await flush();
    control(row(host, "commit-msg"), "Run commit-msg").click();
    await flush(40);

    buttonNamed(sheet() as HTMLElement, "Stop")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: runCall(calls)?.args.id });
    finish({ end: "stopped", exit_code: null, stops_git: false });
    await flush();
    expect((sheet() as HTMLElement).querySelector(".hook-result")?.textContent).toBe("Stopped.");
  });

  it("reports the time limit", async () => {
    const { host, finish } = mount();
    await flush();
    control(row(host, "commit-msg"), "Run commit-msg").click();
    await flush(40);

    finish({ end: "timed_out", exit_code: null, stops_git: false });
    await flush();

    expect((sheet() as HTMLElement).querySelector(".hook-result")?.textContent).toBe("Stopped after 120 seconds.");
  });

  it("shows the refusal from the core in the sheet", async () => {
    const calls: Call[] = [];
    mockIPC(
      (cmd, args) => {
        calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
        if (cmd === "hooks_list") return listing([hook("pre-push", { approved: true })]);
        if (cmd === "hook_read") return { hook: hook("pre-push"), content: "#!/bin/sh\n", truncated: false };
        if (cmd === "hook_run") return Promise.reject({ kind: "invalid_request", message: "main has no upstream remote, so there is no remote name and URL to give pre-push" });
        return null;
      },
      { shouldMockEvents: true },
    );
    const mounted = mountWithApp(() => <HooksSection root="/work/app" expanded filter="" onToggle={() => undefined} commitMessage={() => ""} />);
    dispose = mounted.dispose;
    await flush();

    control(row(mounted.host, "pre-push"), "Run pre-push").click();
    await flush(40);

    expect((sheet() as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain("no upstream remote");
  });

  it("filters hook rows by name or state and shows matched over total", async () => {
    const { host } = mount({ filter: "commit" });
    await flush();

    expect([...host.querySelectorAll('[data-nav^="hook:"]')].map((entry) => entry.getAttribute("data-nav"))).toEqual(["hook:pre-commit", "hook:commit-msg"]);
    expect(host.querySelector(".count")?.textContent).toBe("2/4");
  });
});
