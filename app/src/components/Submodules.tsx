import { createSignal, For, Show } from "solid-js";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import type { Submodule } from "../ipc/bindings/Submodule";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { failureNotice } from "../state/errorNotice";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import type { Anchor, MenuState } from "../state/repoActions";
import { countLabel, matchesFilter } from "../state/sidebarModel";
import {
  addSubmoduleProblem,
  deinitCopy,
  submoduleCheckout,
  submoduleEntries,
  submoduleStatusWord,
  UPDATE_ON_FETCH_OFF,
  UPDATE_ON_FETCH_ON,
} from "../state/submoduleModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { Switch } from "./Switch";
import { tip } from "./Tooltip";

const short = (sha: string | null): string | undefined => (sha === null || sha === "" ? undefined : sha.slice(0, 7));

const detailOf = (row: Submodule): string => {
  const word = submoduleStatusWord(row.status);
  const recorded = short(row.recorded) ?? row.recorded;
  const checked = short(row.checked_out);
  return checked !== undefined && checked !== recorded ? `${word} · recorded ${recorded} · checked out ${checked}` : `${word} · ${recorded}`;
};

const messageOf = failureNotice;

export function SubmoduleSection(props: { root: string; expanded: boolean; onToggle: () => void; filter: string }) {
  const app = useApp();
  const list = useQuery(() => ({ queryKey: repoKeys.submodules(props.root), queryFn: () => client.submoduleList(props.root) }));
  const [menu, setMenu] = createSignal<MenuState | undefined>();
  const [addAt, setAddAt] = createSignal<Anchor | undefined>();
  const [path, setPath] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [problem, setProblem] = createSignal<string | undefined>();
  const [confirmPath, setConfirmPath] = createSignal<string | undefined>();
  const [running, setRunning] = createSignal<string>();
  const rows = () => list.data ?? [];
  const visible = () => rows().filter((row) => matchesFilter(props.filter, row.path, row.url, submoduleStatusWord(row.status)));
  const updateOnFetch = () => app.repoSettings(props.root)?.submodule_update_on_fetch === true;
  const refresh = () => void app.queryClient.invalidateQueries({ queryKey: repoKeys.submodules(props.root) });

  const saveFetch = (value: boolean) => {
    if (running() !== undefined) return;
    const current = app.repoSettings(props.root);
    const next: RepoSettings = { pull_mode: current?.pull_mode ?? null, ssh_key_path: current?.ssh_key_path ?? null };
    if (value) next.submodule_update_on_fetch = true;
    void run("Saving update on fetch", () => app.saveRepoSettings(props.root, next));
  };

  const run = async (label: string, work: () => Promise<unknown>) => {
    if (running() !== undefined) return;
    setRunning(label);
    try {
      await work();
      refresh();
    } catch (failure) {
      app.setNotice(messageOf(failure));
    } finally {
      setRunning(undefined);
    }
  };

  const openAdd = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setProblem(undefined);
    setAddAt({ left: rect.left, top: rect.bottom });
  };

  const submitAdd = () => {
    if (running() !== undefined) return;
    const issue = addSubmoduleProblem(path(), url());
    setProblem(issue);
    if (issue !== undefined) return;
    const chosen = branch().trim();
    void run("Adding submodule", async () => {
      await client.submoduleAdd(props.root, url().trim(), path().trim(), chosen === "" ? null : chosen);
      setPath("");
      setUrl("");
      setBranch("");
      setAddAt(undefined);
    });
  };

  const openMenu = (row: Submodule, anchor: Anchor) => {
    if (running() !== undefined) return;
    setMenu({
      anchor,
      entries: submoduleEntries(row),
      run: (id) => {
        setMenu(undefined);
        if (id === "update") void run("Updating submodule", () => client.submoduleUpdate(props.root, row.path));
        else if (id === "open") void app.openRepository(submoduleCheckout(props.root, row.path));
        else if (id === "stage") void run("Staging submodule pointer", () => client.submoduleStage(props.root, row.path));
        else if (id === "deinit") setConfirmPath(row.path);
      },
    });
  };

  return (
    <section aria-label="Submodules">
      <div class="sec">
        <button type="button" class="sec-title" aria-expanded={props.expanded} onClick={() => props.onToggle()}>
          <Icon name="folder" />
          Submodules
          <span class="sec-chevron" classList={{ collapsed: !props.expanded }}>
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <Show when={list.isSuccess}>
          <span class="count">{countLabel(rows().length, visible().length, props.filter !== "")}</span>
        </Show>
        <button type="button" class="icon-btn dense" disabled={running() !== undefined} {...tip("Add submodule")} onClick={(event) => openAdd(event.currentTarget)}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <Show when={props.expanded}>
        <div class="submod-fetch">
          <Switch label="Update on fetch" checked={updateOnFetch()} disabled={running() !== undefined} onChange={saveFetch} />
          <span>Update on fetch</span>
        </div>
        <p class="submod-note">{updateOnFetch() ? UPDATE_ON_FETCH_ON : UPDATE_ON_FETCH_OFF}</p>
        <Show when={list.isError}>
          <p class="submod-note">Submodules could not be loaded.</p>
        </Show>
        <Show when={list.isSuccess && rows().length === 0}>
          <p class="submod-note">No submodules</p>
        </Show>
        <For each={visible()}>
          {(row) => (
            <div
              class="srow"
              role="button"
              tabindex="0"
              data-nav={`submodule:${row.path}`}
              aria-label={`${row.path}, ${submoduleStatusWord(row.status)}`}
              title={`${row.url}${row.branch === null ? "" : ` · ${row.branch}`}`}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(row, { left: event.clientX, top: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(row, { left: rect.left, top: rect.bottom });
                }
              }}
            >
              <span class="name">{row.path}</span>
              <span class="meta">{detailOf(row)}</span>
            </div>
          )}
        </For>
      </Show>
      <Show when={running()}>{(label) => <p class="submod-note" role="status" aria-busy="true"><span class="busy-spinner" aria-hidden="true" />{label()}…</p>}</Show>
      <Show when={menu()} keyed>
        {(state) => <ContextMenu menu={state} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={addAt()} keyed>
        {(anchor) => (
          <Popover anchor={anchor} label="Add submodule" onClose={() => { if (running() === undefined) setAddAt(undefined); }}>
            <form
              class="popform"
              onSubmit={(event) => {
                event.preventDefault();
                submitAdd();
              }}
            >
              <h3>Add submodule</h3>
              <label class="field">
                Path
                <input aria-label="Submodule path" value={path()} disabled={running() !== undefined} onInput={(event) => setPath(event.currentTarget.value)} />
              </label>
              <label class="field">
                URL
                <input aria-label="Submodule URL" value={url()} disabled={running() !== undefined} onInput={(event) => setUrl(event.currentTarget.value)} />
              </label>
              <label class="field">
                Branch
                <input aria-label="Submodule branch" placeholder="Optional" value={branch()} disabled={running() !== undefined} onInput={(event) => setBranch(event.currentTarget.value)} />
              </label>
              <p class="submod-note">The parent stores one commit, not a copy of the history. Update on fetch starts off.</p>
              <Show when={problem()}>
                <p class="submod-note" role="alert">
                  {problem()}
                </p>
              </Show>
              <button type="submit" class="btn primary" disabled={running() !== undefined} aria-busy={running() === "Adding submodule"}>
                {running() === "Adding submodule" ? "Adding…" : "Add"}
              </button>
            </form>
          </Popover>
        )}
      </Show>
      <Show when={confirmPath()} keyed>
        {(target) => (
          <ConfirmDialog
            copy={deinitCopy(target)}
            onCancel={() => setConfirmPath(undefined)}
            onConfirm={() => {
              setConfirmPath(undefined);
              void run("Deinitializing submodule", () => client.submoduleDeinit(props.root, target));
            }}
          />
        )}
      </Show>
    </section>
  );
}
