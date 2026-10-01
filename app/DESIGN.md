---
version: alpha
name: YForge desktop
description: Dense, keyboard-complete desktop Git client UI (Vite + SolidJS in a Rust desktop shell) covering the graph, inspector, diff, and conflict resolver; macOS first.
surface: web
extends: ../DESIGN.md
colors:
  backdrop: "{colors.mark-canvas}"
  canvas: "#0E151A"
  surface-1: "{colors.mark-surface}"
  surface-2: "#0C1217"
  surface-3: "#182229"
  surface-raised: "#151E24"
  rule: "#FFFFFF12"
  rule-panel: "#FFFFFF1F"
  rule-strong: "#718278"
  text: "{colors.frost}"
  text-muted: "#99A2AD"
  text-subtle: "#7D8792"
  text-inverse: "{colors.mark-canvas}"
  accent: "#4EE29B"
  on-accent: "#04150C"
  accent-tint: "#12332A"
  accent-ink: "#4EE29B"
  on-attention: "#1B1405"
  attention-tint: "#302F27"
  attention-ink: "#F7D37C"
  head-junction: "{colors.attention}"
  danger: "#EF6F6F"
  on-danger: "#1E0B0B"
  danger-tint: "#2E2226"
  danger-ink: "#EF6F6F"
  info: "#79B8FF"
  info-tint: "#2A3746"
  info-ink: "#79B8FF"
  focus: "#4EE29B"
  selection: "#122F28"
  status-added: "#4EE29B"
  status-modified: "#F7D37C"
  status-deleted: "#EF6F6F"
  status-renamed: "#79B8FF"
  status-untracked: "#5CD2DC"
  status-conflicted: "#F28BC7"
  status-ignored: "#99A2AD"
  lane-0: "#15A0BF"
  lane-1: "#0669F7"
  lane-2: "#8E00C2"
  lane-3: "#C517B6"
  lane-4: "#D90171"
  lane-5: "#CD0101"
  lane-6: "#F25D2E"
  lane-7: "#F2CA33"
  lane-8: "#7BD938"
  lane-9: "#2ECE9D"
  lane-0-label: "#0F2E38"
  lane-1-label: "#0D2442"
  lane-2-label: "#251138"
  lane-3-label: "#2F1536"
  lane-4-label: "#33112A"
  lane-5-label: "#301116"
  lane-6-label: "#37221E"
  lane-7-label: "#37361E"
  lane-8-label: "#22381F"
  lane-9-label: "#143632"
  lane-0-label-active: "#114A59"
  lane-1-label-active: "#0B356E"
  lane-2-label-active: "#3F0D5A"
  lane-3-label-active: "#541655"
  lane-4-label-active: "#5B0D3B"
  lane-5-label-active: "#570D10"
  lane-6-label-active: "#653022"
  lane-7-label-active: "#655A24"
  lane-8-label-active: "#375F25"
  lane-9-label-active: "#1A5B4C"
  graph-initials-dark: "#000000"
  graph-initials-light: "#FFFFFF"
  graph-text: "#C3C4C6"
  graph-text-body: "#9FA1A3"
  graph-text-dim: "#3E4448"
  graph-text-active: "#FFFFFF"
  graph-row-hover: "#1A2125"
  graph-pill: "#21282C"
  diff-added-word: "#1B4B3B"
  diff-removed-word: "#4A2B33"
  diff-added-selected: "#173F33"
  diff-removed-selected: "#3A2830"
  syntax-keyword: "#F5A8D8"
  syntax-string: "#EBCB85"
  syntax-number: "#8CC4FF"
  syntax-comment: "#A9B3BE"
  syntax-function: "#C6B8FF"
  syntax-type: "#63D9E3"
  syntax-property: "#F7B192"
typography:
  ui-body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.54
  ui-label:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.54
  ui-strong:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.54
  ui-small:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  ui-caption:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
  ui-section:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
  ui-micro:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.45
  title:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: -0.01em
  heading:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
  code:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  ref:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
  graph:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  graph-strong:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
  graph-tag:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.45
  graph-micro:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.08em
  graph-initials:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1
rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 10px
  xl: 14px
  pill: 999px
spacing:
  "0-5": 2px
  "1": 4px
  "1-5": 6px
  "2": 8px
  "3": 12px
  "4": 16px
  "5": 20px
  "6": 24px
  "8": 32px
controls:
  height: 32px
  height-tab: 28px
  height-chip: 26px
  height-dense: 24px
  hit-min: 24px
  focus-ring: 2px
  focus-offset: 2px
  selection-bar: 2px
  row-graph: 28px
  graph-row-inner: 22px
  graph-header: 30px
  graph-gutter: 28px
  graph-lane-pitch: 22px
  graph-node: 22px
  graph-merge-node: 12px
  graph-line: 2px
  graph-arc-radius: 11px
  graph-lane-strip: 2px
  graph-gutter-compact: 10px
  graph-lane-pitch-compact: 10px
  graph-node-compact: 10px
  graph-line-compact: 1px
  ref-label-height: 22px
  ref-label-edge: 3px
  row-list: 28px
  row-file: 32px
  banner: 30px
  bar-tabs: 40px
  tab-min: 128px
  bar-command: 48px
  bar-state: 36px
  bar-activity: 30px
  divider-hit: 8px
layout:
  sidebar: 248px
  sidebar-medium: 220px
  sidebar-rail: 48px
  inspector: 372px
  inspector-medium: 340px
  inspector-compact: 320px
  panel-gap: 10px
  command-field: 440px
  command-field-medium: 300px
  window-min-width: 960px
  window-min-height: 600px
  commit-summary-guide: 72ch
  list-min-rows: 4
  graph-ref-column: 130px
  graph-ref-column-min: 32px
  graph-ref-column-max: 300px
  graph-column: 150px
  graph-column-min: 56px
  graph-message-column-min: 50px
  graph-author-column: 130px
  graph-date-column: 130px
  graph-sha-column: 100px
cursors:
  action: pointer
  text: text
  disabled: not-allowed
  drag: grab
  dragging: grabbing
  resize-column: col-resize
  resize-row: row-resize
  busy: progress
  static: default
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  button-danger:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.danger}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  button-icon:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.lg}"
    height: "{controls.height-tab}"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  command-field:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  breadcrumb:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.ref}"
    rounded: "{rounded.lg}"
    height: "{controls.height}"
  menu:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.lg}"
  menu-item-danger:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.danger-ink}"
    typography: "{typography.ui-body}"
    height: "{controls.height-dense}"
  palette:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.xl}"
  tooltip:
    backgroundColor: "{colors.text}"
    textColor: "{colors.text-inverse}"
    typography: "{typography.ui-small}"
    rounded: "{rounded.md}"
  toast:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.xl}"
  composer:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.xl}"
  tab-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.pill}"
    height: "{controls.height-tab}"
  tab-inactive:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-label}"
    rounded: "{rounded.pill}"
    height: "{controls.height-tab}"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-caption}"
    rounded: "{rounded.pill}"
    height: "{controls.height-chip}"
  chip-success:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.ui-caption}"
    rounded: "{rounded.pill}"
    height: "{controls.height-chip}"
  state-strip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-caption}"
    height: "{controls.bar-state}"
  banner-operation:
    backgroundColor: "{colors.attention-tint}"
    textColor: "{colors.attention-ink}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.pill}"
    height: "{controls.banner}"
  banner-danger:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.danger-ink}"
    typography: "{typography.ui-strong}"
    rounded: "{rounded.pill}"
    height: "{controls.banner}"
  banner-info:
    backgroundColor: "{colors.info-tint}"
    textColor: "{colors.info-ink}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.pill}"
    height: "{controls.banner}"
  panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.xl}"
  sidebar-section:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-section}"
  sidebar-row:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    typography: "{typography.ref}"
    rounded: "{rounded.md}"
    height: "{controls.row-list}"
  sidebar-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.text}"
    typography: "{typography.ref}"
    rounded: "{rounded.md}"
    height: "{controls.row-list}"
  sidebar-row-meta:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-muted}"
    typography: "{typography.ui-small}"
  file-row:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    height: "{controls.row-file}"
  graph-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    height: "{controls.row-graph}"
  graph-row-body:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.graph-text-body}"
    typography: "{typography.graph}"
  graph-row-hover:
    backgroundColor: "{colors.graph-row-hover}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    height: "{controls.row-graph}"
  graph-row-selected:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.text}"
    typography: "{typography.graph}"
    height: "{controls.row-graph}"
  graph-row-conflict:
    backgroundColor: "{colors.attention-tint}"
    textColor: "{colors.attention-ink}"
    typography: "{typography.graph-strong}"
    height: "{controls.row-graph}"
  graph-row-meta:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-muted}"
    typography: "{typography.graph}"
  graph-header:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-subtle}"
    typography: "{typography.graph-micro}"
    height: "{controls.graph-header}"
  graph-time-pill:
    backgroundColor: "{colors.graph-pill}"
    textColor: "{colors.text-muted}"
    typography: "{typography.graph-micro}"
    rounded: "{rounded.pill}"
  sha:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-muted}"
    typography: "{typography.code}"
  ref-label-lane-0:
    backgroundColor: "{colors.lane-0-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-1:
    backgroundColor: "{colors.lane-1-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-2:
    backgroundColor: "{colors.lane-2-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-3:
    backgroundColor: "{colors.lane-3-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-4:
    backgroundColor: "{colors.lane-4-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-5:
    backgroundColor: "{colors.lane-5-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-6:
    backgroundColor: "{colors.lane-6-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-7:
    backgroundColor: "{colors.lane-7-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-8:
    backgroundColor: "{colors.lane-8-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-lane-9:
    backgroundColor: "{colors.lane-9-label}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-tag:
    backgroundColor: "{colors.graph-pill}"
    textColor: "{colors.graph-text}"
    typography: "{typography.graph-tag}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-0:
    backgroundColor: "{colors.lane-0-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-1:
    backgroundColor: "{colors.lane-1-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-2:
    backgroundColor: "{colors.lane-2-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-3:
    backgroundColor: "{colors.lane-3-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-4:
    backgroundColor: "{colors.lane-4-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-5:
    backgroundColor: "{colors.lane-5-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-6:
    backgroundColor: "{colors.lane-6-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-7:
    backgroundColor: "{colors.lane-7-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-8:
    backgroundColor: "{colors.lane-8-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  ref-label-active-lane-9:
    backgroundColor: "{colors.lane-9-label-active}"
    textColor: "{colors.graph-text-active}"
    typography: "{typography.graph-strong}"
    rounded: "{rounded.sm}"
    height: "{controls.ref-label-height}"
  graph-node-lane-0:
    backgroundColor: "{colors.lane-0}"
    textColor: "{colors.graph-initials-dark}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-1:
    backgroundColor: "{colors.lane-1}"
    textColor: "{colors.graph-initials-light}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-2:
    backgroundColor: "{colors.lane-2}"
    textColor: "{colors.graph-initials-light}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-3:
    backgroundColor: "{colors.lane-3}"
    textColor: "{colors.graph-initials-light}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-4:
    backgroundColor: "{colors.lane-4}"
    textColor: "{colors.graph-initials-light}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-5:
    backgroundColor: "{colors.lane-5}"
    textColor: "{colors.graph-initials-light}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-6:
    backgroundColor: "{colors.lane-6}"
    textColor: "{colors.graph-initials-dark}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-7:
    backgroundColor: "{colors.lane-7}"
    textColor: "{colors.graph-initials-dark}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-8:
    backgroundColor: "{colors.lane-8}"
    textColor: "{colors.graph-initials-dark}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  graph-node-lane-9:
    backgroundColor: "{colors.lane-9}"
    textColor: "{colors.graph-initials-dark}"
    typography: "{typography.graph-initials}"
    rounded: "{rounded.pill}"
    size: "{controls.graph-node}"
  status-added:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-added}"
    typography: "{typography.ref}"
  status-modified:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-modified}"
    typography: "{typography.ref}"
  status-deleted:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-deleted}"
    typography: "{typography.ref}"
  status-renamed:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-renamed}"
    typography: "{typography.ref}"
  status-untracked:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-untracked}"
    typography: "{typography.ref}"
  status-conflicted:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-conflicted}"
    typography: "{typography.ref}"
  status-ignored:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.status-ignored}"
    typography: "{typography.ref}"
