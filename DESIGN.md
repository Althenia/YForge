---
version: alpha
name: YForge brand
description: Identity of YForge, a standalone local-first desktop Git client, shared by its app, marks, and touchpoints.
surface: brand
colors:
  trace: "#27D17F"
  tide: "#15A0BF"
  frost: "#F4F7F6"
  attention: "#F0BE62"
  mark-surface: "#11181D"
  mark-rule: "#263039"
  mark-canvas: "#0B1115"
  neutral-ink: "#0B0F14"
  neutral-paper: "#FFFFFF"
  icon-arm: "#67D7A4"
  icon-ink: "#F2F3F5"
  icon-container: "#24282F"
  icon-rule: "#3A404A"
typography:
  display:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
motion:
  duration:
    quick: "120ms"
    base: "180ms"
    slow: "240ms"
  easing:
    standard: "cubic-bezier(0.2, 0, 0, 1)"
    entrance: "cubic-bezier(0, 0, 0, 1)"
    exit: "cubic-bezier(0.3, 0, 1, 1)"
icons:
  grid: 24
  sizes: [16, 20, 24]
  stroke:
    "16": 1.5
    "20": 1.6
    "24": 1.6
---

# YForge brand rules

## Overview

- **Audience and job:** developers who use Git all day. They need to read repository state instantly and change history safely.
- **Personality traits:**

  | Trait | Visual consequence |
  |---|---|
  | Precise | Mono for identifiers; aligned columns; exact counts |
  | Calm | Quiet charcoal surfaces told apart by tone; status color only for meaning |
  | Candid | Every risky action states its consequence |
  | Craftsmanlike | Dense, owned, flat controls; no decorative gradients, glows, or sheen |
  | Independent | Standalone, local-first; nothing in the brand implies an account or a cloud |

- **Anti-references:**
  - GitKraken's branding, mascot, illustrations, icons, fonts, and microcopy. Two things follow GitKraken by the owner's choice: the commit graph (P-G1) and the high-contrast separation of regions (tab bar darkest, distinct toolbar, panels lighter than the graph; 2026-10-03).
  - SaaS dashboard cards.
  - Gradient hero art.
  - Generated-looking gradient styling: glowing rims, sheen, neon glows, multi-hue gradient chrome.
  - Mobile-style oversized controls.
  - Emoji status.
- **Signature element:** the **HEAD junction**: a lane disc inside a warm Attention ring that marks the current position in the state strip, the "Y" in YForge. The commit graph follows GitKraken's conventions and marks HEAD with a checked-out label instead (P-G1).

## Principles

- **Identity through structure, not ornament.** Layout, the junction signature, glyph grammar, and voice carry the brand in every theme, so user theme changes never erase it.
- **Separation, not decoration.** Every region is an opaque surface told apart by tone: the bars on the darkest backdrop, rounded panels lighter than the graph, recessed fields, raised overlays. Chrome, controls, text, and marks stay flat; only a lane-color fade within graph rows may use an opaque gradient.
- **One palette, owned here.** The primitives in the front matter are YForge's own and derive from the Y family baseline (B9); the app's surface neutrals and selection are the owner-chosen charcoal palette, a recorded B9 exception. Surface roles are derived per theme in the surface file.
- **Explicit state beats hidden state.** Git's most dangerous moments (rebase, conflict, force push, detached HEAD) get the most orientation, never the least.
- **Local-first trust.** The brand never implies a cloud dependency: no account prompts, plan badges, or upsell surfaces.

## Rules

