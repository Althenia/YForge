import { keepPreviousData } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { formatAbsolute, relativeAge, splitPath } from "../format";
import { client, IpcError } from "../ipc/client";
import { useNow } from "../state/clock";
import type { PlatformActions } from "../state/platformActions";
import { countOf, partialFilesNote } from "../state/listCount";
import { changeTotals, epochSeconds, fileBadgeClass, fileStatus, fileWord, mergeabilityView, platformFailure, prStateView } from "../state/platformModel";
import { statusIcon } from "../state/changes";
import { platformKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import type { RepoSession } from "../state/repoSession";
import { createIssueChips } from "../state/jiraIssues";
import { pullText } from "../state/jiraModel";
import { Delta } from "./CommitInspector";
import { IssueChips } from "./IssueChip";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

const MERGE_REASON = "Only an open pull request can be merged";

function When(props: { label: string; timestamp: string; now: number }) {
  const seconds = () => epochSeconds(props.timestamp);
  return (
    <div class="mrow">
      <span class="k">{props.label}</span>
      <span class="v" title={formatAbsolute(seconds())}>
        {formatAbsolute(seconds())} <span class="ago">· {relativeAge(seconds(), props.now)} ago</span>
      </span>
    </div>
  );
}

export function PullRequestInspector(props: { session: RepoSession; platform: PlatformActions; number: number }) {
  const path = props.session.path;
  const details = useQuery(() => ({
    queryKey: platformKeys.pr(path, props.number),
    queryFn: () => client.platformPrDetail(path, props.number),
    placeholderData: keepPreviousData,
  }));
  const chips = createIssueChips(() => (details.data === undefined ? [] : [pullText(details.data.pull)]));
  const now = useNow();
  const shown = () => (details.error == null ? details.data : undefined);
  const failure = () => (details.error == null ? undefined : platformFailure(details.error instanceof IpcError ? details.error : new IpcError({ kind: "internal", message: String(details.error) })));

  return (
    <aside class="panel inspector" aria-label="Pull request" aria-busy={details.isFetching}>
      <Show
        when={shown()}
        fallback={
          <div class="ihead">
            <h2>{failure() === undefined ? "Loading pull request…" : "Pull request unavailable"}</h2>
            <p class="ref">#{props.number}</p>
            <Show when={failure()}>
              {(problem) => (
                <p role="alert">
                  {problem().message}
                  <Show when={problem().action}>
                    <button type="button" class="btn sm" onClick={props.platform.editConnection}>
                      Edit connection
                    </button>
                  </Show>
                </p>
              )}
            </Show>
          </div>
        }
      >
        {(detail) => {
          const pull = () => detail().pull;
          const state = () => prStateView(pull().state);
          const merge = () => mergeabilityView(pull());
          const totals = () => changeTotals(detail().files);
          const filesPaging = () => ({ total: detail().files_total, capped: detail().files_capped });
          return (
            <>
              <div class="ihead">
                <h2>
                  #{pull().number} {pull().title}
                </h2>
                <Show when={chips.keysFor(pullText(pull())).length > 0}>
                  <p class="issue-chips">
                    <IssueChips keys={chips.keysFor(pullText(pull()))} lookup={chips.lookup} />
                  </p>
                </Show>
                <p>
                  <span class="chip pull-state" classList={{ "chip-success": state().tone === "ok", "chip-danger": state().tone === "danger" }}>
                    <Icon name={state().icon} size={14} />
                    {state().label}
                  </span>{" "}
                  {pull().author}
                </p>
                <div class="hrow ihead-actions">
                  <button type="button" class="btn sm" onClick={() => props.platform.openInBrowser(pull())}>
                    <Icon name="open" size={14} />
                    Open in browser
                  </button>
                  <button
                    type="button"
                    class="btn sm"
                    {...tip(pull().state === "open" ? "Merge pull request…" : MERGE_REASON, undefined, "Merge pull request")}
                    aria-disabled={pull().state === "open" ? undefined : "true"}
                    onClick={() => pull().state === "open" && props.platform.requestMerge(pull())}
                  >
                    <Icon name="merge" size={14} />
                    Merge…
                  </button>
                </div>
              </div>
              <div class="ilist commit-body">
                <Show when={pull().body}>{(body) => <p class="cbody">{body()}</p>}</Show>
                <div class="cmeta">
                  <div class="mrow">
                    <span class="k">Branches</span>
                    <span class="v">
                      <span class="ref">{pull().source_ref}</span> → <span class="ref">{pull().target_ref}</span>
                    </span>
                  </div>
                  <div class="mrow">
                    <span class="k">Author</span>
                    <span class="v">{pull().author}</span>
                  </div>
                  <When label="Created" timestamp={pull().created_at} now={now()} />
                  <When label="Updated" timestamp={pull().updated_at} now={now()} />
                  <div class="mrow">
                    <span class="k">Mergeable</span>
                    <span class="v" title={merge().detail}>
                      <span classList={{ "pull-merge-attention": merge().tone === "attention" }}>{merge().label}</span>
                    </span>
                  </div>
                  <div class="mrow">
                    <span class="k">Address</span>
                    <span class="v pull-url">{pull().web_url}</span>
                  </div>
                </div>
                <section aria-label="Files">
                  <div class="lhead">
                    <span class="lhead-title">
                      <Icon name="diff" />
                      Files · {countOf(detail().files.length, filesPaging())}
                    </span>
                    <span class="delta" aria-label={`${totals().additions} added, ${totals().deletions} removed`}>
                      <span class="plus">+{totals().additions}</span> <span class="minus">−{totals().deletions}</span>
                    </span>
                  </div>
                  <Show when={partialFilesNote(detail().files.length, filesPaging())}>{(note) => <p class="field-note note-line" role="status">{note()}</p>}</Show>
                  <Show when={detail().files.length > 0} fallback={<div class="empty">The platform reported no file changes</div>}>
                    <ul class="flist" aria-label="Changed files">
                      <For each={detail().files}>
                        {(file) => (
                          <li class="frow" aria-label={`${fileWord(file.status)} ${file.filename}`} title={file.filename}>
                            <span class={`badge ${fileBadgeClass(file.status)}`} role="img" aria-label={fileWord(file.status)} title={fileWord(file.status)}>
                              <Icon name={statusIcon[fileStatus(file.status)]} />
                            </span>
                            <span class="path">
                              <bdi dir="ltr">
                                <span class="dir">{splitPath(file.filename).directory}</span>
                                <span class="file">{splitPath(file.filename).name}</span>
                              </bdi>
                            </span>
                            <Delta file={file} />
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>
              </div>
              <div class="activity note-line">Files and counts are as the platform reports them.</div>
            </>
          );
        }}
      </Show>
    </aside>
  );
}
