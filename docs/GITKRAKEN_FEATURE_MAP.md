# GitKraken Feature Map → YForge Priorities

Evidence labels:

- **[H]**: hands-on, GitKraken 12.5.0.
- **[U]**: captured by the user in the live app.
- **[D]**: official docs.
- **[I]**: inference.

Priority values:

- **MVP**
- **Post-MVP**
- **Later**
- **Do not replicate**: the reason is given in the row.

MVP rationale is defined in [MVP_SCOPE.md](MVP_SCOPE.md).

## Repository management

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Open local repository | Start working on an existing repo | New Tab or Repository Management → Open → native folder picker [H] | **MVP** | Entry point. YForge also accepts a dropped folder and `yforge <path>` from the terminal |
| Recent repositories | Return quickly | New Tab "Recent" (name + path); Repository Management groups [H] | **MVP** | Add branch, ahead/behind, and change chips inline [H: GitKraken shows them only in Repository Management] |
| Repository search | Find a repo by name | "Search repositories (⌘⌥F)" [H] | **MVP** | Launcher filter plus palette "Open repository…" |
| Clone by URL | Get a remote repo | Clone modal: destination path + URL, Shallow, Sparse [H] | **MVP** | URL + destination. Shallow and sparse are Post-MVP |
| Clone from provider list | Pick from my hosted repos | Provider tabs → "Search Remotes" [H] | **Post-MVP** | Needs GitHub sign-in |
| Initialize repository | Start a project | Init modal: name, location, full-path preview, default branch, .gitignore/license templates, LFS [H] | **MVP** | Local init + default branch. Templates Post-MVP |
| Open empty repository | Work in `git init` output | Refuses: "must have an initial commit… make a commit for you?" [U] | **MVP** | YForge opens an unborn branch with an empty-state composer (fixes F2) |
| Repository tabs | Switch between repos | Tabs, +/⌘T, ⌘1–9, alias, drag reorder, per-profile restore [H][D] | **MVP** | Tabs + restore. Alias Post-MVP |
| Worktree tab grouping | See all worktrees of a repo | Auto-grouped tabs (12.4.1) [D] | **MVP** | Worktrees are first-class lanes in YForge (P7) |
| Repository Management dashboard | Status across all repos | Groups (Open/Favorites/Recent/All) with WIP summary and bulk actions [H] | **Post-MVP** | The MVP launcher covers status; bulk fetch/pull later |
| Local Workspaces | Group repos, bulk fetch/pull | Repository Management → New Workspace [D] | **Later** | Useful for multi-repo teams, not a core dependency |
| Cloud Workspaces | Share repo groups via account | gitkraken.dev [D] | **Do not replicate** | Proprietary cloud service; YForge stays local-first |

## Main workspace shell

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Toolbar Git actions | One-click common operations | Undo, Redo, Pull ▾, Push, Branch, Stash, Pop with icon + label [H] | **MVP** | Keep one-click access. Sync is one split control |
| Repo/branch breadcrumb | Know and switch context | "repository ▾ › branch ▾" [H] | **MVP** | Extend with worktree and upstream state (see State strip) |
| Left panel sections | Navigate refs | LOCAL, REMOTE, WORKTREES, STASHES, TAGS (+ CLOUD PATCHES, PRs, ISSUES, TEAMS) [H] | **MVP** | Core sections only; hosting sections Post-MVP |
| Left panel filter | Find a ref fast | "Filter (⌘⌥F)", remote-name aware (12.4.1) [H][D] | **MVP** | — |
| Branch prefix folders | Organize many branches | Folders by `/` prefix, bulk "Delete N branches in folder" [H][U] | **MVP** | Folders MVP; bulk delete Post-MVP |
| Resizable, collapsible panels | Fit the screen | Collapse chevron; panels resize [H][D] | **MVP** | Must also reflow at 1280×720 (fixes F11) |
| Status bar | Global signals | Integration picker, activity log, shortcuts, zoom, plan badge [H] | **MVP** | Keep zoom and activity. No plan badge or marketing |
| Activity log | See what Git ran | Footer icon → Application/Repository tabs, durations [D] | **MVP** | Show the exact Git commands and output, including hook output |
| In-app terminal | Run CLI Git | Terminal button, ⌥T [H][D] | **Later** | "Open in terminal" is MVP; the user's own terminal stays the terminal surface |
| Agents view | Run coding agents in worktrees | List/Agents toggle, worktree cards, "Start Claude Code" [H] | **Do not replicate** | Coding-agent tooling is out of scope; worktree lanes cover the Git part |
| Launchpad | PRs/issues/WIPs across repos | Pinned tab; Personal/Team views; saved views [H] | **Do not replicate** | Proprietary cloud aggregation; the local Repository list and worktree lanes cover the Git state |

