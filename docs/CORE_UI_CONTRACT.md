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
| `launch_path` | none | `string \| null`: `YFORGE_REPO`, else the first CLI argument, else the current directory when it is inside a Git repository; `null` when none applies (empty values are ignored). A Finder or Dock launch starts in `/`, so it opens nothing beyond the restored tabs and reports nothing. |
| `repo_open` | `path: string` | `RepoSnapshot` |
| `repo_graph` | `path: string`, `offset: number`, `limit: number`, `visibility?: GraphVisibility` (default `{ kind: "all" }`) | `GraphPage` |
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
| `commit_file_diff` | `path`, `sha: string`, `file: string`, `ignoreWhitespace?: boolean` (default `false`; `true` adds `-w`) | `FileDiff` |
| `revision_file_diff` | `path`, `base: string`, `head: string`, `file: string`, `ignoreWhitespace?: boolean` | `FileDiff` of one file from `base` to `head`; each revision must name a commit (`invalid_request` otherwise) |
| `repo_watch` | `path` | `null`; starts (or replaces) the repository watcher that emits `repo-changed` |
| `check_branch_name` | `path`, `name: string` | `string`: the name, if `git check-ref-format --branch` accepts it unchanged; otherwise `invalid_request` |
| `checkout` | `path`, `target: CheckoutTarget`, `stash: boolean`, `leaveStashed?: boolean` | `CheckoutOutcome { auto_stash }`; `auto_stash` is `stashed` when the stash was left and recorded |
| `create_branch` | `path`, `name: string`, `at: string \| null`, `checkout: boolean` | `null` |
| `rename_branch` | `path`, `from: string`, `to: string` | `null` |
| `branch_delete_preview` | `path`, `name: string` | `RevisionRange { count, commits }`: `count` is the number of commits only this branch holds, `commits` the newest 20 of them |
| `delete_branch` | `path`, `name: string`, `force: boolean` | `null` |
| `delete_branches` | `path`, `names: string[]`, `forced: string[]` (the names deleted with `force`) | `BatchOutcome { done: string[], failed: { name, reason }[] }` |
| `stash_push` | `path`, `message: string`, `untracked: boolean` | `null` |
| `stash_apply`, `stash_pop` | `path`, `index: number`, `sha: string` | `StashRestore` (`applied` or `conflicts`) |
| `stash_drop` | `path`, `index: number`, `sha: string` | `null` |
| `drop_stashes` | `path`, `targets: { index: number, sha: string }[]` | `BatchOutcome` (`done` holds `stash@{index}` names) |
| `fetch` | `path`, `id: string`, `prune: boolean`, `interactive: boolean` (optional, default `true`; `false` never asks for credentials) | `null` |
| `pull` | `path`, `id: string`, `mode: PullMode` | `PullOutcome` (`up_to_date`, `updated`, `conflicts`) |
| `push` | `path`, `id: string` | `null` |
| `push_plan` | `path` | `ForcePushPlan { lease, upstream, replaced: RevisionRange }` |
| `push_force` | `path`, `id: string`, `lease: ForceLease` | `null` |
| `operation_cancel` | `id: string` | `boolean`: true when an operation with that id was running and was told to stop; its pending authentication prompts are answered with `cancel` |
| `operation_continue` | `path`, `message: string \| null` | `OperationOutcome` (`completed` or `conflicts`) |
| `operation_skip` | `path` | `OperationOutcome` |
| `operation_abort` | `path` | `null` |
| `mark_resolved` | `path`, `files: string[]` | `null` |
| `integration_preview` | `path`, `base: string \| null`, `other: string` | `IntegrationPreview { incoming, outgoing, fast_forward }` |
| `incoming_commits` | `path` | `string[]`: every commit id on the checked-out branch's upstream that the branch does not have |
| `merge` | `path`, `source: string`, `mode: "fast_forward" \| "merge_commit"` | `OperationOutcome` |
| `rebase` | `path`, `onto: string` | `OperationOutcome` |
| `fast_forward` | `path`, `branch: string`, `target: string` | `null` |
| `cherry_pick`, `revert` | `path`, `sha: string` | `OperationOutcome` |
| `reset` | `path`, `target: string`, `mode: "soft" \| "mixed" \| "hard"` | `null` |
| `create_tag` | `path`, `name: string`, `at: string \| null`, `message: string \| null` | `null` |
| `delete_tag` | `path`, `name: string` | `null` |
| `delete_tags` | `path`, `names: string[]` | `BatchOutcome` |
| `push_tag`, `delete_remote_tag` | `path`, `id: string`, `remote: string`, `name: string` | `null` |
| `conflict_file` | `path`, `file: string` | `ConflictFile` |
| `conflict_resolve` | `path`, `file: string`, `content: string` | `null` |
| `conflict_take_side` | `path`, `file: string`, `side: "current" \| "incoming"` | `null` |
| `conflict_reset` | `path`, `file: string` | `null` |

