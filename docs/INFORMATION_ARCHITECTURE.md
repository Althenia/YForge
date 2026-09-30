# YForge Information Architecture

Status: **approved 2026-09-29** (revision 2: standalone scope). This revises the hypothesis in the brief, based on the findings in [PRODUCT_ANALYSIS.md](PRODUCT_ANALYSIS.md).

## 1. Structure

```text
YForge
├── Launcher  (window with no repository, or a new tab)
│   ├── Open… · Clone… · Create…  (+ drop a folder, + `yforge <path>`)
│   └── Recent repositories: branch · ahead/behind · changes · worktree count · last opened
├── Repository tab  (one per repository; its worktrees grouped under it)
│   ├── Command bar
│   │   ├── Context: Repository ▾ › Worktree ▾ › Branch ▾
│   │   ├── Actions: Sync ▾ (Fetch · Pull · Push) · Branch · Stash ▾ · Undo
│   │   └── Palette · Search
│   ├── State strip  (always visible; see §3)
│   ├── Sidebar  (left; collapsible; filterable)
│   │   ├── Changes            (working tree summary → Changes inspector)
│   │   ├── Branches           (local; prefix folders; ahead/behind)
│   │   ├── Remotes            (per remote; remote branches; tracking)
│   │   ├── Tags
│   │   ├── Stashes            (all entries, including untracked stashes)
│   │   ├── Worktrees          (lanes: branch, ahead/behind vs target, changes)
│   │   ├── Submodules         (Post-MVP)
│   │   └── Pull requests      (Post-MVP; GitHub connected)
│   ├── Center view  (one at a time; breadcrumb + Esc returns to Graph)
│   │   ├── Graph              (default: working-tree row, commits, stashes, refs)
│   │   ├── Diff               (file diff for a working-tree, commit, or stash selection)
│   │   ├── Conflict resolver  (per conflicted file)
│   │   └── File history / Blame   (Post-MVP)
│   ├── Inspector  (right; context-sensitive)
│   │   ├── Changes + commit composer
│   │   ├── Commit
│   │   ├── Multiple commits
│   │   ├── Ref (branch · remote branch · tag · stash · worktree)
│   │   └── Operation (merge · rebase · cherry-pick · revert in progress)
│   └── Activity drawer  (bottom; operation log, Git commands and output, Undo)
├── Command palette  (overlay; actions + navigation + settings)
├── Dialogs & popovers
│   (clone · create · branch · rename · delete · reset · tag · stash · remote ·
│    push/force push · credentials · SSH passphrase · host key · error details)
└── Settings  (own view; searchable; scope: All repositories | This repository)
    ├── General · Git · Accounts & authentication · Appearance · Diff & merge
    ├── Keyboard (Post-MVP customization) · Integrations (GitHub, Post-MVP) · Advanced
    └── Repository: identity override · remotes · pull mode · hooks · ignore (Post-MVP)
```

### Changes from the hypothesis

| Hypothesis | Change | Reason |
|---|---|---|
| Repository Switcher as a separate top-level node | A Launcher plus repository tabs, with worktrees grouped per repository | Tabs were effective in GitKraken [H]; worktree lanes need grouping per repository (P7) |
| Sidebar sections Workspace · Branches · Remotes · Tags · Stashes · Worktrees | Added **Changes** as the first section; "Workspace" removed | "Workspace" is ambiguous. Changes gives a permanent entry point to staging (F1) |
| Working Tree / Commit Panel as a bottom dock | Changes live in the **right inspector** | The dock would take graph height on 720–900px screens. GitKraken's right-side composer beside the graph kept context [H] |
| Diff Viewer and Conflict Resolver as separate top-level nodes | They are **center views** inside the repository tab | Keeps the state strip and inspector visible during review |
| No state or operation surface | A **state strip** plus an **Activity drawer** | Core UX principle (§3); undo and command transparency |

