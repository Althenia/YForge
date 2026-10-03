#!/bin/sh
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
target="${YDS_DIR:-$HOME/Workspace/Project/YDS}/YForge"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cd "$repo"
for path in DESIGN.md app/DESIGN.md app/src/styles/tokens.css brand docs/design .stitch/DESIGN.md \
  docs/INFORMATION_ARCHITECTURE.md docs/SCREEN_INVENTORY.md docs/USER_FLOWS.md docs/UX_PATTERNS.md; do
  mkdir -p "$stage/$(dirname "$path")"
  cp -R "$path" "$stage/$path"
done
find "$stage" -name .DS_Store -delete
cat > "$stage/README.md" <<README
# YForge design system (snapshot)

Snapshot of the YForge design system, taken $(date +%Y-%m-%d) from the YForge repository
(\`~/Workspace/Project/YForge\`). The repository stays the source of truth; this copy is
re-synced with \`scripts/sync-yds.sh\` there and must not be edited here. Paths mirror the
repository, so every relative link works.

| Path | Contents |
|---|---|
| \`DESIGN.md\` | Brand rules (Y family): primitives, typography (Geist Sans, Geist Mono), motion, icons, mark, content, touchpoints, exceptions |
| \`app/DESIGN.md\` | Desktop surface rules: tokens (dark, light), materials and the Y aurora, layout, graph (GitKraken topology, tinted Rail labels), components |
| \`app/src/styles/tokens.css\` | Token source used by the app, drift-checked against \`app/DESIGN.md\` |
| \`brand/\` | Mark, lockup, app icon (SVG sources and PNG renders), Geist fonts with OFL license |
| \`docs/design/COMPONENT_SPECS.md\` | Component specs: state strip, graph row, ref label, file row, diff hunk, conflict block |
| \`docs/design/specimens/\` | Screen specimens 0–15 on the shared \`specimen.css\` and \`specimen.js\`, with renders |
| \`docs/design/stitch/\` | Stitch prompts, the screen and specimen record, and the accepted Stitch references |
| \`docs/design/proposals/\` | Offline interactive redesign proposals with their comparison pages, checks, and captures; proposals only, never production authority |
| \`.stitch/DESIGN.md\` | Stitch design brief |
| \`docs/*.md\` | Information architecture, screen inventory, user flows, UX patterns |
README
rm -rf "$target"
mkdir -p "$(dirname "$target")"
cp -R "$stage" "$target"
chmod -R u+w "$target"
echo "synced $target"
