# YForge — Product Analysis (Phases 1–2)

Status: approved 2026-09-29 (revision 2: standalone scope) · Date: 2026-09-29 · Subject: GitKraken Desktop 12.5.0 (Electron 41.3.0) on macOS

This document decomposes GitKraken into its product map, strengths, and friction so YForge can be designed without repeating the investigation. Feature-level detail lives in [GITKRAKEN_FEATURE_MAP.md](GITKRAKEN_FEATURE_MAP.md); interaction patterns in [UX_PATTERNS.md](UX_PATTERNS.md); raw evidence in [research/](research/).

## 1. Method and evidence

| Label | Meaning |
|---|---|
| **[H]** | Verified hands-on in GitKraken 12.5.0 against sandbox repositories |
| **[U]** | Captured by the user in the live app (native context menus, drag-drop menu, empty repository) |
| **[D]** | Official GitKraken documentation, release notes, or pricing page |
| **[I]** | Inference from the above; stated as such |

- **Sandbox:** `/tmp/yforge-gk-lab`, which contains:
  - a bare "remote";
  - a working clone with 14 commits across 6 branches;
  - a no-ff merge;
  - lightweight, annotated, and local-only tags;
  - two stashes, one of them `-u`;
  - a linked worktree;
  - a second clone that pushed upstream changes, which created divergence, a remote-only branch, and two engineered conflicts (pull and rebase);
  - a separate repository and an empty repository.

  No real repository was modified.
- **Flows exercised [H]:**
  - open;
  - graph inspection;
  - commit selection and details;
  - hunk, inline, and split diff;
  - file history;
  - hunk staging;
  - commit;
  - Fetch All;
  - pull into a merge conflict, then resolve and commit;
  - auto-stash and pop;
  - rebase conflict, then continue;
  - force push, including both confirmations;
  - inline branch creation, checkout by double-click, and undo;
  - one-click stash and pop;
  - search;
  - command palette;
  - theme switch (light and back to dark);
  - Preferences (General, UI Customization, Integrations, External Tools);
  - Repository Management;
  - the Clone and Init dialogs;
  - Launchpad;
  - the Agents view;
  - detached HEAD.
- **Tool limits:**
  - Native macOS context menus and drag-drop menus close when focus returns to the agent, so the user captured them [U].
  - The native folder picker could not be driven.
  - Hosted pull-request flows were not executed. They need a hosting remote, and the account's GitHub data is private, so they are documented from docs [D].
- **Plan context:** the app ran signed in on a Pro plan. Gated features were visible, and plan gates come from [D].

## 2. Product map

```text
GitKraken Desktop window
├── Tab strip: Launchpad (pinned) · repository tabs · New Tab (+) · tab list · notifications · Preferences · profile
├── New Tab (launcher): Open · Clone · Create · repo search · Recent list · integration/cross-sell column
├── Repository Management (folder icon): Browse · Clone · Init · New Workspace · Integrations · groups (Open, Favorites, Recent, All) with WIP summaries
│   ├── Clone modal: URL tab + one tab per hosting provider (search remote repos), shallow, sparse
│   └── Init modal: local or provider-hosted, default branch, .gitignore/license templates, LFS
├── Repository workspace
│   ├── Toolbar: repository ▾ › branch ▾ · Undo · Redo · Pull ▾ · Push · Branch · Stash · Pop · Terminal · Actions (palette) · Search
│   ├── Left panel [List | Agents]: filter · LOCAL · REMOTE · WORKTREES · STASHES · CLOUD PATCHES · PULL REQUESTS · ISSUES · TEAMS · TAGS · (SUBMODULES, LFS, GITFLOW when enabled)
│   ├── Commit graph: BRANCH/TAG · GRAPH · COMMIT MESSAGE (+ Author, Date/Time, SHA optional) · WIP node · stash rows · date separators
│   ├── Right panel (context-sensitive): Commit panel (WIP) · Commit details · Multi-commit · Conflict panel (merge/rebase)
│   ├── Center takeovers: Diff/File view · File History · Blame · Merge conflict tool · Interactive rebase [D]
│   └── Status bar: integration picker · activity log · shortcuts · what's new · zoom · support · plan · version
├── Command palette (Actions): commands with nested argument steps
├── Preferences (full-page): global categories + repo-specific categories
└── Launchpad (GitKraken service): PRs, issues, WIPs across a cloud workspace
```

### What the main workspace shows without navigation [H]

