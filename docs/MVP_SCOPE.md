# YForge MVP Scope (Phase 4)

Status: **approved 2026-09-29** (revision 3: 2026-09-30, platform integrations added per owner decision)

## Goal

Ship a production-quality local Git client that a developer can use all day for the full commit–branch–sync–conflict cycle, with GitKraken-level graph clarity. It needs no account or cloud service, and it treats worktrees as first-class lanes.

## Target users

| Segment | Need | MVP focus |
|---|---|---|
| Professional developers (primary) | Fast, safe daily Git with a visual graph | Graph, staging, sync, conflicts, keyboard parity |
| Developers working on several branches in parallel | Keep parallel work visible and integrate it cleanly | Worktree lanes, one-step integration, terminal handoff |
| Git-intermediate developers | Confidence during rebases, conflicts, and force pushes | State strip, operation banner, named conflict sides, risk tiers |
| Beginners (secondary) | Understand what will happen before it happens | Always-present Changes row, empty states, plain-consequence confirmations |

## Core flows (must be completable in MVP)

These flows are detailed in [USER_FLOWS.md](USER_FLOWS.md):

- **A:** open → inspect → change → stage → commit → push.
- **B:** branch → commits → fetch → rebase → conflict → push.
- **C:** inspect an old commit → compare → branch from it.
- **D:** pull → conflict → resolve → continue.
- **E:** stash → switch → restore.
- **F:** clone a GitHub repo over HTTPS or SSH, using system credentials → work → push.
- **G:** integrate a worktree branch.
- **H:** undo a mistake.

## Candidate evaluation

The decision for each candidate follows its workflow dependency.

| Candidate | Decision | Dependency reasoning |
|---|---|---|
| Repository open / clone / init | **MVP** | Entry points to everything; init includes empty-repo support |
| Commit graph | **MVP** | The primary navigation surface; every other flow selects from it |
| Working directory | **MVP** | Flows A, B, D, E start here |
| Staging (file, hunk, line) | **MVP** | Good commits need partial staging; hunk and line staging share one patch engine |
| Commit (summary, description, amend) | **MVP** | Flow A |
| Branch management | **MVP** | Flows B, C, E |
| Checkout (incl. remote → tracking, detached guard) | **MVP** | Flows B, C, E |
| Fetch / pull / push | **MVP** | Flows A, B, D, F. Includes pull modes, first-push upstream, force-with-lease |
| Diff viewer | **MVP** | Review before staging or commit; conflict context |
| Merge | **MVP** | Flow D and branch integration |
| Merge conflict handling | **MVP** | Flows B and D cannot finish without it; covers merge, rebase, cherry-pick, and revert states |
| Stash | **MVP** | Flow E; also the safety net for auto-stash during pull and checkout |
| Tags | **MVP** | Releases, and tags must be readable on the graph. Create, push, and delete only |
| Git identity | **MVP** | A commit cannot be made without one; global + per-repository |
| SSH authentication | **MVP** | Flow F over SSH: use ssh-agent and `~/.ssh` keys, passphrase prompt, host-key confirmation |
| GitHub authentication | **Post-MVP (OAuth)**; MVP uses system credential helpers | Clone, pull, and push over HTTPS work through Git's credential helper plus a YForge credential prompt. OAuth is needed only for repo discovery and PRs |
| Settings | **MVP (core subset)** | Identity, default branch, pull mode, auto-fetch, SSH, theme, density, editor/terminal |
| Light / dark theme | **MVP** | Light, Dark, and System; both themes are designed and checked for contrast |

## Must-have (MVP)

1. **Launcher**
   - Open, Clone (URL + destination), Create (local init with default branch).
   - Drop a folder to open it; `yforge <path>`.
   - Recent repositories with status chips.
   - Empty-repository support.
2. **Repository tabs**
   - Tab restore.
   - Worktrees grouped under their repository.
