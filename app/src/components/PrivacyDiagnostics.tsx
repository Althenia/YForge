import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { basename, formatAbsolute } from "../format";
import type { ActivityEntry } from "../ipc/bindings/ActivityEntry";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";
import { client } from "../ipc/client";
import { formatDuration } from "../state/activityModel";
import { useApp } from "../state/app";
import { clearCrashesCopy, clearHistoryCopy, clearUsageCopy, type ConfirmCopy } from "../state/confirmCopy";
import { commandCount, eventLabel, firstLine, usageOutcome } from "../state/diagnosticsModel";
import { createPagedList, type PagedList } from "../state/pagedList";
import { gravatarEnabled, setGravatarEnabled } from "../state/avatar";
import { diagnosticsKeys } from "../state/queryKeys";
import { ActivityEntryView } from "./ActivityEntryView";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { SettingRow } from "./SettingRow";
import { Switch } from "./Switch";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

function useFileExport(options: { title: string; fileName: string; noun: string; write: (path: string) => Promise<number> }) {
  const [status, setStatus] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const start = async () => {
    setStatus(undefined);
    setFailure(undefined);
    try {
      const path = await client.pickSavePath(options.title, options.fileName);
      if (path === undefined) return;
      const count = await options.write(path);
      setStatus(`Exported ${count} ${options.noun}${count === 1 ? "" : "s"} to ${path}.`);
    } catch (problem) {
      setFailure(message(problem));
    }
  };
  return { status, failure, start };
}

function Outcome(props: { status: string | undefined; failure: string | undefined }) {
  return (
    <>
      <Show when={props.status}>
        {(text) => (
          <p class="field-note" role="status">
            <Icon name="check" size={14} /> {text()}
          </p>
        )}
      </Show>
      <Show when={props.failure}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
    </>
  );
}

function ClearAction(props: { label: string; copy: ConfirmCopy; disabled?: boolean; run: () => Promise<void> }) {
  const [asking, setAsking] = createSignal(false);
  return (
    <>
      <button type="button" class="btn sm" disabled={props.disabled} onClick={() => setAsking(true)}>
        <Icon name="trash" size={14} />
        {props.label}
      </button>
      <Show when={asking()}>
        <ConfirmDialog
          copy={props.copy}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void props.run();
          }}
        />
      </Show>
    </>
  );
}