| ID | Status | Binding statement | Enforcing check |
|---|---|---|---|
| B1 | approved | Every core Git workflow MUST work without an account or a network service. | review-only: approved 2026-09-29 |
| B2 | approved | Outside the commit graph, the Attention hue MUST mark only HEAD and pending work; NEVER use it as decoration. | review-only: approved 2026-09-29 (P-G1) |
| B3 | approved | Every visible control MUST use an owned token or component; NEVER ship an unstyled platform default, except forced-colors rendering. A right-click MUST open an owned menu or nothing: the platform or web-view context menu MUST NEVER appear anywhere in the window. | review-only: approved 2026-09-29; right-click clause `app/src/App.test.tsx` · approved 2026-10-03 by the owner |
| B4 | approved | State MUST NOT be conveyed by color alone; every status color MUST pair with a glyph, letter, or text. | review-only: approved 2026-09-29 |
| B5 | approved | YForge marks MUST come from the approved YForge mark source; NEVER substitute another product's mark. | review-only: approved 2026-09-29 |
| B6 | approved | Operational copy MUST name the Git operation and its consequence; NEVER use playful or marketing wording in operational UI. | review-only: approved 2026-09-29 |
| B7 | approved | Motion MUST be functional; all motion MUST have a reduced-motion variant. | review-only: approved 2026-09-29; the ambient aurora drift withdrawn 2026-10-03 by the owner |
| B8 | approved | NEVER use gradients, glows, sheen, translucency, or blur on any surface, control, text, or mark, except an opaque horizontal lane-color fade inside commit-graph rows that resolves into the graph canvas or selected-row fill; it MUST NOT spread to chrome or other components. | review-only: graph-only exception approved 2026-10-04 by the owner after visual review |
| B9 | approved | Neutral, text, border, focus, accent, status, and app-icon construction values MUST derive from the Y family baseline as recorded in the YQuery design system (`YDS/YQuery/DESIGN.md`, §Colors and §App icon); every departure from a Y-family rule MUST be a row in Exceptions. | review-only: compare with `YDS/YQuery/DESIGN.md` and `tokens/tokens.css`; visual comparison in `docs/design/review/y-family.html`; approved 2026-09-30 |

## Colors

The front matter holds the brand primitives, aligned with the Y ecosystem palette:

- **Trace:** growth and success.
- **Tide:** the secondary brand hue (graph lane 0).
- **Frost:** light ink on dark.
- **Attention:** the warm junction.
- **The three mark neutrals:** build the mark and the About window; the app surfaces use the charcoal palette in the surface file.
- **`neutral-ink` and `neutral-paper`:** anchor the light theme.

The surface file ([app/DESIGN.md](app/DESIGN.md)) derives semantic roles per theme. The light theme darkens Trace and Attention to reach text contrast, because the primitives alone are below 4.5:1 on white.

## Typography

- **Sans:** Geist Sans for UI and commit prose.
- **Mono:** Geist Mono for SHAs, ref names, paths, diffs, commands, and the wordmark.
- **Delivery:** both families are bundled with the app under the SIL Open Font License (`brand/fonts/`), so there are no hosted fonts and the app works offline. System fonts are only the fallback.
- **Rendering:** text renders with grayscale antialiasing (`-webkit-font-smoothing: antialiased`), the rendering Geist is drawn for; without it macOS thickens light text on dark surfaces and Geist reads like the system font.
- **Hierarchy:** comes from weight (400/500/600), then size, then ink level. Letter case does not carry hierarchy: there are no uppercase section headers.

## Motion

Product motion is functional:

- hover and press feedback: `quick`;
- panel reveal: `base`;
- overlays: `slow`.

There is no ambient motion (B7). Graph relayout is instant or a short cross-fade; it never slides rows. Under reduced motion, every transition becomes an instant state change and indeterminate progress becomes static text.

## Icons

- **Grammar:** stroke icons on a 24-unit grid, with rounded caps and joins, in `currentColor`.
- **Sizes:**
  - 16 beside 12–13px text;
  - 20 in toolbars;
  - 24 standalone.
- **Stroke:** 1.5 units at 16px, 1.6 units at 20px and 24px, so strokes render at 1.0–1.6px.
- **Git objects:** node-kind icons (commit, merge, stash, working tree) share the graph's node shapes, so an icon and its graph node read as the same object. HEAD uses the junction glyph.

## Mark

