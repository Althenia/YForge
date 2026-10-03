# YForge Screen Inventory (Phase 5)

Status: **approved 2026-09-29** (revision 2: standalone scope). Each entry lists Purpose, Primary and Secondary actions, Information shown, Entry and Exit points, Empty, Loading, and Error states, Destructive actions, and Keyboard.

Structure follows [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md), and priorities follow [MVP_SCOPE.md](MVP_SCOPE.md). "—" means not applicable.

## Windows and main views

### S01 · Launchpad (landing; S41, S46)
- **Purpose:** Start or resume work on a repository, and see pull requests, issues, and unfinished work. It replaced the launcher on 2026-10-03.
- **Primary actions:**
  - Open…, Clone…, Create… in the header; drop a folder to open it.
  - Open a repository from the Repositories table (Enter or Open in the bar under the table).
  - Add folder… to scan for repositories.
- **Secondary actions:**
  - Search and sort repositories; Rescan or Stop scanning a folder.
  - Reveal in Finder, Open in Terminal, Remove from list (with Undo).
- **Information displayed:** for each repository: name, path, branch, status in words (changes, to push, to pull, Clean, Not found, Status unavailable), and when it was last opened; each scanned folder's repository count, depth, and scan time; the S41 lists with counts and per-source update times.

### S02 · Repository workspace: graph (MVP)
- **Purpose:** Understand and act on history and the current state.
- **Primary actions:**
  - Select a commit or ref.
  - Checkout.
  - Sync.
  - Branch.
  - Stash.
  - Drag a ref onto a ref.
- **Secondary actions:**
  - Column visibility.
  - Branch visibility (All / Current + upstream).
  - Reveal HEAD.
  - `+N` ref popover.
  - Copy SHA.
- **Information displayed:**
  - Tabs, command bar, state strip.
  - Sidebar sections with counts.
  - Graph rows:
    - working-tree row;
    - stash rows;
    - refs (chips with local/remote glyphs);
    - lanes;
    - node kinds;
    - message;
    - author initials;
    - relative age;
    - short SHA (optional).
  - Inspector and Activity bar.
- **Entry points:** Open or clone a repository; switch tab.
- **Exit points:** Center views (diff, resolver); Settings; close tab.
- **Empty state:** Unborn branch → S26.
- **Loading state:**
  - The first paint shows the state strip and a skeleton lane area with fixed row height.
  - The graph streams in newest-first.
  - Selection is kept during refresh.
- **Error state:** Not a Git repository, or a corrupt object → a blocking panel with the Git error, "Show details", and "Close tab".
- **Destructive actions:** None directly; they are routed through menus and dialogs.
- **Keyboard:**
  - J/K or ↑↓ rows · ⇧J/⇧K within branch · Home/End.
  - Enter: primary action (commit → inspector focus; ref → checkout confirm).
  - H: reveal HEAD · ⌘F search · ⌘K palette · F6 region cycle · Space: toggle multi-select.

### S03 · Changes inspector + commit composer (MVP)
- **Purpose:** Stage precisely and commit well.
- **Primary actions:**
  - Stage or unstage a file.
  - Stage all.
  - Commit, or Commit & Push (split button).
- **Secondary actions:**
  - Discard a file or all changes.
  - Stash all or selected changes.
  - Amend.
  - Path/Tree toggle, sort.
  - Open in editor.
  - Show in Finder.
- **Information displayed:**
  - Sections: Conflicted, Unstaged, Untracked, Staged, each with a count.
  - Status letters: M, A, D, R, U, !, T.
  - Summary field with a 72-character guide; description.
  - Author identity; the target branch; the upstream after pushing.
- **Entry points:** Working-tree row; sidebar Changes; state-strip Changes segment; ⌘1 (proposal).
- **Exit points:** Select anything else; commit completes and returns to the graph with the new commit selected.
- **Empty state:** "Working tree clean. Nothing to commit on feature/greeting." Offers "Create branch…" and "Sync".
- **Loading state:** The status refresh keeps the current lists visible, with a busy indicator in the section header.
- **Error state:** Hook failure → an inline error under the composer ("pre-commit exited 1") with the hook output excerpt, "Show full output", and Retry. Identity missing → an inline "Set your name and email" form.
- **Destructive actions:**
  - Discard file, hunk, or line: undoable via snapshot, with no dialog.
  - Discard all: one confirmation listing the file count; undoable.