themes:
  light:
    colors:
      backdrop: "#F7F9F8"
      canvas: "{colors.neutral-paper}"
      surface-1: "{colors.neutral-paper}"
      surface-2: "{colors.neutral-paper}"
      surface-3: "#F3F6F5"
      surface-raised: "#F7F9F8"
      rule: "#E4E8E6"
      rule-panel: "#D5DBD8"
      rule-strong: "#78847E"
      text: "{colors.neutral-ink}"
      text-muted: "#5C6672"
      text-subtle: "#646D78"
      text-inverse: "{colors.frost}"
      accent: "#0B8550"
      on-accent: "#FFFFFF"
      accent-tint: "#E5F9F0"
      accent-ink: "#0A7B47"
      on-attention: "#1B1405"
      attention-tint: "#F6F0E0"
      attention-ink: "#946200"
      head-junction: "#B87800"
      danger: "#C53A3A"
      on-danger: "#FFFFFF"
      danger-tint: "#F9EBEB"
      danger-ink: "#9E2A2A"
      info: "#1C64C2"
      info-tint: "#E3EEFB"
      info-ink: "#154E98"
      focus: "#0B8B50"
      selection: "#E1F9ED"
      status-added: "#0A7B47"
      status-modified: "#946200"
      status-deleted: "#C53A3A"
      status-renamed: "#1C64C2"
      status-untracked: "#0A6D76"
      status-conflicted: "#AE2C73"
      status-ignored: "#5C6672"
      lane-0-label: "#D5EEF3"
      lane-1-label: "#D2E4FE"
      lane-2-label: "#EBD1F4"
      lane-3-label: "#F5D5F2"
      lane-4-label: "#F8D1E5"
      lane-5-label: "#F6D1D1"
      lane-6-label: "#FDE2D9"
      lane-7-label: "#FDF5DA"
      lane-8-label: "#E7F8DB"
      lane-9-label: "#D9F6ED"
      lane-0-label-active: "#A6DBE7"
      lane-1-label-active: "#A0C6FC"
      lane-2-label-active: "#D49EE8"
      lane-3-label-active: "#E9A7E3"
      lane-4-label-active: "#F19EC9"
      lane-5-label-active: "#EC9E9E"
      lane-6-label-active: "#FAC1B0"
      lane-7-label-active: "#FAEBB1"
      lane-8-label-active: "#CDF1B3"
      lane-9-label-active: "#B0ECDA"
      graph-text: "#191919"
      graph-text-body: "#666666"
      graph-text-dim: "#CCCCCC"
      graph-text-active: "#191919"
      graph-row-hover: "#F3F6F5"
      graph-pill: "#F3F6F5"
      diff-added-word: "#C6EFDB"
      diff-removed-word: "#F7CFCF"
      diff-added-selected: "#D6F3E6"
      diff-removed-selected: "#F6DDDD"
      syntax-keyword: "#8F0F63"
      syntax-string: "#6E4400"
      syntax-number: "#0A50A0"
      syntax-comment: "#4B5561"
      syntax-function: "#4F28B0"
      syntax-type: "#00595F"
      syntax-property: "#8F3609"
    elevation:
      panel: "0 8px 24px rgba(11, 15, 20, 0.08)"
      raised: "0 1px 2px rgba(16, 24, 40, 0.06), 0 0 0 1px rgba(16, 24, 40, 0.08)"
      overlay: "0 8px 24px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.08)"
      modal: "0 24px 48px rgba(16, 24, 40, 0.18), 0 4px 12px rgba(16, 24, 40, 0.10)"
    materials:
      aurora: "none"
      glass-panel: "surface-1, opaque"
      glass-graph: "canvas, opaque"
      glass-raised: "surface-raised, opaque"
      control: "surface-2, opaque"
      control-hover: "surface-3, opaque"
elevation:
  panel: "0 10px 30px rgba(0, 0, 0, 0.45)"
  raised: "0 1px 2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04)"
  overlay: "0 8px 24px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.30)"
  modal: "0 24px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35)"
materials:
  aurora: "backdrop plus two radial glows fading to transparent at their closest side: trace at 16% alpha (76vw x 80vh, from 2% left and 8% top) and tide at 10% alpha (66vw x 72vh, from 2% right and 22% top); during a Git operation an attention glow at 22% alpha (72vw x 82vh, right, 16% top) fades in and the other glows drop to 30% opacity"
  glass-panel: "surface-1 at 70% alpha over the aurora, with a 1px rule-panel border and panel elevation"
  glass-graph: "canvas at 90% alpha over the aurora"
  glass-raised: "surface-raised at 90% alpha"
  control: "surface-2 at 66% alpha with a 1px inset rule"
  control-hover: "surface-3 at 78% alpha with a 1px inset rule"
layers:
  aurora: 0
  sticky: 10
  sidebar-overlay: 20
  drawer: 30
  popover: 40
  menu: 50
  palette: 60
  dialog: 70
  toast: 80
  tooltip: 90
breakpoints:
  compact: 1024
  medium: 1280
  large: 1440
devices:
  minimum:
    width: 960
    height: 600
    pointer: fine
    hover: true
    dpr: 2
  laptop:
    width: 1280
    height: 720
    pointer: fine
    hover: true
    dpr: 2
  desktop:
    width: 1440
    height: 900
    pointer: fine
    hover: true
    dpr: 2
  wide:
    width: 1920
    height: 1080
    pointer: fine
    hover: true
    dpr: 1
motion:
  recipes:
    panel-reveal: "opacity 0 to 1 and translateY 4px to 0 over base with entrance easing"
    overlay-enter: "opacity 0 to 1 and scale 0.98 to 1 over quick with entrance easing"
    overlay-exit: "opacity 1 to 0 over quick with exit easing"
    toast-enter: "opacity 0 to 1 and translateY 8px to 0 over base with entrance easing"
    graph-refresh: "row opacity cross-fade over quick; rows never slide"
    graph-dim: "message text opacity down to the dimmed level over base (search non-matches after a 1s delay over slow); instant under reduced motion"
    aurora-drift: "each glow alternates between translate 0 and scale 1, translate 4vw 3vh and scale 1.06, and translate -3vw 5vh and scale 0.97, over 58s (trace), 71s (tide), and 67s (attention) with ease-in-out; paused while the window is hidden or unfocused; static under reduced motion"
    aurora-operation: "attention glow opacity 0 to 1 and the other glows 1 to 0.3 over slow with standard easing, reversed when the operation ends; instant under reduced motion"
---

# YForge desktop surface rules

## Overview

This surface is the YForge desktop application: a dense professional tool with one repository per tab. It contains:

- tab bar, command bar, state strip;
- sidebar, graph, inspector;
- center views (diff, file view, conflict resolver, interactive rebase editor, recompose, worktrees, recovery);
- the Activity drawer;
- settings, including AI providers, platform connections, and Privacy & diagnostics;
- platform integrations: the sidebar Pull requests section, the pull request inspector, and the create and merge dialogs;
- history-editing dialogs (squash) and the optional AI drafts (commit message, conflict proposal, recompose proposal).

The defaults are:

- **Density:** "default" graph lanes (22px pitch and nodes) or "compact" lanes (10px pitch and nodes, 1px lines), GitKraken's two modes; graph rows stay 28px.
- **Theme:** Dark is the base theme and sits on the Y aurora; Light and System are first-class, and Light has no aurora.
- **Motion:** functional, plus the ambient aurora drift (brand B7).
- **Viewports:** 1440×900 is the primary design viewport; 1280×720 is the supported laptop viewport; 960×600 is the minimum window.

This file extends the brand root [../DESIGN.md](../DESIGN.md). Its rules and values were approved on 2026-09-29 (Phase 8), revised by the approved GitKraken graph parity (P-G1), the approved lean Y Aurora direction with tinted Rail graph styling (2026-09-29), and the approved diagnostics rule S16 with the Switch component and the approved cursor rule S17 (both 2026-09-30, owner delegation), the approved graph, state strip, and sidebar rules S21 to S23 (2026-09-30, owner delegation), the approved AI assistance, history-editing, and third-party mark rules S24 to S26 (2026-09-30, owner delegation), and the approved recovery, worktree, file view, and command line rules S27 to S30 (2026-09-30, owner delegation), the proposed platform, sidebar UX, workspace Esc, and AI v2 rules S31 to S34 (2026-09-30 to 2026-10-01, awaiting owner approval). The UI is built with Vite + SolidJS and rendered in the system webview of a Rust desktop shell, so web-surface practices apply:

- `color-scheme` set per theme;
- owned scrollbars;
- hover styles only for hover-capable pointers;
- focus styled with `:focus-visible`.

## Principles

- **The graph is the canvas.** Chrome recedes into flat, quiet controls and panels so that lanes, ref labels, and nodes carry the signal.
- **Lean atmosphere.** In the dark theme, three flat panels float over a faint aurora backdrop. The aurora is the only gradient; panels, controls, and labels are flat fills with hairline edges (brand B8).
- **Graph topology parity with GitKraken.** The commit graph reproduces GitKraken Desktop 12.5.0's lane colors, lane assignment, geometry, edge routing, and node kinds (change P-G1, approved 2026-09-29), so users read topology the way they already know it. Row and ref label styling is YForge's own **tinted Rail** treatment, and the chrome around the graph stays YForge's own.
- **Meaning is layered.** Every state is encoded in at least two channels:
  - color;
  - shape or glyph;
  - text.

  This lets lane and status colors stay readable in both themes, and without color (B4).
- **Density with rhythm.** A 4px spacing scale, 28px graph and list rows, 13px UI text, and 12px graph text. Alignment comes from columns, not boxes, so there are no card grids.
- **Stable geometry.** Async regions reserve their final size, and refreshes keep stale rows visible and marked busy.
- **Parity of input.** Anything a pointer can do is reachable by keyboard, and every hover affordance has a focus equivalent.

## Rules

