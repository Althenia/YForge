# Hands-on log: GitKraken 12.5.0 (Electron 41.3.0), macOS, signed-in Pro profile, dark theme

This log records every state observed hands-on, or captured by the user in the live app, during the Phase 1 investigation (2026-09-29). It is the evidence behind the [H] and [U] labels in [../PRODUCT_ANALYSIS.md](../PRODUCT_ANALYSIS.md).

Sandbox: /tmp/yforge-gk-lab (sample clone of bare remote; upstream-clone pushes; other-repo; empty-repo; worktree sample-wt-hotfix).
Window sizes observed: 1800x1044 logical (captured 1280x741) and staged 968x675.

## New Tab / launcher (verified)
- "+" opens New Tab (tooltip "New Tab ⌘ + T"). Left: "Repositories" with Open / Clone / Create buttons, "Search repositories (⌘ + Option + F)", Recent list (name + ~/path). Right: "Connect More Integrations" pitch + "Connect Integrations" (external link), Resources (Intro Tutorials, Release Notes, Documentation).
- Open → native macOS folder sheet titled "select a repository to open" (column browser, sidebar). Agent tooling could not drive it; user completed.

## Shell / layout (verified)
- Title row: traffic lights, folder icon (Repository Management), tabs (Launchpad pinned first with rocket icon; repo tabs with branch glyph; active tab has ×), "+", tab-list dropdown, notification bell with badge, gear (Preferences), profile menu ("Default Profile" + avatar).
- Toolbar row: breadcrumb "repository: sample ▾ › branch: main ▾" (two-line label/value), center actions with icon+label: Undo, Redo (disabled when N/A), Pull (+ split dropdown), Push, Branch, Stash, Pop (disabled when no stash? enabled here), divider, Terminal; right: Actions (command palette), Search.
- Left panel: collapse chevron, segmented "List | Agents", "Viewing N" (visible refs count), filter "Filter (⌘ + Option + f)", accordion sections with icon + UPPERCASE label + count: LOCAL, REMOTE, WORKTREES, STASHES, CLOUD PATCHES, ISSUES, TEAMS, TAGS. Expanded section fills height; collapsed ones stack at bottom. LOCAL groups branches by prefix folders (bugfix/, feature/, hotfix/) with branch glyph; checked-out branch row highlighted green with checkbox-style check; ahead/behind shown as "2↑ 1↓" at row end; "search 1↓".
- Center: column header BRANCH / TAG | GRAPH | COMMIT MESSAGE (+ gear at right). Rows ~20px (at 0.71 scale) dense.
- Right: Commit panel (WIP selected) or commit details (commit selected). Fixed ~ 280px (scaled) width; at 968x675 staging lists shrink to 1 visible row each (cramped).
- Status bar: "Select an integration" (left), list icon (activity log?), keyboard icon, gift icon, zoom "100%" popup, Support, GitKraken badge + PRO, version 12.5.0.

## Graph (verified)
- WIP row on top: dashed hollow circle node on HEAD lane + "// WIP" input (stash/commit name field) + change counts "✎2 +1 −1".
- Stash rendered as its own row with stash glyph node, dotted connector to base commit; row text = stash message.
- Commit nodes = author avatars (identicon-like when no avatar); merge commit = small solid dot; lanes colored per branch (cyan main, blue, purple, magenta); curved connectors.
- Ref labels in BRANCH/TAG column aligned with the row, colored to lane: local branch shows laptop glyph, remote shows cloud glyph, both glyphs when local and remote on same commit; checked-out branch prefixed "✓"; "+1" chip when more refs share the commit (collapsed); tags with tag glyph (e.g., v0.2.0); long names truncated with ellipsis.
- Divergence: after Fetch All, origin/main and origin/feature/search appear as separate cloud labels at their commits; remote-only branch shows only cloud label.
- Hover on commit row: ghost label of nearest containing branch (dimmed label).
- Hover on branch label: other rows' messages dim; only that branch's commits stay bright.
- Commit message column shows summary + dimmed body inline, line breaks rendered as " | ".
- Selected commit row highlighted blue.

## Commit details (verified)
- Banner on top when WIP exists: "4 file changes in working directory [View Changes]".
- "commit: f86d53" + "Explain commit" (AI, purple).
- Message box; author avatar + name; "authored 09/07/2026 @ 9:00 AM"; "parent: 885139" (clickable SHA).
- File summary "1 modified", sort toggle, Path | Tree toggle, "View all files" checkbox, Expand/Collapse All, file tree with status glyphs.