- **Keyboard:** S stage · U unstage · ⌫ discard (confirm) · ⌘⇧A stage all · ⌘↵ commit · ⌘⇧↵ commit & push · Tab into the message.

### S04 · Commit inspector (MVP)
- **Purpose:** Understand a commit.
- **Primary actions:**
  - Open a file diff.
  - Copy SHA.
  - Create branch here.
  - Checkout (detached, guarded).
- **Secondary actions:**
  - Cherry-pick.
  - Revert.
  - Reset current branch here ▸.
  - Tag here.
  - Open parents.
- **Information displayed:**
  - Summary and body (rendered with line breaks).
  - SHA (mono, copyable).
  - Author and committer, with absolute and relative dates.
  - Parents (links).
  - Refs at the commit.
  - Changed files with status letters and +/− counts.
  - Signature badge (Post-MVP).
- **Entry points:** Select a commit row; search result; parent link.
- **Exit points:** Select another object; file → S07.
- **Empty state:** A commit with no file changes (for example, a merge with an empty diff) → "No file changes in this commit".
- **Loading state:** Header renders immediately; the file list shows a reserved-height placeholder.
- **Error state:** Object missing (shallow clone) → "Commit not available in this shallow clone", with "Fetch more history".
- **Destructive actions:** Reset (via S14), revert (creates a commit; undoable).
- **Keyboard:** C copy SHA · B branch here · Enter open first file · ↑↓ files.

### S05 · Multiple-commit inspector (MVP)
- **Purpose:** Act on a selection of commits.
- **Primary actions:** Cherry-pick N (single in MVP; multi Post-MVP); compare the endpoints; squash or drop N (Post-MVP).
- **Secondary actions:** Copy SHAs; create a branch at the newest.
- **Information displayed:** Count, range endpoints, authors, date span, combined file list (Post-MVP).
- **Entry points:** ⇧/⌘-click; Space on rows.
- **Exit points:** Clear the selection (Esc).
- **Empty state:** —
- **Loading state:** Combined file list placeholder.
- **Error state:** Non-contiguous or merge-containing selection. Squash and Drop stay visible but disabled, with the reason stated.
- **Destructive actions:** Drop N (Post-MVP; undoable).
- **Keyboard:** Esc clear · ⌘C copy SHAs.

### S06 · Ref inspector: branch · remote branch · tag · stash · worktree (MVP)
- **Purpose:** Details and actions for a ref.
- **Primary actions (by ref type):**
  - Branch: checkout, merge into current, rebase current onto, push/pull.
  - Tag: push, delete.
  - Stash: apply, pop.
  - Worktree: open, integrate.
- **Secondary actions:**
  - Rename, set upstream, create worktree, copy name.
  - Stash: rename, view diff.
- **Information displayed:**
  - Branch: tip commit, upstream, ahead/behind, last commit age, worktree (if checked out elsewhere).
  - Tag: type, message, tagger.
  - Stash: message, base commit, file list (including untracked).
  - Worktree: path, branch, target, ahead/behind.
- **Entry points:** Click a chip or sidebar row.
- **Exit points:** Select another object.
- **Empty state:** Branch without an upstream → "Not published. Push to origin to create origin/<name>", with Push.
- **Loading state:** Ahead/behind shows "…" until computed.
- **Error state:** Upstream gone → "origin/<name> was deleted on the remote", with "Unset upstream" and "Push".
- **Destructive actions:** Delete a branch (local, remote, or both), a tag, or a stash; remove a worktree. See S13 for confirmation rules.
- **Keyboard:** Enter primary · ⌫ delete (confirm) · R rename.

### S07 · Diff view (MVP)
- **Purpose:** Read changes and stage precisely.
- **Primary actions:**
  - Stage, unstage, or discard a hunk.
  - Select lines, then stage or discard them.
  - Switch mode: hunk, inline, or split.
- **Secondary actions:**
  - Whitespace toggle ("Ignore whitespace", labeled).
  - Word wrap.
  - File view.
  - Next or previous change.
  - Open in editor.
  - Copy path.
- **Information displayed:**
  - Breadcrumb (Graph › source › path) with the rename source.
  - Status letter; encoding; mode (working tree / staged / commit / stash).
  - Hunk headers; old and new line numbers; ± gutters; word-level highlight; syntax highlighting.