| ID | Status | Binding statement | Enforcing check |
|---|---|---|---|
| S1 | approved | Graph nodes MUST encode kind by shape in addition to lane color: author disc (commit), 12px dot (merge), dotted ring (Changes), dotted square (stash). | review-only: approved 2026-09-29 (P-G1) |
| S2 | approved | Graph ref labels MUST use the tinted Rail treatment: a solid 18% lane-tint fill with a 3px lane-color inline-start edge, graph text, and a ref-kind glyph; the checked-out branch MUST show a check on the 38% lane fill; tags MUST use the solid outlined tag label and MUST NEVER be hidden behind the `+N` overflow. | review-only: approved 2026-09-29 (tinted Rail) |
| S3 | approved | Every file status color MUST pair with its status letter (M, A, D, R, U, !, T, I). | review-only: approved 2026-09-29 |
| S4 | approved | The state strip MUST be visible in every repository view and MUST show the operation state whenever Git is mid-operation. | review-only: approved 2026-09-29 |
| S5 | approved | Destructive actions MUST use danger tokens and MUST NEVER be the default focused control. | review-only: approved 2026-09-29 |
| S6 | approved | Selected rows MUST show the selection fill plus a 2px inline-start accent bar, except graph rows, which MUST show the selection fill plus the full-opacity lane strip; keyboard focus MUST show a 2px focus ring with a 2px offset. | review-only: approved 2026-09-29 (Rail) |
| S7 | approved | An action shown on hover MUST also be available on focus or selection; NEVER create hover-only actions. | review-only: approved 2026-09-29 |
| S8 | approved | Async regions MUST reserve their final geometry, and refreshes MUST keep stale rows visible and marked busy. | review-only: approved 2026-09-29 |
| S9 | approved | At 1280×720 the window MUST NOT scroll horizontally, and each staging list MUST show at least four rows. | review-only: approved 2026-09-29 |
| S10 | approved | Text MUST reach 4.5:1 and meaningful graphics 3:1 in every theme, measured against the worst-case aurora composite; text MUST NEVER sit directly on the backdrop. | `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict` for token pairs; render checks after implementation |
| S11 | approved | Motion MUST use brand durations, animate only opacity and transform, and NEVER slide graph rows; the aurora drift is the one ambient recipe. | review-only: approved 2026-09-29 (Y Aurora) |
| S12 | approved | SHAs, paths, commands, and ref names outside the graph MUST use the mono roles; graph ref labels MUST use the `graph` role and graph tags the `graph-tag` role; paths MUST truncate from the left. | review-only: approved 2026-09-29 (Rail) |
| S13 | approved | The commit graph MUST follow GitKraken 12.5.0: lane color by column index over 10 colors, leftmost-free column reuse, 22px lane pitch and author discs, 2px orthogonal edges with 11px rounded corners; row treatments MUST follow COMPONENT_SPECS § Graph row. | review-only: approved 2026-09-29 (P-G1, Rail); render checks after implementation |
| S14 | approved | The aurora MUST render only in the dark theme, behind the panels at layer `aurora`, MUST pause while the window is hidden or unfocused, and MUST be static under reduced motion; panels and controls MUST stay flat. | review-only: approved 2026-09-29 (Y Aurora); render checks after implementation |
| S15 | approved | Controls and labels MUST be icon-driven where an established glyph carries the meaning (row actions, tab and pane controls, toolbar actions, section headers, state chips, menu items); every icon-only control MUST have an accessible name and a tooltip naming the action and its shortcut; confirmation, dialog, operation-banner, and destructive buttons MUST keep a text label; an icon MUST NEVER be the only carrier of state (B4). | review-only: approved 2026-09-30 |
| S16 | approved | Diagnostics data (usage events, crash reports, persisted activity history) MUST stay on this Mac and MUST be managed in Settings → Privacy & diagnostics: usage recording MUST be opt-in, off by default, and its setting MUST state exactly what is recorded and that nothing leaves the Mac; turning it off MUST state that stored events are deleted; every Delete or Clear MUST confirm in a dialog with a text-labelled danger button (S5, S15); an entry from an earlier session MUST say in text that it has no undo (B4). | review-only: approved 2026-09-30 (owner delegation) |
| S17 | approved | Every cursor MUST come from the `cursors` tokens as `var(--cursors-*)`, and the browser default MUST NEVER decide one: a raw cursor keyword, an inline cursor style, or a `--cursors-*` value outside `tokens.css` MUST NEVER appear. Buttons, links, tabs, menu items, palette and option rows, selectable graph, file, sidebar, and list rows, actionable chips, switches, checkboxes and radios with their labels, segmented controls, selects, and cards that act MUST use `action`; text inputs, textareas, contenteditable regions, and selectable text regions (diff content, commit message body, command output) MUST use `text`; disabled controls (`[disabled]`, `aria-disabled="true"`) MUST use `disabled` and MUST keep their reason tooltip; draggable ref labels MUST use `drag`, and the whole window MUST use `dragging` while one is dragged; panel and column dividers MUST use `resize-column` or `resize-row` by orientation; a control whose operation is running (`aria-busy="true"`) MUST use `busy`; every non-interactive surface MUST use `static`. An element that acts on click MUST be a native button or link, or carry the matching role, so the global mapping applies. | `app/src/styles/cursors.test.ts` (token-only scan of `app/src` and the specimen stylesheet, drift-checked mirror) and `app/src/styles/cursors.render.test.tsx` (rendered components) · approved 2026-09-30 (owner delegation) |
| S18 | approved | Every added or removed diff line MUST be selectable in Hunk, Inline, and Split modes through a per-line checkbox in its gutter (`role="checkbox"`, named "Select <added or removed> line <n>"; click toggles, ⇧-click extends the range within the hunk, ↑/↓ move between changed lines, ⇧↑/⇧↓ extend); a selected line MUST show the `diff-added-selected` or `diff-removed-selected` fill, the 2px `accent` inline-start bar, and a check glyph in place of the ± marker (never color alone, B4); selected lines act through Stage lines, Unstage lines, and Discard lines in the diff toolbar, and Discard lines MUST confirm with a text-labelled danger button (S5, S15); while Ignore whitespace is on, every hunk and line staging control MUST be `aria-disabled` with the tooltip and visible toolbar text "Turn off Ignore whitespace to stage changes". | `app/src/components/DiffView.test.tsx`, `app/src/state/lineSelection.test.ts`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S19 | approved | Code in a diff MUST use the `syntax-*` tokens for keyword, string, number, comment, function, type, and property, and the changed words of a paired removed and added line MUST sit on `diff-removed-word` and `diff-added-word`; every syntax color, `text`, and `text-muted` MUST reach 4.5:1 on `canvas`, `accent-tint`, `danger-tint`, both word fills, and both selected fills in both themes; a raw color MUST NEVER style code; syntax MUST never be the only carrier of added or removed (the ± marker stays); files with no grammar MUST render plain. | `app/src/styles/contrast.test.ts` (syntax and diff pairs), `app/src/styles/tokens.test.ts`, `app/src/state/syntax.test.ts`, `app/src/state/diffHighlight.test.ts` · approved 2026-09-30 (owner delegation) |
| S20 | approved | The composer's primary action MUST be a split button: the main segment commits, and the attached chevron segment (`aria-haspopup="menu"`, named "More commit actions") opens Commit (⌘↵) and Commit & Push (⌘⇧↵); Commit & Push MUST be `aria-disabled` with its reason shown in the menu whenever it cannot push (no remote, detached HEAD, operation or sync running, or an amend of a pushed commit); a failed push after a successful commit MUST leave the commit and report the push error. | `app/src/components/ChangesInspector.test.tsx`, `app/src/state/composer.test.ts` · approved 2026-09-30 (owner delegation) |
| S21 | approved | The graph MUST offer: a `+N` overflow control that is a native button named with the hidden branches and opens a popover of them as ref labels (↑/↓ move, Enter checks out, ⇧F10 opens the menu, Esc closes and returns focus to the graph; each label stays draggable and right-clickable); an always-present working-tree row (the core's Changes row, which reads "Working tree clean" when nothing changed, and opens the Changes inspector); optional Author, Date / Time, and SHA columns, hidden by default, shown or hidden in the column settings popover, resized by focusable separators (pointer, ←/→ by 8px, Home resets) within their limits, saved per repository in the app database, and hidden below 1024px; a branch-hover highlight that fades the commits outside the hovered branch, with B pinning it from the keyboard (S7); multi-select by ⌘/Ctrl-click, ⇧-click, ⇧↑/⇧↓ (⇧J/⇧K) and Space, with a summary bar that states the count in text, Esc or Clear collapsing to one commit, and every single-commit verb disabled with the reason "Select a single commit"; branch visibility All or Current + upstream, applied by the core so the lanes are laid out again and hidden commits never render; and Reveal HEAD from the HEAD chip, H, and ⌘⇧H, run on open and after a checkout without changing the selection. | `app/src/components/GraphPanel.test.tsx`, `app/src/state/selection.test.ts`, `app/src/graph/reachability.test.ts`, `app/src/graph/columns.test.ts`, `app/src/state/graphPrefs.test.ts`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S22 | approved | Every state strip segment MUST act: HEAD reveals HEAD in the graph; the branch and upstream chip opens the branch menu (branches, Set upstream…, Unset upstream); ahead and behind opens the Sync menu; the fetched chip fetches now, its age MUST stay current while the window is open, and when an automatic fetch fails it MUST read "Auto-fetch paused: <reason>" in text (no toast) and retry when activated; Changes opens the Changes inspector; the worktree chip opens the Worktrees panel (S28). While the machine is offline the strip MUST show a text "Offline" chip and every network menu item and command MUST be disabled with the reason "You are offline". An authentication failure MUST offer a text-labelled Fix that opens the settings section holding the credential (the SSH key for an SSH remote, the repository's remotes otherwise). The outcome of an auto-stashed pull and of a stash-and-switch MUST stay in the strip as a text notice with its actions and a dismiss (Apply and Pop for changes kept in a stash; Restore and Keep in stash when returning to a branch), never as a transient toast alone. | `app/src/components/StateStrip.test.tsx`, `app/src/state/repoActions.test.ts`, `app/src/state/syncModel.test.ts`, `app/src/state/online.test.ts` · approved 2026-09-30 (owner delegation); worktree chip amended by S28, 2026-09-30; auto-fetch failure amended 2026-10-01 by the owner |
| S23 | approved | Slash-separated local and remote branch names MUST render as folders: a chevron glyph (rotated when collapsed, by transform only), the branch count in text, `aria-expanded`, and a name that gives the full folder path; Enter, Space, → and ← toggle a folder, and the collapsed folders are saved per repository in the app database; a leaf shows its last segment with the full name in its tooltip and accessible name; a stash row selects the stash inspector (files, diff, Apply, Pop, Rename, Drop); a menu item that has a keyboard shortcut MUST show it after its label, taken from the same source as the palette. | `app/src/components/Sidebar.test.tsx`, `app/src/state/refTree.test.ts`, `app/src/state/sidebarPrefs.test.ts`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/ContextMenu.test.tsx` · approved 2026-09-30 (owner delegation) |
| S24 | approved | AI assistance MUST be optional, visibly bounded, and never automatic: every AI action MUST be a text-labelled button with the neutral `wand` glyph (never sparkles, stars, or a "magic" label), MUST run only when the user presses it, MUST be cancellable while it runs, and MUST deliver an editable draft that changes nothing in Git until the user commits, accepts, or applies it; the generated text MUST keep the text it replaced restorable ("Restore my text", "Restore my grouping"); notes about withheld or cut files MUST be visible text; a failed AI action MUST state the cause and that nothing changed, and MUST offer the fix as a text-labelled button ("Open AI settings" for a missing or unreachable provider, "Sign in" for a revoked sign-in); Settings → AI MUST state exactly what is sent and to whom, list each provider with a status word plus glyph (never color alone, B4), never re-display a saved API key ("Key saved in the macOS Keychain" with Replace and Clear), and confirm Remove in a dialog with a text-labelled danger button (S5, S15). | `app/src/components/AiSettings.test.tsx`, `app/src/state/aiModel.test.ts`, `app/src/state/aiGenerate.test.ts`, `app/src/state/aiSignIn.test.ts`, `app/src/components/ChangesInspector.test.tsx`, `app/src/components/ConflictResolver.test.tsx`, `app/src/components/RecomposeView.test.tsx` · approved 2026-09-30 (owner delegation); the active-provider clause withdrawn 2026-10-01 at the owner's request (per-feature setup, S34) |
| S25 | approved | History-editing views (the interactive rebase editor, the squash dialog, and the recompose view) MUST state the consequence before they act: a pushed commit in the range MUST show a text warning that the next push needs a force push, naming the count and the upstream; the apply button MUST stay disabled with its reason in text (nothing changed, a blank message, a squash with nothing below it, an unassigned change, a merge commit in range, or tracked changes in the working tree); a reorder MUST be possible by drag handle, by the move buttons, and by ⌥↑ and ⌥↓ (or the number keys 1–9 to assign a recompose change, 0 to unassign), and an action MUST be settable by the keys P, R, S, F, D, and E; the resulting history MUST be previewed as text before it is applied; a drag MUST show its drop position with the accent line or the accent fill and the whole window MUST use the `dragging` cursor while it runs (S17); a rebase that stops MUST hand over to the operation banner, which states "Stopped to edit <sha>" with Continue for an edit stop, or to the conflict resolver; every rewrite MUST end in the undo toast. | `app/src/components/RebaseEditor.test.tsx`, `app/src/components/SquashDialog.test.tsx`, `app/src/components/RecomposeView.test.tsx`, `app/src/state/rebaseModel.test.ts`, `app/src/state/recomposeModel.test.ts`, `app/src/components/StateStrip.test.tsx`, `app/src/graph/labelDrag.test.ts` · approved 2026-09-30 (owner delegation) |
| S26 | approved | A third-party provider mark MUST be an official file stored unmodified in `brand/third-party/` with its source, date, terms, and sha256 in `brand/third-party/SOURCE.md`, MUST render only through `ProviderLogo`, scaled proportionally, in the variant listed for the current theme, never recolored, cropped, combined, or larger than the provider name beside it; Settings → AI MUST state that the marks belong to their owners and imply no endorsement; a provider whose terms do not permit the mark, or that has no mark, MUST use the neutral glyph (`terminal` for a CLI, `plug` for an API endpoint). | `app/src/components/AiSettings.test.tsx`, `brand/third-party/SOURCE.md` (review-only for the terms) · approved 2026-09-30 (owner delegation) |
| S27 | approved | Recovery is a center view with the tabs Reflog, Lost commits, and Snapshots (`role="tablist"`, the segmented control), and it MUST always state in visible text what it cannot recover: work changed outside YForge and never committed, objects Git has already pruned, and that snapshots are kept 30 days, appear in `git log --all` in other tools, and are pushed only by `git push --mirror`. Every reflog entry and lost commit MUST offer Restore as a branch (a popover with a suggested free name), Check out detached, and Reset the current branch (Soft, Mixed, Hard) as icon controls whose names include the short SHA; they MUST be disabled with the reason as tooltip when Git has pruned the commit or HEAD is detached. A hard reset (warning glyph, the discarded tracked changes, the safety snapshot, and Undo named), a detached checkout (the clean working tree required), Restore everything, and Delete snapshot MUST confirm with text-labelled buttons (S5, S15); Restore everything MUST name both commits when HEAD moved and is forced only after that confirmation; a snapshot restore MUST state in text the ref that holds the previous state. The lost-commit scan MUST show a status line while it runs and a text-labelled Cancel scan, and MUST state when it was cancelled or found nothing. Reflog pages of 50 load with Show older. Every restore ends in the activity toast, with Undo where the core offers one. | `app/src/components/RecoveryView.test.tsx`, `app/src/state/recoveryModel.test.ts`, `app/src/components/IconDriven.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S28 | approved | A worktree opens as its own tab, and the tabs whose repository shares one main worktree MUST sit next to each other inside one bordered `role="group"` named "<repository> and its worktrees", a linked worktree leading with the worktree glyph instead of the YForge logo. The Worktrees panel (opened from the state strip chip, the sidebar section, or the palette) MUST list every worktree with its branch in mono, a "Main worktree" chip, the text flags current, changes, locked, and missing, and its left-truncated path; each row MUST offer Open as tab, Open in terminal, Integrate, and Remove as icon controls named with the path or branch, marked `aria-disabled` or `disabled` with the reason as tooltip when unavailable (the worktree open here, the main worktree, a locked or missing one, a dirty or branchless one); Open in terminal MUST be offered for every worktree with the configured terminal command. Create is a dialog with New branch or Existing branch, the start point, and a suggested folder that stays editable. Remove MUST confirm, and MUST confirm again with a text-labelled danger button that names the discarded changes and the safety snapshot when the worktree has changes. Integrate MUST state the exact sequence (rebase onto the target, fast-forward the target, optional removal and branch deletion) in text before it acts, and a rebase that stops on conflicts MUST open that worktree's tab, where the operation banner and the resolver apply, with a notice that names it. | `app/src/components/WorktreePanel.test.tsx`, `app/src/state/worktreeModel.test.ts`, `app/src/state/worktreeActions.test.ts`, `app/src/state/tabs.test.ts`, `app/src/components/TabBar.test.tsx`, `app/src/components/Sidebar.test.tsx`, `app/src/components/StateStrip.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S29 | approved | The file view shows one file at a revision and MUST be reachable from the diff toolbar, each commit file row, and each stash file row (an icon control named "View file" or "View <path>"; a deleted file offers none). It MUST show numbered lines in the `code` role with the `syntax-*` tokens (S19), the line count, size, and line ending as text chips, and the source (commit, Staged, Working tree, or stash) in the breadcrumb. A binary file MUST show a text placeholder with its size; a file over 2 MiB MUST show an alert stating its size and the limit with Open in editor; any other refusal MUST be shown as the core states it. Esc, the breadcrumb, and the close control MUST return to where the user came from; the view MUST NEVER edit. | `app/src/components/FileView.test.tsx`, `app/src/state/fileView.test.ts`, `app/src/components/DiffView.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/StashInspector.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S30 | approved | Settings → General MUST offer a text-labelled "Install yforge command" button that states the path it wrote, whether it replaced an earlier copy, and that `~/.local/bin` must be on PATH; a refusal MUST be shown with its cause and change nothing. A path handed over by a second `yforge <path>` launch MUST open or activate its tab, and a path that is not a repository MUST be reported as a notice visible on every screen. Application state MUST live in the app database, never in browser storage: the recent palette commands and the last parent folder are read and written through `app_ui_prefs_load` and `app_ui_prefs_save`. | `app/src/components/SettingsView.test.tsx`, `app/src/state/app.test.tsx`, `app/src/state/appUiPrefs.test.ts`, `crates/yforge-core/tests/app_ui_prefs.rs` · approved 2026-09-30 (owner delegation) |
| S31 | proposal | Platform integrations MUST identify GitHub, GitLab, and Bitbucket by the neutral `github`, `gitlab`, and `bitbucket` glyphs in a `material.control` tile and MUST NEVER show a platform's logo. Settings → Platforms MUST list each connection with its glyph, name, kind, and mono host; MUST never re-display a saved token (the field is empty, with "Stored in the macOS Keychain and never shown again" for a new connection and "Paste a new token" when editing); MUST state the risk of the "Accept an untrusted certificate" checkbox in plain text beside it (anyone on the network could read the token and the code) and MUST mark a connection that has it on with the text chip "Certificate not checked" and the warning glyph (B4); Test MUST report "Connected as <login>" or the failure as text, and an authentication failure MUST read "Authentication failed for <host>" with a text-labelled "Edit connection" (also in the sidebar section and the inspector); Remove MUST confirm with a text-labelled danger button (S5, S15). The sidebar "Pull requests" section MUST exist only while a connection matches one of the repository's remotes; each row MUST show `#number`, the title, the author, `source → target` in mono, and a state chip with a word and a glyph (Open with `pullrequest`, Merged with `merge`, Closed with `close`); its row actions Open in browser and Merge MUST be icon buttons named with the number, visible on focus or selection (S7) and also reachable from the row menu (⇧F10), and Merge MUST be `aria-disabled` with the reason unless the pull request is open; the section MUST say "No open pull requests" as text when empty and offer "Show merged and closed". The pull request inspector MUST show the state chip, the author, the created and updated times (absolute time with the relative age), the mergeability in words (an unknown value as "—" with a tooltip, never a value), and the changed files with status letter, left-truncated path, and +/- counts. The create dialog MUST default the source to the current branch, the target to the remote's main (then master, then its first branch), and the title to the HEAD subject, MUST require a title and a target different from the source, MUST say in text when the source branch is not on the remote, and MUST end in a notice that carries the pull request's web address. Merge MUST confirm in a dialog that names the branches and the platform, states that the merge happens on the server and cannot be undone from YForge, and states that YForge then fetches all remotes; a refused merge MUST report the platform's message and MUST NOT fetch. | `app/src/components/PlatformSettings.test.tsx`, `app/src/components/PullRequests.test.tsx`, `app/src/state/platformModel.test.ts`, `app/src/state/palette.test.ts`, `app/src/components/IconDriven.test.tsx`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-09-30 (phase 6b), awaiting owner approval |
| S32 | proposal | Every sidebar section (Branches, Remotes, Tags, Stashes, Worktrees, Pull requests, Recovery) MUST have a header that is a native button with the section glyph, the name, and a chevron (rotated when collapsed, by transform only) and reports `aria-expanded`; a collapsed section shows its header and count only, and the collapsed sections are saved per repository in the app database next to the collapsed folders (S23, S30). Every section's rows MUST be drawn as children of that section in one tree: an indent guide and an elbow connector made of CSS lines (never glyphs) on every row, the last child ending its line, every row a direct child of its section at the first level, branch folders and the branches of every remote nesting one level deeper (the remote itself a child of the section), tags, stashes, worktrees, and pull requests sitting one level under their section, and every ancestor that still has later siblings keeping its indent guide above the elbow so a connector never floats. One input named "Filter sidebar" at the top MUST hide every row that does not contain its text (case-insensitive substring of the row name, a remote branch by its full name, a stash by message or `stash@{n}`, a worktree by folder, path, or branch, a pull request by number, title, author, or branches), MUST open the folders that hold a match without changing the saved collapse, MUST show `matched/total` in a section count while it has text, MUST clear on Escape (consuming the key), and MUST NEVER change the selection. Within one section, ctrl-click or cmd-click toggles a row (macOS delivers a ctrl-click as a context menu, with either button number, and it MUST toggle too) and shift-click extends from the last anchor, which a plain click or a ctrl-click sets; a plain click selects only that row; a selected row takes the selection fill with a 1px accent inset and `aria-pressed`; with two or more rows selected, the context menu of a selected row MUST offer the bulk action instead of the single-row entries: Delete N branches… (disabled with the reason while the checked-out branch is selected), Delete N tags…, Fetch N remotes (the core fetches every remote, and the menu says so), Drop N stashes…, and Remove N worktrees…; every destructive bulk action MUST confirm once, naming the rows and the commits that would lose their name. An author avatar (24px circle, 16px inline) MUST be the Gravatar identicon at `https://www.gravatar.com/avatar/<md5 of the trimmed lower-case email>?s=48&d=identicon` beside the author in the commit inspector and beside the git identity in the Activity drawer; it MUST be decorative (`aria-hidden`, the name stays as text), MUST show the author's initial while loading, on failure, when Settings → Privacy & diagnostics → Profile pictures is off, and where only a platform login is known (the pull request rows), and MUST request nothing in the last two cases; images are cached in memory for the session; the setting states that only the MD5 hash of the email leaves the Mac and is on by default, and lasts the session until the app database can store it (S30). | `app/src/components/Sidebar.test.tsx`, `app/src/state/sidebarModel.test.ts`, `app/src/state/refTree.test.ts`, `app/src/state/avatar.test.ts`, `app/src/components/AuthorBadge.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/ActivityDrawer.test.tsx`, `app/src/components/PrivacyDiagnostics.test.tsx`, `app/src/state/repoActions.test.ts`, `app/src/state/worktreeActions.test.ts`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-09-30 (phase 7b), tree extended to every section and the ctrl-click toggle corrected 2026-10-01, the Changes section removed, tags made multi-selectable, and a plain click made the anchor 2026-10-01 at the owner's request, awaiting owner approval |
| S33 | proposal | The Esc key in the workspace MUST be consumed (`preventDefault`) even when it closes nothing, unless a control inside already handled it, so the system never acts on it. Checking out a branch that another worktree has checked out MUST NOT be reported as a failed Git command: the state strip MUST show the core's message ("<branch> is checked out in worktree <path>") with the text-labelled action "Open worktree", which opens or focuses that worktree's tab and dismisses the notice; the notice MUST also go when the next switch starts. | `app/src/components/Workspace.test.tsx`, `app/src/state/repoActions.test.ts` · proposed 2026-09-30 (phase 7c), awaiting owner approval |
| S34 | approved | A provider that supports both MUST offer its sign-in as a two-option control ("API key", "Subscription") that names the consequence in text: with a key, YForge calls the provider API with the pasted key; with a subscription, ChatGPT signs in through YForge (browser or a headless code the user copies) and Claude uses the Claude Code sign-in read from the macOS Keychain, which YForge never copies or stores. The sign-in panel MUST show the address and, for the headless flow, the code as copyable text, MUST offer "Cancel sign-in" while it runs, and a signed-out subscription MUST state "Sign in to Claude Code first" for Claude. A provider has no model and is never "active": the provider dialog MUST NOT offer a model choice and the provider list MUST NOT mark a provider as active. Settings → AI MUST offer a per-feature card for each of Generate commit message, Propose with AI in Recompose, and Propose conflict resolution, each with a Switch "Use AI for <feature>" (the S16 pattern, its On or Off word beside it) that is disabled with the reason "Choose a provider and model to turn this on" until the feature has a saved provider and model, saving a feature's first configuration turning it On; a provider select; a model select that loads the chosen provider's models API by itself as soon as a provider is chosen (the trigger reads "Loading models…" while it loads; an empty list, an `ai_auth_required` failure, and any other failure are stated as text) beside an icon-only "Reload models" button (`sync` glyph, S15); a prompt editor whose `{context}` placeholder is stated in text and that MUST refuse to save without it; and "Reset to default", which restores the shipped prompt and turns the feature off. The card MUST have no Save button: the provider and model save as soon as both are chosen (the core still checks the model against the provider's list) and the prompt saves when the field loses focus, and the card states "Saved" or the failure in text after each save. A feature's AI action (Generate in the composer, Propose with AI in Recompose, Propose resolution in the conflict resolver) MUST NOT render at all unless its Switch is On, its saved provider still exists, and that provider's status is Ready; the core decides this as the feature's `available` flag, and a run of a feature that is not set up or is off is refused as `ai_not_configured` naming the feature. | `app/src/components/AiFeatures.test.tsx`, `app/src/state/aiFeatures.test.ts`, `app/src/components/AiSettings.test.tsx`, `app/src/components/ChangesInspector.test.tsx`, `app/src/components/RecomposeView.test.tsx`, `app/src/components/ConflictResolver.test.tsx`, `app/src/ipc/client.test.ts` · proposed 2026-10-01 (phase 7a-UI); provider model and active provider removed, the per-feature Switch, automatic model loading, and hidden unavailable actions added, and the Save button replaced by saving each change 2026-10-01 at the owner's request; approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S35 | approved | Every choice in the app MUST be the owned `Select` (a `button` with `aria-haspopup="listbox"` and `aria-expanded`, the chosen label, and a chevron) and every multi-line field the owned `TextArea`; a native `select` or `option` MUST NEVER render (B3). The list is the `popover` surface, at least as wide as its trigger: `role="listbox"` with `role="option"` rows that carry the chosen mark and `aria-selected`, ↑ and ↓ move, Home and End jump, Enter or Space choose, and Escape closes and returns focus to the trigger; a disabled Select keeps its reason as the tooltip. The trigger's chevron MUST point down and MUST NEVER be rotated. An option shows its label and, when present, its hint as separate spans with a `spacing-2` gap, the hint in `ui-small` muted at the end of the row. A Select of more than 8 options MUST open with a search field at the top of its list, named "Search <label>" and focused when the list opens, that keeps only the options whose label, hint, or value contains its text (case-insensitive) as the user types; ↓ moves from the field to the first option, Enter in the field chooses the first remaining option, Escape closes, a list with nothing left states "No matches" in text, and a search never changes the chosen value. The Select trigger takes `cursors.action`, the search field and the TextArea `cursors.text` (S17). A TextArea grows with its content between its row limits, wraps its label and note in the same field grid as a one-line input so their edges line up, and shows its remaining count when one is set. | `app/src/components/Select.test.tsx`, `app/src/components/TextArea.test.tsx`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-10-01 (owned controls), approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S36 | proposal | A toast MUST enter at the top right of the window, below the tab bar, stacked newest first, and MUST NEVER cover the state strip or the composer. While the pointer is over it or a control inside has focus it MUST NOT expire, and it MUST announce through `role="status"`. A drag with a pointer MUST show a ghost of what is being dragged beside the cursor and MUST dim its source, so the lift is visible before any drop target is reached; the whole window keeps the `dragging` cursor while it runs and the ghost MUST NEVER take pointer events. The commit graph MUST show a working-tree row only while the tree has changes; a clean tree shows no working-tree row, and the row's absence MUST NOT shift the refs or the lanes of the commits below. A commit node with a known author email MUST draw that author's Gravatar as a round avatar inside the node, the initials staying as the fallback while it loads and when pictures are off; the graph reads the email through `repo_graph`, which exposes it on `Author`. | `app/src/components/Toasts.test.tsx`, `app/src/state/pointerDrag.test.ts`, `crates/yforge-core/tests/graph.rs`, `app/src/components/GraphPanel.test.tsx` · proposed 2026-10-01 (toasts, drag ghost, clean row, graph avatars), awaiting owner approval |
| S37 | approved | Repository tabs MAY be grouped by the user. A tab's context menu (right-click or ⇧F10) MUST offer "Add to new group…", "Add to group" with each existing group by name, and "Remove from group" for a grouped tab; a new group asks for a name (1 to 40 characters, required) and a color from the ten lane colors, each swatch a radio named by its color word (Cyan, Blue, Purple, Magenta, Pink, Red, Orange, Yellow, Green, Mint for lanes 0 to 9); group names may repeat. A group MUST render as a chip before its tabs: a native button with the group name in text on the lane's label fill with a 2px lane-color inline-start bar, `aria-expanded`, and its tab count in text while collapsed, followed by its tabs inside one `role="group"` named "<name> tab group" (color never carries the group alone, B4). Clicking the chip collapses or expands the group; a collapsed group hides its tabs but never the active one, and activating a tab of a collapsed group expands it. The chip's menu MUST offer Rename…, Color… (a popover with the ten swatches), Ungroup, and Close group, and Close group MUST confirm with a text-labelled danger button that names the tabs (S5, S15). A group's tabs stay contiguous: an added tab moves to the end of the group, a removed tab moves right after it, and a repository moves together with its worktree tabs (S28). Groups, their names, colors, collapsed state, and members MUST be saved with the tab session in the app database and restored at launch; a group left without tabs is deleted. | `app/src/components/TabBar.test.tsx`, `app/src/state/tabs.test.ts`, `crates/yforge-core/tests/store.rs` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S38 | approved | When the working tree is clean and Amend is off, the Changes inspector MUST show a centered empty state (the 32px `changes` glyph, "Working tree clean" in `ui-strong`, and "Nothing to commit on <branch>" with the branch in mono) instead of the area lists, and MUST collapse the composer to one text button "Amend last commit" (disabled with its reason on an unborn branch or while an operation is in progress); choosing it shows the full composer with Amend on and the last message filled in, and the full composer returns by itself as soon as a file changes. | `app/src/components/ChangesInspector.test.tsx` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S39 | approved | Settings → Jira MUST connect Jira Cloud (site address, email, API token) and Jira Data Center (site address, personal access token); the token MUST be stored only in the macOS Keychain and never shown again, Test MUST report "Connected as <display name>" or the failure in text, and Remove MUST confirm with a text-labelled danger button (S5, S15). A Jira issue key (PROJECT-123, its project known to a connected site) in a branch name, a commit subject or message, or a pull request title MUST render as a chip with the neutral `issue` glyph and the key in mono; its tooltip and the commit inspector show the issue summary and status word, and an unknown or unreachable issue shows the key alone. While a Jira connection exists, the sidebar MUST show a "Jira issues" section listing the issues assigned to the user whose status is not in the Done category: each row shows the key in mono, the summary, and a status chip with a word (B4) toned by the status category (To Do neutral, In Progress `info`, Done `accent`), activating a row opens the issue inspector (summary, status and type chips, assignee and update time in text, Open in browser, stated as read-only), with Create branch from issue and Open in browser as icon controls named with the key (S7, S15) and in the row menu; Create branch opens the create-branch popover prefilled with `<KEY>-<summary slug>` (lower-case ASCII words joined by hyphens, at most 50 characters, editable). The section says "No open issues assigned to you" as text when empty. YForge MUST NEVER write to Jira. | `app/src/components/JiraSettings.test.tsx`, `app/src/components/Sidebar.test.tsx`, `app/src/state/jiraModel.test.ts`, `crates/yforge-platform/tests` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S40 | approved | Settings → Git hosts MUST list per-host identities, each with the host name (matched exactly, optionally with a port), an SSH private key file, and an HTTPS username; Generate key MUST create an ed25519 key pair at a file path the user can edit, prefilled with `~/.ssh/yforge_<host>` (port dropped) and refused when a file already exists there, with an optional passphrase that YForge saves in the macOS Keychain and says so in text; while it works it MUST name the file it is writing, and it then selects the key; an SSH passphrase prompt for a key whose passphrase YForge saved MUST be answered from the Keychain without asking; Copy public key MUST copy the `.pub` text and state "Copied". Clone, fetch, pull, push, and every remote operation MUST use the identity whose host matches the URL's host (`git@host:path`, `ssh://`, or `https://`), a repository's own SSH key overriding it and the app-wide key used when no host matches; the clone dialog MUST state in text which identity the typed URL will use, or that it uses the SSH agent and `~/.ssh/config`. An identity's HTTPS username MUST prefill the credentials prompt for that host; HTTPS passwords and tokens stay in Git's credential helper (the macOS Keychain on this Mac) and are never stored by YForge. | `app/src/components/GitHostsSettings.test.tsx`, `app/src/components/CloneDialog.test.tsx`, `crates/yforge-core/tests/git_hosts.rs` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations; key path and Keychain passphrase amended 2026-10-01 by the owner |
| S41 | approved | The Launchpad MUST be a screen reached from the launcher and the tab bar with the `launchpad` glyph, showing the tabs My pull requests (open pull requests authored by or assigned for review to the user across every platform connection), My issues (S39), and WIPs (recent repositories with uncommitted changes or unpushed commits), each with its count in text; a search field filters the rows of the current tab by title, key, number, or repository, and a source filter narrows by connection. Rows MUST open the repository tab, the pull request in its inspector (in the browser when no local clone of its repository is known), or the issue in the browser; a tab with no source connected MUST say so in text and offer Connect for each missing service; loading, failure, and empty states MUST be stated in text per source, and each source MUST state its own update time ("<source> · updated <age> ago"), never one combined time. The Launchpad MUST NEVER write to a platform or to Jira. | `app/src/components/Launchpad.test.tsx`, `app/src/state/launchpadModel.test.ts` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner with the design proposal docs/design/proposals/2026-10-01-integrations |
| S42 | approved | A repository tab's context menu (right-click or ⇧F10) MUST offer, in this order: Close tab (⌘W), Close other tabs, Close tabs to the right, then the group items (S37), then Alias repository… (Remove alias when one is set), then Reopen closed tab (⇧⌘T); an item that cannot act MUST stay visible, `aria-disabled`, with its reason as the tooltip ("No other tabs", "No tabs to the right", "No closed tabs"). Closing several tabs MUST confirm only when one of them has an operation in progress, naming those tabs. An alias (1 to 40 characters, set in a popover prefilled with the current name) MUST replace the folder name on the tab, in Recent, and in the palette, with the folder name in the tab's tooltip and accessible description, and MUST be saved per repository in the app database. Reopen closed tab MUST reopen the most recently closed tab of this session, up to the last 20, into its former group when that group still exists. | `app/src/components/TabBar.test.tsx`, `app/src/state/tabs.test.ts`, `app/src/state/app.test.tsx` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner |
| S43 | approved | YForge MUST install its own macOS menu bar (a recorded platform exception: the menu bar is drawn by macOS): YForge (About YForge, View Release Notes, Check for Update…, Settings… ⌘,, Services, Hide YForge ⌘H, Hide Others ⌥⌘H, Show All, Quit YForge ⌘Q), File (New Tab ⌘T, Open Repository… ⌘O, Clone Repository…, Create Repository…, Launchpad, Close Tab ⌘W, Reopen Closed Tab ⇧⌘T), Edit (Undo ⌘Z, Redo ⇧⌘Z, Cut, Copy, Paste, Select All, Find ⌘F, Command Palette ⌘K), View (Theme, Density, Reveal HEAD ⇧⌘H, Enter Full Screen ⌃⌘F), Repository (Fetch ⇧⌘F, Pull ⇧⌘L, Push ⇧⌘P, Create Branch ⌘B, Stash ⇧⌘S, Undo Last Action), Window (Minimize ⌘M, Zoom, Show Next Tab ⌃⇥, Show Previous Tab ⌃⇧⇥, Bring All to Front), and Help (YForge Help, Keyboard Shortcuts, Report an Issue). Every shortcut MUST come from the same registry as the palette; an item that cannot act MUST be disabled. ⌘Z undoes typing inside a text field and otherwise runs YForge's Undo. View Release Notes and Report an Issue open the project's GitHub pages. Check for Update MUST state in a dialog, in text, that it is checking, that YForge is up to date (with the version), that a version is available (with its version and release notes, Install and Relaunch, and Later), or why the check failed; an update MUST be verified against YForge's signing key before it installs, and nothing downloads until the user chooses Install and Relaunch. | `app/src-tauri/tests`, `app/src/components/UpdateDialog.test.tsx`, `app/src/state/shortcuts.test.ts` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner |
| S44 | approved | Lists read from GitHub, GitLab, Bitbucket, and Jira (pull requests, pull request files, the Launchpad tabs, Jira issues and projects) MUST follow pagination to the complete result, up to a safety cap of 1,000 items per list; every count MUST be the true total, and a capped list MUST say so in text ("Showing 1,000 of <total>", or "Showing the first 1,000" when the service gives no total). | `crates/yforge-platform/tests/adapters.rs`, `crates/yforge-platform/tests/jira.rs`, `app/src/components/PullRequestInspector.test.tsx`, `app/src/components/Launchpad.test.tsx` · proposed and approved 2026-10-01 by the owner |
| S45 | approved | The tab bar MUST keep its trailing controls (Launchpad, Activity, Theme, Settings, and New tab) visible at every window width: repository tabs MUST shrink to a minimum width that keeps the leading glyph and a truncated name with the full name in the tooltip, and past that the tab list MUST scroll horizontally, keeping the active tab in view after it changes. | `app/src/components/TabBar.test.tsx`, `app/src/styles/tabBar.render.test.tsx` · proposed and approved 2026-10-01 under the owner's delegation of design decisions; the minimum width is `controls.tab-min` |

## Colors

**Backdrop and materials.** Dark is the base theme, and Light overrides it under `themes.light`.

| Role | Dark | Light | Use |
|---|---|---|---|
| backdrop | `#0B1115` (Y mark-canvas) + aurora | `#F7F9F8`, no aurora | Window background behind the bars and panels |
| canvas | `#0E151A` (graph glass at 90%) | `#FFFFFF` | Graph, diff, center views, inputs |
| surface-1 | `#11181D` (Y mark-surface; glass at 70%) | `#FFFFFF` | Sidebar and inspector panels |
| surface-2 | `#0C1217` (control at 66%) | `#FFFFFF` | Tabs, chips, buttons, command field, breadcrumb |
| surface-3 | `#182229` (control hover at 78%) | `#F3F6F5` | Active tab, control hover |
| surface-raised | `#151E24` (at 90%) | `#F7F9F8` | Composer, menus, palette, dialogs, toasts (with elevation) |
| rule / rule-panel | white at 7% / 12% | `#E4E8E6` / `#D5DBD8` | Hairlines and control outlines / panel borders, tag outlines, dashed empty states |
| rule-strong | `#718278` | `#78847E` | Input boundaries (≥3.87:1 dark worst case; ≥3.67:1 light) |

Opaque values are the token pairs that lint checks. Translucent values are the dark materials in the front matter (`materials`). Every text pair is also measured on the worst-case aurora composite: both glows at peak alpha overlapping, idle and during an operation.

**Ink.**

| Role | Dark | Light | Contrast (worst case) | Use |
|---|---|---|---|---|
| text | `#F4F7F6` (Frost) | `#0B0F14` | 12.48 / 16.89 | Primary text |
| text-muted | `#99A2AD` | `#5C6672` | 5.20 / 5.13 | Secondary text, metadata, section labels |
| text-subtle | `#7D8792` | `#646D78` | 4.86 / 5.25 (canvas) | Canvas-only: the graph column header |

`text-subtle` fails on dark glass (4.31:1 worst case), so it is used only on the canvas.

**Semantic roles.**

| Role | Dark | Light | Meaning |
|---|---|---|---|
| accent / accent-ink | `#4EE29B` | `#0B8550` fill; `#0A7B47` ink | Primary action, success, "in sync", current branch |
| attention / head-junction | ink `#F7D37C`; ring `#F0BE62` | ink `#946200`; ring `#B87800` | HEAD in the state strip, pending work, the operation glow |
| danger | `#EF6F6F` | `#C53A3A`; ink `#9E2A2A` | Destructive, errors, deleted |
| info | `#79B8FF` | `#1C64C2` | Links, informational banners |
| focus | `#4EE29B` | `#0B8B50` | Focus ring |
| selection | `#122F28` | `#E1F9ED` | Selected rows (plus the S6 bar or lane strip) |

Tints are opaque so their contrast does not depend on the aurora:

- accent-tint `#12332A` / `#E5F9F0`;
- attention-tint `#302F27` / `#F6F0E0`;
- danger-tint `#2E2226` / `#F9EBEB`;
- info-tint `#2A3746` / `#E3EEFB`.

**Diff and syntax colors (S18, S19).** Opaque fills and inks for code on the canvas and the two line tints, measured by `contrast.test.ts` (every syntax ink, `text`, and `text-muted` ≥4.5:1 on each fill it can sit on):

| Token | Dark | Light | Use |
|---|---|---|---|
| diff-added-word | `#1B4B3B` | `#C6EFDB` | Changed words of an added line |
| diff-removed-word | `#4A2B33` | `#F7CFCF` | Changed words of a removed line |
| diff-added-selected | `#173F33` | `#D6F3E6` | Selected added line |
| diff-removed-selected | `#3A2830` | `#F6DDDD` | Selected removed line |
| syntax-keyword | `#F5A8D8` | `#8F0F63` | Keywords, tags, meta |
| syntax-string | `#EBCB85` | `#6E4400` | Strings, regular expressions |
| syntax-number | `#8CC4FF` | `#0A50A0` | Numbers, literals |
| syntax-comment | `#A9B3BE` | `#4B5561` | Comments (italic) |
| syntax-function | `#C6B8FF` | `#4F28B0` | Function and section names |
| syntax-type | `#63D9E3` | `#00595F` | Types and built-ins |
| syntax-property | `#F7B192` | `#8F3609` | Attributes, properties, variables |

The removed-line marker uses `danger-ink`, because `status-deleted` measures 4.48:1 on the light `danger-tint`.

All tint and ink pairs are ≥4.60:1. Danger text on the attention tint (the Abort button in the operation banner) is 4.59:1 dark and 4.57:1 light.

**Git status colors.** Each is always paired with a letter (S3).

| Status | Letter | Dark | Light |
|---|---|---|---|
| Added | A | `#4EE29B` | `#0A7B47` |
| Modified | M | `#F7D37C` | `#946200` |
| Deleted | D | `#EF6F6F` | `#C53A3A` |
| Renamed | R | `#79B8FF` | `#1C64C2` |
| Untracked | U | `#5CD2DC` | `#0A6D76` |
| Conflicted | ! | `#F28BC7` | `#AE2C73` |
| Type changed | T | text-muted | text-muted |
| Ignored | I | `#99A2AD` | `#5C6672` |

**Graph lanes.** These are GitKraken's ten lane colors. They are assigned by column index (column 0 is the leftmost lane), not by branch identity, and columns are reused leftmost-first (S13). Both themes use the same line colors.

| Column | Line | Dark label / checked-out | Light label / checked-out | Initials | Line vs canvas (dark / light) |
|---|---|---|---|---|---|
| 0 | `#15A0BF` | `#0F2E38` / `#114A59` | `#D5EEF3` / `#A6DBE7` | black | 5.97 / 3.08 |
| 1 | `#0669F7` | `#0D2442` / `#0B356E` | `#D2E4FE` / `#A0C6FC` | white | 3.83 / 4.80 |
| 2 | `#8E00C2` | `#251138` / `#3F0D5A` | `#EBD1F4` / `#D49EE8` | white | 2.57 / 7.17 |
| 3 | `#C517B6` | `#2F1536` / `#541655` | `#F5D5F2` / `#E9A7E3` | white | 3.66 / 5.03 |
| 4 | `#D90171` | `#33112A` / `#5B0D3B` | `#F8D1E5` / `#F19EC9` | white | 3.68 / 5.01 |
| 5 | `#CD0101` | `#301116` / `#570D10` | `#F6D1D1` / `#EC9E9E` | white | 3.16 / 5.83 |
| 6 | `#F25D2E` | `#37221E` / `#653022` | `#FDE2D9` / `#FAC1B0` | black | 5.59 / 3.29 |
| 7 | `#F2CA33` | `#37361E` / `#655A24` | `#FDF5DA` / `#FAEBB1` | black | 11.63 / 1.58 |
| 8 | `#7BD938` | `#22381F` / `#375F25` | `#E7F8DB` / `#CDF1B3` | black | 10.36 / 1.78 |
| 9 | `#2ECE9D` | `#143632` / `#1A5B4C` | `#D9F6ED` / `#B0ECDA` | black | 9.14 / 2.01 |

Derived Rail treatments:

- **Ref label:** a solid fill of the lane mixed 18% into the canvas, with a 3px lane-color inline-start edge and `graph-text`. The fill is opaque, so connector lines stop at the label edge.
- **Checked-out label:** the lane mixed 38% into the canvas, with `graph-text-active`.
- **Hovered label:** the lane mixed 28% into the canvas, with `graph-text-active`.
- **Tag label:** a solid `graph-pill` fill with a 1px `rule-panel` outline, `graph-tag` text, and the tag glyph.
- **Lane strip:** 2px of lane color where the message column starts, at 60% opacity; 100% on the selected row.
- **Initials:** black or white, whichever contrasts more with the lane.
- **Row text:** `graph-text` (white 75% into the canvas) for summaries, `graph-text-body` (60%) for the inline body, and `graph-text-dim` (20%) for dimmed rows; `graph-row-hover` (5%) fills the hovered row.

Measured contrast:

- **Label text:** dark ≥7.04:1 at rest, ≥9.24:1 hovered, and ≥6.90:1 checked out; light ≥12.52:1, ≥10.24:1, and ≥8.25:1. Tag labels: 8.57:1 dark, 16.17:1 light.
- **Initials on the lane:** ≥4.80:1.
- **Lane lines against the canvas:** at least 3:1, except dark lane 2 and light lanes 7–9, which are recorded exceptions (S10).

The graph never relies on hue alone: column position, ref labels, and author initials identify every lane.

## Typography

| Role | Spec | Use |
|---|---|---|
| ui-body | Sans 13/20, 400 | Default UI, inputs, command field |
| ui-label | Sans 13/20, 500 | Buttons, tabs |
| ui-strong | Sans 13/20, 600 | Primary buttons, banner text |
| ui-small | Sans 12/16, 400 | Metadata, sidebar row meta |
| ui-caption | Sans 12/16, 500 | State strip chips |
| ui-section | Sans 12/16, 600 | Sidebar section and list headers (sentence case) |
| ui-micro | Sans 11/16, 500 | Counts in badges and keyboard hints |
| title | Sans 16/22, 600, −0.01em | Inspector titles, dialog titles |
| heading | Sans 20/26, 600 | Settings section titles |
| display | Brand display 24/30, 600 | Launcher heading only |
| code | Mono 12/18, 400 | Diffs, commands, output, file paths |
| ref | Mono 12/16, 500 | Branch, tag, and remote names outside the graph; SHAs; status letters |
| graph | Sans 12/16, 400 | Graph messages and ref labels |
| graph-strong | Sans 12/16, 500 | The checked-out ref label |
| graph-tag | Mono 11/16, 400 | Tag labels in the graph |
| graph-micro | Sans 10/14, 500 | Graph column header (uppercase, 0.08em tracking) and time pills |
| graph-initials | Sans 10/10, 700 | Author initials in commit nodes |

Section labels are never uppercase: GitKraken's uppercase sections read as heavy chrome (subjective finding). The graph column header is the one uppercase exception (P-G1).

## Layout

- **Regions:**
  - tab bar 40px;
  - command bar 48px;
  - state strip 36px;
  - three panels with a 10px gap and a 10px outer inset: sidebar 248px, graph (fills the remaining width), inspector 372px;
  - activity bar 30px.
- **Bars:** transparent over the backdrop; every bar item is a control, chip, or button on `surface-2` (S10).
- **Tab bar:** pill tabs 28px tall; the active tab leads with the YForge mark (brand B5) and a worktree count; the tabs of one repository's worktrees sit together in a bordered group (S28).
- **Command bar:** breadcrumb (repository › worktree › branch in `accent-ink`), a centered command field (search commits, branches, files, or run a command; ⌘K) up to 440px, then Sync (primary), Branch, Stash, and Undo.
- **Graph columns** (GitKraken defaults; widths are resizable and saved per repository):
  - Branch / Tag 130 (32–300);
  - Graph 150 (min 56): a 28px gutter, then lanes every 22px;
  - Commit message fills the remaining width (min 50);
  - optional and hidden by default: Author 130 (initials at 32), Date / Time 130, SHA 100.
- **Graph header:** 30px, with the labels "BRANCH / TAG", "GRAPH", and "COMMIT MESSAGE", the labels of the shown optional columns, and a column-settings button (a `controls.hit-min` square) at the end. Each resizable column has a `controls.divider-hit` separator at its inner edge; the message column and the settings square sit at the row end, so rows reserve the settings square. The optional columns are hidden below 1024px without forgetting the choice.
- **Alignment:**
  - Panels share one 8px list inset and a 16px header inset.
  - Graph rows center the label, node, and text on the row's 22px inner band.
  - Inspector sections share one label column.
- **Scroll owners:** the graph, each staging list, the inspector body, and the diff each own their scroll. Headers stick at layer `sticky`.

## Responsive

| Class | Range | What changes | Why |
|---|---|---|---|
| minimum | 960–1023 | Sidebar is a 48px rail; the inspector becomes an overlay drawer; the graph hides its optional columns | Keeps the graph readable at the minimum window |
| compact | 1024–1279 | Sidebar rail (expands as an overlay); inspector docked at 320px; toolbar labels hidden by priority | 1280 laptops with a side-by-side editor |
| medium | 1280–1439 | Sidebar 220px; inspector 340px; command field 300px; the optional Author column shows initials | Supported laptop target (1280×720) |
| large | ≥ 1440 | Full layout | Primary target (1440×900) |

Reflow patterns in use:

- rail to drawer (3);
- column drop (2);
- toolbar to overflow by priority (8).

Height rules:

- Below 800px, the composer collapses its description.
- Below 700px, the activity bar hides.
- Staging lists always keep at least 4 rows (S9).

Required device profiles: `minimum`, `laptop`, `desktop`, `wide`.

## Elevation & Depth

- **Strategy:** flat panels over the backdrop. Depth comes from the panel material, a 1px `rule-panel` border, and the `panel` shadow; there is no sheen, glow, or gradient rim (brand B8).
- **Materials (dark):** the aurora at layer `aurora`, then `glass-panel` (sidebar, inspector), `glass-graph` (graph), `glass-raised` (composer), and `control` / `control-hover` for bar items and buttons. Rows, tints, and selection fills on top of glass are opaque.
- **Materials (light):** no aurora; every material is opaque.
- **Overlays:** menus, the palette, dialogs, and toasts use the `overlay` and `modal` shadows, always paired with a 1px `rule-panel` border for a crisp edge.
- **Themes:** dark and light have their own shadow values.
- **Layers:**
  - aurora 0;
  - sticky 10;
  - sidebar-overlay 20;
  - drawer 30;
  - popover 40;
  - menu 50;
  - palette 60;
  - dialog 70;
  - toast 80;
  - tooltip 90.

## Shapes

| Radius | Value | Used on |
|---|---|---|
| xs | 2px | Hunk and line selection marks |
| sm | 4px | Graph ref labels (Rail: trailing corners only) and tag labels |
| md | 6px | List and file rows, status badges, the "Y" glyph tile, tooltips |
| lg | 10px | Buttons, inputs, the command field, the breadcrumb, menus, toasts, empty-state boxes |
| xl | 14px | Panels, the composer, dialogs, the palette |
| pill | 999px | Tabs, chips, banners, time pills, counts |

A child radius never exceeds its parent's radius.

**Graph node shapes** (GitKraken 12.5.0):

- commit: a 22px author disc, filled with the lane color inside a 2px lane ring, with the author's initials in `graph-initials`;
- merge: a 12px solid lane dot;
- Changes row: a 22px dotted ring (2px stroke, 2px dash, 3px gap, round caps) with a dotted edge to HEAD;
- stash: a 22px square with a 2px dotted lane border and the stash glyph;
- HEAD: no node treatment; the checked-out ref label carries the check (S2);
- compact lanes: 10px nodes and merge dots with 1px lines.

## Motion

- **Recipes** (front matter `motion.recipes`):
  - panel-reveal;
  - overlay enter and exit;
  - toast enter;
  - graph refresh as a cross-fade;
  - graph dimming for branch-hover highlights and search non-matches, through message-text opacity;
  - aurora drift (ambient, dark only);
  - aurora operation shift, when a Git operation starts or ends.
- **No motion on:** hover and press, which change state instantly. Rows never slide (S11).
- **Reduced motion:** every recipe becomes an instant change, and the aurora is static (S14). The indeterminate operation indicator becomes the static label "In progress…".

## Cursors

- **Tokens** (front matter `cursors`), one per intent; `tokens.css` is the only place their values live (S17):

| Token | Value | Elements |
|---|---|---|
| `action` | `pointer` | Buttons, links, `summary`, selects, checkbox and radio inputs and their labels, `role` button, link, tab, menuitem, option, switch, checkbox, radio, openable file rows, selectable conflict lines |
| `text` | `text` | Text inputs, textareas, labels that wrap them, contenteditable and textbox roles, diff lines (unified and split), commit message body, command output |
| `disabled` | `not-allowed` | `:disabled` and `aria-disabled="true"` controls, and labels that wrap a disabled control; the reason tooltip stays |
| `drag` | `grab` | `draggable="true"`, branch ref labels (tag labels are not draggable and keep the row cursor), and the `.rgrip` drag handle of a rebase row or a recompose change |
| `dragging` | `grabbing` | The whole window while `body.dragging` is set |
| `resize-column` | `col-resize` | `role="separator"` with `aria-valuenow` and `aria-orientation="vertical"` (a divider between columns or side panels) |
| `resize-row` | `row-resize` | The same with `aria-orientation="horizontal"` |
| `busy` | `progress` | A control with `aria-busy="true"`; a busy region (panel, list, group) is not a control and stays `static` |
| `static` | `default` | The document base and every non-interactive surface |

- **Mapping:** `app/src/styles/app.css` holds one zero-specificity (`:where()`) rule per token, ordered `action`, `text`, `drag`, `disabled`, `busy`, then the dividers; a later rule wins, so a disabled or busy control beats its role, and `body.dragging` beats all of them. Components never declare a cursor; they use a native element or a role. A row without a native role hooks the mapping through a class or attribute (`.frow.openable`, `.rline[data-region]`).
- **Specimens:** `docs/design/specimens/specimen.css` mirrors the tokens as `--cursors-*` and maps its mock classes to them.
- **Check:** `cursors.test.ts` fails when `app/src` or `specimen.css` sets a cursor to anything but `var(--cursors-*)`, or defines a `--cursors-*` value outside `tokens.css` (the specimen mirror must equal it); `cursors.render.test.tsx` mounts real components and asserts the token each element resolves to. `tokens.test.ts` keeps the front matter and `tokens.css` identical.

## Icons

- **Grid and stroke:** brand icon grammar (24 grid, stroke 1.5 at 16, 1.6 at 20 and 24, `currentColor`).
- **Sizes on this surface:**
  - 14px glyphs in graph ref labels, 5px apart;
  - 16px in other rows, menus, and the command field;
  - 20px in the command bar.
  - 32px for the glyph of an empty state (S38).
- **Rendering:** one owned `Icon` component renders every icon.
- **Icon-driven labels (S15):** three tiers, applied by where the control lives:

  | Tier | Where | Treatment |
  |---|---|---|
  | Icon only | Repeated row actions (stage, unstage, discard, open diff, open in editor, copy, more); tab controls (new, close); window controls (settings, theme, activity, search); pane navigation (previous and next change or conflict); toolbar actions in the `compact` and `minimum` classes | 16px glyph (20px in the command bar) in a control of at least `controls.hit-min`; `aria-label` and a tooltip with the action and shortcut |
  | Icon and label | Toolbar actions at `medium` and above (Sync, Branch, Stash, Undo); the Commit button; sidebar and inspector section headers; state strip chips; menu items (a leading 16px icon slot, kept empty for items without an established glyph so labels align) | Icon before the label, 6px gap |
  | Text (optional leading icon) | Dialog and confirmation buttons, operation-banner actions (Resolve, Continue, Skip, Abort), destructive actions, form labels, and body copy | The label names the operation and its consequence (brand B6) |

- **Registry by meaning:**
  - Git objects: commit, merge, stash, changes, HEAD, checked-out, branch-local, branch-remote, tag, worktree;
  - operations: sync, fetch, pull, push, stash, undo, search, palette, stage, unstage, discard, commit, branch-create, merge, rebase, cherry-pick, revert, reset, tag-create, open-diff, open-in-editor, open-in-terminal, copy, wand (an AI draft), rebase (edit history), squash, recompose, grip (drag handle), plug (an API endpoint), open (open as a tab), file (view a file), history (recovery), github, gitlab, bitbucket (neutral platform glyphs, never the platform logos), pullrequest (a pull request), issue (a Jira issue; never the Atlassian or Jira logo), launchpad (the Launchpad screen), identity (a Git host identity);
  - status: warning, error, success, conflict;
  - view: collapse, expand, settings, activity, theme, previous, next, more, close, new-tab.

## Components

| Component | Purpose | Spec | Consumers |
|---|---|---|---|
| App shell (tab bar, command bar, activity bar) | Window frame | This file · [../docs/design/COMPONENT_SPECS.md](../docs/design/COMPONENT_SPECS.md) | S01–S31 |
| Aurora backdrop and panels | Window atmosphere and region containers | This file (§Elevation & Depth, `materials`) | S01–S31 |
| State strip / operation banner | Seven-question orientation; operation control | COMPONENT_SPECS § State strip | S02, S07–S11, S26–S29 |
| Graph row (ref label, lane art, node, lane strip, message) | History navigation | COMPONENT_SPECS § Graph row | S02, S05, S22 |
| Ref label (tinted rail, checked-out, tag) | Branch, tag, and remote identity | COMPONENT_SPECS § Ref label | S02, S04, S06, S12 |
| File row with status badge | Changes and commit file lists | COMPONENT_SPECS § File row | S03, S04, S06, S15 |
| Diff line, hunk header, and toolbar | Diff, line staging, modes, and highlighting | COMPONENT_SPECS § Diff hunk | S07, S09 |
| Conflict block | Resolve Current / Incoming / Both | COMPONENT_SPECS § Conflict block | S09 |
| Sidebar section and row | Ref navigation | This file | S02, S29 |
| Buttons (primary, secondary, danger, icon, split) | Actions | Front matter tokens | All |
| Tabs, chips, command field, breadcrumb | Bar controls | Front matter tokens | S01–S31 |
| Composer (split Commit button) | Commit message entry; Commit and Commit & Push | COMPONENT_SPECS § Composer | S03, S04 |
| Commit inspector actions | Branch here, Cherry-pick, Revert, and Reset in the header of a selected commit | COMPONENT_SPECS § Commit inspector actions | S03, S15 |
| Message edit form | Edit the HEAD commit message in the commit inspector | COMPONENT_SPECS § Message edit form | S03 |
| Menu, context menu, drop menu | Direct manipulation | UX_PATTERNS §6–7 | S12 |
| Command palette | Keyboard access | SCREEN_INVENTORY S21 | S21 |
| Dialog, confirmation | Risky actions | SCREEN_INVENTORY S11, S13, S14 | S11–S19 |
| Toast, tooltip, badge, progress | Feedback | Front matter tokens | S30 and all |
| Switch | On/off setting (usage recording) | 32×18 pill with a 12px thumb, a 24px-tall hit area, `role="switch"` with an accessible name and `aria-checked`. Off: `material.control` fill, 1px `rule-strong` edge, `text-muted` thumb. On: `accent` fill, `on-accent` thumb. The thumb moves by transform only (S11). A visible "On" or "Off" label always sits beside it (S15, B4) | S16, S23, S24 |
| Diagnostics list (usage event, crash report, activity history) | Local records in Settings → Privacy & diagnostics | Rows reuse the Activity entry (status glyph, operation, summary, time; expandable body for crash details and commands). Pages of 25 load with a "Show older" button; an empty list states why it is empty. Header actions are Export… (native save dialog) and a text-labelled Delete or Clear (S5, S16) | S16, S23, S24 |
| Chip group (HEAD, branch, sync) | One pill of three segment buttons in the strip | A `chip` pill whose segments are flat buttons on `material.control-hover` at hover: HEAD (reveal), branch and upstream (branch menu), ahead and behind (Sync menu); a detached HEAD uses `attention-ink` and shows only the HEAD segment | S02, S22 |
| Strip notice | Persistent outcome with actions in the state strip | A `chip-attention` chip with its text, an optional `hint-text`, text-labelled `btn sm` actions, and a dismiss icon button; inside the operation banner it is plain text | S22 |
| Popover (ref overflow, graph settings, worktrees, upstream, Push to…, rename stash) | Small forms and lists anchored to their trigger | The `popover` surface; the first input, select, or list takes focus; Esc closes and returns focus to the opener | S21, S22 |
| Sidebar folder row | Slash-separated branch names | A `srow` with a rotating chevron, the folder name, and the branch count; children indent 14px per level | S23 |
| Provider card, provider row, status badge | Choose and review AI providers in Settings → AI | A card is a `button` on `material.control` with a 24px or 32px provider mark (or neutral glyph), the provider name in `ui-strong`, and one line of `ui-small` muted copy; two per row in the add dialog. A row shows the mark, name, `ui-small` kind and model (mono), a status badge, the "Active" chip, and icon actions. The active row uses the selection fill with the 2px accent bar. A status badge is a pill with a 14px glyph and a word: check on `accent-tint` for Ready, warning on `attention-tint` for Not installed, Signed out, and Key missing, warning on `danger-tint` for Key rejected, Unreachable, and Check failed | S24, S26 |
| Rebase row and resulting-history preview | Edit history | A row is `canvas` with a 1px `rule` inset: drag handle, mono SHA, message, "Pushed" chip, action select, and move up and down; a reword or last squash row grows a message textarea, and a row that cannot apply shows its problem in `ui-small` danger ink below it. The drop position is a 2px accent line above or below the row. The preview lists the resulting commits newest first with their source SHAs and a text chip (Combined, Reworded, Stops here so you can amend it), then the dropped commits | S25 |
| Recompose change row and commit card | Regroup unpushed commits | A file row (status letter, left-truncated path, assignment chip, assign button) with hunk rows and line checkboxes (S18 pattern) below it; the chip reads Unassigned (attention), Commit N, or Split (accent). A commit card is a `canvas` panel with a 1px `rule` inset holding the message textarea, move and remove icon buttons, and the assigned files with their scope and counts; while dragging over it, it takes the `accent-tint` fill and a 2px accent inset | S25 |
| AI proposal | Conflict resolver | A `canvas` block with a 3px accent inline-start bar, a header naming it a draft, the rationale in `ui-small` muted, the proposed lines in `code`, and Accept, Edit, and Reject buttons | S24 |
| Tab group | Worktree tabs under their repository | A `tab-group` wrapper of pill tabs with a 1px `rule-panel` inset border and 4px padding when it holds two or more tabs; a linked worktree tab leads with the 16px `worktree` glyph, the first tab keeps the logo | S28 |
| Worktree lane row | One worktree in the Worktrees panel and its menu | A `canvas` row with a 1px `rule` inset: worktree glyph, mono branch, text chips for Main worktree and the flags, the left-truncated path, then four icon buttons; the worktree open here uses the selection fill with the 2px accent bar | S28 |
| Recovery row and snapshot row | Restore from the reflog, lost commits, and snapshots | A `canvas` row with a 1px `rule` inset: the action chip, mono short SHA, summary, mono selector, relative age with the absolute time as tooltip, and three icon buttons (branch, check, undo); a pruned commit reads "Commit no longer exists" in muted ink with the buttons disabled. A snapshot row is a button with the action in `ui-strong`, the description, a file-count chip, and the age; the open row takes the selection fill and the accent bar and shows its files (status letter, left-truncated path, a checkbox) with Restore selected files, Restore everything…, and a danger Delete snapshot… | S27 |
| File view | Read one file at a revision | The diff panel frame with a breadcrumb, line count, size, and line-ending chips, Open in editor, and Close; lines are a 56px right-aligned muted number and the `code` text with `syntax-*` tokens, virtualized | S29 |
| Platform connection row | A connection in Settings → Platforms | The provider row layout with a 24px neutral platform glyph tile (`provider-logo neutral`), name in `ui-strong` over the kind and mono host in `ui-small` muted, the `chip-attention` chip "Certificate not checked" when the certificate is not verified, a text Test button, and Edit and Remove icon buttons; a test result sits on its own line below as a `chip-success` "Connected as <login>" or an error note with a text-labelled "Edit connection" | S31 |
| Pull request row | One pull request in the sidebar Pull requests section | A `srow` that grows to two lines: `#number` (mono, muted) and the title, then the author and mono `source → target` in `ui-small` muted; a state chip (`chip-success` Open, plain Merged, `chip-danger` Closed) with a 14px glyph and the word; Open in browser and Merge as 24px icon buttons that show on hover, focus, and selection; the selected row uses the selection fill with the 2px accent bar | S31 |
| Pull request inspector | Details of the selected pull request | The inspector frame of the commit inspector: header with `#number title`, the state chip, the author, text buttons Open in browser and Merge…; the body shows the description, the meta rows (Branches, Author, Created, Updated, Mergeable, Address), and the Files list with status letters, left-truncated paths, and +/- counts | S31 |
| Create pull request dialog | Open a pull request from a local branch | The entry dialog: the platform and repository line, Source branch and Target branch selects, Title, Description textarea, and a text-labelled primary "Create pull request"; a note with the warning glyph when the source is not on the remote | S31 |
| Sidebar section header | Collapse a sidebar section | A native button in `ui-section`: section glyph, the name, and a 14px chevron rotated by transform when collapsed; the count chip (`matched/total` while filtering) and the section buttons follow outside the button | S32 |
| Sidebar tree connectors | Show folders and remote branches as a tree | A 1px `rule-panel` indent guide per ancestor that still has later siblings and an elbow (vertical to the row middle, then a 10px horizontal stub, 4px on a folder row) that continues below unless the row is the last child; CSS borders only | S32 |
| Sidebar filter | Filter every section | The `input` with the search glyph above the sections, named "Filter sidebar", placeholder "Filter" | S32 |
| Author badge | Show who wrote a commit | A 24px pill-rounded tile (16px beside text) on `accent-tint` holding the Gravatar identicon, or the author's initial in `ui-micro`; decorative | S32 |
| Split pane, resizable divider | Layout | This file (`controls.divider-hit`; a focusable `role="separator"` with `aria-valuenow` and `aria-orientation` takes `cursors.resize-column` or `cursors.resize-row`, S17) | S02, S07, S09 |
| Empty state | Guidance | SCREEN_INVENTORY | S01, S03, S26, S29 |

The danger button is an outline: transparent fill, a 1px `danger` border, and `danger` text. Its token pair is checked on `surface-2`; on the operation banner it measures 4.59:1 dark and 4.57:1 light.

## Content

- Follow the brand Content rules.
- **Surface specifics:**
  - Menu labels name the source and target ("Rebase feature/greeting onto main").
  - Disabled items carry a reason.
  - Counts use tabular figures.
  - Relative time is shown ("2m", "3d") with the absolute value in a tooltip.
  - Unknown values render as "—" with a tooltip; they are never shown as zero.
  - Remote-only graph labels show the branch name without the remote prefix, plus the remote glyph; the tooltip gives the full name ("origin/main").
  - Graph time pills use relative buckets ("an hour ago", "3 weeks ago") on the first row of each bucket.

## Accessibility

- **Keyboard:** F6 cycles regions. J/K and the arrow keys move within the graph and lists. Every menu is keyboard-openable (⇧F10, the menu key, or the row "⋯" button).
- **Graph:** exposed as a list of rows with the accessible name "<summary>, <author>, <age>, refs: …, <node kind>".
- **Focus:** a 2px `focus` ring with a 2px offset. It is never hidden under sticky headers, because scroll padding reserves space for them.
- **Hit targets:** at least 24px, including 8px divider hit areas.
- **Contrast:** token pairs are validated by lint, and translucent materials by the worst-case aurora composite recorded in §Colors (S10). Rendered contrast is checked in both themes after implementation.
- **Aurora:** decorative and `aria-hidden`; it never carries state that the operation banner does not also state in text.

## Verification

- **Lint:** `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict`, which checks component contrast in both themes (S10).
- **Render matrix:** `python3 ~/.agents/skills/daedalus/scripts/design_md.py matrix app/DESIGN.md`. The specimens in [../docs/design/specimens/](../docs/design/specimens/) exercise it: `workspace.html` (screen 1) and one file per screen in `screens/`, built on the shared `specimen.css` and `specimen.js`. Each specimen's hash selects the theme and state (`dark`, `light`, `-still0` for a deterministic aurora phase; the workspace also takes `-rebase` and `-highlight`). Specimens are proposal evidence, not implementation.
- **Review-only until implementation:** S1–S9, S11–S16. Implementation must add:
  - a token source;
  - a repository drift test comparing this front matter with the token source in both directions;
  - render checks at `minimum`, `laptop`, `desktop`, and `wide` in both themes, with the aurora at its worst-case phase.

## Maintenance

- Change the rule here first and obtain approval.
- Update the token source, components, tests, and this file in the same change.
- Run the strict lint and, once code exists, the repository drift check.
- **Placement:** this surface file lives beside the SolidJS frontend as `app/DESIGN.md`; its token source is `app/src/styles/tokens.css`, and `app/src/styles/tokens.test.ts` checks drift in both directions (`pnpm test` in `app/`).

## Do's and Don'ts

- Do encode state in two channels, keep tags visible, name both refs in integration verbs, and put every bar item on a control or chip.
- Don't add card grids, gradients or glows outside the aurora, uppercase section labels, hover-only actions, a default-focused destructive button, or GitKraken service surfaces.

## Exceptions

| Rule | Scope | Reason | Approved by | Review date |
|---|---|---|---|---|
| S10 | Rendered contrast | Only token pairs are linted until an implementation exists; specimen renders and the worst-case composites are advisory | User (Phase 8 approval, 2026-09-29) | 2026-10-29 |
| S10 | Graph lane lines: dark lane 2 (2.57:1); light lanes 7 (1.58:1), 8 (1.78:1), and 9 (2.01:1) | GitKraken-exact palette (P-G1); column position, labels, and initials also identify lanes. Contrast-safe values if revisited: dark 2 `#A800E6`; light 7 `#B4900B`, 8 `#58A720`, 9 `#26A880` | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| S10 | Dimmed graph rows (branch-hover highlight, search non-match): 1.86:1 dark, 1.61:1 light | Transient de-emphasis that matches GitKraken; highlighted rows keep full contrast | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| Brand Typography (no uppercase headers) | Graph column header | GitKraken parity (P-G1) | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
