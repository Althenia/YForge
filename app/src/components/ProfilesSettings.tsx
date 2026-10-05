import { createSignal, For, onMount, Show } from "solid-js";
import type { Profile } from "../ipc/bindings/Profile";
import type { ProfileDraft } from "../ipc/bindings/ProfileDraft";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { authorLine, deleteProfileCopy, deleteReason, GIT_CONFIG_AUTHOR } from "../state/profilesModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { tip } from "./Tooltip";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

type Editing = { id: string | null; draft: ProfileDraft };

function ProfileForm(props: { editing: Editing; busy: boolean; onSubmit: (draft: ProfileDraft) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = createSignal(props.editing.draft.name);
  const [author, setAuthor] = createSignal(props.editing.draft.author_name);
  const [email, setEmail] = createSignal(props.editing.draft.author_email);
  const field = (label: string, value: () => string, set: (next: string) => void, placeholder: string) => (
    <label class="field">
      <span class="field-label">{label}</span>
      <span class="input">
        <input type="text" aria-label={label} value={value()} placeholder={placeholder} disabled={props.busy} onInput={(event) => set(event.currentTarget.value)} />
      </span>
    </label>
  );
  return (
    <form
      class="tool-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!props.busy) void props.onSubmit({ name: name(), author_name: author(), author_email: email() });
      }}
    >
      {field("Profile name", name, setName, "Work")}
      {field("Author name", author, setAuthor, "Ana Ruiz")}
      {field("Author email", email, setEmail, "ana@example.com")}
      <span class="tool-form-actions">
        <button type="submit" class="btn primary" disabled={props.busy} aria-busy={props.busy}>
          {props.busy ? "Saving…" : props.editing.id === null ? "Add profile" : "Save profile"}
        </button>
        <button type="button" class="btn" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}

export function ProfilesSettings() {
  const app = useApp();
  const list = app.profileList;
  const [editing, setEditing] = createSignal<Editing | undefined>();
  const [pendingDelete, setPendingDelete] = createSignal<Profile | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const [running, setRunning] = createSignal<string>();
  onMount(() => void app.loadProfiles());

  const attempt = async (label: string, run: () => Promise<unknown>): Promise<boolean> => {
    if (running() !== undefined) return false;
    setRunning(label);
    setFailure(undefined);
    try {
      await run();
      await app.loadProfiles();
      return true;
    } catch (error) {
      setFailure(message(error));
      return false;
    } finally {
      setRunning(undefined);
    }
  };
  const save = async (draft: ProfileDraft) => {
    const target = editing();
    if (target !== undefined && (await attempt("Saving profile", () => client.profileSave(target.id, draft)))) setEditing(undefined);
  };
  const confirmDelete = async () => {
    const profile = pendingDelete();
    setPendingDelete(undefined);
    if (profile !== undefined) await attempt("Deleting profile", () => client.profileDelete(profile.id));
  };
  const switchTo = async (id: string) => {
    if (running() !== undefined) return;
    setRunning("Switching profile");
    try { await app.switchProfile(id); }
    finally { setRunning(undefined); }
  };

  return (
    <>
      <h3>Profiles</h3>
      <p class="setting-note" id="setting-profiles" tabindex={-1}>
        Each profile keeps its own open tabs. While a profile is active, every commit, merge commit, and tag YForge makes uses its author, and your Git config does not change.
      </p>
      <Show when={list()}>
        {(current) => (
          <ul class="tool-list" aria-label="Profiles">
            <For each={current().profiles}>
              {(profile) => {
                const active = () => profile.id === current().active;
                const blocked = () => deleteReason(profile, current());
                return (
                  <li>
                    <span class="tool-main">
                      <span class="tool-name">
                        {profile.name}
                        <Show when={active()}>
                          <span class="chip">Active</span>
                        </Show>
                      </span>
                      <span class="tool-detail">{authorLine(profile)}</span>
                    </span>
                    <span class="recent-acts">
                      <button type="button" class="btn sm" disabled={running() !== undefined} aria-busy={running() === "Switching profile" && !active()} aria-disabled={active() ? "true" : undefined} {...(active() ? tip("This is the active profile", undefined, "Switch") : {})} onClick={() => !active() && void switchTo(profile.id)}>
                        Switch
                      </button>
                      <button type="button" class="btn sm" disabled={running() !== undefined} onClick={() => setEditing({ id: profile.id, draft: { name: profile.name, author_name: profile.author_name, author_email: profile.author_email } })}>
                        Edit
                      </button>
                      <button type="button" class="btn sm text-danger" disabled={running() !== undefined} aria-disabled={blocked() === undefined ? undefined : "true"} {...(blocked() === undefined ? {} : tip(blocked() as string, undefined, "Delete"))} onClick={() => blocked() === undefined && setPendingDelete(profile)}>
                        Delete
                      </button>
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
        )}
      </Show>
      <p class="field-note">The Default profile uses the name and email in your Git config until you give it an author. {GIT_CONFIG_AUTHOR}.</p>
      <Show
        when={editing()}
        keyed
        fallback={
          <button type="button" class="btn" disabled={running() !== undefined} onClick={() => setEditing({ id: null, draft: { name: "", author_name: "", author_email: "" } })}>
            Add profile…
          </button>
        }
      >
        {(target) => <ProfileForm editing={target} busy={running() !== undefined} onSubmit={save} onCancel={() => setEditing(undefined)} />}
      </Show>
      <Show when={running()}>{(label) => <p class="field-note" role="status" aria-busy="true"><span class="busy-spinner" aria-hidden="true" />{label()}…</p>}</Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={pendingDelete()}>{(profile) => <ConfirmDialog copy={deleteProfileCopy(profile())} onConfirm={() => void confirmDelete()} onCancel={() => setPendingDelete(undefined)} />}</Show>
    </>
  );
}