- **Entry points:** File in S03, S04, S05, or S06.
- **Exit points:** Esc or breadcrumb back to the graph, with selection and scroll restored.
- **Empty state:** No textual change (mode or permission change) → "File mode changed 100644 → 100755".
- **Loading state:** Large diffs stream in, with "Showing first 5,000 lines" and "Load all".
- **Error state:**
  - Binary → placeholder with size and type, plus "Open with default app" (image diff Post-MVP).
  - File too large → a message with "Open externally".
- **Destructive actions:** Discard a hunk or lines (undoable).
- **Keyboard:** N/P next/previous change · S/U hunk · ⌫ discard hunk · Esc back · 1/2/3 view modes.

### S08 · Operation in progress: conflict state (MVP)
- **Purpose:** Always know what Git is doing and how to finish it.
- **Primary actions:** Resolve next conflict; Continue; Abort.
- **Secondary actions:** Skip (rebase or cherry-pick step); show the Git output.
- **Information displayed:**
  - **State strip banner:** operation, source → target, step "k of n", conflict count.
  - **Inspector:** operation header; Conflicted and Resolved lists; the pending commit message (editable).
  - **Graph:** the working-tree row shows "Conflicts: N" with a conflict glyph.
- **Entry points:** Automatic when Git enters a conflicted state, from YForge or from the terminal.
- **Exit points:** Operation completes → success toast with Undo; Abort → restores the pre-operation state, and the auto-stash is re-applied.
- **Empty state:** In-progress with no conflicts (for example, a paused rebase for edit) → "Rebase paused at step 2 of 5", with Continue.
- **Loading state:** Continue in progress → buttons disabled, with a "Continuing…" label.
- **Error state:** Continue fails (a hook, or a new conflict) → the reason inline, and the lists refresh.
- **Destructive actions:** Abort (discards the resolution work so far; one confirmation when some files are already resolved).
- **Keyboard:** ⌘↵ Continue · ⌘. Abort (confirm) · ⌘⇧N next conflict (proposal).

### S09 · Conflict resolver (MVP)
- **Purpose:** Resolve a conflicted file without external tools.
- **Primary actions:**
  - Take Current, Incoming, or Both (in order) per conflict block.
  - Edit the Result directly.
  - Mark resolved.
- **Secondary actions:**
  - Take all from one side (file).
  - Reset file.
  - Show base (3-way).
  - Open in external tool (Post-MVP).
- **Information displayed:**
  - **Header:** path, "k of n conflicts", operation context.
  - **Panes:**
    - Current: `<branch>` with its role;
    - Incoming: `<branch>` with its role;
    - Result, with source markers C/I per line.
  - Unresolved regions are marked with a glyph as well as color.
- **Entry points:** Conflicted file in S08; the state-strip "Resolve".
- **Exit points:** Mark resolved → the next conflicted file, or back to S08 when none remain.
- **Empty state:** —
- **Loading state:** Placeholder panes at final size.
- **Error state:** Binary or submodule conflict → choose Current or Incoming for the whole file, with an explanation.
- **Destructive actions:** Reset file (undoable until marked resolved).
- **Keyboard:** J/K next/previous conflict · 1 Current · 2 Incoming · 3 Both · E edit Result · ⌘S mark resolved.

### S10 · Sync: fetch / pull / push states (MVP)
- **Purpose:** Keep branches in step with remotes.
- **Primary actions:** The Sync primary action is context-aware: Fetch, or Pull when behind, or Push when ahead.
- **Secondary actions:**
  - Sync ▾: Fetch all; Pull (fast-forward only); Pull (fast-forward, merge if needed); Pull (rebase); Push; Push to…; Set upstream…
- **Information displayed:**
  - Last fetch time; ahead/behind per upstream.
  - Progress: phase and remote.
  - Result: commits received or sent.
- **Entry points:** Command bar; branch menu; state strip; palette.
- **Exit points:** Toast with the result; state strip updates.
- **Empty state:** No remotes → "No remotes configured", with "Add remote…".
- **Loading state:** The state strip shows "Fetching origin…" with cancel; toolbar controls stay in place, disabled.
- **Error state:**
  - Rejected (non-fast-forward) → a dialog explaining divergence, with "Pull (rebase)", "Pull (merge)", and "Cancel". If a local rewrite is detected, show S11 instead.
  - Auth → S19.
  - Offline → S28.
