import { For, Show } from "solid-js";
import type { CrashRecord } from "../ipc/bindings/CrashRecord";
import type { UsageRecord } from "../ipc/bindings/UsageRecord";
import { client } from "../ipc/client";
import { formatAbsolute } from "../format";
import { formatDuration } from "../state/activityModel";
import { useApp } from "../state/app";
import { commandCount, eventLabel, usageOutcome } from "../state/diagnosticsModel";
import { errorRows, NO_ERRORS, NO_USAGE, USAGE_RECORDING_OFF } from "../state/logsModel";
import type { LogTab } from "../state/palette";
import { createPagedList } from "../state/pagedList";
import { diagnosticsKeys } from "../state/queryKeys";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

const TABS: ReadonlyArray<{ id: LogTab; label: string }> = [
  { id: "errors", label: "Error log" },
  { id: "performance", label: "Performance log" },
];

export function LogsSheet(props: { tab: LogTab; onTab: (tab: LogTab) => void; onClose: () => void }) {
  const app = useApp();
  const crashes = createPagedList<CrashRecord>(() => ({ key: diagnosticsKeys.crashes, fetchPage: (before, limit) => client.crashList(before, limit) }));
  const usage = createPagedList<UsageRecord>(() => ({
    key: diagnosticsKeys.usage,
    fetchPage: (before, limit) => client.usageList(before, limit),
    enabled: app.settings().telemetry_opt_in,
  }));
  const errors = () => errorRows(crashes.rows(), app.activity());
  const recording = () => app.settings().telemetry_opt_in;
  return (
    <DialogFrame title="Logs" onEscape={props.onClose}>
      <div class="logs-tabs" role="tablist" aria-label="Logs">
        <For each={TABS}>
          {(tab) => (
            <button type="button" role="tab" class="btn sm" classList={{ on: props.tab === tab.id }} aria-selected={props.tab === tab.id} onClick={() => props.onTab(tab.id)}>
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <Show when={props.tab === "errors"}>
        <ul class="act-list logs-list" aria-label="Error log">
          <For each={errors()} fallback={<li class="setting-note act-empty">{crashes.loaded() ? NO_ERRORS : "Loading…"}</li>}>
            {(row) => (
              <li class="act-entry failed">
                <div class="act-head">
                  <span class="act-status bad">
                    <Icon name="warning" size={14} />
                  </span>
                  <span class="act-time">{formatAbsolute(row.time)}</span>
                  <span class="act-op">{row.kind}</span>
                  <span class="act-summary">{row.message}</span>
                </div>
              </li>
            )}
          </For>
        </ul>
        <Show when={crashes.hasMore()}>
          <div class="act-tools">
            <button type="button" class="btn sm" disabled={crashes.fetchingMore()} onClick={crashes.loadMore}>
              Show older crashes
            </button>
          </div>
        </Show>
        <Show when={crashes.failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      </Show>
      <Show when={props.tab === "performance"}>
        <Show
          when={recording()}
          fallback={
            <p class="setting-note" role="status">
              {USAGE_RECORDING_OFF}
            </p>
          }
        >
          <ul class="act-list logs-list" aria-label="Performance log">
            <For each={usage.rows()} fallback={<li class="setting-note act-empty">{usage.loaded() ? NO_USAGE : "Loading…"}</li>}>
              {(record) => (
                <li class="act-entry" classList={{ failed: !record.ok }}>
                  <div class="act-head">
                    <span class="act-status" classList={{ bad: !record.ok }}>
                      <Icon name={record.ok ? "check" : "warning"} size={14} />
                    </span>
                    <span class="act-time">{formatAbsolute(record.occurred_at)}</span>
                    <span class="act-op">{eventLabel(record.event)}</span>
                    <span class="act-summary">{usageOutcome(record)}</span>
                    <span class="act-time">
                      {formatDuration(record.duration_ms)} · {commandCount(record.count)}
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
          <Show when={usage.hasMore()}>
            <div class="act-tools">
              <button type="button" class="btn sm" disabled={usage.fetchingMore()} onClick={usage.loadMore}>
                Show older
              </button>
            </div>
          </Show>
          <Show when={usage.failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
        </Show>
      </Show>
      <div class="foot">
        <button type="button" class="btn primary" onClick={props.onClose}>
          Close
        </button>
      </div>
    </DialogFrame>
  );
}