| `publish` | `path`, `id: string`, `remote: string`, `branch?: string` (default: the checked-out branch) | `null`; `git push --set-upstream <remote> <branch>`; needs a commit and an existing remote |
| `clone_repo` | `id: string`, `url: string`, `destination: string` (absolute, the full target path), `options: CloneOptions` (`shallow` fetches only the latest commit of each branch, `sparse` clones without checking the working tree out) | `string`: the opened repository root. The destination must not exist or be empty; a failed or cancelled clone removes what it created |
| `init_repo` | `path: string` (absolute; created when missing) | `string`: the root. Uses the default branch from the app settings; `already_a_repository` when `path` is a repository root |
| `search_commits` | `path`, `query: string`, `visibility?: GraphVisibility` (default `{ kind: "all" }`; rows index the graph that visibility renders) | `SearchResult { total, rows }`: `rows` are graph row indexes of commits (and stashes) whose message, author name or email, or SHA prefix match, case-insensitive; `author:` and `sha:` restrict the field; an empty query matches nothing |
| `auth_respond` | `id: string` (the prompt id), `reply: AuthReply` | `boolean`: true when a prompt with that id was waiting |
| `settings_load` | none | `AppSettings` |
| `settings_save` | `settings: AppSettings` | `AppSettings`: the stored value (default branch trimmed); `invalid_request` for a bad branch name or an interval other than 0, 5, 10, 30 |
| `repo_settings_load`, `repo_settings_save` | `path`; `settings: RepoSettings` (save) | `RepoSettings { pull_mode, ssh_key_path }` / `null` |
| `identity_read` | `path: string \| null` (`null` is the global scope) | `Identity { name, email }`, each `{ value, source }` with `source` one of `repository`, `global`, `system`, `other`, `unset` |
| `identity_write` | `path: string \| null`, `field: "name" \| "email"`, `value: string \| null` (`null` unsets; an empty string is `invalid_request`) | `null` |
| `avatar_url` | `email` | `string \| null`: the Gravatar address for the trimmed, lower-cased email (MD5 hashed in Rust, so the renderer never hashes), or `null` when the email is blank |
| `avatar_initial` | `name` | `string`: the first character upper-cased, or `?` |
| `provider_field_problem` | `kind: ProviderKind`, `field: "name" \| "base_url" \| "api_key"`, `value` | `string \| null`: the problem the provider form shows, from the same rules `ai_provider_add` and `ai_provider_update` enforce |
| `connection_field_problem` | `field: "host" \| "name" \| "token"`, `value` | `string \| null`: the problem the connection form shows, from the same rules `platform_connection_add` enforces |
| `jira_field_problem` | `field: "site" \| "email" \| "token"`, `value` | `string \| null`: the problem the Jira form shows, from the same rules `jira_connection_add` enforces (a site is `https://host[/path]`; `http://` only for a loopback host; a bare host means https) |
| `jira_connections_list` | none | `JiraConnection[] { id, kind: "cloud" \| "data_center", site, host, email, display_name, projects: { key, name }[], created_at }` in creation order; never a token |
| `jira_connection_add` | `kind: JiraKind`, `site`, `email: string \| null` (required for Cloud, ignored for Data Center), `token` | `JiraConnection`. The core signs in first (Cloud: Basic with email and API token; Data Center: Bearer personal access token), reads `myself` and the visible projects, then stores the row and puts the token only in the macOS Keychain (account `jira.<id>`); a refused token is `auth_failed` ("Authentication failed for <host>") and nothing is stored |
| `jira_connection_remove` | `id` | `null`; deletes the row and the Keychain token; `invalid_request` for an unknown id |
| `jira_connection_test` | `id` | `string`: the display name ("Connected as <display name>"); the stored display name and project list are refreshed |
| `jira_my_issues` | `id` | `JiraIssueList { issues, total, capped }`, `issues` being `JiraIssue[] { key, summary, status, status_category: "todo" \| "in_progress" \| "done", issue_type, project, assignee (display name or `null`), updated_at, web_url, connection_id }`: issues assigned to the user whose status category is not Done (`assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`, read page by page up to 1,000; see Paged lists) |
| `jira_issue_keys` | `texts: string[]` | `string[][]`: for each text the issue keys (`[A-Z][A-Z0-9]+-\d+`, case-sensitive, not glued to letters or digits) whose project is known to a connected site, in order of first appearance without repeats |
| `jira_issues_lookup` | `keys: string[]` | `JiraIssueLookup[] { key, issue, failure }` (each site is asked in requests of at most 50 keys, merged) in the same order: `issue` when the site that owns the project answered, else `null`; `failure` carries the text when that site could not be read |
| `jira_branch_name` | `key`, `summary` | `string`: `<KEY>-<summary slug>`, the summary as lower-case ASCII words joined by hyphens, whole words only, at most 50 characters in all |
| `platform_my_pulls` | `id` (a platform connection) | `LaunchpadPulls { pulls, total, capped }`, `pulls` being `LaunchpadPull[] { connection_id, repo, role: "authored" \| "review_requested", draft, pull, local_path }`: open pull requests authored by the user or waiting for their review on that connection (GitHub search `author:@me` and `review-requested:@me`; GitLab `scope=created_by_me` and `reviewer_username`; Bitbucket Data Center dashboard `role=AUTHOR` and `REVIEWER`; Bitbucket Cloud authored only), each role read page by page, merged, most recently updated first, at most 1,000 (see Paged lists), a pull request in both lists once as `authored`; `local_path` is the recent repository whose remote matches, else `null` |
| `launchpad_wips` | none | `Wip[] { path, name, branch, changes, unpushed, unreadable }`: recent repositories that exist and have uncommitted changes or unpushed commits (from `recent_status`), most recent first; a repository whose status could not be read stays in the list with `unreadable` set to the reason and both counts 0 |
| `remotes_list` | `path` | `RemoteInfo[] { name, fetch_url, push_url }` |
| `remote_add`, `remote_edit`, `remote_remove` | `path`, `name`, `url` (add); `path`, `name`, `newName`, `url` (edit); `path`, `name` (remove) | `null`; names and addresses are validated (`invalid_request`) |
| `recents_list`, `recent_add`, `recent_remove` | none; `path`; `path` | `RecentRepo[] { path, opened_at }`, newest first, at most 30 |
| `recent_statuses` | `paths: string[]` | `RecentStatus[]` in the same order: `exists`, `branch`, `unborn`, `ahead_behind`, `counts`, `worktrees`, `unreadable`; `unreadable` is `null`, or the reason text when the path is a repository but its status or worktree list could not be read (the other fields are then empty and `exists` is `true`); the Launcher and the Launchpad WIPs show it as `Could not read status: <reason>` |
| `session_load`, `session_save` | none; `session: TabSession { tabs, active, groups }`, each `TabGroup { name, color, collapsed, tabs }` with `color` one of `cyan`, `blue`, `purple`, `magenta`, `pink`, `red`, `orange`, `yellow`, `green`, `mint` (the ten lane colors in order) and `tabs` the member paths (`groups` may be omitted on save). `session_save` refuses with `invalid_request` a name that is blank or longer than 40 characters after trimming, a member that is not in `tabs`, a tab in two groups, and members that are not next to each other; it drops a group with no tabs, trims names, and keeps groups in tab order | `TabSession` / `null` |
| `repo_aliases_list`, `repo_alias_set` | none; `path`, `alias` (a string, or `null` to remove). The alias is the name shown for a repository on its tab, in Recent, and in the palette (S42); it is saved per repository path in the app database (migration 11, table `repo_aliases`). `repo_alias_set` trims the alias and refuses with `invalid_request` an empty path and an alias that is blank or longer than 40 characters; removing an alias that is not set changes nothing. Both return every alias, ordered by path | `RepoAlias[] { path, alias }` |
| `update_check` | none; asks the configured update endpoint (`plugins.updater` in `tauri.conf.json`) for a newer version and keeps the offered update for `update_install`; nothing is downloaded. A failure (for example the endpoint is unreachable) is an `internal` error whose message says why | `UpdateCheck`: `{ kind: "up_to_date", version }` or `{ kind: "available", current, version, notes }` |
| `update_install` | none; downloads the update offered by the last `update_check`, verifies its signature against the key in `plugins.updater.pubkey`, installs it, and relaunches the app. It refuses with `invalid_request` when no update was checked, and a download that fails the signature check is discarded with an `internal` error saying nothing was installed | `null` (never returns on success) |
| `menu_update` | `enabled`, `checked`: maps of menu item id to a boolean. Enables or disables the macOS menu bar items and sets the check mark of the Theme and Density items; an id that is missing keeps its state. A no-op where the menu bar is not installed | `null` |
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
| `ssh_public_key` | `path` (a private key file) | `string`: the trimmed text of the `<path>.pub` file; `invalid_request` when there is no `.pub` next to the key |
| `git_hosts_list` | none | `GitHost[] { id, host, ssh_key_path, https_user, key_kind, key_fingerprint, has_public_key }` in creation order. `key_kind` (`ed25519`) and `key_fingerprint` (`SHA256:…`) come from `ssh-keygen -l` on the `.pub` and are `null` without one; `has_public_key` is true when `<ssh_key_path>.pub` exists |
| `git_host_save` | `id: string \| null` (`null` adds, a value edits), `draft: GitHostDraft { host, ssh_key_path, https_user }` | `GitHost`. The host is trimmed and lower-cased and must be `host` or `host:port` (port 1-65535, `[::1]:22` for IPv6); a second identity for the same host, a missing, public, or non-key file, and a line break in the user name are `invalid_request` and nothing is saved; an unknown `id` is `invalid_request` |
| `git_host_remove` | `id` | `null`; `invalid_request` for an unknown id. Key files and Keychain entries are untouched |
| `git_host_field_problem` | `field: "host" \| "ssh_key" \| "new_key"`, `value` | `GitHostProblem { title, detail } \| null`, from the same rules `git_host_save` enforces: "Enter the host name, such as gitlab.corp-a.com", "That is a public key" (a `.pub` name or `ssh-…` content), "That is not an SSH private key" (the first line is not a `-----BEGIN … PRIVATE KEY-----` header), "That key file does not exist", and "Use the full path of the key file" (`~/` expands to `HOME`); a blank `ssh_key` is no problem. `new_key` checks the path Generate key will write: blank ("Enter where to write the key, …"), not absolute, a `.pub` name ("Name the private key, without .pub"), a file, folder, or symlink already at the path or at its `.pub` ("A file already exists there"), or a nearest existing ancestor that is not a folder ("The parent of that path is not a folder"); folders that do not exist yet are fine |
| `git_host_default_key_path` | `host` | `string`: `~/.ssh/yforge_<host>` with the port dropped (anything outside letters, digits, `-`, `.`, `_` becomes `_`); `invalid_request` for an invalid host |
| `git_host_generate_key` | `host`, `keyPath` (`~/` expands to `HOME`; the same rules as `git_host_field_problem("new_key", …)`), `passphrase: string \| null` (blank means none) | `string`: the absolute private key path. Runs the system `ssh-keygen -t ed25519` and writes the key and its `.pub` with the comment `yforge@<host>`, creating missing folders with mode 0700; the passphrase reaches `ssh-keygen` only through an `SSH_ASKPASS` helper and an environment variable, never the command line; an existing file is never overwritten (`invalid_request` naming the path). A non-blank passphrase is saved in the macOS Keychain (service `dev.yforge.desktop.ssh-passphrases`, account the absolute key path); when the Keychain refuses, the key files are removed and the call is `invalid_request` |
| `git_identity_for_url` | `url` | `UrlIdentity { transport: "ssh" \| "https" \| "other", source: "host" \| "app" \| "agent", host, ssh_key_path, https_user }`: what clone would use for the address. `host` is the matched identity's host; `other` (a local path, `file://`, `git://`) uses none. The repository's own key does not apply to a clone |
| `worktree_list` | `path` | `WorktreeStatus[] { path, head, branch, bare, locked, prunable, current, dirty }` |
| `worktree_suggest_path` | `path`, `branch` | `string` |
| `worktree_create` | `path`, `branch`, `create`, `start: string \| null`, `destination` (absolute) | `string`: the location |
| `worktree_remove` | `path`, `worktree`, `force` | `null` |
| `worktree_integrate` | `path`, `worktree`, `target`, `cleanup` | `WorktreeIntegration` |
| `reflog_refs` | `path` | `string[]`: `HEAD` (when its reflog is not empty), then `refs/heads/<name>` for each local branch that has a reflog |
| `reflog_list` | `path`, `reference: string`, `before: number \| null`, `limit: number` | `ReflogEntry[]` |
| `lost_commits` | `path`, `id?: string` | `LostCommit[]` |
| `restore_as_branch` | `path`, `sha`, `name` | `null` |
| `restore_checkout` | `path`, `sha` | `null` |
| `restore_reset` | `path`, `sha`, `mode: "soft" \| "mixed" \| "hard"` | `null` |
| `snapshots_list` | `path` | `SnapshotInfo[]`, newest first |
| `snapshot_files` | `path`, `reference: string` | `SnapshotChange[]` |
| `snapshot_restore_files` | `path`, `reference`, `files: string[]` | `string`: the ref of the safety snapshot taken first |
| `snapshot_restore_all` | `path`, `reference`, `force: boolean` | `string`: the ref of the safety snapshot taken first |
| `snapshot_delete` | `path`, `reference` | `null` |
| `file_at_revision` | `path`, `file: string`, `rev: string` (a commit id of 4–64 hex characters, `:index`, or `:worktree`) | `FileAtRevision` |
| `stash_details` | `path`, `index: number`, `sha: string` | `StashDetails { index, sha, message, base_sha, untracked_sha, files: StashFile[] }` |
| `stash_file_diff` | `path`, `index`, `sha`, `file: string`, `ignoreWhitespace?: boolean` | `FileDiff` |
| `repo_ui_prefs_load`, `repo_ui_prefs_save` | `path`; `path`, `prefs: RepoUiPrefs` (save) | `RepoUiPrefs` / `null` |
| `app_ui_prefs_load`, `app_ui_prefs_save` | none; `prefs: AppUiPrefs` (save) | `AppUiPrefs { palette_recents: string[], last_parent_folder?: string \| null }` / `null` |
| `cli_install` | none | `CliInstall { path, replaced }` |
| `rebase_plan` | `path`, `base: string` | `RebasePlan { base, commits: RebaseTodo[], pushed }`: `commits` run oldest first from `base` (exclusive, a commit id or full ref) to HEAD; `RebaseTodo { sha, summary, author, is_merge, pushed }`; `pushed` is true when the commit is reachable from `@{upstream}`, and on the plan when any commit is. `invalid_request` when `base` is not an ancestor of HEAD or the range is empty |
| `rebase_interactive` | `path`, `base`, `steps: RebaseStep[]` | `RebaseResult { outcome, pushed, dropped_all }` |
| `squash_commits` | `path`, `shas: string[]`, `message: string` | `RebaseResult` |
| `recompose_preview` | `path`, `base` | `RecomposePreview { base, head, pushed, files: RecomposeFile[] }` |
| `recompose_apply` | `path`, `base`, `groups: RecomposeGroup[]` | `RecomposeResult { head, pushed }` |
| `ai_providers_list` | none | `ProviderSummary[] { config: ProviderConfig, status: ProviderStatus }` in creation order |
| `ai_provider_add` | `input: ProviderInput { kind, auth_mode?, name, base_url?, api_key? }`; `kind` is `chatgpt`, `claude`, `openrouter`, or `openai_compatible`; `auth_mode` is `api_key` (default) or `subscription` | `ProviderSummary`; `invalid_request` for a bad name (1–80 characters), `subscription` on `openrouter`/`openai_compatible`, a `base_url` on anything but `openai_compatible` (required there: https, or http only for loopback hosts; no credentials, query or fragment), or an `api_key` on a subscription provider |
| `ai_provider_update` | `update: ProviderUpdate { id, auth_mode, name, base_url?, api_key: ApiKeyChange }`; `ApiKeyChange` is `{ kind: "keep" }`, `{ kind: "set", key }`, or `{ kind: "clear" }` | `ProviderSummary`; the kind never changes, the auth mode may |
| `ai_provider_remove` | `id` | `null`; deletes the Keychain entry and the feature configurations that use this provider |
| `ai_provider_test` | `id` | `ProviderStatus` |
| `ai_models` | `providerId` | `ModelInfo[] { id, display_name, context_window? }` sorted by id, from the provider's models API (see AI assistance); `ai_auth_required` when there is no key or no sign-in |
| `ai_feature_config_list` | none | `AiFeatureSummary[] { feature, config?: { feature, provider_id, model_id, prompt_template }, enabled, available, default_prompt_template }`, in the order `generate_commit`, `recompose`, `conflict_fix`, `explain_changes`, `explain_commit`, `compose_commits`, `stash_message`, `compose_pull_request`; `config` is absent until the feature is set up; `available` is `enabled` and the saved provider's status is `ready` |
| `ai_feature_config_set` | `feature`, `providerId`, `modelId`, `promptTemplate` | `AiFeatureSummary`; the first save turns the feature on, a later save keeps its switch; `invalid_request` when the provider is unknown, the prompt lacks exactly one `{context}`, or the model is not in the provider's list; `ai_auth_required` when the list cannot be fetched |
| `ai_feature_config_enable` | `feature`, `enabled: boolean` | `AiFeatureSummary`; `invalid_request` "<feature title> has no saved provider and model" when the feature is not set up |
| `ai_feature_config_reset` | `feature` | `AiFeatureSummary` with `config` absent and the feature off |
| `ai_sign_in` | `provider`, `id` (operation id), `method: "browser" \| "device_code"` | `ProviderStatus` after a successful sign-in; only for `subscription` providers (`invalid_request` otherwise). ChatGPT: `browser` runs the PKCE flow with a local callback listener and opens the sign-in page with `open`; `device_code` is the headless flow. Claude: `method` is ignored; the call confirms the Claude Code credentials and rejects with `ai_auth_required` and `output` "Sign in to Claude Code first" when they are missing. Cancel with `operation_cancel(id)` |
| `ai_generate_commit_message` | `path`, `id` | `CommitDraft { summary, description, summary_trimmed, excluded, truncated }` |
| `ai_propose_recompose` | `path`, `id`, `base` | `RecomposeProposal { groups: RecomposeGroup[], excluded }` |
| `ai_propose_conflict` | `path`, `id`, `file` | `ConflictProposal { regions: { index, text, rationale }[] }` |
| `platform_pr_checks` | `path`, `number: number` | `PullChecks \| null`; independent cached checks lookup, without changing or delaying `platform_prs_list`; no matching connection returns `null` without network |
| `branch_comparison` | `path`, `source: string`, `target: string` | `BranchComparison`; source-only commits and the merge-base-to-source diffstat |
| `merge_prediction` | `path`, `id`, `ours: string`, `theirs: string` | `MergePrediction`; predicts merging `theirs` into `ours`; cancel with `operation_cancel(id)` |
| `pull_request_template` | `path` | `string \| null`; repository working-tree template, no network |
| `ai_pull_request_context` | `path`, `source`, `target` | `PullRequestDisclosure`; local context counts and the configured provider display name; does not submit a completion |
| `ai_compose_pull_request` | `path`, `id`, `source`, `target`, `template: string` | `PullRequestDraft`; explicit generation using `compose_pull_request` per-feature configuration, cancel with `operation_cancel(id)`; changes no Git or platform state |
| `platform_pr_create` | `path`, `input: CreatePull` | `PullRequest`; creates the requested draft/non-draft on the matched platform; does not push a local branch (use existing `push_to` first when needed) |