**Status: approved 2026-09-30.** The mark belongs to the Y family: it shares the family icon grid, arms, and container with YCoding and YQuery. Each family product owns its stem. YCoding puts an Attention diamond at the junction, and YQuery stacks rows in the stem. YForge's stem is a Git trunk with a branch lane into an Attention commit node, the HEAD commit (B2). That stem makes the mark YForge's own (B5).

- **Source:**
  - `brand/yforge-app-icon.svg` (the logo: the mark in its container);
  - `brand/yforge-app-icon-small.svg` (16–32px variant with a heavier lane and node);
  - `brand/yforge-app-icon-macos.svg` and `brand/yforge-app-icon-small-macos.svg` (the macOS app-icon masters);
  - `brand/yforge-mark.svg` (the mark without its container, for dark surfaces only);
  - `brand/yforge-lockup.svg` (the logo with the wordmark and tagline);
  - PNG renders in `brand/renders/`.
- **Construction:** on the family 1024 grid:
  - the container: a `icon-container` rounded square (radius 176) with an 8-unit `icon-rule` border;
  - the family arms: an `icon-arm` left arm (196,194 → 348,194 → 602,542 → 422,542) and an `icon-ink` right arm and stem, with the stem 178 units wide from y 456 to 826;
  - the YForge branch: a 64-unit `icon-arm` lane leaving the stem at y 620 with a 60-unit rounded corner;
  - the commit node: an `attention` disc of radius 76 at (774, 750).
- **Colors:** only `icon-arm`, `icon-ink`, `icon-container`, `icon-rule`, and `attention`. They are the family mark colors, shared with the other Y products. Never recolor, outline, or add effects.
- **Use:**
  - The logo (mark in its container) is the default everywhere, including the Launcher and the app icon; the tab bar carries no mark (app S28).
  - The bare mark appears only on `mark-canvas` or darker, where the `icon-ink` stem stays visible.
  - Below 40px, use the small variant.
- **Lockup:** the logo followed by the wordmark "YForge" in Geist Mono Bold (`icon-ink`) and the tagline "local-first Git client" in Geist Mono Regular (`icon-arm`), outlined in the SVG. It is used on `mark-canvas`.
- **Clear space:** at least a quarter of the logo's width on every side.
- **Minimum sizes:** 16px for the logo (small variant), 120px wide for the lockup.
- **App icon:** the logo on the Y family macOS template, matching YCoding and YQuery: a 1024 canvas with the container drawn as an 824 rounded square (radius 185.4) centred in a 100-unit transparent margin, a 6.6-unit `icon-rule` hairline inside it, the mark scaled with the container, and no shadow or baked shading. `icon.icns` and the PNGs come from `brand/yforge-app-icon-macos.svg`, with its small variant for the 16 and 32px frames, `32x32.png`, and the 16, 24, and 32px `icon.ico` frames; `brand/renders/` holds the 1024 and 32px renders. Approved 2026-10-03 by the owner.

### Third-party marks

**Status: approved 2026-09-30 (owner delegation).** The one exception to B5: Settings → AI identifies the AI providers a user can choose with their own official marks, so the user recognizes the account or service behind a provider.

- **Source:** `brand/third-party/` holds the official files, byte-identical to the published downloads, with the source, date, terms, and sha256 of each in `brand/third-party/SOURCE.md`.
- **Use:** a mark renders only inside the provider card and provider row, scaled proportionally, in the published variant for the current theme (black or Ink on light, white or Cloud on dark), beside the provider name and never larger than it. Never recolor, crop, outline, animate, combine two marks, or place a mark next to the YForge mark.
- **Attribution:** Settings → AI states that the marks belong to their owners and imply no endorsement.
- **No mark, no permission:** a provider without a mark, or whose terms do not permit its mark in an app, uses a neutral glyph from the icon set. Claude Code uses the terminal glyph until Anthropic grants written permission.

## Content

- **Voice:** direct, calm, second person, sentence case.
- **Names:**
  - Git's real verbs (commit, fetch, pull, push, merge, rebase, cherry-pick, reset, revert, stash).
  - "Changes" for the working tree.
  - "Worktree" for linked working directories.
