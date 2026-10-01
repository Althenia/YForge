import { createMemo, createSignal, For, Show } from "solid-js";
import { relativeAge } from "../format";
import type { LaunchpadPull } from "../ipc/bindings/LaunchpadPull";
import type { Wip } from "../ipc/bindings/Wip";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { useNow } from "../state/clock";
import { requestConnectKind, requestPullInspector } from "../state/connectRequest";
import { createIssueChips } from "../state/jiraIssues";
import { issueRowLabel, pullText, statusTone } from "../state/jiraModel";
import { createLaunchpad } from "../state/launchpad";
import {
  ALL_SOURCES,
  countText,
  groupPulls,
  issueSourceLines,
  LAUNCHPAD_TABS,
  MISSING_PULL_SERVICES,
  pullBadge,
  pullRowLabel,
  pullSourceLines,
  sourceChoices,
  sourceName,
  visibleIssues,
  visiblePulls,
  visibleWips,
  wipSourceLine,
  wipSummary,
  type LaunchpadTab,
  type SourceLine,
} from "../state/launchpadModel";
import { countOf } from "../state/listCount";
import { epochSeconds } from "../state/platformModel";
import { Icon } from "./Icon";
import { IssueChips } from "./IssueChip";
import { Select } from "./Select";
import { tip } from "./Tooltip";

function SourceLines(props: { lines: readonly SourceLine[] }) {
  return (
    <div class="lp-sources" role="status" aria-busy={props.lines.some((line) => line.state === "loading")}>
      <For each={props.lines}>
        {(line) => (
          <div class="status-line" classList={{ failed: line.state === "failed" }}>
            <Icon name={line.state === "loading" ? "sync" : line.state === "failed" ? "warning" : "check"} size={14} />
            {line.text}
          </div>
        )}
      </For>
    </div>
  );
}

