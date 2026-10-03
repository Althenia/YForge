import { createSignal } from "solid-js";

export type FileHistoryRequest = { file: string; sha?: string; view?: "diff" | "blame" };

const [pending, setPending] = createSignal<FileHistoryRequest | undefined>();

export function requestFileHistory(request: FileHistoryRequest): void {
  setPending(() => request);
}

export function takeFileHistoryRequest(): FileHistoryRequest | undefined {
  const request = pending();
  setPending(undefined);
  return request;
}
