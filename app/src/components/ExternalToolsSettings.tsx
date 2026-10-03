import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
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
  const path = () => app.activePath() ?? null;
  const choices = useQuery(() => ({ queryKey: [...externalToolsKey, "choices"], queryFn: () => client.externalToolsLoad() }));
  const detected = useQuery(() => ({ queryKey: [...externalToolsKey, "detected", path()], queryFn: () => client.externalToolsDetected(path()) }));
  const loaded = () => (choices.data === undefined || detected.data === undefined ? undefined : { choices: choices.data, found: detected.data });

  const choose = async (patch: Partial<ToolChoices>) => {
    const current = choices.data;
    if (current === undefined) return;
    setFailure(undefined);
    try {
      await client.externalToolsSave({ ...current, ...patch });
      await queryClient.invalidateQueries({ queryKey: externalToolsKey });
    } catch (error) {
      setFailure(message(error));
    }
  };
  const command = async (patch: { editor_command?: string; terminal_command?: string }) => {
    setFailure(await app.saveSettings({ ...app.settings(), ...patch }));
    await queryClient.invalidateQueries({ queryKey: externalToolsKey });
  };

  return (
    <>
      <h2>External tools</h2>
      <p class="setting-note">Applies to every repository. Tools are found on this Mac; a tool that is not installed is not offered.</p>
      <Show when={loaded()}>
        {(state) => (
          <>
            <SettingRow id="merge-tool" title="External merge tool" note="Opens a conflicted file with its three sides. YForge never marks the file resolved for you.">
              <Select label="External merge tool" value={state().choices.merge} options={mergeToolOptions(state().found, state().choices.merge)} onChange={(value) => void choose({ merge: value })} />
            </SettingRow>
            <SettingRow id="diff-tool" title="External diff tool" note="Opens the changes of a file. Use merge tool follows the merge tool above.">
              <Select label="External diff tool" value={state().choices.diff} options={diffToolOptions(state().found, state().choices.diff)} onChange={(value) => void choose({ diff: value })} />
            </SettingRow>
            <SettingRow id="editor" title="External editor" note="Opens the repository (⇧⌘E) or a file.">
              <Select label="External editor" value={state().choices.editor} options={editorOptions(state().found, state().choices.editor)} onChange={(value) => void choose({ editor: value })} />
            </SettingRow>
            <Show when={state().choices.editor === "custom"}>
              <SettingRow title="Custom editor command" note="The path of the file or repository is added as the last argument.">
                <TextSetting label="Custom editor command" value={app.settings().editor_command} placeholder="code -r" onCommit={(value) => void command({ editor_command: value.trim() })} />
              </SettingRow>
            </Show>
          </>
        )}
      </Show>
      <SettingRow id="terminal" title="External terminal" note="Command that opens a repository or worktree folder. Leave empty for Terminal.">
        <TextSetting label="External terminal command" value={app.settings().terminal_command} placeholder="open -a iTerm" onCommit={(value) => void command({ terminal_command: value.trim() })} />
      </SettingRow>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
    </>
  );
}
