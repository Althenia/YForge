import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { FolderScan } from "../ipc/bindings/FolderScan";
import type { Repositories } from "../ipc/bindings/Repositories";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import { client } from "../ipc/client";
import { basename } from "../format";
import { addButtonText, addedText, DEFAULT_DEPTH, DEPTH_CHOICES, nothingFoundText, scanSummary } from "../state/repositoriesModel";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";
import { Select } from "./Select";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

/// Add folder…: pick a folder and a depth, review what the read-only scan found, and add the ticked repositories.
export function ScanFolderDialog(props: { onClose: () => void; onAdded: (next: Repositories, text: string, folder: ScannedFolder) => void }) {
  const [path, setPath] = createSignal("");
  const [depth, setDepth] = createSignal(DEFAULT_DEPTH);
  const [scanning, setScanning] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | undefined>();
  const [result, setResult] = createSignal<FolderScan | undefined>();
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set());
  const opener = document.activeElement;
  let field: HTMLInputElement | undefined;
  let attempt = 0;

  onMount(() => field?.focus());
  onCleanup(() => {
    attempt += 1;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  });

  const fresh = () => result()?.found.filter((repo) => !repo.listed) ?? [];

  async function scan(levels = depth()): Promise<void> {
    const root = path().trim();
    if (root === "" || scanning()) return;
    const mine = ++attempt;
    setDepth(levels);
    setProblem(undefined);
    setScanning(true);
    try {
      const found = await client.folderScan(root, levels);
      if (mine !== attempt) return;
      setResult(found);
      setPicked(new Set(found.found.filter((repo) => !repo.listed).map((repo) => repo.path)));
    } catch (failure) {
      if (mine === attempt) setProblem(message(failure));
    } finally {
      if (mine === attempt) setScanning(false);
    }
  }

  async function choose(): Promise<void> {
    const folder = await client.pickFolder("Choose a folder to scan");
    if (folder === undefined) return;
    setPath(folder);
    setProblem(undefined);
  }

  async function add(): Promise<void> {
    const found = result();
    if (found === undefined || picked().size === 0 || saving()) return;
    const repos = found.found.filter((repo) => picked().has(repo.path)).map((repo) => repo.path);
    const folder: ScannedFolder = {
      path: found.root,
      depth: found.depth,
      scanned_at: Math.floor(Date.now() / 1000),
      repos,
      skipped: fresh().filter((repo) => !picked().has(repo.path)).map((repo) => repo.path),
    };
    setSaving(true);
    setProblem(undefined);
    try {
      const next = await client.scanFolderSave(folder);
      props.onAdded(next, addedText(found.root, repos.length), folder);
      props.onClose();
    } catch (failure) {
      setProblem(message(failure));
    } finally {
      setSaving(false);
    }
  }

  const toggle = (repoPath: string) => {
    const next = new Set(picked());
    if (next.has(repoPath)) next.delete(repoPath);
    else next.add(repoPath);
    setPicked(next);
  };

  const back = () => {
    attempt += 1;
    setResult(undefined);
    setScanning(false);
    queueMicrotask(() => field?.focus());
  };

  return (
    <DialogFrame title="Add a folder to scan" onEscape={props.onClose}>
      <div class="scan-dialog">
        <Switch>
          <Match when={result() === undefined}>
            <p class="setting-note">YForge looks for Git repositories inside this folder and lists them in the Launchpad.</p>
            <label class="field">
              <span class="field-label">Folder</span>
              <span class="field-row">
                <span class="input" classList={{ invalid: problem() !== undefined }}>
                  <input
                    ref={field}
                    type="text"
                    aria-label="Folder to scan"
                    aria-invalid={problem() !== undefined}
                    placeholder="/Users/you/Code"
                    spellcheck={false}
                    disabled={scanning()}
                    value={path()}
                    onInput={(event) => {
                      setPath(event.currentTarget.value);
                      setProblem(undefined);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void scan();
                      }
                    }}
                  />
                </span>
                <button type="button" class="btn" disabled={scanning()} onClick={() => void choose()}>
                  <Icon name="folder" />
                  Choose…
                </button>
              </span>
            </label>
            <div class="field">
              <span class="field-label">Look inside</span>
              <Select label="Levels of folders to look inside" value={String(depth())} options={DEPTH_CHOICES} disabled={scanning()} onChange={(value) => setDepth(Number(value))} />
            </div>
            <p class="field-note">
              <Icon name="lock" size={14} />
              Skips hidden folders, node_modules, symbolic links, and folders inside a repository. YForge only reads; nothing on disk changes.
            </p>
            <Show when={scanning()}>
              <p class="field-note" role="status" aria-busy="true">
                <Icon name="sync" size={14} />
                Scanning {path().trim()} …
              </p>
            </Show>
          </Match>
          <Match when={result()}>
            {(found) => (
              <Show
                when={found().found.length > 0}
                fallback={
                  <div class="scan-empty" role="status">
                    <Icon name="folder" />
                    <strong>No Git repositories in {found().root}</strong>
                    <span>{nothingFoundText(found().root, found().checked, found().depth, found().capped)}</span>
                  </div>
                }
              >
                <p class="field-note" role="status">
                  {scanSummary(found().found.length, found().root, found().checked, found().depth, found().capped)}
                </p>
                <ul class="scan-list" aria-label="Repositories found">
                  <For each={found().found}>
                    {(repo) => (
                      <li classList={{ listed: repo.listed }}>
                        <Show
                          when={!repo.listed}
                          fallback={
                            <span class="scan-tick">
                              <Icon name="check" size={14} />
                            </span>
                          }
                        >
                          <input type="checkbox" aria-label={`Add ${basename(repo.path)}`} checked={picked().has(repo.path)} onChange={() => toggle(repo.path)} />
                        </Show>
                        <span class="scan-repo">
                          <strong>{basename(repo.path)}</strong>
                          <span class="path-line mono" title={repo.path}>
                            <bdi dir="ltr">{repo.path}</bdi>
                          </span>
                        </span>
                        <span class="scan-meta">{repo.listed ? "Already listed" : (repo.branch ?? "")}</span>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={fresh().length > 0}>
                  <p class="field-note">Repositories you leave unticked are skipped by later rescans.</p>
                </Show>
              </Show>
            )}
          </Match>
        </Switch>
        <Show when={problem()}>
          {(text) => (
            <p class="field-note error" role="alert">
              {text()}
            </p>
          )}
        </Show>
        <div class="foot">
          <Show
            when={result()}
            fallback={
              <>
                <button type="button" class="btn" onClick={props.onClose}>
                  Cancel
                </button>
                <button type="button" class="btn primary" disabled={path().trim() === "" || scanning()} aria-busy={scanning()} onClick={() => void scan()}>
                  <Icon name="search" />
                  Scan
                </button>
              </>
            }
          >
            {(found) => (
              <>
                <button type="button" class="btn" onClick={back}>
                  Back
                </button>
                <Show
                  when={found().found.length > 0}
                  fallback={
                    <Show when={found().depth < 5}>
                      <button type="button" class="btn primary" aria-busy={scanning()} onClick={() => void scan(found().depth + 1)}>
                        <Icon name="search" />
                        Look {found().depth + 1} levels deep
                      </button>
                    </Show>
                  }
                >
                  <button type="button" class="btn primary" disabled={picked().size === 0 || saving()} title={picked().size === 0 ? "Tick at least one repository" : undefined} onClick={() => void add()}>
                    <Icon name="plus" />
                    {addButtonText(picked().size)}
                  </button>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </DialogFrame>
  );
}
