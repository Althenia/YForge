# Component Specs (core set)

- **Status:** approved 2026-09-29; revised the same day for the lean Y Aurora direction and Rail graph styling.
- **Rules revision:** `DESIGN.md` + `app/DESIGN.md`, alpha, 2026-09-29 (Y Aurora, Rail).
- **Token names:** from [../../app/DESIGN.md](../../app/DESIGN.md).
- **Other components:** use the token defaults in the design system until they get specs (see its Components registry).

---

## State strip (with operation banner)

- **Purpose and non-goals:** Answers the seven orientation questions in one 36px row of chips; it hosts operation controls while Git is mid-operation. It is not a notification area and not a toolbar.
- **Anatomy:**

  | Part | Token(s) |
  |---|---|
  | Container | `state-strip`: a transparent row of height `controls.bar-state` over the backdrop; every segment is a `chip` (surface-2 control, text-muted, ui-caption, pill, `controls.height-chip`) |
  | HEAD chip | `head-junction` glyph (a 12px lane disc inside a 1.5px ring, 2px clear of the disc) + "HEAD" + ref in `ref` role, `text` |
  | Upstream arrow + counts | ↑ ahead in `status-added` ink, ↓ behind in `text-muted`; tabular figures; diverged adds the word "diverged" |
  | Changes chip | `changes` glyph (16px, 6px gap) + "Changes" + status letters in `status-*` inks (S15: icon and label) |
  | Remote freshness chip | `chip-success` (accent-tint / accent-ink) with the check glyph while fresh; the warning state uses `attention-ink` + warning icon |
  | Worktrees chip | Worktree glyph + count, pushed to the end; lanes with changes in `text` |
  | Operation banner (replaces all chips) | `banner-operation` (attention-tint / attention-ink, ui-strong, pill, `controls.banner`, 1px inset attention at 35%) + buttons at `controls.height-dense`: Resolve `button-primary`, Continue and Skip `button-secondary`, Abort `button-danger`; these keep a text label (S15) |

- **Variants:**
  - idle;
  - operation (merge, rebase, cherry-pick, revert, apply stash);
  - error (push rejected, auth), shown as `banner-danger`;
  - detached HEAD, shown with `attention-ink` + warning icon.
- **Interaction states:** Segments are buttons with rest, hover (hover-capable only), focus-visible (2px `focus` ring), active, and disabled with a reason.
- **Content states:**
  - no upstream → "no upstream · Publish";
  - unknown ahead/behind → "—" with a tooltip ("Fetch to compare");
  - long branch names → truncate the middle, keeping the prefix and tail.
- **Responsive behavior:**
  - Below 1280, freshness collapses to an icon, and the Worktrees segment collapses to its count.
  - Operation buttons never collapse.
- **Motion:** The banner appears with `panel-reveal`, and the `aurora-operation` recipe shifts the aurora to its attention glow; under reduced motion both change instantly.
- **Accessibility contract:**
  - `role="status"` region for segment updates, announced politely.
  - The operation banner is a labeled group, and its buttons are in tab order.
  - The "k of n" step is read aloud.
- **Platform variants:** Fine pointer only (desktop).
- **Consumers:** S02, S07–S11, S26–S29.

## Graph row

- **Purpose and non-goals:** One commit, stash, or Changes entry per row, with GitKraken's graph topology and geometry (S13) and YForge's tinted Rail styling: ref label, lane art, node, lane strip, and message. It does not edit messages inline; that belongs to the inspector.
- **Anatomy:**

  | Part | Token(s) |
  |---|---|
  | Row | `graph-row` (canvas, `graph-text`, `graph` role), height `controls.row-graph` with a `controls.graph-row-inner` band (3px above and below) |
  | Ref label | Ref label component in the Branch / Tag column |
  | Lane art | `controls.graph-line` edges in the color of the column that carries them; node shapes per the design system §Shapes |
  | Lane strip | `controls.graph-lane-strip` of lane color on the inner band where the message column starts, at 60% opacity; there is no row streak |
  | Message | 12px after the lane strip. Summary in `graph-text`, then the first body line inline in `graph-text-body` (`graph-row-body`); Changes and stash messages in `graph-text-body`, stash in italic |
  | Time pill | `graph-time-pill` (pill) at the message column's right edge, 8px above the first row of each relative-time bucket |
  | Selection | `graph-row-selected` plus the lane strip at full opacity (S6) |

- **Lane model (S13):**
  - Rows run newest first. A commit takes the leftmost column already reserved for it; otherwise it takes the leftmost free column.
  - Its first parent keeps the commit's column. Each further parent reuses a column already reserved for it; otherwise it takes the leftmost free column.
  - When several columns reserve one commit, the leftmost becomes its column and the others end on its row.
  - Lane color is `lane-<column mod 10>`. Lanes start after `controls.graph-gutter` and repeat every `controls.graph-lane-pitch` (compact lanes use the `-compact` controls).
