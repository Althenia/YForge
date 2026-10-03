import { createEffect, For, onMount, Show } from "solid-js";
import type { HookEntry } from "../ipc/bindings/HookEntry";
import type { HookMode } from "../ipc/bindings/HookMode";
import { client } from "../ipc/client";
import { createHookRunner, hookStateWord, outcomeText, runVerb, TEST_NOTE } from "../state/hooks";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { DialogFrame } from "./DialogFrame";

export type HookSheetRequest = { hook: HookEntry; run?: { mode: HookMode; message: string } };

export function HookSheet(props: { root: string; request: HookSheetRequest; onClose: () => void }) {
  const hook = () => props.request.hook;
  const script = useQuery(() => ({ queryKey: repoKeys.read(props.root, "hook", hook().name, hook().hash), queryFn: () => client.hookRead(props.root, hook().name) }));
  const runner = createHookRunner(props.root);
  const running = () => runner.phase().kind === "running";
  let log: HTMLDivElement | undefined;

  onMount(() => {
    const run = props.request.run;
    if (run !== undefined) void runner.start(hook().name, run.mode, run.message);
  });

  createEffect(() => {
    runner.lines();
    if (log !== undefined) log.scrollTop = log.scrollHeight;
  });

  const close = () => {
    if (running()) runner.stop();
    props.onClose();
  };

  const title = () => {
    const run = props.request.run;
    return run === undefined ? hook().name : `${runVerb(run.mode)} ${hook().name}`;
  };

  return (
    <DialogFrame title={title()} onEscape={close} ref={(dialog) => dialog.classList.add("hook-sheet")}>
      <div class="hook-meta">
        <span class="chip" classList={{ "chip-success": hook().active }}>
          {hookStateWord(hook())}
        </span>
        <Show when={hook().reason}>{(reason) => <span class="hook-reason">{reason()}</span>}</Show>
      </div>
      <p class="hook-path" aria-label="Script path">
        {hook().path}
      </p>
      <pre class="hook-script" tabindex="0" aria-label="Script">
        {script.isSuccess ? script.data?.content : script.isError ? "The script could not be read." : "Loading…"}
      </pre>
      <Show when={script.data?.truncated}>
        <p class="hook-note">Only the first 512 KiB of the script is shown.</p>
      </Show>
      <Show when={props.request.run}>
        {(run) => (
          <>
            <Show when={run().mode === "test"}>
              <p class="hook-note">{TEST_NOTE}</p>
            </Show>
            <div class="hook-output" role="log" aria-label="Output" aria-live="polite" ref={log} tabindex="0">
              <For each={runner.lines()}>{(line) => <span class="hook-line" classList={{ err: line.stream === "stderr" }}>{line.text}</span>}</For>
            </div>
            <Show when={runner.phase()} keyed>
              {(phase) => (
                <>
                  <Show when={phase.kind === "running"}>
                    <p class="hook-note" role="status">
                      Running…
                    </p>
                  </Show>
                  <Show when={phase.kind === "done" ? phase.outcome : undefined}>
                    {(outcome) => (
                      <p class="hook-result" classList={{ bad: outcome().stops_git }} role="status">
                        {outcomeText(outcome())}
                      </p>
                    )}
                  </Show>
                  <Show when={phase.kind === "failed" ? phase.message : undefined}>
                    {(message) => (
                      <p class="hook-result bad" role="alert">
                        {message()}
                      </p>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </>
        )}
      </Show>
      <div class="foot">
        <Show when={running()}>
          <button type="button" class="btn danger" onClick={runner.stop}>
            Stop
          </button>
        </Show>
        <button type="button" class="btn" onClick={close}>
          Close
        </button>
      </div>
    </DialogFrame>
  );
}
