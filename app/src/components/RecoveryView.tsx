import { createForm } from "@tanstack/solid-form";
import { useInfiniteQuery, useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { formatAbsolute, relativeAge } from "../format";
import type { IconName } from "../iconNames";
import type { LostCommit } from "../ipc/bindings/LostCommit";
import type { ReflogEntry } from "../ipc/bindings/ReflogEntry";
import type { SnapshotInfo } from "../ipc/bindings/SnapshotInfo";
import { client, IpcError } from "../ipc/client";
import { branchNameProblem } from "../state/branchName";
import { statusLetter } from "../state/changes";
import type { ConfirmCopy } from "../state/confirmCopy";
import { dataOf } from "../state/queryData";
import { repoKeys } from "../state/queryKeys";
import { createRestoreActions, type RestoreActions } from "../state/recoveryActions";
import { headMoved, nextReflogCursor, RECOVERY_LIMITS, REFLOG_PAGE, referenceLabel, restoreAllCopy, snapshotActionLabel, suggestBranchName } from "../state/recoveryModel";
import type { Anchor } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { tip } from "./Tooltip";

export type RecoveryTab = "reflog" | "lost" | "snapshots";

const TABS: ReadonlyArray<{ id: RecoveryTab; label: string; icon: IconName }> = [
  { id: "reflog", label: "Reflog", icon: "history" },
  { id: "lost", label: "Lost commits", icon: "search" },
  { id: "snapshots", label: "Snapshots", icon: "stash" },
];

const PRUNED = "Git has already pruned this commit";

const short = (sha: string): string => sha.slice(0, 7);
const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));
const anchorOf = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom };
};

function Age(props: { time: number }) {
  return (
    <span class="dim" title={formatAbsolute(props.time)}>
      {relativeAge(props.time, Math.floor(Date.now() / 1000))} ago
    </span>
  );
}

function RestoreButtons(props: { sha: string; available: boolean; restore: RestoreActions }) {
  const reason = () => (props.available ? undefined : PRUNED);
  const resetReason = () => reason() ?? props.restore.resetBlock();
  const resetName = () => (props.restore.resetBlock() === undefined ? `Reset ${props.restore.currentLabel()} to ${short(props.sha)}` : `Reset the current branch to ${short(props.sha)}`);
  return (
    <span class="wactions">
      <button
        type="button"
        class="icon-btn dense"
        disabled={reason() !== undefined}
        title={reason()}
        {...tip("Restore as branch…", undefined, `Restore ${short(props.sha)} as a branch`)}
        onClick={(event) => props.restore.openBranch(props.sha, anchorOf(event.currentTarget))}
      >
        <Icon name="branch" />
      </button>
      <button
        type="button"
        class="icon-btn dense"
        disabled={reason() !== undefined}
        title={reason()}
        {...tip("Check out detached…", undefined, `Check out ${short(props.sha)} (detached)`)}
        onClick={() => props.restore.checkout(props.sha)}
      >
        <Icon name="check" />
      </button>
      <button
        type="button"
        class="icon-btn dense"
        disabled={resetReason() !== undefined}
        title={resetReason()}
        {...tip("Reset current branch…", undefined, resetName())}
        onClick={(event) => props.restore.openReset(props.sha, anchorOf(event.currentTarget))}
      >
        <Icon name="undo" />
      </button>
    </span>
  );
}

function RestoreBranchForm(props: { sha: string; anchor: Anchor; branches: readonly string[]; onSubmit: (name: string) => void; onClose: () => void }) {
  const form = createForm(() => ({ defaultValues: { name: suggestBranchName(props.sha, props.branches) }, onSubmit: ({ value }) => props.onSubmit(value.name) }));
  const name = form.useSelector((state) => state.values.name);
  const problem = () => (name() === "" ? "Enter a branch name" : branchNameProblem(name(), props.branches));
  return (
    <Popover anchor={props.anchor} label="Restore as branch" onClose={props.onClose}>
      <form
        class="popform"
        onSubmit={(event) => {
          event.preventDefault();
          if (problem() === undefined) void form.handleSubmit();
        }}
      >
        <h3>Restore as branch</h3>
        <p class="start-point ref">{short(props.sha)}</p>
        <label class="input">
          <form.Field name="name">
            {(field) => <input type="text" spellcheck={false} autocapitalize="off" aria-label="Branch name" value={field().state.value} onInput={(event) => field().handleChange(event.currentTarget.value)} />}
          </form.Field>
        </label>
        <Show when={name() !== "" && branchNameProblem(name(), props.branches)}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        <p class="field-note">Creates the branch at this commit without checking it out.</p>
        <div class="foot">
          <button type="button" class="btn sm" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn sm primary" disabled={problem() !== undefined}>
            Create branch
          </button>
        </div>
      </form>
    </Popover>
  );
}

