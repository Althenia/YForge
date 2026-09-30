# YForge Product Direction (Phase 3)

Status: **approved 2026-09-29** · Revision 2: standalone product; Rust core + Vite/SolidJS frontend

## Positioning

YForge is a standalone, local-first desktop Git client:

- the graph clarity and direct manipulation that make GitKraken productive;
- no account, no cloud service, and no dependency on any other product;
- explicit, safer handling of Git's risky moments: rebase, conflicts, force push, detached HEAD.

## Product principles

| # | Principle | Reason (evidence) |
|---|---|---|
| P1 | **State is always visible.** One persistent state strip answers the seven orientation questions: HEAD, branch, upstream ahead/behind, local changes, surrounding commits (graph), refs, and the Git operation in progress | GitKraken spreads these across the breadcrumb, left panel, WIP row, and right panel, and loses some entirely (F1, F3, F10) |
| P2 | **Local-first and standalone.** Every Git operation works offline, with no account. Network access is used only for the user's remotes and opt-in hosting integrations | Pricing gates and account sign-in inside core flows (F12, F16) |
| P3 | **Act where the object is, and reach everything from the keyboard.** Context menus, drag-drop, and inline creation stay. Every action also lives in the command palette with argument steps | GitKraken's direct manipulation is its strength; its palette lacks history operations (F7) |
| P4 | **Safe by default.** Graded risk tiers:<br>• force-with-lease;<br>• previews of what is lost;<br>• whole-operation undo;<br>• auto-stash is always restored;<br>• no permanent opt-outs for remote-destructive actions | F4, F5, F13 |
| P5 | **Precise, humane Git language.** Real Git verbs plus a plain consequence. Conflict sides are named by branch in every operation. The exact commands appear in Activity | F3, F9, F14 |
| P6 | **Progressive disclosure, not removal.** Advanced features stay one level down (submenu, inspector section, palette) | Power-user efficiency without clutter (F8) |
| P7 | **Worktree-native parallel work.** Linked worktrees are first-class lanes: create, review, and integrate them linearly in one place | GitKraken supports worktrees, but integrating one takes several menus [U][D] |
| P8 | **Dense, readable desktop tool.** Primary viewport 1440×900, supported down to 1280×720. No dashboard cards, no decorative motion | Brief; F11 |

## Experience qualities → design consequences

| Quality | Consequence |
|---|---|
| Dense but readable | 13px UI text, 28px default rows (24px compact), mono for refs, SHAs, and paths; no card grids |
| Fast | Rust core computes status, graph topology, and lanes; the UI virtualizes rows; background fetch with visible freshness ("fetched 2 min ago") |
| Visual | GitKraken's commit graph (lane colors by column, author discs, rounded lane connectors, ref labels); the HEAD junction glyph in the state strip is the signature element |
| Keyboard-friendly | Palette parity, J/K navigation, single-key staging, visible shortcut hints |
| Mouse-friendly | Drag-drop between refs with a result preview; hover and focus action buttons; resizable panes |
| Git-native | Real Git terminology; the system `git` executable, so hooks, config, and credential helpers behave exactly as in the terminal |
| Beginner-approachable | The working-tree row is always present; empty states explain the next step; consequences are spelled out in confirmations |
| Polished | Owned components for every control; no platform-default widgets left unstyled |

## Platform decisions

| Decision | Choice | Status | Consequence |
|---|---|---|---|
| Application stack | **Rust core + Vite/SolidJS frontend** | Decided by the user (2026-09-29) | The UI is a web surface rendered in a desktop webview (the design system uses `surface: web`); Git and file work run in Rust |
| Desktop shell | Tauri 2 | Decided (2026-09-29) | Uses the system webview: WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux. Render checks must cover these engines |
| Git engine | System `git` executable, porcelain v2 parsing | Recommended; adopted unless revised | Hooks, config, signing, and credential helpers match the terminal. Git ≥ 2.39 required |
| Graph pipeline | Rust computes topology, lanes, and ref placement incrementally; SolidJS renders virtualized DOM rows with SVG or canvas lane art | Recommended | Rows stay accessible text; lane art stays cheap to redraw |
| Core–UI contract | Typed commands and events: status, graph pages, operation progress, prompts, with cancellation | Recommended | Long operations stream progress; credential prompts round-trip safely |
| Independence | No runtime or code dependency on other products; hosting integrations (GitHub first) are optional adapters | Decided | No account, no telemetry by default |

