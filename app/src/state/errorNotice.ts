import type { ErrorKind } from "../ipc/bindings/ErrorKind";
import { IpcError } from "../ipc/client";

const operationNames: Record<string, string> = {
  repo_open: "Open repository",
  patch_apply: "Apply patch",
  patch_create: "Create patch",
  maintenance_run: "Repository maintenance",
  push_force: "Force push",
  platform_pr_merge: "Merge pull request",
};

const causes: Partial<Record<ErrorKind, string>> = {
  not_a_repository: "not a Git repository",
  uninitialized_folder: "not a Git repository",
  already_a_repository: "already a Git repository",
  git_missing: "Git was not found on PATH",
  git_too_old: "Git needs to be updated",
  local_changes: "local changes would be overwritten",
  push_rejected: "the remote rejected the push",
  not_fast_forward: "the branches cannot be fast-forwarded",
  conflict_markers: "conflict markers remain",
  worktree_dirty: "the worktree has uncommitted changes",
  branch_in_worktree: "the branch is checked out in another worktree",
  operation_in_progress: "another operation is in progress",
  auth_failed: "authentication failed",
  cancelled: "cancelled",
  stale_hunk: "the selected changes are out of date",
  unmerged_branch: "the branch has unmerged commits",
  file_too_large: "the file exceeds the size limit",
  ai_not_configured: "AI is not configured",
  ai_auth_required: "AI sign-in is required",
  ai_timeout: "the AI request timed out",
  network: "the network request failed",
};

const usable = (line: string): boolean => line !== "" && !/hint:|exited with status|could not run|(?:^|\s)git\s|`|:\(|^\s*(?:at |error:|fatal:)/i.test(line);

const TITLE_LIMIT = 80;
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\//i;
const ABSOLUTE_PATH = /(?<![\w.~/-])(?:[A-Za-z]:[\\/]|~\/|\/)(?:[^\s/\\'"`,;)]+[\\/])*[^\s/\\'"`,;)]+/g;

const lastSegment = (path: string): string => path.split(/[\\/]/).filter((segment) => segment !== "").pop() ?? path;

function shortCause(selected: string | undefined): string | undefined {
  if (selected === undefined || ADDRESS.test(selected)) return undefined;
  if (selected.includes("pathspec")) return selected.includes("did not match") ? "the selected path did not match" : undefined;
  return selected.replace(/^\S+ answered with (?=HTTP \d)/, "").replace(ABSOLUTE_PATH, lastSegment).split(/[.!?]\s+/)[0];
}

export function failureNotice(failure: unknown, operation?: string): string {
  const error = failure instanceof IpcError ? failure : undefined;
  const command = error?.command;
  const words = command?.replace(/_/g, " ");
  const name = operation ?? (command === undefined ? "Operation" : operationNames[command] ?? `${words?.charAt(0).toUpperCase()}${words?.slice(1)}`);
  const message = failure instanceof Error ? failure.message : String(failure);
  const text = `${error?.output ?? ""}\n${message}`.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const ignored = lines.findIndex((line) => /The following paths are ignored by one of your \.gitignore files:/.test(line));
  const ignoredPath = ignored < 0 ? undefined : lines[ignored + 1];
  const ignoredCause = ignoredPath !== undefined && usable(ignoredPath) ? `${ignoredPath} is ignored by .gitignore` : undefined;
  const diagnostic = lines.map((line) => /(?:^|:\s*)(?:fatal|error):\s*(.+)/i.exec(line)?.[1]?.trim()).find((line) => line !== undefined && usable(line));
  const plain = lines.find((line) => usable(line))?.replace(/^Invalid request:\s*/i, "");
  const selected = (error === undefined ? undefined : causes[error.kind]) ?? ignoredCause ?? diagnostic ?? plain;
  const cause = shortCause(selected)?.replace(/[.!]+$/, "");
  const title = cause === undefined ? undefined : `${name} failed: ${cause}`;
  return title !== undefined && title.length <= TITLE_LIMIT ? title : `${name} failed: See Activity for details`;
}
