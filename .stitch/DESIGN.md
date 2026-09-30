# YForge: Stitch design brief

## Authority and scope

- **Binding rules:** `DESIGN.md` and `app/DESIGN.md` in the YForge repository win over any Stitch near-match. Stitch screens are proposals, not implementation.
- **Product:** YForge, a standalone desktop Git client. It is dense, professional, and keyboard-friendly, and it is built with a Rust core and a Vite + SolidJS UI.
- **Viewports:** 1440×900 is the primary design viewport; 1280×720 must also work.
- **Base theme:** dark, on the lean "Y aurora". A light theme also exists and has no aurora.
- **Reference render:** `docs/design/specimens/renders/workspace-dark-1440x900.png` (specimen `docs/design/specimens/workspace.html`).

## Look (dark)

- **Backdrop:** near-black `#0B1115` with two very faint, soft glows behind everything: green `#27D17F` at about 16% from the upper left and teal `#15A0BF` at about 10% from the right. This is the only gradient in the product.
- **Panels:** three flat floating panels (sidebar, graph, inspector) with 14px corners, a 10px gap between them and around them, a 1px border of white at 12%, and a soft dark shadow. Sidebar and inspector are `#11181D` at 70% opacity; the graph panel is `#0E151A` at 90%.
- **Bars:** the tab bar, command bar, state strip, and activity bar have no background of their own. Every item in them is a flat control: fill `#0C1217` at 66% with a 1px inset line of white at 7%.
- **Flat everything else:** no gradient borders, sheen, glows, neon, or glowing buttons.

## Color roles (dark)

- **Surfaces:**
  - backdrop `#0B1115`: window background;
  - canvas `#0E151A`: graph, diff, inputs;
  - surface-1 `#11181D`: sidebar and inspector panels;
  - surface-2 `#0C1217`: tabs, chips, buttons, command field, breadcrumb;
  - surface-3 `#182229`: active tab, hover;
  - raised `#151E24`: composer card, menus, palette, dialogs, toasts.
- **Lines:** hairline white at 7%; panel border white at 12%; input boundary `#718278`.
- **Text:** `#F4F7F6`; muted `#99A2AD`; subtle `#7D8792` (graph column header only). Text never sits directly on the backdrop.
- **Semantic:**

  | Role | Color | Paired color | Meaning |
  |---|---|---|---|
  | accent | `#4EE29B` | text on accent `#04150C`; tint `#12332A` | Primary action, success, in sync, current branch name, focus ring |
  | attention | ink `#F7D37C`; junction ring `#F0BE62` | tint `#302F27` | HEAD junction in the state strip, pending work, operation banner |
  | danger | `#EF6F6F` | tint `#2E2226` | Destructive, errors, deleted |
  | info | `#79B8FF` | tint `#2A3746` | Links, informational banners |

- **Selection:** row fill `#122F28`, plus a 2px inline-start bar in the accent color. Graph rows use the fill plus the full-opacity lane strip instead of the bar.
- **File status:** always shown as a letter plus its color:

  | Status | Letter | Color |
  |---|---|---|
  | Added | A | `#4EE29B` |
  | Modified | M | `#F7D37C` |
  | Deleted | D | `#EF6F6F` |
  | Renamed | R | `#79B8FF` |
  | Untracked | U | `#5CD2DC` |
  | Conflicted | ! | `#F28BC7` |