## Diff viewer (verified)
- Opening a file replaces the graph area; left panel collapses to icon rail with counts; right panel stays.
- Header: path, encoding "UTF-8", Stage File/Unstage File (WIP), close ×.
- Toolbar: Edit in Working Directory / Edit This File; Unstaged | Staged toggle (partially staged file); File View | Diff View; Blame | History; prev/next change arrows; view modes Hunk / Inline / Split; ¶ toggle (whitespace-related, tooltip unverified); wrap toggle.
- Hunk header "@@ -3,7 +3,7 @@" with Discard Hunk (red) / Stage Hunk (green) on WIP, Unstage Hunk on staged, Revert Hunk on commits.
- Line numbers old/new, −/+ gutters, red/green row tint, word-level highlight, syntax highlighting, overview ruler.
- File History view: full takeover "File History: src/util.js": commit list (avatar, summary, relative time + author, short SHA), "ADDED src/util.js" marker, "End of History"; right pane = diff for selected commit.
- Search toolbar button disabled while diff open.

## Staging / commit (verified)
- Commit panel: trash icon (discard all), "N file changes on <branch>", AI icon; sort; Path | Tree; "Unstaged Files (3)" + "Stage All Changes" (green outline); "Staged Files (1)" + "Unstage All Changes" (red outline).
- Status glyphs: pencil (modified, amber), plus (added/untracked, green), minus (deleted, red).
- Hover file row → "Stage File" button + path tooltip.
- Stage Hunk moved the hunk; file appears in both lists; diff gets Unstaged | Staged toggle.
- Tabs under lists: Commit | Stash | Cloud Patch icons. "Amend previous commit" checkbox. Summary field with remaining-character counter (72 → 43) and AI button; Description field.
- Commit options disclosure → "Push after committing" checkbox. "Compose commits with AI" button.
- Primary button text: "Type a Message to Commit" (disabled, no message) → "Stage Changes to Commit" (message but nothing staged/after commit) → "Commit Changes to 2 Files" (enabled).
- Commit placed new node on main; main ahead counter updated to 2↑ 1↓ immediately.

## Fetch / pull menu (verified)
- Pull split-button dropdown: "Select a default pull/fetch operation to execute when clicking this button": Fetch All, Pull (fast-forward if possible) [default dot], Pull (fast-forward only), Pull (rebase). Clicking text ran Fetch All without changing default.

## Pull → merge conflict (verified)
- Toolbar Pull (default "fast-forward if possible") on diverged main: tooltip names the mode. Result: WIP row turns amber banner "A file conflict was found when attempting to merge into main"; GitKraken auto-stashed WIP first ("Auto stash before merge of "main" and "origin/main"" stash row); red toast bottom-left "Pull Failed / Has conflicts" (notification location pref = Bottom Left).
- Right panel: "Merge conflicts detected", "Merging [origin/main] into [main]" chips, Conflicted Files (1) with warning glyph, "Mark All Resolved", Resolved Files (0); commit message prefilled "Merge remote-tracking branch 'origin/main'"; footer buttons "No Changes to Merge" (disabled) + "Abort Merge" (red). Undo/Redo disabled.
- Conflict tool (full takeover): header "README.md (1 conflict)", UTF-8, wrap, "Auto-resolve with AI", "Open in external merge tool", "Save", ×. Top split A "Commit 99f5de on main" (blue A badge) vs B "Commit e51c03 on origin/main" (amber B badge); header checkbox per side (take all); per-line checkboxes on conflict lines. Bottom "Output" pane with "conflict 1 of 1" ↑↓ navigation; unresolved region magenta; chosen lines show A/B gutter markers and check icons; "Reset" button; output order follows click order.
- After Save: Conflicted (0), Resolved (1) green check; footer "Commit and Merge" + "Abort Merge". Commit created merge commit (parents shown "99f5de,e51c03"), ahead counter updated "3↑".
- Auto-stash is NOT re-applied automatically after the merge; user must Pop. Pop restored changes and copied the stash message into the WIP summary field ("Auto stash before merge of..."), which then prefilled the next stash/commit summary.
- Date separators appear at right edge of graph rows ("2 weeks ago", "3 weeks ago", "4 weeks ago").