## Key improvements over the studied workflows

| # | Improvement | Fixes |
|---|---|---|
| I1 | Persistent **state strip**: HEAD, branch → upstream, ahead/behind, changes, operation + step, network/auth freshness | F1, F3, F10 |
| I2 | **Working-tree row always present**, including "Working tree clean"; the Changes panel is reachable with a shortcut | F1 |
| I3 | **Empty repositories open natively**, with a first-commit composer | F2 |
| I4 | **Operation banner** that names the real operation ("Rebasing feature/greeting onto main · step 1 of 1 · 1 conflict") and offers Continue / Skip / Abort everywhere | F3 |
| I5 | Conflict sides **always named by branch and role**, for example "Incoming: feature/greeting (your commit being replayed)" vs "Current: main (rebase target)" | F3 |
| I6 | **Push after rewrite** recognizes a rebase or amend, explains why a force push is needed, lists the remote commits that will be replaced, uses `--force-with-lease`, and offers no permanent opt-out | F4 |
| I7 | **Auto-stash is always restored** after pull or checkout, with a toast; stash text never leaks into the commit summary | F5 |
| I8 | **Complete stash list**, including `-u` stashes created in the terminal | F6 |
| I9 | **Palette parity**: every menu and drag-drop verb is in the command palette with ref and commit pickers | F7 |
| I10 | **Structured menus**: fixed group order, at most about 12 top-level items, destructive items grouped and marked, no cloud or upsell items | F8, F12 |
| I11 | **Correct ref semantics**: tags get tag verbs only | F9 |
| I12 | **Detached HEAD guard**: a banner with "Create branch here" and a warning before committing | F10 |
| I13 | **Reflowing layout** at 1280×720: minimum list heights, collapsible sidebar, inspector drawer | F11 |
| I14 | **Whole-operation undo** backed by the reflog and snapshots, with an Activity timeline Post-MVP | F13 |
| I15 | **Plain labels for modes**: "Pull: fast-forward, merge if needed"; reset modes shown with consequences | F14 |
| I16 | **No hidden refs**: `+N` opens a popover; tags never hide behind branches | F15 |
| I17 | **No paywalls or accounts in core Git**; GitHub is an optional adapter | F12, F16 |
| I18 | **Worktree lanes with one-step integration**: rebase onto the target, fast-forward, and optionally remove the worktree, all confirmed in one dialog | P7 |

## Differentiation summary

| Dimension | GitKraken 12.5.0 | YForge direction |
|---|---|---|
| Account | Browser sign-in; plan badge | None |
| Core Git gating | Several features "Public Repos Only" on the free plan | All core Git available |
| Orientation | Scattered state | One state strip |
| Keyboard | Partial palette | Full palette parity |
| Safety | Two-step force push, single undo | Risk tiers, lease, previews, whole-operation undo |
| Worktrees | Section, context menus, Agents view with third-party agent CLIs | Worktree lanes with one-step linear integration; no agent tooling in scope |
| AI | Hosted AI credits or bring-your-own-key | Optional (MVP item 22): the user's own ChatGPT subscription or Claude Code through their official CLIs, OpenRouter, or OpenAI-compatible endpoints; opt-in, never required, never auto-applied |

## Decisions

| ID | Decision | Outcome |
|---|---|---|
| D1–D3 | Integration with and branding from another product | **Removed by the user (2026-09-29).** YForge is standalone, and its palette is its own |
| D4 | Application stack | **Decided (2026-09-29): Rust + Vite/SolidJS in a Tauri 2 shell.** |
| D5 | Git engine | **System `git` CLI (recommended)** |
| D6 | Code-reuse licensing | **Not applicable.** No third-party product code is reused |
| Open | YForge mark design | Pending (brand exception B5) |