export function Launchpad() {
  const app = useApp();
  const launchpad = createLaunchpad();
  const [tab, setTab] = createSignal<LaunchpadTab>("pulls");
  const [query, setQuery] = createSignal("");
  const [source, setSource] = createSignal(ALL_SOURCES);
  const now = useNow();

  const pulls = createMemo(() => visiblePulls(launchpad.pullSources(), query(), source()));
  const issues = createMemo(() => visibleIssues(launchpad.jira.sources(), query(), source()));
  const wips = createMemo(() => visibleWips(launchpad.wips(), query()));
  const chips = createIssueChips(() => pulls().map((row) => pullText(row.pull)));
  const allPulls = createMemo(() => launchpad.pullSources().flatMap((entry) => entry.pulls));
  const pullTotal = () => launchpad.pullSources().reduce((sum, entry) => sum + countOf(entry.pulls.length, entry), 0);
  const counts = (): Record<LaunchpadTab, string> => ({
    pulls: countText(pullTotal(), launchpad.pullSources().some((entry) => entry.loading)),
    issues: countText(launchpad.jira.total(), launchpad.jira.loading()),
    wips: countText(launchpad.wips().length, launchpad.wipsLoading()),
  });
  const choices = () => sourceChoices(tab(), launchpad.platformConnections(), launchpad.jira.connections());
  const failedPullSources = () => launchpad.pullSources().filter((entry) => entry.failure !== undefined);
  const failedIssueSources = () => launchpad.jira.sources().filter((entry) => entry.failure !== undefined);

  const choose = (next: LaunchpadTab) => {
    setTab(next);
    setSource(ALL_SOURCES);
  };

  const browse = (url: string) => {
    try {
      client.openUrl(url);
    } catch (failure) {
      app.setNotice(failure instanceof Error ? failure.message : String(failure));
    }
  };

  async function openPull(row: LaunchpadPull): Promise<void> {
    if (row.local_path === null) {
      browse(row.pull.web_url);
      return;
    }
    if (await app.openRepository(row.local_path)) requestPullInspector({ path: row.local_path, number: row.pull.number });
  }

  const connect = (kind: Parameters<typeof requestConnectKind>[0]) => {
    requestConnectKind(kind);
    app.addPlatformConnection();
  };

  const PullRow = (row: { pull: LaunchpadPull }) => {
    const badge = () => pullBadge(row.pull);
    return (
      <div class="lp-row">
        <button type="button" class="lp-open" aria-label={pullRowLabel(row.pull)} onClick={() => void openPull(row.pull)}>
          <Icon name="pullrequest" />
          <span class="lp-text">
            <span class="title">
              #{row.pull.pull.number} {row.pull.pull.title}
            </span>
            <span class="meta">
              <span>
                {row.pull.repo.owner}/{row.pull.repo.repo}
              </span>
              <span class="mono">
                {row.pull.pull.source_ref} → {row.pull.pull.target_ref}
              </span>
              <span>
                by {row.pull.pull.author} · {relativeAge(epochSeconds(row.pull.pull.updated_at), now())} ago
              </span>
              <Show when={row.pull.local_path === null}>
                <span>not cloned here</span>
              </Show>
            </span>
          </span>
        </button>
        <IssueChips keys={chips.keysFor(pullText(row.pull.pull))} lookup={chips.lookup} />
        <span class="chip" classList={{ "chip-attention": badge().tone === "attention", "chip-success": badge().tone === "ok" }}>
          <Show when={badge().icon}>{(icon) => <Icon name={icon()} size={14} />}</Show>
          {badge().label}
        </span>
        <button type="button" class="icon-btn dense" {...tip("Open in browser", undefined, `Open #${row.pull.pull.number} in browser`)} onClick={() => browse(row.pull.pull.web_url)}>
          <Icon name="open" size={14} />
        </button>
      </div>
    );
  };

  const WipRow = (row: { wip: Wip }) => (
    <div class="lp-row">
      <button type="button" class="lp-open" aria-label={`Open ${row.wip.name}, ${wipSummary(row.wip)}`} onClick={() => void app.openRepository(row.wip.path)}>
        <Icon name="folder" />
        <span class="lp-text">
          <span class="title">{row.wip.name}</span>
          <span class="meta">
            <Show when={row.wip.branch}>{(branch) => <span class="mono">{branch()}</span>}</Show>
            <span>{wipSummary(row.wip)}</span>
            <span class="path-line" title={row.wip.path}>
              {row.wip.path}
            </span>
          </span>
        </span>
      </button>
    </div>
  );

  return (
    <main class="launchpad" aria-label="Launchpad">
      <div class="lp">
        <div class="lp-head">
          <Icon name="launchpad" size={20} />
          <h1>Launchpad</h1>
          <span class="spacer" />
          <button type="button" class="icon-btn" aria-busy={launchpad.loading()} {...tip("Refresh")} onClick={launchpad.refresh}>
            <Icon name="sync" />
          </button>
        </div>
        <div class="lp-tabs" role="tablist" aria-label="Launchpad lists">
          <For each={LAUNCHPAD_TABS}>
            {(entry) => (
              <button type="button" role="tab" aria-selected={tab() === entry.id} classList={{ on: tab() === entry.id }} onClick={() => choose(entry.id)}>
                {entry.label} <b class="count">{counts()[entry.id]}</b>
              </button>
            )}
          </For>
        </div>
        <div class="lp-tools">
          <label class="input">
            <Icon name="search" />
            <input type="text" aria-label="Search Launchpad" placeholder="Search title, number, key, or repository" spellcheck={false} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <Show when={tab() !== "wips"}>
            <Select label="Source" value={source()} options={choices()} onChange={setSource} />
          </Show>
        </div>

        <Show when={tab() === "pulls"}>
          <Show
            when={launchpad.platformConnections().length > 0 || launchpad.platformPending()}
            fallback={
              <div class="lp-connect">
                <h2>No pull request service is connected</h2>
                <p class="setting-note">Pull requests appear here when YForge can read them from GitHub, GitLab, or Bitbucket, including self-managed servers. Each connection keeps its token in the macOS Keychain.</p>
                <div class="hrow">
                  <For each={MISSING_PULL_SERVICES}>
                    {(service) => (
                      <button type="button" class="btn" onClick={() => connect(service.kind)}>
                        <Icon name="plug" />
                        {service.label}
                      </button>
                    )}
                  </For>
                </div>
                <p class="field-note">My issues needs a Jira site (Settings → Jira). WIPs needs no connection.</p>
              </div>
            }
          >
            <SourceLines lines={pullSourceLines(launchpad.pullSources(), now())} />
            <Show when={failedPullSources().length > 0}>
              <div class="alert" role="alert">
                <For each={failedPullSources()}>
                  {(entry) => (
                    <p>
                      <strong>{sourceName(entry.connection)} could not be read</strong> {entry.failure?.message}
                    </p>
                  )}
                </For>
                <p class="field-note">The list shows the pull requests from the sources that answered; nothing was changed.</p>
                <div class="acts">
                  <button type="button" class="btn sm" onClick={launchpad.retryPulls}>
                    Retry
                  </button>
                  <Show when={failedPullSources().some((entry) => entry.failure?.action !== undefined)}>
                    <button type="button" class="btn sm" onClick={() => app.openSettings("platforms")}>
                      Edit connection
                    </button>
                  </Show>
                </div>
              </div>
            </Show>
            <For each={groupPulls(pulls())}>
              {(group) => (
                <div class="lp-group" role="group" aria-label={group.heading}>
                  <span class="sub">{group.heading}</span>
                  <For each={group.pulls}>{(row) => <PullRow pull={row} />}</For>
                </div>
              )}
            </For>
            <Show when={launchpad.pullSources().every((entry) => !entry.loading) && pulls().length === 0}>
              <p class="lp-empty" role="status">
                {allPulls().length === 0 ? "No open pull requests are authored by you or waiting for your review." : "No pull request matches the search."}
              </p>
            </Show>
          </Show>
        </Show>

        <Show when={tab() === "issues"}>
          <Show
            when={launchpad.jira.connected() || launchpad.jira.loading()}
            fallback={
              <div class="lp-connect">
                <h2>No Jira site is connected</h2>
                <p class="setting-note">Issues assigned to you that are not done appear here. The token stays in the macOS Keychain and YForge only reads from Jira.</p>
                <div class="hrow">
                  <button type="button" class="btn" onClick={() => app.openSettings("jira")}>
                    <Icon name="plug" />
                    Connect Jira
                  </button>
                </div>
              </div>
            }
          >
            <SourceLines lines={issueSourceLines(launchpad.jira.sources(), now())} />
            <Show when={failedIssueSources().length > 0}>
              <div class="alert" role="alert">
                <For each={failedIssueSources()}>
                  {(entry) => (
                    <p>
                      <strong>{entry.connection.host} could not be read</strong> {entry.failure?.message}
                    </p>
                  )}
                </For>
                <div class="acts">
                  <button type="button" class="btn sm" onClick={launchpad.jira.refresh}>
                    Retry
                  </button>
                  <button type="button" class="btn sm" onClick={() => app.openSettings("jira")}>
                    Edit connection
                  </button>
                </div>
              </div>
            </Show>
            <div class="lp-group">
              <For each={issues()}>
                {(issue) => (
                  <div class="lp-row">
                    <button type="button" class="lp-open" aria-label={issueRowLabel(issue)} onClick={() => browse(issue.web_url)}>
                      <Icon name="issue" />
                      <span class="lp-text">
                        <span class="title">
                          <span class="mono">{issue.key}</span> {issue.summary}
                        </span>
                        <span class="meta">
                          <span>{issue.issue_type}</span>
                          <span>{issue.project}</span>
                        </span>
                      </span>
                    </button>
                    <span class="chip" classList={{ "chip-info": statusTone(issue.status_category) === "info", "chip-success": statusTone(issue.status_category) === "ok" }}>
                      {issue.status}
                    </span>
                    <button type="button" class="icon-btn dense" {...tip("Open in browser", undefined, `Open ${issue.key} in browser`)} onClick={() => browse(issue.web_url)}>
                      <Icon name="open" size={14} />
                    </button>
                  </div>
                )}
              </For>
            </div>
            <Show when={!launchpad.jira.loading() && issues().length === 0 && failedIssueSources().length === 0}>
              <p class="lp-empty" role="status">
                {launchpad.jira.issues().length === 0 ? "No open issues assigned to you" : "No issue matches the search."}
              </p>
            </Show>
          </Show>
        </Show>

        <Show when={tab() === "wips"}>
          <SourceLines lines={[wipSourceLine({ count: launchpad.wips().length, loading: launchpad.wipsLoading(), failure: launchpad.wipsFailure(), updatedAt: launchpad.wipsUpdatedAt() }, now())]} />
          <Show when={launchpad.wipsFailure()}>
            {(failure) => (
              <div class="alert" role="alert">
                <strong>Recent repositories could not be read</strong>
                <p>{failure().message}</p>
                <div class="acts">
                  <button type="button" class="btn sm" onClick={launchpad.refresh}>
                    Retry
                  </button>
                </div>
              </div>
            )}
          </Show>
          <Show when={launchpad.wipsLoading() && launchpad.wips().length === 0}>
            <p class="lp-empty" role="status" aria-busy="true">
              Reading recent repositories …
            </p>
          </Show>
          <div class="lp-group">
            <For each={wips()}>{(wip) => <WipRow wip={wip} />}</For>
          </div>
          <Show when={!launchpad.wipsLoading() && wips().length === 0 && launchpad.wipsFailure() === undefined}>
            <p class="lp-empty" role="status">
              {launchpad.wips().length === 0 ? "No recent repository has uncommitted changes or unpushed commits." : "No repository matches the search."}
            </p>
          </Show>
        </Show>
        <p class="field-note">The Launchpad only reads. It never changes a pull request, an issue, or a repository.</p>
      </div>
    </main>
  );
}
