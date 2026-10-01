import { For } from "solid-js";
import type { JiraIssueLookup } from "../ipc/bindings/JiraIssueLookup";
import { chipTitle } from "../state/jiraModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

/// A Jira issue key as a chip: the neutral issue glyph and the key in mono; the tooltip carries the summary and status when the site answered.
export function IssueChip(props: { issueKey: string; lookup: JiraIssueLookup | undefined }) {
  const title = () => chipTitle(props.issueKey, props.lookup);
  return (
    <span class="chip key" {...tip(title(), undefined, title())}>
      <Icon name="issue" size={14} />
      <span class="mono">{props.issueKey}</span>
    </span>
  );
}

export function IssueChips(props: { keys: readonly string[]; lookup: (key: string) => JiraIssueLookup | undefined }) {
  return <For each={props.keys}>{(key) => <IssueChip issueKey={key} lookup={props.lookup(key)} />}</For>;
}
