# Core–UI contract

Status: implemented for the first vertical slice (2026-09-29) and extended with the local working-tree loop, phase 2a (2026-09-30), branches, sync, and operations in progress, phase 2b (2026-09-30), and entry points, authentication prompts, settings, the command palette, search, and the Activity drawer with undo, phase 3b (2026-09-30). Decisions: Tauri 2 shell, system `git` (≥ 2.39) with porcelain v2 parsing, graph layout computed in Rust ([YFORGE_PRODUCT_DIRECTION.md](YFORGE_PRODUCT_DIRECTION.md) D4, D5).

## Architecture

```
SolidJS component
  → app/src/ipc/client.ts        (typed wrapper over @tauri-apps/api/core invoke)
  → Tauri invoke                 (IPC, JSON)
  → command in app/src-tauri     (async; runs core on a blocking thread; holds no Git logic)
  → crates/yforge-core           (pure Rust: parsers, layout, typed errors)
  → git CLI                      (std::process::Command with argument arrays; never a shell)
```

- `crates/yforge-core` owns every type that crosses the boundary. `app/src/ipc/bindings/*.ts` is generated from those types.
- The frontend calls the backend only through `client` in `app/src/ipc/client.ts`.
- Every git call runs as `git --no-pager -C <path> …` with `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `GIT_EDITOR=true`, and `GIT_MERGE_AUTOEDIT=no`, so git never waits for a terminal or an editor. Stdin is closed, except for `git apply` and `git check-ignore --stdin`, which receive their input on a pipe. Commands that take file paths run with `--literal-pathspecs` and pass paths after `--`.
- File arguments must be non-empty, relative, and free of `..`; otherwise the call fails with `invalid_request` before git runs.

## Commands

All commands are async. Argument names are camelCase on the wire; the current commands use single-word names. Success values are JSON with the field names below (snake_case, from serde).

| Command | Arguments | Result |
|---|---|---|
| `app_info` | none | `AppInfo { app_version, git_version }` |
| `launch_path` | none | `string`: `YFORGE_REPO`, else the first CLI argument, else the current directory (empty values are ignored) |
| `repo_open` | `path: string` | `RepoSnapshot` |
| `repo_graph` | `path: string`, `offset: number`, `limit: number` | `GraphPage` |
| `diff_file` | `path`, `file: string`, `area: "unstaged" \| "staged" \| "untracked"`, `ignoreWhitespace?: boolean` (default `false`; `true` adds `-w`) | `FileDiff` |
| `stage_files` | `path`, `files: string[]` | `null` |
| `unstage_files` | `path`, `files: string[]` | `null` |
| `stage_all` | `path` | `null` |
| `unstage_all` | `path` | `null` |
| `discard_files` | `path`, `files: string[]` | `null` |
| `stage_hunk` | `path`, `file: string`, `hunk: DiffHunk`, `ignoreWhitespace?: boolean` | `null`; `true` fails with `whitespace_ignored` |
| `unstage_hunk` | `path`, `file: string`, `hunk: DiffHunk`, `ignoreWhitespace?: boolean` | `null`; `true` fails with `whitespace_ignored` |
| `discard_hunk` | `path`, `file: string`, `hunk: DiffHunk`, `ignoreWhitespace?: boolean` | `null`; `true` fails with `whitespace_ignored` |
| `commit` | `path`, `summary: string`, `description: string`, `amend: boolean` | `string`: the new HEAD sha |
| `amend_info` | `path` | `AmendInfo` |
| `commit_details` | `path`, `sha: string` | `CommitDetails` |
| `commit_file_diff` | `path`, `sha: string`, `file: string` | `FileDiff` |
| `repo_watch` | `path` | `null`; starts (or replaces) the repository watcher that emits `repo-changed` |
| `check_branch_name` | `path`, `name: string` | `string`: the name, if `git check-ref-format --branch` accepts it unchanged; otherwise `invalid_request` |
| `checkout` | `path`, `target: CheckoutTarget`, `stash: boolean`, `leaveStashed?: boolean` | `CheckoutOutcome { auto_stash }`; `auto_stash` is `stashed` when the stash was left and recorded |
| `create_branch` | `path`, `name: string`, `at: string \| null`, `checkout: boolean` | `null` |
| `rename_branch` | `path`, `from: string`, `to: string` | `null` |
| `branch_delete_preview` | `path`, `name: string` | `CommitBrief[]`: the commits only this branch holds |
| `delete_branch` | `path`, `name: string`, `force: boolean` | `null` |
| `stash_push` | `path`, `message: string`, `untracked: boolean` | `null` |
| `stash_apply`, `stash_pop` | `path`, `index: number`, `sha: string` | `StashRestore` (`applied` or `conflicts`) |
| `stash_drop` | `path`, `index: number`, `sha: string` | `null` |
| `fetch` | `path`, `id: string`, `prune: boolean`, `interactive: boolean` (optional, default `true`; `false` never asks for credentials) | `null` |
| `pull` | `path`, `id: string`, `mode: PullMode` | `PullOutcome` (`up_to_date`, `updated`, `conflicts`) |
| `push` | `path`, `id: string` | `null` |
| `push_plan` | `path` | `ForcePushPlan { lease, upstream, replaced }` |
| `push_force` | `path`, `id: string`, `lease: ForceLease` | `null` |
| `operation_cancel` | `id: string` | `boolean`: true when an operation with that id was running and was told to stop; its pending authentication prompts are answered with `cancel` |
| `operation_continue` | `path`, `message: string \| null` | `OperationOutcome` (`completed` or `conflicts`) |
| `operation_skip` | `path` | `OperationOutcome` |
| `operation_abort` | `path` | `null` |
| `mark_resolved` | `path`, `files: string[]` | `null` |
| `integration_preview` | `path`, `base: string \| null`, `other: string` | `IntegrationPreview { incoming, outgoing, fast_forward }` |
| `merge` | `path`, `source: string`, `mode: "fast_forward" \| "merge_commit"` | `OperationOutcome` |
| `rebase` | `path`, `onto: string` | `OperationOutcome` |
| `fast_forward` | `path`, `branch: string`, `target: string` | `null` |
| `cherry_pick`, `revert` | `path`, `sha: string` | `OperationOutcome` |
| `reset` | `path`, `target: string`, `mode: "soft" \| "mixed" \| "hard"` | `null` |
| `create_tag` | `path`, `name: string`, `at: string \| null`, `message: string \| null` | `null` |
| `delete_tag` | `path`, `name: string` | `null` |
| `push_tag`, `delete_remote_tag` | `path`, `id: string`, `remote: string`, `name: string` | `null` |
| `conflict_file` | `path`, `file: string` | `ConflictFile` |
| `conflict_resolve` | `path`, `file: string`, `content: string` | `null` |
| `conflict_take_side` | `path`, `file: string`, `side: "current" \| "incoming"` | `null` |
| `conflict_reset` | `path`, `file: string` | `null` |

| `publish` | `path`, `id: string`, `remote: string` | `null`; `git push --set-upstream <remote> <branch>`; needs a commit and an existing remote |
| `clone_repo` | `id: string`, `url: string`, `destination: string` (absolute, the full target path) | `string`: the opened repository root. The destination must not exist or be empty; a failed or cancelled clone removes what it created |
| `init_repo` | `path: string` (absolute; created when missing) | `string`: the root. Uses the default branch from the app settings; `already_a_repository` when `path` is a repository root |
| `search_commits` | `path`, `query: string` | `SearchResult { total, rows }`: `rows` are graph row indexes of commits (and stashes) whose message, author name or email, or SHA prefix match, case-insensitive; `author:` and `sha:` restrict the field; an empty query matches nothing |
| `auth_respond` | `id: string` (the prompt id), `reply: AuthReply` | `boolean`: true when a prompt with that id was waiting |
| `settings_load` | none | `AppSettings` |
| `settings_save` | `settings: AppSettings` | `AppSettings`: the stored value (default branch trimmed); `invalid_request` for a bad branch name or an interval other than 0, 5, 10, 30 |
| `repo_settings_load`, `repo_settings_save` | `path`; `settings: RepoSettings` (save) | `RepoSettings { pull_mode, ssh_key_path }` / `null` |
| `identity_read` | `path: string \| null` (`null` is the global scope) | `Identity { name, email }`, each `{ value, source }` with `source` one of `repository`, `global`, `system`, `other`, `unset` |
| `identity_write` | `path: string \| null`, `field: "name" \| "email"`, `value: string \| null` (`null` unsets; an empty string is `invalid_request`) | `null` |
| `remotes_list` | `path` | `RemoteInfo[] { name, fetch_url, push_url }` |
| `remote_add`, `remote_edit`, `remote_remove` | `path`, `name`, `url` (add); `path`, `name`, `newName`, `url` (edit); `path`, `name` (remove) | `null`; names and addresses are validated (`invalid_request`) |
| `recents_list`, `recent_add`, `recent_remove` | none; `path`; `path` | `RecentRepo[] { path, opened_at }`, newest first, at most 30 |
| `recent_statuses` | `paths: string[]` | `RecentStatus[]` in the same order: `exists`, `branch`, `unborn`, `ahead_behind`, `counts`, `worktrees` |
| `session_load`, `session_save` | none; `session: TabSession { tabs, active }` | `TabSession` / `null` |
| `open_path` | `path`, `with: "editor" \| "terminal" \| "finder"` | `null`; runs the configured editor or terminal command with the path as its last argument, else the macOS default (`open -t`, `open -a Terminal`, `open -R`) |
| `activity_list`, `activity_clear` | none; `repo: string \| null` (`null` clears all) | `ActivityEntry[]` / `null` |
| `undo_last` | `path`, `id: number` | `string`: what was restored. Only the newest local, successful, not-yet-undone entry of that repository can be undone |
| `stage_lines`, `unstage_lines`, `discard_lines` | `path`, `file`, `hunk: DiffHunk`, `lines: number[]` (indexes into `hunk.lines`), `ignoreWhitespace?: boolean` | `null` |
| `edit_head_message` | `path`, `sha`, `summary`, `description` | `MessageEdit { sha, pushed }` |
| `delete_remote_branch` | `path`, `id`, `remote`, `name` | `null` |
| `set_upstream` | `path`, `branch`, `upstream: string \| null` (`null` unsets) | `null` |
| `push_to` | `path`, `id`, `target: PushTarget { remote, name, set_upstream }` | `null` |
| `stash_rename` | `path`, `index`, `sha`, `message` | `null` |
| `pull_with_autostash` | `path`, `id`, `mode: PullMode` | `PullReport { outcome: PullOutcome, stash: PullStash }` |
| `switch_stashes` | `path`, `branch` | `SwitchStash[] { branch, sha, message, created_at, index }` |
| `switch_stash_restore` | `path`, `branch`, `sha` | `StashRestore` |
| `switch_stash_dismiss` | `path`, `branch`, `sha` | `null` |
| `ssh_keys_list` | none | `SshKey[] { path, name, algorithm }` |
| `worktree_list` | `path` | `WorktreeStatus[] { path, head, branch, bare, locked, prunable, current, dirty }` |
| `worktree_suggest_path` | `path`, `branch` | `string` |
| `worktree_create` | `path`, `branch`, `create`, `start: string \| null`, `destination` (absolute) | `string`: the location |
| `worktree_remove` | `path`, `worktree`, `force` | `null` |
| `worktree_integrate` | `path`, `worktree`, `target`, `cleanup` | `WorktreeIntegration` |
| `rebase_plan` | `path`, `base: string` | `RebasePlan { base, commits: RebaseTodo[], pushed }`: `commits` run oldest first from `base` (exclusive, a commit id or full ref) to HEAD; `RebaseTodo { sha, summary, author, is_merge, pushed }`; `pushed` is true when the commit is reachable from `@{upstream}`, and on the plan when any commit is. `invalid_request` when `base` is not an ancestor of HEAD or the range is empty |
| `rebase_interactive` | `path`, `base`, `steps: RebaseStep[]` | `RebaseResult { outcome, pushed, dropped_all }` |
| `squash_commits` | `path`, `shas: string[]`, `message: string` | `RebaseResult` |
| `recompose_preview` | `path`, `base` | `RecomposePreview { base, head, pushed, files: RecomposeFile[] }` |
| `recompose_apply` | `path`, `base`, `groups: RecomposeGroup[]` | `RecomposeResult { head, pushed }` |
| `ai_providers_list` | none | `ProviderSummary[] { config: ProviderConfig, status: ProviderStatus, active }` in creation order |
| `ai_provider_add` | `input: ProviderInput { kind, name, base_url?, executable_path?, api_key? }` | `ProviderSummary`; `invalid_request` for a bad name (1–80 characters), a `base_url` on anything but `openai_compatible` (required there: https, or http only for loopback hosts; no credentials, query or fragment), a relative `executable_path` or one on an HTTP kind, or an `api_key` on a CLI kind |
| `ai_provider_update` | `update: ProviderUpdate { id, name, base_url?, executable_path?, api_key: ApiKeyChange }`; `ApiKeyChange` is `{ kind: "keep" }`, `{ kind: "set", key }`, or `{ kind: "clear" }` | `ProviderSummary`; the kind never changes |
| `ai_provider_remove` | `id` | `null`; deletes the Keychain entry and clears the active choice when it was this provider |
| `ai_set_active` | `id: string \| null`, `model: string \| null` | `null`; `id` must exist; `null` clears the choice; `model` is trimmed and stored on that provider (blank clears it) |
| `ai_provider_test` | `id` | `ProviderStatus` |
| `ai_provider_models` | `id` | `AiModel[] { id, name }` sorted by id (from `GET {base}/models`); `[]` for CLI providers, which take a free-text model id or `default` |
| `ai_sign_in` | `provider`, `id` (operation id), `method: "browser" \| "device_code"` | `ProviderStatus` after the CLI exits successfully; cancel with `operation_cancel(id)` |
| `ai_generate_commit_message` | `path`, `id` | `CommitDraft { summary, description, summary_trimmed, excluded, truncated }` |
| `ai_propose_recompose` | `path`, `id`, `base` | `RecomposeProposal { groups: RecomposeGroup[], excluded }` |
| `ai_propose_conflict` | `path`, `id`, `file` | `ConflictProposal { regions: { index, text, rationale }[] }` |

`client` also exposes `pickFolder(title)` (the native folder picker, `tauri-plugin-dialog`), `homeDirectory()`, and `onFolderDrop(handler)`, and the phase 3b commands as `publish`, `authRespond`, `searchCommits`, `cloneRepo`, `initRepo`, `settingsLoad`, `settingsSave`, `repoSettingsLoad`, `repoSettingsSave`, `identityRead`, `identityWrite`, `remotesList`, `remoteAdd`, `remoteEdit`, `remoteRemove`, `recentsList`, `recentAdd`, `recentRemove`, `recentStatuses`, `sessionLoad`, `sessionSave`, `openPath`, `activityList`, `activityClear`, `undoLast`, plus `onAuthPrompt(handler)` and `onActivity(handler)`.

`client` exposes them as `appInfo()`, `launchPath()`, `repoOpen(path)`, `repoGraph(path, offset, limit)`, `diffFile`, `stageFiles`, `unstageFiles`, `stageAll`, `unstageAll`, `discardFiles`, `stageHunk`, `unstageHunk`, `discardHunk`, `commit`, `amendInfo`, `commitDetails`, `commitFileDiff`, `repoWatch`, `checkBranchName`, `checkout`, `createBranch`, `renameBranch`, `branchDeletePreview`, `deleteBranch`, `stashPush`, `stashApply`, `stashPop`, `stashDrop`, `fetch`, `pull`, `push`, `pushPlan`, `pushForce`, `operationCancel`, `operationContinue`, `operationSkip`, `operationAbort`, `markResolved`, `integrationPreview`, `merge`, `rebase`, `fastForward`, `cherryPick`, `revert`, `reset`, `createTag`, `deleteTag`, `pushTag`, `deleteRemoteTag`, `conflictFile`, `conflictResolve`, `conflictTakeSide`, `conflictReset`, `onRepoChanged(handler)`, and `onOperationProgress(handler)`.

## Events

| Event | Payload | When |
|---|---|---|
| `repo-changed` | `RepoChanged { path }`: the `path` given to `repo_watch` | The watched repository changed |
| `operation-progress` | `OperationProgress { id, phase, percent }` | A `fetch`, `pull`, `push`, or `push_force` reports progress; `id` is the id the caller passed, `phase` is git's phase name (for example `Receiving objects`) or `Fetching <remote>`, and `percent` is 0–100 or `null` when the phase has no percentage |

| `auth-prompt` | `AuthPromptEvent { operation, prompt: AuthPrompt }` | A network command needs an answer. `operation` is the operation id; `prompt.id` is `<operation>/auth-<n>`; `prompt.kind` is `credentials` (HTTPS username and token; `username` is set when the address already names one), `passphrase` (an SSH key passphrase or another secret; `message` is git's prompt), or `host_key` (`host` and the SHA256 `fingerprint`) |
| `activity-recorded` | `ActivityEntry` | A command finished. The same `id` is emitted again when its undo status changes, so consumers upsert by `id` |
| `ai-sign-in` | `AiSignInEvent { operation, provider, stage }` | `ai_sign_in` progress. `stage` is `{ kind: "device_code", url, code }` (device-code method only; emitted once, when the CLI prints both) or `{ kind: "completed", status }` (after the CLI exits with 0 and the status was re-checked). Failures and cancellation reject the call instead |

The watcher (`crates/yforge-core/src/watch.rs`, the `notify` crate) watches the working tree recursively, plus the git directory and the common git directory when they live outside it (linked worktrees).

- **Counts as a change:** an event on a working-tree path that git does not ignore; a change to `HEAD`, `index`, `packed-refs`, or anything under `refs/` in a git directory. `*.lock` files in a git directory, other `.git` internals (objects, logs, and so on), and access-only events are dropped.
- **Ignore check:** after debouncing, the working-tree paths of a batch go through one `git check-ignore -z --stdin`. A batch whose paths are all ignored emits nothing. If the check cannot run, the batch counts as a change.
- **Debounce:** a batch closes after 150 ms without events, or after 1 s of continuous events. One event is emitted per batch.
- **Lifetime:** `repo_watch` replaces the previous watcher; dropping the watcher stops its thread.
- **Consumer:** the frontend refreshes the snapshot and the loaded graph pages on the event, and after every mutating command. Refreshes coalesce: a request made while one runs schedules one follow-up.

### `RepoSnapshot`

| Field | Meaning |
|---|---|
| `root` | Repository top level (`git rev-parse --show-toplevel`); the path may be any directory inside it |
| `head` | `{ kind: "branch", name, sha }`, `{ kind: "detached", sha }`, or `{ kind: "unborn", branch }` |
| `upstream` | `null`, or `{ name, ahead_behind }`; `ahead_behind` is `null` when git reports no counts (for example, a gone upstream) |
| `counts` | `{ modified, added, deleted, renamed, untracked, conflicted }`: one count per path, using the staged letter if any, else the unstaged letter; type changes count as modified and copies as renamed |
| `files` | `FileChange { path, original_path, area, status }`: `area` is `staged`, `unstaged`, `untracked`, or `conflicted`; a path changed on both sides appears once per side |
| `operation` | `null`, `merge`, `rebase`, `cherry_pick`, `revert`, `cherry_pick_sequence`, `revert_sequence`, or `bisect`, from `rebase-merge/`, `rebase-apply/`, `MERGE_HEAD`, `sequencer/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, and `BISECT_LOG` in the directory reported by `git rev-parse --git-dir`, checked in that order. A `sequencer/` directory (a multi-commit cherry-pick or revert, whether stopped on a conflict or paused after the conflict was committed) is a revert sequence when the first step of `sequencer/todo` is `revert` (or `r`), or when that file is empty or missing and `REVERT_HEAD` exists; otherwise a cherry-pick sequence |
| `worktrees` | `git worktree list --porcelain -z`: `{ path, head, branch, bare, locked, prunable, current }` |
| `branches`, `remote_branches`, `remotes`, `tags` | Names, sorted by ref name; `origin/HEAD` symrefs are omitted |
| `stashes` | `{ index, sha, base_sha, author_name, message, time }`, newest first |
| `operation_detail` | `null` unless `operation` is set; then `{ current, incoming, message, step, resolved }`. `current` is the checked-out branch (else the short HEAD id), or for a rebase the `onto` commit as a branch name (else its short id). `incoming` is the ref at `MERGE_HEAD` (local branches before remote-tracking ones, else the short id), the `<short id> <subject>` of `CHERRY_PICK_HEAD` or `REVERT_HEAD`, or the branch being rebased. `message` is `MERGE_MSG` without comment lines (merge only). For a sequence, `incoming` is the stopped commit, and `null` while the sequence is paused between commits. For a bisect, `current` is the content of `BISECT_START` (the branch or commit `git bisect reset` returns to), else the checked-out branch, and `incoming` is `null`. `step` is `{ current, total }` for a rebase (`rebase-merge/msgnum` and `end`, or `rebase-apply/next` and `last`). `resolved` lists paths that were conflicted and were then staged (`git ls-files --resolve-undo`), minus paths that are conflicted again |
| `last_fetch` | Unix seconds of the modification time of `FETCH_HEAD` in the git directory, or `null` if the repository was never fetched or pulled |