function ReflogTab(props: { session: RepoSession; restore: RestoreActions }) {
  const path = props.session.path;
  const refs = useQuery(() => ({ queryKey: repoKeys.reflogRefs(path), queryFn: () => client.reflogRefs(path) }));
  const [reference, setReference] = createSignal("HEAD");
  const log = useInfiniteQuery(() => ({
    queryKey: repoKeys.reflog(path, reference()),
    queryFn: ({ pageParam }: { pageParam: number | null }) => client.reflogList(path, reference(), pageParam, REFLOG_PAGE),
    initialPageParam: null as number | null,
    getNextPageParam: (last: ReflogEntry[]) => nextReflogCursor(last),
  }));
  const entries = createMemo((): ReflogEntry[] => log.data?.pages.flat() ?? []);
  const choices = () => {
    const listed = dataOf(refs) ?? [];
    return listed.includes("HEAD") ? listed : ["HEAD", ...listed];
  };
  return (
    <>
      <label class="field reflog-pick">
        <span class="field-label">Reference</span>
        <span class="input">
          <select aria-label="Reference" value={reference()} onChange={(event) => setReference(event.currentTarget.value)}>
            <For each={choices()}>{(name) => <option value={name}>{referenceLabel(name)}</option>}</For>
          </select>
        </span>
      </label>
      <Show when={log.error}>
        {(error) => (
          <div class="graph-error" role="alert">
            {messageOf(error())}
          </div>
        )}
      </Show>
      <Show when={log.status === "success" && entries().length === 0}>
        <p class="setting-note">The reflog of {referenceLabel(reference())} has no entries yet.</p>
      </Show>
      <ul class="rlist" aria-label="Reflog entries" aria-busy={log.isFetching}>
        <For each={entries()}>
          {(entry) => (
            <li class="recrow" classList={{ gone: !entry.exists }}>
              <span class="chip">{entry.action}</span>
              <span class="ref">{short(entry.sha)}</span>
              <span class="rsum" title={entry.message}>
                {entry.exists ? entry.summary : "Commit no longer exists"}
              </span>
              <span class="ref dim">{entry.selector}</span>
              <Age time={entry.time} />
              <RestoreButtons sha={entry.sha} available={entry.exists} restore={props.restore} />
            </li>
          )}
        </For>
      </ul>
      <Show when={log.hasNextPage}>
        <button type="button" class="btn sm" disabled={log.isFetchingNextPage} aria-busy={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          Show older
        </button>
      </Show>
    </>
  );
}

let scanSequence = 0;

function LostTab(props: { session: RepoSession; restore: RestoreActions }) {
  const [scan, setScan] = createSignal<string | undefined>();
  const [found, setFound] = createSignal<LostCommit[] | undefined>();
  const [message, setMessage] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();

  async function start(): Promise<void> {
    const id = `lost-${Date.now()}-${(scanSequence += 1)}`;
    setScan(id);
    setFound(undefined);
    setMessage(undefined);
    setFailure(undefined);
    try {
      setFound(await client.lostCommits(props.session.path, id));
    } catch (error) {
      if (error instanceof IpcError && error.kind === "cancelled") setMessage("Scan cancelled. Nothing changed.");
      else setFailure(messageOf(error));
    } finally {
      setScan(undefined);
    }
  }

  const cancel = () => {
    const id = scan();
    if (id !== undefined) void client.operationCancel(id).catch(props.session.report);
  };

  return (
    <>
      <p class="setting-note">
        Finds commits no branch, tag, or stash reaches, such as a deleted branch or rewritten history, with <code>git fsck</code>. The scan can take a while on a large repository.
      </p>
      <div class="hrow">
        <button type="button" class="btn sm primary" disabled={scan() !== undefined} onClick={() => void start()}>
          <Icon name="search" />
          Scan for lost commits
        </button>
        <Show when={scan() !== undefined}>
          <span role="status" class="reason">
            Scanning with git fsck…
          </span>
          <button type="button" class="btn sm" onClick={cancel}>
            Cancel scan
          </button>
        </Show>
      </div>
      <Show when={failure()}>
        {(text) => (
          <div class="graph-error" role="alert">
            {text()}
          </div>
        )}
      </Show>
      <Show when={message()}>{(text) => <p class="setting-note">{text()}</p>}</Show>
      <Show when={found()}>
        {(commits) => (
          <Show when={commits().length > 0} fallback={<p class="setting-note">No lost commits found.</p>}>
            <ul class="rlist" aria-label="Lost commits">
              <For each={commits()}>
                {(commit) => (
                  <li class="recrow">
                    <Show when={commit.kind === "stash"}>
                      <span class="chip">Dropped stash</span>
                    </Show>
                    <span class="ref">{short(commit.sha)}</span>
                    <span class="rsum" title={commit.summary}>
                      {commit.summary}
                    </span>
                    <span class="dim">{commit.author}</span>
                    <Age time={commit.time} />
                    <RestoreButtons sha={commit.sha} available restore={props.restore} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </>
  );
}

function SnapshotDetail(props: { session: RepoSession; info: SnapshotInfo; onNotice: (text: string) => void; onConfirm: (copy: ConfirmCopy, run: () => Promise<void>) => void }) {
  const path = props.session.path;
  const files = useQuery(() => ({ queryKey: repoKeys.snapshotFiles(path, props.info.ref), queryFn: () => client.snapshotFiles(path, props.info.ref) }));
  const [checked, setChecked] = createSignal<ReadonlySet<string>>(new Set());
  const listed = () => dataOf(files) ?? [];
  const toggle = (file: string) => setChecked((current) => (current.has(file) ? new Set([...current].filter((entry) => entry !== file)) : new Set([...current, file])));

  async function run(action: () => Promise<string>, done: (safety: string) => string): Promise<void> {
    try {
      props.onNotice(done(await action()));
    } catch (failure) {
      props.session.report(failure);
    }
    await props.session.refresh();
  }

  const restoreFiles = () => {
    const chosen = [...checked()];
    setChecked(new Set<string>());
    return run(() => client.snapshotRestoreFiles(path, props.info.ref, chosen), (safety) => `Restored ${chosen.length} ${chosen.length === 1 ? "file" : "files"}. The previous state is saved as ${safety}.`);
  };
  const restoreAll = (force: boolean) => run(() => client.snapshotRestoreAll(path, props.info.ref, force), (safety) => `Restored the snapshot. The previous state is saved as ${safety}.`);

  const confirmRestoreAll = () => {
    const moved = headMoved(props.info, props.session.snapshot());
    props.onConfirm(restoreAllCopy(props.info, moved, props.session.snapshot()), () => restoreAll(moved));
  };
  const confirmDelete = () =>
    props.onConfirm(
      {
        title: "Delete this snapshot?",
        consequences: ["Only this snapshot is deleted. Your files and history are untouched, and its objects stay until Git prunes them."],
        names: [props.info.ref],
        confirmLabel: "Delete snapshot",
      },
      async () => {
        try {
          await client.snapshotDelete(path, props.info.ref);
        } catch (failure) {
          props.session.report(failure);
        }
        await props.session.refresh();
      },
    );

  return (
    <div class="snapdetail">
      <Show when={files.error}>
        {(error) => (
          <div class="graph-error" role="alert">
            {messageOf(error())}
          </div>
        )}
      </Show>
      <Show when={files.status === "success" && listed().length === 0}>
        <p class="setting-note">This snapshot differs from its HEAD in no files.</p>
      </Show>
      <ul class="rlist" aria-label="Snapshot files">
        <For each={listed()}>
          {(change) => (
            <li class="snapfile">
              <input type="checkbox" aria-label={`Restore ${change.path}`} checked={checked().has(change.path)} onChange={() => toggle(change.path)} />
              <span class={`badge st-${change.status}`} aria-hidden="true">
                {statusLetter[change.status]}
              </span>
              <span class="path-line" title={change.path}>
                <bdi dir="ltr">{change.path}</bdi>
              </span>
            </li>
          )}
        </For>
      </ul>
      <div class="hrow">
        <button type="button" class="btn sm" disabled={checked().size === 0} title={checked().size === 0 ? "Check the files to copy back" : undefined} onClick={() => void restoreFiles()}>
          Restore selected files
        </button>
        <button type="button" class="btn sm" onClick={confirmRestoreAll}>
          Restore everything…
        </button>
        <span class="spacer" />
        <button type="button" class="btn sm danger" onClick={confirmDelete}>
          Delete snapshot…
        </button>
      </div>
    </div>
  );
}

function SnapshotsTab(props: { session: RepoSession; onNotice: (text: string) => void; onConfirm: (copy: ConfirmCopy, run: () => Promise<void>) => void }) {
  const listing = useQuery(() => ({ queryKey: repoKeys.snapshots(props.session.path), queryFn: () => client.snapshotsList(props.session.path) }));
  const [selected, setSelected] = createSignal<string | undefined>();
  createEffect(on(() => dataOf(listing), (current) => current !== undefined && !current.some((info) => info.ref === selected()) && setSelected(undefined)));
  const snapshots = () => dataOf(listing) ?? [];
  return (
    <>
      <Show when={listing.error}>
        {(error) => (
          <div class="graph-error" role="alert">
            {messageOf(error())}
          </div>
        )}
      </Show>
      <Show when={listing.status === "success" && snapshots().length === 0}>
        <p class="setting-note">No snapshots yet. YForge saves one before it discards, hard-resets, rewrites history, drops a stash, or deletes a branch.</p>
      </Show>
      <ul class="rlist" aria-label="Snapshots" aria-busy={listing.isFetching}>
        <For each={snapshots()}>
          {(info) => (
            <li class="recrow snap" classList={{ sel: selected() === info.ref }}>
              <button
                type="button"
                class="snaphead"
                aria-expanded={selected() === info.ref}
                aria-label={`Show files of ${snapshotActionLabel(info.action)}`}
                onClick={() => setSelected(selected() === info.ref ? undefined : info.ref)}
              >
                <Icon name="stash" />
                <span class="snaptitle">{snapshotActionLabel(info.action)}</span>
                <span class="rsum" title={info.description}>
                  {info.description}
                </span>
                <span class="chip">
                  {info.files_changed} {info.files_changed === 1 ? "file" : "files"}
                </span>
                <Show when={info.branch}>{(branch) => <span class="ref dim">{branch()}</span>}</Show>
                <Age time={info.time} />
              </button>
              <Show when={selected() === info.ref}>
                <SnapshotDetail session={props.session} info={info} onNotice={props.onNotice} onConfirm={props.onConfirm} />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

export function RecoveryView(props: { session: RepoSession; tab: RecoveryTab; onClose: () => void }) {
  const [tab, setTab] = createSignal(props.tab);
  const [notice, setNotice] = createSignal<string | undefined>();
  const [confirm, setConfirm] = createSignal<{ copy: ConfirmCopy; run: () => Promise<void> } | undefined>();
  const restore = createRestoreActions(props.session);
  createEffect(on(() => props.tab, setTab, { defer: true }));

  return (
    <section
      class="panel rpanel"
      aria-label="Recovery"
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="rhead">
        <Icon name="history" />
        <span>Recovery</span>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody">
        <div class="note attention" role="note" aria-label="Recovery limits">
          <Icon name="warning" /> What recovery cannot do
          <ul>
            <For each={RECOVERY_LIMITS}>{(line) => <li>{line}</li>}</For>
          </ul>
        </div>
        <div class="segmented" role="tablist" aria-label="Recovery sources">
          <For each={TABS}>
            {(entry) => (
              <button type="button" role="tab" aria-selected={tab() === entry.id} classList={{ on: tab() === entry.id }} onClick={() => setTab(entry.id)}>
                <Icon name={entry.icon} />
                {entry.label}
              </button>
            )}
          </For>
        </div>
        <Show when={notice()}>
          {(text) => (
            <div class="note" role="status">
              {text()}
            </div>
          )}
        </Show>
        <Show when={tab() === "reflog"}>
          <ReflogTab session={props.session} restore={restore} />
        </Show>
        <Show when={tab() === "lost"}>
          <LostTab session={props.session} restore={restore} />
        </Show>
        <Show when={tab() === "snapshots"}>
          <SnapshotsTab session={props.session} onNotice={setNotice} onConfirm={(copy, run) => setConfirm({ copy, run })} />
        </Show>
      </div>
      <Show when={restore.menu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={restore.closeMenu} />}
      </Show>
      <Show when={restore.naming()} keyed>
        {(target) => <RestoreBranchForm sha={target.sha} anchor={target.anchor} branches={props.session.snapshot().branches} onSubmit={(name) => void restore.submitBranch(name)} onClose={restore.closeNaming} />}
      </Show>
      <Show when={restore.dialog()} keyed>
        {(dialog) => (
          <ConfirmDialog
            copy={dialog.copy}
            onConfirm={() => {
              const run = dialog.run;
              restore.closeDialog();
              void run();
            }}
            onCancel={restore.closeDialog}
          />
        )}
      </Show>
      <Show when={confirm()} keyed>
        {(pending) => (
          <ConfirmDialog
            copy={pending.copy}
            onConfirm={() => {
              setConfirm(undefined);
              void pending.run();
            }}
            onCancel={() => setConfirm(undefined)}
          />
        )}
      </Show>
    </section>
  );
}