`client` also exposes the worktree, recovery, and snapshot commands as `worktreeSuggestPath`, `worktreeCreate`, `worktreeRemove`, `worktreeIntegrate`, `reflogRefs`, `reflogList`, `lostCommits`, `restoreAsBranch`, `restoreCheckout`, `restoreReset`, `snapshotsList`, `snapshotFiles`, `snapshotRestoreFiles`, `snapshotRestoreAll`, and `snapshotDelete`, plus `fileAtRevision`, `cliInstall`, `appUiPrefsLoad`, `appUiPrefsSave`, and `onOpenPathRequested(handler)`.

`client` also exposes `pickFolder(title)` (the native folder picker, `tauri-plugin-dialog`), `homeDirectory()`, and `onFolderDrop(handler)`, and the phase 3b commands as `publish`, `authRespond`, `searchCommits`, `cloneRepo`, `initRepo`, `settingsLoad`, `settingsSave`, `repoSettingsLoad`, `repoSettingsSave`, `identityRead`, `identityWrite`, `remotesList`, `remoteAdd`, `remoteEdit`, `remoteRemove`, `recentsList`, `recentAdd`, `recentRemove`, `recentStatuses`, `sessionLoad`, `sessionSave`, `openPath`, `activityList`, `activityClear`, `undoLast`, plus `onAuthPrompt(handler)` and `onActivity(handler)`.

`client` exposes them as `appInfo()`, `launchPath()`, `repoOpen(path)`, `repoGraph(path, offset, limit)`, `diffFile`, `stageFiles`, `unstageFiles`, `stageAll`, `unstageAll`, `discardFiles`, `stageHunk`, `unstageHunk`, `discardHunk`, `commit`, `amendInfo`, `commitDetails`, `commitFileDiff`, `repoWatch`, `checkBranchName`, `checkout`, `createBranch`, `renameBranch`, `branchDeletePreview`, `deleteBranch`, `deleteBranches`, `stashPush`, `stashApply`, `stashPop`, `stashDrop`, `dropStashes`, `fetch`, `pull`, `push`, `pushPlan`, `pushForce`, `operationCancel`, `operationContinue`, `operationSkip`, `operationAbort`, `markResolved`, `integrationPreview`, `merge`, `rebase`, `fastForward`, `cherryPick`, `revert`, `reset`, `createTag`, `deleteTag`, `deleteTags`, `pushTag`, `deleteRemoteTag`, `conflictFile`, `conflictResolve`, `conflictTakeSide`, `conflictReset`, `onRepoChanged(handler)`, and `onOperationProgress(handler)`.

## Events

| Event | Payload | When |
|---|---|---|
| `repo-changed` | `RepoChanged { path }`: the `path` given to `repo_watch` | The watched repository changed |
| `operation-progress` | `OperationProgress { id, phase, percent }` | A `fetch`, `pull`, `push`, or `push_force` reports progress; `id` is the id the caller passed, `phase` is git's phase name (for example `Receiving objects`) or `Fetching <remote>`, and `percent` is 0–100 or `null` when the phase has no percentage |

