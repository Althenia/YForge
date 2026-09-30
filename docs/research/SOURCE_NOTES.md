# Source notes: official GitKraken documentation

These notes condense the official GitKraken documentation research behind [../PRODUCT_ANALYSIS.md](../PRODUCT_ANALYSIS.md) and [../GITKRAKEN_FEATURE_MAP.md](../GITKRAKEN_FEATURE_MAP.md). Hands-on observations are in [GITKRAKEN_HANDS_ON_LOG.md](GITKRAKEN_HANDS_ON_LOG.md).

**Source keys:**

| Key | Source |
|---|---|
| H | `https://help.gitkraken.com/gitkraken-desktop/<page>/` |
| R | `raw.githubusercontent.com/gitkraken/gitkraken-desktop-docs/main/gitkraken-desktop/<page>.md` |
| P | `https://www.gitkraken.com/pricing` |
| CUR | R `current.md` (12.5.0 released 2026-09-15) |

## Layout (H interface, May 2026)
- Toolbar top, Left Panel, Commit Graph, Commit Panel (right), status bar (Launchpad summary, plan, zoom 100–200%).
- WIP node top of graph. Ghost branch: hover/select commit shows nearest containing branch; double-click checks it out.
- Hover branch highlights its commits (toggle in UI Customization).
- Columns: Branch/Tag, Graph, Commit Message default; add Author, Date/Time, Sha via header right-click or gear; per-repo widths/order; author filter icon.
- Toolbar: Undo, Redo, Pull (dropdown), Push, Branch, Stash, Pop; LFS button only if LFS; Sparse button if sparse checkout.
- Left panel sections: Local, Remote, Pull Requests, Issues, Teams, Tags, Stashes, Submodules, Worktrees, Cloud Patches; show/hide via header right-click; double-click header maximizes; List|Agents toggle (Agent Sessions view).
- Hide (gray icon) / Solo (orange icon) branches, tags, remotes, stashes; section-level hide/show all. Pin to left. Smart Branch Visibility (graph header gear): only checked-out branch, target, upstreams.
- Search: message, SHA, author only; ⌘F; initial 2000 commits (pref min 500; Show All; Lazy Load).
- Multi-select Shift/⌘ → combined diff for range. Per-worktree WIP nodes (12.3.0).
- Tabs: +/⌘T, ⌘W, ⌘1–9, drag reorder, alias, per-profile persistence, worktree tab grouping (12.4.1).

## Working dir / commit (H staging, H commits)
- Stage per file (hover), Stage all; line/hunk: select lines in diff → right-click "Stage selected lines"; unstage same way.
- Discard file/all/hunk/line; documented permanent (but Undo covers Discard per H undo-and-redo).
- Ignore → root .gitignore only (file/extension/dir); "Ignore and Stop Tracking".
- Commit panel: Unstaged, Staged, message Summary + Description; ⌘Enter commit; ⌘⇧Enter stage all+commit; ⌘⇧M focus message.
- Amend checkbox; message-only amend via selecting last commit; warns force push needed if pushed.
- Skip Git hooks checkbox; Co-authored-by trailers; commit template (.git/gkcommittemplate.txt); "Restore file from this commit".
- Commit & push option. AI commit message (paid) sparkle button.

## Diff (H diff)
- Entry: click WIP file / commit file; shift-click two commits; ⌘-click WIP + commit; "Compare commit against working directory".
- Hunk / Inline / Split views; word diff; syntax highlight; minimap; word wrap; change navigation arrows; per-hunk Revert in hunk view.
- Whitespace: ignore leading/trailing whitespace (12.0.0 notes); disabled for UTF-16 (12.3.0).
- External diff tools: Beyond Compare, FileMerge, Kaleidoscope, KDiff, Araxis, P4Merge.
- File history + blame (buttons top-right of diff; File View shows full file with blame colors).
- Patches: create from commit/file changes; apply patch; no binary.
- In-app editor: Edit file, save ⌘S, blue dot unsaved, "Save and stage", markdown preview, encoding dropdown (no conversion).

