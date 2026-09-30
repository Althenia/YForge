import { For, Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { statusLetter } from "../state/changes";
import type { RepoActions } from "../state/repoActions";

export function EmptyRepository(props: { snapshot: RepoSnapshot; actions: RepoActions }) {
  const files = () => props.snapshot.files.filter((file) => file.area === "untracked" || file.area === "unstaged" || file.area === "staged");
  const createFirstCommit = async () => {
    await props.actions.stageAll();
    document.querySelector<HTMLInputElement>('input[aria-label="Summary"]')?.focus();
  };
  return (
    <section class="panel empty-repo" aria-label="Empty repository">
      <div class="empty-repo-box">
        <h2>This repository has no commits yet</h2>
        <p>Stage files and create the first commit to start the history.</p>
        <Show when={files().length > 0} fallback={<p class="setting-note">Add files to this folder, then commit them.</p>}>
          <h3>Untracked files</h3>
          <ul class="empty-files">
            <For each={files()}>
              {(file) => (
                <li class="frow static">
                  <span class={`badge st-${file.status}`}>{statusLetter[file.status]}</span>
                  <span class="path">
                    <bdi dir="ltr">{file.path}</bdi>
                  </span>
                </li>
              )}
            </For>
          </ul>
          <button type="button" class="btn primary" onClick={() => void createFirstCommit()}>
            Create first commit
          </button>
        </Show>
      </div>
    </section>
  );
}