3. **Command bar and state strip**
   - Every segment from [INFORMATION_ARCHITECTURE.md §3](INFORMATION_ARCHITECTURE.md#3-state-strip-answering-the-seven-questions).
   - An operation banner with Continue, Skip, and Abort.
4. **Commit graph**
   - A GitKraken-parity graph (app/DESIGN.md S13): virtualized full history, lanes, node shapes, and ref labels.
   - A Branch / Tag column with a `+N` popover.
   - The checked-out label in the graph and the HEAD junction in the state strip.
   - An always-present working-tree row.
   - Stash rows, including `-u` stashes.
   - Configurable columns.
   - Branch-hover highlight.
   - Multi-select.
   - Branch visibility: All / Current + upstream.
   - Reveal HEAD.
5. **Search:** message, SHA, author; dims non-matches, with N of M navigation.
6. **Changes inspector**
   - Unstaged, staged, untracked, and conflicted files, with status letters.
   - Stage, unstage, and discard at file, hunk, and line level.
   - Stage all.
   - Commit composer with a 72-character guide, amend (with a pushed warning), and split Commit / Commit & Push.
   - Hook output surfaced on failure.
7. **Diff viewer**
   - Hunk, inline, and split modes.
   - Syntax and word highlighting.
   - Labeled whitespace toggle.
   - Change navigation.
   - File view.
   - Binary placeholder.
   - "Open in editor".
8. **Branches:** create inline or at any commit; checkout, with stash-and-switch when there are changes; rename; delete local, remote, or both; set upstream; bulk folder view.
9. **Integrate**
   - Merge (fast-forward or merge commit) and rebase (non-interactive), each via drag-drop with a result preview, a context menu, or the palette.
   - Single cherry-pick, revert, and reset (soft, mixed, or hard, with consequences stated).
10. **Remotes**
    - Fetch, Fetch All, and auto-fetch with a set interval.
    - Pull modes: fast-forward only, fast-forward with merge if needed, rebase.
    - Push with upstream creation.
    - Force-with-lease after a rewrite, with a preview of the remote commits it will overwrite.
    - Add, edit, and remove remotes; prune.
11. **Conflicts:** a resolver with Current and Incoming panes named by branch and role, and a Result pane.
    - Take a hunk from Current, Incoming, or both, in order.
    - Manual edit.
    - Next and previous conflict.
    - Reset file.
    - Mark resolved.
    - Continue, Skip, or Abort for merge, rebase, cherry-pick, and revert.
    - Take-all per file.
12. **Stash:** create with a message (optionally including untracked files); apply, pop, drop, rename; inspect. Auto-stash for pull and checkout, always restored.
13. **Tags:** create lightweight or annotated; push; delete locally or from the remote; detached-checkout guard.
14. **Undo:** whole-operation undo of the last local operation, using the reflog and a working-tree snapshot for discards.
15. **Activity drawer:** every operation with its Git command, duration, and output, including hooks; copy the output.
16. **Command palette:** every action with argument pickers; navigation to a branch, commit, or repository; settings.
17. **Keyboard model:** J/K navigation, S/U staging, ⌘↵ commit, ⌘K palette, ⌘F search; shortcuts shown in menus.
18. **Authentication**
    - The system Git credential helper, plus a YForge prompt for HTTPS.
    - ssh-agent and key selection.
    - Passphrase and host-key dialogs.
    - Auth-error state with next actions.
19. **Settings (core):** identity, default branch, pull mode, auto-fetch, SSH, theme (Light / Dark / System), density (compact / default), and external editor and terminal.
20. **Worktrees**
    - Worktree lanes (create, open, remove), plus "Integrate worktree" (rebase onto the target, then `merge --ff-only`, then optional removal).
    - "Open in terminal" for any repository or worktree.
21. **History editing** (owner decision, 2026-09-30)
    - Amend, including editing the HEAD message.
    - Interactive rebase: reorder, reword, squash, fixup, drop, and stop to edit, with a preview of the resulting history.
    - Squash a multi-selected range of commits into one.
    - Recompose: regroup the changes of unpushed commits into a new set of commits, manually or from an AI proposal.
    - Every rewrite is undoable to the recorded HEAD and warns before rewriting pushed commits.
22. **AI assistance (optional)** (owner decision, 2026-09-30)
    - Generate commit: draft a commit message from the staged changes into the composer.
    - Recompose: propose a regrouping of unpushed commits into new commits, shown as a plan to review and edit before applying.
    - Conflict fix: propose a resolution for each conflict region in the resolver, using both sides and the base; each proposal lands in the Result pane for the user to accept, edit, or reject, and marking the file resolved stays a manual step.
    - Opt-in and never required: every Git workflow works without a provider. Output is a draft the user reviews; nothing is committed or rewritten automatically.
    - Content leaves the machine only when the user runs an AI action, and only to the provider the user chose.
    - Providers, added from a provider dialog of icon cards:
      - ChatGPT subscription, through the installed Codex CLI and its own sign-in (`codex login` in a browser, or `codex login --device-auth` headless);
      - Claude Code, through the installed `claude` CLI and its signed-in profile;
      - OpenRouter, with an API key;
      - OpenAI-compatible APIs, any number of custom endpoints, each with a base URL and an optional API key.
    - YForge never reads, refreshes, or stores subscription tokens. API keys live in the macOS Keychain, never in YForge's database.
23. **Recovery** (owner decision, 2026-09-30)
    - Reflog browser for HEAD and every branch: each entry shows the action, the commit, and when; any entry can be restored as a new branch, a detached checkout, or a reset of the current branch, each undoable.
    - Lost-commit finder: commits no ref reaches (dropped stashes, deleted branches, rewritten history) found with `git fsck`, shown with their summary and date, restorable the same way.
    - Safety snapshots: before any destructive YForge action (discard, hard reset, checkout that overwrites, interactive rebase, squash, recompose, stash drop, branch delete), YForge records HEAD, the index, and the working tree including untracked files as a snapshot under `refs/yforge/snapshots/*`, kept 30 days; any snapshot can be restored or its files copied back.
    - Limits stated in the UI: work changed outside YForge and never committed, and objects Git has already pruned, cannot be recovered. Snapshot refs appear in `git log --all` in other tools and are pushed only by `git push --mirror`.
24. **Platform integrations** (owner decision, 2026-09-30; see [PLATFORM_INTEGRATIONS.md](PLATFORM_INTEGRATIONS.md))
    - GitHub (cloud + Enterprise Server), GitLab (cloud + self-hosted), Bitbucket (Cloud + Data Center).
    - Connections added in Settings: kind, host, name, personal access token (macOS Keychain, never in the database), optional insecure-TLS flag for self-signed private servers.
    - A repository matches a connection through its remotes; HTTPS and SSH remote URL forms are both recognized.
    - Pull requests / merge requests: list, detail (files with change counts), create from a local branch, merge (then fetch).
    - Auth errors surface a clear "Authentication failed for <host>" with an edit-connection action.
    - OAuth device flow, repo discovery, and CI checks remain post-MVP.

## Post-MVP

- Multi-select drop outside interactive rebase.
- Multi-commit cherry-pick.
- GitHub:
  - OAuth device flow;
  - repository discovery for clone;
  - CI checks.
- File history, blame, and compare (commit vs working tree, commit vs commit).
- Image diff.
- External diff and merge tools.
- Partial stash, restore a file from a commit, ignore rules.
- Commit signing (GPG/SSH) with badges; multiple identities or profiles.
- Submodules; Git LFS.
- Hide, solo, and smart branch visibility; ghost branch on hover; date separators.
- Activity timeline with restore points (multi-step undo).
- Customizable shortcuts; high-contrast themes.

## Later

- Azure DevOps adapter; issue trackers; branch from an issue.
- Local multi-repository workspaces with bulk fetch and pull.
- In-app file editor; in-app terminal; patches; Gitflow; sparse checkout; encodings; worktree lock.

## Explicitly out of scope

- Any account, sign-in, license server, telemetry by default, or marketing notification.
- GitKraken-style cloud services:
  - Launchpad;
  - Cloud Workspaces;
  - Cloud Patches;
  - Code Suggest;
  - Team View;
  - Conflict Prevention;
  - Insights.
- AI features beyond item 22 (explain, unattended auto-resolve). Any addition follows item 22: opt-in, never required, and never auto-applied.
- Coding-agent tooling (launching or monitoring agents).
- Mobile or web clients.

## Technical and UX risks

| Risk | Impact | Mitigation |
|---|---|---|
| Graph performance on 100k+ commit histories | Scroll jank; slow first paint | Incremental topological layout in the core; virtualized rows; layout cache per repo; benchmark gates |
| An accessible canvas-drawn graph | Screen-reader users are blocked | Render rows as a DOM list with text alternatives; draw only the lane art on canvas |
| Correct Git state detection (merge, rebase, cherry-pick, revert, bisect, sequencer, detached HEAD, unborn branch) | Wrong banners and wrong actions | Detection is driven by `.git` state files plus porcelain v2, with fixture repos for every state |
| Credential prompts (askpass, SSH passphrase, host keys) | Hung operations | `GIT_ASKPASS` and `SSH_ASKPASS` bridges with timeouts and cancel |
| Partial staging correctness (hunk and line) | Corrupted index | Build patches with `git apply --cached --check` before applying; property tests |
| Undo semantics | False promises | Undo only operations with a verified restore path, and state the scope in the tooltip |
| Webview engine differences (WKWebView, WebView2, WebKitGTK) | Rendering or input bugs on one platform | Render checks per engine; avoid engine-specific CSS; macOS first |
| Core–UI throughput for large graphs | Slow graph paging between the Rust core and the SolidJS UI | Page graph rows in the core; send compact lane data; virtualize rendering |
| File-watcher storms (large repos, `node_modules`) | CPU spikes | Respect `.gitignore`; debounce; use FSEvents on macOS |
| Stitch output size (DESKTOP ≈ 1512×1104) vs the 1440×900 target | Mockups mislead | Verify exported HTML at 1440×900 and 1280×720 in a browser (see [STITCH_DESIGN_PLAN.md](STITCH_DESIGN_PLAN.md)) |

## Success criteria

| Area | Criterion |
|---|---|
| Workflow | Flows A–H complete without the terminal. The major interaction counts are at or below the YForge targets in [USER_FLOWS.md](USER_FLOWS.md) |
| Orientation | In moderated tests, 9/10 participants correctly state HEAD, branch, ahead/behind, change count, and the operation in progress from one screenshot |
| Safety | No data loss in fixture-based tests of discard, reset, rebase, force push, and stash, including an undo-path test for each |
| Performance | Graph first paint under 1s for 10k commits and under 3s for 100k commits, on reference hardware; scrolling at 60 fps |
| Accessibility | WCAG 2.2 AA contrast in both themes; every action keyboard-reachable; a complete screen-reader pass of graph rows |
| Correctness | Git state detection passes a fixture suite covering every operation state listed in the risks table |
| Worktrees | "Integrate worktree" yields linear history (rebase, then `merge --ff-only`) identical to the terminal sequence, verified on fixture repositories |
