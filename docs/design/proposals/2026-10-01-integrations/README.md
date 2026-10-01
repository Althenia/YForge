# Proposal workspace

One standalone, offline `proposal.html` assembled from `_src/`. Colors, fonts, and radii come only from the token file named in `proposal.config.json`.

## Build

```sh
node build.mjs
```

Writes `proposal.html` and the comparison page (`index.html`, or the path in `indexOut`). Fails on a missing token or fonts file, a missing screen file, a missing `data-state` variant, an external URL, a color literal in `_src/styles/` (except `aliases.css`), a `var(--x)` that no token defines, a `dark` theme value without `:root[data-theme="dark"]` tokens, or a `system` theme value without a `prefers-color-scheme: dark` block. For a light-only token file, scaffold with `--axes theme=light,size` or edit the `theme` values in `state-matrix.json`.

## Open an exact state

Every axis in `state-matrix.json` is a hash parameter; unknown or missing values fall back to each axis default.

```
proposal.html#screen=<screen>&state=<state>&theme=<theme>&size=<size>[&<custom>=<value>]
```

Controls write the hash; back and forward restore states; the Link field shows the current URL.

## Verify

Needs `playwright-core` and a Chromium browser. Nothing installs automatically; installing is the user's decision. With approval, install locally with `npm install --no-save playwright-core` and `npx playwright-core install chromium`, or set `CHROME_PATH` to a Chrome/Chromium executable. Tested on Node 24; Node 20 or later is expected but unverified.

```sh
node verify.mjs [--proposal file.html] [--rules rules.json]   # rules default to rules.json beside the proposal; run from the workspace or pass --proposal
```

Exit 0 only when, across every matrix cell: no console or page errors, no external requests, hash and controls round-trip (including unknown-param fallback and back), exactly one visible state variant, no horizontal page overflow at the frame width, no clipped content, Tab focus is visible on every reachable control, and every geometry rule holds. Exit 2 means a missing dependency or browser.

### Geometry rules

`rules.json` is a list. Measurements are in unscaled frame pixels.

```json
[{ "name": "sidebar width", "selector": ".sidebar", "when": { "size": ["1440", "1280"] }, "minWidth": 200, "maxWidth": 320 },
 { "name": "results panel is wider than tall", "selector": ".results", "minRatio": 1, "optional": true }]
```

Keys: `name`, `selector`, `when` (axis to value or list of values), `optional`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `minRatio`, `maxRatio` (width/height).

## Capture

```sh
node capture.mjs [--proposal file.html] [--out captures]   # --out defaults to ./captures in the current directory
```

Writes `captures/<screen>-<state>-<theme>-<size>[-<custom values>].png` for every cell, with reduced motion and finite animations settled. Builds `captures/overview.jpg` (default theme and size, labelled by file name) when ImageMagick is installed; otherwise it prints why it skipped.

## Change the matrix

- Add a screen: add its id to the `screen` values in `state-matrix.json`, create `_src/screens/<id>.html` with one `<section data-state="...">` per state inside `<div class="screen" data-screen="<id>" hidden>`, then build.
- Add a state: add it to the `state` values, add a `data-state` section to every screen file, then build.
- Add an axis: append `{ "key": "engine", "label": "Engine", "values": ["a", "b"] }` to `axes`; style it with `.frame[data-engine="b"] ...` in `_src/styles/`; then build. Keys match `^[a-z][a-z0-9-]*$`; values match `^[a-z0-9][a-z0-9-]*$`.
- Add a window size: add the value to the `size` axis and `[width, height]` to `sizes`.
- Add styles: add `_src/styles/<name>.css`; use only `var(--p-*)` aliases from `aliases.css`. Map another token with `--p-name: var(--token-name);` in `aliases.css`.

## Compare concepts

Scaffold one workspace per concept (run the scaffold command again with another out-dir, so token paths resolve correctly), for example `<root>/concept-a/` and `<root>/concept-b/`. Keep the comparison page in the first workspace's `_src/index.html`, replace its `href="proposal.html"` placeholder link with links relative to the built page, and set `"indexOut": "../index.html"` in its `proposal.config.json` so it builds to `<root>/index.html`. Write every link relative to `<root>`, for example `concept-a/proposal.html#screen=workspace&state=error`. The page holds one row per concept with deep links, a critique table, and a recommendation.

## Move or copy a workspace

`proposal.config.json` stores `tokens`, `fonts`, and `indexOut` relative to the workspace. After moving or copying a workspace to a different depth, edit those paths, then build. The build names the missing file when a path is wrong.