function Rows<T extends { id: number }>(props: { label: string; empty: string; list: PagedList<T>; children: (row: T) => JSX.Element }) {
  return (
    <>
      <ul class="act-list" aria-label={props.label}>
        <For each={props.list.rows()} fallback={<Show when={props.list.loaded()}><li class="setting-note act-empty">{props.empty}</li></Show>}>
          {props.children}
        </For>
      </ul>
      <Show when={props.list.failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <Show when={props.list.hasMore()}>
        <div class="act-tools">
          <button type="button" class="btn sm" disabled={props.list.fetchingMore()} onClick={props.list.loadMore}>
            Show older
          </button>
        </div>
      </Show>
    </>
  );
}

function UsageRow(props: { record: UsageRecord }) {
  return (
    <li class="act-entry" classList={{ failed: !props.record.ok }}>
      <div class="act-head">
        <span class="act-status" classList={{ bad: !props.record.ok }}>
          <Icon name={props.record.ok ? "check" : "warning"} size={14} />
        </span>
        <span class="act-time">{formatAbsolute(props.record.occurred_at)}</span>
        <span class="act-op">{eventLabel(props.record.event)}</span>
        <span class="act-summary">{usageOutcome(props.record)}</span>
        <span class="act-time">
          {formatDuration(props.record.duration_ms)} · {commandCount(props.record.count)}
        </span>
      </div>
    </li>
  );
}

function ProfilePictures() {
  return (
    <section aria-label="Profile pictures" class="diag">
      <h3>Profile pictures</h3>
      <SettingRow
        title="Show profile pictures from Gravatar"
        note="When on, YForge asks gravatar.com for each author's picture in the commit inspector, the pull request list, and the Activity drawer. Only the MD5 hash of the author's email is sent, never the email itself. Pictures are kept in memory for the session. When off, nothing is requested and each author shows their initial."
      >
        <Switch label="Show profile pictures from Gravatar" checked={gravatarEnabled()} onChange={setGravatarEnabled} />
        <span class="setting-title">{gravatarEnabled() ? "On" : "Off"}</span>
      </SettingRow>
    </section>
  );
}

function UsageData() {
  const app = useApp();
  const queryClient = useQueryClient();
  const enabled = () => app.settings().telemetry_opt_in;
  const list = createPagedList<UsageRecord>(() => ({ key: diagnosticsKeys.usage, fetchPage: (before, limit) => client.usageList(before, limit), enabled: enabled() }));
  const [notice, setNotice] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const exporter = useFileExport({ title: "Export usage data", fileName: "yforge-usage.json", noun: "usage event", write: (path) => client.usageExport(path) });
  const clear = useMutation(() => ({ mutationFn: () => client.usageClear(), onSuccess: () => queryClient.invalidateQueries({ queryKey: diagnosticsKeys.usage }) }));

  const toggle = async (next: boolean) => {
    setNotice(undefined);
    setFailure(undefined);
    const problem = await app.saveSettings({ ...app.settings(), telemetry_opt_in: next });
    if (problem !== undefined) {
      setFailure(problem);
      return;
    }
    if (!next) {
      queryClient.removeQueries({ queryKey: diagnosticsKeys.usage });
      setNotice("Usage recording is off. Stored usage events were deleted.");
    }
  };
  const deleteAll = async () => {
    try {
      await clear.mutateAsync();
    } catch (problem) {
      setFailure(message(problem));
    }
  };

  return (
    <section aria-label="Usage data" class="diag">
      <h3>Usage data</h3>
      <SettingRow
        title="Record usage data"
        note="When on, YForge records for each Git operation its type, whether it succeeded (and the error kind if not), how long it took, and how many Git commands it ran, with the time and app version. Paths, branch names, and messages are never recorded, and nothing leaves this Mac. Turning it off deletes the stored events."
      >
        <Switch label="Record usage data" checked={enabled()} onChange={(next) => void toggle(next)} />
        <span class="setting-title">{enabled() ? "On" : "Off"}</span>
      </SettingRow>
      <Show when={enabled()}>
        <div class="diag-head">
          <span class="setting-note">Stored on this Mac, newest first.</span>
          <span class="spacer" />
          <button type="button" class="btn sm" onClick={() => void exporter.start()}>
            Export…
          </button>
          <ClearAction label="Delete all" copy={clearUsageCopy()} run={deleteAll} />
        </div>
        <Rows label="Usage events" empty="No usage events recorded yet" list={list}>
          {(record) => <UsageRow record={record} />}
        </Rows>
      </Show>
      <Outcome status={notice() ?? exporter.status()} failure={exporter.failure() ?? failure()} />
    </section>
  );
}

function Detail(props: { title: string; value: string | null; block?: boolean }) {
  return (
    <Show when={props.value}>
      {(value) => (
        <div class="act-cmd">
          <span class="setting-title">{props.title}</span>
          {props.block ? <pre class="act-output">{value()}</pre> : <code class="act-line">{value()}</code>}
        </div>
      )}
    </Show>
  );
}

function CrashRow(props: { record: CrashRecord }) {
  const [open, setOpen] = createSignal(false);
  return (
    <li class="act-entry">
      <button type="button" class="act-head" aria-expanded={open()} onClick={() => setOpen((value) => !value)}>
        <span class="act-time">{formatAbsolute(props.record.occurred_at)}</span>
        <span class="chip">{props.record.origin}</span>
        <span class="act-op">{props.record.kind}</span>
        <span class="act-summary">{firstLine(props.record.message)}</span>
      </button>
      <Show when={open()}>
        <div class="act-body">
          <Detail title="Message" value={props.record.message} block />
          <Detail title="Location" value={props.record.location} />
          <Detail title="View" value={props.record.view} />
          <Detail title="Stack" value={props.record.stack} block />
          <p class="setting-note">
            YForge {props.record.app_version} · {props.record.os} {props.record.arch}
            {props.record.thread === null ? "" : ` · thread ${props.record.thread}`}
          </p>
        </div>
      </Show>
    </li>
  );
}

function CrashReports() {
  const queryClient = useQueryClient();
  const list = createPagedList<CrashRecord>(() => ({ key: diagnosticsKeys.crashes, fetchPage: (before, limit) => client.crashList(before, limit) }));
  const [failure, setFailure] = createSignal<string | undefined>();
  const exporter = useFileExport({ title: "Export crash reports", fileName: "yforge-crashes.json", noun: "crash report", write: (path) => client.crashExport(path) });
  const clear = useMutation(() => ({ mutationFn: () => client.crashClear(), onSuccess: () => queryClient.invalidateQueries({ queryKey: diagnosticsKeys.crashes }) }));
  const clearAll = async () => {
    setFailure(undefined);
    try {
      await clear.mutateAsync();
    } catch (problem) {
      setFailure(message(problem));
    }
  };
  return (
    <section aria-label="Crash reports" class="diag">
      <h3>Crash reports</h3>
      <div class="diag-head">
        <span class="setting-note">Errors and panics, stored on this Mac and never sent. Newest first.</span>
        <span class="spacer" />
        <button type="button" class="btn sm" disabled={list.rows().length === 0} onClick={() => void exporter.start()}>
          Export…
        </button>
        <ClearAction label="Clear" copy={clearCrashesCopy()} disabled={list.rows().length === 0} run={clearAll} />
      </div>
      <Rows label="Crash reports" empty="No crash reports" list={list}>
        {(record) => <CrashRow record={record} />}
      </Rows>
      <Outcome status={exporter.status()} failure={exporter.failure() ?? failure()} />
    </section>
  );
}

function ActivityHistory() {
  const app = useApp();
  const repository = () => app.activePath();
  const list = createPagedList<ActivityEntry>(() => {
    const repo = repository();
    return { key: diagnosticsKeys.history(repo ?? ""), fetchPage: (before, limit) => client.activityHistory(repo as string, before, limit), enabled: repo !== undefined };
  });
  const session = createMemo(() => new Set(app.activity().map((entry) => entry.id)));
  const [failure, setFailure] = createSignal<string | undefined>();
  const clear = async (repo: string) => {
    setFailure(undefined);
    try {
      await app.clearActivity(repo);
    } catch (problem) {
      setFailure(message(problem));
    }
  };
  return (
    <section aria-label="Activity history" class="diag">
      <h3>Activity history</h3>
      <Show when={repository()} fallback={<p class="setting-note">Open a repository to see its activity history.</p>}>
        {(repo) => (
          <>
            <div class="diag-head">
              <span class="setting-note">Operations run in {basename(repo())}, newest first. Undo only reaches the current session.</span>
              <span class="spacer" />
              <ClearAction label="Clear history" copy={clearHistoryCopy(basename(repo()))} disabled={list.rows().length === 0} run={() => clear(repo())} />
            </div>
            <Rows label="Activity history" empty="No activity recorded for this repository" list={list}>
              {(entry) => <ActivityEntryView entry={entry} earlier={!session().has(entry.id)} onUndo={() => undefined} undoId={undefined} />}
            </Rows>
            <Outcome status={undefined} failure={failure()} />
          </>
        )}
      </Show>
    </section>
  );
}

export function PrivacyDiagnostics() {
  return (
    <>
      <h2>Privacy &amp; diagnostics</h2>
      <p class="setting-note">Diagnostics on this page are stored on this Mac and never sent. Profile pictures are the one thing fetched from the network, and only while they are on.</p>
      <ProfilePictures />
      <UsageData />
      <CrashReports />
      <ActivityHistory />
    </>
  );
}
