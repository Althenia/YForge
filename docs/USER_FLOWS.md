# Key User Flows (Phase 6)

Status: **approved 2026-09-29** (revision 2: standalone scope)

A "major interaction" is one deliberate click, drag, key command, or form submission; typing a name or message counts as one.

- **GitKraken counts** come from the hands-on runs [H] and the user-captured menus [U] in 12.5.0.
- **YForge counts** are design targets and are verified in usability tests (see [MVP_SCOPE.md](MVP_SCOPE.md#success-criteria)).
- Screen IDs refer to [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md).

## Flow A: Open repository → inspect graph → modify files → stage → commit → push

| Step | GitKraken [H] | YForge |
|---|---|---|
| Open | + tab → Open → native folder picker (Go to folder, path, Open) (5) | Launchpad Repositories row (1), or `yforge .` from the terminal (0) |
| Inspect graph | Visible (0) | Visible; the graph scrolls to HEAD (0) |
| Modify files | External editor | External editor ("Open in editor" from any file) |
| Find staging | Click the WIP row, which only exists when there are changes (1) | The state strip shows `✎2 +1`; the Changes row is always present (1) |
| Stage | Stage All Changes (1) | Stage all (1) |
| Message | Focus summary + type (1) | Type summary; focus lands there after staging (1) |
| Commit + push | Commit (1) → Push (1) → upstream prompt if new (1) | Commit & Push split button, with the upstream created inline for a new branch (1) |
| **Total** | **11** | **5** |

What YForge removes:

- the native picker for recent repositories;
- the missing entry point when the tree is clean (F1);
- the separate push step.

## Flow B: Create branch → make commits → fetch → rebase → resolve conflicts → push

| Step | GitKraken [H][U] | YForge |
|---|---|---|
| Create branch | Branch → name → Enter (2) | ⌘B → name → Enter, with a "check out" toggle (2) |
| Two commits | (WIP → stage → message → commit) × 2 (8) | (stage all → message → ⌘↵) × 2 (6) |
| Fetch | Pull ▾ → Fetch All (2), or auto-fetch | Auto-fetch; the state strip shows `↓3 new on main` (0–1) |
| Rebase | Drag branch onto main → "Rebase feature/x onto main" (2) | Drag → the drop menu previews "Rebase 2 commits onto main" (2), or palette "Rebase onto… main" (2) |
| Conflict | Click file → choose lines → Save → Continue Rebase (4). The sides are labeled "Commit 62db91 on" with no branch names (F3) | Banner "Rebasing feature/x onto main · 1/2 · 1 conflict" → Resolve → take Incoming (feature/x) → mark resolved; the resolver auto-advances. Then Continue (4) |
| Push | Push → banner (raw refs, suggests Pull) → Force Push → "Are you sure?" Force Push (3) | Push → S11 explains the rewrite, lists the 2 remote commits being replaced, and confirms with lease (2) |
| **Total** | **21** | **16–17** |

What YForge removes:

- ambiguous conflict sides;
- the misleading "do a Pull" advice after a rebase;
- a force push with no lease.

## Flow C: Inspect old commit → compare changes → create branch from commit

| Step | GitKraken [H][U] | YForge |
|---|---|---|
| Find commit | Search → type → first match auto-selected (2) | ⌘F → type → Enter (2) |
| Inspect a file | Click file in details (1) | Click file (1) |
| Compare with the working tree | Right-click commit → "Compare commit against working directory" (2) | Inspector "Compare with working tree" (1) (Post-MVP) |
| Branch from commit | Right-click → Create branch here → name → Enter (3) | Inspector header "Branch here" → name → Enter (2) |
| **Total** | **8** | **6** |

What YForge removes: menu hunting. The commit inspector carries the common commit verbs as header buttons.

## Flow D: Receive upstream changes → pull → conflict → resolve → continue

| Step | GitKraken [H] | YForge |
|---|---|---|
| Pull | Pull (1) → silent auto-stash, conflict banner, red toast | Sync → Pull (1) → banner "Merging origin/main into main · 1 conflict · your changes are stashed and will be restored" |
| Open conflict | Click conflicted file (1) | Resolve (1) |
| Resolve | Tick lines (1) → Save (1) | Take Current, Incoming, or Both (1) → mark resolved (1) |
| Complete | Commit and Merge (1) | Complete merge (1) |
| Recover local work | Notice the stash was not restored → Pop (1) → clear the stash text that leaked into the summary (1). This is a hidden step (F5) | Automatic; toast "Restored your stashed changes" with Undo (0) |
| **Total** | **7, including the hidden recovery** | **5** |

## Flow E: Stash work → change branch → restore stash

| Step | GitKraken [H] | YForge |
|---|---|---|
| Stash | Stash (1); the message is the WIP summary text | Checkout with changes → dialog "Stash changes and switch / Carry changes / Cancel" (1) |
| Switch | Double-click the target branch (1) | Included in the step above (0) |
| Return | Double-click the original branch (1) | Double-click the original branch (1) |
| Restore | Pop, which takes the newest stash, not necessarily this branch's (1) | Prompt "Restore 'WIP on feature/x' stashed when you left?" → Restore (1) |
| **Total** | **4** | **3**, and the right stash is restored |

## Flow F: Clone GitHub repository → authenticate → work → push

| Step | GitKraken [H] (GitHub integration connected) | YForge MVP (system credentials) |
|---|---|---|
| Start clone | Repository Management → Clone → GitHub.com tab (3) | ⌘⇧C, or Launchpad Clone… (1) |
| Choose repo | Search Remotes → select (2) | Paste the URL (1) |
| Destination | Keep the default, or Browse (native picker) (0–3) | Last-used parent, with a full-path preview (0) |
| Clone and open | Clone the repo! → open (2) | Clone (1); opens automatically |
| Authenticate | Through the connected GitKraken integration (0; setup was done earlier) | Private HTTPS → credential prompt stored via the Git credential helper (1–2); SSH uses the agent (0) |
| Work + push | Flow A (5) | Flow A (3–4) |
| **Total** | **12–15** | **7–9** |

Post-MVP adds GitHub sign-in (device flow) and a GitHub tab with repository search. After the one-time connection, the flow is the same length.

## Flow G: Parallel work in a worktree → review → integrate

| Step | GitKraken [U][D] | YForge |
|---|---|---|
| Create worktree | Branch menu → "Create worktree from…" → pick branch (2) | Branch menu or palette → "Create worktree…" → name (2) |
| Work | Open the worktree tab (1) → commit as in Flow A | Open the lane in its tab group (1) → commit as in Flow A |
| Review | Worktree WIP node → diff (2) | Lane shows ahead/behind vs target and change counts; review in the tab (1) |
| Integrate | Drag branch onto target → Merge, or Rebase + fast-forward (2) → remove the worktree from its menu (2) | Integrate → confirm "Rebase onto main, fast-forward main, remove worktree" (2) |
| **Total** | **9** | **6** |

What YForge adds: one-step linear integration (rebase, then `merge --ff-only`) with the worktree cleanup included in the same confirmation.

## Flow H: Undo a mistake

| Case | GitKraken [H][D] | YForge |
|---|---|---|
| Last action, e.g. discard, reset, or delete branch | Undo (1). Composite actions undo partially: create-branch undid only the checkout (F13) | Undo (1) reverses the whole operation; the tooltip names it ("Undo Reset feature/x --hard") |
| An earlier action | No history UI; the terminal reflog is needed | MVP: Activity shows the command and output, with guidance. Post-MVP: restore points in the timeline (2) |

## Flow I: Squash local commits before pushing (Post-MVP)

| Step | GitKraken [U] | YForge |
|---|---|---|
| Select range | ⌘-click each commit (N) | ⇧-click the range (2), or palette "Squash last N commits…" (2) |
| Squash | Right-click → "Squash N commits" (2); shown only for a merge-free range on the current branch, otherwise silently absent | Right-click → "Squash N commits" (2); when it's unavailable, the item is disabled with its reason |
| Message | Squash message editing: unverified | Combined message editor, prefilled with the summaries (1) |
| **Total** | **N + 2** | **5** |

## Flow J: Recover from detached HEAD

| Step | GitKraken [H] | YForge |
|---|---|---|
| Notice | Only the "HEAD" label and breadcrumb | State-strip warning plus composer notice (0) |
| Keep the work | Right-click → Create branch here → name (3) | Banner "Create branch here" → name → Enter (2) |
| Leave safely | Checkout another branch; detached commits become unreachable without warning [I] | Confirmation lists the commits that would become unreachable, with "Create branch" offered first (1) |
