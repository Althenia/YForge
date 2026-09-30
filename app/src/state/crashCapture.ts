import { client } from "../ipc/client";

const reported = new Set<string>();

function describe(failure: unknown): { message: string; stack: string | null } {
  if (failure instanceof Error) return { message: failure.message, stack: failure.stack ?? null };
  return { message: String(failure), stack: null };
}

export function reportCrash(kind: string, failure: unknown, view: string): void {
  const { message, stack } = describe(failure);
  const signature = `${kind}\n${message}\n${stack ?? ""}`;
  if (reported.has(signature)) return;
  reported.add(signature);
  client.crashReport({ kind, message, stack, view }).catch((problem: unknown) => console.error("crash report failed", problem));
}

export function installCrashCapture(view: () => string): () => void {
  const onError = (event: ErrorEvent) => reportCrash("error", event.error ?? event.message, view());
  const onRejection = (event: PromiseRejectionEvent) => reportCrash("unhandled_rejection", event.reason, view());
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
