import { createMemo, createSignal, For, Show } from "solid-js";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { useNow } from "../state/clock";
import type { RepositoriesState } from "../state/repositories";
import {
  branchText,
  filterRepositories,
  folderMeta,
  groupRepositories,
  openedText,
  repoStateParts,
  repoStateText,
  repositoryRows,
  SORT_CHOICES,
  sortRepositories,
  type RepoRow,
  type RepoSort,
} from "../state/repositoriesModel";
import { relativeAge } from "../format";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { tip } from "./Tooltip";

const rowId = (path: string): string => `repo-${path.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export function ListChangeBar(props: { repos: RepositoriesState }) {
  return (
    <>
      <Show when={props.repos.change()}>
        {(change) => (
          <div class="list-change" role="status">
            <Icon name="check" size={14} />
            <span>{change().text}</span>
            <Show when={change().undo}>
              <button type="button" class="btn sm" onClick={() => void props.repos.undoChange()}>
                <Icon name="undo" size={14} />
                Undo
              </button>
            </Show>
            <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={props.repos.dismissChange}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </Show>
      <Show when={props.repos.failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
    </>
  );
}

export function FolderControls(props: { repos: RepositoriesState; path: string }) {
  return (
    <>
      <button type="button" class="icon-btn dense" {...tip(`Rescan ${props.path}`)} onClick={() => void props.repos.rescan(props.path)}>
        <Icon name="sync" size={14} />
      </button>
      <button
        type="button"
        class="icon-btn dense"
        {...tip(`Stop scanning ${props.path}. Its repositories leave the list unless you opened them; nothing on disk changes.`, undefined, `Stop scanning ${props.path}`)}
        onClick={() => void props.repos.stopScanning(props.path)}
      >
        <Icon name="close" size={14} />
      </button>
    </>
  );
}

/// The Launchpad's Repositories tab (S41, S46): folder chips, a table grouped by folder, and the selected row's actions.
export function RepositoriesTab(props: { repos: RepositoriesState; onAddFolder: () => void }) {
  const app = useApp();
  const now = useNow();
  const [query, setQuery] = createSignal("");
  const [sort, setSort] = createSignal<RepoSort>("recent");
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [activePath, setActivePath] = createSignal<string | undefined>();
  const [anchorPath, setAnchorPath] = createSignal<string | undefined>();
  const [selectionTouched, setSelectionTouched] = createSignal(false);
  let list: HTMLDivElement | undefined;

  const rows = createMemo(() => sortRepositories(filterRepositories(repositoryRows(props.repos.repos(), props.repos.statuses(), app.aliases()), query()), sort()));
  const groups = createMemo(() => groupRepositories(rows(), props.repos.folders()));
  const ordered = createMemo(() => groups().flatMap((group) => group.rows));
  const current = createMemo((): RepoRow | undefined => ordered().find((row) => row.path === activePath()) ?? ordered()[0]);
  const selectedRows = createMemo(() => {
    const paths = selected();
    if (paths.size > 0) return ordered().filter((row) => paths.has(row.path));
    if (!selectionTouched() && current() !== undefined) return [current() as RepoRow];
    return [];
  });
  const inTab = (path: string) => app.tabs().tabs.some((tab) => tab.kind === "repo" && tab.path === path);
  const missing = (row: RepoRow) => row.status !== undefined && !row.status.exists;
  const statusTime = () => props.repos.statusesUpdatedAt();

  const open = (row: RepoRow | undefined) => {
    if (row === undefined || missing(row)) return;
    void app.openRepository(row.path);
  };

  const move = (event: KeyboardEvent) => {
    const all = ordered();
    if (all.length === 0) return;
    const index = Math.max(0, all.findIndex((row) => row.path === current()?.path));
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: all.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      const row = all[Math.max(0, Math.min(all.length - 1, next))];
      if (row !== undefined) {
        setSelected(new Set([row.path]));
        setActivePath(row.path);
        setAnchorPath(row.path);
        setSelectionTouched(true);
      }
      if (row !== undefined) list?.querySelector(`#${rowId(row.path)}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(current());
    }
  };

  return (
    <div class="repos-tab">
      <div class="fold-chips" role="group" aria-label="Scanned folders">
        <span class="fold-chips-label">Scanned folders</span>
        <For each={props.repos.folders()}>
          {(folder) => (
            <span class="fold-chip" title={folderMeta(folder, now())}>
              <Icon name="folder" size={14} />
              <bdi class="mono" dir="ltr">
                {folder.path}
              </bdi>
              <b class="count">{folder.repos.length}</b>
              <FolderControls repos={props.repos} path={folder.path} />
            </span>
          )}
        </For>
        <button type="button" class="btn sm" onClick={props.onAddFolder}>
          <Icon name="plus" size={14} />
          Add folder…
        </button>
        <button
          type="button"
          class="btn sm"
          disabled={props.repos.folders().length === 0}
          {...tip(props.repos.folders().length === 0 ? "Rescan folders is unavailable because no folder is scanned" : "Rescan every scanned folder", undefined, props.repos.folders().length === 0 ? "No folders are scanned" : "Rescan folders")}
          onClick={() => void props.repos.rescanAll()}
        >
          <Icon name="sync" size={14} />
          Rescan folders
        </button>
      </div>
      <div class="lp-tools">
        <label class="input">
          <Icon name="search" />
          <input type="text" aria-label="Search repositories" placeholder="Search names, paths, and branches" spellcheck={false} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <Select label="Sort repositories" value={sort()} options={SORT_CHOICES} onChange={(value) => setSort(value as RepoSort)} />
      </div>
      <div class="lp-sources" role="status">
        <div class="status-line">
          <Icon name={props.repos.statuses() === undefined ? "sync" : "check"} size={14} />
          {statusTime() > 0 ? `Repository status · read ${relativeAge(statusTime(), now())} ago` : "Repository status · reading …"}
        </div>
        <For each={props.repos.folders()}>
          {(folder) => (
            <div class="status-line">
              <Icon name="folder" size={14} />
              {folder.path} · scanned {relativeAge(folder.scanned_at, now())} ago
            </div>
          )}
        </For>
      </div>
      <ListChangeBar repos={props.repos} />
      <Show when={props.repos.readFailure()}>
        {(text) => (
          <div class="alert" role="alert">
            <strong>The repository list could not be read</strong>
            <p>{text()}</p>
            <div class="acts">
              <button type="button" class="btn sm" onClick={props.repos.refresh}>
                Retry
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show
        when={ordered().length > 0}
        fallback={
          <Show when={!props.repos.loading()}>
            <div class="lp-empty-box" role="status">
              <Show
                when={query().trim() !== ""}
                fallback={
                  <>
                    <strong>No repositories yet</strong>
                    <span>Add a folder and YForge lists the Git repositories inside it. Repositories you open also appear here.</span>
                    <button type="button" class="btn primary" onClick={props.onAddFolder}>
                      <Icon name="plus" />
                      Add folder…
                    </button>
                  </>
                }
              >
                <strong>No repository matches “{query().trim()}”</strong>
                <span>Search looks at names, paths, and branches.</span>
              </Show>
            </div>
          </Show>
        }
      >
        <div class="repo-table">
          <div class="repo-head" aria-hidden="true">
            <span />
            <span>Repository</span>
            <span>Branch</span>
            <span>Status</span>
            <span>Last opened</span>
          </div>
          <div
            ref={list}
            class="repo-list"
            role="listbox"
            tabindex="0"
            aria-label="Repositories"
            aria-activedescendant={current() === undefined ? undefined : rowId((current() as RepoRow).path)}
            onKeyDown={move}
          >
            <For each={groups()}>
              {(group) => (
                <div role="group" aria-label={`${group.label} · ${group.rows.length}`}>
                  <div class="repo-group" aria-hidden="true">
                    <Icon name={group.key === null ? "history" : "folder"} size={14} />
                    <bdi classList={{ mono: group.key !== null }} dir="ltr">
                      {group.label}
                    </bdi>
                    <b class="count">{group.rows.length}</b>
                  </div>
                  <For each={group.rows}>
                    {(row) => (
                      <div
                        id={rowId(row.path)}
                        class="repo-row"
                        classList={{ sel: selected().size > 0 ? selected().has(row.path) : !selectionTouched() && current()?.path === row.path, missing: missing(row) }}
                        role="option"
                        aria-selected={selected().size > 0 ? selected().has(row.path) : !selectionTouched() && current()?.path === row.path}
                        aria-label={`${row.name}, ${branchText(row.status) || "no branch"}, ${repoStateText(row.status)}, ${openedText(row.openedAt, now())}`}
                        onClick={(event) => {
                          const all = ordered();
                          const implicitPath = !selectionTouched() ? current()?.path : undefined;
                          const anchor = all.findIndex((item) => item.path === (anchorPath() ?? implicitPath));
                          const index = all.findIndex((item) => item.path === row.path);
                          setSelectionTouched(true);
                          setActivePath(row.path);
                          if (event.shiftKey && anchor >= 0) {
                            setSelected(new Set(all.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.path)));
                          } else if (event.metaKey || event.ctrlKey) {
                            setSelected((selection) => {
                              const next = new Set(selection.size === 0 && implicitPath !== undefined ? [implicitPath] : selection);
                              if (next.has(row.path)) next.delete(row.path);
                              else next.add(row.path);
                              return next;
                            });
                            if (anchor < 0) setAnchorPath(row.path);
                          } else {
                            setSelected(new Set([row.path]));
                            setAnchorPath(row.path);
                          }
                          list?.focus();
                        }}
                        onDblClick={() => open(row)}
                      >
                        <Icon name={missing(row) || row.status?.unreadable ? "warning" : "folder"} size={16} />
                        <span class="repo-name">
                          <strong>{row.name}</strong>
                          <Show when={inTab(row.path)}>
                            <span class="chip">In a tab</span>
                          </Show>
                          <span class="path-line mono" title={row.path}>
                            <bdi dir="ltr">{row.path}</bdi>
                          </span>
                        </span>
                        <span class="repo-branch mono">{branchText(row.status)}</span>
                        <span class="repo-state">
                          <For each={repoStateParts(row.status)}>
                            {(part) => (
                              <span class="repo-part" classList={{ ok: part.tone === "ok", attention: part.tone === "attention" }}>
                                <Icon name={part.icon} size={14} />
                                {part.text}
                              </span>
                            )}
                          </For>
                        </span>
                        <span class="repo-opened">{openedText(row.openedAt, now())}</span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
        <Show when={selectedRows().length > 1}>
          <div class="repo-actbar" role="toolbar" aria-label={`Actions for ${selectedRows().length} selected repositories`}>
            <span class="repo-actname">{selectedRows().length} repositories selected</span>
            <span class="spacer" />
            <button type="button" class="btn sm" onClick={() => {
              const paths = selectedRows().map((row) => row.path);
              setSelected(new Set<string>());
              setSelectionTouched(true);
              void props.repos.removeMany(paths);
            }}>
              <Icon name="close" size={14} />
              Remove {selectedRows().length} from list
            </button>
          </div>
        </Show>
        <Show when={selectedRows()[0]}>
          {(row) => (
            <div class="repo-actbar" role="toolbar" aria-label={`Actions for ${row().name}`}>
              <span class="repo-actname">
                <Icon name="folder" size={14} />
                <strong>{row().name}</strong>
              </span>
              <Show when={missing(row())}>
                <span class="field-note">
                  <Icon name="warning" size={14} />
                  Not found at this path: it was moved or deleted. Open it from its new place, then remove this entry.
                </span>
              </Show>
              <Show when={row().status?.unreadable}>{(reason) => <span class="field-note">Status unavailable: {reason()}</span>}</Show>
              <span class="spacer" />
              <Show when={!missing(row())}>
                <button type="button" class="btn sm primary" onClick={() => open(row())}>
                  <Icon name="open" size={14} />
                  {inTab(row().path) ? "Switch to its tab" : "Open"}
                </button>
                <button type="button" class="btn sm" onClick={() => void client.openPath(row().path, "finder")}>
                  <Icon name="folder" size={14} />
                  Reveal in Finder
                </button>
                <button type="button" class="btn sm" onClick={() => void client.openPath(row().path, "terminal")}>
                  <Icon name="terminal" size={14} />
                  Open in Terminal
                </button>
              </Show>
              <button type="button" class="btn sm" title="Takes it off this list. Nothing on disk changes." onClick={() => void props.repos.remove(row().path, row().openedAt !== null)}>
                <Icon name="close" size={14} />
                Remove from list
              </button>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