## Commit graph

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Lanes, nodes, merge lines | Understand topology | Colored lanes, orthogonal connectors with rounded corners; avatar nodes; merge = small dot [H] | **MVP** | Core. YForge matches GitKraken's graph (app/DESIGN.md S13) |
| Ref label column | See branches/tags per commit | BRANCH/TAG column, lane-colored chips, laptop/cloud glyphs, ✓ for HEAD, `+N` chip [H] | **MVP** | Keep. Tags stay visible when refs collide (fixes F15) |
| HEAD indication | Know where I am | ✓ on checked-out chip, highlighted left row [H] | **MVP** | Keep the checked-out label in the graph; add the persistent state strip with the HEAD junction glyph |
| WIP node | See uncommitted work in context | Dashed node above HEAD, inline summary, counts; hidden when clean [H] | **MVP** | Always present ("Working tree clean") (fixes F1) |
| Stash rows | See stashes where they apply | Stash glyph row, dotted link to base [H] | **MVP** | Include `stash -u` entries (fixes F6) |
| Date separators | Orient in time | "2 weeks ago" dividers [H] | **Post-MVP** | Low cost, good orientation |
| Configurable columns | Show author/date/SHA | Header right-click or gear; per-repo widths/order [D] | **MVP** | Show/hide MVP; reorder Post-MVP |
| Avatars vs initials | Identify authors | Provider/Gravatar avatars; initials option [H][D] | **MVP (initials)** | No network fetches by default; avatars Post-MVP (opt-in) |
| Hover: highlight branch commits | Isolate one branch | Other rows dim on label hover [H] | **MVP** | High value, low cost |
| Ghost branch on hover | Know a commit's branch | Dim label of nearest containing branch [H] | **Post-MVP** | — |
| Selection & multi-select | Act on one or many commits | Click; ⇧/⌘ multi-select → batch menu [H][U] | **MVP** | — |
| Search commits | Find by message/SHA/author | Overlay "N of M", ↑↓, dims non-matches [H] | **MVP** | Add path and ref search Post-MVP |
| Hide / Solo / Pin | Reduce graph noise | Context menu, eye toggle, orange/gray icons [U][D] | **Post-MVP** | MVP offers "Branch visibility: All / Current + upstream" |
| Smart branch visibility | Focus on relevant branches | Graph header gear [D] | **Post-MVP** | — |
| Large histories | Stay fast | Initial 2000 commits, lazy load, Show All ⚠ [H] | **MVP** | Virtualized full history; no arbitrary cap |
| Combined diff for ranges | Review several commits | ⇧-select range → combined diff [D] | **Post-MVP** | — |

## Working directory and commit

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Unstaged/Staged lists | See changes by state | Right panel, Path/Tree toggle, status glyphs ✎ + − [H] | **MVP** | Add letter badges (M/A/D/R/U/!) so color is not the only cue |
| Stage/unstage file & all | Prepare a commit | Hover "Stage File"; "Stage All Changes"; S/U, ⌘⇧S/⌘⇧U [H][D] | **MVP** | — |
| Hunk staging | Commit part of a file | Diff "Stage Hunk"/"Unstage Hunk"/"Discard Hunk" [H] | **MVP** | — |
| Line staging | Precise commits | Select lines → right-click "Stage selected lines" [D] | **MVP** | Also offer a visible line-selection affordance, not only a menu |
| Discard | Throw away changes | Trash icon (all), menu, hunk/line [H][U][D] | **MVP** | Undoable; confirm for "discard all" |
| Ignore | Stop tracking noise | Menu → Ignore › (file/ext/dir; root `.gitignore` only) [U][D] | **Post-MVP** | — |
| Commit composer | Write a good message | Summary with 72-char counter + Description [H] | **MVP** | — |
| Amend | Fix last commit | "Amend previous commit" checkbox [H] | **MVP** | Warn when the commit is already pushed |
| Commit and push | Ship in one step | "Push after committing" option [H] | **MVP** | Split primary button: Commit / Commit & Push |
| Skip hooks / templates / co-authors | Workflow conventions | Commit options, Preferences › Commit [D] | **Post-MVP** | Hook output must be surfaced in MVP |
| Partial stash ("Stash file") | Park one file | File menu → Stash file [U] | **Post-MVP** | — |
| Restore file from commit | Recover a version | File menu [U] | **Post-MVP** | — |
| AI commit message / explain changes | Draft text | Sparkle buttons, "Explain working changes (Preview)" [H][U] | **Later** | Only as an opt-in, never-required assist; GitKraken AI credits are not replicated |
| Compose commits with AI | Split WIP into commits | "Compose commits with AI" [H] | **Do not replicate** | Not requested; commits stay user-authored |