| Question | How GitKraken answers it | Gap |
|---|---|---|
| Where is HEAD? | ✓ on the checked-out ref label; highlighted left-panel row | Detached HEAD shows only a "HEAD" label; no warning seen [H] |
| Which branch am I on? | Toolbar breadcrumb "branch: feature/greeting" | — |
| Ahead/behind? | Left-panel suffix `2↑ 1↓`; separate local/remote labels when diverged | Not in the toolbar; needs LOCAL expanded |
| Local changes? | WIP row counts `✎2 +1 −1`; commit-details banner "4 file changes in working directory" | WIP row vanishes when clean |
| Commits around me? | Graph centered on history, newest first; date separators | — |
| Refs on commits? | Aligned BRANCH/TAG column, lane-colored chips, laptop/cloud glyphs, `+N` overflow chip | `+N` hides tags such as `v0.3.0-rc1` |
| What is Git doing? | WIP row turns amber ("A file conflict was found…"); panel header "Merge/Rebase conflicts detected"; footer buttons | Rebase is described as a "merge" in the WIP banner; there's no step progress in the graph |

## 3. Core Git vs hosting vs GitKraken services

| Category | Examples in GitKraken | YForge stance |
|---|---|---|
| **Core local Git** | Graph, staging (file/hunk/line), commit/amend, branches, merge/rebase/cherry-pick/revert/reset, conflicts, stash, tags, remotes, fetch/pull/push, worktrees, submodules, LFS, hooks, signing, undo, blame/history | Own it completely; no account, no network dependency |
| **Hosting-provider features** | OAuth/PAT connections, SSH key upload, remote repo search for clone, PRs (list/detail/create/merge), issues (GitHub/GitLab/Jira/Trello), CI status | Optional adapters, GitHub first (post-MVP); never required for local work |
| **GitKraken services** | Account sign-in, Launchpad, Cloud Workspaces, Cloud Patches, Code Suggest, GitKraken AI credits, Team View, Conflict Prevention, Insights, org/team seats, GitLens bundle | Do not replicate; YForge stays standalone and local-first |

Evidence:

- Plan gating on the free Community tier, which covers local repos and public remotes [D pricing]. These features are "Public Repos Only":
  - merge conflict tool;
  - code editor;
  - Gitflow, LFS, and worktrees;
  - file history and blame;
  - PRs;
  - hide and solo;
  - interactive rebase;
  - undo;
  - agent sessions.
- Private remotes need Pro or higher [D].
- Sign-in moved to the browser at gitkraken.dev in 12.3.0 [D].

## 4. GitKraken strengths (and why they work)

1. **The graph is the navigation surface.** Every Git object is a row or label you can act on in place:
   - commits;
   - branches, local and remote;
   - tags;
   - stashes;
   - the working tree.

   Users never translate between a list and a location, and selection drives the right panel [H].
2. **Refs aligned to rows in a dedicated column.** Branch and tag chips sit in their own column, colored to their lane, with a laptop (local) or cloud (remote) glyph, and they collapse into one chip when local and remote match. Divergence shows as two chips at different rows. That makes "am I pushed?" a visual comparison, not a query [H].
3. **The WIP node puts the working tree inside history.** A dashed node above HEAD, with an inline summary field and change counts, teaches that uncommitted work sits on top of HEAD [H].
4. **One context-sensitive inspector.** The right panel switches between four modes, so details always appear in the same place:
   - staging and the commit composer (WIP);
   - commit details;
   - multi-commit actions;
   - conflict resolution.

   [H]
5. **Menu items name the source and target.** For example, "Merge feature/greeting into main", "Rebase feature/greeting onto origin/feature/remote-only", and "Reset feature/greeting to this commit ›". Users confirm intent while choosing, which prevents direction mistakes [U].
6. **Drag-and-drop yields a short, explicit menu.** Dropping a branch on another offers exactly:
   - Fast-forward;
   - Merge;
   - Rebase;
   - Interactive Rebase;
   - Reset.

   This compresses a two-ref operation into one gesture [U].
7. **Hover reveals meaning without clicks:**
   - a ghost branch label for the nearest containing branch;
   - hovering a branch dims unrelated commit rows;
   - hover "Stage File" and "Unstage File" buttons;
   - full-path tooltips.

   [H]
8. **In-place creation.** The toolbar Branch button opens an inline name field at the HEAD row, and Enter creates and checks out the branch [H].
9. **One-click stash and pop.** Stash uses the WIP summary as its message, and Pop restores the newest stash [H].
10. **Self-contained conflict resolution:**
    - A (current) and B (incoming) side by side, over an Output pane;
    - per-line and per-side checkboxes;
    - "conflict 1 of N" navigation;
    - Reset and Save;
    - operation-specific footers: "Commit and Merge", "Continue Rebase", "Skip Commit", "Abort".

    No external tool is needed [H].
11. **Search dims instead of hiding.** The "find commit" overlay shows "N of M" with ↑/↓ and dims non-matches, so topology stays readable [H].
12. **Multi-selection unlocks batch verbs.**
    - A contiguous range on the checked-out branch offers:
      - "Squash 3 commits";
      - "Drop 3 commits";
      - "Interactive Rebase 2 children of …";
      - "Cherry pick 3 commits".
    - Three selected local branches offer:
      - "Delete 3 local branches";
      - "Hide 3 branches";
      - "Solo 3 branches".

    [U]
