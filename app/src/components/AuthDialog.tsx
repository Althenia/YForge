import { createSignal, createUniqueId, onMount, Show } from "solid-js";
import { useApp } from "../state/app";
import { credentialsReply, promptCopy, type PendingPrompt } from "../state/authModel";
import { operationLabel } from "../state/operationLabels";
import { Icon } from "./Icon";

export function AuthDialog(props: { pending: PendingPrompt }) {
  const app = useApp();
  const titleId = createUniqueId();
  const [username, setUsername] = createSignal("");
  const [secret, setSecret] = createSignal("");
  const [save, setSave] = createSignal(true);
  let first: HTMLInputElement | undefined;
  let cancel: HTMLButtonElement | undefined;

  const prompt = () => props.pending.prompt;
  const copy = () => promptCopy(prompt(), operationLabel(props.pending.operation));
  const hostKey = () => prompt().kind === "host_key";
  const reply = () => (hostKey() ? ({ kind: "trust" } as const) : credentialsReply(prompt(), { username: username(), secret: secret(), save: save() }));

  onMount(() => (hostKey() ? cancel : first)?.focus());

  const cancelPrompt = () => void app.respondAuth(prompt().id, { kind: "cancel" });
  const submit = () => {
    const answer = reply();
    if (answer !== undefined) void app.respondAuth(prompt().id, answer);
  };

  return (
    <div class="scrim">
      <form
        class="dialog auth-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelPrompt();
          }
        }}
      >
        <h3 id={titleId}>
          <Icon name={copy().icon} />
          {copy().title}
        </h3>
        <div class="dialog-body">
          <p>{copy().lead}</p>
          <Show when={prompt().kind === "credentials"}>
            <label class="field">
              <span class="field-label">Username</span>
              <span class="input">
                <input
                  type="text"
                  ref={first}
                  autocomplete="off"
                  value={prompt().username ?? username()}
                  readOnly={prompt().username !== null}
                  aria-label="Username"
                  onInput={(event) => setUsername(event.currentTarget.value)}
                />
              </span>
            </label>
          </Show>
          <Show when={!hostKey()}>
            <label class="field">
              <span class="field-label">{prompt().kind === "credentials" ? "Token" : "Passphrase"}</span>
              <span class="input">
                <input
                  type="password"
                  ref={(element) => {
                    if (prompt().kind !== "credentials") first = element;
                  }}
                  autocomplete="off"
                  value={secret()}
                  aria-label={prompt().kind === "credentials" ? "Token" : "Passphrase"}
                  onInput={(event) => setSecret(event.currentTarget.value)}
                />
              </span>
            </label>
          </Show>
          <Show when={prompt().kind === "credentials"}>
            <label class="check">
              <input type="checkbox" checked={save()} onChange={(event) => setSave(event.currentTarget.checked)} />
              Save with Git credential helper
            </label>
          </Show>
          <Show when={hostKey()}>
            <div class="fingerprint">
              <span class="field-label">SHA256 fingerprint</span>
              <code>{prompt().fingerprint ?? "unavailable"}</code>
            </div>
            <p class="warn-line">
              <Icon name="warning" />
              Trusting an unknown host lets it read the credentials you send.
            </p>
          </Show>
        </div>
        <div class="foot">
          <button type="button" class="btn" ref={cancel} onClick={cancelPrompt}>
            Cancel
          </button>
          <button type="submit" class="btn" classList={{ primary: !hostKey(), danger: hostKey() }} disabled={reply() === undefined}>
            {copy().primary}
          </button>
        </div>
      </form>
    </div>
  );
}
