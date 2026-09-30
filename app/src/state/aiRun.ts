import { useMutation, type QueryClient } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { client } from "../ipc/client";
import { aiFailure, type AiFailure } from "./aiModel";

let sequence = 0;

export const nextAiId = (): string => `ai-${Date.now()}-${(sequence += 1)}`;

export function createAiRun<T>(queryClient: QueryClient, call: (id: string) => Promise<T>) {
  const [operation, setOperation] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<AiFailure | undefined>();
  const mutation = useMutation(
    () => ({
      mutationFn: async () => {
        const id = nextAiId();
        setOperation(id);
        try {
          return await call(id);
        } finally {
          setOperation(undefined);
        }
      },
    }),
    () => queryClient,
  );

  async function start(): Promise<T | undefined> {
    setFailure(undefined);
    try {
      return await mutation.mutateAsync();
    } catch (error) {
      setFailure(aiFailure(error));
      return undefined;
    }
  }

  function cancel(): void {
    const id = operation();
    if (id !== undefined) void client.operationCancel(id).catch(() => undefined);
  }

  return { running: () => mutation.isPending, start, cancel, failure, dismiss: () => setFailure(undefined) };
}