### `FileDiff`

`{ path, original_path, binary, hunks }` from `git diff --no-color --no-ext-diff --no-textconv --unified=3`.

- **Areas:** `unstaged` is the index against the work tree, `staged` is `HEAD` against the index, and `untracked` is `git diff --no-index /dev/null <file>`. `conflicted` is the file as it is in the work tree, with its conflict markers, diffed against `/dev/null` (`git diff --no-index`); a path that is not conflicted fails with `invalid_request`.
- **Renames:** only for `staged` (and commit diffs). `original_path` comes from the status entry of the staged file; otherwise it is `null`. Hunk commands read the diff without rename detection.
- **Binary:** `binary` is true when git reports `Binary files … differ`; `hunks` is then empty. A file with no textual change (or an empty untracked file) has no hunks and is not binary.
- **`DiffHunk`:** `{ old_start, old_lines, new_start, new_lines, heading, lines }`; `heading` is the text after the closing `@@` (git's function context).
- **`DiffLine`:** `{ kind: "context" \| "added" \| "removed", old_number, new_number, text, no_newline }`. `text` excludes the ± marker and keeps a trailing `\r`. Numbers are `null` on the side where the line does not exist. `no_newline` is true when git marked the line `\ No newline at end of file`.

### Hunk commands

`stage_hunk`, `unstage_hunk`, and `discard_hunk` take the `DiffHunk` exactly as `diff_file` returned it.

1. The core reads the current diff of the file (`unstaged` for stage and discard, `staged` for unstage) and requires a hunk equal to the given one (ranges, heading, and every line). If none matches, it fails with `stale_hunk` and touches nothing.
2. It builds a patch from the raw diff header and the hunk, and runs `git apply --whitespace=nowarn --check` (`--cached` for stage and unstage, `--reverse` for unstage and discard) on it; a failing check is also `stale_hunk`, carrying git's message.
3. It applies the same patch. Discard applies to the work tree only.

Hunk commands cover tracked files. An untracked file has no unstaged diff, so a hunk of it fails with `stale_hunk`; stage it as a file.

### File commands

- `stage_files`: `git add -- <files>` (adds, modifies, and stages deletions).
- `unstage_files` and `unstage_all`: `git reset --quiet [-- <files>]`; both work on a repository with no commits. A staged rename needs both names in `files`.
- `stage_all`: `git add --all`. It fails with `invalid_request` while any file is conflicted.
- `discard_files`: every listed file must have an `unstaged` or `untracked` entry, otherwise the call fails with `invalid_request` before changing anything. Tracked files are restored from the index (`git restore`), so staged content survives; untracked files are removed with `git clean --force`, only when listed.

### Commit commands

- `commit`: `git commit --quiet [--amend] -m <summary> [-m <description>]`, so hooks run. An empty summary fails with `invalid_request`. Any non-zero exit of git is `commit_failed`, whose `output` is the trimmed stdout followed by the trimmed stderr (this is where hook output appears). On success it returns `git rev-parse HEAD`.
- `AmendInfo`: `{ sha, summary, description, pushed }` for HEAD. `pushed` is true when `@{upstream}` exists and HEAD is its ancestor (`git merge-base --is-ancestor`); no upstream (or a detached HEAD) gives false. A repository with no commits fails with `invalid_request`.
- `CommitDetails`: `{ sha, summary, body, author, committer, parents, refs, files }`.
  - `author` and `committer` are `Signature { name, email, time }` (Unix seconds).
  - `refs` are the `GraphRef`s at the commit, with the checked-out branch first, as in the graph.
  - `files` are `CommitFile { path, original_path, status, additions, deletions }` against the first parent (the empty tree for a root commit), with rename detection. `additions` and `deletions` are `null` for binary files.
- `commit_file_diff` returns a `FileDiff` for one file of that comparison, with `original_path` for renames.
- `sha` must be 4–64 hexadecimal characters, otherwise `invalid_request`.

### Branch commands

- `check_branch_name`: runs `git check-ref-format --branch`; a non-zero exit, an empty name, or a name that git normalizes to something else (for example `@{-1}`) is `invalid_request`.
- `CheckoutTarget` is `{ kind: "local_branch", name }`, `{ kind: "remote_branch", name }` (the full name, for example `origin/feature/x`), `{ kind: "tag", name }`, or `{ kind: "commit", sha }`.
  - A local branch runs `git switch <name>`.
  - A remote branch runs `git switch --track <name>`, which creates the tracking branch; if a local branch of the short name already exists, the call fails with `invalid_request`.
  - A tag or commit runs `git switch --detach`. With a dirty work tree and `stash` false it fails with `local_changes` before running git.
  - Git's refusals to overwrite local changes (`would be overwritten`, `You have unstaged changes`, and similar) are `local_changes`; git's message is in `output`.
- `stash: true` (Stash and switch) runs `git stash push --include-untracked -m "YForge: auto-stash before switching to <label>"` when the work tree is dirty, switches, then runs `git stash pop`. `CheckoutOutcome.auto_stash` is `none` (nothing stashed), `restored`, `conflicts` (the pop conflicted; the stash is kept), or `kept` (the pop failed for another reason; the stash is kept). If the switch itself fails, the stash is popped again and the failure is returned; if that pop fails too, the error says the changes remain in `stash@{0}`.
- `create_branch`: `at` is `null` (HEAD), a commit id (4–64 hex characters), or a full ref name starting with `refs/`; it must resolve to a commit. `checkout` true uses `git switch --create`, false uses `git branch`. An invalid or existing name is `invalid_request`.
- `rename_branch`: `git branch --move`; the source must be a local branch and the new name valid and unused.
- `branch_delete_preview` lists (newest first) the commits reachable from the branch and from no other local branch, remote-tracking branch, or tag. `delete_branch` without `force` fails with `unmerged_branch` when that list is not empty; with `force` it runs `git branch --delete --force`. The checked-out branch and unknown branches are `invalid_request`.

### Stash commands

- `stash_push`: `git stash push [--include-untracked] [-m <message>]` with a trimmed message; when git saved nothing (no `refs/stash` change) the call fails with `invalid_request`. Entries are named `On <branch>: <message>`, or `WIP on <branch>: …` without a message.
- `stash_apply`, `stash_pop`, and `stash_drop` first check that `stash@{index}` is still `sha`, otherwise `invalid_request`. Apply and pop return `conflicts` when git failed and the work tree has conflicted files (pop keeps the stash then); any other failure is `git_failed`.

### Sync commands

`fetch`, `pull`, `push`, and `push_force` take an `id` chosen by the caller, run their network git processes with `--progress`, emit `operation-progress` events tagged with that id, and can be stopped with `operation_cancel`. The id must not be in use by a running operation (`invalid_request`).

- `fetch`: `git fetch --progress [--prune] <remote>` for each remote, in order, emitting `Fetching <remote>` before each. A repository without remotes is `invalid_request`.
- `pull`: needs a checked-out branch with an upstream. It fetches the upstream's remote (skipped for a local upstream), then integrates the upstream: `git merge --ff-only`, `git merge --no-edit`, or `git rebase`, for `PullMode` `fast_forward_only`, `fast_forward_or_merge`, or `rebase`. Cancelling is possible while fetching only. Results: `up_to_date`, `updated`, or `conflicts` (the merge or rebase state is left in place). A `fast_forward_only` pull that cannot fast-forward is `not_fast_forward`; git's refusal to overwrite local changes is `local_changes`.
- `push`: `git push --progress <remote> refs/heads/<branch>:<upstream ref>`. Without an upstream it pushes to `origin` (else the first remote) with `--set-upstream`. A rejected push (`[rejected]`, `[remote rejected]`) is `push_rejected`, with git's output in `output`.
- `push_plan` returns `ForcePushPlan { lease, upstream, replaced }`: `lease` is `{ remote, branch, remote_ref, expected_sha }` (the remote-tracking value at that moment), and `replaced` lists the commits in `HEAD..<upstream>`. It fails with `invalid_request` when `replaced` is empty.
- `push_force` takes that `lease` and runs `git push --progress --force-with-lease=<remote_ref>:<expected_sha> <remote> refs/heads/<branch>:<remote_ref>`. The lease is validated first (the remote exists, the branch exists, `remote_ref` is under `refs/heads/`, `expected_sha` is hexadecimal). If the remote moved since the plan, git rejects the push (`stale info`) and the call fails with `push_rejected`.
- Progress lines are git's `--progress` output split on `\r` and `\n`. A line of the form `[remote: ]<phase>: <n>%` becomes an event; repeated identical values are dropped.
- Cancellation kills the git process (`SIGKILL`) and the call fails with `cancelled`; the caller does not wait for grandchild processes to exit.
- Authentication is non-interactive: `GIT_TERMINAL_PROMPT=0`, and `ssh -o BatchMode=yes` unless `GIT_SSH`, `GIT_SSH_COMMAND`, or `core.sshCommand` is set. System credential helpers and ssh-agent work. A failure whose git output contains an authentication marker (`Authentication failed`, `could not read Username`, `terminal prompts disabled`, `Permission denied (publickey`, `returned error: 401` or `403`, and similar) is `auth_failed`, with the remote in the message (`Authentication failed for <remote>`) and git's output in `output`. An unreachable host or missing repository stays `git_failed`.

### Operation commands

For a merge, rebase, cherry-pick, revert, cherry-pick or revert sequence, or bisect in progress (`RepoSnapshot.operation`):

- `operation_continue`: fails with `invalid_request` while any file is conflicted, or when no operation is in progress. Merge: `git commit --quiet -m <message>` (a blank message is `invalid_request`), or `--no-edit` when `message` is `null`. Rebase, cherry-pick, revert, and their sequences: `--continue` of the matching command; a bisect has nothing to continue (`invalid_request`). When git stops again on conflicts (the next rebase step), the result is `conflicts`.
- `operation_skip`: `git rebase --skip`, or `git cherry-pick|revert --skip` for a sequence; any other operation is `invalid_request`. Result as for continue.
- `operation_abort`: `git merge|rebase|cherry-pick|revert --abort`; for a bisect, `git bisect reset`.
- `mark_resolved`: every file must be conflicted. If a file contains a conflict block (a line starting with `<<<<<<<`, later a line that is exactly `=======`, later a line starting with `>>>>>>>`), the call fails with `conflict_markers` and stages nothing. Otherwise it runs `git add --all -- <files>` (a deleted file stages its deletion).

### Integration commands

These run against the checked-out branch and fail with `invalid_request` while a merge, rebase, cherry-pick, revert, sequence, or bisect is in progress. `source`, `onto`, `branch`, and `target` are local branch names, or remote-tracking names such as `origin/main`; a tag is never accepted. The `OperationOutcome` is `completed`, or `conflicts` when git stopped with conflicted files (the operation is then in `RepoSnapshot.operation`; continue, skip, and abort use the operation commands).

- `integration_preview`: `base` (default `HEAD`) and `other` may be a branch name, `HEAD`, a commit id, or a full ref. `incoming` is `base..other` and `outgoing` is `other..base`, each `{ count, commits }` with at most 20 `CommitBrief` entries, newest first. `fast_forward` is true when `incoming.count > 0` and `outgoing.count == 0`.
- `merge`: `fast_forward` runs `git merge --ff-only` and fails with `not_fast_forward` when the branches diverged; `merge_commit` runs `git merge --no-ff`. A branch that shares its name with a tag is merged by its full ref. Overlapping local changes are `local_changes`.
- `rebase`: `git rebase <onto>`; local changes that block it are `local_changes`.
- `fast_forward`: `branch` must be a local branch. `not_fast_forward` when `target` does not contain it, `invalid_request` when it is already at `target`. The checked-out branch moves with `git merge --ff-only`; another branch moves with `git branch --force` after the ancestor check.
- `cherry_pick`, `revert`: `sha` must be a commit id that is not a merge commit (`invalid_request`). A pick or revert that changes nothing is aborted and reported as `invalid_request`.
- `reset`: `target` is a commit id, branch name, or full ref. `soft` keeps index and files, `mixed` keeps files, `hard` resets tracked files (untracked files stay).

### Tag commands

- `create_tag`: `at` is a commit id or full ref (default `HEAD`). A `message` makes an annotated tag (a blank message is `invalid_request`); `null` makes a lightweight tag. An existing or malformed name is `invalid_request`.
- `delete_tag`: local only.
- `push_tag`, `delete_remote_tag`: stream `operation-progress` under `id`, are cancelled with `operation_cancel`, and classify authentication and rejection like the sync commands. `remote` must be a remote of the repository.

### Conflict commands

`file` must be conflicted (`invalid_request` otherwise). Current is git's stage 2 (`--ours`: the checked-out branch, or the rebase target during a rebase) and incoming is stage 3.

- `conflict_file`: `ConflictFile { file, eol, final_newline, binary, sides, segments }`. `segments` alternates `{ kind: "text", lines }` and `{ kind: "conflict", current, incoming, base }` parsed from the working file (two-way, `diff3`, and `zdiff3`; `base` is `null` for two-way). An opening marker without a well-formed closing block stays plain text. `eol` is the majority line ending and `final_newline` records whether the file ended with one. `sides` says which of the index stages 1, 2, and 3 exist. A file that is not valid UTF-8 or contains NUL has `binary: true` and no segments; a file whose markers are gone has no conflict segments.
- `conflict_resolve`: refuses `content` that contains a conflict block (`conflict_markers`, nothing written), writes it atomically (temporary file in the same directory, permissions kept, then rename), then applies the `mark_resolved` rules.
- `conflict_take_side`: `git checkout --ours|--theirs -- <file>` and stage it; when that side deleted the file, `git rm` stages the deletion.
- `conflict_reset`: `git checkout --merge -- <file>` recreates the conflict markers from the index stages.

### Line commands

- `stage_lines`, `unstage_lines` and `discard_lines` apply the checks of the hunk commands, then keep only the chosen added and removed lines. Context indexes are ignored; at least one added or removed line must be chosen (otherwise `invalid_request`).
- Unchosen removed lines stay as context when staging; unchosen added lines stay as context when unstaging or discarding; the other side is dropped. The patch is validated with `git apply --check` first; a failed check is `stale_hunk`. Discard joins the `discard_files`/`discard_hunk` undo (blob snapshot).
- Any hunk or line command with `ignoreWhitespace: true` fails with `whitespace_ignored` before git runs.

### Edit message

- `edit_head_message` runs `git commit --amend --only` with the new message; the index and work tree are untouched and hooks run. It is refused with `not_head` when `sha` (4–64 hex characters, prefix match) is not HEAD, with `operation_in_progress` during a merge, rebase, cherry-pick, revert, or bisect, and with `invalid_request` for an empty summary. `pushed` is true when HEAD was on its upstream before the edit. Undo: as amend (`git reset --soft <previous HEAD>`).

### Remote branches and upstream

- `delete_remote_branch` runs `git push --progress <remote> --delete refs/heads/<name>` on the network runner. Undo pushes the recorded sha (the remote-tracking value before the delete, so it can be stale) back with `--force-with-lease=<ref>:`, refused when the name exists again; unavailable without a tracking ref.
- `set_upstream` uses `git branch --set-upstream-to=<ref>` or `--unset-upstream`. Undo restores the previous value, refused when the upstream changed since.
- `push_to` runs `git push --progress [--set-upstream] <remote> refs/heads/<current>:refs/heads/<name>`. A rejected update is `push_rejected`; no undo.

### Stash, auto-stash pull, and switch stashes

- `stash_rename` drops `stash@{index}` after the index and sha check, then stores the same commit with the new message at index 0 (newer entries shift down by one). The `On <branch>: ` prefix is kept; an empty message is `invalid_request`; if the store fails the old message is stored back.
- `pull_with_autostash` fetches, stashes (with untracked files) when the tree is dirty, integrates, then pops. `PullStash` is `none`, `restored`, or `kept { reference, sha, reason }` with `reason` `pull_conflicts`, `restore_conflicts`, or `restore_failed`. A refused integration pops the stash back before returning the error. No undo.
- `checkout` with `stash: true` and `leaveStashed: true` stashes, records the stash under (repository root, branch left) in `switch_stashes` (`yforge.db`, migration 2), and switches without popping. A failed switch pops the stash back and removes the record; a detached HEAD with changes is `invalid_request`.
- `switch_stashes` lists the live recorded stashes for a branch, newest first, with their current index, pruning records whose stash is gone. `switch_stash_restore` runs a tracked stash pop and clears the record; `switch_stash_dismiss` clears the record and keeps the stash.

### SSH key

- `ssh_key_path` (app and repository settings; the repository value wins) must be an absolute existing file; blank means ssh-agent; anything else is `invalid_request`.
- With a key, every network command runs with `GIT_SSH_COMMAND=ssh -i '<key>' -o IdentitiesOnly=yes` (plus `-o BatchMode=yes` when no auth handler is set), overriding `core.sshCommand` and the user's `GIT_SSH_COMMAND`. Without one, behavior is unchanged.
- `ssh_keys_list` lists files in `~/.ssh` with a `.pub` sibling, sorted by name; `algorithm` is the first token of the `.pub`. `invalid_request` when `HOME` is unset.

### Worktrees

- `worktree_suggest_path` returns `<parent of the main worktree>/<repo>-<branch with / replaced by ->`.
- `worktree_create` runs `git worktree add`: `create: true` adds `-b <branch> [start]` (start points follow `create_branch`); `false` checks out an existing local branch not held by another worktree. The destination must be absolute and absent or an empty folder.
- `worktree_remove` is refused with `worktree_dirty` when the worktree has changes or untracked files and `force` is false, and with `invalid_request` for the main, the current, a locked, or an unknown worktree. A worktree whose directory is gone is removed with `--force`.
- `worktree_integrate` needs a settled (`operation_in_progress`) and clean (`worktree_dirty`) source and a target checked out in some worktree. It runs `git rebase refs/heads/<target>` in the source worktree, then `git merge --ff-only refs/heads/<branch>` in the target's worktree, then with `cleanup: true` `git worktree remove` and `git branch --delete --force`. The result is identical to running those commands in a terminal (fixture test compares the resulting graphs). Rebase conflicts return `{ kind: "conflicts", worktree }` and leave the rebase in place; success is `{ kind: "integrated", target_sha, cleaned_up }`. Create, remove, and integrate record activity with no undo.

### History editing

- `RebaseStep` is `{ kind: "pick" | "fixup" | "drop" | "edit", sha }` or `{ kind: "reword" | "squash", sha, message }`; `sha` is 4–64 hex characters matching one commit of the range.
- `rebase_interactive` runs `git rebase --interactive --no-autostash <base>` with `GIT_SEQUENCE_EDITOR` pointing at a script in a private temporary directory that writes a generated todo (removed afterwards), so git never opens an editor. Steps run in the given order; a commit of the range with no step is dropped, so an empty list drops every commit (`dropped_all: true`, HEAD moves to `base`).
- `reword` and `squash` messages are applied by an `exec git commit --amend -m <message>` line in the todo, so they survive conflict and edit stops. `squash` and `fixup` join the previous kept commit; a run's message is the `message` of its last `squash`, else the reword message of its first commit, else the first commit's message. A message must be non-blank and free of NUL.
- Refusals (nothing changes): `invalid_request` for a first kept step of `squash` or `fixup`, an unknown, ambiguous or repeated sha, a blank message, a base that is not an ancestor of HEAD, or an empty range; `operation_in_progress` during a merge, rebase, cherry-pick, revert, or bisect; `merge_commit_in_range` when any commit of `base..HEAD` is a merge commit (`--rebase-merges` is not supported). Dirty tracked files are refused by git as `local_changes`.
- `RebaseResult.outcome` is `completed`, `conflicts` (stopped in the normal rebase state; continue, skip, abort and the resolver apply), or `stopped_to_edit` (an `edit` step stopped; amend or change files, then `operation_continue`). `pushed` is true when any commit of `base..HEAD` is reachable from `@{upstream}`; the UI warns. A failing `exec` (for example a rejecting commit-msg hook) leaves the rebase in progress and fails with `git_failed`.
- `RepoSnapshot.operation_detail.stopped_edit` is the sha of the commit being edited while a rebase is stopped for an `edit` step, else `null` or absent.
- `squash_commits` needs at least two distinct shas forming one contiguous run on the current branch whose oldest commit has a parent (`invalid_request` otherwise); it runs `rebase_interactive` with `pick` for the other commits of `<parent of oldest>..HEAD`, `pick` for the oldest selected commit, and `squash` with `message` for the rest.
- `recompose_preview` returns the combined diff `base..HEAD` (`--no-renames`, so a rename is a delete plus an add) as `RecomposeFile { path, status, binary, whole_file_only, hunks: RecomposeHunk[] }` with `RecomposeHunk { id, hunk }`; a hunk `id` is `<path>@<old_start>,<old_lines>+<new_start>,<new_lines>`, stable for a given `base` and HEAD. `whole_file_only` is true for binary files, files without hunks, and mode or type changes.
- `RecomposeGroup { message, changes: RecomposeChange[] }`; a change is `{ kind: "file", path }`, `{ kind: "hunk", id }`, or `{ kind: "lines", id, lines }` (indexes into the hunk's lines; at least one added or removed line). Hunk and line changes on a `whole_file_only` file are `invalid_request`.
- `recompose_apply` refuses with `operation_in_progress`, `merge_commit_in_range`, `local_changes` (dirty working tree or index; untracked files are ignored), and `invalid_request` for no groups, a blank message, an empty group, an unknown path, hunk or line, an empty range or diff, and any change of `base..HEAD` not assigned to exactly one group (the message lists the paths). It records HEAD, runs `git reset --mixed <base>`, stages each group's changes cumulatively from base, and commits with its message (hooks run). The final commit's tree must equal the original HEAD tree; any failure, including a rejected commit or a tree mismatch, runs `git reset --hard <recorded HEAD>` and returns the error.
- Undo (activity `Interactive rebase`, `Squash commits`, `Recompose`): `git reset --hard <recorded HEAD>`, refused when HEAD moved or the tracked working tree is not clean; unavailable when the rewrite stopped on conflicts or for an edit.

### AI assistance

- **Opt-in:** nothing is sent until the user runs an AI command, and only to the active provider. Every Git workflow works without a provider. The three feature commands return drafts only: they never commit, rewrite history, or write files.
- **Providers** (`yforge.db` migration 3, table `ai_providers(seq, id, kind, name, base_url, model, executable_path, has_api_key, created_at)`; the active id is the settings key `ai.active_provider`):
  - `chatgpt`: the installed Codex CLI. Status is `codex login status` (exit 0 is `ready`; "Not logged in" is `signed_out`). It cannot detect a revoked token, so that failure surfaces as `ai_auth_required` from the first real call. Sign-in runs `codex login`, or `codex login --device-auth` (the URL and one-time code are read from its output and sent as `ai-sign-in`).
  - `claude_code`: the installed `claude` CLI. Status is `claude auth status --json`, reading only `loggedIn`. Sign-in runs `claude auth login` (browser only).
  - `openrouter`: `https://openrouter.ai/api/v1` with an API key. `openai_compatible`: any number of instances with a base URL and an optional key.
  - YForge never reads, refreshes, or stores CLI tokens.
- **API keys** live only in the macOS Keychain (`keyring`, service `dev.yforge.desktop.ai`, account = provider id); the database keeps only `has_api_key`. Keys never appear in `yforge.db`, logs, crash records, or activity output.
- **`ProviderStatus`:** `ready`, `not_installed`, `signed_out`, `key_missing`, `key_rejected`, `unreachable { message }`, `check_failed { message }`. The list makes no network call for HTTP providers (`ready` means configured). `ai_provider_test` calls `GET {base}/models` (401/403 is `key_rejected`, no connection is `unreachable`); OpenRouter's model list is public, so a bad OpenRouter key shows only on the first real call.
- **CLI runs:** the binary comes from an explicit path, else `$SHELL -lc 'command -v <bin>'` (5 s timeout), else the known folders. Each run uses a private temporary working directory, removed afterwards, with the prompt on stdin. Codex: `exec --json --color never -s read-only --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules -C <tmp> -o <tmp>/last-message.txt [-m <model>] -`. Claude: `-p --output-format json --tools "" --safe-mode --no-session-persistence --strict-mcp-config --disable-slash-commands --system-prompt <fixed text> [--model <model>]`. A blank or `default` model passes no model flag. Cancel and timeout kill the process.
- **HTTP runs:** `POST {base}/chat/completions` with `{ model, stream: false, messages: [system, user] }` and `Authorization: Bearer` only when a key exists. TLS is always verified and redirects are not followed.
- **Privacy filter:** files whose base name matches `.env*`, `*.pem`, `*.key`, `id_rsa*`, or `credentials*` (case-insensitive) are not sent; they are listed in `excluded`, and commit and recompose name them with content withheld. A conflicted file of that kind is refused. Commit diffs are capped at 20 KB per file and 60 KB in total (`truncated` lists cut files); binary files go by name only. Recompose hunk content is capped at 4 KB per hunk and 60 KB in total.
- **`ai_generate_commit_message`:** sends the staged diff plus the last 10 commit subjects and expects `{ "summary", "description" }`; `summary_trimmed` is true when the summary was cut to its first line or to 72 characters. Nothing staged, or only secret files staged, is `invalid_request`.
- **`ai_propose_recompose`:** expects groups of `{ "kind": "hunk", "id" }` or `{ "kind": "file", "path" }` changes with messages; every hunk of a splittable file and every whole-file unit must be assigned exactly once. The result is ready for `recompose_apply`.
- **`ai_propose_conflict`:** sends each region's current, incoming, and base (when present) with 3 lines of context and expects exactly one `{ index, text, rationale }` per region; `index` counts the `conflict` segments of `ConflictFile.segments` from 0. `text` is the replacement lines joined with `\n`; the UI joins with the file's `eol` and puts it in the Result pane. Marking the file resolved stays manual. Secret, binary, and over-60 KB conflicted files are `invalid_request`.
- **Cancellation:** each feature command registers its operation id; `operation_cancel` stops the request or process with `cancelled`.
- **Activity and usage:** each feature call that reaches a provider records an activity entry (`AI commit message`, `AI recompose proposal`, `AI conflict proposal`; not local, no commands, no undo) whose summary is `<provider name> · <model>`; on failure `error` holds only the error kind. With `telemetry_opt_in` the usage event adds `provider` (kind) and `model` only, never prompt or response content, paths, or messages.
- **Tests:** `crates/yforge-ai/tests/` use fake `codex`/`claude` scripts and fake login shells, a `TcpListener` HTTP fake, and an in-memory `SecretStore`; `live.rs` is an ignored smoke test. `app/src-tauri/tests/ai.rs` covers the commands.

### `GraphPage`

`{ rows, carried, total }` for the window `[offset, offset + limit)` of the full layout. `total` counts all rows, including the Changes row and stash rows.

- **Order:** `git log --topo-order --exclude=refs/stash --all`, newest first. Stash rows sit before the first commit that is not newer than the stash, and always before their base commit. A Changes row is row 0 when the working tree has any change, and its parent is HEAD.
- **Row:** `sha` (`null` for Changes), `parents`, `summary`, `author { name, initials }` (`null` for Changes), `time` (Unix seconds; `null` for Changes), `refs { name, kind, is_head }` with `kind` of `local_branch`, `remote_branch`, or `tag` (annotated tags are peeled), `kind` of `commit`, `merge`, `stash`, or `changes`, `column`, and `edges`.
- **Edge:** `{ lane, parent_row, parent_column }`. `lane` is the column the edge runs along. `parent_row` and `parent_column` are global row and column indices, or `null` when the parent is not in the graph. The renderer draws node → lane on the child's row, down the lane, then into the parent's column on the parent's row.
- **Carried edges:** `carried` holds `{ row, column, kind, edge }` for edges from rows above `offset` whose parent is at or below `offset` (or outside the graph). With them a client can draw any window without loading earlier pages.
- **Lane algorithm:** COMPONENT_SPECS § Graph row, "Lane model (S13)". It is a port of `layout()` in `docs/design/specimens/workspace.html` (`crates/yforge-core/src/layout.rs`).

## Errors

Every command rejects with a tagged `ErrorPayload { kind, message, output }`. `output` is `null` except for `commit_failed`, `auth_failed`, `local_changes`, `push_rejected`, `not_fast_forward`, `ai_auth_required`, and `ai_failed`. The client rethrows it as `IpcError` (`kind`, `message`, `output`); a non-payload rejection becomes `IpcError` with kind `internal`.

| `kind` | Cause |
|---|---|
| `not_a_repository` | The path is missing, not a directory, or not inside a Git work tree |
| `git_missing` | `git` was not found on `PATH` |
| `git_too_old` | `git --version` is below 2.39 |
| `git_failed` | A git command exited non-zero; the message carries the command, status, and stderr |
| `invalid_git_output` | Git output did not match the expected porcelain format |
| `invalid_request` | The arguments are unusable: no files, a path that is absolute or contains `..`, a conflicted diff area, an empty commit summary, a malformed commit id, a discard target with nothing to discard, `stage_all` while files are conflicted, or an amend with no commit |
| `stale_hunk` | The hunk no longer matches the file, or its patch failed `git apply --check` |
| `commit_failed` | `git commit` exited non-zero; `output` carries the stdout and stderr (hook output) |
| `watch_failed` | The file watcher could not be started |
| `auth_failed` | A fetch, pull, or push was refused for missing or wrong credentials; the message names the remote and `output` carries git's output |
| `cancelled` | The operation was stopped with `operation_cancel` |
| `local_changes` | A switch, pull, or continue would overwrite local changes, or a detached checkout found a dirty work tree; `output` carries git's message |
| `push_rejected` | The remote refused the push (non-fast-forward, stale lease, or a remote hook); `output` carries git's output |
| `not_fast_forward` | A fast-forward-only pull, `merge` in `fast_forward` mode, or `fast_forward` found a branch that cannot move forward |
| `conflict_markers` | `mark_resolved` found conflict markers in a file, or `conflict_resolve` was given content with a conflict block |
| `unmerged_branch` | `delete_branch` without `force` would leave commits without a name |
| `already_a_repository` | `init_repo` found a repository root at the path; the message carries the path |
| `storage_failed` | A settings, recents, or session file could not be read, parsed, or written; the file is left untouched |
| `whitespace_ignored` | A hunk or line command was sent from a whitespace-ignored diff |
| `worktree_dirty` | Removing or integrating a worktree that has uncommitted changes |
| `operation_in_progress` | Editing a message or integrating while a merge, rebase, cherry-pick, revert, or bisect is in progress |
| `not_head` | `edit_head_message` was given a commit that is not HEAD |
| `merge_commit_in_range` | A history rewrite (`rebase_interactive`, `squash_commits`, `recompose_preview`, `recompose_apply`) found a merge commit in `base..HEAD`; the message names it |
| `ai_not_configured` | No active provider, or an HTTP provider without a model |
| `ai_provider_unavailable` | The CLI was not found (login shell, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, or the provider's explicit path), or the endpoint could not be reached; the message carries the reason |
| `ai_auth_required` | The CLI is signed out or its token was refused, the endpoint answered 401/403, or the OpenRouter key is missing from the Keychain; `output` is the sanitized provider message |
| `ai_invalid_response` | The reply is not one JSON value, fails the schema, or fails validation (recompose: a change unknown, repeated or unassigned, blank message, no groups; conflict: a missing, repeated or unknown region, or conflict markers in a text); nothing is repaired |
| `ai_failed` | The provider failed in another way; `output` is sanitized (colour codes removed, URL credentials, `Authorization`/`password=` lines, `Bearer` and `sk-` tokens and the stored key masked, at most 2,000 characters) |
| `ai_timeout` | No answer within 180 s (completion), 20 s (status, models), or 16 min (sign-in) |
| `internal` | The blocking task failed (for example, a panic) |

## Threading and cancellation

- Commands are `async`. Git work runs through `tauri::async_runtime::spawn_blocking`, off the main thread.
- Each call runs its own git processes and returns one response. The shared state is the single repository watcher held by the shell (`repo_watch`) and the core's graph layout cache.
- Mutating commands take git's own locks; a concurrent git process in the terminal surfaces as `git_failed` with git's message.
- `repo_graph` and `search_commits` reuse one computed history and layout per repository root. The cache key is every ref and its target (`git for-each-ref`), the HEAD commit, the stash commits, and whether the working tree has changes; any difference recomputes the full layout, and the working-tree summary text is always read fresh. Pages are consistent only while the key does not change between calls. The ignored test `crates/yforge-core/tests/graph_perf.rs` gates the first page at under 1 s for 10k commits and under 3 s for 100k commits (`cargo test --release -p yforge-core -- --ignored`).
- `fetch`, `pull`, `push`, `push_force`, `push_tag`, `delete_remote_tag`, `publish`, and `clone_repo` register their `id` in a registry held by the shell (`OperationRegistry`); `operation_cancel` sets the cancel flag of the registered operation, and the id is removed when the call ends.
- Deferred: cancelling any call other than the network commands, incremental layout, cherry-pick and revert of merge commits (parent choice).

## Authentication prompts

- A network command builds its `CancelToken` with an auth handler. `run_streaming` then starts a per-operation askpass bridge: a private temporary directory (mode 0700) holding a POSIX shell helper, exported as `GIT_ASKPASS` and `SSH_ASKPASS` (with `SSH_ASKPASS_REQUIRE=force`). The helper writes each prompt to a request file and waits for a response file; the bridge thread classifies the prompt, calls the handler, and writes the answer (mode 0600). The directory is removed when the git command ends, and a helper whose directory vanished exits, so cancelling leaves no process behind.
- The shell's handler emits `auth-prompt` and blocks for `auth_respond`, `operation_cancel`, or a 120 s timeout. A cancel or decline ends the git command with `cancelled`; a timeout ends it as `auth_failed`. Git does not re-ask after a rejected HTTPS credential, so a wrong token also ends as `auth_failed`, and the next attempt prompts again.
- HTTPS: the username prompt is answered with the entered username, and the following password prompt with the entered token, without a second dialog. When the operation succeeds, `git credential approve` runs for a credential the user chose to save and `git credential reject` for one they did not (git itself already offered it to the configured helper). Nothing else stores credentials.
- SSH: passphrases go to ssh through the same helper; an unknown host key arrives as a `host_key` prompt (`SSH_ASKPASS_PROMPT=confirm`) and `trust` answers `yes`. ssh-agent keeps working: the agent answers before any prompt. A token without a handler (auto-fetch with `interactive: false`, and every direct core call) keeps `ssh -o BatchMode=yes` and `GIT_TERMINAL_PROMPT=0`.
- Secrets never reach a log: the shell logs prompt ids, kinds, and hosts, and only the variant name of a reply. Command lines, git errors, and recorded output pass through `redact` (URL user info, `password=`, `Authorization`, `extraheader` lines).

## Activity and undo

- The shell wraps every mutating command in a thread-local recorder. Each `git` invocation except read-only queries (`rev-parse`, `status`, `log`, `diff`, `for-each-ref`, `config --get`, and similar) becomes a `CommandRecord { command, status, duration_ms, output }` with secrets redacted and output capped at 64 KB (hook output included). One `ActivityEntry { id, repo, operation, summary, started_at, duration_ms, ok, local, toast, error, commands, undo }` is kept per command in an in-memory log (300 entries, this session only) and announced with `activity-recorded`. `local` is true for operations that change refs, history, or discard content; `toast` marks the outcomes the UI reports.
- `undo` is `available { scope }`, `unavailable { reason }`, or `undone`. The scope names what undo will do and is the button tooltip.
- Undoable operations, with what `undo_last` does (each first requires that no merge, rebase, cherry-pick, revert, sequence, or bisect is in progress):

| Operation | Undo | Refused when |
|---|---|---|
| `commit` | `git reset --soft <previous HEAD>` (changes stay staged); unavailable for a first commit | HEAD or the branch moved |
| `commit` with amend | `git reset --soft <pre-amend HEAD>` | HEAD or the branch moved |
| `create_branch` | delete the branch, switching back first when it was checked out | the branch has new commits or is gone |
| `delete_branch` | recreate it at the recorded sha, restoring its upstream | the name exists again |
| `checkout` | switch back to the previous branch or detached commit; unavailable when the auto-stash was kept | HEAD is no longer where the checkout left it, or git refuses the switch |
| `stash_pop`, `stash_apply` | discard the applied changes (and store the entry again after a pop) | the tree differs from the recorded post-apply tree; unavailable when the tree was dirty before, the stash has untracked files, or it applied with conflicts |
| `merge`, `rebase`, `cherry_pick`, `revert`, `fast_forward`, `reset` | `git reset --hard <recorded HEAD>` | HEAD moved, or the tracked working tree is not clean; unavailable when the operation stopped on conflicts, HEAD did not move, a hard reset started dirty, or a soft or mixed reset left changes |
| `push_force` | `git push --force-with-lease=<remote ref>:<pushed sha> <remote> <previous sha>:<remote ref>`, where the previous sha is the lease's `expected_sha` and the pushed sha is the local branch tip recorded before the push. The entry is `local`, so it joins the undo chain; the UI asks for confirmation that states the consequence first. The push runs with authentication prompts like any network command (operation id `undo-<entry id>`) | the remote branch moved after the force push (the lease fails, `invalid_request`, nothing changes), or the remote is gone; unavailable when the push did not move the remote branch |
| `rebase_interactive`, `squash_commits`, `recompose_apply` | `git reset --hard <recorded HEAD>` | HEAD moved, or the tracked working tree is not clean; unavailable when the rewrite stopped on conflicts or for an edit |
| `discard_files`, `discard_hunk` | write back the blobs stored by `git hash-object -w` before discarding | a file changed after the discard; unavailable when a path is a directory or symlink |

Every other command records `unavailable { reason: "<operation> has no safe undo" }`.

## Settings and stored data

- App data directory: the platform app-data directory, or `YFORGE_DATA_DIR` when set (used for isolated runs and tests). App state lives in `yforge.db` and diagnostics in `diagnostics.db`, both SQLite with WAL and foreign keys on, each with embedded forward-only migrations (`rusqlite_migration`) run at startup. Before pending migrations run, a `VACUUM INTO <file>.pre-migration` copy is made and deleted after success.
- Legacy `settings.json`, `repositories.json`, `recents.json` and `session.json` are imported once on first open in one transaction and deleted after it commits. A JSON file that fails to parse yields `storage_failed` naming that file; the import rolls back and every file stays in place. A corrupt or newer `yforge.db` aborts startup with `storage_failed` naming its path. A corrupt `diagnostics.db` is moved aside as `diagnostics.db.corrupt-<ts>` and recreated. Nothing is sent off the machine.
- `yforge.db` tables: `settings(key, value)` (namespaced keys, JSON values, defaults for missing keys), `repo_settings(repository, key, value)`, `recents` (at most 30, ordered), `session` and `session_tabs`, `activity` and `activity_commands` (at most 1,000 entries per repository, pruned on insert).
- `AppSettings`: `theme` (`light`, `dark`, `system`), `density` (`compact`, `default`), `default_branch`, `pull_mode`, `auto_fetch_minutes` (0, 5, 10, 30), `editor_command`, `terminal_command`, `telemetry_opt_in` (default `false`), `ssh_key_path` (optional; see SSH key). `settings_load` and `settings_save` carry the full object. Saving `telemetry_opt_in: false` while it was `true` deletes every usage event. The UI applies theme and density as `data-theme` and `data-density` on the document root; compact density switches the graph geometry to the `-compact` controls.
- Git identity is never stored by YForge: `identity_read` and `identity_write` use `git config --show-scope --get` and `git config --global` or `--local` (`GIT_CONFIG_GLOBAL` is honored). Remotes use `git remote`.

### Activity history

- `activity_list()` -> `ActivityEntry[]`: this session only, oldest first, at most 300.
- `activity_history({ repo: string, before: number | null, limit: number })` -> `ActivityEntry[]`: persisted entries for one repository, newest first. `before` is an exclusive entry-id cursor (`null` for the newest); `limit` is clamped to 1..200. Entries from earlier sessions report `undo.kind = "unavailable"` with the reason "Undo is only available in the session that ran the operation". Ids are stable across restarts.
- `activity_clear({ repo: string | null })` -> `void`: deletes persisted and in-memory entries for one repository or all.

### Crash log

- `type CrashOrigin = "rust" | "frontend"`; `type CrashReport = { kind, message, stack: string | null, view: string | null }`; `type CrashRecord = { id, occurred_at, origin, kind, app_version, os, arch, thread: string | null, message, location: string | null, stack: string | null, view: string | null }`.
- `crash_report({ report })` records a frontend error. `crash_list({ before, limit })` returns records newest first with the same paging as `activity_history`. `crash_export({ path })` writes all records as JSON to an absolute path and returns the count (a relative path is `invalid_request`). `crash_clear()` deletes all records.
- Rust panics are recorded by a panic hook installed after storage starts (250 ms busy timeout, no retry). If the write fails, the redacted crash goes to stderr, and the previous hook runs either way.
- Redaction before storage: URL userinfo becomes `***`, lines containing `password=`, `authorization:` or `extraheader=` become `***`, known repository paths become `<repository>`, the home directory becomes `~`, and each field is capped at 64 KiB. At most 500 records and 90 days are kept, pruned at startup.

### Usage events (opt-in, local only)

- Recorded for every tracked Git operation only while `telemetry_opt_in` is true: `UsageRecord { id, occurred_at, app_version, event: OperationKind, ok, error_kind: ErrorKind | null, duration_ms, count, correlation_id }`. `count` is the number of Git commands and `correlation_id` is the activity entry id. No paths, refs, branch names or messages are stored.
- `usage_list({ before, limit })`, `usage_export({ path })` and `usage_clear()` follow the crash-log rules. At most 10,000 events and 90 days are kept, pruned at startup.

## Frontend architecture

The SolidJS frontend (`app/src`) uses the TanStack Solid adapters, one owner per concern. The IPC surface, events, and this contract do not change to fit a library. The peer check (`npm view <package> peerDependencies`, 2026-09-30) accepts the installed `solid-js` 1.9.15 for every package; the `@tanstack/*` peers agree (`solid-router-devtools` needs `@tanstack/solid-router` ^1.170.34 and `@tanstack/router-core` ^1.171.30, both satisfied by the installed router; `solid-query-devtools` needs `@tanstack/solid-query` ^5.104.0).

| Concern | Package | Pin | Owner |
|---|---|---|---|
| Screens, URL state | `@tanstack/solid-router` | ^1.170.37 | Code-based routes (`app/src/routes.tsx`), hash history, no codegen. `/launcher`, `/repo?tab=<path>`, `/settings/$section?tab=<tab id>`. The URL owns which tab and screen is active (`app/src/state/app.ts` derives `activeTab()` and `screen()` from it); only the active repository tab's workspace is mounted (the watcher is single-instance). Tab and settings navigation replaces the history entry. |
| IPC reads and writes | `@tanstack/solid-query` | ^5.104.0 | One `QueryClient` per app (`createAppState`). Keys are in `app/src/state/queryKeys.ts`, scoped by repository path (`["repo", path, …]`); app-wide reads use `["recents"]`, `["app-info"]`, `["identity"]`; `["repo-settings", path]` and `["conflict", path, file]` sit outside the repository prefix because the watcher must not refetch them. Git writes go through `session.mutate` (a mutation that invalidates `["repo", path]`); `repo-changed` calls the same refresh. Leaving a workspace removes its snapshot and graph pages. Authentication replies never enter the cache. Reads are read through `dataOf` (`state/queryData.ts`) so a pending query never suspends the route. |
| Shared client state | `@tanstack/solid-store` | ~0.11.2 | Tab list, app settings, workspace selection and diff target, and the commit composer's pending edits (`state/clientStore.ts`). Component-local state (menus, popovers, drafts of one field) stays in Solid signals. |
| Long lists | `@tanstack/solid-virtual` | ^3.13.40 | The graph rows (`GraphPanel`), the file lists of the Changes, Commit and Operation inspectors, and the lines of each diff hunk (`components/VirtualRows.tsx`). Graph options keep `aria-posinset`/`aria-setsize`; the selected or focused row stays rendered while scrolled away; J/K, Home, End and reveal-by-search scroll through the virtualizer. |
| Data grid model | `@tanstack/solid-table` | ^9.2.4 | The graph's column definitions and sizing (`graph/columns.ts`); no rows go through the table (the graph pages rows by index). |
| Multi-field forms | `@tanstack/solid-form` | ^1.33.5 | Remote form in settings, clone and create dialogs, branch-name, stash and tag popovers, authentication dialog (the secret is reset after submit). The merge popover (one choice), the single-field settings inputs and the commit composer (draft state lives in the Store so it survives inspector switches and amend prefill) stay on primitives. |
| Debounce, coalescing | `@tanstack/solid-pacer` | ~0.23.0 | Commit-search input debounce, refresh coalescing (one running reload plus at most one queued follow-up), tooltip hover delay. No other handler was hand-debounced. |
| App shortcuts | `@tanstack/solid-hotkeys` | ~0.12.1 | Registry shortcuts (`state/palette.ts` stays the single source; `hotkeyOf` converts a label) plus ⌘K, Escape to leave a diff, and ⌘G / ⇧⌘G. ⌘Z does not fire inside text inputs. Keys scoped to a focused element (graph J/K, file-row S/U, menus, dialogs) remain DOM handlers of that element. Chords use `Mod` (⌘ on macOS). |
| Debug panels | `@tanstack/solid-devtools`, `@tanstack/solid-query-devtools`, `@tanstack/solid-router-devtools` | ~0.8.13, ^5.104.0, ^1.167.2 | Dev dependencies, loaded by a dynamic import under `import.meta.env.DEV` (`app/src/devtools.tsx`). The release bundle contains no panel or devtools UI; `@tanstack/form-core` and the other libraries still embed their small event-client emitter (strings `tanstack-devtools-global`). |

Diagnostics lists: the usage, crash, and persisted-history lists (`["diagnostics", "usage"]`, `["diagnostics", "crashes"]`, `["activity-history", path]`) are infinite queries over the `before` cursor, 25 rows a page, extended by "Show older" (`state/diagnosticsModel.ts`, `state/pagedList.ts`); clearing invalidates the key, and turning usage recording off removes the usage key. The Activity drawer reads the same history key for its "Earlier" group and drops entries the session already lists. Frontend errors are reported to `crash_report` by `state/crashCapture.ts` (window `error`, `unhandledrejection`) and by the root `ErrorBoundary`; each distinct crash is reported once per run and a failing report is logged, never re-reported.

Diff viewer: `state/diffRows.ts` turns a `FileDiff` into flat rows for the Hunk, Inline, and Split modes (split rows pair removed and added lines; change stops drive previous/next), rendered through `VirtualRows`. Syntax highlighting uses `highlight.js` core (`state/syntax.ts`) with 13 languages registered by file extension and loaded lazily as separate chunks; unknown extensions render as plain text. Paired removed and added lines get word-level marks (`state/wordDiff.ts`). Line selection (`state/lineSelection.ts`) maps to the `lines` indexes of `stage_lines`, `unstage_lines`, and `discard_lines`. The Ignore whitespace switch re-requests `diff_file` with `ignoreWhitespace` and disables staging while on; `commit_file_diff` has no whitespace option, so the switch applies to working-tree diffs only.

Graph paging: Query owns each page (`["repo", path, "graph", page]`, fetched with `fetchQuery`); the graph store keeps the lane layout and requested-page set. An infinite query only extends sequentially, while the virtual scroller and reveal-by-search jump to arbitrary pages, so pages are independent keys.

## Build and run

- Install: `pnpm install` in `app/`.
- Develop: `pnpm tauri dev` in `app/`. It starts Vite at `http://localhost:1420` (`beforeDevCommand`) and runs the shell against it.
- Release build: `pnpm tauri build` in `app/` embeds `app/dist` and produces `target/release/bundle/macos/YForge.app` and `target/release/bundle/dmg/YForge_<version>_<arch>.dmg` (targets `app` and `dmg`; the version comes from `app/package.json` through `tauri.conf.json`; macOS 13.3 or newer). The bundle is unsigned (ad-hoc), so a quarantined copy needs Gatekeeper approval; see [README.md](../README.md#release-build).
- Debug build: `pnpm tauri build --debug --bundles app` in `app/` produces `target/debug/bundle/macos/YForge.app`, which logs every command at `debug` level (see Debug evidence).
- Run the built app: `YFORGE_REPO=<repository path> target/release/bundle/macos/YForge.app/Contents/MacOS/yforge` (use `target/debug/…` for the debug build). At startup the app restores the saved tabs, then adds the launch path (`YFORGE_REPO`, else the first CLI argument, else the current directory) as the active tab when it is a repository; with no tab it shows the launcher. Set `YFORGE_DATA_DIR` to keep settings, recents, and tabs out of the real app-data directory.
- `target/debug/yforge` produced by plain `cargo build` or `cargo test` loads `devUrl`, so it shows a blank window unless `pnpm dev` is running.

## Debug evidence

In debug builds, every command logs its arguments and its outcome at `debug` level under target `yforge_lib`, for example `repo_graph ok rows=9 total=9`, `stage_hunk path=… file=src/util.js hunk=-3,7 +3,7`, `commit ok sha=…`, and `commit failed kind=CommitFailed: …`. The watcher logs `repo-changed path=…` for each event it emits, and sync commands log `operation-progress id=… phase=… percent=…` for each progress event; `operation_cancel` logs the id and whether it was found. Authentication logs `auth-prompt operation=… id=… kind=… host=…` and `auth-reply … reply=<variant>` (never the reply's content); `auth_respond` logs the id, the variant, and whether a prompt was waiting; every recorded command logs `activity-recorded id=… operation=… ok=… commands=… undo=…`; `undo_last`, `search_commits` (query length only), the settings, identity, remote, recents, and session commands log their arguments (never secrets) and outcome. Set `RUST_LOG` to override the filter (default: `warn,yforge_lib=debug` in debug builds and `warn` in release builds).

## Bindings

- Source: `#[derive(TS)]` types in `crates/yforge-core/src/model.rs` and `error.rs` (ts-rs; large integers as `number`).
- Regenerate: `pnpm bindings` in `app/` (`UPDATE_BINDINGS=1 cargo test -p yforge-core --test bindings`), then review the diff of `app/src/ipc/bindings/`.
- Check: `cargo test -p yforge-core --test bindings` regenerates into a temporary directory and fails on any difference in file set or content. `pnpm test` in `app/` runs the same check (`src/ipc/bindings.test.ts`).
- Types the frontend sends back (`DiffHunk`, `DiffLine`, `DiffLineKind`, `ChangeArea`) also derive `Deserialize`.
- Adding a command result type that the frontend consumes: derive `TS`, list it as a root in `crates/yforge-core/tests/bindings.rs`, and regenerate.

## Tests

- `crates/yforge-core`: parser and layout unit tests; fixture-repository integration tests (`tests/snapshot.rs`, `tests/graph.rs`, `tests/diff.rs`, `tests/staging.rs`, `tests/commit.rs`, `tests/branches.rs`, `tests/stash.rs`, `tests/sync.rs`, `tests/operations.rs`, `tests/integrate.rs`, `tests/tags.rs`, `tests/conflicts.rs`, `tests/watch.rs`). The sync tests use local bare repositories as remotes; the authentication tests use a loopback HTTP server that answers 401, and the cancellation tests slow the remote with `remote.origin.uploadpack`. The watcher tests use real file-system events, wait up to 10 s for a positive event and 1.5 s to assert silence.
- `app/src-tauri/tests/ipc.rs`: invokes the registered commands through Tauri's mock runtime IPC path (`tauri::test`) and asserts the serialized responses and error payloads for a fixture repository, including the `repo-changed` and `operation-progress` events, sync against a local bare remote, and cancelling a running fetch.
- `crates/yforge-core/tests/askpass.rs` (a loopback HTTP server that demands Basic credentials and a `credential.helper` script that logs `store` and `erase`; fake ssh commands that call `SSH_ASKPASS`), `lifecycle.rs` (clone with progress and cancel, init, publish), `config.rs` (identity sources with `GIT_CONFIG_GLOBAL` pointed at a temporary file, remotes CRUD), `store.rs`, `search.rs`, and `undo.rs` (every undo path with the restored state asserted, plus each refusal).
- `app/src-tauri/tests/phase3b.rs`: the phase 3b commands over the mock runtime, including a clone from a local bare remote, activity records with hook output and redaction, and undo through `undo_last`; `src/auth.rs` unit tests cover the prompt round trip, timeout, and cancel.
- `app/src/components/*.test.tsx`, `app/src/state/app.test.tsx`, `palette.test.ts`, `search.test.ts`, and the other model tests: launcher, dialogs, settings forms, palette flows and the menu-to-palette parity check, auth dialogs, toasts with undo, tabs, and shortcuts.
- `app/src/ipc/client.test.ts`: client argument passing, event delivery, and error mapping over `mockIPC`.
- `app/src/state/*.test.ts`, `app/src/graph/*.test.ts`: selection, composer validation and commit flow, diff and confirmation models, refresh coalescing, graph refresh, the branch and stash menus, branch-name validation, the sync menu, freshness, and progress state, the operation banner model, and the checkout, sync, stash, and operation flows over `mockIPC`.
