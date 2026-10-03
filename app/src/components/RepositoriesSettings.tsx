import { createSignal, For, Show } from "solid-js";
import { useApp } from "../state/app";
import { useNow } from "../state/clock";
import { createRepositories } from "../state/repositories";
import { folderMeta } from "../state/repositoriesModel";
import { Icon } from "./Icon";
import { FolderControls, ListChangeBar } from "./RepositoriesTab";
import { ScanFolderDialog } from "./ScanFolderDialog";
import { SettingRow } from "./SettingRow";

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/// Settings → Repositories (S46): the scanned folders, with the same Add folder, Rescan, and Stop scanning as the Launchpad.
export function RepositoriesSettings() {
  const app = useApp();
  const now = useNow();
  const repos = createRepositories();
  const [scanning, setScanning] = createSignal(false);
  const missing = () => (repos.statuses() ?? []).filter((status) => !status.exists).length;

  return (
    <>
      <h2>Repositories</h2>
      <p class="setting-note">Folders YForge scans for Git repositories to list in the Launchpad.</p>
      <h3>Scanned folders</h3>
      <SettingRow id="scanned-folders" title="Add a folder" note="Skips hidden folders, node_modules, symbolic links, and folders inside a repository. YForge only reads; nothing on disk changes.">
        <button type="button" class="btn sm" onClick={() => setScanning(true)}>
          <Icon name="plus" size={14} />
          Add folder…
        </button>
      </SettingRow>
      <ul class="fold-list" aria-label="Scanned folders">
        <For each={repos.folders()} fallback={<li class="setting-note">No scanned folders. Repositories you open still appear in the Launchpad.</li>}>
          {(folder) => (
            <li class="fold-row">
              <Icon name="folder" />
              <span class="fold-main">
                <bdi class="mono" dir="ltr">
                  {folder.path}
                </bdi>
                <span class="setting-note">{folderMeta(folder, now())}</span>
              </span>
              <FolderControls repos={repos} path={folder.path} />
            </li>
          )}
        </For>
      </ul>
      <ListChangeBar repos={repos} />
      <h3>Listed repositories</h3>
      <SettingRow
        id="listed-repositories"
        title="In the Launchpad"
        note={`${plural(repos.repos().length, "repository", "repositories")}${missing() > 0 ? `, ${missing()} not found at ${missing() === 1 ? "its" : "their"} path` : ""}. Remove one from the bar under the Launchpad's table.`}
      >
        <button type="button" class="btn sm" onClick={app.openLaunchpad}>
          <Icon name="launchpad" size={14} />
          Show repositories
        </button>
      </SettingRow>
      <Show when={scanning()}>
        <ScanFolderDialog onClose={() => setScanning(false)} onAdded={repos.added} />
      </Show>
    </>
  );
}
