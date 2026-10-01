import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { client } from "../ipc/client";
import { releaseNoteLines, updateFailureText } from "../state/updateModel";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

type Phase =
  | { kind: "checking" }
  | { kind: "check_failed"; message: string }
  | { kind: "up_to_date"; version: string }
  | { kind: "available"; current: string; version: string; notes: string }
  | { kind: "installing"; current: string; version: string; notes: string }
  | { kind: "install_failed"; message: string };

const asMessage = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function UpdateDialog(props: { onClose: () => void }) {
  const [phase, setPhase] = createSignal<Phase>({ kind: "checking" });
  const [running, setRunning] = createSignal("");
  let closed = false;
  let attempt = 0;
  let dialog: HTMLDivElement | undefined;
  const opener = document.activeElement;

  createEffect(on(() => phase().kind, () => dialog?.querySelector<HTMLElement>(".foot .btn")?.focus()));
  onCleanup(() => {
    if (opener instanceof HTMLElement) opener.focus();
  });

  const close = () => {
    closed = true;
    props.onClose();
  };

  async function check(): Promise<void> {
    const mine = ++attempt;
    setPhase({ kind: "checking" });
    try {
      if (running() === "") setRunning((await client.appInfo()).app_version);
      const found = await client.updateCheck();
      if (closed || mine !== attempt) return;
      setPhase(found);
    } catch (failure) {
      if (closed || mine !== attempt) return;
      setPhase({ kind: "check_failed", message: asMessage(failure) });
    }
  }

  async function install(current: Extract<Phase, { kind: "available" }>): Promise<void> {
    setPhase({ ...current, kind: "installing" });
    try {
      await client.updateInstall();
    } catch (failure) {
      if (!closed) setPhase({ kind: "install_failed", message: asMessage(failure) });
    }
  }

  onMount(() => void check());

  const title = () => {
    const current = phase();
    return current.kind === "available" || current.kind === "installing" ? `YForge ${current.version} is available` : "Check for Update";
  };

  const dismiss = () => {
    if (phase().kind !== "installing") close();
  };

  return (
    <DialogFrame title={title()} onEscape={dismiss} ref={(element) => (dialog = element)}>
      <Show when={phase().kind === "checking"}>
        <div class="status-line" role="status" aria-busy="true">
          <Icon name="sync" />
          Checking github.com/Althenia/YForge for a newer version…
        </div>
        <p class="sub">You are on YForge {running() === "" ? "…" : running()}. Nothing downloads until you choose Install and Relaunch.</p>
        <div class="foot">
          <button type="button" class="btn" onClick={close}>
            Cancel
          </button>
        </div>
      </Show>
      <Show when={phase().kind === "up_to_date"}>
        <p role="status">YForge is up to date.</p>
        <p class="sub">You are on YForge {running()}.</p>
        <div class="foot">
          <button type="button" class="btn" onClick={close}>
            Close
          </button>
        </div>
      </Show>
      <Show when={phase().kind === "available" || phase().kind === "installing"}>
        {(() => {
          const offer = () => phase() as Extract<Phase, { kind: "available" | "installing" }>;
          return (
            <>
              <p class="muted">You have {offer().current}. The update is signed with YForge's key and is checked before it installs.</p>
              <div class="update-notes">
                <strong>Release notes</strong>
                <Show when={releaseNoteLines(offer().notes).length > 0} fallback={<p class="muted">No release notes were published for this version.</p>}>
                  <ul>
                    <For each={releaseNoteLines(offer().notes)}>{(line) => <li>{line}</li>}</For>
                  </ul>
                </Show>
              </div>
              <Show
                when={phase().kind === "installing"}
                fallback={
                  <>
                    <div class="foot">
                      <button type="button" class="btn" onClick={close}>
                        Later
                      </button>
                      <button type="button" class="btn primary" onClick={() => void install(offer() as Extract<Phase, { kind: "available" }>)}>
                        Install and Relaunch
                      </button>
                    </div>
                    <p class="sub">Open repositories and tabs come back after the relaunch. Uncommitted changes stay on disk.</p>
                  </>
                }
              >
                <div class="status-line" role="status" aria-busy="true">
                  <Icon name="sync" />
                  Downloading the update and checking its signature…
                </div>
              </Show>
            </>
          );
        })()}
      </Show>
      <Show when={phase().kind === "check_failed" || phase().kind === "install_failed"}>
        {(() => {
          const failed = () => phase() as Extract<Phase, { kind: "check_failed" | "install_failed" }>;
          return (
            <>
              <div class="alert" role="alert">
                <strong>{failed().kind === "check_failed" ? "Could not check for updates" : "The update was not installed"}</strong>
                <p>{failed().kind === "check_failed" ? updateFailureText(failed().message, running() === "" ? "…" : running()) : failed().message}</p>
                <div class="acts">
                  <button type="button" class="btn sm" onClick={() => void check()}>
                    Try again
                  </button>
                </div>
              </div>
              <p class="sub">If a downloaded update fails its signature check, YForge discards it and says so here; it never installs an unsigned update.</p>
              <div class="foot">
                <button type="button" class="btn" onClick={close}>
                  Close
                </button>
              </div>
            </>
          );
        })()}
      </Show>
    </DialogFrame>
  );
}
