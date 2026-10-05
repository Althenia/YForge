import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { ToolChoices } from "../ipc/bindings/ToolChoices";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { useQuery } from "../state/query";
import { diffToolOptions, editorOptions, mergeToolOptions } from "../state/settingsModel";
import { SettingRow } from "./SettingRow";
import { Select } from "./Select";
import { TextSetting } from "./TextSetting";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export const externalToolsKey = ["external-tools"] as const;

export function ExternalToolsSettings() {
  const app = useApp();
  const queryClient = useQueryClient();
  const [failure, setFailure] = createSignal<string | undefined>();
  const [extension, setExtension] = createSignal("");
  const [serverCommand, setServerCommand] = createSignal("");
  const [savingServer, setSavingServer] = createSignal(false);
  const [serverAction, setServerAction] = createSignal("");
  const [savingTools, setSavingTools] = createSignal(false);
  const busy = () => savingTools() || savingServer();
  const path = () => app.activePath() ?? null;
  const choices = useQuery(() => ({ queryKey: [...externalToolsKey, "choices"], queryFn: () => client.externalToolsLoad() }));
  const detected = useQuery(() => ({ queryKey: [...externalToolsKey, "detected", path()], queryFn: () => client.externalToolsDetected(path()) }));
  const loaded = () => (choices.data === undefined || detected.data === undefined ? undefined : { choices: choices.data, found: detected.data });

  const choose = async (patch: Partial<ToolChoices>) => {
    const current = choices.data;
    if (current === undefined || busy()) return;
    setSavingTools(true);
    setFailure(undefined);
    try {
      await client.externalToolsSave({ ...current, ...patch });
      await queryClient.invalidateQueries({ queryKey: externalToolsKey });
    } catch (error) {
      setFailure(message(error));
    } finally {
      setSavingTools(false);
    }
  };
  const command = async (patch: { editor_command?: string; terminal_command?: string }) => {
    if (busy()) return;
    setSavingTools(true);
    try {
      setFailure(await app.saveSettings({ ...app.settings(), ...patch }));
      await queryClient.invalidateQueries({ queryKey: externalToolsKey });
    } catch (error) { setFailure(message(error)); }
    finally { setSavingTools(false); }
  };
  const extensionName = () => extension().trim().replace(/^\./, "").toLowerCase();
  const serverReason = () => !/^[a-z0-9]{1,16}$/.test(extensionName()) ? "Enter a file extension of at most 16 letters or digits" : serverCommand().trim() === "" ? "Enter the installed server command" : undefined;
  const saveServer = async (next: Record<string, string>, label: string) => {
    if (busy()) return;
    setSavingServer(true);
    setServerAction(label);
    try { setFailure(await app.saveSettings({ ...app.settings(), language_servers: next })); }
    catch (error) { setFailure(message(error)); }
    finally { setSavingServer(false); }
  };
  const addServer = async () => {
    if (serverReason() !== undefined || busy()) return;
    await saveServer({ ...app.settings().language_servers, [extensionName()]: serverCommand().trim() }, "Saving language server");
    if (failure() === undefined) {
      setExtension("");
      setServerCommand("");
    }
  };
  const removeServer = (name: string) => {
    if (busy()) return;
    const next = { ...app.settings().language_servers };
    delete next[name];
    void saveServer(next, `Removing language server for .${name}`);
  };

  return (
    <>
      <h2>External tools</h2>
      <p class="setting-note">Applies to every repository. Tools are found on this Mac; a tool that is not installed is not offered.</p>
      <Show when={loaded()}>
        {(state) => (
          <>
            <SettingRow id="merge-tool" title="External merge tool" note="Opens a conflicted file with its three sides. YForge never marks the file resolved for you.">
              <Select label="External merge tool" value={state().choices.merge} options={mergeToolOptions(state().found, state().choices.merge)} disabled={busy()} disabledReason="Saving external tools" onChange={(value) => void choose({ merge: value })} />
            </SettingRow>
            <SettingRow id="diff-tool" title="External diff tool" note="Opens the changes of a file. Use merge tool follows the merge tool above.">
              <Select label="External diff tool" value={state().choices.diff} options={diffToolOptions(state().found, state().choices.diff)} disabled={busy()} disabledReason="Saving external tools" onChange={(value) => void choose({ diff: value })} />
            </SettingRow>
            <SettingRow id="editor" title="External editor" note="Opens the repository (⇧⌘E) or a file.">
              <Select label="External editor" value={state().choices.editor} options={editorOptions(state().found, state().choices.editor)} disabled={busy()} disabledReason="Saving external tools" onChange={(value) => void choose({ editor: value })} />
            </SettingRow>
            <Show when={state().choices.editor === "custom"}>
              <SettingRow title="Custom editor command" note="The path of the file or repository is added as the last argument.">
                <TextSetting label="Custom editor command" value={app.settings().editor_command} placeholder="code -r" disabled={busy()} onCommit={(value) => void command({ editor_command: value.trim() })} />
              </SettingRow>
            </Show>
          </>
        )}
      </Show>
      <SettingRow id="terminal" title="External terminal" note="Command that opens a repository or worktree folder. Leave empty for Terminal.">
        <TextSetting label="External terminal command" value={app.settings().terminal_command} placeholder="open -a iTerm" disabled={busy()} onCommit={(value) => void command({ terminal_command: value.trim() })} />
      </SettingRow>
      <SettingRow id="language-servers" title="Language servers" note="Configure an installed command for each file extension. Start it explicitly in the editor; it runs on this Mac with the repository as its workspace.">
        <div class="lsp-settings">
          <For each={Object.entries(app.settings().language_servers)}>{([name, value]) => (
            <div class="lsp-server-row"><span class="ref">.{name}</span><span class="lsp-command" title={value}>{value}</span><button type="button" class="btn sm" disabled={busy()} aria-busy={savingServer() && serverAction().endsWith(`.${name}`)} onClick={() => removeServer(name)}>Remove language server for .{name}</button></div>
          )}</For>
          <label class="input"><input type="text" aria-label="Language server extension" placeholder="rs" value={extension()} disabled={busy()} onInput={(event) => setExtension(event.currentTarget.value)} /></label>
          <label class="input"><input type="text" aria-label="Language server command" placeholder="rust-analyzer" value={serverCommand()} disabled={busy()} onInput={(event) => setServerCommand(event.currentTarget.value)} /></label>
          <button type="button" class="btn sm" disabled={serverReason() !== undefined || busy()} aria-busy={savingServer() && serverAction() === "Saving language server"} title={serverReason()} onClick={() => void addServer()}>{savingServer() && serverAction() === "Saving language server" ? "Saving…" : "Add language server"}</button>
        </div>
        <Show when={savingServer()}><p class="field-note" role="status" aria-busy="true">{serverAction()}…</p></Show>
      </SettingRow>
      <Show when={savingTools()}><p class="field-note" role="status" aria-busy="true"><span class="busy-spinner" aria-hidden="true" />Saving external tools…</p></Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
    </>
  );
}