- **Errors** state what happened, what is safe, and the next action.
- **Confirmations** name the objects and the consequence ("Reset feature/greeting to 1a2b3c4 and discard 3 uncommitted changes").
- **Truncation:** ellipsis `…`; paths truncate from the left.

## Touchpoints

| Touchpoint | Rule |
|---|---|
| App icon | `brand/yforge-app-icon.svg` (small sizes from `brand/yforge-app-icon-small.svg`), the approved Y family logo |
| About window, splash | Wordmark on `mark-canvas`; no illustration |
| Notifications | Mark-derived badge; operation outcome text only; no marketing notifications |
| CLI (`yforge <path>`) | Opens or focuses the repository; `--version` prints the product name and version only |
| Launchpad | The landing screen of a window or a new tab; built from surface tokens, with no logo or wordmark |
| Empty and error views | Built from surface tokens; no logo or wordmark |

## Accessibility

- **Target:** WCAG 2.2 AA in every shipped theme:
  - text 4.5:1;
  - large text and meaningful boundaries 3:1;
  - visible focus;
  - full keyboard access;
  - no color-only state;
  - reduced motion.
- **Screen readers:** the graph offers a text alternative per row, so its meaning never depends on color or position alone.
- **Measurement:** token contrast is necessary but not sufficient; it is measured in renders.

## Verification

- Strict lint of this file and the surface file:
  - `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint DESIGN.md --strict`
  - `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict`
- B1–B9 are review-only until implementation provides:
  - a token source;
  - a repository drift test;
  - render checks.

## Maintenance

- Revise the rule first.
- Obtain approval for changed values or behavior.
- Update consumers, tests, and this chain in the same change.
- Run the strict lint and, once code exists, the repository drift check.

## Do's and Don'ts

- Do use owned tokens and the approved mark. Do test both themes, keyboard use, and conflict and error states.
- Don't copy GitKraken assets, icons, fonts, code, or microcopy; its graph conventions (P-G1) and its separation of regions by tone (2026-10-03) are the approved models. Don't use the Attention hue decoratively. Don't add gradients outside the scoped graph-row fade, glows, sheen, translucency, or blur (B8). Don't hide a necessary action behind hover. Don't call an unrun render check verified.

## Exceptions

