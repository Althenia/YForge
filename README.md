# YForge
---

YForge is a local-first desktop Git client for macOS, with a commit graph, staging, branches, stashes, sync, conflict resolution, worktrees, and undo. It needs no account or cloud service and drives the system `git` CLI. The shell is Tauri 2 with a SolidJS frontend, and all Git logic lives in a Rust core crate.

<a id="table-of-contents"></a>
## Table of Contents
- [Table of Contents](#table-of-contents)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [How to Run Locally](#how-to-run-locally)
- [Run tests](#run-tests)
- [Release Build](#release-build)
- [Development Notes](#development-notes)
- [Documentation](#documentation)

<a id="prerequisites"></a>
## Prerequisites
- macOS 13.3 or newer to run a release build (`bundle.macOS.minimumSystemVersion` in `app/src-tauri/tauri.conf.json`).
- Git 2.39 or newer (enforced at startup by `crates/yforge-core/src/git.rs`; verified with 2.55.0).
- Rust stable with `cargo`, `clippy`, and `rustfmt` (verified with rustc 1.98.1).
- Node.js (verified with 24.21.0) and pnpm (verified with 12.4.1).
- Python 3 and the `daedalus` skill script at `~/.agents/skills/daedalus/scripts/design_md.py`, only for the design lints.

<a id="install"></a>
## Install
```bash
cd app
pnpm install
```

<a id="project-structure"></a>
## Project Structure

```text
.
├── app/                          # Desktop app
│   ├── DESIGN.md                 # Desktop surface design rules
│   ├── src/                      # SolidJS frontend
│   │   ├── components/           # UI components
│   │   ├── graph/                # Commit graph rendering helpers
│   │   ├── ipc/                  # Typed client and generated bindings
│   │   ├── state/                # Application state and models
│   │   └── styles/               # Token source, app CSS, and token/contrast tests
│   └── src-tauri/                # Tauri shell: commands, config, icons, IPC tests
├── brand/                        # Logos, app icon, and fonts
├── crates/
│   └── yforge-core/              # Rust core: Git parsing, graph layout, operations
├── docs/                         # Product, contract, and design documents
├── scripts/                      # Repository scripts
├── AGENTS.md                     # Agent and design-rule instructions
├── Cargo.toml                    # Rust workspace (yforge-core, app/src-tauri)
├── DESIGN.md                     # Brand design rules
└── README.md                     # This guide
```

<a id="configuration"></a>
## Configuration
These environment variables are read by the app:

| Variable | Effect |
|---|---|
| `YFORGE_REPO` | Repository opened at launch (otherwise the first CLI argument, otherwise the current directory, when it is a repository). |
| `YFORGE_DATA_DIR` | Directory for the app database (settings, recents, tabs, interface preferences); use it to keep test runs out of the real app-data directory. |
| `RUST_LOG` | Log filter. The default is `warn` in release builds and `warn,yforge_lib=debug` in debug builds. |

`yforge <path>` opens a repository in the running window (a second launch hands the path to it). Install the command from Settings → General → Install yforge command; it writes `~/.local/bin/yforge`, and `~/.local/bin` must be on your `PATH`.

The app version has one source: `version` in `app/package.json`, which `app/src-tauri/tauri.conf.json` points at (`"version": "../package.json"`).

<a id="how-to-run-locally"></a>
## How to Run Locally
```bash
cd app
pnpm tauri dev
```

It starts Vite at `http://localhost:1420` and runs the shell against it.

<a id="run-tests"></a>
## Run tests
From the repository root:

```bash
cargo test
cargo clippy --all-targets
cargo fmt --check
```

From `app/`:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Design lints, from the repository root (run them after editing either design file):

```bash
python3 ~/.agents/skills/daedalus/scripts/design_md.py lint DESIGN.md --strict
python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict
```

`pnpm test` also checks that `app/DESIGN.md` and `app/src/styles/tokens.css` agree (`tokens.test.ts`), that the generated bindings are current, and that the text and graphic color pairs meet WCAG contrast in both themes (`contrast.test.ts`).

<a id="release-build"></a>
## Release Build
```bash
cd app
pnpm tauri build
```

The build bundles the `app` and `dmg` targets for the host architecture. On an Apple-silicon Mac it produced:

- `target/release/bundle/macos/YForge.app`
- `target/release/bundle/dmg/YForge_0.2.0_aarch64.dmg`

The bundle is unsigned and not notarized: no signing identity is configured, so the binary carries only the linker's ad-hoc signature. A build made on your own Mac launches directly. macOS ties Keychain access to the signature, so each ad-hoc build asks again for the stored AI keys, platform tokens, and SSH passphrases. To keep "Always Allow" across builds, sign local builds with a stable code-signing identity from your login keychain:

```bash
APPLE_SIGNING_IDENTITY="YForge Local Signing" pnpm tauri build
``` A copy that macOS has quarantined (for example, a downloaded DMG) may be blocked by Gatekeeper. Allow it in System Settings > Privacy & Security, or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/YForge.app
```

To try the built app against a repository without touching your real settings:

```bash
YFORGE_REPO=<repository path> YFORGE_DATA_DIR=<scratch directory> \
  target/release/bundle/macos/YForge.app/Contents/MacOS/YForge
```

<a id="development-notes"></a>
## Development Notes
- `cargo build` or `cargo test` produces `target/debug/YForge`, which loads the dev URL and shows a blank window unless `pnpm dev` is running. Use `pnpm tauri build` for a self-contained app.
- After changing a type in `crates/yforge-core/src/model.rs` or `error.rs`, run `pnpm bindings` in `app/` to regenerate the TypeScript bindings.
- Change a design rule in `DESIGN.md` or `app/DESIGN.md` before the work that depends on it; see `AGENTS.md`.
- OpenAI and OpenRouter marks in `brand/third-party/` are trademarks of their owners, used unmodified to identify their providers under the terms recorded in `brand/third-party/SOURCE.md`; YForge claims no endorsement. Claude Code is named in plain text only.

<a id="documentation"></a>
## Documentation
- [DESIGN.md](DESIGN.md): brand design rules.
- [app/DESIGN.md](app/DESIGN.md): desktop surface design rules.
- [docs/CORE_UI_CONTRACT.md](docs/CORE_UI_CONTRACT.md): commands, events, errors, and build/run details between the core and the UI.
- [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md): MVP goal, users, and core flows.