- **Destructive actions:** Push after a rewrite → S11.
- **Keyboard:** ⌘⇧F fetch · ⌘⇧L pull · ⌘⇧P push (proposals).

### S11 · Force push with lease (MVP)
- **Purpose:** Publish rewritten history without silently destroying remote work.
- **Primary actions:** "Force push with lease".
- **Secondary actions:** Cancel; "Pull and rebase instead"; copy the command.
- **Information displayed:**
  - Why it's needed ("You rebased feature/greeting; its history no longer contains origin/feature/greeting").
  - The remote commits that will be replaced (list with SHA and message).
  - The lease target SHA.
  - Protected-branch warning when the target is `main` or a configured protected pattern.
- **Entry points:** Push after a rebase, amend, reset, or drop.
- **Exit points:** Success toast with "View remote change"; lease failure → "Remote changed since your last fetch. Fetch and review", with Fetch.
- **Empty state:** —
- **Loading state:** Button shows "Pushing…".
- **Error state:** Lease rejected; hook rejected.
- **Destructive actions:** This dialog is the destructive action. There is no "Don't ask again".
- **Keyboard:** Esc cancel · ⌘↵ confirm. The confirm button is not focused by default.

## Popovers, menus, and dialogs

### S12 · Context menus and drop menu (MVP)
- **Purpose:** Direct manipulation on objects.
- **Primary actions:** Per object, in a fixed group order:
  1. Navigate.
  2. Integrate.
  3. Create.
  4. Rewrite ⚠.
  5. Delete ⚠.
  6. Copy.
  7. View.

  The drop menu lists ref A → ref B options only, each with a result preview ("fast-forward main by 3 commits").
- **Secondary actions:** Submenus (Reset ▸ Soft · Mixed · Hard).
- **Information displayed:** Item labels name the source and target; shortcut hints; disabled items with reasons.
- **Entry points:** Right-click; the ⋯ button on rows (keyboard: ⇧F10 or the menu key); drag-drop.
- **Exit points:** An action, a dialog, or Esc.
- **Empty state:** —
- **Loading state:** —
- **Error state:** Disabled items with a reason.
- **Destructive actions:** Grouped in the Rewrite and Delete sections and marked with the danger style.
- **Keyboard:** Arrow navigation · type-ahead · Enter · Esc.

### S13 · Branch dialogs: create (inline) · rename · delete (MVP)
- **Purpose:** Manage branch lifecycle.
- **Primary actions:** Create (inline field at the target row) · Rename (inline) · Delete (dialog).
- **Secondary actions:** "Check out after creating" toggle; "Also delete origin/<name>"; "Push new branch".
- **Information displayed:**
  - Name validation live: invalid characters, and existing names.
  - Delete dialog: unmerged-commit warning with the count, and where the branch is checked out (worktree).
- **Entry points:** Branch button; menus; palette; ⌘B.
- **Exit points:** Enter or Esc.
- **Empty state:** —
- **Loading state:** —
- **Error state:** Name conflicts; branch checked out in another worktree (offer "Remove worktree…").
- **Destructive actions:** Delete an unmerged branch (confirmation names the lost commit count; undo restores it from the reflog).
- **Keyboard:** Enter confirm · Esc cancel.

### S14 · Reset dialog (MVP)
- **Purpose:** Move the current branch to another commit, with a clear consequence.
- **Primary actions:** Reset (mode chosen).
- **Secondary actions:** Cancel; copy the command.
- **Information displayed:**
  - Three radio cards:
    - **Soft:** keep all changes staged.
    - **Mixed:** keep the changes, unstaged.
    - **Hard:** discard changes and the working tree. Shows "N uncommitted changes will be lost".
  - The commits that leave the branch, listed.
- **Entry points:** Commit menu "Reset <branch> to this commit ▸"; palette.
- **Exit points:** A toast with Undo.
- **Empty state:** —
- **Loading state:** —
- **Error state:** —
- **Destructive actions:** Hard reset. It needs an explicit selection, it is never the default, and it snapshots uncommitted changes for undo.
- **Keyboard:** 1/2/3 select mode · ⌘↵ confirm.