- **Edge routing:** Edges are orthogonal, with `controls.graph-arc-radius` corners. A branch column runs vertically and turns into its parent's node on the parent's row. A merge leaves its node horizontally on its own row, then runs down the parent's column. Changes and stash edges are dotted (2px dash, 2px gap).
- **Variants:** commit, merge, stash, Changes (clean, changes, conflicts), checked-out HEAD, and dimmed (search non-match, branch-hover non-member). A Changes row with conflicts uses `graph-row-conflict` (attention-tint fill, attention-ink message) and a "!" glyph.
- **Interaction states:**
  - rest;
  - hover: `graph-row-hover` fill; the row's ref connector turns 2px at full opacity; an unlabeled commit shows a ghost label (its nearest containing branch at 50% opacity), and double-clicking checks that branch out;
  - focus-visible: the 2px focus ring;
  - selected;
  - multi-selected (the selection fill on every selected row);
  - dimmed: message text drops to `graph-text-dim` through the `graph-dim` recipe.
- **Content states:**
  - a message without a body;
  - a very long summary, which truncates at the end with the full text in a tooltip;
  - an empty message → "(no message)";
  - an unknown author → "?" in the node.
- **Responsive behavior:** The message column absorbs width changes. The optional Author, Date / Time, and SHA columns drop in the `compact` and `minimum` classes. The Branch / Tag column keeps at least `layout.graph-ref-column-min`.
- **Motion:** Refresh uses the `graph-refresh` cross-fade and dimming uses `graph-dim`. Rows never slide.
- **Accessibility contract:**
  - Listbox semantics with multi-select.
  - The accessible name combines summary, author, relative time, refs, node kind (for example "merge commit" or "stash"), and "checked out" for HEAD.
  - J/K moves; Space toggles selection; Enter runs the primary action; ⇧F10 opens the menu.
- **Platform variants:** The ghost label and branch highlight are gated to hover-capable pointers and mirrored on focus (S7).
- **Consumers:** S02, S05, S22.

## Ref label

- **Purpose:** Identify the branches, remote branches, and tags at a commit, and mark the checked-out branch, in the Branch / Tag column.
- **Anatomy:**

  | Part | Token(s) |
  |---|---|
  | Container (tinted Rail) | `ref-label-lane-N`: a solid `lane-N-label` fill (the lane mixed 18% into the canvas) with a `controls.ref-label-edge` (3px) lane-color inline-start edge, `graph-text`, `graph` role, `rounded.sm` on the trailing corners only, height `controls.ref-label-height`, 9px leading and 6px trailing padding; 2px from the column start and 6px clear of its end. The fill is opaque, so the connector stops at the label edge |
  | Checked-out | `ref-label-active-lane-N` (the lane mixed 38% into the canvas, `graph-text-active`, `graph-strong`) with a leading check glyph |
  | Tag | `ref-label-tag`: no lane edge; a solid `graph-pill` fill with a 1px `rule-panel` outline, `rounded.sm`, 6px padding, `graph-tag` role, and the tag glyph |
  | Kind glyphs | 14px after the name, 5px apart: local (laptop), remote (cloud), tag, worktree |
  | Connector | A 1px lane-color line at 25% opacity from the column start to the node, under the label; 2px at full opacity on the selected or hovered row |
  | Overflow | A `+N` count in the tinted Rail treatment; it opens a popover listing every ref at the commit |

- **Variants:**
  - local;
  - remote-only: the short name (no remote prefix) with the cloud glyph, and the full name in the tooltip;
  - local and remote on one commit: one label with both glyphs;
  - tag;
  - worktree branch, with the worktree glyph;
  - checked-out;
  - ghost: the nearest containing branch at 50% opacity.