13. **Graded protection for force push.** The first banner explains the state and offers Pull / Force Push / Cancel. A second confirmation states "destructive action and cannot be undone" [H].
14. **Multi-repository awareness.** Repository Management lists every repo with branch, ahead, and change-count chips ("WIP summary") [H].
15. **Accessibility options:**
    - Light, Dark, and High Contrast variants of each;
    - date-format previews;
    - an avatars-vs-initials option;
    - toolbar label toggles;
    - zoom 100–200%.

    [H][D]

## 5. GitKraken friction

### Observed (reproducible, with evidence)

| # | Friction | Evidence | Consequence |
|---|---|---|---|
| F1 | The WIP row disappears when the working tree is clean, so the commit panel has no entry point; the user could not find it | [H][U] | Beginners lose the staging area; the layout jumps as changes appear |
| F2 | An empty repository cannot open: "must have an initial commit… make a commit for you? Initialize / Cancel" | [U] | New projects must accept a GitKraken-authored commit |
| F3 | Rebase conflicts label sides "Commit 62db91 on" with blank branch names; the WIP banner says "merge into HEAD" during a rebase; ours/theirs are never explained | [H] | The most error-prone Git moment has the least orientation |
| F4 | Pushing a rebased branch shows raw refs (`'refs/heads/…' is behind 'refs/remotes/…'`), recommends Pull (wrong after an intentional rebase), and gives Force Push equal weight; no lease option, no list of remote commits to be overwritten; "Don't ask again" removes the guard permanently | [H] | Duplicate-commit merges or silent remote overwrite |
| F5 | Pull auto-stashes local changes but does not restore them after the conflict is resolved; the stash message then fills the commit summary | [H] | "Where did my changes go?"; wrong commit messages |
| F6 | A CLI-created `git stash push -u` entry never appears in the stash list or graph (Git had 2 stashes; GitKraken showed 1) | [H] | Hidden work; users drop or forget stashes |
| F7 | The command palette has no merge, rebase, cherry-pick, reset, revert, or delete; "branch" finds only Rename/Create | [H] | Keyboard users must fall back to the mouse for history operations |
| F8 | Menus are long and mixed: a branch label menu has ~27 items combining Git verbs, AI previews, Cloud Patch sharing, patch files, and view options (Pin/Solo) | [U] | Scanning cost; destructive items sit beside view toggles |
| F9 | The tag menu offers branch verbs: "Merge feature/greeting into v0.2.0", "Fast-forward v0.2.0 to feature/greeting" | [U] | Misleading Git semantics |
| F10 | Detached HEAD is signaled only by a "HEAD" label and breadcrumb; no warning or "create branch here" prompt appeared in the tested states | [H] | Commits made while detached are easy to lose |
| F11 | At 968×675 the staging lists show about one row each; there is no scroll feedback, and the right panel keeps a fixed width | [H] | Staging is impractical on small laptop windows |
| F12 | GitKraken services are interleaved with core Git: pinned Launchpad tab, CLOUD PATCHES section, AI buttons in the commit composer, "Share … as Cloud Patch" in menus, GitLens upsell, New Tab cross-sell, plan badge | [H][U] | Visual noise; implies cloud dependence for local work |
| F13 | Undo is one step deep and composite: after "create branch" (create + checkout), Undo reverted only the checkout | [H][D] | Undo is unpredictable for multi-step actions |
| F14 | "Pull (fast-forward if possible)" silently falls back to a merge; Reset hides soft/mixed/hard behind a submenu; "Viewing 13" has no explanation | [H][U] | Jargon and hidden behavior |
| F15 | The `+N` overflow chip hides co-located refs, including release tags | [H] | Tags at HEAD or release points are invisible without hover |
| F16 | Many core features are gated to "Public Repos Only" on the free plan | [D] | Local-first users hit paywalls for basic Git safety features such as undo |

### Subjective (design preference, not defects)

- Uppercase section headers and dense chrome feel heavy next to the graph.
- The illustration and mascot style clashes with the tool tone. It is also proprietary and must not be reused.
- Purple AI buttons draw the eye away from the primary commit action.

## 6. Positioning note

YForge is a **standalone** product. This analysis informs an independent Git client and assumes no integration with, or dependency on, any other product.

GitKraken's own coding-agent features are recorded as competitive context only [H]:

- an Agents view with worktree cards and "Start Claude Code";
- agent status plugins for Claude Code, Codex, Copilot CLI, and OpenCode;
- per-worktree WIP nodes.

YForge keeps the underlying Git capability, worktrees as first-class lanes. It adds no agent tooling.

## 7. Evidence files

- [research/GITKRAKEN_HANDS_ON_LOG.md](research/GITKRAKEN_HANDS_ON_LOG.md): observation log for every hands-on and user-captured state.
- [research/SOURCE_NOTES.md](research/SOURCE_NOTES.md): condensed official-docs findings, with sources.
