import { Show } from "solid-js";
import type { Composer } from "../state/composer";
import type { DiffTarget } from "../state/diffModel";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import type { Selection } from "../state/selection";
import { ChangesInspector } from "./ChangesInspector";
import { CommitInspector } from "./CommitInspector";
import { OperationInspector } from "./OperationInspector";

export function Inspector(props: {
  session: RepoSession;
  actions: RepoActions;
  composer: Composer;
  selection: Selection | undefined;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
  onSelectCommit: (sha: string) => void;
  onCommitted: (sha: string) => void;
}) {
  const commitSha = () => (props.selection?.kind === "commit" ? props.selection.sha : undefined);
  return (
    <Show
      when={commitSha()}
      fallback={
        <Show
          when={props.session.snapshot().operation === null}
          fallback={<OperationInspector session={props.session} actions={props.actions} activeTarget={props.activeTarget} onOpenDiff={props.onOpenDiff} />}
        >
          <ChangesInspector
            session={props.session}
            actions={props.actions}
            composer={props.composer}
            activeTarget={props.activeTarget}
            onOpenDiff={props.onOpenDiff}
            onCommitted={props.onCommitted}
          />
        </Show>
      }
    >
      {(sha) => (
        <CommitInspector
          session={props.session}
          sha={sha()}
          activeTarget={props.activeTarget}
          onSelectCommit={props.onSelectCommit}
          onOpenDiff={props.onOpenDiff}
        />
      )}
    </Show>
  );
}