- **States:** rest; hover (the lane mixed 28% into the canvas with `graph-text-active`; highlights the branch's related commits and dims the rest); focus-visible; checked-out; drag source; drop target (valid or invalid with a reason).
- **Content:** Names truncate at the end with an ellipsis. The tooltip, also shown on focus, gives the full name. Tags are never collapsed into `+N` (S2).
- **Accessibility:** It is a button named "<kind> <full name>[, checked out][, tracking <upstream>, ↑2 ↓1]". Its menu opens from the keyboard.
- **Consumers:** S02, S04, S06, S12.

## File row with status badge

- **Purpose:** One file in the Changes, commit, or stash file lists.
- **Anatomy:**
  - Row: `file-row` (`controls.row-file`, `rounded.md`, `code` role), 8px inset.
  - Status badge: a 20px `rounded.md` tile with a white 5% fill (dark) and the status letter in `status-*` ink (`ref` role).
  - Path: the directory in `text-muted`, the name in `text`, truncated from the left.
  - Rename shown as "old → new".
  - Row actions (S15, icon only, 16px glyph in a `controls.height-dense` square, each with an `aria-label` and a tooltip that names the action and its shortcut): Open diff (`diff`, ↵), Open in editor (`edit`), Stage or Unstage (`plus` or `minus`, S or U), More (`more`). Discard is in the More menu as a text item with a leading `trash` glyph, because destructive actions keep their label. Conflicted rows show Resolve (`merge`) and Mark resolved (`check`). The actions follow S7: visible on hover, focus, or selection.
- **States:** rest, hover or focus (actions visible; focus adds the 2px focus ring with a 2px offset), selected (the `selection` fill plus the 2px accent bar; opens the diff), partially staged (a split badge "M½" with the tooltip "Partially staged").
- **Empty list:** a `rounded.lg` box with a 1px dashed `rule-panel` border and `text-muted` guidance ("Nothing staged. Stage files, hunks, or lines to commit them.").
- **Content:** Paths are long, binary files show a "BIN" badge, submodules (Post-MVP) have their own glyph, and conflicted rows show "!" with the Resolve and Mark resolved icon actions.
- **Accessibility:** It is a list item named "<status word> <path>". S stages and U unstages the focused row.
- **Consumers:** S03, S04, S06, S15.

## Diff hunk

- **Purpose:** Show one hunk with staging controls.
- **Anatomy:**
  - Header: `@@` range in `code`, `text-muted`, with Stage hunk and Unstage hunk as icon-only buttons (`plus`, `minus`; tooltips with S and U) and Discard hunk as a text button with a leading `trash` glyph (S5, S15). The diff toolbar carries Previous hunk and Next hunk icon-only buttons (`previous`, `next`; P and N).
  - Lines: gutter with old and new numbers (`text-muted`), a ± marker, then code.
  - Added lines use an `accent-tint` background; removed lines use `danger-tint`.
  - Word-level highlights sit at stronger opacity inside the tinted line.
- **States:** hover or focus shows the header actions, and line selection shows the xs-radius range marks with "Stage 3 lines" and "Discard 3 lines".
- **Content:** Very long lines wrap only when wrap is on; otherwise the hunk scrolls horizontally. There is a "No newline at end of file" marker.
- **Accessibility:** Hunks are regions named "Hunk k of n, lines a–b". N and P jump between hunks. Line selection works with ⇧↑/⇧↓.
- **Consumers:** S07, S09.

## Conflict block

- **Purpose:** Resolve one conflict region.
- **Anatomy:**
  - The **Current** pane uses the lane color of the current branch. Its header reads "Current · <branch> · <role>", for example "Current · main · rebase target".
  - The **Incoming** pane uses the lane color of the incoming branch. Its header reads "Incoming · <branch> · <role>", for example "Incoming · feature/greeting · your commit being replayed".
  - The **Result** pane marks each line's source with C/I gutter letters.
  - Unresolved regions use the `status-conflicted` ink plus a "!" glyph.
- **Actions per block:**
  - Take Current;
  - Take Incoming;
  - Take both (Current first);
  - Take both (Incoming first);
  - Edit.
- **States:** unresolved, resolved (a check + source letters), edited (a "Manual" badge).
- **Accessibility:** Each block is a group named "Conflict k of n". Keys 1, 2, and 3 choose an action, and E edits the result. Resolving a block announces the "k of n" count.
- **Consumers:** S09.

## Icon-driven controls (S15)

- **Purpose:** One rule for when a control shows a glyph, a label, or both, so the chrome stays scannable and every icon-only control stays nameable.
- **Anatomy:**

  | Tier | Controls | Treatment |
  |---|---|---|
  | Icon only | Row actions (Stage, Unstage, Open diff, Open in editor, More); tab controls (New tab, Close tab); window controls (Activity, Toggle theme, Settings, Search commits); pane navigation (previous and next hunk, conflict, or match); toolbar actions below 1280 | 16px glyph (20px in the command bar) in a `controls.hit-min` or larger square; `aria-label` plus a tooltip (`tooltip` token: `text` fill, `text-inverse` ink, `rounded.md`, layer `tooltip`) showing the action and, in the mono role, its shortcut |
  | Icon and label | Toolbar actions at 1280 and above (Sync, Branch, Stash, Undo, Publish); the Commit button; sidebar and inspector section headers; state strip chips; bulk actions in section headers (Stage all, Unstage all); menu items | Icon before the label with a 6px gap; menu items always reserve a 16px icon slot, left empty when no established glyph exists |
  | Text (optional leading icon) | Dialog and confirmation buttons, operation-banner actions, destructive actions (Discard hunk, Delete), form labels, body copy | The label names the operation and its consequence (B6) |

- **Toolbar collapse:** At 1280 and above the command bar shows icon and label; below 1280 it shows the icon only, keeping the ahead count on Sync and moving the label into the accessible name and tooltip.
- **Tooltip behavior:** It appears after 450ms of hover and immediately on keyboard focus, never after a pointer click, hides on Escape, blur, scroll, or resize, and never takes pointer events.
- **Established glyphs:** sync, fetch, pull, push, branch, commit, merge, stash, undo, tag, worktree, folder, terminal, diff, edit, copy, trash, plus, minus, check, previous, next, activity, theme, settings, changes, more, close.
- **Accessibility:** An icon never carries state alone (B4): counts, letters, and words stay beside the glyph.
- **Consumers:** S15 and every screen with chrome; the component sheet (screen 0) shows the three tiers.