| `auth-prompt` | `AuthPromptEvent { operation, prompt: AuthPrompt }` | A network command needs an answer. `operation` is the operation id; `prompt.id` is `<operation>/auth-<n>`; `prompt.kind` is `credentials` (HTTPS username and token; `username` is set when the address already names one, and on the first prompt of a host with an identity it is that identity's HTTPS user name), `passphrase` (an SSH key passphrase or another secret; `message` is git's prompt), or `host_key` (`host` and the SHA256 `fingerprint`) |
| `activity-recorded` | `ActivityEntry` | A command finished. The same `id` is emitted again when its undo status changes, so consumers upsert by `id` |
| `ai-sign-in` | `AiSignInEvent { operation, provider, stage }` | `ai_sign_in` progress. `stage` is `{ kind: "browser", url }` (ChatGPT browser flow; the shell has already opened `url`), `{ kind: "device_code", url, code }` (ChatGPT headless flow; emitted once) or `{ kind: "completed", status }`. Failures and cancellation reject the call instead |
| `open-path-requested` | `OpenPathRequested { path }` | A second `yforge [path]` launch reached the running instance; `path` is absolute (a relative argument is resolved against the second process's working directory). The window is unminimized, shown, and focused first. A launch without a path only focuses the window and emits nothing |
| `menu-action` | `string`: the id of the macOS menu bar item the user chose (for example `tab.reopen`, `sync.fetch`, `update.check`); the ids are the palette command ids where one exists, and `edit.undo`, `edit.redo`, `palette.open`, `theme.*`, `density.*`, `app.release_notes`, and `help.*` otherwise (S43) | A custom menu bar item was chosen; predefined macOS items (Hide, Quit, Cut, Copy, Paste, and the like) are handled by macOS and emit nothing |

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
  - The explicit frontend Checkout command prefers an existing local counterpart. Reference activation (double-click or its activation key) instead opens the existing Reset mode menu when the remote branch's counterpart is already checked out. Selecting a mode opens the reset confirmation; activation and cancellation do not mutate Git, and Hard uses the core's existing safety snapshot. Other reference activations retain checkout behavior.
  - A tag or commit runs `git switch --detach`. With a dirty work tree and `stash` false it fails with `local_changes` before running git.
  - Git's refusals to overwrite local changes (`would be overwritten`, `You have unstaged changes`, and similar) are `local_changes`; git's message is in `output`.
- `stash: true` (Stash and switch) runs `git stash push --include-untracked -m "YForge: auto-stash before switching to <label>"` when the work tree is dirty, switches, then runs `git stash pop`. `CheckoutOutcome.auto_stash` is `none` (nothing stashed), `restored`, `conflicts` (the pop conflicted; the stash is kept), or `kept` (the pop failed for another reason; the stash is kept). If the switch itself fails, the stash is popped again and the failure is returned; if that pop fails too, the error says the changes remain in `stash@{0}`.
- `create_branch`: `at` is `null` (HEAD), a commit id (4–64 hex characters), or a full ref name starting with `refs/`; it must resolve to a commit. `checkout` true uses `git switch --create`, false uses `git branch`. An invalid or existing name is `invalid_request`.
- `rename_branch`: `git branch --move`; the source must be a local branch and the new name valid and unused.
- `branch_delete_preview` counts the commits reachable from the branch and from no other local branch, remote-tracking branch, or tag, and lists the newest 20 of them (`RevisionRange`, the same shape and limit as `integration_preview`). `delete_branch` without `force` fails with `unmerged_branch` (carrying the exact count) when that count is not 0; with `force` it runs `git branch --delete --force`. The checked-out branch and unknown branches are `invalid_request`.

### Stash commands

- `stash_push`: `git stash push [--include-untracked] [-m <message>]` with a trimmed message; when git saved nothing (no `refs/stash` change) the call fails with `invalid_request`. Entries are named `On <branch>: <message>`, or `WIP on <branch>: …` without a message.
- `stash_apply`, `stash_pop`, and `stash_drop` first check that `stash@{index}` is still `sha`, otherwise `invalid_request`. Apply and pop return `conflicts` when git failed and the work tree has conflicted files (pop keeps the stash then); any other failure is `git_failed`.

### Sync commands

`fetch`, `pull`, `push`, and `push_force` take an `id` chosen by the caller, run their network git processes with `--progress`, emit `operation-progress` events tagged with that id, and can be stopped with `operation_cancel`. The id must not be in use by a running operation (`invalid_request`).

- `fetch`: `git fetch --progress [--prune] <remote>` for each remote, in order, emitting `Fetching <remote>` before each. A repository without remotes is `invalid_request`. `FETCH_HEAD` is saved once before the first remote and restored if the fetch as a whole fails or is cancelled, so a partly completed fetch does not reset `last_fetch`.
- `pull`: needs a checked-out branch with an upstream. It fetches the upstream's remote (skipped for a local upstream), then integrates the upstream: `git merge --ff-only`, `git merge --no-edit`, or `git rebase`, for `PullMode` `fast_forward_only`, `fast_forward_or_merge`, or `rebase`. Cancelling is possible while fetching only. Results: `up_to_date`, `updated`, or `conflicts` (the merge or rebase state is left in place). A `fast_forward_only` pull that cannot fast-forward is `not_fast_forward`; git's refusal to overwrite local changes is `local_changes`.
- `push`: `git push --progress <remote> refs/heads/<branch>:<upstream ref>`. Without an upstream it pushes to `origin` (else the first remote) with `--set-upstream`. A rejected push (`[rejected]`, `[remote rejected]`) is `push_rejected`, with git's output in `output`.
- `push_plan` returns `ForcePushPlan { lease, upstream, replaced }`: `lease` is `{ remote, branch, remote_ref, expected_sha }` (the remote-tracking value at that moment), and `replaced` is the `RevisionRange` of `HEAD..<upstream>` (`count` of all of them, the newest 20 in `commits`). It fails with `invalid_request` when `replaced.count` is 0.
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
- `incoming_commits` lists `refs/heads/<branch>..<upstream>` without a limit, newest first; it is empty on a detached or unborn HEAD, without an upstream, or before the upstream ref exists locally. The UI reads it after a fetch to mark incoming graph rows (S74).
- `merge`: `fast_forward` runs `git merge --ff-only` and fails with `not_fast_forward` when the branches diverged; `merge_commit` runs `git merge --no-ff`. A branch that shares its name with a tag is merged by its full ref. Overlapping local changes are `local_changes`.
- `rebase`: `git rebase <onto>`; local changes that block it are `local_changes`.
- `fast_forward`: `branch` must be a local branch. `not_fast_forward` when `target` does not contain it, `invalid_request` when it is already at `target`. The checked-out branch moves with `git merge --ff-only`; another branch moves with `git branch --force` after the ancestor check.
- `cherry_pick`, `revert`: `sha` must be a commit id that is not a merge commit (`invalid_request`). A pick or revert that changes nothing is aborted and reported as `invalid_request`.
- `reset`: `target` is a commit id, branch name, or full ref. `soft` keeps index and files, `mixed` keeps files, `hard` resets tracked files (untracked files stay).

### Tag commands

- `create_tag`: `at` is a commit id or full ref (default `HEAD`). A `message` makes an annotated tag (a blank message is `invalid_request`); `null` makes a lightweight tag. An existing or malformed name is `invalid_request`.
- `delete_tag`: local only.
- `delete_branches`, `delete_tags`, and `drop_stashes` run their single-item verb for each name in one call and attempt every item: items that fail are listed in `failed` with the error text and the rest still run. `drop_stashes` drops from the highest index down so every `index`/`sha` pair is still current when its turn comes. An empty list is `invalid_request`; when every item fails the first item's error is the call's error. `forced` lists the branches deleted with `force`; the others keep the unmerged check.
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
- `pull_with_autostash` fetches, stashes (with untracked files) when the tree is dirty, integrates, then pops. `PullStash` is `none`, `restored`, or `kept { reference, sha, reason }` with `reason` `pull_conflicts`, `restore_conflicts`, or `restore_failed`. A refused integration pops the stash back before returning the error. No undo. When a pull stops on conflicts (`reason` `pull_conflicts`), the UI pops the kept stash itself after the operation completes (continue or skip finishing it) or is aborted, unless the user dismissed the notice; a restore that conflicts is reported and the stash is kept.
- `checkout` with `stash: true` and `leaveStashed: true` stashes, records the stash under (repository root, branch left) in `switch_stashes` (`yforge.db`, migration 2), and switches without popping. A failed switch pops the stash back and removes the record; a detached HEAD with changes is `invalid_request`.
- `switch_stashes` lists the live recorded stashes for a branch, newest first, with their current index, pruning records whose stash is gone. `switch_stash_restore` runs a tracked stash pop and clears the record; `switch_stash_dismiss` clears the record and keeps the stash.

### SSH key

- `ssh_key_path` (app and repository settings; the repository value wins) must be an absolute existing file; blank means ssh-agent; anything else is `invalid_request`.
- With a key, every network command runs with `GIT_SSH_COMMAND=ssh -i '<key>' -o IdentitiesOnly=yes` (plus `-o BatchMode=yes` when no auth handler is set), overriding `core.sshCommand` and the user's `GIT_SSH_COMMAND`. Without one, behavior is unchanged.
- Host identities (rule S40): every network command picks the key per remote. Order: the repository's own `ssh_key_path`, then the identity whose host equals the host of the remote URL, then the app-wide `ssh_key_path`, then the agent and `~/.ssh/config`. The URL is `git remote get-url` of the remote the operation names (`--push` for a push), so `insteadOf` rewrites apply; a clone uses the typed URL. `fetch` resolves each remote on its own. The host is read from `git@host:path`, `ssh://[user@]host[:port]/path`, or `https://[user@]host[:port]/path`, lower-cased, and compared exactly with the identity's `host[:port]`: an identity bound to a port does not match the same host without it, and an identity without a port does not match a URL that names one. A matched identity without a key uses the agent, not the app-wide key. Removing an identity never deletes key files or saved passphrases. The `https_user` of the identity whose host equals the host of a credentials prompt fills the prompt's `username`; passwords and tokens are never stored by YForge. An SSH passphrase prompt (`Enter passphrase for key '<path>':`) for a key whose passphrase YForge saved is answered from the Keychain without a prompt; if ssh asks for the same key again (the saved one was refused), the prompt reaches the UI once with its message prefixed "The passphrase saved in the Keychain was not accepted.", and the Keychain is not asked again for that key in that operation. Operations without an auth handler (background fetch) never use it.
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

- **Opt-in:** nothing is sent until the user runs an AI command, and only to the provider saved for that feature. Every Git workflow works without a provider. The three feature commands return drafts only: they never commit, rewrite history, or write files.
- **Providers** (`yforge.db` migrations 3 and 6, table `ai_providers(seq, id, kind, auth_mode, name, base_url, has_api_key, created_at)`; migration 7 dropped the provider model and the `ai.active_provider` setting). Connections are direct API calls; YForge starts no AI command-line tool. Details in `docs/AI_PROVIDERS_V2.md`:
  - `chatgpt`: `api_key` runs `POST https://api.openai.com/v1/responses` (Bearer). `subscription` uses YForge's own OAuth (client `app_EMoamEEZ73f0CkXaXp7hrann`, issuer `https://auth.openai.com`, PKCE S256 browser flow on `http://localhost:1455/auth/callback`, or the device-code flow) and runs `POST https://chatgpt.com/backend-api/codex/responses` with Bearer plus `chatgpt-account-id`. Tokens are stored as JSON in the Keychain (account `<provider id>:oauth`) and refreshed at `/oauth/token` when within 60 s of expiry; the account id is the `chatgpt_account_id` claim of the id token, else of the access token (top level, then `https://api.openai.com/auth`, then `organizations[0].id`). Responses are read as an event stream.
  - `claude`: `api_key` runs `POST https://api.anthropic.com/v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`. `subscription` reads Claude Code's Keychain item `Claude Code-credentials` (`claudeAiOauth`) read-only and sends Bearer, `anthropic-beta: claude-code-20250219,oauth-2025-04-20`, `x-app: cli`, and the Claude Code identity as the first system block. An expired token is refreshed at `https://claude.ai/v1/oauth/token`; the refreshed pair is cached in YForge's Keychain (`<provider id>:oauth`) and never written to Claude Code's item; the later expiry of the two wins.
  - `openrouter`: `https://openrouter.ai/api/v1` with an API key, chat completions. `openai_compatible`: any number of instances with a base URL and an optional key, `POST {base}/chat/completions`. Both take `api_key` only.
  - Model lists: OpenAI `GET /v1/models`; ChatGPT subscription `GET /backend-api/codex/models?client_version=0.157.1` (`models[].slug`, `display_name`); Anthropic `GET /v1/models?limit=1000` (`display_name`); OpenRouter `GET /models` (`name`, `context_length`); OpenAI-compatible `GET {base}/models`. `context_window` is filled from `context_window` (ChatGPT), `max_input_tokens` (Anthropic), or `context_length` (OpenRouter) when present.
- **API keys** live only in the macOS Keychain (`keyring`, service `dev.yforge.desktop.ai`, account = provider id); the database keeps only `has_api_key`. Keys never appear in `yforge.db`, logs, crash records, or activity output.
- **`ProviderStatus`:** `ready`, `signed_out`, `key_missing`, `key_rejected`, `unreachable { message }`, `check_failed { message }`. The list makes no network call: an `api_key` provider is `ready` once it has a key (`key_missing` otherwise; `openai_compatible` needs none), a `subscription` provider is `ready` when tokens (ChatGPT) or credentials (Claude) exist, else `signed_out`. `ai_provider_test` calls the models API (401/403 is `key_rejected`, or `signed_out` for a subscription; no connection is `unreachable`).
- **Feature configuration** (table `ai_feature_config(feature, provider_id, model_id, prompt_template, enabled)`, migrations 6 and 7; rows die with their provider): `ai_run` for a feature uses its row and is refused as `ai_not_configured` ("Choose a provider and model for <feature title> in Settings → AI", or "<feature title> is turned off in Settings → AI") when there is no row or it is off. `prompt_template` holds `{context}` exactly once; the text before it is sent as the system prompt (instructions), the context plus any text after it as the user message. Built-in defaults live in `crates/yforge-ai/src/prompt.rs`.
- **Runs:** ChatGPT sends `{ model, instructions, input: [user], stream: true, store: false }`; Claude sends `{ model, max_tokens: 8192, system: [...], messages: [user] }`; OpenRouter and OpenAI-compatible send `{ model, stream: false, messages: [system, user] }`. TLS is always verified and redirects are not followed.
- **Privacy filter:** files whose base name matches `.env*`, `*.pem`, `*.key`, `id_rsa*`, or `credentials*` (case-insensitive) are not sent; they are listed in `excluded`, and commit and recompose name them with content withheld. A conflicted file of that kind is refused. Commit diffs are capped at 20 KB per file and 60 KB in total (`truncated` lists cut files); binary files go by name only. Recompose hunk content is capped at 4 KB per hunk and 60 KB in total.
- **`ai_generate_commit_message`:** sends the staged diff plus the last 10 commit subjects and expects `{ "summary", "description" }`; `summary_trimmed` is true when the summary was cut to its first line or to 72 characters. Nothing staged, or only secret files staged, is `invalid_request`.
- **`ai_propose_recompose`:** expects groups of `{ "kind": "hunk", "id" }` or `{ "kind": "file", "path" }` changes with messages; every hunk of a splittable file and every whole-file unit must be assigned exactly once. The result is ready for `recompose_apply`.
- **`ai_propose_conflict`:** sends each region's current, incoming, and base (when present) with 3 lines of context and expects exactly one `{ index, text, rationale }` per region; `index` counts the `conflict` segments of `ConflictFile.segments` from 0. `text` is the replacement lines joined with `\n`; the UI joins with the file's `eol` and puts it in the Result pane. Marking the file resolved stays manual. Secret, binary, and over-60 KB conflicted files are `invalid_request`.
- **Cancellation:** each feature command registers its operation id; `operation_cancel` stops the request or process with `cancelled`.
- **Activity and usage:** each feature call that reaches a provider records an activity entry (`AI commit message`, `AI recompose proposal`, `AI conflict proposal`; not local, no commands, no undo) whose summary is `<provider name> · <model>`; on failure `error` holds only the error kind. With `telemetry_opt_in` the usage event adds `provider` (kind) and `model` only, never prompt or response content, paths, or messages.
- **Tests:** `crates/yforge-ai/tests/` use `TcpListener` HTTP fakes, an in-memory `SecretStore` for the YForge Keychain and another for Claude Code's; `live.rs` is an ignored smoke test. `app/src-tauri/tests/ai.rs` covers the commands.

### Recovery

- **Reflog.** `reflog_refs` lists `HEAD` and the local branches that have a reflog. `reflog_list` takes `HEAD` or `refs/heads/<name>` of an existing branch (anything else is `invalid_request`) and returns entries newest first, read from the reflog file. `ReflogEntry { index, selector, sha, previous_sha, action, message, time, summary, exists }`: `index` 0 is the newest; `selector` is `HEAD@{n}` or `<branch>@{n}`; `previous_sha` is `null` for the entry that created the ref; `time` is Unix seconds; `exists` is whether the commit object is still present (`summary` is empty when it is not). `action` is the text before the first `:` of the message reduced to its first word (`checkout`, `reset`, `merge`, `pull`, `rebase`, `cherry-pick`, `branch`, …), except commits, which keep their kind (`commit`, `commit (amend)`, `commit (initial)`, `commit (merge)`); an empty message is `other`. `before` is the `index` of the last entry shown (`null` starts at the newest); `limit` is clamped to 1..200. An unborn repository gives an empty list.
- **Lost commits.** `lost_commits` runs `git fsck --no-reflogs --unreachable --no-progress` and returns `LostCommit { sha, summary, author, time, kind }` for commits no ref reaches (including `refs/yforge/snapshots/*`), newest first, at most 500. `kind` is `stash` for a git-stash-shaped commit (a base parent plus an `index on …` commit, optionally a parentless `untracked files on …` commit); a detected stash's index and untracked commits and all snapshot commits are not listed. The scan stops after 120 s with `git_failed`; with `id` it is cancellable through `operation_cancel`.
- **Restore.** `sha` is a commit id from a reflog entry, a lost commit, or a snapshot's `head_sha`. `restore_as_branch` creates a branch at `sha` without checking it out (undo: as create branch). `restore_checkout` checks out `sha` detached without stashing, so a dirty tree is `local_changes` (undo: as checkout). `restore_reset` resets to `sha` in the given mode; `hard` takes a safety snapshot first (undo: as reset). They record `Restore as branch`, `Restore checkout`, and `Restore reset`.
- **Safety snapshots.** Before a destructive action the core saves the repository state as a commit under `refs/yforge/snapshots/<unix-ms>-<action>`. Its tree is the working tree including untracked, non-ignored files; its parents are HEAD (absent before the first commit) and an index commit (tree = the index, parent = HEAD); unmerged paths are left out of the index tree only. Trees are built with a scratch `GIT_INDEX_FILE`, so the real index and working tree are never touched. The message is `YForge snapshot: <action>` with a description and `YForge-Action`, `YForge-Head`, `YForge-Branch`, `YForge-Index`, `YForge-Files`, and (for a dropped stash or deleted branch) `YForge-Subject` trailers; it is authored as `YForge <snapshots@yforge.invalid>` through that call's environment only.
  - Actions: `discard`, `discard_hunk`, `discard_lines` (after the stale-hunk checks), `reset_hard` (including a hard `restore_reset`), `checkout` (only when the tree is dirty and an auto-stash runs), `interactive_rebase`, `squash_commits`, `recompose`, `drop_stash`, `delete_branch`, `remove_worktree` (only with `force`, snapshotting that worktree), `restore_files`, `restore_snapshot`.
  - If the snapshot cannot be saved, the action is refused with `snapshot_failed` before anything changes; a snapshot is never skipped silently.
  - Retention: snapshots older than 30 days are deleted, then the oldest beyond 200, once per process per repository on first `repo_open` and after each new snapshot. No other ref is touched; `git gc` may still prune unreferenced objects later.
  - Exclusion: `refs/yforge/*` is excluded from the graph, search, the graph cache key, and every ref list. Pushes use explicit refspecs (never `--mirror` or `--all`), so snapshots leave the machine only through an external `git push --mirror`.
- **Snapshot commands.** `reference` must be a YForge snapshot ref, otherwise `invalid_request`. `snapshots_list` returns `SnapshotInfo { ref, time, action, description, head_sha, branch, files_changed }` newest first (`head_sha` and `branch` are `null` before the first commit or on a detached HEAD). `snapshot_files` returns `SnapshotChange { path, status }` (`added`, `modified`, `deleted`, `type_changed`) against the snapshot's HEAD. `snapshot_restore_files` writes the listed files from the snapshot into the working tree (each must be a file in the snapshot, no `..`, never through a symlink; the index is untouched). `snapshot_restore_all` restores the index and working tree to the snapshot's state; it refuses during a merge, rebase, cherry-pick, revert, or bisect, and refuses when HEAD or the branch moved unless `force` is set, and it never moves HEAD. Both restores first snapshot the current state and return that ref, so a restore is undone by restoring that snapshot. `snapshot_delete` removes only that ref.
- Not snapshotted: operation abort, pull with auto-stash (the stash itself preserves the changes), the `worktree_integrate` cleanup, `conflict_reset`, and undo.

### File view

- `file_at_revision` reads one file for the Inline full-file view and the file view. `rev` is a commit id (4–64 hex characters), `:index` (the staged blob), or `:worktree`; anything else is `invalid_request`, as are an unsafe path and a file that is not a regular file or blob in that revision.
- `FileAtRevision` is `{ kind: "text", text, size, eol }` or `{ kind: "binary", size }`. A file with a NUL byte or invalid UTF-8 is binary. `eol` is the majority line ending (`"\r\n"` when CRLF lines outnumber bare LF lines, else `"\n"`); `size` is in bytes.
- A file larger than 2 MiB (2,097,152 bytes; exactly that size is shown) fails with `file_too_large` before it is read.
- `diff_file`, `commit_file_diff`, and `stash_file_diff` apply the same limit to the text of the diff lines they would return: a diff of more than 2 MiB fails with `file_too_large` whose `output` is the diff size in bytes. The diff view states the size and the limit in text instead of rendering lines. The staged diff the commit-message context reads is not limited by it (the context has its own budget).
- `:worktree` refuses a symbolic link and a path behind one (`invalid_request`).
- The untracked files of a `-u` stash are read with `rev` = `StashDetails.untracked_sha`.
- `FileDiff` carries `old_size` and `new_size`: byte sizes set only when `binary` is true and only for the side that exists (`null` otherwise, and always `null` for text diffs).

### Stash details

- `stash_details` checks that `stash@{index}` is still `sha` (otherwise `invalid_request`). `StashDetails { index, sha, message, base_sha, untracked_sha, files }`: `base_sha` is the first parent, `untracked_sha` the third parent of a `-u` stash (else `null`). `files` are `StashFile { path, original_path, status, additions, deletions, untracked }`: first the tracked changes against the first parent (with rename detection; `additions`/`deletions` are `null` for binaries), then every file of the third parent as `added` with `untracked: true`.
- `stash_file_diff` makes the same check and returns the `FileDiff` of one listed file (tracked against the first parent, untracked against the empty tree). A path not in `files` is `invalid_request`.

### Graph visibility and the working-tree row

- Row 0 is the working-tree row whenever HEAD exists: kind `changes` when the working tree has any change, else `clean_changes` (summary "Working tree clean"); its parent is HEAD. An unborn repository has a row only while it has changes.
- `GraphVisibility` is `{ kind: "all" }`, `{ kind: "current_and_upstream" }`, or `{ kind: "refs", refs: { name, kind: "local_branch" | "remote_branch" | "tag" }[] }`. Filtered layouts are computed for the filtered history alone, so lanes, edges, and `total` describe only the rows shown, and `search_commits` with the same `visibility` returns indexes into them. `current_and_upstream` shows the checked-out branch and its upstream (a detached HEAD shows its own history) and labels tags on shown commits; `refs` shows only the listed refs (missing ones are skipped; an empty list shows only the working-tree row). Stash rows stay only when their base commit is shown. The visible tips are part of the graph cache key.

### Interface preferences

- `repo_ui_prefs_load` / `repo_ui_prefs_save` keep one JSON blob per repository in `yforge.db` (migration 4, table `repo_ui_prefs(repository, prefs, updated_at)`). `RepoUiPrefs { columns: ColumnPref[], collapsed_folders: string[], branch_visibility: GraphVisibility }`; `ColumnPref { column: "refs" | "graph" | "author" | "date" | "sha", visible, width? }`. Missing fields take their defaults. Save refuses with `invalid_request` (leaving the stored value untouched) for a blank path, a repeated column, a hidden `refs` or `graph` column, a width outside 24–2000, blank or repeated folder ids, more than 5,000 folders, or more than 500 refs. A stored blob that does not match is `storage_failed`.

### Application interface preferences

- `app_ui_prefs_load` / `app_ui_prefs_save` keep the two application-wide interface values in the `settings` table (keys `ui.palette_recents` and `ui.last_parent_folder`, JSON values; no migration). `AppUiPrefs { palette_recents, last_parent_folder }`: `palette_recents` are the ids of the most recently run palette commands, newest first; `last_parent_folder` is the parent folder last used by the clone and create dialogs. Missing keys take their defaults (an empty list, `null`). Save replaces both values in one transaction and refuses with `invalid_request` (leaving the stored values untouched) for more than 8 commands, a blank, repeated, or over 1,024-character command id, or a blank or over 4,096-character folder. A stored value of the wrong shape is `storage_failed`.
- The frontend keeps no state in browser storage: nothing is read from or written to `localStorage`, and nothing was imported from it.

### Command line and single instance

- The app uses `tauri-plugin-single-instance`. Launching the binary again does not start a second instance: the running window is focused and, when the first argument is non-empty, `open-path-requested { path }` is emitted; the UI opens it as a tab. The first launch still uses `launch_path`.
- `cli_install` (only when the user triggers it) writes `~/.local/bin/yforge`, creating the directory when needed, with no elevated rights. The file is a `/bin/sh` script (mode 0755, second line `# Installed by YForge`) that runs the current YForge executable detached with the arguments, so the terminal is not blocked and a running instance receives the path through the single-instance hand-off. A file or link there without that marker is never touched (`invalid_request`); a marked script is replaced atomically (`replaced: true`); a write failure is `storage_failed` with the operating system's message. Whether `~/.local/bin` is on `PATH` is not checked; the UI says so.
- `RepoSnapshot.main_root` is the main worktree path (equal to `root` outside linked worktrees); the other `worktrees` entries are the siblings, and the UI groups tabs by `main_root`.

### `GraphPage`

`{ rows, carried, total }` for the window `[offset, offset + limit)` of the full layout. `total` counts all rows, including the Changes row and stash rows.

- **Order:** `git log --topo-order --exclude=refs/stash --all`, newest first. Stash rows sit before the first commit that is not newer than the stash, and always before their base commit. Row 0 is the working-tree row (see Graph visibility and the working-tree row).
- **Row:** `sha` (`null` for Changes), `parents`, `summary`, `author { name, initials }` (`null` for Changes), `time` (Unix seconds; `null` for Changes), `refs { name, kind, is_head }` with `kind` of `local_branch`, `remote_branch`, or `tag` (annotated tags are peeled), `kind` of `commit`, `merge`, `stash`, or `changes`, `column`, and `edges`.
- **Edge:** `{ lane, parent_row, parent_column }`. `lane` is the column the edge runs along. `parent_row` and `parent_column` are global row and column indices, or `null` when the parent is not in the graph. The renderer draws node → lane on the child's row, down the lane, then into the parent's column on the parent's row.
- **Carried edges:** `carried` holds `{ row, column, kind, edge }` for edges from rows above `offset` whose parent is at or below `offset` (or outside the graph). With them a client can draw any window without loading earlier pages.
- **Lane algorithm:** COMPONENT_SPECS § Graph row, "Lane model (S13)". It is a port of `layout()` in `docs/design/specimens/workspace.html` (`crates/yforge-core/src/layout.rs`).

## Errors

Every command rejects with a tagged `ErrorPayload { kind, message, output }`. `output` is `null` except for `commit_failed`, `auth_failed`, `local_changes`, `push_rejected`, `not_fast_forward`, `ai_auth_required`, `ai_failed`, and `file_too_large`. The client rethrows it as `IpcError` (`kind`, `message`, `output`); a non-payload rejection becomes `IpcError` with kind `internal`.

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
| `unsupported` | Git lacks `merge-tree --write-tree`, or draft creation is requested on Bitbucket Data Center older than 8.18; the message names the unsupported capability |
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
| `snapshot_failed` | A safety snapshot could not be saved before a destructive action; the action was refused and nothing changed. The message names the action and git's reason |
| `file_too_large` | `file_at_revision` found a file over 2 MiB, or `diff_file`, `commit_file_diff`, or `stash_file_diff` found a diff over 2 MiB; `output` is the size in bytes (decimal) |
| `ai_not_configured` | The feature has no saved provider and model, or it is turned off |
| `ai_provider_unavailable` | The endpoint could not be reached; the message carries the reason |
| `ai_auth_required` | No key is stored, the subscription is not signed in ("Sign in to ChatGPT first", "Sign in to Claude Code first"), a refresh was refused, or the endpoint answered 401/403; `output` is the sanitized provider message |
| `ai_invalid_response` | The reply is not one JSON value, fails the schema, or fails validation (recompose: a change unknown, repeated or unassigned, blank message, no groups; conflict: a missing, repeated or unknown region, or conflict markers in a text); nothing is repaired |
| `ai_failed` | The provider failed in another way; `output` is sanitized (colour codes removed, URL credentials, `Authorization`/`password=` lines, `Bearer` and `sk-` tokens and the stored key masked, at most 2,000 characters) |
| `ai_timeout` | No answer within 180 s (completion), 20 s (status, models), or 16 min (sign-in) |
| `internal` | The blocking task failed (for example, a panic) |

## Pull request composition and prediction (S75–S78)

- `PullRequest` retains its existing fields and adds `draft: boolean`. Every adapter populates it from the platform response, including list, detail, create, merge, and Launchpad results. Drafts retain `state: "open"`; merged and closed requests are not badge candidates.
- `CreatePull { source_ref, target_ref, title, body, draft }` requests draft creation explicitly. Omitted `draft` on the wire defaults to false. GitHub, Bitbucket Cloud, and Bitbucket Data Center send the draft flag; GitLab uses its documented `Draft:` title prefix. Before a Data Center draft POST, the adapter reads `application-properties` and refuses versions older than 8.18 or an unrecognizable version with `unsupported`, without creating a non-draft. Platform requests still return their existing typed authentication, API, and network errors.
- `PullChecks { passing: number, failing: number, pending: number, capped: boolean }` counts the platform's available rollup. `null` means no reported checks or an unsupported build-stat endpoint, not an invented passing state. A lookup failure rejects only the checks command; it never fails or delays the pull request list. Successful results (including null) are cached for 30 seconds by connection id, repository owner/name, and request number, with at most 256 entries. Matching is checked before using the cache; no matching connection means no request and no Keychain access.
- Checks requests are bounded and never fan out over the list: GitHub makes at most three GETs (pull head, latest check runs, combined latest commit statuses), with at most 100 entries from each check/status endpoint; `capped` marks incomplete counts. GitLab makes one merge-request GET and counts its `head_pipeline` as one aggregate check. Bitbucket Cloud makes one statuses GET (`pagelen=100`), marking a next page as capped. Bitbucket Data Center makes at most two GETs (pull head and `build-status/1.0/commits/stats/<sha>`), using the server's successful/failed/inProgress totals; a missing stats endpoint returns null. There are no per-job or per-file requests. Display capped counts as incomplete, and GitLab counts as the pipeline rollup, not individual jobs.
- `ComparedCommit { sha, summary, author, timestamp }` identifies every commit reachable from source but not target; `timestamp` is the author time in Unix seconds. `BranchComparison { merge_base, source, target, commits, files, additions, deletions }` resolves both revisions to immutable commit ids, returns all source-only commits newest first, and counts the diff from merge base to source (three-dot comparison). Binary files count as files with zero numeric lines. Invalid revisions or unrelated histories reject instead of claiming a clean comparison. All comparison, prediction, and AI context Git reads run with lazy fetching disabled; a partial clone missing required objects fails locally without downloading objects into the repository. Cancellable reads propagate the token through the complete blocking read, including revision resolution and per-file diffs.
- `MergePrediction { merge_base, conflicted_files: string[] }` describes merging theirs into ours, independently of the index/worktree. A clean prediction has an empty file list. The in-memory cache holds at most 256 results keyed by repository root, ordered ours/theirs tree ids, and merge-base commit id. Revisions and cache keys are read afresh on each call so a moved ref cannot produce a stale result; cache hits skip merge-tree, while revision-resolution Git reads still run. Nothing is persisted.
- Prediction runs `git merge-tree --write-tree --name-only -z` with a private, unique temporary object directory outside the repository (`GIT_OBJECT_DIRECTORY`) and the repository's resolved object store as `GIT_ALTERNATE_OBJECT_DIRECTORIES`, supporting linked worktrees. Temporary objects are removed afterwards, including cancellation and errors; no ref, index entry, object in the repository, or working-tree file is written. A repository with configured external merge drivers returns `unsupported` before prediction: those drivers can write arbitrary files, and substituting a different driver would invent a result. `GIT_NO_LAZY_FETCH=1` disables lazy object fetching. Cancellation kills and reaps the prediction process and joins output readers. Missing `--write-tree` returns `unsupported` rather than an incorrect clean result.
- Template lookup reads only the open repository's working tree. Priority: `.github/pull_request_template.md`, `docs/pull_request_template.md`, root `pull_request_template.md`, then `.gitlab/merge_request_templates/Default.md`; each path component is matched case-insensitively with deterministic lexical precedence. A symlink escaping the repository is refused. No matching template returns null.
- `PullRequestDisclosure { commit_messages, files, additions, deletions, provider_name, excluded: string[], truncated: string[] }` reports compared-range counts and the selected provider/account display name, with withheld/cut file notes. `ai_pull_request_context` obtains this before Generate; provider authentication may refresh existing subscription credentials, but no completion or repository content is sent. Generation rebuilds the range and returns the actual disclosure with the draft; if refs changed, its counts may differ from preflight.
- `PullRequestDraft { title, description, title_trimmed, sent: PullRequestDisclosure }` is an editable result, not a Git/platform write. AI receives only compared-range commit messages, aggregate diffstat, bounded hunks with secret/binary/size notes, and the caller-supplied description template; no working-tree changes, unrelated history, author identities, or ref names enter the generation context. Diff limits reuse the existing 60 KiB total and 20 KiB per-file budgets. Templates larger than 20 KiB are refused. Secret source paths are withheld even when renamed to a non-secret destination. The title is fitted to one line of at most 72 Unicode characters. Empty titles/descriptions and missing or unfilled Markdown template sections are `ai_invalid_response`; generated claims of testing remain drafts for the user to review.
- `AiFeature::ComposePullRequest` serializes as `compose_pull_request`, with the Settings label "Pull request descriptions". It uses the same provider/model/prompt/switch configuration and cancellation as existing features. Migration 16 expands the feature CHECK while preserving existing providers, models, prompts, switches, and ordering. The new Activity operation is `ai_compose_pull_request` ("AI pull request draft").
- Client methods: `platformPrChecks(path, number)`, `branchComparison(path, source, target)`, `mergePrediction(path, id, ours, theirs)`, `pullRequestTemplate(path)`, `aiPullRequestContext(path, source, target)`, and `aiComposePullRequest(path, id, source, target, template)`. Prediction and generation register the supplied operation id; `operationCancel(id)` stops them and returns the existing cancellation result. Generation is invoked only explicitly; Title/Description restore, field locking, source push sequencing, and UI badge matching remain frontend responsibilities.

## Threading and cancellation

- Commands are `async`. Git work runs through `tauri::async_runtime::spawn_blocking`, off the main thread.
- Each call runs its own git processes and returns one response. The shared state is the single repository watcher held by the shell (`repo_watch`) and the core's graph layout cache.
- Mutating commands take git's own locks; a concurrent git process in the terminal surfaces as `git_failed` with git's message.
- `repo_graph` and `search_commits` reuse one computed history and layout per repository root. The cache key is every ref and its target (`git for-each-ref`), the HEAD commit, the stash commits, the commit tips of the requested visibility, and whether the working tree has changes; any difference recomputes the full layout, and the working-tree summary text is always read fresh. Pages are consistent only while the key does not change between calls. The ignored test `crates/yforge-core/tests/graph_perf.rs` gates the first page at under 1 s for 10k commits and under 3 s for 100k commits (`cargo test --release -p yforge-core -- --ignored`).
- `fetch`, `pull`, `push`, `push_force`, `push_tag`, `delete_remote_tag`, `publish`, and `clone_repo` register their `id` in a registry held by the shell (`OperationRegistry`); `operation_cancel` sets the cancel flag of the registered operation, and the id is removed when the call ends.
- `merge_prediction` and `ai_compose_pull_request` are also cancellable through the operation registry. Incremental layout and cherry-pick/revert of merge commits (parent choice) remain deferred.

## Authentication prompts

- A network command builds its `CancelToken` with an auth handler. `run_streaming` then starts a per-operation askpass bridge: a private temporary directory (mode 0700) holding a POSIX shell helper, exported as `GIT_ASKPASS` and `SSH_ASKPASS` (with `SSH_ASKPASS_REQUIRE=force`). The helper writes each prompt to a request file and waits for a response file; the bridge thread classifies the prompt, calls the handler, and writes the answer (mode 0600). The directory is removed when the git command ends, and a helper whose directory vanished exits, so cancelling leaves no process behind.
- The shell's handler emits `auth-prompt` and blocks for `auth_respond`, `operation_cancel`, or a 120 s timeout. A cancel or decline ends the git command with `cancelled`; a timeout ends it as `auth_failed`. Git does not re-ask after a rejected HTTPS credential, so a wrong token also ends as `auth_failed`, and the next attempt prompts again.
- HTTPS: the username prompt is answered with the entered username, and the following password prompt with the entered token, without a second dialog. When the operation succeeds, `git credential approve` runs for a credential the user chose to save and `git credential reject` for one they did not (git itself already offered it to the configured helper). Nothing else stores credentials.
- SSH: passphrases go to ssh through the same helper; an unknown host key arrives as a `host_key` prompt (`SSH_ASKPASS_PROMPT=confirm`) and `trust` answers `yes`. ssh-agent keeps working: the agent answers before any prompt. A token without a handler (auto-fetch with `interactive: false`, and every direct core call) keeps `ssh -o BatchMode=yes` and `GIT_TERMINAL_PROMPT=0`.
- Secrets never reach a log: the shell logs prompt ids, kinds, and hosts, and only the variant name of a reply. Command lines, git errors, and recorded output pass through `redact` (URL user info, `password=`, `Authorization`, `extraheader` lines).

## Paged lists

Rule S44. The lists read from GitHub, GitLab, Bitbucket, and Jira follow the service's pagination to the end, up to a safety cap of 1,000 items per list (`LIST_CAP`, `crates/yforge-platform/src/paging.rs`). Every list carries its count in two fields:

- `total: number | null`: the true number of items. When the list is not capped it is the number of items returned. When it is capped it is the total the service reported, or `null` when the service reports none (the UI then says "Showing the first 1,000").
- `capped: boolean`: `true` when the service has more items than the 1,000 returned (UI: "Showing 1,000 of <total>"). A list of exactly 1,000 items with nothing after it is not capped.

| Command | Type | Page size and how the next page is found | Where `total` comes from |
|---|---|---|---|
| `platform_prs_list` | `PullList { pulls, total, capped }` | GitHub `per_page=100&page=n` (a full page means another may follow); GitLab `per_page=100&page=n`, `X-Next-Page`; Bitbucket Cloud `pagelen=50`, the `next` link; Bitbucket Data Center `limit=100&start=n`, `isLastPage` and `nextPageStart` | GitLab `X-Total` and Bitbucket Cloud `size` when sent; GitHub and Bitbucket Data Center send none |
| `platform_pr_detail` | `PrDetail { pull, files, files_total, files_capped }` | GitHub `…/files?per_page=100&page=n`; Bitbucket Cloud `…/diffstat?pagelen=500`, the `next` link; GitLab and Bitbucket Data Center return the files in the one detail response, cut by the service (GitLab `overflow` or a `changes_count` ending in `+`; Data Center `truncated`) and by the cap | GitHub `changed_files` of the pull; Bitbucket Cloud `size`; GitLab a numeric `changes_count`; Data Center the file count when the diff is not truncated |
| `platform_my_pulls` | `LaunchpadPulls { pulls, total, capped }` | the same paging per role (GitHub search `page`, whose `total_count` is the total; GitLab `X-Total`; Data Center dashboard `start`; Bitbucket Cloud `next`); the roles are merged, de-duplicated, sorted most recently updated first, and cut to 1,000 | the sum of the role totals when every role has one (a pull request in both roles is counted twice in a capped list), else `null`; when not capped, the number of pulls |
| `jira_my_issues` | `JiraIssueList { issues, total, capped }` | Jira Cloud `maxResults=100` with `nextPageToken`; Jira Data Center `maxResults=100&startAt=n` | Data Center `total`; Jira Cloud sends none, so a capped list has `null` |

- After 1,000 items, a list whose service gives no total is probed with one more page request to tell "exactly 1,000" from "more"; a service that gave a total is not probed.
- A request that fails fails the whole list (the error of that request); no partial list is returned.
- `jira_issues_lookup` and the Jira `projects` read are not paged lists in this sense: the lookup asks 50 keys per request, and the project list is stored with the connection without a total.

## Activity and undo

- The shell wraps every mutating command in a thread-local recorder. Each `git` invocation except read-only queries (`rev-parse`, `status`, `log`, `diff`, `for-each-ref`, `config --get`, and similar) becomes a `CommandRecord { command, status, duration_ms, output }` with secrets redacted and output capped at 64 KB (hook output included). One `ActivityEntry { id, repo, operation, summary, started_at, duration_ms, ok, local, toast, error, commands, undo }` is kept per command in an in-memory log (300 entries, this session only) and announced with `activity-recorded`. `local` is true for operations that change refs, history, or discard content; `toast` marks the outcomes the UI reports. A bulk verb (`delete_branches`, `delete_tags`, `drop_stashes`) is one command and so one entry and one toast: the summary names the count (`Deleted 3 branches`) or, when some items failed, the outcome (`Deleted 1 of 2 branches (1 failed)`). The entry is `ok` when at least one item was done; when none was, the call fails and the UI shows the error instead.
- `undo` is `available { scope }`, `unavailable { reason }`, or `undone`. The scope names what undo will do and is the button tooltip.
- Undoable operations, with what `undo_last` does (each first requires that no merge, rebase, cherry-pick, revert, sequence, or bisect is in progress):

| Operation | Undo | Refused when |
|---|---|---|
| `commit` | `git reset --soft <previous HEAD>` (changes stay staged); unavailable for a first commit | HEAD or the branch moved |
| `commit` with amend | `git reset --soft <pre-amend HEAD>` | HEAD or the branch moved |
| `create_branch` | delete the branch, switching back first when it was checked out | the branch has new commits or is gone |
| `delete_branch` | recreate it at the recorded sha, restoring its upstream | the name exists again |
| `delete_branches` | recreate every branch that was deleted, each at its recorded sha with its upstream; nothing is created when any of the names exists again | a name exists again |
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
- `yforge.db` tables: `settings(key, value)` (namespaced keys, JSON values, defaults for missing keys), `repo_settings(repository, key, value)`, `recents` (at most 30, ordered), `session`, `session_tabs` (with `group_position`), and `session_groups(position, name, color, collapsed)`, `activity` and `activity_commands` (at most 1,000 entries per repository, pruned on insert). Jira sites live in `jira_connections(seq, id, kind, site, email, display_name, projects, created_at)` (migration 9; `projects` is a JSON list of `{ key, name }` refreshed on connect and Test; the token is never stored there). Host identities live in `git_hosts(seq, id, host, ssh_key_path, https_user, created_at)` (migration 10; `host` is unique and stored lower-cased; no secret is stored).
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
| Screens, URL state | `@tanstack/solid-router` | ^1.170.37 | Code-based routes (`app/src/routes.tsx`), hash history, no codegen. `/launcher` (a new tab, which shows the Launchpad), `/launchpad?tab=<tab id>`, `/repo?tab=<path>`, `/settings/$section?tab=<tab id>`. The URL owns which tab and screen is active (`app/src/state/app.ts` derives `activeTab()` and `screen()` from it); only the active repository tab's workspace is mounted (the watcher is single-instance). Tab and settings navigation replaces the history entry. |
| IPC reads and writes | `@tanstack/solid-query` | ^5.104.0 | One `QueryClient` per app (`createAppState`). Components read queries through `useQuery` and `useInfiniteQuery` from `app/src/state/query.ts`, which bind the package's `QueryObserver` to a Solid signal without the package's resource, so a refetch never suspends the router's boundary: the package's own hooks suspended it on every refresh, detached the whole workspace and dropped focus from open popovers and inputs. Keys are in `app/src/state/queryKeys.ts`, scoped by repository path (`["repo", path, …]`); app-wide reads use `["recents"]`, `["app-info"]`, `["identity"]`; `["repo-settings", path]` and `["conflict", path, file]` sit outside the repository prefix because the watcher must not refetch them. Git writes go through `session.mutate` (a mutation that invalidates `["repo", path]`); `repo-changed` calls the same refresh. Leaving a workspace removes its snapshot and graph pages. Authentication replies never enter the cache. |
| Shared client state | `@tanstack/solid-store` | ~0.11.2 | Tab list, app settings, workspace selection and diff target, and the commit composer's pending edits (`state/clientStore.ts`). Component-local state (menus, popovers, drafts of one field) stays in Solid signals. |
| Long lists | `@tanstack/solid-virtual` | ^3.13.40 | The graph rows (`GraphPanel`), the file lists of the Changes, Commit and Operation inspectors, and the lines of each diff hunk (`components/VirtualRows.tsx`). Graph options keep `aria-posinset`/`aria-setsize`; the selected or focused row stays rendered while scrolled away; J/K, Home, End and reveal-by-search scroll through the virtualizer. |
| Data grid model | `@tanstack/solid-table` | ^9.2.4 | The graph's column definitions, visibility, and sizing (`graph/columns.ts`), persisted per repository through `repo_ui_prefs_load/save`; no rows go through the table (the graph pages rows by index). |
| Multi-field forms | `@tanstack/solid-form` | ^1.33.5 | Remote form in settings, clone and create dialogs, branch-name, stash and tag popovers, authentication dialog (the secret is reset after submit). The merge popover (one choice), the single-field settings inputs, the commit composer (draft state lives in the Store so it survives inspector switches and amend prefill) and the pull request compose view (template prefill, AI drafts and Restore my text replace its values, and Create states one disabled reason) stay on primitives. |
| Debounce, coalescing | `@tanstack/solid-pacer` | ~0.23.0 | Commit-search input debounce, refresh coalescing (one running reload plus at most one queued follow-up), tooltip hover delay. No other handler was hand-debounced. |
| App shortcuts | `@tanstack/solid-hotkeys` | ~0.12.1 | Registry shortcuts (`state/palette.ts` stays the single source; `hotkeyOf` converts a label) plus ⌘K, Escape to leave a diff, and ⌘G / ⇧⌘G. ⌘Z does not fire inside text inputs. Keys scoped to a focused element (graph J/K, file-row S/U, menus, dialogs) remain DOM handlers of that element. Chords use `Mod` (⌘ on macOS). |
| Debug panels | `@tanstack/solid-devtools`, `@tanstack/solid-query-devtools`, `@tanstack/solid-router-devtools` | ~0.8.13, ^5.104.0, ^1.167.2 | Dev dependencies, loaded by a dynamic import under `import.meta.env.DEV` (`app/src/devtools.tsx`). The release bundle contains no panel or devtools UI; `@tanstack/form-core` and the other libraries still embed their small event-client emitter (strings `tanstack-devtools-global`). |

Diagnostics lists: the usage, crash, and persisted-history lists (`["diagnostics", "usage"]`, `["diagnostics", "crashes"]`, `["activity-history", path]`) are infinite queries over the `before` cursor, 25 rows a page, extended by "Show older" (`state/diagnosticsModel.ts`, `state/pagedList.ts`); clearing invalidates the key, and turning usage recording off removes the usage key. The Activity drawer reads the same history key for its "Earlier" group and drops entries the session already lists. Frontend errors are reported to `crash_report` by `state/crashCapture.ts` (window `error`, `unhandledrejection`) and by the root `ErrorBoundary`; each distinct crash is reported once per run and a failing report is logged, never re-reported.

Diff viewer: `state/diffRows.ts` turns a `FileDiff` into flat rows for the Hunk, Inline, and Split modes (split rows pair removed and added lines; change stops drive previous/next), rendered through `VirtualRows`. Syntax highlighting uses `highlight.js` core (`state/syntax.ts`) with 13 languages registered by file extension and loaded lazily as separate chunks; unknown extensions render as plain text. Paired removed and added lines get word-level marks (`state/wordDiff.ts`). Line selection (`state/lineSelection.ts`) maps to the `lines` indexes of `stage_lines`, `unstage_lines`, and `discard_lines`. The Ignore whitespace switch re-requests `diff_file` with `ignoreWhitespace` and disables staging while on; `commit_file_diff` has no whitespace option, so the switch applies to working-tree diffs only. A diff refused with `file_too_large` shows `This diff is <size>, over the 2.0 MiB limit of the diff view. Open it in your editor instead.` in the file view's alert presentation. Confirmation dialogs list at most 8 names; `ConfirmCopy.total` (set from `RevisionRange.count` for the delete-branch, rebase, reset, and force-push copies) is the true number the "and N more" line counts from. Bulk branch, tag, and stash actions confirm once, call the bulk command once, and report items that failed in a notice (`<n> of <total> could not be deleted. <first name>: <reason>`); the branch delete previews run at most 4 at a time.

AI assistance: the provider list and each provider's models are Query keys (`["ai", "providers"]`, `["ai", "models", id]`, `state/aiProviders.ts`); the models query runs only on request. Generate, recompose proposals, and conflict proposals each run as a mutation with a fresh operation id (`state/aiRun.ts`), so Cancel calls `operation_cancel` with that id; failures map to a settings or sign-in action (`state/aiModel.ts`). Results are drafts: Generate fills the composer and keeps the user's text for "Restore my text" (`state/aiGenerate.ts`), a conflict proposal enters Result only on Accept, and an AI grouping replaces the recompose plan only until "Restore my grouping". Sign-in follows `ai-sign-in` events (`state/aiSignIn.ts`). Provider marks come only from `brand/third-party/` through `components/ProviderLogo.tsx` (see `brand/third-party/SOURCE.md`).

History editing: the rebase editor, squash dialog, and recompose view build their plans in `state/rebaseModel.ts` and `state/recomposeModel.ts`, which apply the same validation as the core before calling `rebase_interactive`, `squash_commits`, or `recompose_apply` through a mutation on the session's `QueryClient`, then call `session.refresh`; Undo comes from the recorded activity. Branch-label drag and rebase-row reordering share `state/pointerDrag.ts` (5 px threshold; the body class `dragging` selects the drag cursor).

Tabs and worktrees: `state/tabs.ts` groups repository tabs by `RepoSnapshot.main_root` (`groupTabs`, `tabGroups`); the app reads the main root of every restored tab at boot and of every tab it opens, keeps the list grouped, and closes the tabs of a removed worktree (`closeTabsAt`). The Worktrees panel, its create, integrate, and remove flows (`state/worktreeActions.ts`, rules in `state/worktreeModel.ts`), the sidebar rows, and the state strip chip all call the core's worktree commands through that one owner; a rebase that stops on conflicts opens the worktree's tab. Panels (worktrees, recovery, file view) cover the graph the way the diff does, and the palette opens them through the workspace bridge (`openPanel`).

Recovery: `RecoveryView` reads `reflog_refs`, `reflog_list` (an infinite query over the `before` cursor, pages of 50), `snapshots_list`, and `snapshot_files` through repository-scoped keys (`repoKeys.reflog*`, `repoKeys.snapshots`), so a restore refreshes them. The lost-commit scan runs as a call with a fresh operation id that Cancel passes to `operation_cancel`. Restores go through the session (`restore_as_branch`, `restore_checkout`, `restore_reset`) and end in the activity toast with the core's Undo; `snapshot_restore_*` and `snapshot_delete` are called directly so the safety snapshot's ref can be shown (`state/recoveryModel.ts`, `state/recoveryActions.ts`).

File view: `file_at_revision` is read by `FileView` (key `repoKeys.fileAt`) for the revision the user came from (`:worktree`, `:index`, a commit, a stash, or a stash's untracked commit); `file_too_large` shows the size from its `output`.

Command line: Settings → General calls `cli_install` and shows its `path` and `replaced`; `open-path-requested` opens or activates the tab of the path, and an unopenable path is reported through the app notice, which every screen shows.

Graph paging: Query owns each page (`["repo", path, "graph", page]`, fetched with `fetchQuery`); the graph store keeps the lane layout and requested-page set. An infinite query only extends sequentially, while the virtual scroller and reveal-by-search jump to arbitrary pages, so pages are independent keys.

## Build and run

- Install: `pnpm install` in `app/`.
- Develop: `pnpm tauri dev` in `app/`. It starts Vite at `http://localhost:1420` (`beforeDevCommand`) and runs the shell against it.
- Release build: `pnpm tauri build` in `app/` embeds `app/dist` and produces `target/release/bundle/macos/YForge.app` and `target/release/bundle/dmg/YForge_<version>_<arch>.dmg` (targets `app` and `dmg`; the version comes from `app/package.json` through `tauri.conf.json`; macOS 13.3 or newer). The bundle is unsigned (ad-hoc), so a quarantined copy needs Gatekeeper approval; see [README.md](../README.md#release-build).
- Debug build: `pnpm tauri build --debug --bundles app` in `app/` produces `target/debug/bundle/macos/YForge.app`, which logs every command at `debug` level (see Debug evidence).
- Run the built app: `YFORGE_REPO=<repository path> target/release/bundle/macos/YForge.app/Contents/MacOS/YForge` (use `target/debug/…` for the debug build). At startup the app restores the saved tabs, then adds the launch path (`YFORGE_REPO`, else the first CLI argument, else the current directory) as the active tab when it is a repository; with no tab it shows the launcher. Set `YFORGE_DATA_DIR` to keep settings, recents, and tabs out of the real app-data directory.
- `target/debug/YForge` produced by plain `cargo build` or `cargo test` loads `devUrl`, so it shows a blank window unless `pnpm dev` is running.

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
- `crates/yforge-core/tests/app_ui_prefs.rs` and `app/src-tauri/tests/phase5.rs` (`app_ui_prefs_*`): the application interface preferences, their validation, and the untouched application settings.
- `app/src/components/*.test.tsx`, `app/src/state/app.test.tsx`, `palette.test.ts`, `search.test.ts`, and the other model tests: Launchpad, dialogs, settings forms, palette flows and the menu-to-palette parity check, auth dialogs, toasts with undo, tabs, and shortcuts.
- `app/src/ipc/client.test.ts`: client argument passing, event delivery, and error mapping over `mockIPC`.
- `app/src/state/*.test.ts`, `app/src/graph/*.test.ts`: selection, composer validation and commit flow, diff and confirmation models, refresh coalescing, graph refresh, the branch and stash menus, branch-name validation, the sync menu, freshness, and progress state, the operation banner model, and the checkout, sync, stash, and operation flows over `mockIPC`.
