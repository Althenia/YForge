import { useMutation, useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, createUniqueId, onMount, Show } from "solid-js";
import { client, IpcError } from "../ipc/client";
import { dataOf } from "../state/queryData";
import { historyKeys } from "../state/queryKeys";
import { dirtyReason, outcomeNotice, pushedRewriteWarning, rowsOf, squashMessage, squashOrder, squashProblem } from "../state/rebaseModel";
import type { RepoSession } from "../state/repoSession";
import { Icon } from "./Icon";

const short = (sha: string) => sha.slice(0, 7);

export function SquashDialog(props: { session: RepoSession; shas: readonly string[]; onClose: () => void }) {
  const path = props.session.path;
  const titleId = createUniqueId();
  const details = useQuery(
    () => ({ queryKey: historyKeys.squash(path, props.shas), queryFn: () => Promise.all(props.shas.map((sha) => client.commitDetails(path, sha))), staleTime: Infinity, gcTime: 0, retry: false }),
    () => props.session.queryClient,
  );
  const commits = () => (details.error == null ? dataOf(details) : undefined);
  const order = createMemo(() => {
    const found = commits();
    return found === undefined ? undefined : squashOrder(found.map((commit) => ({ sha: commit.sha, parents: commit.parents })));
  });
  const selectionProblem = () => {
    const found = commits();
    return found === undefined ? undefined : squashProblem(found.map((commit) => ({ sha: commit.sha, parents: commit.parents })));
  };
  const base = () => {
    const oldest = order()?.[0];
    return commits()?.find((commit) => commit.sha === oldest)?.parents[0];
  };
  const plan = useQuery(
    () => ({
      queryKey: historyKeys.rebase(path, base() ?? ""),
      queryFn: () => client.rebasePlan(path, base() as string),
      enabled: selectionProblem() === undefined && base() !== undefined,
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    }),
    () => props.session.queryClient,
  );
  const planned = () => (plan.error == null ? dataOf(plan) : undefined);
  const [typed, setTyped] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<IpcError | undefined>();
  const fullMessage = (sha: string) => {
    const commit = commits()?.find((entry) => entry.sha === sha);
    return commit === undefined ? "" : commit.body === "" ? commit.summary : `${commit.summary}\n\n${commit.body}`;
  };
  const defaultMessage = () => squashMessage((order() ?? []).map(fullMessage));
  const message = () => typed() ?? defaultMessage();
  const warning = () => {
    const current = planned();
    if (current === undefined) return undefined;
    const chosen = current.commits.filter((commit) => props.shas.includes(commit.sha));
    return pushedRewriteWarning(rowsOf({ ...current, commits: chosen }), props.session.snapshot().upstream?.name);
  };
  const planProblem = () => (plan.error instanceof Error ? plan.error.message : undefined);
  const missingFromBranch = () => {
    const current = planned();
    const missing = current === undefined ? undefined : props.shas.find((sha) => !current.commits.some((commit) => commit.sha === sha));
    return missing === undefined ? undefined : `${short(missing)} is not on the current branch`;
  };

  const squash = useMutation(
    () => ({ mutationFn: () => client.squashCommits(path, order() ?? [], message()) }),
    () => props.session.queryClient,
  );

  const reason = (): string | undefined => {
    if (commits() === undefined) return details.error == null ? "Reading the commits…" : (details.error as Error).message;
    return (
      selectionProblem() ??
      planProblem() ??
      missingFromBranch() ??
      (planned() === undefined ? "Reading the branch…" : undefined) ??
      (message().trim() === "" ? "Enter a message" : undefined) ??
      dirtyReason(props.session.snapshot().counts) ??
      (squash.isPending ? "Squashing…" : undefined)
    );
  };

  async function run(): Promise<void> {
    if (reason() !== undefined) return;
    setFailure(undefined);
    try {
      const result = await squash.mutateAsync();
      await props.session.refresh();
      const notice = outcomeNotice(result, "Squash");
      if (notice !== undefined) props.session.inform(notice);
      props.onClose();
    } catch (error) {
      setFailure(error instanceof IpcError ? error : new IpcError({ kind: "internal", message: String(error) }));
      await props.session.refresh();
    }
  }

  let area: HTMLTextAreaElement | undefined;
  onMount(() => queueMicrotask(() => area?.focus()));

  return (
    <div class="scrim" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        class="dialog squash-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={squash.isPending}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
          }
        }}
      >
        <h3 id={titleId}>Squash {props.shas.length} commits</h3>
        <p class="setting-note">
          Combines the selected commits into one commit that holds all of their changes. The other commits keep their order.
        </p>
        <Show when={order()}>
          {(shas) => (
            <ul class="dialog-names" aria-label="Commits to combine, oldest first">
              {shas().map((sha) => (
                <li>
                  <span class="ref">{short(sha)}</span> {commits()?.find((commit) => commit.sha === sha)?.summary}
                </li>
              ))}
            </ul>
          )}
        </Show>
        <Show when={warning()}>
          {(text) => (
            <div class="note attention" role="status">
              <Icon name="warning" /> {text()}
            </div>
          )}
        </Show>
        <label class="field">
          <span class="field-label">Message</span>
          <span class="input area mtext">
            <textarea ref={area} aria-label="Message" spellcheck={false} value={message()} onInput={(event) => setTyped(event.currentTarget.value)} />
          </span>
        </label>
        <Show when={failure()}>
          {(error) => (
            <p class="field-note error" role="alert">
              {error().message}
              <Show when={error().output}>{(output) => <pre class="out">{output()}</pre>}</Show>
            </p>
          )}
        </Show>
        <div class="foot">
          <Show when={reason()}>{(text) => <span class="reason">{text()}</span>}</Show>
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={reason() !== undefined} onClick={() => void run()}>
            <Icon name="squash" />
            Squash {props.shas.length} commits
          </button>
        </div>
      </div>
    </div>
  );
}