### S15 · Stash popover and stash inspector (MVP)
- **Purpose:** Park and restore work.
- **Primary actions:** Stash (with message); Apply; Pop.
- **Secondary actions:** "Include untracked"; "Keep staged" (Post-MVP); rename; drop.
- **Information displayed:** Message field, prefilled "WIP on <branch>: <HEAD summary>"; the files to be stashed.
- **Entry points:** Stash ▾; menus; ⌘⇧S (proposal).
- **Exit points:** A toast with Undo; the stash row appears.
- **Empty state:** Clean tree → the Stash button is disabled, with the reason "Nothing to stash".
- **Loading state:** —
- **Error state:** Apply conflicts → S08 with operation "Applying stash".
- **Destructive actions:** Drop (confirmation; undo restores from the dropped SHA during the session).
- **Keyboard:** Enter stash · Esc.

### S16 · Tag dialog (MVP)
- **Purpose:** Mark a commit.
- **Primary actions:** Create a tag (lightweight or annotated).
- **Secondary actions:** "Push after creating".
- **Information displayed:** Name, type, message (annotated), target commit.
- **Entry points:** Commit menu; palette.
- **Exit points:** The chip appears; a toast.
- **Empty state:** —
- **Loading state:** —
- **Error state:** The name already exists.
- **Destructive actions:** Delete a tag from the remote (confirmation names the remote).
- **Keyboard:** Enter · Esc.

### S17 · Clone dialog (MVP)
- **Purpose:** Get a remote repository.
- **Primary actions:** Clone.
- **Secondary actions:** Choose a destination; "Open after clone" (default on); the GitHub tab (Post-MVP, when connected).
- **Information displayed:** URL (validated: https, ssh, local path); destination parent plus a full-path preview; progress (objects, deltas).
- **Entry points:** Launchpad; palette; ⌘⇧C.
- **Exit points:** The repository tab opens.
- **Empty state:** —
- **Loading state:** Progress with cancel; the dialog stays open.
- **Error state:**
  - Auth → S19 inline.
  - Host key → S19.
  - The destination exists and is not empty.
  - Network failure, with Retry.
- **Destructive actions:** Cancel removes the partial clone folder (it says so).
- **Keyboard:** Enter clone · Esc cancel.

### S18 · Create repository dialog (MVP)
- **Purpose:** Initialize a repository.
- **Primary actions:** Create.
- **Secondary actions:** Default branch; `.gitignore` and license templates (Post-MVP).
- **Information displayed:** Name, location, full-path preview.
- **Entry points:** Launchpad; palette.
- **Exit points:** S26 (empty repository).
- **Empty state:** —
- **Loading state:** —
- **Error state:** The folder is already a repository → offer "Open instead".
- **Destructive actions:** —
- **Keyboard:** Enter · Esc.

### S19 · Credential and SSH dialogs (MVP)
- **Purpose:** Answer authentication prompts safely.
- **Primary actions:**
  - HTTPS: username and token/password → Continue ("Save to keychain" via the credential helper).
  - SSH: key passphrase.
  - Host-key confirmation: fingerprint shown.
- **Secondary actions:** Cancel; "Use a different key…".
- **Information displayed:** Remote host and URL; which operation is waiting; the fingerprint (SHA256).
- **Entry points:** Git askpass during fetch, pull, push, or clone.
- **Exit points:** The operation continues or fails.
- **Empty state:** —
- **Loading state:** —
- **Error state:** Wrong credentials → the reason inline, and the prompt stays open.
- **Destructive actions:** —
- **Keyboard:** Enter · Esc cancels the operation.

### S20 · GitHub sign-in (Post-MVP)
- **Purpose:** Connect GitHub for repository discovery and pull requests.
- **Primary actions:** "Sign in with GitHub" (device flow: code, then the browser).
- **Secondary actions:** Use a token; disconnect.
- **Information displayed:** Scopes requested; the account after connecting.
- **Entry points:** Settings › Accounts; the Clone dialog GitHub tab.
- **Exit points:** Connected state.
- **Empty state:** —
- **Loading state:** "Waiting for browser confirmation…"
- **Error state:** Expired code; denied.
- **Destructive actions:** Disconnect (removes the token from the keychain).
- **Keyboard:** —

### S21 · Command palette (MVP)
- **Purpose:** Every action and destination, from the keyboard.
- **Primary actions:** Run a command; pick arguments (ref, commit, remote, file).
- **Secondary actions:** Switch mode with a prefix: `>` actions, `@` refs, `#` commits, `/` files, `:` settings.
- **Information displayed:**
  - Fuzzy matches with highlighted characters.
  - Shortcut hints.
  - Context line ("on feature/greeting").
  - Recent commands first.
  - Disabled commands with the reason.
