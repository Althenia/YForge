import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { GitFlowConfig } from "../ipc/bindings/GitFlowConfig";
import { GitFlowSettings } from "./GitFlowSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

async function open(initial: GitFlowConfig | null, refuse?: string, holdInit?: () => Promise<void>) {
  let stored = initial;
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "git_flow_config") return stored;
    if (cmd === "git_flow_init") {
      if (refuse !== undefined) throw { kind: "invalid_request", message: refuse, output: null };
      if (holdInit !== undefined) return holdInit().then(() => { stored = call.args.config as GitFlowConfig; return null; });
      stored = call.args.config as GitFlowConfig;
      return null;
    }
    if (cmd === "activity_list" || cmd === "recents_list" || cmd === "repo_aliases_list") return [];
    return null;
  });
  const mounted = mountWithApp(() => <GitFlowSettings path="/repo" />);
  dispose = mounted.dispose;
  await flush(40);
  return { ...mounted, calls };
}

const input = (host: ParentNode, label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const inits = (calls: Call[]) => calls.filter((call) => call.cmd === "git_flow_init").map((call) => call.args);

describe("Git Flow settings (S57)", () => {
  it("locks Git Flow names and announces initialization while it runs", async () => {
    let finish: (() => void) | undefined;
    const { host, calls } = await open(null, undefined, () => new Promise<void>((resolve) => { finish = resolve; }));
    buttonNamed(host, "Initialize Git Flow")?.click();
    await flush();
    expect(input(host, "Production branch")?.disabled).toBe(true);
    expect(host.querySelector('button[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Initializing Git Flow");
    buttonNamed(host, "Initializing…")?.click();
    expect(inits(calls)).toHaveLength(1);
    finish?.();
    await flush(40);
    expect(input(host, "Production branch")).toBeNull();
  });
  it("offers the git-flow defaults when Git Flow is not initialized", async () => {
    const { host } = await open(null);

    expect(["Production branch", "Development branch", "Feature prefix", "Release prefix", "Hotfix prefix", "Version tag prefix"].map((label) => input(host, label)?.value)).toEqual(["main", "develop", "feature/", "release/", "hotfix/", ""]);
    expect(host.textContent).toContain("saves these names as gitflow.* in this repository's Git config");
  });

  it("initializes Git Flow with the edited names and then shows the saved configuration", async () => {
    const { host, calls } = await open(null);

    type(input(host, "Production branch"), "master");
    type(input(host, "Version tag prefix"), "v");
    buttonNamed(host, "Initialize Git Flow")?.click();
    await flush(40);

    expect(inits(calls)).toEqual([{ path: "/repo", config: { production: "master", development: "develop", feature: "feature/", release: "release/", hotfix: "hotfix/", version_tag: "v" } }]);
    expect(buttonNamed(host, "Initialize Git Flow")).toBeUndefined();
    expect([...host.querySelectorAll('[aria-label="Git Flow configuration"] dd')].map((value) => value.textContent)).toEqual(["master", "develop", "feature/", "release/", "hotfix/", "v"]);
  });

  it("shows an initialized repository's configuration and no form", async () => {
    const { host } = await open({ production: "main", development: "dev", feature: "f/", release: "r/", hotfix: "h/", version_tag: "" });

    expect(buttonNamed(host, "Initialize Git Flow")).toBeUndefined();
    expect(input(host, "Production branch")).toBeNull();
    expect([...host.querySelectorAll('[aria-label="Git Flow configuration"] dd')].map((value) => value.textContent)).toEqual(["main", "dev", "f/", "r/", "h/", "none"]);
  });

  it("shows the refusal of the core and keeps the form", async () => {
    const { host } = await open(null, "the production and development branches must differ");

    buttonNamed(host, "Initialize Git Flow")?.click();
    await flush(40);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("the production and development branches must differ");
    expect(input(host, "Production branch")?.value).toBe("main");
  });
});