## Branches (H branching-and-merging, interactive-rebase, cherrypick)
- Create: right-click commit "Create branch here", toolbar Branch (HEAD), palette. Checkout: double-click label / left panel; palette.
- Rename: context menu / palette. Delete: must checkout another first; multi-select delete with confirmation.
- Merge: drag branch onto branch → menu (merge, rebase, fast-forward, interactive rebase, create PR, reset); or right-click.
- Squash merge preference: stages result, no commit.
- Rebase: drag; range "Rebase N commits onto"; "Rebase onto this commit" (12.2.0).
- Interactive rebase: drag menu / right-click target / parent commit; actions Pick, Reword, Squash, Drop; keys P/S/R/D; Reset; constraints (common ancestor, no merges, no initial commit, finish in-app).
- Cherry-pick: context menu single; multi-select → interactive tool (reorder, squash, reword, drop).
- Push via drag onto remote branch. Reset via drag or context (soft/mixed/hard). Revert commit.
- Worktree-checked-out branch: remove worktree options instead of delete (12.4.0).

## Remotes (R pushing-and-pulling)
- Fetch All in Pull dropdown (⌘L). Auto-fetch every 1 min default; pref 0–60; Auto-Prune pref.
- Silent fetch failure → warning icon on REMOTES header (10.6.0).
- Ahead/behind on left panel branches after fetch; worktree cards.
- Pull modes: FF if possible (else merge), FF only, Rebase; default chosen by clicking the circle (dot marks default).
- Push: toolbar or right-click; no upstream → prompt to name/create remote branch.
- Force push: offered when FF fails; danger-styled dialog Force Push/Cancel; "Don't ask again" (10.5.0). With-lease: undocumented.
- Add remote: Remote header "+" → URL or provider dropdown (forks). Remove remote undoable.
- Auth: Forget All Credentials; integration error codes → reconnect.

## Conflicts
- Conflicted files in Commit Panel; click → Merge Tool: current left, target right, output bottom; checkboxes/+ per line; arrow keys between conflicts; save output then commit.
- Right-click file: Take current / Take incoming. External merge tool. AI "Auto-resolve with AI" (paid; confidence per conflict).
- Undocumented: conflict banner details, abort/continue wording (verify hands-on).

## Stash / tags / worktrees / submodules / LFS / Gitflow / hooks
- Stash: toolbar Stash; name via // WIP field or Stash tab; right-click Apply/Pop/Delete/Hide/Edit message; toolbar Pop = newest; partial stash via "Stash file".
- Tags: Create tag here (lightweight) / annotated; Push tag; Delete local/remote with confirm; no rename; check out tag commit (11.6.0).
- Worktrees (10.5.0+): section +, "Create worktree" on branch menu, open in tab, remove / remove + delete branch, lock/unlock.
- Submodules: section, + add, update/init, status states. LFS: init, track, toolbar LFS menu (pull/prune). Gitflow: init, start/finish.
- Hooks: non-zero exit blocks; output in Activity Log; error snackbox links to it.

## Notifications / logs
- Toasts top-right (error red), "snackbox"; notification location pref; desktop notifications.
- Activity Log (footer icon): Application / Repository tabs, timestamp + duration. Error Logs file.
- Detached HEAD banner above commit panel.