- **Entry points:** ⌘K; the command bar button.
- **Exit points:** Enter runs the command; Esc clears the query, then closes.
- **Empty state:** Recent and suggested commands for the current selection.
- **Loading state:** Ref and commit sources stream in.
- **Error state:** —
- **Destructive actions:** Destructive commands open their dialogs.
- **Keyboard:** ↑↓ · Enter · Tab into an argument · ⌫ removes the argument chip.

### S22 · Search overlay (MVP)
- **Purpose:** Find commits.
- **Primary actions:** Query; next or previous match.
- **Secondary actions:** Scope prefixes `author:` `sha:` (MVP); `path:` `ref:` `after:` (Post-MVP).
- **Information displayed:** "N of M"; non-matches dimmed.
- **Entry points:** ⌘F; the Search button.
- **Exit points:** Esc.
- **Empty state:** "No commits match". The query stays editable.
- **Loading state:** "Searching loaded history…", then "Searched all 12,408 commits".
- **Error state:** —
- **Destructive actions:** —
- **Keyboard:** Enter or ⌘G next · ⇧⌘G previous · Esc close.

### S23 · Activity drawer and Undo (MVP)
- **Purpose:** Transparency and recovery.
- **Primary actions:** Undo the last operation; copy the command or output.
- **Secondary actions:** Filter by repository; Clear.
- **Information displayed:**
  - Timeline entries with: operation, time, duration, the exact Git command lines, and exit status.
  - Output (including hooks).
  - An "Undo available" badge.
- **Entry points:** Activity bar; toasts' "Details"; error links.
- **Exit points:** Collapse.
- **Empty state:** "No operations yet in this session".
- **Loading state:** The live entry streams its output.
- **Error state:** Failed entries expand by default.
- **Destructive actions:** —
- **Keyboard:** ⌘⇧Y toggle (proposal) · ⌘Z undo.

### S24 · Application settings (MVP core)
- **Purpose:** Configure YForge and Git defaults.
- **Primary actions:** Change settings; search settings.
- **Secondary actions:** Reset a section to defaults; scope switch (All repositories / This repository).
- **Information displayed:** Sections:
  - **General:** open behavior, restore tabs.
  - **Git:** identity, default branch, pull mode, auto-fetch interval, prune, git executable path.
  - **Accounts & authentication:** SSH agent, keys, credential helper status; GitHub (Post-MVP).
  - **Appearance:** theme (Light / Dark / System), density, UI and code font size, date format.
  - **Diff & merge:** whitespace default, external tools (Post-MVP).
  - **Keyboard:** reference; customization Post-MVP.
  - **Integrations:** GitHub (Post-MVP).
  - **Privacy & diagnostics:** opt-in usage data (off by default) with its event list, crash reports, and persisted activity history; each list exports and clears (rule S16).
  - **Advanced:** logging.
- **Entry points:** ⌘,; the gear; palette ":".
- **Exit points:** Close or Esc (changes apply immediately).
- **Empty state:** —
- **Loading state:** —
- **Error state:** Invalid git path.
- **Destructive actions:** "Forget saved credentials" (confirmation).
- **Keyboard:** ⌘F search · ↑↓ sections.

### S25 · Repository settings (MVP subset)
- **Purpose:** Per-repository configuration.
- **Primary actions:** Edit identity override; add, edit, or remove remotes; pull mode override.
- **Secondary actions:** Hooks path; `.gitignore` editor (Post-MVP); LFS and submodules (Post-MVP).
- **Information displayed:** Effective values, with their source (repository / global / default).
- **Entry points:** Settings scope "This repository"; the repository ▾ menu.
- **Exit points:** Close.
- **Empty state:** —
- **Loading state:** —
- **Error state:** Invalid remote URL.
- **Destructive actions:** Remove a remote (undoable).
- **Keyboard:** As S24.

## States and special views

### S26 · Empty repository (MVP)
- **Purpose:** First commit in a new repository.
- **Primary actions:** "Create first commit" (stage all + composer).
- **Secondary actions:** Add a remote; add a `.gitignore` (Post-MVP templates); open in editor.
- **Information displayed:**
  - State strip: "main (unborn) · no commits yet".
  - The graph area explains the unborn branch; untracked files are listed.
