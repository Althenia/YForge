import { Show } from "solid-js";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import { useNow } from "../state/clock";
import { issueFacts, statusTone } from "../state/jiraModel";
import { Icon } from "./Icon";

export function JiraIssueInspector(props: { issueKey: string; issue: JiraIssue | undefined; connection: JiraConnection | undefined; onOpen: (issue: JiraIssue) => void }) {
  const now = useNow();
  return (
    <aside class="panel inspector" aria-label="Issue">
      <Show
        when={props.issue}
        fallback={
          <div class="ihead">
            <h2>Issue {props.issueKey}</h2>
            <p>{props.issueKey} is no longer in your open issues assigned to you.</p>
          </div>
        }
      >
        {(issue) => {
          const facts = () => issueFacts(issue(), props.connection, now());
          const tone = () => statusTone(issue().status_category);
          return (
            <>
              <div class="ihead">
                <h2>Issue {issue().key}</h2>
                <p>{facts().origin}</p>
              </div>
              <div class="ilist commit-body">
                <p class="issue-summary">{issue().summary}</p>
                <div class="issue-chips">
                  <span class="chip" classList={{ "chip-info": tone() === "info", "chip-success": tone() === "ok" }}>
                    {issue().status}
                  </span>
                  <span class="chip">{issue().issue_type}</span>
                </div>
                <p class="field-note">
                  {facts().assignee} · {facts().updated}
                </p>
                <p class="field-note">Read-only. Status and comments change in Jira.</p>
                <div class="hrow ihead-actions">
                  <button type="button" class="btn sm" onClick={() => props.onOpen(issue())}>
                    <Icon name="open" size={14} />
                    Open in browser
                  </button>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </aside>
  );
}
