# Component Specs (core set)

- **Status:** approved 2026-09-29; revised the same day for Rail graph styling, and on 2026-10-03 for the solid charcoal surfaces with no aurora (S14).
- **Rules revision:** `DESIGN.md` + `app/DESIGN.md`, alpha, 2026-10-03 (S14 charcoal surfaces, Rail).
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
  | Sync segment | ↑ ahead in `status-added` ink, ↓ behind in `text-muted`; tabular figures; diverged adds the word "diverged"; "—" with a tooltip when unknown. Click opens the Pull menu. When the branch has diverged, Push is disabled and the strip shows a notice naming the remote commits a force push with lease would replace, with the action Force push with lease |
  | Changes chip | `changes` glyph (16px, 6px gap) + "Changes" + status letters in `status-*` inks (S15: icon and label) |
  | Remote freshness chip | A button. `chip-success` (accent-tint / accent-ink) with the check glyph while fresh; the warning state uses `attention-ink` + warning icon. Click fetches now; disabled with its reason while offline, syncing, or mid-operation |
  | Offline chip | `chip-attention` with the warning glyph and the word "Offline"; while it shows, Fetch, Pull, Push, and Push to… are disabled with the reason "You are offline" |
  | Auth failure | `chip-danger` "auth failed for <remote>", the hint, then text-labelled Fix (settings glyph; opens the SSH key setting for an SSH remote, the repository's remotes otherwise), Retry, and Dismiss |
  | Detached action | Beside the chip group while HEAD is detached: a `btn sm` with the `branch` glyph and the text "Create branch here". It opens the Create branch form at the detached commit, checked out on submit (name, Enter) |
  | Strip notice | A `chip-attention` chip with the outcome in text, an optional `hint-text` detail, text-labelled `btn sm` actions, and a dismiss icon button unless the notice must stay. Used for "Your changes were stashed and restored", "Your changes are kept in stash@{n}" (Apply, Pop), "Restore the changes stashed when you left <branch>?" (Restore, Keep in stash), and "This branch has diverged" (detail names the remote commits, action Force push with lease, no dismiss). Inside the operation banner it is plain text |
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
- **Motion:** The banner appears with `panel-reveal`; under reduced motion it appears instantly.
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
  | Lane band and strip | Opaque lane-color tint fades horizontally into canvas across the graph column (into selection fill when selected); `controls.graph-lane-strip` remains at the message column's start on the inner band, at 60% opacity |
  | Message | 12px after the lane strip. Summary in `graph-text`, then the first nonblank body line inline in `graph-text-body` (`graph-row-body`); Changes and stash messages in `graph-text-body`, stash in italic |
  | Time pill | `graph-time-pill` (pill) at the message column's right edge, 8px above the first row of each relative-time bucket |
  | Optional columns | Author (name, or initials at 40px and narrower), Date / Time (relative age, absolute time in the tooltip), and SHA (7 characters, `ref` role) in `graph-text-body`, right-aligned before the settings square; widths from `layout.graph-author-column`, `-date-column`, and `-sha-column` |
  | Clean working-tree row | The core's Changes row when nothing changed: the dotted ring in HEAD's lane and the italic message "Working tree clean"; selecting it opens the Changes inspector |
  | Selection summary | A `selection`-filled row below the list: "N commits selected", the newest and oldest short ids in `ref` role, and a Clear icon button (Esc) |
  | Selection | `graph-row-selected` plus the lane strip at full opacity (S6) |

- **Lane model (S13):**
  - Rows run newest first. A commit takes the leftmost column already reserved for it; otherwise it takes the leftmost free column.
  - Its first parent keeps the commit's column. Each further parent reuses a column already reserved for it; otherwise it takes the leftmost free column.
  - When several columns reserve one commit, the leftmost becomes its column and the others end on its row.
  - Lane color is `lane-<column mod 10>`. Default lanes start 4px after the ref/graph divider (`controls.graph-gutter`) and repeat every `controls.graph-lane-pitch`; compact lanes retain the 10px `-compact` gutter and pitch.
  - The graph column starts at `layout.graph-column` (56px), expands when active lanes need more room, and places the message immediately after that column.
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

- **Clean working tree (S38):** while nothing changed and Amend is off, the area lists give way to a centered state (32px `changes` glyph, "Working tree clean", "Nothing to commit on <branch>") and the composer shrinks to one "Amend last commit" button, disabled with its reason on an unborn branch or during an operation; choosing it opens the full composer with Amend on and the last message.

## Commit inspector actions

- **Purpose:** Carry the common commit verbs in the header of the commit inspector as compact icon controls, so a selected commit needs no context menu (Flow C).
- **Anatomy:** a row of four `icon-btn dense` icon-only controls under the header text, 4px apart: Branch here (`branch` glyph), Cherry-pick (`cherry` glyph), Revert (`undo` glyph), and Reset (`reset` glyph). Each carries an `aria-label` naming the action and its target ("Branch here", "Reset main to here") and a tooltip naming the action in full ("Cherry-pick 1a2b3c4 onto main", "Reset main to 1a2b3c4"); no text is shown in the control.
- **States:** enablement and disabled reasons are those of the commit context menu: Cherry-pick and Revert are `aria-disabled` on a merge commit ("A merge commit needs a parent choice, which is not available yet"); Cherry-pick, Revert, and Reset are `aria-disabled` while an operation is in progress ("Finish or abort the rebase first"), with the reason as tooltip.
- **Interaction:** Branch here opens the Create branch form at that commit (button, name, Enter). Cherry-pick and Revert run at once. Reset opens the Soft, Mixed, Hard menu below the button, then the same confirmation as the context menu.
- **Consumers:** S03, S15.

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
- **Established glyphs:** sync, fetch, pull, push, branch, commit, merge, cherry, reset, stash, undo, tag, worktree, folder, terminal, diff, edit, copy, trash, plus, minus, check, previous, next, activity, theme, settings, changes, more, close.
- **Accessibility:** An icon never carries state alone (B4): counts, letters, and words stay beside the glyph.
- **Consumers:** S15 and every screen with chrome; the component sheet (screen 0) shows the three tiers.

## AI provider card, row, and status badge

Settings → AI (specimen 16, rules S24 and S26).

- **Card:** a `button` on `material.control` (`rounded.lg`, 1px `rule` inset, 12px padding) with a 32px provider mark on the left, the name in `ui-strong`, and one line of `ui-small` muted copy. Two cards per row in the add dialog. Hover uses `material.control-hover` on hover-capable pointers only. The cursor is `action`.
- **Marks:** official OpenAI Blossom (white on dark, black on light) and OpenRouter glyph (Cloud on dark, Ink on light), unmodified, from `brand/third-party/`. Claude Code uses the `terminal` glyph and OpenAI-compatible the `plug` glyph, each in a 32px `material.control` tile with a 1px `rule` inset.
- **Row:** a grid of mark (24px), name (`ui-strong`) over kind (`ui-small` muted), status badge, and icon actions (Edit and Remove as 24px icon buttons with tooltips). A provider has no model and is never active (S34).
- **Status badge:** a pill of `controls.height-chip` with a 14px glyph and a word, never color alone (B4): Ready (check, `accent-tint` and `accent-ink`), Signed out and Key missing (warning, `attention-tint` and `attention-ink`), Key rejected, Unreachable, and Check failed (warning, `danger-tint` and `danger-ink`). The detail of an unreachable or failed check is the tooltip and a line under the header.
- **Add dialog:** step 1 the card grid, step 2 the form for the chosen kind (name; the API key or Subscription choice for ChatGPT and Claude; base URL for OpenAI-compatible; API key where the mode needs one), step 3 the provider panel: connection status with Test connection, the sign-in panel (browser, or "No browser? Use a code" for ChatGPT), and the saved-key state. No model is chosen here (S34).
- **Feature card:** the feature title and blurb with a "Use AI for <feature>" Switch and its On or Off word, disabled with "Choose a provider and model to turn this on" until saved; a provider Select; a model Select loaded as soon as a provider is chosen ("Loading models…"), searchable past 8 options (S35), beside an icon-only Reload models (`sync`); the prompt TextArea, which wraps inside the card; Reset to default. There is no Save button: the provider and model save when both are chosen and the prompt when it loses focus, followed by "Saved" or "Not saved: <reason>" in text. A switched-on feature whose provider is not ready says that its action stays hidden.
- **Key:** an API key is typed into a `password` field once. A saved key reads "Key saved in the macOS Keychain" with Replace and Clear; the field is never filled from storage.
- **Device code:** the address and the one-time code are shown in mono with copy buttons and a live "Copied" status; Cancel sign-in stops the sign-in.

## Generate (composer)

Specimen 20, rules S24 and S34. Shown only while Generate commit message is available (on, with a ready provider). A text-labelled secondary button with the `wand` glyph, left of the Commit split button, disabled with "Stage files to generate a message" when nothing is staged. While it runs it reads "Generating…" (busy) beside an icon button that cancels. The result fills Summary and Description as an editable draft; an `attention` note under the fields says nothing is committed until the user commits, lists withheld and cut files and a trimmed summary as text, and offers "Restore my text" when it replaced the user's text. A failure is a `danger` note with the cause, that nothing changed, and "Open AI settings" or "Sign in".

## AI proposal (conflict resolver)

Specimen 19, rules S24 and S34. "Propose resolution", shown only while Propose conflict resolution is available, sits in the resolver toolbar beside the resolved count, which also counts the proposals left to review. The active region shows a proposal block: a 3px `accent` inline-start bar on `canvas`, a header that calls it a draft from the AI provider, the rationale in `ui-small` muted, the proposed lines in `code`, and Accept (primary), Edit, and Reject. Accept puts the lines in the Result pane as a manual resolution joined with the file's line ending; Edit opens the region editor with the proposal; Reject drops it. Marking the file resolved stays manual.

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

Specimen 18, rules S24 and S25. A center panel with a toolbar (Base select defaulting to the upstream, "n of m changes assigned", Propose with AI while that feature is available (S34), Restore my grouping), the pushed warning, and two columns.

- **Changes (left):** file rows with a drag handle, expand chevron (S23 pattern), status letter, left-truncated mono path, an assignment chip (Unassigned in `attention`, Commit N in `accent`, Split when a file or hunk is divided), and an assign button that opens a menu of the commits. Expanding a file lists its hunks (label, +added −removed, chip, assign); expanding a hunk lists its changed lines as checkboxes (S18 pattern) with "Assign n selected lines…". A binary or hunkless file is one whole-file unit.
- **New commits (right):** oldest first. Each card has "Commit N", Move earlier, Move later, and Remove icon buttons, a message textarea, and the assigned files with their scope ("whole file", "1 of 2 hunks", "3 lines") and counts. A card under a dragged row takes the `accent-tint` fill and a 2px `accent` inset. "Add commit" appends a card.
- **Keys:** on a focused row 1–9 assign to that commit and 0 unassigns.
- **Footer:** "Recompose N commits" (primary) disabled until every change is assigned exactly once and every message is filled, with the first blocking reason in text.

## Tab group

Specimen 21, rule S28. The tabs of one repository and its linked worktrees sit next to each other in a `role="group"` named "<repository> and its worktrees", a pill with a 1px `rule-panel` inset and 4px padding. The repository's tab keeps the YForge logo and, when active, the worktree count; a linked worktree's tab leads with the 16px `worktree` glyph. A single tab has no group border. Grouping follows `RepoSnapshot.main_root`, known for every open tab at boot and when a tab opens; a tab whose main repository is not open still groups with the other worktrees of that repository.

### User tab groups

Specimen 21, rule S37. The user may group repository tabs; a group is a `role="group"` named "<name> tab group" that holds a chip and the group's tabs, and a repository tab keeps its worktree pill (S28) inside it.

- **Chip:** a native button before the tabs, `controls-height-chip` tall, with the group name in `ui-label` on the lane's `label` fill (`label-active` on hover), a 2px lane-color inset bar on its inline-start edge, and `aria-expanded`. While collapsed it adds " · n tabs" in text (`ui-small`), and " · <repository>" when the open repository is one of its hidden tabs. Color never carries the group alone: the name is text, and the Color menu item names the color word.
- **Collapse:** clicking the chip toggles it and never navigates; a collapsed group hides every member tab, including the open repository, and the window stays on that repository. Activating a tab of a collapsed group, including with next or previous tab, expands it.
- **Tab menu** (right-click or ⇧F10), rule S42, one `role="menu"` built from one entries builder (`tabMenuEntries`) in this order: "Close tab" (⌘W), "Close other tabs", "Close tabs to the right"; a separator; "Move left", "Move right"; "Add to new group…", "Add to group" (a second menu that lists the other groups by name with their tab count), "Remove from group" on a grouped tab; a separator; "Alias tab…" and, when an alias is set, "Remove alias"; a separator; "Reopen closed tab" (⌘⇧T). An item that cannot act stays visible, `aria-disabled`, with its reason as the tooltip: "No other tabs", "No tabs to the right", "This tab is already first", "This tab is already last", "No groups yet" or "No other groups", "No closed tabs". A tab or a group chip can be dragged. Dropping one loose tab on another only reorders and does not create a group. Dropping a tab on a chip adds it to that group. Dropping a grouped tab outside its group removes it. Dragging a chip moves that group and its hidden members together. Dropping a group on a group does not nest it and reports "Groups cannot nest."
- **Closing several tabs:** Close other tabs and Close tabs to the right close without a confirmation unless a tab they close has an operation in progress (a merge, rebase, cherry-pick, revert, or bisect in the cached snapshot); then a confirmation dialog (S5) titled "Close n tabs?" names those tabs and the operation, says closing a tab does not stop or undo it, and offers Cancel (focused) and a text-labelled danger "Close n tabs". Each closed repository tab goes on a stack of the last 20 closed tabs of the session, with the group members that stayed open; Reopen closed tab (menu, palette, File menu, ⌘⇧T) pops the latest one that is not open again, opens it as the active tab, and returns it to the end of the group that still holds one of those members. Tabs closed because their worktree was removed are not remembered.
- **Alias:** "Alias tab…" opens an "Alias <name>" popover (heading "Alias tab", the field "Name shown for <path>" prefilled with the name now shown, the note "1 to 40 characters. Shown on the tab, in Recent, and in the palette; the folder name stays in the tooltip.", "Save alias" disabled with the reason until the alias is valid, Cancel). Double-clicking the tab name opens the same popover. A collapsed group hides its tabs, so its chip menu lists "Alias <name>…" for each hidden tab. A save the core refuses stays open and shows its reason. The alias replaces the folder name on the tab, in Recent (also found by the filter), and in the palette (with the path as its note); the tab keeps the full path as its tooltip and the folder name as its accessible description.
- **Chip menu** (right-click or ⇧F10): "Move left" and "Move right" (disabled with "This group is already first" or "This group is already last"), then "Rename…", then "Alias <name>…" for each hidden tab while the group is collapsed, then "Color…" (the color word as note), "Ungroup", and "Close group…" in `danger` after a separator.
- **Popovers:** "New tab group" (Group name field, the "Group color" radiogroup of ten swatches named Cyan, Blue, Purple, Magenta, Pink, Red, Orange, Yellow, Green, Mint with Blue chosen, a note "1 to 40 characters. <repository> is added to the group.", "Create group" disabled with the reason until `groupNameProblem` passes, Cancel); "Rename group" (the name field, "Rename"); "Group color" (the same swatches; a choice applies and closes). A swatch is a native radio, visually hidden and labelled by its color word, beside a 14px dot in the lane color; the chosen swatch is `ui-strong` with a 2px `canvas` and 2px `focus` ring.
- **Close group:** the confirmation dialog (S5) names the group and lists its tabs, states "Uncommitted changes stay on disk; the repositories stay in Recent.", and offers Cancel (focused) and a text-labelled danger "Close n tabs".
- **Restoring:** while boot restores a saved session, the tab bar is a `role="status"` with `aria-busy="true"` named "Restoring tabs": each saved group as a non-interactive chip (its tab count in text while collapsed) followed by one "…" placeholder tab per member of an expanded group, one per ungrouped tab, the text "Restoring n tabs and m groups…", and below it the note "The groups come back exactly as you left them, including which are collapsed." A session without groups reads "Restoring n tabs…" and omits the note.
- **Save failure:** a failed save of a group change shows a `role="alert"` card under the tab bar, "The tab groups could not be saved", the failure message, "Your tabs and groups stay as they are now; after a restart they return to the last saved state.", and a "Try again" button; a successful save of the session removes it.

## macOS menu bar and Update dialog

Rule S43 (visual reference: the app-menu screen of the 2026-10-01 integrations proposal). On macOS YForge installs its own menu bar (menus YForge, File, Edit, View, Repository, Window, Help; the items are the rule's list, and the macOS-provided ones are predefined). Every shortcut shown comes from `app/src/state/shortcuts.ts`, the registry the palette uses; the Rust menu reads that file at build time. A custom item sends `menu-action` with its id; the ids are the palette command ids where one exists, so choosing an item runs the palette command. The frontend tells the menu which items can act (`menu_update`): an item whose command has a disabled reason is disabled, Redo is enabled only in a text field, and Undo is enabled in a text field or while YForge has an operation to undo. ⌘Z undoes typing in a focused text field and otherwise runs YForge's Undo; Theme and Density show the current choice as a check mark. View Release Notes, YForge Help, and Report an Issue open the project's GitHub pages; Keyboard Shortcuts opens the command palette, which lists every shortcut.

The Update dialog (Check for Update…, also in the palette) is a `role="dialog"` titled "Check for Update" with these states, each stated in text: checking (a busy status "Checking github.com/Althenia/YForge for a newer version…", the running version, "Nothing downloads until you choose Install and Relaunch.", Cancel); up to date ("YForge is up to date." with the version, Close); available (title "YForge <version> is available", "You have <current>. The update is signed with YForge's key and is checked before it installs.", the release notes as a list, Later, a primary "Install and Relaunch", and "Open repositories and tabs come back after the relaunch. Uncommitted changes stay on disk."); installing (a busy status "Downloading the update and checking its signature…", no way to dismiss); and failure (an alert "Could not check for updates" with the reason, "You are on YForge <version>; nothing was downloaded or changed.", and Try again, or "The update was not installed" with the reason, which for a failed signature check says the update was discarded). The update is downloaded only after Install and Relaunch, and is verified against the public key in `plugins.updater.pubkey` before it installs.

## Worktrees panel

Specimens 21 and 22, rule S28. A center panel over the graph column (header, body, like the rebase editor).

- **Header:** the `worktree` glyph, "Worktrees", the count, a primary "Create worktree…" (plus glyph), and "Back to graph".
- **Row:** `canvas` with a 1px `rule` inset: the `worktree` glyph, the branch in mono (`bare` or `detached` without one), chips for "Main worktree" and the flags current, changes (attention), locked, and missing, the path truncated from the left, and four 24px icon buttons: Open as tab, Open in terminal, Integrate, Remove. The worktree open here uses the selection fill with the 2px accent bar.
- **Unavailable:** Open is disabled for the worktree open here and a missing one; Integrate and Remove are `aria-disabled` with the reason as tooltip (S15, S17).
- **Empty:** a repository with only its main worktree shows "No linked worktrees. Create one to work on another branch in parallel."
- **Dialogs:** Create worktree (New branch or Existing branch radio, branch name or select, start point select, Folder input with the suggested path, the note that the folder must not exist or be empty); Integrate (target select, the removal checkbox ticked by default and still untickable, and the exact sequence as two imperative sentences: "Rebase … fast-forward …" and "Remove the worktree … and delete the branch …"; one confirmation carries the cleanup); Remove (a confirmation that names the discarded changes and the safety snapshot when the worktree has changes).
- **Entry points:** the state strip worktree chip, the sidebar Worktrees header (open, and a plus for Create), the palette ("Show worktrees", "Create worktree…"). Each sidebar worktree row opens its tab and has a menu with the same actions.

## Submodules

A sidebar section after Worktrees. The file-row submodule glyph stays post-MVP.

- **Rows:** path, status word (current, dirty, uninitialized, update failed), and the first 7 characters of the recorded commit. A dirty row also names the checked-out commit. The tooltip is the URL and branch.
- **Menu:** Update, or Init while uninitialized. Open as tab and Stage pointer stay disabled until the submodule is checked out, with the reasons "This submodule is not checked out" and "Nothing to stage until the submodule is checked out". Deinit… confirms: "Deinit removes the checkout at <path>. The gitlink stays in the index until you commit that change. Files inside the submodule are not staged." Stage records the gitlink only.
- **Add:** path, URL, and an optional branch. The note reads "The parent stores one commit, not a copy of the history. Update on fetch starts off."
- **Update on fetch:** a switch in the section, off unless the repository setting is exactly true. Off: "Update on fetch is off. Fetch does not move this submodule." On: "Update on fetch is on. Fetch checks out the recorded commit." Fetch then runs `git submodule update --init --recursive` only when the switch is on.
- **Empty:** "No submodules". A failed list says "Submodules could not be loaded."

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

## Platform connections

Settings → Platforms (specimen 14 `#platforms`, rule S31, proposal).

- **Row:** the provider row grid: a 24px neutral platform glyph tile (`github`, `gitlab`, or `bitbucket` in a `material.control` tile with a 1px `rule` inset, never a platform logo), the name in `ui-strong` over the kind and the mono host in `ui-small` muted, the `chip-attention` chip "Certificate not checked" (warning glyph) when the connection accepts an untrusted certificate, a text Test button, and Edit and Remove as 24px icon buttons with tooltips.
- **Result:** below the row, a `chip-success` "Connected as <login>" (check glyph) or an error note with the warning glyph, the failure text ("Authentication failed for <host>"), and a text-labelled "Edit connection".
- **Add and edit dialog:** the entry dialog with a `segmented` radio group for GitHub, GitLab, and Bitbucket (glyph and word), Host, Name (defaults to the platform name until edited), Access token (`password`, never filled from storage), the "Accept an untrusted certificate" checkbox with a plain-language warning below it, and "Add and test connection" or "Save and test connection". Editing adds the connection with the new token and removes the old one only after the add succeeds.

## Pull requests

Specimen 26, rule S31 (proposal).

- **Sidebar section:** the section header with the `pullrequest` glyph, "Pull requests", the count, and a plus icon button "New pull request". The section exists only while a connection matches one of the repository's remotes.
- **Row:** a two-line `srow`: `#number` (mono, muted) and the title, then the author and mono `source → target` in `ui-small` muted; a state chip on the first line (`chip-success` Open with `pullrequest`, plain Merged with `merge`, `chip-danger` Closed with `close`); Open in browser and Merge as 24px icon buttons overlaying the second line on hover, focus, and selection, with Merge `aria-disabled` and its reason unless the pull request is open; the row menu (⇧F10) offers the same two actions. The selected row uses the selection fill and the 2px accent bar.
- **States:** "No open pull requests" when the list is empty; the platform's error in `danger-ink` with "Edit connection" for a rejected token; "Show merged and closed" and "Show open only" toggle the list between open and all.
- **Inspector:** the commit inspector frame. The header shows `#number title`, the state chip, the author, and the text buttons Open in browser and Merge…; the body shows the description, the meta rows (Branches, Author, Created and Updated as absolute time with relative age, Mergeable in words or "—" with a tooltip, Address in mono), and Files with the status letter, left-truncated path, and +/- counts, with the totals in the section header.
- **Compose view (S77):** a center view of the workspace that replaces the create dialog: the platform and repository line; Source branch and Target branch owned Selects (defaults: the current branch and the remote's main); the comparison summary (commits, files, +/− lines) with a read-only commit list; the conflict prediction for source → target (S76), "No conflicts with <target>" with a check glyph or the conflicted files with Rebase; Title (defaults to the HEAD subject); the owned TextArea Description prefilled with the repository's pull request template; a Draft switch; the AI Generate wand with its disclosure note (S78); Cancel; and the primary "Create pull request", disabled with a visible reason while the title is empty or the comparison is being read. A warning-glyph note says when the source is not on the remote and that creating pushes it first; creating then shows "Pushing <branch> to <remote>…" and "Creating pull request…". Success returns to the graph, shows the branch's pull request badge (S75), and raises the toast "Created pull request #<n>" whose Show opens the inspector.
- **Merge confirmation:** an `alertdialog` titled "Merge pull request #<n>?" with the pull request title, the sentence that names both branches and the platform and says the merge happens on the server and cannot be undone from YForge, and the sentence that YForge then fetches all remotes; a lead line warns when the platform reports conflicts. Cancel is focused first; the confirm button is the primary "Merge pull request".
- **Entry points:** the sidebar section, the inspector, and the palette ("Create pull request…", "Merge pull request…", "Open pull request in browser…", and "Add platform connection…").

## Jira connections

Settings → Jira (rule S39, approved; proposal `jira-settings`).

- **Section:** the nav entry uses the neutral `issue` glyph (never a vendor logo). With no connection the section says "No Jira site is connected" and shows the Connect card; with connections it lists one card each and a "Connect a site" button.
- **Connect card:** a `segmented` radio group "Jira Cloud" and "Jira Data Center"; Site address (mono), Email (Cloud only), and API token or Personal access token (`password`, never filled from storage). The note reads "Stored in the macOS Keychain and never shown again". The primary button is "Connect" (`aria-disabled` with its reason line until the core accepts the fields), "Connecting…" with "Checking <host> and reading your projects…" while it runs. Editing adds the connection with the new token and removes the old one only after the add succeeds.
- **Site card:** the neutral glyph tile, the mono host over "Jira Cloud · Connected as <display name>", a `chip-success` "Connected" (check glyph), and Test, Edit, and Remove as 24px icon buttons named with the host; below, a key/value list with the projects ("ABC Accounts · WEB Website") and where the token lives. Test shows a `chip-success` "Connected as <display name>"; a refused token shows a `chip-danger` "Authentication failed" and an alert "Authentication failed for <host>" with text buttons "Edit connection" and "Test again". Remove confirms with a text-labelled danger button.

## Git hosts and the clone identity line

Settings → Git hosts and the Clone dialog (rule S40, approved; proposals `git-hosts` and `clone`).

- **Section:** the nav entry (after Jira) uses the `identity` glyph. With no identity the section states "No host identities yet", the muted sentence about the agent and the app-wide key, a primary "Add host" button, and a card "How YForge chooses an identity" with the four-step order (repository key, matching host, app-wide key, agent and `~/.ssh/config`). While the list loads it says "Loading Git hosts…" (`role="status"`, `aria-busy`). With identities the button is secondary and each identity is a card.
- **Identity card:** the neutral glyph tile, the mono host, and Copy public key (only when a `.pub` exists), Edit, and Remove as 24px icon buttons named with the host and carrying a tooltip. The key/value list shows the SSH key (mono path with `~`, then the kind and the shortened fingerprint, or "None: uses your SSH agent and ~/.ssh/config") and the HTTPS user. Copy public key copies the `.pub` text and the card shows "Copied the public key. Add it to your account on <host>." (`role="status"`, check glyph). A footnote says HTTPS passwords and tokens stay in Git's credential helper. Remove confirms with a text-labelled danger button and says the key files stay in `~/.ssh` and saved key passphrases stay in the Keychain.
- **Add and Edit form:** replaces the list ("Add host" or "Edit host"): Host (mono) and "HTTPS user name (optional)" side by side, then the SSH key field (mono path input with the key glyph) with "Choose key file…" (opens the picker in `~/.ssh`). Below it, the generation block: "New key file" (mono input, prefilled from the core with `~/.ssh/yforge_<host>`, port dropped, and following the host until the user edits it; it takes the invalid treatment and an error note with the core's reason when a file already exists there or the parent is not a folder), "Passphrase (optional)" (`password`, lock glyph) with the note that YForge saves it in the macOS Keychain, keyed by the key file, and never writes it to a file, and "Generate key" (`aria-disabled` with its reason as the tooltip until the host and path are accepted, and again after a success until the path changes). Generating sets `aria-busy` on the button ("Generating ed25519 key…") and shows the status line "Writing <the path in the field> and its .pub…"; then it fills the SSH key field, clears the passphrase, and shows "Generated <path>." (with "The passphrase is saved in the macOS Keychain for this key file." when one was given) and a Copy public key button. Save host is `aria-disabled` with its reason as the tooltip until the core accepts the host and key; Cancel leaves nothing saved.
- **Refused key:** the key input takes the invalid treatment and an `alert` shows the core's title in `danger-ink` ("That is a public key" or "That is not an SSH private key"), its detail ending "Nothing was saved.", and a "Choose key file…" button. A refused save shows the core's message as an error note.
- **Clone dialog identity line:** an `identity` row between the URL and the destination: the identity glyph and "Type a URL to see which identity it uses." until the URL is valid, "Checking which identity this URL uses…" while the debounced (250 ms) core call runs, then a strong "Uses the <host> identity" over the mono key path (SSH), "SSH with your SSH agent and ~/.ssh/config" (SSH, no key), or "HTTPS as <b>user</b>; the password or token comes from the macOS Keychain, or YForge asks once and can save it there." (HTTPS), with a "Change" button that closes the dialog and opens Git hosts. With no match it reads "Uses the app-wide SSH key" over the key path, "Uses your SSH agent and ~/.ssh/config", or for HTTPS "No host identity matches"; a local path says "No identity is used". A failed lookup says "Could not read the identity for this URL" with the reason.
- **Clone states:** while cloning the row stays, the progress line shows the phase and percent, and "Cancel clone" cancels and removes the partial folder. When an SSH host identity's key is refused (`auth_failed`) the dialog shows an `alert` "<host> refused the key" with git's "Permission denied (publickey)." line, "Add the public key to your account on <host>, or choose another key for this host. Nothing was written to <parent>.", and the buttons Copy public key (then "Copied the public key.") and "Edit host identity"; the primary button reads "Try again".

## Jira issues and issue chips

Rule S39 (approved; proposal `jira-sidebar`).

- **Sidebar section:** "Jira issues" with the `issue` glyph and the count, present only while a Jira connection exists. A row is the pull-request row layout: the key in mono and a status chip with the status word (plain for To Do, `chip-info` for In Progress, `chip-success` for Done), the summary on the second line; Create branch from issue and Open in browser are 24px icon buttons named with the key (visible on focus and selection) and are also in the row menu (⇧F10, Enter). Empty: "No open issues assigned to you". Loading: "Loading issues from <hosts>…". A failing site is stated in `danger-ink` text with Retry and, for a refused token, Edit connection, while the other sites' issues stay listed. The sidebar filter matches key, summary, and status.
- **Issue inspector:** activating a row (click or Enter) opens the inspector in the commit inspector frame: "Issue <KEY>" over the mono site host and project name, the summary in `ui-strong`, a status chip toned by category (plain To Do, `chip-info` In Progress, `chip-success` Done) and a plain type chip, a line "Assigned to you" (or the assignee's name, or "Unassigned") · "Updated <age> ago", the note "Read-only. Status and comments change in Jira.", and a text button "Open in browser". An issue that has left the open list says so in text. The row menu is opened with the context menu key or ⇧F10.
- **Create branch:** the create-branch popover opens with the name `<KEY>-<summary slug>` filled in and editable, starting at HEAD; nothing is written to Jira.
- **Chip:** a `chip` with the 14px `issue` glyph and the key in mono (`rounded.md` corners). The tooltip reads "KEY · summary · Status", or "KEY · issue details unavailable" (with the failure text when a site could not be reached). Chips appear after the subject in graph rows (also for keys in a row's branch labels), after branch names and pull request titles in the sidebar, in the pull request inspector header, and in the commit inspector's Issues row, which also states the summary and status in text.

## Launchpad

Rule S41 (approved; proposal `launchpad`).

- **Entry points:** it is the landing screen of a window with no repository and of a new tab (`/launcher`), a "Launchpad" icon button in the tab bar (toggles back to the active tab), and the palette command "Open Launchpad". The route is `/launchpad?tab=<active tab id>`.
- **Frame:** a head with the `launchpad` glyph, "Launchpad", "Updated <age> ago", and a Refresh icon button; a tab list "My pull requests", "My issues", "WIPs", each with its count in a pill (an ellipsis while nothing has answered); a search field named "Search Launchpad" and a "Source" Select (hidden on WIPs).
- **My pull requests:** per-source status lines (sync glyph "Reading <host> …", check glyph "<host>: 2 pull requests", warning glyph with the failure); an alert naming each failing source with Retry and, for a refused token, Edit connection; rows grouped "Waiting for your review · n" then "Authored by you · n". A row shows `#number title`, `owner/repo`, mono `source → target`, "by <author> · <age> ago", issue chips for keys in the title or branch, and a chip "Review requested" (`chip-attention`), "Draft", or "Open". Clicking opens the repository tab with the pull request in its inspector when the repository is a recent repository, else the pull request in the browser; an icon button opens the browser. With no connection: "No pull request service is connected" and Connect GitHub, Connect GitLab, and Connect Bitbucket (each opens Settings → Platforms with that platform chosen).
- **My issues:** the same status lines per Jira site, rows with the key in mono, summary, issue type, project, a status chip, and an Open in browser icon button (the row opens the issue in the browser); "No open issues assigned to you"; with no site: "No Jira site is connected" and Connect Jira (opens Settings → Jira).
- **WIPs:** recent repositories with uncommitted changes or unpushed commits: name, mono branch, "2 uncommitted changes · 1 unpushed commit", the path; the row opens the repository tab. Empty: "No recent repository has uncommitted changes or unpushed commits."
- **Read-only:** the screen ends with the note that it never changes a pull request, an issue, or a repository.
