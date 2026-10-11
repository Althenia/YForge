# Stitch Design Plan (Phase 9, runs only after approval)

- **Status:** plan only. No Stitch project, design system, or screen has been created. The one-time capability check used only catalog `search` and called no `tools.stitch.*` tool.
- **Precondition:** explicit approval of Phase 8, and answers to decisions D1–D3 in [YFORGE_PRODUCT_DIRECTION.md](YFORGE_PRODUCT_DIRECTION.md#open-decisions-owner-productuser).

## 1. Verified Stitch capabilities

Source: live tool catalog, schemas read 2026-09-29. Schemas are re-read before use.

| Tool | Use in this plan | Notes |
|---|---|---|
| `create_project` | One project, "YForge desktop (proposal)" | External write, authorized by the Phase 9 approval |
| `upload_design_md` → `create_design_system_from_design_md` | Dark design system from `.stitch/DESIGN.md` | `designMdBase64`; returns a screen instance, then an `assetId` |
| `create_design_system` / `update_design_system` | Light design system | Requires `theme.colorMode` (`LIGHT` or `DARK`), `customColor`, `roundness`. Fonts are enums or free-text family names. `namedColors`, `components`, and `designTokens` are output-only, so detailed roles travel through `designMd` |
| `generate_screen_from_text` | Every screen | `deviceType: DESKTOP`, optional `designSystem` asset, `modelId` (`GEMINI_3_8_FLASH` / `GEMINI_3_5_FLASH_LITE`). Takes minutes: never retry; on timeout, poll `get_screen` every 30s, up to 10 times |
| `generate_variants` | Light versions and state variants | 1–5 variants; `creativeRange: REFINE`; `aspects: [COLOR_SCHEME]` for theme variants |
| `edit_screens` | Critique fixes | By screen IDs + prompt |
| `apply_design_system` | Enforce Light tokens on variant screens | Needs screen-instance IDs from `get_project`; preservation of the layout is unverified |
| `get_project` / `list_screens` / `get_screen` | Read-back after every write | `htmlCode` and `screenshot` download URLs |
| `delete_project` | **Never** | Irreversible |

Constraints that shape the plan:

- **One color mode per design system.** Two design systems: **YForge Dark** (base) and **YForge Light**.
- **No width or height input.** DESKTOP output measured 1512×1104 in a previously reviewed Stitch project. The targets 1440×900 and 1280×720 are verified by rendering the exported HTML (§5).
- **No reusable component symbols.** A component sheet screen is generated first and referenced in every prompt; tokens are enforced by the design systems.
- **Fonts.** Exported HTML links Google Fonts (observed in the same prior project). Stitch output uses Geist for UI, as the product does, and JetBrains Mono for code as a stand-in for the product's Geist Mono. The font links are a Stitch-only exception that is recorded, not a product rule.

## 2. Inputs to create at Phase 9 start

1. **`.stitch/DESIGN.md`:** a Stitch brief derived from [app/DESIGN.md](../app/DESIGN.md) and [../DESIGN.md](../DESIGN.md). It is reconciled, not copied, following the frontend-workflow Stitch reference. It contains:
   - authority (the repo DESIGN chain wins over Stitch near-matches);
   - token roles with hex values for the dark theme;
   - component vocabulary;
   - prohibitions;
   - verification sizes.
2. **The design systems:**

   | System | colorMode | customColor | roundness | Fonts (headline / body / label) | designMd |
   |---|---|---|---|---|---|
   | YForge Dark | `DARK` | `#4EE29B` (accent) | `ROUND_EIGHT` | Geist / Geist / JetBrains Mono | Dark roles (lean Y aurora) |
   | YForge Light | `LIGHT` | `#0B8550` (accent) | `ROUND_EIGHT` | Geist / Geist / JetBrains Mono | Light roles |

3. **Sample data:** only the sandbox repository content from [research/GITKRAKEN_HANDS_ON_LOG.md](research/GITKRAKEN_HANDS_ON_LOG.md) and the specimens. Never real repository names, paths, users, or accounts.

## 3. Screen list and order (primary workflow first)

Screen IDs refer to [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md). Every screen is generated in **Dark**. A **Light** variant is generated only where marked, as the representative theme set; the other screens inherit Light through the shared tokens and are not duplicated.

| # | Stitch screen | Inventory | Required states in the prompt | Light variant |
|---|---|---|---|---|
| 0 | Component sheet | app/DESIGN.md §Components | See the list below the table | ✓ |
| 1 | Main Repository Workspace | S02 + S03 | Clean graph with branches, tags, stash, and Changes row; ahead/behind; worktree lanes | ✓ |
| 2 | Working Tree + Commit State | S03 | Unstaged/staged/untracked with letters; partial staging; composer with summary guide; Commit & Push | ✓ |
| 3 | Commit Selected / Inspector | S04 | Merge commit with two parents, refs, file list | — |
| 4 | Diff Viewer | S07 | Hunk mode with Stage/Discard hunk; line selection; split mode variant | ✓ |
| 5 | Branch Context Actions | S12 | Branch menu in grouped order; drop menu with result preview | — |
| 6 | Pull / Push / Sync State | S10, S11 | Sync menu; fetching progress; force-with-lease dialog listing remote commits | — |
| 7 | Merge Conflict State | S08 | Operation banner "Merging origin/main into main · 1 conflict"; conflicted list | — |
| 8 | Conflict Resolver | S09 | Current/Incoming panes named by branch and role; Result pane with C/I markers; rebase-roles variant | ✓ |
| 9 | Command Palette | S21 | Argument step "Rebase onto…" with ref picker; disabled command with reason | — |
| 10 | Repository Launcher | S01 | Recents with status chips; empty-recents variant | ✓ |
| 11 | Clone Repository | S17 | URL + destination preview; progress; auth prompt inline | — |
| 12 | Git Provider Authentication | S19, S20 | HTTPS credential prompt; SSH passphrase; host key; GitHub device flow (Post-MVP) | — |
| 13 | Repository Settings | S25 | Identity override with value source; remotes list | — |
| 14 | Application Settings | S24 | Search, sections, theme and density controls, GitHub (Post-MVP) placeholder | ✓ |
| 15 | Empty Repository State | S26 | Unborn branch, untracked files, first-commit composer | — |

The component sheet (#0) covers:

- buttons (primary, secondary, danger, icon, split);
- tabs, chips, command field, breadcrumb;
- ref labels in the tinted Rail treatment (10 lane tints and edges, checked-out fills, local/remote/both, tag, worktree, `+N`);
- named status icons;
- graph node shapes;
- state strip (idle, operation, error, detached);
- menu, palette, toast, tooltip, dialog, input;
- sidebar row;
- file row;
- diff hunk;
- conflict block.

State variants are generated with `generate_variants` (`REFINE`, 1 variant) from screen 1 or 7:

- detached HEAD (S27);
- offline and authentication error (S28);
- rebase in progress, step 2 of 5;
- loading (skeleton lanes);
- 1280×720 compact composition (hint in the prompt; verified in §5).

## 4. Prompt template

```text
YForge desktop Git client, dense professional tool, design target 1440×900 (must also work at 1280×720).
Use the attached YForge <Dark|Light> design system exactly; do not invent colors, fonts, or radii.
Regions (px): tab bar 40 · command bar 48 · state strip 36 · sidebar 248 · graph fills · inspector 372 · activity bar 30.
Screen: <inventory ID and name>. Purpose: <purpose>.
Content (sample repository "sample"): <rows/files/refs from the sandbox>.
States to show: <states>.
Rules: status colors always paired with named icons from the shared S3 mapping; SHAs, paths, and refs outside the graph in mono; the commit graph follows GitKraken's graph topology with Rail styling (PROMPTS.md GRAPH);
the state strip is always visible; destructive buttons use danger styling and are never the default.
Never: GitKraken branding, logos, or chrome styling, mascots, illustrations, gradients outside the dark backdrop glows, glows or sheen, cards, uppercase section labels (the graph header excepted), marketing copy.
```

## 5. Verification loop (per screen)

1. **Read back:** `get_screen` → download `htmlCode` and `screenshot`. Record the screen ID, size, and design-system asset.
2. **Render:** the exported HTML in headless Chromium at 1440×900 and 1280×720. Light screens are rendered in Light; the rest in Dark. Use the same method as [design/specimens](design/specimens/).
3. **Check against [app/DESIGN.md](../app/DESIGN.md):**
   - token fidelity;
   - S1–S14;
   - text contrast measured on the render;
   - no horizontal overflow;
   - ≥4 visible staging rows at 720 height;
   - the tag-visibility rule.
4. **Critique** with the Daedalus rubric. Fix with `edit_screens`, at most 2 rounds per screen. After that, stop and ask for direction.
5. **Handoff record** (frontend-workflow format):
   - project and screen IDs;
   - authority status (proposal);
   - token and component mapping;
   - sizes rendered;
   - differences from the rules;
   - unresolved decisions.

Stitch output never proves runtime behavior, accessibility, or responsiveness. Those are validated in the implementation.

## 6. Risks and limits

| Risk | Mitigation |
|---|---|
| Output size fixed near 1512×1104 | Verify exports at the target sizes; mark layout issues as findings, not token changes |
| `apply_design_system` may alter layouts | Use it only on variant screens; compare before and after renders |
| Generated screens drift from tokens | The repository DESIGN chain wins; fix with `edit_screens`; record exceptions only with approval |
| Latency and timeouts | Never retry a generation call; poll `get_screen` |
| Privacy | Only sandbox sample data; no real repository names, emails, or account data |
| Fonts differ from the product | Recorded as a Stitch-only exception in `.stitch/DESIGN.md` |