## Rebase (CLI-initiated) → conflict → continue (verified)
- GitKraken detected in-progress rebase: breadcrumb branch "HEAD"; LOCAL shows "HEAD" entry; WIP banner still says "...attempting to merge into HEAD" (merge wording during rebase); right banner "1 file conflict in working directory [View Conflict]".
- Commit panel: "Rebase conflicts detected"; message area "Rebasing commit 1 out of 1 / Personalize greeting / # Conflicts: # src/util.js"; footer "Skip Commit" + "Abort Rebase"; after resolve → "Continue Rebase" + "Abort Rebase".
- Conflict tool during rebase: A "Commit 62db91 on" (blank branch), B "Commit f86d53 on" (blank) — no branch names, no ours/theirs explanation.
- After continue: rebased commit on top; old remote commit stays labeled "feature/greeti... ☁"; left panel "8↑ 1↓".

## Push after rebase / force push (verified)
- Push → top banner: "'refs/heads/feature/greeting' is behind 'refs/remotes/origin/feature/greeting'. Update your branch by doing a Pull." [Pull (fast-forward if possible)] [Force Push] [Cancel]. Raw ref names; recommends Pull even after an intentional rebase.
- Force Push → second banner: "Force push is a destructive action and cannot be undone. Are you sure?" [Force Push] [Cancel] ☐ Don't ask again. No lease option, no list of remote commits that will be dropped.
- After force push: stale remote commit disappears; combined local+remote label.

## Branch / checkout / undo (verified)
- Double-click branch in left panel = checkout (branch row gets check + "⋮" more button; breadcrumb updates).
- Toolbar Branch → inline "enter branch name" field in BRANCH/TAG column at HEAD row; Enter creates AND checks out.
- Undo after create-branch undid only the checkout (branch remained); Redo enabled.
- HEAD commit details swap "Explain commit" for "Recompose commit with AI" split button.

## Stash (verified)
- Toolbar Stash: one click, uses WIP summary text as stash message; stash row appears in graph; STASHES section lists messages.
- Toolbar Pop: pops newest (tooltip "Pop Stash").
- A CLI-created `git stash push -u` entry ("WIP: scratch notes", stash@{0}) never appeared in GitKraken's STASHES list or graph (count showed 1 while git had 2).

## Search, palette, preferences (verified)
- Search (toolbar): overlay "find commit" bar at top-right of graph with "N of M", ↑↓, ×; non-matching rows dimmed, first match selected.
- Actions = command palette: "Search for commands and actions (e.g., Open Repo)"; fuzzy subsequence matching with highlighted letters; no Merge/Rebase/Cherry-pick/Reset commands ("branch" → Rename Branch, Create Branch only). Nested argument step: "Switch Theme" chip → "Search for a theme to switch to" (GitKraken Light, Light (Legacy), Light High Contrast, Light - High Contrast (Legacy), Dark, Dark - High Contrast). Esc clears query, second Esc closes.
- Light theme verified: light surfaces, lane hues kept (cyan/blue/purple/magenta), labels become pastel chips; restored to GitKraken Dark.
- Preferences = full-page takeover within window; left nav: Exit Preferences, Current profile, Organization, Preferences (General, Profiles, SSH, Integrations, GitKraken AI, External Tools, Notifications, UI Customization, Commit Signing, Editor, In-App Terminal, Experimental), Repo-Specific Preferences (Encoding, Gitflow, Git Hooks, ...). Forms: right-aligned labels, helper text, ⚠ performance warnings.
- General: Auto-Fetch Interval (0–60), Auto-Prune, Keep submodules up to date, Default Branch Name, Delete .orig, Show All Commits, Initial Commits (2000, min 500), Lazy Load, Remember tabs, extended logging, Forget All credentials, proactive conflict detection, share branch status with team.
- UI Customization: Theme, Notification Location, Date/Time locale + 4 formats with live previews, workspace/group colors, group worktree tabs, toolbar icon labels, Agents view, spell checking, initials vs avatars, ghost branch on hover/select, highlight rows on branch hover, "Branch visibility in commit graph" (All/...).
- Integrations: second-level list (GitHub, GHES, GitLab, GitLab SM, Bitbucket, Bitbucket DC, Azure DevOps, Jira Cloud, Jira DC, Trello); GitHub page shows connected account, disconnect, connect another, SSH key in use + "Add key to GitHub", generate key and add, browse private/public key; "Manage Integrations" (external).
- External Tools: Merge Tool, Diff Tool, External Editor (+ GitLens upsell card), External Terminal, Coding Agent, Agent Status Integrations (Claude Code, Codex, Copilot CLI, OpenCode plugins install/reinstall/uninstall).
- Left panel Agents mode: "Worktrees N", search/filter, "+ Start Claude Co..." split button, worktree cards (main worktree home glyph).

