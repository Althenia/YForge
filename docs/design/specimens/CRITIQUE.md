# Specimen critique: workspace direction A vs B

- **Status:** proposal evidence. These specimens are not UI designs and not implementation.
- **Source:** the revision-1 `workspace.html` specimen (directions A and B). [workspace.html](workspace.html) now renders direction A in the approved lean Y Aurora direction with tinted Rail graph styling (app/DESIGN.md S2, S13, S14, approved 2026-09-29); its renders are `renders/workspace-*.png`. The layout-direction decision below still applies; the graph, color, and depth findings are superseded.
- **Renders:** `renders/` (headless Chromium, DPR 1). Each file is named `<variant>-<theme>[-state]-<width>x<height>.png`.

| Direction | Layout |
|---|---|
| **A (recommended)** | Right inspector holds Changes and the commit composer; graph at full height |
| **B (brief hypothesis)** | Bottom working-tree dock; inspector shows commit details |

## Rubric (0 fails, 1 acceptable, 2 strong)

| Dimension | A (revision 1) | B | Evidence |
|---|---|---|---|
| Hierarchy | 2 | 1 | A: graph leads, state strip reads first, one primary action per region. B: the dock competes with the graph |
| Alignment | 1 | 1 | Columns share edges. Chips still clip when two share the refs column (`feature/greetin`) |
| Rhythm | 2 | 2 | 4px scale; 28px rows throughout |
| Density | 2 | 0 | At 1280×720, A shows ~20 graph rows and B shows ~10 (`a-dark-1280x720.png` vs `b-dark-1280x720.png`) |
| Typography | 2 | 2 | Mono refs and SHAs vs sans prose stay distinct |
| Color | 2 | 2 | Trace is the only accent. Attention appears only on HEAD, modified status, and the operation banner |
| Depth | 2 | 2 | Surface tiers and rules only; no docked shadows |
| Motion | 1 | 1 | Static specimen; motion recipes unverified |
| Brand | 1 | 1 | The HEAD junction ring is present; the mark is pending (B5 exception) |
| States | 1 | 1 | Rendered: clean-branch workspace and rebase-in-progress banner (A). Not rendered: loading, error, empty repository |
| Responsiveness | 1 | 0 | Large and medium classes rendered. Compact and minimum are not rendered |
| Polish | 1 | 1 | Lane curves cross near the stash row; chip clipping |

**Decision:** direction **A**. It keeps about twice the graph height on the 1280×720 laptop target and matches GitKraken's proven right-side composer [H]. The brief's bottom dock (B) is retained only as a comparison.

## Findings

| Location | Rule or dimension | Severity | Owner | Status |
|---|---|---|---|---|
| Selected-row node hidden under the row fill | S1, S6 | blocker | Graph row component | Fixed in revision 1 (lanes above rows) |
| Watermark overlapping the composer | Polish | minor | Specimen | Fixed in revision 1 |
| Long remote names cut at the end | S12 | major | Ref chip component | Fixed in revision 1 (middle truncation); two-chip rows still clip at the refs column edge. Spec: chips shrink by priority (HEAD, current branch, then others into `+N`) |
| Lane 8 touching the message column | Alignment | minor | Graph row | Fixed in revision 1 (14px lane pitch) |
| Curves crossing near the stash row | Polish | minor | Graph layout algorithm | Open. Belongs to implementation-time layout, not to tokens |
| Compact, minimum, loading, error, and empty states not rendered | States, Responsiveness | major | Stitch plan / implementation | Open. Covered in [../../STITCH_DESIGN_PLAN.md](../../STITCH_DESIGN_PLAN.md) |

Revision rounds used: 1 of 2.
