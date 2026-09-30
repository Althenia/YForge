import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { createSignIn } from "../state/aiSignIn";
import { statusView } from "../state/aiModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

function CopyField(props: { label: string; value: string }) {
  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    await navigator.clipboard.writeText(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div class="copy-field">
      <span class="field-label">{props.label}</span>
      <span class="copy-row">
        <code class="copy-value">{props.value}</code>
        <button type="button" class="icon-btn dense" {...tip(`Copy ${props.label.toLowerCase()}`)} onClick={() => void copy()}>
          <Icon name={copied() ? "check" : "copy"} />
        </button>
        <span class="reason" role="status" aria-live="polite">
          {copied() ? "Copied" : ""}
        </span>
      </span>
    </div>
  );
}

export function SignInPanel(props: { provider: ProviderSummary; deviceCode: boolean }) {
  const queryClient = useQueryClient();
  const signIn = createSignIn(queryClient, props.provider.config.id);
  const running = () => {
    const state = signIn.status();
    return state.kind === "running" ? state : undefined;
  };
  return (
    <section class="sign-in" aria-label="Sign in">
      <h4>Sign in</h4>
      <Switch>
        <Match when={running()}>
          {(state) => (
            <div class="sign-in-run" aria-busy="true">
              <p class="setting-note">
                {state().method === "browser" ? "Waiting for you to finish signing in in your browser…" : "Waiting for the sign-in code…"}
              </p>
              <Show when={state().device}>
                {(device) => (
                  <>
                    <p class="setting-note">Open this address on any device and enter the code. YForge never sees your password.</p>
                    <CopyField label="Address" value={device().url} />
                    <CopyField label="Code" value={device().code} />
                  </>
                )}
              </Show>
              <button type="button" class="btn sm" onClick={signIn.cancel}>
                <Icon name="close" size={14} />
                Cancel sign-in
              </button>
            </div>
          )}
        </Match>
        <Match when={true}>
          <div class="hrow">
            <button type="button" class="btn sm" onClick={() => void signIn.start("browser")}>
              <Icon name="key" size={14} />
              Sign in with browser
            </button>
            <Show when={props.deviceCode}>
              <button type="button" class="btn sm" onClick={() => void signIn.start("device_code")}>
                <Icon name="terminal" size={14} />
                No browser? Use a code
              </button>
            </Show>
          </div>
          {(() => {
            const state = signIn.status();
            if (state.kind === "failed") {
              return (
                <p class="field-note error" role="alert">
                  {state.message}
                </p>
              );
            }
            if (state.kind === "done") {
              const view = statusView(state.status);
              return (
                <p class="field-note" role="status">
                  <Icon name={view.icon} /> {view.label}
                </p>
              );
            }
            return null;
          })()}
        </Match>
      </Switch>
    </section>
  );
}

export { CopyField };
