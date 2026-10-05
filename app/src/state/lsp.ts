import { LSPClient, languageServerExtensions, type Transport } from "@codemirror/lsp-client";
import { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { createSignal, onCleanup } from "solid-js";
import { client } from "../ipc/client";

type Active = { id: string; connection: LSPClient; unlisten: Array<() => void> };

const message = (failure: unknown): string => failure instanceof Error ? failure.message : String(failure);

export function createLspSession(path: string, file: string, editor: () => EditorView | undefined, layer: Compartment) {
  const [status, setStatus] = createSignal<"off" | "connecting" | "ready" | "error">("off");
  const [failure, setFailure] = createSignal<string | undefined>();
  let active: Active | undefined;
  let starting = false;
  let cancelled = false;

  const stop = async () => {
    cancelled = true;
    const current = active;
    active = undefined;
    current?.connection.disconnect();
    current?.unlisten.forEach((unlisten) => unlisten());
    editor()?.dispatch({ effects: layer.reconfigure([]) });
    setStatus("off");
    if (current !== undefined) {
      try { await client.lspStop(current.id); }
      catch (error) { setFailure(message(error)); setStatus("error"); }
    }
  };

  const start = async () => {
    if (starting || active !== undefined) return;
    starting = true;
    cancelled = false;
    setFailure(undefined);
    setStatus("connecting");
    let started: Awaited<ReturnType<typeof client.lspStart>> | undefined;
    const unlisten: Array<() => void> = [];
    try {
      started = await client.lspStart(path, file);
      const session = started;
      if (cancelled) { await client.lspStop(session.id); return; }
      const handlers = new Set<(value: string) => void>();
      const fail = (reason: string) => {
        if (active?.id !== session.id) return;
        setFailure(reason);
        setStatus("error");
        void stop().then(() => { setFailure(reason); setStatus("error"); });
      };
      unlisten.push(await client.onLspMessage((event) => { if (event.id === session.id) handlers.forEach((handler) => handler(event.body)); }));
      unlisten.push(await client.onLspError((event) => { if (event.id === session.id) fail(event.body); }));
      if (cancelled) { unlisten.forEach((off) => off()); await client.lspStop(session.id); return; }
      const transport: Transport = {
        send: (value) => { void client.lspSend(session.id, value).catch((error) => fail(message(error))); },
        subscribe: (handler) => handlers.add(handler),
        unsubscribe: (handler) => handlers.delete(handler),
      };
      const connection = new LSPClient({ rootUri: session.root_uri, extensions: languageServerExtensions() });
      active = { id: session.id, connection, unlisten };
      connection.connect(transport);
      editor()?.dispatch({ effects: layer.reconfigure(connection.plugin(session.file_uri, session.language_id)) });
      void connection.initializing.then(
        () => { if (active?.id === session.id) setStatus("ready"); },
        (error) => fail(message(error)),
      );
    } catch (error) {
      const wasCancelled = cancelled;
      if (active !== undefined) await stop();
      else {
        unlisten.forEach((off) => off());
        if (started !== undefined) {
          try { await client.lspStop(started.id); }
          catch (stopError) { setFailure(message(stopError)); setStatus("error"); }
        }
      }
      if (!wasCancelled) { setFailure(message(error)); setStatus("error"); }
    } finally {
      starting = false;
    }
  };

  onCleanup(() => { void stop(); });
  return { status, failure, start, stop };
}