## 2. Window anatomy (1440×900 primary)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐ 40  Tab bar
│ ● ● ●  [sample ▾ 2 worktrees] [other-repo]  +                                ⚙  ◐       │
├──────────────────────────────────────────────────────────────────────────────────────────┤ 48  Command bar
│ sample ▾ › main ▾ › feature/greeting ▾ │ ⇅ Sync ▾ │ ⑂ Branch │ ▣ Stash ▾ │ ↶ Undo │ ⌘K  ⌕  │
├──────────────────────────────────────────────────────────────────────────────────────────┤ 36  State strip
│ ◉ HEAD feature/greeting → origin/feature/greeting ↑2 ↓0 │ ✎ 1 +1 │ ✓ fetched 2m │ ⑂ 2 worktrees    │
├───────────────┬───────────────────────────────────────────────────────┬──────────────────┤
│ Sidebar 248   │ Graph (fills)                                         │ Inspector 372    │
│ ▸ Changes  2  │ REFS            GRAPH   MESSAGE            AUTHOR  AGE│ Changes on       │
│ ▾ Branches 7  │ ◌ Changes: 1 modified, 1 new ·························│ feature/greeting │
│   main  ↑3    │ ✓feature/greeting ●     Export shout helper    YL  2m │ Unstaged (2)     │
│   feature/    │                   ●     Add shout helper       YL  3m │ Staged (0)       │
│    greeting ✓ │ main ⌂☁           ◆     Merge remote-tracking… AP  1h │ ─ Summary ────── │
│ ▸ Remotes  5  │ …                                                     │ [Commit ▾]       │
│ ▸ Tags     3  │                                                       │                  │
│ ▸ Stashes  2  │                                                       │                  │
│ ▸ Worktrees 2 │                                                       │                  │
├───────────────┴───────────────────────────────────────────────────────┴──────────────────┤
│ Activity ▴  last: Commit "Export shout helper" · git commit -m … · 0.2s        Undo      │ 30  Activity bar
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Height budget at 900px:

- Chrome: 40 (tab bar) + 48 (command bar) + 36 (state strip) + 30 (activity bar) = 154px.
- Graph panel: 746px; after its border and 30px header, the graph body is about 712px, 25 rows at 28px.

At 720px the graph body keeps about 532px, 19 rows.

## 3. State strip: answering the seven questions

| # | Question | Segment | Shows | Interaction |
|---|---|---|---|---|
| 1 | Where is HEAD? | HEAD junction | `◉ HEAD` + ref, or `◉ HEAD detached at 1a2b3c4` (warning style) | Click: reveal HEAD in the graph |
| 2 | Which branch? | Branch → upstream | `feature/greeting → origin/feature/greeting` or "no upstream" | Click: branch picker; action "Set upstream…" |
| 3 | Ahead/behind? | Sync | `↑2 ↓0`; diverged shows both + "diverged" | Click: Sync menu with the recommended action |
| 4 | Local changes? | Changes | `✎1 +1 −0 !0` with letters in tooltips | Click: open the Changes inspector |
| 5 | Commits around me? | (Graph) | Graph auto-scrolls to HEAD on open and on checkout | "Reveal HEAD" (H) |
| 6 | Refs on commits? | (Graph Branch / Tag column) | Ref labels + `+N` popover | — |
| 7 | What is Git doing? | Operation | Idle: hidden. Active: `Rebasing feature/greeting onto main · 1/1 · 1 conflict [Resolve] [Continue] [Skip] [Abort]`; network: `Fetching origin…`; errors: `Push rejected [Details]` | Buttons act; details open Activity |
| + | Freshness / network | Remote status | `✓ fetched 2m`, `⚠ offline`, `⚠ auth failed for origin [Fix]` | Click: fetch now / credentials |
| + | Parallel work | Worktrees | `⑂ 2 worktrees · 1 with changes` | Click: Worktrees section |

## 4. Size classes and reflow

| Class | Width | Sidebar | Inspector | Graph columns | Reflow pattern |
|---|---|---|---|---|---|
| Large | ≥ 1440 | 248 expanded | 372 docked | refs, graph, message, author, age | — |
| Medium | 1280–1439 | 220 expanded | 340 docked | author initials only | Toolbar labels hidden by priority (8) |
| Compact | 1024–1279 | 48 icon rail (expand as overlay) | 320 docked | refs, graph, message | Rail to drawer (3) |
| Narrow | 960–1023 (minimum window) | rail | overlay drawer over the graph | refs, graph, message | Column drop (2) |

Height rules:

- **Below 800:** the commit composer collapses to summary + "Description ▸".
- **Below 700:** the Activity bar auto-hides.
- **Staging lists:** always keep at least 4 visible rows each, and scroll independently.

