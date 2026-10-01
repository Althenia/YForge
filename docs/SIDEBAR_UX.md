# Sidebar UX v2 and defect fixes

Status: **approved 2026-09-30** (owner decision)

## Sidebar sections

Sections: Branches, Remotes, Tags, Stashes, Worktrees, Pull requests, Recovery. The working tree is reached from the state strip's Changes chip and the graph's working-tree row, not the sidebar.

- **Collapse:** each section header has a chevron; collapsed sections show header + count only. State persists per repository (localStorage, same store as graph prefs).
- **Group visibility:** children are drawn as a tree under their parent with indent guide lines and connectors (CSS lines, not glyphs): branch folder tree, remote branches under the remote name, worktrees under the repository. Tags and stashes stay flat lists.
- **Filter:** one input at the top of the sidebar. Case-insensitive substring across all sections; non-matching rows are hidden; section counts show `matched/total` while filtering; Escape clears the filter; the filter does not change selection.
- **Multi-select:** within a section, a plain click selects one row and sets the anchor, ctrl-click or cmd-click toggles a row, shift-click extends the range from the last anchor. Bulk actions appear in the section context menu when more than one row is selected: delete branches, delete tags, fetch remotes, drop stashes, remove worktrees. Single-row behavior is unchanged.

## Gravatar author badges

- Commit author avatar from `https://www.gravatar.com/avatar/<md5(lower(email))>?s=48&d=identicon`, shown in the commit inspector, the PR rows, and the activity drawer.
- Privacy: a Settings → Privacy toggle, default on. Only the MD5 hash of the email leaves the machine; no email is sent. Images are cached in memory for the session; failures fall back to the author's initial.

## Defect fixes

1. **Checkout a branch owned by a worktree.** `git switch` fails with exit 128 and `fatal: '<branch>' is already used by worktree at '<path>'`. The core classifies this into a new error kind `branch_in_worktree` carrying `branch` and `worktree_path`. The UI shows "web-model-sort is checked out in worktree <path>" with the action **Open worktree** (opens/focuses that worktree tab).
2. **Esc minimizes the app.** The Workspace Esc handler consumes the event (`preventDefault`) even when it closes nothing, so macOS "Esc → Mission Control" never fires from the app.

## Verification

- Sidebar: component tests for collapse persistence, filter hide/counts, ctrl/shift multi-select, bulk menu entries; tree connector rendering in the specimen.
- Gravatar: md5 computation test, toggle gating (no network call when off), fallback rendering.
- Checkout: core fixture test (branch checked out in a second worktree → `branch_in_worktree` with the path); UI action test.
- Esc: handler test asserting `defaultPrevented` after Esc with nothing open.
