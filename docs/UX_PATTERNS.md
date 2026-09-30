# UX Pattern Inventory

Recurring interaction patterns in GitKraken 12.5.0, with their trade-offs and the direction YForge takes for each.

Evidence labels:

- [H]: hands-on.
- [U]: captured by the user.
- [D]: official docs.

Friction IDs (F1–F16) refer to [PRODUCT_ANALYSIS.md](PRODUCT_ANALYSIS.md#5-gitkraken-friction).

---

### 1. Graph-centric navigation

- **Where used:** Main workspace [H].
- **Problem it solves:** Git is a DAG, and a list-based client hides topology. The graph lets users read and act on history in place.
- **Strengths:**
  - Commits, refs, stashes, and the working tree share one coordinate system.
  - Selection drives every other panel.
- **Weaknesses:**
  - Large histories need visibility controls, and hide/solo is gated to paid plans for private repos [D].
  - A canvas-drawn graph is hard to reach with assistive technology.
- **YForge direction:**
  - Keep the graph as the primary surface.
  - Virtualize the full history.
  - Give the graph an accessible row model: each row is a focusable list item with its refs, SHA, message, and author exposed as text.

### 2. Aligned ref-label column

- **Where used:** BRANCH/TAG column [H].
- **Problem it solves:** Shows which refs point where without hovering, and whether local and remote differ.
- **Strengths:**
  - Lane-colored chips.
  - Laptop and cloud glyphs.
  - Local and remote merge into one chip when equal.
  - Divergence reads at a glance.
- **Weaknesses:**
  - The `+N` overflow hides tags (F15).
  - Truncated names ("feature/remot…") need hover to read.
- **YForge direction:**
  - Keep the column, with a `+N` popover listing every ref.
  - Tags never collapse behind branches.
  - Ref names use the mono type role.
  - Truncation keeps the tail (`…/remote-only`), because the tail is the distinguishing part.

### 3. WIP node

- **Where used:** Top graph row [H].
- **Problem it solves:** Places uncommitted work on top of HEAD and gives quick access to staging.
- **Strengths:**
  - Change counts inline (`✎2 +1 −1`).
  - A stash-name field.
  - Explains the working-tree mental model.
- **Weaknesses:**
  - The row disappears when the tree is clean, leaving no path to the composer (F1).
- **YForge direction:**
  - The working-tree row is always present, with states "Working tree clean", "N changes", and "Conflicts: N".
  - The Changes panel is reachable from the sidebar and with a shortcut.

### 4. Context-sensitive inspector

- **Where used:** Right panel [H]. It shows one of:
  - WIP (staging + commit composer);
  - commit details;
  - multi-commit actions;
  - conflict panel.
- **Problem it solves:** One predictable location for "details of the selection".
- **Strengths:**
  - Mode headers such as "Merge conflicts detected".
  - Operation-specific footer buttons.
- **Weaknesses:**
  - Fixed width.
  - Staging lists collapse to about one row at small heights (F11).
  - AI buttons compete with the primary action.
- **YForge direction:**
  - Keep a single inspector with a resizable width.
  - Minimum heights for lists.
  - The primary action stays pinned.
  - No AI buttons compete with the primary action.

### 5. Center takeover views

- **Where used:** The following replace the graph area [H]:
  - diff and file view;
  - file history;
  - merge conflict tool;
  - Preferences (full window).
- **Problem it solves:** Gives dense content maximum width.
- **Strengths:**
  - Focus.
  - Close (×) returns to the graph.
- **Weaknesses:**
  - The graph context disappears while reviewing.
  - The left panel collapses to an icon rail.
  - Search is disabled during diff.
- **YForge direction:**
  - The diff opens in the center with a persistent breadcrumb ("Graph › commit f86d53 › src/util.js") and ⎋ to return.
  - The state strip stays visible above every takeover.
  - Settings open as their own view, and the repository context remains in the tab.

### 6. Target-named context menus

- **Where used:** Right-click on the following [U]:
  - commits;
  - branch labels;
  - remote branches;
  - tags;
  - stashes;
  - files;
  - branch folders;
  - multi-selection.
- **Problem it solves:** Offers every applicable verb for the object under the pointer.
- **Strengths:**
  - Items name source and target ("Merge feature/greeting into main").
  - Separators group related verbs.
  - Batch items count the selection ("Squash 3 commits").
- **Weaknesses:**
  - Up to ~27 items that mix Git, AI previews, cloud sharing, patches, and view options (F8).
  - Branch verbs appear on tags (F9).
  - Native menus can't be tested or themed.
- **YForge direction:** Owned, themed menus built on a native-accessible primitive, grouped in a fixed order:
  1. Navigate.
  2. Integrate.
  3. Create.
  4. Rewrite (⚠).
  5. Delete (⚠).
  6. Copy.
  7. View.

  Each menu shows at most about 12 items at its top level, with the rest in labeled submenus. Every item is also reachable from the palette.

### 7. Drag-and-drop between refs

- **Where used:** Drag a branch label onto another ref [U].
- **Problem it solves:** Two-ref operations (merge, rebase, fast-forward, reset, PR) in one gesture.
- **Strengths:**
  - A short, explicit menu that names both refs.
- **Weaknesses:**
  - Not discoverable.
  - No keyboard equivalent in the palette (F7).
  - Nothing previews the result.
- **YForge direction:**
  - Keep it.
  - While dragging, valid drop targets highlight and a preview line shows the proposed result ("main ← 3 commits (fast-forward)").
  - The palette offers the same verbs as "Merge… / Rebase onto…" with ref pickers.

### 8. Hover affordances

- **Where used:** [H]
  - ghost branch label;
  - branch-hover row dimming;
  - hover Stage/Unstage buttons;
  - full-path tooltips;
  - eye toggle on left-panel rows.
- **Problem it solves:** Shows information and actions without clicking.
- **Strengths:**
  - Fast for mouse users.
  - Keeps rows clean.
- **Weaknesses:**
  - Hover-only actions are invisible to keyboard users and on touch.
  - Discoverability depends on exploration.
- **YForge direction:**
  - Every hover action also has a visible focus equivalent: row action buttons appear on focus and selection, not only on hover.
  - Hover styling is limited to hover-capable pointers.

### 9. Inline creation

- **Where used:** The Branch button opens an inline name field at the HEAD row [H].
- **Problem it solves:** Creates a ref exactly where it will live.
- **Strengths:**
  - Zero dialogs.
  - Enter to confirm.
- **Weaknesses:**
  - Always checks out, with no option.
  - Undo only reverts the checkout (F13).
- **YForge direction:**
  - Keep inline creation.
  - Show a "☐ Check out after creating" toggle, defaulting to on.
  - Undo reverses the whole operation.

### 10. Labeled toolbar with split default

- **Where used:** [H]
  - Undo, Redo, Pull ▾ (default mode set with a radio), Push, Branch, Stash, Pop, Terminal;
  - the tooltip names the current mode.
- **Problem it solves:** One-click access to common operations.
- **Strengths:**
  - Icon + label.
  - Disabled states are clear.
  - The default pull mode is user-chosen.
- **Weaknesses:**
  - Choosing a menu item's text runs it, while its radio circle changes the default. These two targets are easy to confuse.
  - "Fast-forward if possible" hides the merge fallback (F14).
- **YForge direction:** A Sync split button:
  - the primary action is context-aware: Fetch, then Pull when behind, then Push when ahead;
  - an explicit mode menu;
  - defaults set in Settings, not in the action menu.

### 11. Command palette with argument steps

- **Where used:** Actions button [H]. Example: "Switch Theme" becomes a chip, then the argument search runs.
- **Problem it solves:** Keyboard access to commands.
- **Strengths:**
  - Fuzzy subsequence matching with highlighted letters.
  - Nested argument selection.
  - Esc clears the query, then closes the palette.
- **Weaknesses:**
  - Missing all history operations (F7).
  - No recent or contextual commands.
- **YForge direction:**
  - The palette is a complete action surface. It covers:
    - every Git verb, with ref and commit pickers as argument steps;
    - navigation (go to branch, commit, file, or repo);
    - settings.
  - Recent commands and selection-aware suggestions appear first.

### 12. Search overlay that dims

- **Where used:** Find commit [H].
- **Problem it solves:** Finds commits without losing topology.
- **Strengths:**
  - "1 of 3" count with ↑↓.
  - Non-matches dim.
  - The first match is auto-selected.
- **Weaknesses:**
  - Covers only message, SHA, and author [D].
  - Search is disabled in diff view.
- **YForge direction:**
  - Keep the dimming model.
  - Add scoped prefixes: `author:`, `path:`, `ref:`, `sha:`, `after:`.
  - Search works from any view.

### 13. Accordion sidebar with counts and prefix folders

- **Where used:** Left panel [H].
- **Problem it solves:** Organizes many refs.
- **Strengths:**
  - Counts per section.
  - `feature/` folders.
  - The checked-out branch is highlighted.
  - `2↑ 1↓` suffixes.
- **Weaknesses:**
  - An expanded section pushes the others to the bottom edge.
  - Ahead/behind is visible only when LOCAL is expanded.
  - GitKraken service sections (Cloud Patches, Teams) take space.
- **YForge direction:**
  - Collapsible sections with persistent state.
  - Only core sections by default.
  - Ahead/behind is duplicated in the state strip.

### 14. Banners

- **Where used:** [H]
  - top drop-down confirmations (push rejected, force push);
  - the WIP-row conflict banner;
  - the "N file changes in working directory [View Changes]" banner in commit details.
- **Problem it solves:** Communicates blocking state near where it matters.
- **Strengths:**
  - In-context.
  - Actions are inline.
- **Weaknesses:**
  - Raw ref names.
  - Wrong recommended action after a rebase (F4).
  - The operation is named incorrectly during a rebase (F3).
- **YForge direction:** One persistent operation banner inside the state strip. It shows:
  - operation;
  - step;
  - conflicts;
  - the next action;
  - plain-language refs.

  Confirmations are modal dialogs for destructive actions and inline banners for reversible ones.

### 15. Toasts

- **Where used:** Bottom-left toasts, such as "Pull Failed / Has conflicts" (the location is configurable) [H].
- **Problem it solves:** Reports outcomes without blocking.
- **Strengths:**
  - Non-modal.
  - Dismissible.
- **Weaknesses:**
  - Transient text may vanish before it's read.
  - Success is silent for some operations (force push showed no confirmation) [H].
- **YForge direction:**
  - Toasts for outcomes, each with an action (Undo, Show details).
  - Every toast is also recorded in the Activity log.
  - Failures persist until dismissed.

### 16. Operation-specific footers

- **Where used:** Commit panel during a merge or rebase [H]:
  - "Commit and Merge / Abort Merge";
  - "Skip Commit / Abort Rebase";
  - "Continue Rebase".
- **Problem it solves:** Makes the next step obvious.
- **Strengths:**
  - The labels change with the state.
- **Weaknesses:**
  - "No Changes to Merge" (disabled) doesn't explain why it's disabled.
  - Actions live only in the right panel.
- **YForge direction:**
  - The same actions appear in the operation banner and the palette.
  - Disabled buttons carry a reason ("Resolve 1 conflict first").

### 17. Graded destructive confirmations

- **Where used:** Force push: banner, then "destructive action and cannot be undone. Are you sure?" with "Don't ask again" [H].
- **Problem it solves:** Prevents remote overwrite.
- **Strengths:**
  - Two steps.
  - Explicit wording.
- **Weaknesses:**
  - No lease.
  - No preview of what is lost.
  - A permanent opt-out.
- **YForge direction:** Risk tiers.
  - **Reversible:** no confirmation, Undo in the toast.
  - **Recoverable:** one confirmation that names what changes.
  - **Destructive-remote:** a dialog listing the remote commits that will be overwritten, with lease on by default. Opting out is scoped per repository and per session, never global.

### 18. Undo / redo

- **Where used:** Toolbar buttons with an action-naming tooltip; covers the last action only [H][D].
- **Problem it solves:** Recovers from mistakes.
- **Strengths:**
  - Visible.
  - Covers checkout, commit, discard, branch deletion, reset, and rebase [D].
- **Weaknesses:**
  - One step only.
  - Composite actions undo partially (F13).
- **YForge direction:**
  - MVP: Undo reverses the whole last operation, using the reflog and a working-tree snapshot for discards.
  - Post-MVP: an Activity timeline of restore points.

### 19. Multi-selection batch actions

- **Where used:** [U]
  - ⌘/⇧-selecting commits → "Squash / Drop / Cherry pick N commits";
  - several branches → "Delete / Hide / Solo N branches".
- **Problem it solves:** Batch Git operations.
- **Strengths:**
  - Counts in item labels.
  - Only valid verbs appear.
- **Weaknesses:**
  - Unavailable verbs disappear silently. For example, Squash is absent when the range is below a merge, and nothing says why.
- **YForge direction:** Unavailable verbs stay visible but disabled, with a reason ("Squash needs a merge-free range on the current branch").

### 20. Modal dialogs with provider tabs

- **Where used:** Clone and Init [H]:
  - left tabs: URL/Local plus each provider;
  - right: form, path preview, primary button.
- **Problem it solves:** One dialog for local and hosted sources.
- **Strengths:**
  - A full-path preview.
  - Provider repo search.
- **Weaknesses:**
  - Provider tabs appear before any integration is connected.
  - The primary label "Clone the repo!" is playful.
- **YForge direction:**
  - URL first, with the destination defaulting to the last location.
  - Provider tabs only appear after a provider is connected.
  - Plain action labels ("Clone").

### 21. Full-page settings with scoped sections

- **Where used:** Preferences [H]:
  - left nav with global categories and a "Repo-Specific Preferences" group;
  - right-aligned labels, helper text, and ⚠ performance notes.
- **Problem it solves:** Many options with scope.
- **Strengths:**
  - The scope separation (global vs repo) is explicit.
  - Live previews for date formats.
- **Weaknesses:**
  - Mixed with organization and plan content.
  - Some controls are native popups.
  - No settings search.
- **YForge direction:**
  - Settings search.
  - A scope switch (All repositories / This repository).
  - Owned controls.
  - No account content.

### 22. Keyboard model

- **Where used:** Single-letter S/U, J/K/H/L, ⌘Enter, ⌘B, ⌘L, ⌘1–9 [D]; Esc clears, then closes [H].
- **Problem it solves:** Speed for power users.
- **Strengths:**
  - Vim-style navigation.
  - Staging keys.
- **Weaknesses:**
  - No customization found [D].
  - The palette misses actions.
- **YForge direction:**
  - The same core model.
  - Every action gets a binding slot.
  - Customizable (Post-MVP).
  - Shortcuts are shown in menus and tooltips.

### 23. Split panes and resizing

- **Where used:** Left panel, graph, inspector, and diff panes [H][D].
- **Problem it solves:** Fits dense information on one screen.
- **Strengths:**
  - Collapsible left panel (⌘J).
  - Per-repo column widths [D].
- **Weaknesses:**
  - Divider drag targets are thin.
  - No reflow at small sizes (F11).
- **YForge direction:**
  - Resizable dividers with 8px hit areas.
  - Double-click a divider to reset it.
  - Size classes collapse the sidebar first, then turn the inspector into an overlay drawer (see [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md)).

### 24. Operation progress and error recovery

- **Where used:** [H]
  - Toasts ("Pull Failed").
  - Conflict state takes over the WIP row.
  - Abort and Skip buttons.
  - No progress UI was observed for local-remote operations; they completed quickly.
- **Problem it solves:** Recovering from failed operations.
- **Strengths:**
  - Abort is always offered during merge and rebase.
- **Weaknesses:**
  - Auto-stash is not restored (F5).
  - Errors mix Git jargon with raw refs.
- **YForge direction:**
  - The state strip shows a determinate step ("Rebasing 2/5") or an indeterminate operation state.
  - Every failure names what happened, what is safe, and the next action, and links to the exact Git output in the Activity log.
