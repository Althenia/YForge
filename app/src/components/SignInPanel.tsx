import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, Match, Show, Switch } from "solid-js";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { client } from "../ipc/client";
import { createSignIn } from "../state/aiSignIn";
import { refreshProviders } from "../state/aiProviders";
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
  const [signingOut, setSigningOut] = createSignal(false);
  const [signOutFailure, setSignOutFailure] = createSignal<string | undefined>();
  const ready = () => props.provider.status.kind === "ready";
  const primaryLabel = () =>
    ready()
      ? props.provider.config.kind === "claude"
        ? "Refresh Claude Code sign-in"
        : "Reconnect in browser"
      : props.provider.config.kind === "claude"
        ? "Read Claude Code sign-in"
        : "Sign in with browser";
  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutFailure(undefined);
    try {
      await client.aiProviderSignOut(props.provider.config.id);
      signIn.reset();
      await refreshProviders(queryClient, props.provider.config.id);
    } catch (error) {
      setSignOutFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningOut(false);
    }
  }
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
              {primaryLabel()}
            </button>
            <Show when={props.deviceCode}>
              <button type="button" class="btn sm" onClick={() => void signIn.start("device_code")}>
                <Icon name="terminal" size={14} />
                {ready() ? "Use a code" : "No browser? Use a code"}
              </button>
            </Show>
            <Show when={ready()}>
              <button type="button" class="btn sm text-danger" disabled={signingOut()} aria-busy={signingOut()} onClick={() => void signOut()}>
                Sign out
              </button>
            </Show>
          </div>
          <Show when={signOutFailure()}>
            {(text) => (
              <p class="field-note error" role="alert">
                {text()}
              </p>
            )}
          </Show>
          <Show when={props.provider.config.kind === "claude" && props.provider.status.kind === "signed_out"}>
            <p class="field-note">Sign in to Claude Code first, then read its sign-in here.</p>
          </Show>
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
