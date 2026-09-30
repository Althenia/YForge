import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient } from "@tanstack/solid-query";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderStatus } from "../ipc/bindings/ProviderStatus";
import { createSignIn } from "./aiSignIn";

afterEach(() => clearMocks());

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(signIn: (args: Record<string, unknown>) => Promise<ProviderStatus>, onCancel: () => void = () => undefined) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "ai_sign_in") return signIn((args ?? {}) as Record<string, unknown>);
      if (cmd === "operation_cancel") onCancel();
      return true;
    },
    { shouldMockEvents: true },
  );
  const state = createRoot(() => createSignIn(new QueryClient(), "p1"));
  return { calls, state };
}

describe("provider sign-in", () => {
  it("runs the browser method and reports the re-checked status when the CLI exits", async () => {
    let release: (status: ProviderStatus) => void = () => undefined;
    const { calls, state } = setup(() => new Promise<ProviderStatus>((resolve) => (release = resolve)));

    const finished = state.start("browser");
    await settle();
    expect(state.status()).toMatchObject({ kind: "running", method: "browser" });
    release({ kind: "ready" });
    await finished;

    expect(state.status()).toEqual({ kind: "done", status: { kind: "ready" } });
    expect(calls[0]).toMatchObject({ cmd: "ai_sign_in", args: { provider: "p1", method: "browser" } });
  });

  it("shows the device-code URL and code from the ai-sign-in event of its own operation only", async () => {
    let release: (status: ProviderStatus) => void = () => undefined;
    const { calls, state } = setup(() => new Promise<ProviderStatus>((resolve) => (release = resolve)));

    const finished = state.start("device_code");
    await settle();
    const operation = String(calls[0]?.args.id);
    await emit("ai-sign-in", { operation: "someone-else", provider: "p2", stage: { kind: "device_code", url: "https://other", code: "NOPE" } });
    await emit("ai-sign-in", { operation, provider: "p1", stage: { kind: "device_code", url: "https://auth.example/device", code: "ABCD-1234" } });
    await settle();

    expect(state.status()).toMatchObject({ kind: "running", method: "device_code", device: { url: "https://auth.example/device", code: "ABCD-1234" } });
    release({ kind: "ready" });
    await finished;
    expect(state.status().kind).toBe("done");
  });

  it("cancels the running sign-in through its operation id and returns to idle without an error", async () => {
    let abort: (reason: unknown) => void = () => undefined;
    const { calls, state } = setup(
      () => new Promise<ProviderStatus>((_, reject) => (abort = reject)),
      () => abort({ kind: "cancelled", message: "cancelled" }),
    );

    const finished = state.start("browser");
    await settle();
    state.cancel();
    await finished;

    expect(calls.find((call) => call.cmd === "operation_cancel")?.args.id).toBe(calls[0]?.args.id);
    expect(state.status()).toEqual({ kind: "idle" });
  });

  it("keeps a failure as a message", async () => {
    const { state } = setup(() => Promise.reject({ kind: "ai_failed", message: "codex exited with 1" }));

    await state.start("browser");

    expect(state.status()).toEqual({ kind: "failed", message: "codex exited with 1" });
  });
});