## Diff viewer

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Hunk / Inline / Split views | Read changes | Three toggles in the diff toolbar [H] | **MVP** | — |
| Syntax & word highlighting | Spot the change | Default on [H] | **MVP** | — |
| Whitespace control | Ignore noise | ¶ toggle; ignore leading/trailing (12.0.0) [H][D] | **MVP** | Label the control explicitly (GitKraken's icon has no text) |
| Change navigation | Jump between hunks | ↑/↓ buttons [H] | **MVP** | Keyboard n/p |
| File view / edit in working directory | See the whole file | File View toggle; "Edit in Working Directory" [H] | **MVP (view)** | Editing: "Open in editor" MVP, in-app editor Later |
| File history | How a file evolved | Full takeover list + diff [H] | **Post-MVP** | — |
| Blame | Who changed a line | Blame view [D] | **Post-MVP** | — |
| Image & binary diff | Compare assets | Image handling implied by release notes [D] | **Post-MVP** | MVP shows a binary placeholder with size and type |
| External diff tool | Use Kaleidoscope, etc. | Preferences › External Tools [H] | **Post-MVP** | — |
| Patches | Share or apply a change | Create/apply patch [U][D] | **Later** | — |

## Branch workflows

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Create branch | Start work | Toolbar Branch → inline name at HEAD → Enter (creates + checks out) [H]; "Create branch here" [U] | **MVP** | Keep inline creation; choose checkout explicitly |
| Checkout | Switch branch | Double-click label/row [H]; "Checkout ›" submenu [U] | **MVP** | Offer stash-and-switch when dirty |
| Checkout remote branch | Start tracking | "Checkout origin/…" [U] | **MVP** | Create a tracking branch automatically |
| Rename / delete (local, remote, both) | Clean up | Menu items name every target [U] | **MVP** | Bulk delete Post-MVP |
| Merge / fast-forward | Integrate | Drag onto target → menu; "Merge X into Y" [U] | **MVP** | Drag-drop plus palette with arguments (fixes F7) |
| Rebase | Linear history | Drag → "Rebase X onto Y"; "Rebase … onto this commit" [U] | **MVP** | — |
| Interactive rebase | Rewrite local history | Drag → "Interactive Rebase"; P/S/R/D actions [U][D] | **Post-MVP** | — |
| Squash / drop selection | Tidy commits | Multi-select → "Squash 3 commits", "Drop 3 commits" [U] | **Post-MVP** | Built on interactive rebase |
| Cherry-pick | Copy commits | "Cherry pick commit", "Cherry pick 3 commits" [U] | **MVP (single)** | Multi Post-MVP |
| Revert | Undo published work | "Revert commit" [U] | **MVP** | — |
| Reset soft/mixed/hard | Move a branch | "Reset feature/greeting to this commit ›" submenu [U] | **MVP** | Show all three modes with consequences; hard reset confirmation |
| Edit commit message | Fix wording | "Edit commit message" (HEAD) [U] | **MVP (HEAD)** | Older commits via interactive rebase, Post-MVP |
| Set upstream | Track a remote | "Set Upstream" [U] | **MVP** | — |
| Worktrees | Parallel work on several branches | "Create worktree from…", section +, remove/lock [U][D] | **MVP** | Create/open/remove MVP; lock Later |
| Gitflow | Branching model | Preferences › Gitflow [D] | **Later** | — |
| AI branch explain / recompose | Summaries | "Explain Branch Changes (Preview)", "Recompose … with AI" [U] | **Later** | Opt-in only, if ever added |

## Remote workflows

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Fetch / Fetch All / auto-fetch | Stay current | Pull ▾ → Fetch All; interval 0–60 min; Auto-Prune [H] | **MVP** | — |
| Pull modes | Choose integration strategy | Pull ▾ default radio: FF-if-possible (merge fallback), FF-only, Rebase [H] | **MVP** | Name the fallback explicitly ("Merge if needed") |
| Push / first push | Publish | Toolbar Push; prompt to create remote branch [H][D] | **MVP** | — |
| Force push protection | Avoid overwriting remote work | Banner → Force Push → "destructive… Are you sure?" + "Don't ask again" [H] | **MVP (improved)** | Lease by default; list overwritten remote commits; no permanent opt-out |
| Ahead/behind | Know sync state | Left panel `2↑ 1↓`; diverged labels [H] | **MVP** | Always visible in the state strip |
| Remote management | Add/edit/remove remotes | Remote "+" → URL or provider forks [D] | **MVP** | — |
| Auth state & errors | Recover from auth failures | Credential prompts; REMOTE header warning on silent fetch failure [D] | **MVP** | Explicit offline/auth-error state with a next action |

## Merge conflicts

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Conflict state communication | Know a conflict exists | Amber WIP banner; "Merge/Rebase conflicts detected"; red toast [H] | **MVP** | Correct operation name and step (fixes F3) |
| Conflicted file list | Navigate conflicts | Conflicted/Resolved sections, "Mark All Resolved" [H] | **MVP** | — |
| Built-in resolver | Choose ours/theirs/both | A/B panes + Output, per-line/side checkboxes, conflict N of M, Reset, Save [H] | **MVP** | Name sides by branch in every operation, including rebase |
| Take current/incoming (file) | Resolve fast | File menu "Take current/incoming" [D] | **MVP** | — |
| Complete / abort / skip | Finish the operation | "Commit and Merge", "Continue Rebase", "Skip Commit", "Abort …" [H] | **MVP** | — |
| AI auto-resolve | Suggested resolution | "Auto-resolve with AI" [H] | **Later** | Opt-in suggestion only; never auto-applied |
| External merge tool | Use a preferred tool | Button in resolver [H] | **Post-MVP** | — |
| Conflict prevention (team) | Predict conflicts with teammates | Cloud org feature [D] | **Do not replicate** | Requires a proprietary cloud org |

## Stash

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Create stash | Park work | Toolbar Stash (WIP summary = message) [H] | **MVP** | Include untracked option |
| Apply / pop / delete / edit message | Resume or clean | Stash menu: Apply, Pop, Delete, Edit stash message, Hide [U] | **MVP** | Delete confirmation + undo |
| Inspect stash | See contents | Select stash row → files/diff [H] | **MVP** | — |
| Auto-stash on pull/checkout | Keep work safe | Automatic before merge; not auto-restored [H] | **MVP (improved)** | Auto-restore and announce (fixes F5) |
| Share stash as Cloud Patch | Share WIP | Stash menu [U] | **Do not replicate** | Proprietary service |

## Tags

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Create lightweight / annotated | Mark releases | "Create tag here", "Create annotated tag here" [U] | **MVP** | — |
| Push / delete local / delete remote | Share or clean up | "Delete v0.2.0 locally / from origin"; push tag [U][D] | **MVP** | — |
| Tag menu semantics | Act on a tag | Offers "Merge … into v0.2.0", "Fast-forward v0.2.0" [U] | **Do not replicate** | Misleading for tags (F9) |
| Annotate existing tag | Add notes | "Annotate v0.2.0" [U] | **Later** | — |

## History inspection

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Commit details | Understand a commit | SHA, message (summary + body), author, date, parents (clickable), file list with counts [H] | **MVP** | Add committer, refs, copy actions in the header |
| Commit diff | See the change | Click a file → diff takeover [H] | **MVP** | — |
| Copy SHA / branch name | Reference elsewhere | Menu items [U] | **MVP** | — |
| Compare commit vs working directory | Check drift | Menu item / ⌘-click WIP [U][D] | **Post-MVP** | — |

## Git hosting integration

| Feature | Category | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| GitHub connection (OAuth/token), SSH key upload | Hosting | Preferences › Integrations; "Generate SSH key and add to GitHub" [H] | **Post-MVP** | MVP relies on system credential helpers and ssh-agent |
| GHES / GitLab / Bitbucket / Azure DevOps | Hosting | Per-provider pages [H][D] | **Later** | GitHub first |
| PR list, detail, create, checkout, merge | Hosting | Left panel PRs; drag → "Start a pull request" [D] | **Post-MVP** | GitHub only first |
| CI status | Hosting | PR view build status → browser [D] | **Post-MVP** | — |
| Issues (GitHub/GitLab/Jira/Trello) | Hosting | Left panel ISSUES, branch from issue [D] | **Later** | — |
| Account sign-in required for features | GitKraken service | Browser sign-in at gitkraken.dev (12.3.0) [D] | **Do not replicate** | No account for local Git |
| Cloud Patches, Code Suggest, Insights, Team View | GitKraken service | Menus, left panel, dashboards [H][U][D] | **Do not replicate** | Proprietary cloud |

## Search, productivity, safety

| Feature | User goal | GitKraken interaction | Priority | Rationale |
|---|---|---|---|---|
| Command palette | Keyboard access | Actions/⌘P; fuzzy; nested argument step ("Switch Theme ×") [H] | **MVP (improved)** | Cover every Git action with arguments (fixes F7) |
| Keyboard navigation | Mouse-free | J/K/H/L, S/U, ⌘Enter, ⌘B, ⌘L, ⌘F, ⌘1–9 [D] | **MVP** | Customizable bindings Post-MVP |
| Undo / Redo | Recover mistakes | Toolbar, last action only; composite undo partial [H][D] | **MVP (improved)** | Reflog-backed undo of the last operation, fully; multi-step history Post-MVP |
| Confirmations | Prevent damage | Banners with explicit verbs [H] | **MVP** | Graded by risk (see YFORGE_PRODUCT_DIRECTION.md) |
| Toasts / notifications | Know outcomes | Bottom-left toasts (configurable location) [H] | **MVP** | Plus an operation state strip |

## Settings

| Category | GitKraken contents | Priority | YForge note |
|---|---|---|---|
| General | Auto-fetch, prune, default branch, commit limits, remember tabs, logging, credentials [H] | **MVP** | Subset |
| Profiles | Identity, integrations, tabs per profile (multiple = paid) [D] | **Post-MVP** | MVP: global + per-repo identity |
| SSH | Generate/browse key, use local agent [D] | **MVP** | Agent + key path; generation Post-MVP |
| Integrations | GitHub…Trello [H] | **Post-MVP** | GitHub first |
| AI | Provider/BYOK, prompts [D] | **Later** | Only if AI assists are ever added; opt-in |
| External tools | Merge/diff tool, editor, terminal, coding agent + status plugins [H] | **MVP (editor, terminal)** | Diff/merge tools Post-MVP |
| UI customization | Theme, notification location, date formats, toolbar labels, avatars, hover options, branch visibility [H] | **MVP (theme, density)** | Others Post-MVP |
| Commit signing | GPG/SSH signing defaults [D] | **Post-MVP** | — |
| Editor / in-app terminal | Fonts, EOL, wrap; terminal font [D] | **Later** | — |
| Notifications | Desktop + marketing notifications [D] | **MVP (in-app)** | No marketing notifications, ever |
| Keyboard shortcuts | Fixed list, no customization found [D] | **Post-MVP** | Customizable |
| Repo-specific | Encoding, Gitflow, hooks path, LFS, commit template, submodules, sparse [H][D] | **Post-MVP** | — |
| Experimental | Git executable toggle, previews [D] | **Do not replicate** | YForge always uses the system Git executable |

## Other notable features

| Feature | Evidence | Priority | Note |
|---|---|---|---|
| Submodules | [D] | **Post-MVP** | Section + update/init |
| Git LFS | [D] | **Post-MVP** | Toolbar only when enabled |
| Sparse checkout | [D] | **Later** | — |
| Hooks output surfaced | Activity log + error snackbox [D] | **MVP** | Commit failures must show hook output |
| Commit signature badges | GOODSIG… in commit panel [D] | **Post-MVP** | — |
| Multiple WIP nodes (per worktree) | 12.3.0 [D] | **MVP** | One Changes row per worktree lane |
| High-contrast themes | Light/Dark High Contrast [H] | **Post-MVP** | Tokens planned from the start |