- **Graph lanes** (GitKraken's palette, colored by column index; column 0 is the leftmost lane):

  | Column | Line | Label fill | Checked-out label fill |
  |---|---|---|---|
  | 0 | `#15A0BF` | `#0F2E38` | `#114A59` |
  | 1 | `#0669F7` | `#0D2442` | `#0B356E` |
  | 2 | `#8E00C2` | `#251138` | `#3F0D5A` |
  | 3 | `#C517B6` | `#2F1536` | `#541655` |
  | 4 | `#D90171` | `#33112A` | `#5B0D3B` |
  | 5 | `#CD0101` | `#301116` | `#570D10` |
  | 6 | `#F25D2E` | `#37221E` | `#653022` |
  | 7 | `#F2CA33` | `#37361E` | `#655A24` |
  | 8 | `#7BD938` | `#22381F` | `#375F25` |
  | 9 | `#2ECE9D` | `#143632` | `#1A5B4C` |

  Label and message text `#C3C4C6`; checked-out and hovered label text `#FFFFFF`; inline description `#9FA1A3`; dimmed rows `#3E4448`; hovered row `#1A2125`; time pills `#21282C` with muted text.

## Color roles (light)

- **Look:** no aurora; backdrop `#F7F9F8`; panels, bars' controls, and canvas are opaque white with a 1px border `#D5DBD8` and a very soft shadow.
- **Surfaces:** canvas and panels `#FFFFFF`; hover and active tab `#F3F6F5`; raised `#F7F9F8`.
- **Lines:** hairline `#E4E8E6`; panel border `#D5DBD8`; input boundary `#78847E`.
- **Text:** `#0B0F14`; muted `#5C6672`; subtle `#646D78`.
- **Semantic:**
  - accent fill `#0B8550` with white text; accent ink `#0A7B47`;
  - HEAD junction ring (state strip) `#B87800`;
  - attention tint `#F6F0E0` with ink `#946200`;
  - danger `#C53A3A`;
  - focus `#0B8B50`;
  - selection `#E1F9ED`.
- **File status:**

  | Status | Letter | Color |
  |---|---|---|
  | Added | A | `#0A7B47` |
  | Modified | M | `#946200` |
  | Deleted | D | `#C53A3A` |
  | Renamed | R | `#1C64C2` |
  | Untracked | U | `#0A6D76` |
  | Conflicted | ! | `#AE2C73` |

- **Graph lanes** (the same lines as dark; label fills are the lane mixed 18% into white, checked-out 38%):

  | Column | Line | Label fill | Checked-out label fill |
  |---|---|---|---|
  | 0 | `#15A0BF` | `#D5EEF3` | `#A6DBE7` |
  | 1 | `#0669F7` | `#D2E4FE` | `#A0C6FC` |
  | 2 | `#8E00C2` | `#EBD1F4` | `#D49EE8` |
  | 3 | `#C517B6` | `#F5D5F2` | `#E9A7E3` |
  | 4 | `#D90171` | `#F8D1E5` | `#F19EC9` |
  | 5 | `#CD0101` | `#F6D1D1` | `#EC9E9E` |
  | 6 | `#F25D2E` | `#FDE2D9` | `#FAC1B0` |
  | 7 | `#F2CA33` | `#FDF5DA` | `#FAEBB1` |
  | 8 | `#7BD938` | `#E7F8DB` | `#CDF1B3` |
  | 9 | `#2ECE9D` | `#D9F6ED` | `#B0ECDA` |

  Label and message text `#191919`; inline description `#666666`; dimmed rows `#CCCCCC`; hovered row `#F3F6F5`.

## Typography

- **UI text:** the product uses Geist Sans, bundled with the app.
- **Code and identifiers:** the product uses Geist Mono, bundled with the app.
- **Sizes:**
  - UI 13px/20px (buttons and tabs 500, primary buttons 600); metadata 12px/16px; chips 12px 500; section labels 12px 600; micro 11px;
  - inspector and dialog titles 16px/22px semibold;
  - graph messages and ref labels in sans 12px/16px (the checked-out label at 500); graph tags in mono 11px; the graph header and time pills at 10px; author initials at 10px bold;
  - code, SHAs, paths, and branch names outside the graph (sidebar rows, breadcrumb, state strip refs) in mono 12px.
- **Case:** sentence case everywhere except the graph column header (BRANCH / TAG · GRAPH · COMMIT MESSAGE). NEVER uppercase section labels.

## Layout and components

- **Regions (px):**
  - tab bar 40;
  - command bar 48;
  - state strip 36;
  - panels with a 10px gap: sidebar 248 (220 below 1440), graph (fills the remaining width), inspector 372 (340 below 1440);
  - activity bar 30.
- **Rows:** graph 28 tall; sidebar rows 28 tall with 6px corners; file rows 32 tall.
- **Radius:** ref labels and tags 4px; rows, badges, tooltips 6px; buttons, inputs, command field, menus 10px; panels, composer, dialogs, palette 14px; tabs, chips, banners, time pills fully rounded.
- **Tab bar:** macOS window dots; pill tabs 28px tall; the active tab starts with a small "Y" tile (green letter on a faint green tint) and shows "2 worktrees" in muted mono; "+" and settings as 28px icon buttons.
- **Command bar:** a mono breadcrumb control "sample › main worktree › feature/greeting ▾" (branch in accent green); a centered search field "Search commits, branches, files, or run a command" with a ⌘K hint (up to 440px); buttons Sync ↑2 (primary green), Branch ⌘B, Stash, Undo ⌘Z.
- **State strip:** a row of pill chips, in this order: HEAD junction (lane-colored dot inside an amber ring) + "HEAD feature/greeting → origin/feature/greeting ↑2 ↓0"; "Changes M 1 U 1"; a green-tinted "✓ fetched 2 min ago"; and, at the right end, "2 worktrees · hotfix/wt-demo clean". During a merge or rebase, the chips are replaced by one amber-tint pill banner: operation, step "k of n", conflict count, and buttons Resolve (primary), Continue, Skip, Abort (danger outline).
- **Sidebar:** section labels in muted 12px semibold with count pills; branch rows in mono; the current branch row has the selection fill and a short 2px green bar at its left edge.
- **Inspector:** title "Changes" with "on feature/greeting · 2 files"; file rows with a 20px status-letter tile; an empty staged list shown as a dashed box with guidance; the composer is a raised card with a Summary field (counter), a Description field, a primary "Commit 2 files" button, and "Amend".
- **Depth:** panels and overlays only; overlays (menus, palette, dialogs) carry a soft shadow plus a 1px border.
- **Graph** (GitKraken's graph topology with YForge's tinted Rail styling):
  - **Columns:** BRANCH / TAG 130px, GRAPH 150px, COMMIT MESSAGE fills. The header is 30px with uppercase 10px subtle labels and a gear at the end.
  - **Lanes:** a 28px gutter, then lanes every 22px. Lane color follows the column index, and columns are reused leftmost-first.
  - **Edges:** 2px and orthogonal, vertical inside a lane and horizontal on a node's row, with 11px rounded corners. Changes and stash edges are dotted.
  - **Nodes:** commit = a 22px disc in the lane color with bold 10px author initials in black or white; merge = a 12px solid dot; Changes row = a 22px dotted ring; stash = a 22px dotted square with a box glyph.
  - **Ref labels (tinted Rail):** 22px tall, a solid dark lane-tinted fill (label fill column) with a 3px lane-color bar at the left edge, 4px corners on the right, sans 12px, with glyphs after the name (laptop = local, cloud = remote, worktree). The checked-out branch has a check and the stronger checked-out fill. Tags have no lane bar: a solid neutral fill (`#21282C` dark, `#F3F6F5` light), a thin neutral outline, mono 11px, and a tag glyph. Labels are opaque, so connector lines stop at their edge. A thin lane-color line runs from each label to its node; `+N` opens the other refs; tags are never hidden.
  - **Rows:** no colored band across the row. A 2px lane strip at 60% opacity sits where the message starts (full opacity on the selected row); relative-time pills ("3 weeks ago") at the right edge.
  - **HEAD:** no ring in the graph; the state strip carries the HEAD junction glyph.
- **Buttons:** primary uses the accent fill; secondary uses the control fill with a 1px inset line; danger is an outline in the danger color and is never the default focus.

## Prohibitions

- NEVER use GitKraken branding, logos, mascots, illustrations, or chrome styling; only the commit graph's topology follows GitKraken's conventions.
- NEVER use gradients anywhere except the faint dark backdrop glows; no glowing, gradient, or neon borders, buttons, or text.
- NEVER use dashboard cards, emoji, or marketing copy.
- NEVER use hover-only actions or color-only status.
- NEVER show a product account, sign-in wall, plan badge, or upsell.

## Verification

Each exported screen is rendered at 1440×900 and 1280×720 and checked against the YForge DESIGN rules. The checks cover:

- token fidelity;
- text contrast of at least 4.5:1;
- no horizontal overflow;
- staging lists showing at least 4 rows at 720 height.
