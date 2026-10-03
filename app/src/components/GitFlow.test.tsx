import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { FlowFinished } from "../ipc/bindings/FlowFinished";
import type { GitFlowConfig } from "../ipc/bindings/GitFlowConfig";
import { CONFLICT_NOTICE } from "../state/gitFlow";
import { GitFlowSection } from "./GitFlowSection";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const config: GitFlowConfig = { production: "main", development: "develop", feature: "feature/", release: "release/", hotfix: "hotfix/", version_tag: "v" };

type Options = { config?: GitFlowConfig | null; head?: string; filter?: string; expanded?: boolean; start?: (call: Call) => unknown; finish?: FlowFinished };

function mount(options: Options = {}) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "git_flow_config") return options.config === undefined ? config : options.config;
    if (cmd === "git_flow_start") return options.start?.(call) ?? `${config.feature}${String(call.args.name)}`;
    if (cmd === "git_flow_finish") return options.finish ?? { outcome: "completed", branch: options.head, tag: null };
    return null;
  });
  const mounted = mountWithApp(() => (
    <GitFlowSection root="/work/app" head={options.head ?? "develop"} expanded={options.expanded ?? true} onToggle={() => calls.push({ cmd: "toggle", args: {} })} filter={options.filter ?? ""} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls };
}

const rows = (host: ParentNode) => [...host.querySelectorAll('[data-nav^="flow:"]')].map((row) => row.getAttribute("aria-label"));
const row = (host: ParentNode, label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`) as HTMLElement;

describe("git flow section", () => {
  it("is absent until Git Flow is initialized", async () => {
    const { host } = mount({ config: null });
    await flush();

    expect(host.querySelector('section[aria-label="Git Flow"]')).toBeNull();
  });

  it("offers Start feature, release, and hotfix when initialized and Finish only on a flow branch", async () => {
    const onDevelop = mount();
    await flush();
    expect(onDevelop.host.querySelector("button.sec-title")?.getAttribute("aria-expanded")).toBe("true");
    expect(rows(onDevelop.host)).toEqual(["Start feature…", "Start release…", "Start hotfix…"]);
    expect(onDevelop.host.querySelector(".count")?.textContent).toBe("3");
    onDevelop.dispose();

    const onFeature = mount({ head: "feature/login" });
    await flush();
    expect(rows(onFeature.host)).toEqual(["Start feature…", "Start release…", "Start hotfix…", "Finish feature login"]);
    expect(onFeature.host.querySelector(".count")?.textContent).toBe("4");
  });

  it("starts a branch from a name dialog and closes it", async () => {
    const { host, calls } = mount();
    await flush();

    row(host, "Start release…").click();
    await flush();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.querySelector("h3")?.textContent).toBe("Start release…");
    expect(dialog.textContent).toContain("Creates release/<name> from develop and checks it out");
    type(dialog.querySelector<HTMLInputElement>('input[aria-label="Release name"]'), "1.0");
    await flush();
    expect(dialog.textContent).toContain("release/1.0");
    buttonNamed(dialog, "Start")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "git_flow_start")?.args).toEqual({ path: "/work/app", kind: "release", name: "1.0" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open with the core's message when starting fails", async () => {
    const calls: Call[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "git_flow_config") return config;
      if (cmd === "git_flow_start") return Promise.reject({ kind: "invalid_request", message: "a branch named feature/login already exists" });
      return null;
    });
    const mounted = mountWithApp(() => <GitFlowSection root="/work/app" head="develop" expanded onToggle={() => undefined} filter="" />);
    dispose = mounted.dispose;
    await flush();

    row(mounted.host, "Start feature…").click();
    await flush();
    type(document.querySelector<HTMLInputElement>('input[aria-label="Feature name"]'), "login");
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain("already exists");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("starts a hotfix with the hotfix kind", async () => {
    const { host, calls } = mount();
    await flush();

    row(host, "Start hotfix…").click();
    await flush();
    type(document.querySelector<HTMLInputElement>('input[aria-label="Hotfix name"]'), "1.0.1");
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(calls.find((call) => call.cmd === "git_flow_start")?.args).toEqual({ path: "/work/app", kind: "hotfix", name: "1.0.1" });
  });

  it("finishes the current flow branch through the core", async () => {
    const { host, calls, app } = mount({ head: "feature/login" });
    await flush();

    row(host, "Finish feature login").click();
    await flush();

    expect(calls.find((call) => call.cmd === "git_flow_finish")?.args).toEqual({ path: "/work/app" });
    expect(app.notice()).toBeUndefined();
  });

  it("reports a conflicting finish as stopped with nothing deleted", async () => {
    const { host, app } = mount({ head: "release/1.0", finish: { outcome: "conflicts", branch: "release/1.0", tag: null } });
    await flush();

    row(host, "Finish release 1.0").click();
    await flush();

    expect(app.notice()).toBe(CONFLICT_NOTICE);
    expect(CONFLICT_NOTICE).toContain("Nothing was deleted");
  });

  it("shows the core's refusal of a finish", async () => {
    const calls: Call[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "git_flow_config") return config;
      if (cmd === "git_flow_finish") return Promise.reject({ kind: "local_changes", message: "Finishing needs a clean working tree; commit or stash your changes first." });
      return null;
    });
    const mounted = mountWithApp(() => <GitFlowSection root="/work/app" head="feature/login" expanded onToggle={() => undefined} filter="" />);
    dispose = mounted.dispose;
    await flush();

    row(mounted.host, "Finish feature login").click();
    await flush();

    expect(mounted.app.notice()).toContain("clean working tree");
  });

  it("filters the flow rows and shows matched over total", async () => {
    const { host } = mount({ head: "feature/login", filter: "finish" });
    await flush();

    expect(rows(host)).toEqual(["Finish feature login"]);
    expect(host.querySelector(".count")?.textContent).toBe("1/4");
  });

  it("hides the rows when collapsed and reports the toggle", async () => {
    const { host, calls } = mount({ expanded: false });
    await flush();

    expect(host.querySelector("button.sec-title")?.getAttribute("aria-expanded")).toBe("false");
    expect(rows(host)).toEqual([]);
    host.querySelector<HTMLButtonElement>("button.sec-title")?.click();
    expect(calls.some((call) => call.cmd === "toggle")).toBe(true);
  });
});
