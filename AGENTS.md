# YForge agent instructions

## Design rules (binding)

- Before any UI, visual, or Stitch change, read `DESIGN.md` (the brand root) and `app/DESIGN.md` (the desktop surface, which `extends: ../DESIGN.md`).
- Change a rule before the work that depends on it:
  - Obtain approval for any changed token, component, or rule.
  - Update the rules, their consumers, and their tests in the same change.
- Rules marked `approved` bind all UI work; approved does not mean implemented. New or changed rules start as `proposal`.
- Run these strict lints after editing either file:
  - `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint DESIGN.md --strict`
  - `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict`
- The drift check compares the `app/DESIGN.md` front matter with the token source `app/src/styles/tokens.css` in both directions (`app/src/styles/tokens.test.ts`). Run it with `pnpm test` in `app/` (or `pnpm vitest run src/styles/tokens.test.ts`) after editing either file.
- Regenerate the Rust-to-TypeScript bindings with `pnpm bindings` in `app/` after changing a type in `crates/yforge-core/src/model.rs` or `error.rs`.

## Reviewing the running app

- "Review the debug app" means the debug bundle ready to open: `pnpm tauri dev` in `app/`, launched with `YFORGE_REPO` and `YFORGE_DATA_DIR` pointed at a throwaway fixture. `pnpm tauri build` and the release `YForge.app` are not what that request asks for.
- YForge is single-instance: quit a running instance before launching another, or the new launch forwards to the old window and the fixture is never opened.