## Repository Management / Clone / Init / Launchpad (verified)
- Repository Management (folder icon, tooltip "Repo Management"): Browse, Clone, Init, New Workspace, Integrations; Collapse/Expand; search; "WIP summary" toggle; groups Open repositories (Close all tabs + bulk icons), Favorites, Recent (Remove all), All; rows with branch chip + ahead and change-count chips + row actions.
- Clone modal: tabs Clone with URL / GitHub.com / GHES / GitLab.com / GitLab SM / Bitbucket.org / Bitbucket DC / Azure DevOps; fields Where to clone to (+Browse), URL (or "Repository to clone: Search Remotes" for providers), Shallow Clone, Sparse Checkout, "Clone the repo!".
- Init modal: tabs Local Only + providers; Name, Initialize in (+Browse), Full path preview, Default branch name, .gitignore template, License, Initialize with LFS, "Create Repository".
- Launchpad tab: MY PULL REQUESTS / MY ISSUES / WIPS / ALL / SNOOZED / saved views / + SAVE A VIEW; Personal | Team (ADVANCED); View Settings; Workspace + provider filters; empty state with provider buttons and mascot illustration.

## Detached HEAD (CLI checkout of tag, verified)
- Breadcrumb "HEAD"; graph label "✓ HEAD" with "+1" hiding the tag; LOCAL "HEAD" entry; Pull/Push disabled; no prominent warning seen in commit details.

## Context menus (user screenshots, live app)
- Commit row (HEAD commit "Personalize greeting" on feature/greeting): Checkout this commit | Create worktree from this commit | Create branch here; Reset feature/greeting to this commit ›; Revert commit; Edit commit message | Recompose commit with AI (Preview); Drop commit | feature/greeting ›; feature/inline-branch › (one submenu per ref on the commit) | Create tag here; Create annotated tag here. Native macOS menu styling, grouped by separators, reset target named in item text.

- Left-panel branch folder ("bugfix/") right-click: single item "Delete 1 branch in folder "bugfix"" (bulk delete by prefix). Hovering a left-panel row shows an eye (visibility/hide) toggle at the row start.

- Stash row right-click: Apply Stash; Pop Stash; Delete Stash | Edit stash message | Share stash as Cloud Patch | Hide. (No confirmation shown in menu; delete confirmation unverified.)

- Checked-out branch label right-click (feature/greeting): Pull (fast-forward if possible); Push; Set Upstream | Checkout › | Create worktree from › | Create branch here; Reset feature/greeting to this commit ›; Edit commit message; Revert commit | Recompose commit with AI (Preview); Drop commit | Explain Branch Changes (Preview) | Apply patch; Rename feature/greeting; Delete feature/greeting; Delete origin/feature/greeting; Delete feature/greeting and origin/feature/greeting | Copy branch name; Copy commit sha; Create patch from commit; Share commit as Cloud Patch | Pin to Left ›; Solo › | Create tag here; Create annotated tag here. (~27 items.)
- Drag feature/greeting label onto main label → drop menu: Fast-forward main to feature/greeting; Merge feature/greeting into main; Rebase feature/greeting onto main; Interactive Rebase feature/greeting onto main | Reset feature/greeting to this commit ›. Every item names source and target explicitly.
- Remote branch (left panel origin/feature/remote-only) right-click: Merge origin/feature/remote-only into feature/greeting; Rebase feature/greeting onto origin/feature/remote-only | Checkout origin/feature/remote-only | Create worktree from origin/feature/remote-only | Create branch here; Cherry pick commit; Reset feature/greeting to this commit ›; Revert commit | Explain Branch Changes (Preview) | Delete origin/feature/remote-only | Copy branch name; Copy commit sha | Hide; Pin to Left; Solo | Create tag here; Create annotated tag here. Hover shows full-name tooltip + eye toggle.
- Tag label (v0.2.0) right-click: Fast-forward v0.2.0 to feature/greeting; Merge feature/greeting into v0.2.0; Rebase feature/greeting onto v0.2.0 | Checkout this commit | Create worktree from this commit | Explain Branch Changes (Preview) | Create branch here; Cherry pick commit; Reset feature/greeting to this commit ›; Revert commit | Delete v0.2.0 locally; Delete v0.2.0 from origin | Copy tag name | Solo | Annotate v0.2.0. (Tag menu offers branch-style verbs "Merge … into v0.2.0" / "Fast-forward v0.2.0" — semantically confusing for a tag.)
- Multi-select 3 left-panel local branches right-click: Delete 3 local branches | Hide 3 branches; Solo 3 branches.
- Multi-select 3 commits (already pushed, on main and in HEAD ancestry) right-click: Checkout this commit | Create worktree from this commit | Create branch here; Cherry pick 3 commits; Rebase feature/greeting onto this commit; Reset feature/greeting to this commit ›; Revert commit | Copy commit sha; Create patch from commits; Share commits as Cloud Patch | Create tag here; Create annotated tag here. No Squash item for this selection (user recalls a squash option; verifying with 2 unpushed HEAD commits).