## 5. View and selection model

- **Selection is the only navigation state inside a tab.** The inspector shows the selection:
  - the working-tree row → Changes;
  - a commit → Commit;
  - 2+ commits → Multiple commits;
  - a ref label or a stash row → Ref.
- **Center views stack on the Graph.** Diff and Resolver replace the graph with a breadcrumb (`Graph › f86d53 › src/util.js`); Esc or the breadcrumb returns to the graph at the same scroll position and selection.
- **Operations override the inspector header** while in progress. The state strip always carries the operation actions, so the user never needs to find the right panel to continue or abort.
- **Focus order:** command bar → state strip → sidebar → graph → inspector → activity. F6 cycles regions, and J/K moves within the graph.

## 6. Object model: where each object lives and what acts on it

| Object | Appears in | Primary actions | Surfaces |
|---|---|---|---|
| Working tree | Graph top row, sidebar Changes, state strip | Stage/unstage file · hunk · line, discard, stash, commit | Inspector, diff, menu, palette, keys S/U/⌘↵ |
| Commit | Graph row, search | Checkout (detached), branch here, cherry-pick, revert, reset ▸, tag here, copy SHA | Menu, palette, inspector header |
| Commit range | Multi-select | Cherry-pick N; squash/drop N (Post-MVP); compare | Menu, palette, multi inspector |
| Local branch | Graph ref label, sidebar | Checkout, merge into current, rebase onto, push, pull, rename, delete, set upstream, create worktree | Menu, drag-drop, palette |
| Remote branch | Graph ref label, sidebar Remotes | Checkout as tracking branch, merge, rebase onto, delete from remote | Menu, drag-drop, palette |
| Tag | Graph ref label, sidebar | Checkout (detached, guarded), push, delete local/remote, copy | Menu, palette |
| Stash | Graph row, sidebar | Apply, pop, drop, rename, view diff, branch from stash (Post-MVP) | Menu, palette, inspector |
| Worktree | Sidebar lane, tab group | Open, integrate (rebase + ff-only), remove, open in terminal | Menu, palette, inspector |
| Remote | Sidebar | Fetch, add, edit URL, remove, prune | Menu, settings, palette |
| Operation | State strip, inspector | Resolve, continue, skip, abort | Strip buttons, palette |

## 7. Command surface parity

Every action reachable by pointer is also reachable by keyboard.

| Action | Toolbar | Context menu | Drag-drop | Palette | Shortcut |
|---|---|---|---|---|---|
| Fetch / Pull / Push | Sync ▾ | Branch menu | Branch → remote branch (push) | ✓ | ⌘⇧F / ⌘⇧L / ⌘⇧P |
| Create branch | Branch | Commit/branch menu | — | ✓ | ⌘B |
| Checkout | Branch ▾ picker | ✓ | — | ✓ (with picker) | Enter on a ref |
| Merge / Rebase / Fast-forward | — | ✓ | Branch → branch | ✓ (with picker) | — |
| Cherry-pick / Revert / Reset | — | ✓ | — | ✓ | — |
| Stash / Pop | Stash ▾ | Working tree, stash | — | ✓ | ⌘⇧S (stash all) |
| Stage / Unstage | — | File menu | — | ✓ | S / U |
| Commit | Inspector | — | — | ✓ | ⌘↵ |
| Undo | Undo | — | — | ✓ | ⌘Z |
| Search commits | Search | — | — | ✓ | ⌘F |
| Palette | ⌘K | — | — | — | ⌘K |

The ⇧ combinations above are proposals. Shortcut defaults are finalized with keyboard customization.

## 8. Terminology

| Term | Meaning in YForge | Avoid |
|---|---|---|
| Changes | The working tree and index (unstaged + staged + untracked + conflicted) | "WIP" in the UI |
| Sync | Fetch / Pull / Push as one control | "Update" |
| Pull: fast-forward, merge if needed | Git `pull` with merge fallback | "fast-forward if possible" |
| Force push (with lease) | `push --force-with-lease` | Bare "Force Push" |
| Current / Incoming | Conflict sides, always followed by the branch name and role | "A/B" alone, "ours/theirs" alone |
| Operation | A merge, rebase, cherry-pick, revert, or bisect in progress | "Conflict detected" as a state name |
| Worktree | A linked working directory with its own branch | "Workspace" |
