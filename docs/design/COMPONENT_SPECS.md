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
  | Chip group | One pill (`chip` surface) of three flat segment buttons that gain `material.control-hover` at hover: HEAD, branch and upstream, ahead and behind |
  | HEAD segment | `head-junction` glyph (a 12px lane disc inside a 1.5px ring, 2px clear of the disc) + "HEAD" + ref in `ref` role, `text`; detached reads "HEAD detached at 1a2b3c4" with the warning glyph in `attention-ink`. Click reveals HEAD in the graph (⌘⇧H) |
  | Branch segment | "→" + upstream in `ref` role, or "no upstream". Click opens the branch menu: every local branch (the checked-out one marked with the check glyph and disabled with its reason), then Set upstream… and, when one exists, Unset upstream |
  | Sync segment | ↑ ahead in `status-added` ink, ↓ behind in `text-muted`; tabular figures; diverged adds the word "diverged"; "—" with a tooltip when unknown. Click opens the Sync menu |
  | Changes chip | `changes` glyph (16px, 6px gap) + "Changes" + status letters in `status-*` inks (S15: icon and label) |
  | Remote freshness chip | A button. `chip-success` (accent-tint / accent-ink) with the check glyph while fresh; the warning state uses `attention-ink` + warning icon. Click fetches now; disabled with its reason while offline, syncing, or mid-operation |
  | Offline chip | `chip-attention` with the warning glyph and the word "Offline"; while it shows, Fetch, Pull, Push, and Push to… are disabled with the reason "You are offline" |
  | Auth failure | `chip-danger` "auth failed for <remote>", the hint, then text-labelled Fix (settings glyph; opens the SSH key setting for an SSH remote, the repository's remotes otherwise), Retry, and Dismiss |
  | Strip notice | A `chip-attention` chip with the outcome in text, an optional `hint-text` detail, text-labelled `btn sm` actions, and a dismiss icon button. Used for "Your changes were stashed and restored", "Your changes are kept in stash@{n}" (Apply, Pop), and "Restore the changes stashed when you left <branch>?" (Restore, Keep in stash). Inside the operation banner it is plain text |
  | Worktrees chip | A button: worktree glyph + count, then "· N with changes", pushed to the end. It opens a popover list: branch in `ref` role, path truncated from the left, and text flags (current, changes, locked, missing) |
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
  - Strip notices keep their text and actions; the detail line truncates first.
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
  | Optional columns | Author (name, or initials at 40px and narrower), Date / Time (relative age, absolute time in the tooltip), and SHA (7 characters, `ref` role) in `graph-text-body`, right-aligned before the settings square; widths from `layout.graph-author-column`, `-date-column`, and `-sha-column` |
  | Clean working-tree row | The core's Changes row when nothing changed: the dotted ring in HEAD's lane and the italic message "Working tree clean"; selecting it opens the Changes inspector |
  | Selection summary | A `selection`-filled row below the list: "N commits selected", the newest and oldest short ids in `ref` role, and a Clear icon button (Esc) |
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
  - dimmed: message text drops to `graph-text-dim` through the `graph-dim` recipe;
  - faded (branch hover, pinned highlight): the same dimming plus lane art at 30% opacity (connectors 10%); the Changes row never fades.
- **Content states:**
  - a message without a body;
  - a very long summary, which truncates at the end with the full text in a tooltip;
  - an empty message → "(no message)";
  - an unknown author → "?" in the node.
- **Column settings:** The gear at the header's end opens a popover with a checkbox per optional column, Reset columns, and the branch visibility choice (All branches, Current + upstream), which the core applies by hiding the other commits and laying the lanes out again. Widths change from focusable `separator` handles (drag, ←/→ by 8px, double-click or Home resets) within `layout.graph-ref-column-min` to `-max` for Branch / Tag and 32 to 300 (Author), 56 to 300 (Date / Time), and 56 to 200 (SHA); the choices are saved per repository in the app database.
- **Selection:** Click selects one commit; ⌘/Ctrl-click toggles; ⇧-click selects the range from the anchor (loading the pages between); ⇧↑/⇧↓ and ⇧J/⇧K extend; Space toggles the current commit; Esc collapses to it. Right-clicking a selected commit opens the menu for the whole selection, and a commit outside it is selected first.
- **Highlight:** Pointing at a branch label fades every commit that branch does not contain; B on the selected row pins the highlight of its branch until B or Esc.
- **Responsive behavior:** The message column absorbs width changes. The optional Author, Date / Time, and SHA columns drop in the `compact` and `minimum` classes (below 1024px). The Branch / Tag column keeps at least `layout.graph-ref-column-min`.
- **Motion:** Refresh uses the `graph-refresh` cross-fade and dimming uses `graph-dim`. Rows never slide.
- **Accessibility contract:**
  - Listbox semantics with multi-select.
  - The accessible name combines summary, author, relative time, refs, node kind (for example "merge commit" or "stash"), and "checked out" for HEAD.
  - J/K moves; ⇧ extends; Space toggles selection; Enter opens the `+N` list when the row has hidden branches; H reveals HEAD; B pins the branch highlight; ⇧F10 opens the menu.
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
  | Overflow | A `+N` button in the tinted Rail treatment, named "N more branches: <names>" (`aria-haspopup="dialog"`); it opens a popover that lists the hidden branches as ref labels in a listbox (↑/↓ move, Enter checks out, ⇧F10 opens the menu, Esc closes and returns focus to the graph). Each label keeps its drag and context menu |

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

- **Purpose:** Show a file diff in Hunk, Inline, or Split mode with hunk and line staging controls (S18) and highlighted code (S19).
- **Toolbar** (`role="toolbar"`, named "Diff options"), left to right:
  - mode segments Hunk, Inline, Split (`aria-pressed`; the choice lasts for the session);
  - the labelled **Ignore whitespace** switch (working-tree diffs only; the commit diff command has no such option). While on, hunk and line staging are `aria-disabled` and the toolbar states "Turn off Ignore whitespace to stage changes";
  - when lines are selected, the group "N lines selected" with Stage lines or Unstage lines (icon-only `plus`, `minus`; S and U), Discard lines (text button with a `trash` glyph; confirms), and Clear selection (`close`; Esc);
  - at the end, Previous and Next (`previous`, `next`; P and N; "hunk" in Hunk mode, "change" in Inline and Split) and Open in editor (`edit`).
- **Modes:**
  - **Hunk:** one framed section per hunk with a header and its own virtualized lines.
  - **Inline:** one continuous virtualized list; each hunk starts with a header row, and a "N unchanged lines" gap row separates hunks (the file's unchanged lines are not available until the file view has a backend command).
  - **Split:** the same list as two aligned halves (old left, new right). A removed run pairs line by line with the added run after it; the shorter side pads with an empty half (`surface-2`). Long lines wrap in a half so the rows stay aligned.
- **Header:** `@@` range in `code`, `text-muted`, with Stage hunk and Unstage hunk as icon-only buttons (`plus`, `minus`; tooltips with S and U) and Discard hunk as a text button with a leading `trash` glyph (S5, S15).
- **Lines:**
  - gutter with old and new numbers (one number per half in Split), a ± marker, then code;
  - added lines use `accent-tint`, removed lines `danger-tint`; the marker uses `status-added` and `danger-ink`;
  - the gutter of an added or removed line is a checkbox named "Select added line 12" or "Select removed line 9" (S18); unchanged lines and commit diffs have a plain gutter;
  - a selected line uses `diff-added-selected` or `diff-removed-selected`, the 2px `accent` inline-start bar, and a check glyph replacing the marker;
  - code takes the `syntax-*` inks (keyword, string, number, comment in italic, function, type, property) from the file extension; files with no grammar stay plain, and a hunk above 200 000 characters is not highlighted;
  - the changed words of a removed line and the added line it pairs with sit on `diff-removed-word` and `diff-added-word`.
- **States:** hover or focus shows the header actions; blocked (Ignore whitespace on) dims staging controls to 50% with the reason as tooltip and toolbar text; binary files show "Binary file — no text diff" in place of hunks.
- **Content:** Hunk and Inline scroll horizontally for long lines; Split wraps them. There is a "No newline at end of file" marker on the side that lacks it.
- **Accessibility:** Hunks are regions named "Hunk k of n, lines a–b"; N and P jump between hunks while a hunk has focus. On a line checkbox: Space or Enter toggles, ↑ and ↓ move to the previous or next changed line (across hunks), ⇧↑ and ⇧↓ extend the selection, ⇧-click extends within the hunk, S, U, and Backspace act on the selection (or the focused line), N and P jump to the next and previous change, Esc clears the selection. Only the focused line is a tab stop.
- **Consumers:** S07, S09.

## Composer

- **Purpose:** Write a commit message and commit, optionally pushing.
- **Anatomy:** Summary with the 72-character counter, Description, the Amend last commit checkbox with its pushed warning, then the **split button**:
  - the main segment is the primary Commit button (`commit` glyph, "Commit N files", hint ⌘↵);
  - the attached chevron segment (`chevron`, named "More commit actions", `aria-haspopup="menu"`) opens a menu upward with **Commit** (⌘↵) and **Commit & Push** (⌘⇧↵).
- **Commit & Push:** commits, selects the new commit, then pushes the current branch to its upstream; a branch without one publishes to `origin` (or the first remote). The push uses the ordinary Push flow, so a diverged branch opens the force-push confirmation and a rejection reads as usual.
- **States:** the reason for a disabled Commit sits beside the button. Commit & Push is `aria-disabled` with its reason inside the menu item when there is no remote, HEAD is detached, an operation or sync is running, or the amend rewrites a pushed commit. If the push fails after the commit, the commit stays and the push error is reported.
- **Accessibility:** ⌘↵ commits and ⌘⇧↵ commits and pushes from anywhere in the Changes inspector; the menu is a `role="menu"` with arrow-key navigation and Esc to close.
- **Consumers:** S03, S04.

## Message edit form

- **Purpose:** Rewrite the message of the HEAD commit from the commit inspector.
- **Anatomy:** an icon-only Edit message button (`edit`) sits in the inspector header of the HEAD commit only. It opens a form above the details with Summary (and counter), Description, the pushed warning when HEAD is already on its upstream ("… the next push needs a force push"), and text buttons Save message and Cancel.
- **States:** Save is disabled with "Enter a summary" for a blank summary; while an operation is in progress the button is `aria-disabled` with "Finish the operation in progress first". Saving selects the rewritten commit and, when it was pushed, reports the force-push consequence. Undo is the activity toast's Undo.
- **Accessibility:** the form is named "Edit message"; Esc cancels.
- **Consumers:** S03.

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

## AI provider card, row, and status badge

Settings → AI (specimen 16, rules S24 and S26).

- **Card:** a `button` on `material.control` (`rounded.lg`, 1px `rule` inset, 12px padding) with a 32px provider mark on the left, the name in `ui-strong`, and one line of `ui-small` muted copy. Two cards per row in the add dialog. Hover uses `material.control-hover` on hover-capable pointers only. The cursor is `action`.
- **Marks:** official OpenAI Blossom (white on dark, black on light) and OpenRouter glyph (Cloud on dark, Ink on light), unmodified, from `brand/third-party/`. Claude Code uses the `terminal` glyph and OpenAI-compatible the `plug` glyph, each in a 32px `material.control` tile with a 1px `rule` inset.
- **Row:** a grid of mark (24px), name (`ui-strong`) over kind and mono model (`ui-small` muted), status badge, "Active" chip, and icon actions (Use as a small text button, Edit and Remove as 24px icon buttons with tooltips). The active row uses the `selection` fill with the 2px `accent` inline-start bar (S6).
- **Status badge:** a pill of `controls.height-chip` with a 14px glyph and a word, never color alone (B4): Ready (check, `accent-tint` and `accent-ink`), Not installed, Signed out, and Key missing (warning, `attention-tint` and `attention-ink`), Key rejected, Unreachable, and Check failed (warning, `danger-tint` and `danger-ink`). The detail of an unreachable or failed check is the tooltip and a line under the header.
- **Add dialog:** step 1 the card grid, step 2 the form for the chosen kind (name; base URL for OpenAI-compatible; API key for OpenRouter and OpenAI-compatible; an optional executable path for the CLI kinds), step 3 the provider panel: detection or connection status with Check again or Test connection, the install command with a copy button when the CLI is missing, the sign-in panel (browser, or "No browser? Use a code" for ChatGPT), the saved-key state, the model field (free text; "Load models" for HTTP kinds), and Use this provider or Save model.
- **Key:** an API key is typed into a `password` field once. A saved key reads "Key saved in the macOS Keychain" with Replace and Clear; the field is never filled from storage.
- **Device code:** the address and the one-time code are shown in mono with copy buttons and a live "Copied" status; Cancel sign-in stops the CLI.

## Generate (composer)

Specimen 20, rule S24. A text-labelled secondary button with the `wand` glyph, left of the Commit split button, disabled with "Stage files to generate a message" when nothing is staged. While it runs it reads "Generating…" (busy) beside an icon button that cancels. The result fills Summary and Description as an editable draft; an `attention` note under the fields says nothing is committed until the user commits, lists withheld and cut files and a trimmed summary as text, and offers "Restore my text" when it replaced the user's text. A failure is a `danger` note with the cause, that nothing changed, and "Open AI settings" or "Sign in".

## AI proposal (conflict resolver)

Specimen 19, rule S24. "Propose resolution" sits in the resolver toolbar beside the resolved count, which also counts the proposals left to review. The active region shows a proposal block: a 3px `accent` inline-start bar on `canvas`, a header that calls it a draft from the AI provider, the rationale in `ui-small` muted, the proposed lines in `code`, and Accept (primary), Edit, and Reject. Accept puts the lines in the Result pane as a manual resolution joined with the file's line ending; Edit opens the region editor with the proposal; Reject drops it. Marking the file resolved stays manual.

## Interactive rebase editor

Specimen 17, rule S25. A center panel over the graph column (header, body, footer, like the conflict resolver).

- **Header:** the `rebase` glyph, "Edit history", the mono range `<base>..HEAD`, the commit count, and "Back to graph".
- **Row:** `canvas` with a 1px `rule` inset and 8px inline padding: drag handle (`drag` cursor), mono SHA, message (one line, ellipsis), a "Pushed" chip with the `push` glyph, an action select (Pick, Reword, Squash, Fixup, Drop, Edit), and Move up and Move down icon buttons. Focus shows the 2px `focus` ring. A dropped row takes `danger-tint` and a struck-through message. An invalid row takes a 1px `danger` inset and its problem in `ui-small` danger ink below.
- **Message editor:** a reword row and the last squash of a run show a textarea below the row, prefilled with the full message (or the joined messages of the run).
- **Drop position:** a 2px `accent` line above or below the row under the pointer while dragging; the window takes the `dragging` cursor.
- **Keys:** ↑ and ↓ move focus, ⌥↑ and ⌥↓ move the row, P, R, S, F, D, and E set the action, Esc leaves the editor when no field has focus.
- **Preview:** "Resulting history · N commits", newest first, each with a glyph (commit, edit for reworded, squash for combined), the subject, the source SHAs joined by " + ", and a chip (Combined, Reworded, Stops here so you can amend it); then "Dropped (n)".
- **Footer:** "Rewrite history" (primary) disabled with its reason in text, Cancel, and the core's refusal in `ui-small` danger ink.

## Squash dialog

Rule S25. A dialog titled "Squash N commits" lists the commits to combine oldest first, shows the pushed warning when any is on the upstream, and holds one message textarea prefilled with the selected messages oldest first. The primary button repeats the count and is disabled with its reason (not contiguous, blank message, tracked changes, reading the branch).

## Recompose view

Specimen 18, rules S24 and S25. A center panel with a toolbar (Base select defaulting to the upstream, "n of m changes assigned", Propose with AI, Restore my grouping), the pushed warning, and two columns.

- **Changes (left):** file rows with a drag handle, expand chevron (S23 pattern), status letter, left-truncated mono path, an assignment chip (Unassigned in `attention`, Commit N in `accent`, Split when a file or hunk is divided), and an assign button that opens a menu of the commits. Expanding a file lists its hunks (label, +added −removed, chip, assign); expanding a hunk lists its changed lines as checkboxes (S18 pattern) with "Assign n selected lines…". A binary or hunkless file is one whole-file unit.
- **New commits (right):** oldest first. Each card has "Commit N", Move earlier, Move later, and Remove icon buttons, a message textarea, and the assigned files with their scope ("whole file", "1 of 2 hunks", "3 lines") and counts. A card under a dragged row takes the `accent-tint` fill and a 2px `accent` inset. "Add commit" appends a card.
- **Keys:** on a focused row 1–9 assign to that commit and 0 unassigns.
- **Footer:** "Recompose N commits" (primary) disabled until every change is assigned exactly once and every message is filled, with the first blocking reason in text.

## Tab group

Specimen 21, rule S28. The tabs of one repository and its linked worktrees sit next to each other in a `role="group"` named "<repository> and its worktrees", a pill with a 1px `rule-panel` inset and 4px padding. The repository's tab keeps the YForge logo and, when active, the worktree count; a linked worktree's tab leads with the 16px `worktree` glyph. A single tab has no group border. Grouping follows `RepoSnapshot.main_root`, known for every open tab at boot and when a tab opens; a tab whose main repository is not open still groups with the other worktrees of that repository.

## Worktrees panel

Specimens 21 and 22, rule S28. A center panel over the graph column (header, body, like the rebase editor).

- **Header:** the `worktree` glyph, "Worktrees", the count, a primary "Create worktree…" (plus glyph), and "Back to graph".
- **Row:** `canvas` with a 1px `rule` inset: the `worktree` glyph, the branch in mono (`bare` or `detached` without one), chips for "Main worktree" and the flags current, changes (attention), locked, and missing, the path truncated from the left, and four 24px icon buttons: Open as tab, Open in terminal, Integrate, Remove. The worktree open here uses the selection fill with the 2px accent bar.
- **Unavailable:** Open is disabled for the worktree open here and a missing one; Integrate and Remove are `aria-disabled` with the reason as tooltip (S15, S17).
- **Empty:** a repository with only its main worktree shows "No linked worktrees. Create one to work on another branch in parallel."
- **Dialogs:** Create worktree (New branch or Existing branch radio, branch name or select, start point select, Folder input with the suggested path, the note that the folder must not exist or be empty); Integrate (target select, the cleanup checkbox, and the exact sequence as two sentences); Remove (a confirmation that names the discarded changes and the safety snapshot when the worktree has changes).
- **Entry points:** the state strip worktree chip, the sidebar Worktrees header (open, and a plus for Create), the palette ("Show worktrees", "Create worktree…"). Each sidebar worktree row opens its tab and has a menu with the same actions.

## Recovery view

Specimens 23 and 24, rule S27. A center panel with the header "Recovery" and "Back to graph", a limits note, the tabs, and the active tab.

- **Limits note:** an `attention-tint` note with the warning glyph, "What recovery cannot do", and three sentences (never committed outside YForge, pruned objects, snapshot retention and visibility). It stays visible on every tab.
- **Tabs:** the `segmented` control with `role="tablist"`: Reflog, Lost commits, Snapshots, each with its glyph (`history`, `search`, `stash`).
- **Reflog:** a Reference select (HEAD, then each branch), and rows of the action chip, mono short SHA, summary, mono selector, relative age (absolute time as tooltip), and three icon buttons (Restore as branch, Check out detached, Reset the current branch). A pruned commit reads "Commit no longer exists" in muted ink with the buttons disabled and the reason as tooltip. Pages of 50 load with "Show older".
- **Lost commits:** a primary "Scan for lost commits"; while it runs, the status "Scanning with git fsck…" and "Cancel scan". Rows match the reflog rows; a stash-shaped commit carries a "Dropped stash" chip. Empty and cancelled scans say so in text.
- **Snapshots:** rows are buttons (`aria-expanded`) with the action in `ui-strong`, the description, a file-count chip, the branch, and the age. The open row takes the selection fill and the accent bar and lists its files (checkbox, status letter, left-truncated path) with "Restore selected files", "Restore everything…", and a danger "Delete snapshot…". A restore shows the ref of the safety snapshot in a status note.
- **Restore controls:** Restore as branch opens a popover with a free suggested name; Reset opens the Soft, Mixed, Hard menu; a hard reset, a detached checkout, Restore everything, and Delete snapshot confirm with text-labelled buttons.

## File view

Specimen 25, rule S29. The diff panel frame without the toolbar row: a breadcrumb ("Graph › <source> › <path>"), a chip with the line count and size, a mono chip with LF or CRLF, Open in editor, and Close. Lines are a 56px right-aligned muted number and the `code` text with the `syntax-*` tokens (S19); the body is virtualized and keeps the diff's text cursor. A binary file shows "Binary file, <size>. There is no text view."; a file over 2 MiB shows an alert with its size and the limit. Entry points: the diff toolbar, the commit inspector file rows, and the stash inspector file rows, each a "View file" icon button (a deleted file has none).

## Command line install

Rule S30. A Settings → General row "Command line": a secondary button with the `terminal` glyph, "Install yforge command" (then "Reinstall yforge command"), and below it a status note with the written path, whether an earlier copy was replaced, and that `~/.local/bin` must be on PATH. A refusal appears as an alert with the core's cause.

