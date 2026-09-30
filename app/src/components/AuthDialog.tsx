import { createForm } from "@tanstack/solid-form";
import { createUniqueId, onMount, Show } from "solid-js";
import { useApp } from "../state/app";
import { credentialsReply, promptCopy, type PendingPrompt } from "../state/authModel";
import { operationLabel } from "../state/operationLabels";
import { Icon } from "./Icon";

export function AuthDialog(props: { pending: PendingPrompt }) {
  const app = useApp();
  const titleId = createUniqueId();
  let first: HTMLInputElement | undefined;
  let cancel: HTMLButtonElement | undefined;

  const prompt = () => props.pending.prompt;
  const copy = () => promptCopy(prompt(), operationLabel(props.pending.operation));
  const hostKey = () => prompt().kind === "host_key";
  const replyFor = (values: { username: string; secret: string; save: boolean }) => (hostKey() ? ({ kind: "trust" } as const) : credentialsReply(prompt(), values));
  const form = createForm(() => ({
    defaultValues: { username: props.pending.prompt.username ?? "", secret: "", save: true },
    validators: {
      onMount: ({ value }) => (replyFor(value) === undefined ? "Incomplete answer" : undefined),
      onChange: ({ value }) => (replyFor(value) === undefined ? "Incomplete answer" : undefined),
    },
    onSubmit: ({ value }) => {
      const answer = replyFor(value);
      form.reset();
      if (answer !== undefined) void app.respondAuth(prompt().id, answer);
    },
  }));
  const incomplete = form.useSelector((state) => state.errors.length > 0);

  onMount(() => (hostKey() ? cancel : first)?.focus());

  const cancelPrompt = () => void app.respondAuth(prompt().id, { kind: "cancel" });

  return (
    <div class="scrim">
      <form
        class="dialog auth-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
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
                <form.Field name="username">
                  {(field) => (
                    <input
                      type="text"
                      ref={first}
                      autocomplete="off"
                      value={field().state.value}
                      readOnly={prompt().username !== null}
                      aria-label="Username"
                      onInput={(event) => field().handleChange(event.currentTarget.value)}
                    />
                  )}
                </form.Field>
              </span>
            </label>
          </Show>
          <Show when={!hostKey()}>
            <label class="field">
              <span class="field-label">{prompt().kind === "credentials" ? "Token" : "Passphrase"}</span>
              <span class="input">
                <form.Field name="secret">
                  {(field) => (
                    <input
                      type="password"
                      ref={(element) => {
                        if (prompt().kind !== "credentials") first = element;
                      }}
                      autocomplete="off"
                      value={field().state.value}
                      aria-label={prompt().kind === "credentials" ? "Token" : "Passphrase"}
                      onInput={(event) => field().handleChange(event.currentTarget.value)}
                    />
                  )}
                </form.Field>
              </span>
            </label>
          </Show>
          <Show when={prompt().kind === "credentials"}>
            <label class="check">
              <form.Field name="save">
                {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
              </form.Field>
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
          <button type="submit" class="btn" classList={{ primary: !hostKey(), danger: hostKey() }} disabled={incomplete()}>
            {copy().primary}
          </button>
        </div>
      </form>
    </div>
  );
}
