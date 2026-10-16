import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createComponent, createRenderEffect, createRoot, Suspense } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { flush, testSession } from "../components/testkit";
import { createExternalTools, EDITOR_REASON } from "./externalTools";

let calls: string[] = [];
let disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = "";
  clearMocks();
});

const toolsFor = (session: ReturnType<typeof testSession>) =>
  createRoot((dispose) => {
    disposers.push(dispose);
    return createExternalTools(session);
  });

const newSession = () => testSession("/r", { root: "/r" } as RepoSnapshot);

describe("external tools status", () => {
  it("shares one status read between views of a repository", async () => {
    calls = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return cmd === "external_tools_status" ? { editor: null, diff: "FileMerge", merge: null } : null;
    });
    const session = newSession();
    const first = toolsFor(session);
    const second = toolsFor(session);
    await flush();

    expect(calls.filter((cmd) => cmd === "external_tools_status")).toHaveLength(1);
    expect(first.editorReason()).toBe(EDITOR_REASON);
    expect(second.editorReason()).toBe(EDITOR_REASON);
    expect(first.diffReason()).toBeUndefined();
    expect(second.mergeReason()).toBeDefined();
  });

  it("gives no reason while pending and after a failed read", async () => {
    mockIPC(() => new Promise(() => undefined));
    const pending = toolsFor(newSession());
    expect(pending.editorReason()).toBeUndefined();
    expect(pending.diffReason()).toBeUndefined();
    expect(pending.mergeReason()).toBeUndefined();

    clearMocks();
    mockIPC(() => {
      throw { kind: "invalid_request", message: "no status", output: null };
    });
    const failed = toolsFor(newSession());
    await flush();
    expect(failed.editorReason()).toBeUndefined();
    expect(failed.diffReason()).toBeUndefined();
    expect(failed.mergeReason()).toBeUndefined();
  });

  it("never shows an enclosing Suspense fallback while the status is pending", async () => {
    mockIPC(() => new Promise(() => undefined));
    const session = newSession();
    const host = document.createElement("div");
    document.body.append(host);
    disposers.push(
      render(
        () =>
          createComponent(Suspense, {
            fallback: "fallback",
            get children() {
              const tools = toolsFor(session);
              const reason = document.createElement("span");
              createRenderEffect(() => {
                reason.textContent = tools.editorReason() ?? "none";
              });
              return reason;
            },
          }),
        host,
      ),
    );
    await flush();

    expect(host.textContent).toBe("none");
  });
});