- Committed-file row (commit details file list) right-click: File History; File Blame | Open in external diff tool; Open in VS Code; Open file in default program; Show in Finder | Copy file path | Edit file; Delete file | Restore file from this commit. Hover shows full path tooltip.
- WIP row exists only while the working tree has changes; with a clean tree the graph starts at HEAD and there is no entry point to the staging panel (user could not find it).

- Unstaged file right-click: Stage; Discard changes; Ignore ›; Stash file | File History; File Blame | Open in external diff tool; Open in VS Code; Open file in default program; Show in Finder | Copy file path; Create patch from file changes | Edit file; Delete file. Staged file: same with Unstage first. Row hover buttons "Stage File" (green) / "Unstage File" (red).
- WIP row right-click: single item "Explain working changes (Preview)".
- Multi-select 3 commits at HEAD tip on checked-out branch (2 unpushed + 1 pushed, no merge between): Checkout this commit | Create worktree from this commit | Create branch here; Cherry pick 3 commits; Reset feature/greeting to this commit ›; Revert commit | Recompose 3 commits with AI (Preview); Recompose 2 children of 9f731b with AI (Preview); Interactive Rebase 2 children of 9f731b; Squash 3 commits; Drop 3 commits | feature/inline-branch ›; feature/greeting › | Compare commit against working directory | Create tag here; Create annotated tag here. Squash/Drop appear here but not for a selection below a merge commit (inference: contiguous, merge-free range on HEAD's branch).
- Opening an empty repository (no commits): banner "Repository 'empty-repo' must have an initial commit to be opened. Do you want GitKraken Desktop to make a commit for you? [Initialize] [Cancel]" — GitKraken cannot open an unborn branch. New Tab right column rotates cross-sell ("Using VS Code, Cursor, or the CLI? … Explore Dev Tools").

## Graph measurements (12.5.0; basis for app/DESIGN.md S13)
Sources: values read from the installed app bundle (graph constants and theme CSS variables; no code copied) and the Help Center interface page images (graph-elements.png, ghost.gif, Commit-highlight.png), cross-checked against the hands-on captures above.
- Geometry: rows 28px with a 22px inner band (3px above and below); header 26px. Graph column: 28px gutter, 22px lane pitch, 22px nodes with a 2px lane ring around an 18px avatar, 12px merge dots, 2px edges, 11px corner radius. Compact mode: 10px pitch and nodes, 1px lines, 10px gutter.
- Columns: Branch/Tag 130 (32–300), Graph 150 (min 56), Commit message fills. Author 130 (32–175), Date/Time 130 (50–175), and SHA (max 100) are optional.
- Palette, identical in GitKraken Dark and Light, assigned by column index: #15A0BF, #0669F7, #8E00C2, #C517B6, #D90171, #CD0101, #F25D2E, #F2CA33, #7BD938, #2ECE9D.
- Ref labels: the lane mixed 25% into the app background (hover 45%; checked-out 50% with white text at weight 500); 2px radius; sans 12px; 14px glyphs 5px apart; a connector line from the label to the node at 25% opacity (2px at 100% when active); a `+N` count in the same tint.
- Nodes: commit = avatar in a 2px lane ring. In initials mode the avatar is the lane color with bold 10px uppercase initials in a contrast-picked ink (fallback background #199489). Merge = solid lane dot. WIP = dotted ring (2 3 dash, round caps). Stash = dotted square with a stash glyph.
- Rows: a lane streak at 10% alpha from the node center to the message column (50% when selected), then a 2px lane strip at the message start (≈2px measured in the help GIF). Selected row = blue 20%; hover = blue 10%; dimmed text = white 20% (branch hover over 0.2s; search non-match after 1s over 0.5s). Stash messages are italic secondary text; a merge-conflict WIP row gets the warning fill.
- Time dividers: a 10px pill at the message column's right edge, straddling the row's top edge by 8px.
- Edges route orthogonally: a branch lane runs vertically and turns into its parent's node on the parent's row; a merge's second-parent edge leaves horizontally, then runs down the parent's lane (help images).

## Tool limits hit
- Native context menus (right-click) and drag-drop menus not observable (menu closes when focus returns); native open panel not drivable.
