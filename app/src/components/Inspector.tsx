import { Match, Switch } from "solid-js";
import type { Composer } from "../state/composer";
import type { DiffTarget } from "../state/diffModel";
import type { FileViewTarget } from "../state/fileView";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import type { Selection } from "../state/selection";
import { ChangesInspector } from "./ChangesInspector";
import { CommitInspector } from "./CommitInspector";
import { OperationInspector } from "./OperationInspector";
import { PullRequestInspector } from "./PullRequestInspector";
import type { PlatformActions } from "../state/platformActions";
import { StashInspector } from "./StashInspector";

export function Inspector(props: {
  session: RepoSession;
  actions: RepoActions;
  platform: PlatformActions;
  composer: Composer;
  selection: Selection | undefined;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
  onViewFile: (target: FileViewTarget) => void;
  onSelectCommit: (sha: string) => void;
  onCommitted: (sha: string) => void;
}) {
  const commitSha = () => (props.selection?.kind === "commit" ? props.selection.sha : undefined);
  const pullNumber = () => (props.selection?.kind === "pull" ? props.selection.number : undefined);
  const stash = () => {
    const current = props.selection;
    return current?.kind === "stash" ? props.session.snapshot().stashes.find((entry) => entry.sha === current.sha) : undefined;
  };
  return (
    <Switch
      fallback={
        <Switch
          fallback={
            <ChangesInspector
              session={props.session}
              actions={props.actions}
              composer={props.composer}
              activeTarget={props.activeTarget}
              onOpenDiff={props.onOpenDiff}
              onCommitted={props.onCommitted}
            />
          }
        >
          <Match when={props.session.snapshot().operation !== null}>
            <OperationInspector session={props.session} actions={props.actions} activeTarget={props.activeTarget} onOpenDiff={props.onOpenDiff} />
          </Match>
        </Switch>
      }
    >
      <Match when={pullNumber()}>{(number) => <PullRequestInspector session={props.session} platform={props.platform} number={number()} />}</Match>
      <Match when={stash()}>
        {(entry) => <StashInspector session={props.session} stash={entry()} actions={props.actions} activeTarget={props.activeTarget} onOpenDiff={props.onOpenDiff} onViewFile={props.onViewFile} />}
      </Match>
      <Match when={commitSha()}>
        {(sha) => (
          <CommitInspector session={props.session} actions={props.actions} sha={sha()} activeTarget={props.activeTarget} onSelectCommit={props.onSelectCommit} onOpenDiff={props.onOpenDiff} onViewFile={props.onViewFile} />
        )}
      </Match>
    </Switch>
  );
}