- **Entry points:** Create a repository; open an initialized repository with no commits.
- **Exit points:** The first commit → S02.
- **Empty state:** No files → "Add files to this folder, then commit them".
- **Loading state:** —
- **Error state:** —
- **Destructive actions:** —
- **Keyboard:** ⌘↵ commit.

### S27 · Detached HEAD (MVP)
- **Purpose:** Prevent lost commits.
- **Primary actions:** "Create branch here"; "Return to <previous branch>".
- **Secondary actions:** Continue detached.
- **Information displayed:**
  - A state-strip warning: "HEAD detached at 1a2b3c4 (tag v0.1.0)".
  - The composer shows "Commits made here won't belong to a branch".
- **Entry points:** Checkout of a tag or commit; external checkout.
- **Exit points:** Create a branch, or checkout a branch.
- **Empty state:** —
- **Loading state:** —
- **Error state:** —
- **Destructive actions:** Checking out a branch with detached-only commits → a confirmation that lists the commits that will become unreachable, and offers "Create branch".
- **Keyboard:** ⌘B create branch.

### S28 · Offline and authentication-error states (MVP)
- **Purpose:** Explain remote failures and recovery.
- **Primary actions:**
  - Offline: Retry.
  - Auth failure: Fix credentials (S19).
  - Host key changed: a safety warning explaining a possible man-in-the-middle (MITM) attack, with "Show fingerprints".
- **Secondary actions:** Work offline (auto-fetch paused, indicator shown).
- **Information displayed:** Which remote failed, when, and the last successful fetch time.
- **Entry points:** Failed fetch, pull, or push, or auto-fetch.
- **Exit points:** Recovery.
- **Empty state:** —
- **Loading state:** —
- **Error state:** This screen is an error state.
- **Destructive actions:** —
- **Keyboard:** —

### S29 · Worktree lanes (MVP)
- **Purpose:** See parallel work on several branches and integrate it.
- **Primary actions:**
  - Open a worktree (tab group).
  - Integrate a worktree: rebase onto the target, then `ff-only`, then optional removal.
  - Create a worktree from a branch or commit.
- **Secondary actions:** Remove a worktree; open in terminal; reveal in Finder.
- **Information displayed:** Per lane: path, branch, target, ahead/behind, change counts.
- **Entry points:** Sidebar Worktrees; the state-strip Worktrees segment; worktree tab group; branch and commit menus ("Create worktree from…").
- **Exit points:** Open, integrate, or collapse.
- **Empty state:** "No linked worktrees. Create one to work on another branch in parallel", with "Create worktree…".
- **Loading state:** Lane counts reserve space until status resolves.
- **Error state:**
  - Integration conflict → S08, with operation "Rebasing <branch> onto <target>".
  - The worktree path is missing → the lane is marked "Missing", with "Prune" (runs `git worktree prune`).
- **Destructive actions:** Remove a worktree with uncommitted changes (confirmation lists the changes).
- **Keyboard:** Enter open · I integrate (confirm) · ⌘⇧W create worktree (proposal).

### S30 · Toasts (MVP)
- **Purpose:** Report outcomes.
- **Primary actions:** Undo; Details.
- **Secondary actions:** Dismiss.
- **Information displayed:** The outcome in one line ("Committed 2 files to feature/greeting").
- **Entry points:** Operation completion or failure.
- **Exit points:**
  - Success auto-dismisses after 6s, and pauses on hover or focus.
  - Failures persist.
- **Empty state:** —
- **Loading state:** —
- **Error state:** The failure variant, with a next action.
- **Destructive actions:** —
- **Keyboard:** Focusable region; ⌘⇧Z opens the last toast's details (proposal).

### S31 · Keyboard reference overlay (MVP)
- **Purpose:** Discover shortcuts.
- **Primary actions:** Search shortcuts.
- **Secondary actions:** Open Keyboard settings (Post-MVP).
- **Information displayed:** Shortcuts grouped by region; the context-specific ones first.
- **Entry points:** ⌘/; palette.
- **Exit points:** Esc.
- **Empty state:** —
- **Loading state:** —
- **Error state:** —
- **Destructive actions:** —
- **Keyboard:** Type to filter · Esc.