| Rule | Scope | Reason | Approved by | Review date |
|---|---|---|---|---|
| Anti-references; Do's and Don'ts (GitKraken trade dress) | Commit graph only (surface rule S13) | The owner requires the graph to match GitKraken exactly | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| B8 | Commit-graph row bands only: opaque horizontal lane-color fade into canvas or selection fill | The owner chose the closer GitKraken graph treatment without extending gradients to chrome or other surfaces | User, 2026-10-04 | 2026-11-04 |
| B9 (Y family: shadow only on overlays, radii at most 4px, no pill shapes) | Panel elevation, `rounded.lg` and `rounded.xl`, pill chips and toasts | Panels and overlays need separation on the backdrop; Y web itself uses 6, 10, and 14px radii | User (family review, 2026-09-30) | 2026-10-31 |
| B9 (Y family: system UI font) | Typography: Geist Sans and Geist Mono | User directive for the Y CI typeface | User (family review, 2026-09-30) | 2026-10-31 |
| B9 (Y motion scale 80, 140, 220, 320ms) | `motion.duration`: quick 120ms, base 180ms, slow 240ms | Kept to avoid changing tuned consumers; `base` means 180ms here, 140ms in YQuery, and 220ms in Y | User (family review, 2026-09-30) | 2026-10-31 |
| B9 (YQuery icon grid: 16 units, stroke 1.4) | Icons: 24-unit grid, stroke 1.5 at 16px and 1.6 at 20 and 24px | The Git glyph set is drawn on the 24 grid; common chrome glyphs are not shared across products | User (family review, 2026-09-30) | 2026-10-31 |
| B9 (YQuery S12: text-only context menus) | Menu and palette rows: leading 16px icon slot, empty without an established glyph (surface rule S15) | User directive for icon-driven controls | User (family review, 2026-09-30) | 2026-10-31 |
| B5 (YForge marks only; another product's mark) | Settings → AI provider cards and rows: the OpenAI Blossom and the OpenRouter glyph, unmodified, as recorded in `brand/third-party/SOURCE.md` | The user must recognize which service a provider connects to; each publisher's brand page permits the unmodified mark to identify its service (OpenAI's Design Guidelines and usage terms; OpenRouter's brand assets page). Providers without a permitted mark use a neutral glyph | User (owner delegation, 2026-09-30) | 2026-10-31 |
| B9 (YQuery single accent) | Light theme: accent fill `#0B8550` (Y `primary-bg`) with `accent-ink` `#0A7B47` for text; YQuery uses `#0A7B47` for both | Filled controls keep the Y button green; text keeps AA on tonal chrome through `accent-ink` | User (family review, 2026-09-30) | 2026-10-31 |
| B9 (Y family neutral, text, border, and selection values) | App surfaces and ink in both themes: the charcoal palette in `app/DESIGN.md` colors (S14), with blue `selection` and `selection-edge` | The owner prefers GitKraken-style high contrast that tells regions and actions apart easily; chosen through the 2026-10 proposal rounds | User, 2026-10-03 | 2026-11-03 |
| Anti-references and Do's and Don'ts (GitKraken chrome trade dress); B7, B8, B9 (aurora, Y family surfaces) | Offline proposals under `docs/design/proposals/2026-10-kraken-contrast/`, `docs/design/proposals/2026-10-forge-contrast/`, `docs/design/proposals/2026-10-merge-tool/`, `docs/design/proposals/2026-10-two-pane-ai/`, `docs/design/proposals/2026-10-right-panel-ai/`, `docs/design/proposals/2026-10-flow-minimal/`, `docs/design/proposals/2026-10-launchpad-settings/`, and `docs/design/proposals/2026-10-table-command/` only | Explore a GitKraken-style high-contrast charcoal palette and layout for ease of use on solid opaque surfaces with no aurora: three tweaks of the current workspace and two GitKraken-based layouts, then five variants of the chosen Forge Contrast direction for conflict resolution (with an editable result), file history, and blame, then five workspace directions around the chosen Merge Tool (three lean, one fluid, one futuristic on the brand aurora and glass), then five Two Pane variants adding AI assistance, Settings, the Launchpad, and a tree view, and the same five with Changes back in the right panel, then the chosen Flow Sheet refined and five Launchpad and Settings variants on it. Candidate values (`--cand-*`) are proposals; production tokens and the mark stay unchanged | User, 2026-10-03: GitKraken's color scheme and layout are preferred for their high contrast and easy distinction between elements and actions; Forge Contrast chosen as the base for conflict, history, and blame variants; Merge Tool chosen as the base for three lean, one fluid, and one futuristic direction; Two Pane chosen as the base for AI, Settings, Launchpad, and tree view variants; Changes moved back to the right panel; Flow Sheet chosen and its Changes panel made minimal and icon-driven; five Launchpad and Settings variants requested on that workspace; the Table Launchpad and the Command Settings chosen | 2026-11-03 |
| Anti-references and Do's and Don'ts (GitKraken chrome trade dress); B7, B8, B9 (aurora, Y family surfaces) | Offline proposals under `docs/design/proposals/2026-10-themes/` only | Ten named themes on the current workspace, with GitKraken's Theme dropdown (a label, the theme name, and a chevron) as the control model and not its name, colors, or assets. YForge Dark stays the shipped default. YForge Light stays the shipped light theme. The other eight are Base16 schemes (Classic Dark, Ocean, Eighties, Gruvbox, Nord, Dracula, Monokai, Woodland): eight shades plus eight accents, so each status role has its own color. Lane colors stay the approved graph palette. Candidate values live only in the proposal token file; production tokens and the mark stay unchanged | User, 2026-10-04 | 2026-11-04 |