## Palette & shortcuts (H command-palette, keyboard-shortcuts)
- ⌘P palette (wand/Actions icon; Help menu). Categories: Repo, Settings (Gitflow, LFS, GPG, theme "Join the Light/Dark side", profiles), View, History (Blame/History + file, Search commits), Core (Undo/Redo), File (create/delete/open/edit, stage/unstage/discard all), Stash, Branch (create branch/tag, fetch/pull/push, rename, start PR), Checkout + branch, Patch, Logs.
- Shortcuts: ⌘/ list; ⌘B branch; ⌘L fetch all; S/U stage/unstage file; ⌘⇧S/⌘⇧U all; ⌘Enter commit; ⌘⇧Enter stage all+commit; ⌘⇧M message; J/K/H/L or arrows navigate; ⇧↑/↓ in branch; ⌘↑/↓ first/last; ⌘Z undo; ⌘Y/⌘⇧Z redo; ⌘P palette; ⌘F search; ⌘⇧O open repo; ⌘⇧H history/blame file; ⌘⌥F left filter; ⌥T terminal; ⌘D diff/merge tool; ⌘W close; ⌘J left panel; ⌘K commit detail; ⌘T new tab; ⌘1–9 tabs; zoom ⌘=/⌘−/⌘0. No customization documented.
- Undo: last action only; checkout, commit, discard, delete branch, remove remote, reset, rebase ops (interactive rebase, multi cherry-pick, drop, reword, AI recompose). Tooltip names the action.

## Preferences (H preferences)
- Organization (Pro+), General (auto-fetch, auto-prune, conflict detection, submodules, default branch main, delete .orig, show all commits, initial commits, lazy load, remember tabs, extended logging, forget credentials, share WIP), Profiles (paid for multiple; author name/email; .gitconfig sync; avatars), SSH (generate/browse key, use local agent), Integrations (per profile; 12.3.0 browser sign-in via gitkraken.dev), GitKraken AI (Pro+, BYOK), External Tools (merge/diff tool, editor, terminal, coding agent CLIs auto-detected: Claude Code, Codex, Copilot, Gemini, OpenCode, Cursor 12.5.0), Notifications, UI Customization (theme + system sync, notification location, date locale, initials vs avatars, graph metadata, hide Launchpad, Agents view, toolbar labels, hover highlight, repo-group colors, worktree tab grouping), Commit Signing (GPG; SSH signing via Git executable; sign commits/tags by default), Editor, In-App Terminal, Experimental (Git executable), Agents (12.0.0).
- Repo-specific: Encoding, Gitflow, Git Hooks path, LFS, Commit (template, squash behavior), Issues, Team View, Submodules, Sparse Checkout, Agent setup commands.

## Integrations & services (A report; categories)
- Hosting: GitHub (OAuth/token; Community public only), GHES (PAT; Advanced+), GitLab (OAuth), GitLab SM (PAT; Pro+/Advanced conflict), Bitbucket (OAuth), Bitbucket DC (PAT; Advanced+), Azure DevOps (OAuth/PAT; Pro+). SSH key generate+upload one-click for GitHub/GHES/GitLab/SM.
- PR list (left panel, filters, CI/review icons), GitHub PR detail (edit title/desc/reviewers/assignees/milestones/labels, comments, build status), create PR (drag branch onto branch; templates; draft), checkout PR, merge in-app (GitHub), approve via gitkraken.dev, indicators in graph.
- Issues: GitHub/GitLab issues, Jira, Trello (view/edit/branch from issue). CI status opens browser.
- GitKraken services: account (browser sign-in 12.3.0), Launchpad (Pro+), Cloud Workspaces, Cloud Patches, Code Suggest, GitKraken AI (paid; Gemini default; BYOK), gk CLI, orgs/teams, Team View (Advanced+), Conflict Prevention (Pro/Advanced), Insights, browser extension, GitLens, On-prem.
- Core-ish: Profiles; Agent Sessions (worktree + agent CLI launch; live status for Claude Code, OpenCode, Codex, Copilot CLI, Cursor 12.5.0).
- Plans (P): Community free = local repos + public remotes; many features "Public Repos Only" (merge tool, editor, gitflow/LFS/worktrees, history/blame, PRs, hide/solo, interactive rebase, undo, agent sessions); Pro+ for private remotes, conflict output editor, multiple profiles; Advanced+ conflict prevention. Fetch/push/pull/stash/tags plan "all".

