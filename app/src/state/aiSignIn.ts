import { useMutation, type QueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup } from "solid-js";
import type { AiSignInMethod } from "../ipc/bindings/AiSignInMethod";
import type { ProviderStatus } from "../ipc/bindings/ProviderStatus";
import { client, IpcError } from "../ipc/client";
import { nextAiId } from "./aiRun";
import { refreshProviders } from "./aiProviders";

export type SignInState =
  | { kind: "idle" }
  | { kind: "running"; method: AiSignInMethod; operation: string; device?: { url: string; code: string } }
  | { kind: "done"; status: ProviderStatus }
  | { kind: "failed"; message: string };

export function createSignIn(queryClient: QueryClient, provider: string) {
  const [status, setStatus] = createSignal<SignInState>({ kind: "idle" });
  const mutation = useMutation(
    () => ({
      mutationFn: (input: { method: AiSignInMethod; operation: string }) => client.aiSignIn(provider, input.operation, input.method),
      onSettled: () => refreshProviders(queryClient),
    }),
    () => queryClient,
  );
  const listening = client.onAiSignIn((event) => {
    const current = status();
    if (current.kind !== "running" || event.operation !== current.operation || event.stage.kind !== "device_code") return;
    setStatus({ ...current, device: { url: event.stage.url, code: event.stage.code } });
  });
  onCleanup(() => void listening.then((stop) => stop()));

  async function start(method: AiSignInMethod): Promise<void> {
    const operation = nextAiId();
    setStatus({ kind: "running", method, operation });
    try {
      setStatus({ kind: "done", status: await mutation.mutateAsync({ method, operation }) });
    } catch (failure) {
      if (failure instanceof IpcError && failure.kind === "cancelled") setStatus({ kind: "idle" });
      else setStatus({ kind: "failed", message: failure instanceof Error ? failure.message : String(failure) });
    }
  }

  function cancel(): void {
    const current = status();
    if (current.kind === "running") void client.operationCancel(current.operation).catch(() => undefined);
  }

  return { status, start, cancel, reset: () => setStatus({ kind: "idle" }) };
}
