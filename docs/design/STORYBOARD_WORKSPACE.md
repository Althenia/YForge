# Storyboard: Main repository workspace (S02 with S03/S04 inspector)

- **Status:** approved 2026-09-29.
- **Rules revision:** `DESIGN.md` + `app/DESIGN.md`, alpha, 2026-09-29.

## Priority list

| Rank | Content or action | Smallest-class treatment (960×600) |
|---|---|---|
| 1 | State strip: HEAD, branch → upstream, ↑↓, changes, operation + actions | Full row; freshness becomes an icon; the operation banner never collapses |
| 2 | Graph rows: ref labels, lanes, node, summary | GitKraken's three default columns only (Branch / Tag, Graph, Commit message); optional columns stay hidden |
| 3 | Changes entry + commit composer | Changes row is always on top; the inspector is an overlay drawer (⌘1 / click) |
| 4 | Sync ▾, Branch, Stash ▾, Undo, Palette, Search | Icons only with tooltips; priority overflow `⋯` for Stash and Undo |
| 5 | Sidebar refs (Branches, Remotes, Tags, Stashes, Worktrees) | 48px rail; a section opens as an overlay list |
| 6 | Inspector details (commit, ref) | Overlay drawer 320px |
| 7 | Activity bar | Hidden below 700px height; accessible from the palette and toasts |

## Frames per size class (smallest first)

| Class | Range | Regions in order | Navigation | Truncates or collapses | Reflow pattern | Mockup |
|---|---|---|---|---|---|---|
| minimum | 960–1023 | Tabs · command bar · state strip · rail · graph · drawer | Rail + palette | Optional graph columns stay hidden; toolbar labels hidden | Rail to drawer (3), column drop (2), toolbar overflow (8) | Not rendered (specimen at 1280 approximates it) |
| compact | 1024–1279 | Tabs · command bar · state strip · rail · graph · inspector 320 | Rail + palette | The optional Author column as initials; toolbar labels by priority | Rail to drawer (3), toolbar overflow (8) | Not rendered |
| medium | 1280–1439 | Tabs · command bar · state strip · sidebar 220 · graph · inspector 340 · activity | Sidebar | The optional Author column as initials | — | `specimens/renders/workspace-dark-1280x720.png`, `workspace-light-1280x720.png` |
| large | ≥1440 | Tabs · command bar · state strip · sidebar 248 · graph · inspector 372 · activity | Sidebar | — | — | `specimens/renders/workspace-dark-1440x900.png`, `workspace-light-1440x900.png` |

## Capability frames

| Frame | Condition | Difference from the base frame | Mockup |
|---|---|---|---|
| Fine pointer, hover | Mouse or trackpad | Hovering a row shows its ghost branch label; hovering a ref label highlights that branch's commits; both are mirrored on focus | `specimens/renders/workspace-dark-highlight-1440x900.png` |
| Keyboard only | No pointer | Focus ring on the active row; F6 region cycling; menus via ⇧F10 | Review-only |
| Reduced motion | `prefers-reduced-motion` | Instant state changes; static "In progress…" | Review-only |
| Short window | Height < 700 | Activity bar hidden; composer description collapsed | Review-only |

Phone, landscape-phone, and on-screen-keyboard frames do not apply: YForge is desktop only.

## States

| State | Frame or note |
|---|---|
| Empty (unborn branch) | S26: state strip reads "main (unborn) · no commits yet"; the graph area explains; the composer is active |
| Clean tree | The Changes row reads "Working tree clean"; the inspector shows the clean state with "Create branch…" |
| Loading | The state strip renders first; lane skeletons at fixed row height; stale rows stay visible during refresh |
| Operation in progress | The state strip becomes the operation banner "Rebasing feature/greeting onto main · 1/1 · 1 conflict [Resolve] [Continue] [Abort]" (`specimens/renders/workspace-dark-rebase-1440x900.png`) |
| Error | The banner switches to `banner-danger` ("Push rejected · origin/main has 2 new commits [Pull (rebase)] [Details]") |
| Longest real content | 60-character branch names truncate at the end in ref labels, with the full name in the tooltip; 72+ character summaries truncate at the end; lane colors repeat every 10 columns |

## Themes

Themes reviewed in the specimens: Dark (base), Light.

## Approval

Approved by the user on 2026-09-29 (Phase 8) for rules revision alpha.
