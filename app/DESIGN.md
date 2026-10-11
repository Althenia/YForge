---
version: alpha
name: YForge desktop
description: Dense, keyboard-complete desktop Git client UI (Vite + SolidJS in a Rust desktop shell) covering the graph, inspector, diff, and conflict resolver; macOS first.
surface: web
extends: ../DESIGN.md
colors:
  backdrop: "#141619"
  canvas: "#1A1C1F"
  surface-1: "#23252B"
  surface-2: "#2D3037"
  surface-3: "#3B3F48"
  surface-raised: "#343842"
  rule: "#3B3F47"
  rule-panel: "#3B3F47"
  rule-strong: "#6E7685"
  text: "#F2F4F7"
  text-muted: "#B3BAC6"
  text-subtle: "#A9B1BD"
  text-inverse: "#15171A"
  accent: "#4EE29B"
  on-accent: "#04150C"
  accent-tint: "#1D3A2E"
  accent-ink: "#5BE6A4"
  on-attention: "#1B1405"
  attention-tint: "#3A3426"
  attention-ink: "#F7D37C"
  head-junction: "{colors.attention}"
  danger: "#FF7B7B"
  on-danger: "#1E0B0B"
  danger-tint: "#3E2429"
  danger-ink: "#FF8585"
  info: "#82AAFF"
  info-tint: "#243352"
  info-ink: "#82AAFF"
  focus: "#4EE29B"
  selection: "#2A3B5D"
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
  lane-0-label: "#19343C"
  lane-1-label: "#162A46"
  lane-2-label: "#2F173C"
  lane-3-label: "#391B3A"
  lane-4-label: "#3C172E"
  lane-5-label: "#3A171A"
  lane-6-label: "#412822"
  lane-7-label: "#413B23"
  lane-8-label: "#2B3E24"
  lane-9-label: "#1E3C36"
  lane-0-label-active: "#184E5C"
  lane-1-label-active: "#123971"
  lane-2-label-active: "#46115D"
  lane-3-label-active: "#5B1A58"
  lane-4-label-active: "#63123E"
  lane-5-label-active: "#5E1214"
  lane-6-label-active: "#6C3525"
  lane-7-label-active: "#6C5E27"
  lane-8-label-active: "#3F6428"
  lane-9-label-active: "#22604F"
  graph-initials-dark: "#000000"
  graph-initials-light: "#FFFFFF"
  graph-text: "#C6C6C7"
  graph-text-body: "#A3A4A5"
  graph-text-dim: "#48494C"
  graph-text-active: "#FFFFFF"
  graph-row-hover: "#25272A"
  graph-pill: "#2C2E31"
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
  toolbar: "#2D3037"
  toolbar-hover: "#3B3F48"
  panel-head: "#2B2E35"
  field: "#15171A"
  selection-edge: "#82AAFF"

typography:
  ui-body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.54
  ui-label:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.54
  ui-strong:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.54
  ui-small:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.33
  ui-caption:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.33
  ui-section:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.33
  ui-micro:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.45
  title:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.01em
  heading:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.3
  code:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  ref:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 13px
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
  height-chip: 32px
  height-dense: 24px
  hit-min: 24px
  focus-ring: 2px
  focus-offset: 2px
  selection-bar: 2px
  row-graph: 28px
  graph-row-inner: 22px
  graph-header: 30px
  graph-gutter: 4px
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
  row-list: 32px
  row-file: 32px
  row-detail: 28px
  row-repository: 42px
  panel-header: 40px
  sidebar-section-header: 36px
  banner: 30px
  bar-tabs: 40px
  tab-min: 128px
  bar-command: 48px
  bar-state: 44px
  bar-activity: 30px
  divider-hit: 8px
layout:
  sidebar: 260px
  sidebar-medium: 220px
  sidebar-rail: 48px
  inspector: 380px
  inspector-medium: 340px
  inspector-compact: 320px
  panel-gap: 8px
  command-field: 440px
  command-field-medium: 300px
  command-field-min: 210px
  window-min-width: 960px
  window-min-height: 600px
  commit-summary-guide: 72ch
  list-min-rows: 4
  graph-ref-column: 130px
  graph-ref-column-min: 32px
  graph-ref-column-max: 300px
  graph-column: 56px
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
    rounded: "{rounded.pill}"
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
      backdrop: "#D7DBE2"
      canvas: "#FFFFFF"
      surface-1: "#F6F7F9"
      surface-2: "#EDEFF3"
      surface-3: "#DFE3E9"
      surface-raised: "#FFFFFF"
      rule: "#CAD0D8"
      rule-panel: "#CAD0D8"
      rule-strong: "#687180"
      text: "#12151A"
      text-muted: "#4A5260"
      text-subtle: "#565E6C"
      text-inverse: "#F2F4F7"
      accent: "#0B8550"
      on-accent: "#FFFFFF"
      accent-tint: "#E0F4E9"
      accent-ink: "#0A7B47"
      on-attention: "#1B1405"
      attention-tint: "#FBF0DA"
      attention-ink: "#8A5A00"
      head-junction: "#B87800"
      danger: "#C53A3A"
      on-danger: "#FFFFFF"
      danger-tint: "#F9EBEB"
      danger-ink: "#9E2A2A"
      info: "#1C5FC4"
      info-tint: "#E2EBFA"
      info-ink: "#154E98"
      focus: "#0B8B50"
      selection: "#E5ECFF"
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
      toolbar: "#EDEFF3"
      toolbar-hover: "#DFE3E9"
      panel-head: "#E8EBF0"
      field: "#FFFFFF"
      selection-edge: "#2F5FC4"
    elevation:
      panel: "none"
      raised: "0 1px 2px rgba(16, 24, 40, 0.06), 0 0 0 1px rgba(16, 24, 40, 0.08)"
      overlay: "0 8px 24px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.08)"
      modal: "0 24px 48px rgba(16, 24, 40, 0.18), 0 4px 12px rgba(16, 24, 40, 0.10)"
  classic:
    colors:
      backdrop: "#181818"
      canvas: "#181818"
      surface-1: "#282828"
      surface-2: "#383838"
      surface-3: "#383838"
      surface-raised: "#282828"
      rule: "#383838"
      rule-panel: "#383838"
      rule-strong: "#b8b8b8"
      text: "#d8d8d8"
      text-muted: "#b8b8b8"
      text-subtle: "#b8b8b8"
      text-inverse: "#181818"
      accent: "#a1b56c"
      on-accent: "#000000"
      accent-tint: "#282828"
      accent-ink: "#a1b56c"
      on-attention: "#181818"
      attention-tint: "#282828"
      attention-ink: "#f7ca88"
      head-junction: "#f7ca88"
      danger: "#d19a98"
      on-danger: "#000000"
      danger-tint: "#282828"
      danger-ink: "#d19a98"
      info: "#7cafc2"
      info-tint: "#282828"
      info-ink: "#7cafc2"
      focus: "#7cafc2"
      toolbar: "#282828"
      toolbar-hover: "#383838"
      panel-head: "#282828"
      field: "#181818"
      selection-edge: "#7cafc2"
      selection: "#383838"
      status-added: "#a1b56c"
      status-modified: "#f7ca88"
      status-deleted: "#c37b78"
      status-renamed: "#7cafc2"
      status-untracked: "#86c1b9"
      status-conflicted: "#ba8baf"
      status-ignored: "#8f8f8f"
      graph-text: "#d8d8d8"
      graph-text-body: "#b8b8b8"
      graph-text-active: "#e8e8e8"
      graph-row-hover: "#282828"
      graph-pill: "#282828"
      diff-added-word: "#181818"
      diff-removed-word: "#181818"
      diff-added-selected: "#282828"
      diff-removed-selected: "#282828"
      syntax-keyword: "#ba8baf"
      syntax-string: "#a1b56c"
      syntax-number: "#dc9656"
      syntax-comment: "#b8b8b8"
      syntax-function: "#7cafc2"
      syntax-type: "#f7ca88"
      syntax-property: "#86c1b9"
  ocean:
    colors:
      backdrop: "#2b303b"
      canvas: "#2b303b"
      surface-1: "#343d46"
      surface-2: "#4f5b66"
      surface-3: "#4f5b66"
      surface-raised: "#343d46"
      rule: "#4f5b66"
      rule-panel: "#4f5b66"
      rule-strong: "#a7adba"
      text: "#d7dae0"
      text-muted: "#cfd2d9"
      text-subtle: "#a7adba"
      text-inverse: "#2b303b"
      accent: "#a3be8c"
      on-accent: "#000000"
      accent-tint: "#343d46"
      accent-ink: "#c5d6b6"
      on-attention: "#2b303b"
      attention-tint: "#343d46"
      attention-ink: "#eed29b"
      head-junction: "#ebcb8b"
      danger: "#eac8cb"
      on-danger: "#000000"
      danger-tint: "#343d46"
      danger-ink: "#eac8cb"
      info: "#8fa1b3"
      info-tint: "#343d46"
      info-ink: "#9faebe"
      focus: "#9faebe"
      toolbar: "#343d46"
      toolbar-hover: "#4f5b66"
      panel-head: "#343d46"
      field: "#2b303b"
      selection-edge: "#9faebe"
      selection: "#4f5b66"
      status-added: "#c5d6b6"
      status-modified: "#ebcb8b"
      status-deleted: "#d4959c"
      status-renamed: "#97a8b8"
      status-untracked: "#96b5b4"
      status-conflicted: "#bd9cb7"
      status-ignored: "#9ea7ad"
      graph-text: "#c0c5ce"
      graph-text-body: "#a7adba"
      graph-text-active: "#dfe1e8"
      graph-row-hover: "#343d46"
      graph-pill: "#343d46"
      diff-added-word: "#2b303b"
      diff-removed-word: "#2b303b"
      diff-added-selected: "#343d46"
      diff-removed-selected: "#343d46"
      syntax-keyword: "#bf9eb8"
      syntax-string: "#a3be8c"
      syntax-number: "#d79884"
      syntax-comment: "#a7adba"
      syntax-function: "#9faebe"
      syntax-type: "#ebcb8b"
      syntax-property: "#96b5b4"
  eighties:
    colors:
      backdrop: "#2d2d2d"
      canvas: "#2d2d2d"
      surface-1: "#393939"
      surface-2: "#515151"
      surface-3: "#515151"
      surface-raised: "#393939"
      rule: "#515151"
      rule-panel: "#515151"
      rule-strong: "#a09f93"
      text: "#deddd7"
      text-muted: "#cbcbc4"
      text-subtle: "#a09f93"
      text-inverse: "#2d2d2d"
      accent: "#99cc99"
      on-accent: "#000000"
      accent-tint: "#393939"
      accent-ink: "#a7d3a7"
      on-attention: "#2d2d2d"
      attention-tint: "#393939"
      attention-ink: "#ffcc66"
      head-junction: "#ffcc66"
      danger: "#f8b4b7"
      on-danger: "#000000"
      danger-tint: "#393939"
      danger-ink: "#f8b4b7"
      info: "#6699cc"
      info-tint: "#393939"
      info-ink: "#7ba7d3"
      focus: "#7ba7d3"
      toolbar: "#393939"
      toolbar-hover: "#515151"
      panel-head: "#393939"
      field: "#2d2d2d"
      selection-edge: "#7ba7d3"
      selection: "#515151"
      status-added: "#a7d3a7"
      status-modified: "#ffcc66"
      status-deleted: "#f38082"
      status-renamed: "#7aa6d3"
      status-untracked: "#66cccc"
      status-conflicted: "#cc99cc"
      status-ignored: "#a3a29c"
      graph-text: "#d3d0c8"
      graph-text-body: "#a09f93"
      graph-text-active: "#e8e6df"
      graph-row-hover: "#393939"
      graph-pill: "#393939"
      diff-added-word: "#2d2d2d"
      diff-removed-word: "#2d2d2d"
      diff-added-selected: "#393939"
      diff-removed-selected: "#393939"
      syntax-keyword: "#cc99cc"
      syntax-string: "#99cc99"
      syntax-number: "#f99157"
      syntax-comment: "#adaca2"
      syntax-function: "#7ba7d3"
      syntax-type: "#ffcc66"
      syntax-property: "#66cccc"
  gruvbox:
    colors:
      backdrop: "#282828"
      canvas: "#282828"
      surface-1: "#3c3836"
      surface-2: "#504945"
      surface-3: "#504945"
      surface-raised: "#3c3836"
      rule: "#504945"
      rule-panel: "#504945"
      rule-strong: "#bdae93"
      text: "#e4d9c3"
      text-muted: "#c6b9a2"
      text-subtle: "#bdae93"
      text-inverse: "#282828"
      accent: "#b8bb26"
      on-accent: "#000000"
      accent-tint: "#3c3836"
      accent-ink: "#c2c544"
      on-attention: "#282828"
      attention-tint: "#3c3836"
      attention-ink: "#fabd2f"
      head-junction: "#fabd2f"
      danger: "#fca9a0"
      on-danger: "#000000"
      danger-tint: "#3c3836"
      danger-ink: "#fca9a0"
      info: "#83a598"
      info-tint: "#3c3836"
      info-ink: "#94b2a6"
      focus: "#83a598"
      toolbar: "#3c3836"
      toolbar-hover: "#504945"
      panel-head: "#3c3836"
      field: "#282828"
      selection-edge: "#83a598"
      selection: "#504945"
      status-added: "#c2c544"
      status-modified: "#fabd2f"
      status-deleted: "#fc7b6b"
      status-renamed: "#88a99c"
      status-untracked: "#8ec07c"
      status-conflicted: "#d68da1"
      status-ignored: "#a6a19c"
      graph-text: "#d5c4a1"
      graph-text-body: "#bdae93"
      graph-text-active: "#ebdbb2"
      graph-row-hover: "#3c3836"
      graph-pill: "#3c3836"
      diff-added-word: "#282828"
      diff-removed-word: "#282828"
      diff-added-selected: "#3c3836"
      diff-removed-selected: "#3c3836"
      syntax-keyword: "#d997a9"
      syntax-string: "#b8bb26"
      syntax-number: "#fe8019"
      syntax-comment: "#bdae93"
      syntax-function: "#94b2a6"
      syntax-type: "#fabd2f"
      syntax-property: "#8ec07c"
  nord:
    colors:
      backdrop: "#2E3440"
      canvas: "#2E3440"
      surface-1: "#3B4252"
      surface-2: "#434C5E"
      surface-3: "#434C5E"
      surface-raised: "#3B4252"
      rule: "#434C5E"
      rule-panel: "#434C5E"
      rule-strong: "#D8DEE9"
      text: "#E5E9F0"
      text-muted: "#D8DEE9"
      text-subtle: "#D8DEE9"
      text-inverse: "#2E3440"
      accent: "#BF616A"
      on-accent: "#000000"
      accent-tint: "#3B4252"
      accent-ink: "#e2b4b8"
      on-attention: "#2E3440"
      attention-tint: "#3B4252"
      attention-ink: "#b3c4d8"
      head-junction: "#5E81AC"
      danger: "#99c9d7"
      on-danger: "#000000"
      danger-tint: "#3B4252"
      danger-ink: "#99c9d7"
      info: "#EBCB8B"
      info-tint: "#3B4252"
      info-ink: "#EBCB8B"
      focus: "#EBCB8B"
      toolbar: "#3B4252"
      toolbar-hover: "#434C5E"
      panel-head: "#3B4252"
      field: "#2E3440"
      selection-edge: "#EBCB8B"
      selection: "#434C5E"
      status-added: "#e2b4b8"
      status-modified: "#99b0cb"
      status-deleted: "#88C0D0"
      status-renamed: "#EBCB8B"
      status-untracked: "#daa18e"
      status-conflicted: "#A3BE8C"
      status-ignored: "#a9aeb7"
      graph-text: "#E5E9F0"
      graph-text-body: "#D8DEE9"
      graph-text-active: "#ECEFF4"
      graph-row-hover: "#3B4252"
      graph-pill: "#3B4252"
      diff-added-word: "#2E3440"
      diff-removed-word: "#2E3440"
      diff-added-selected: "#3B4252"
      diff-removed-selected: "#3B4252"
      syntax-keyword: "#A3BE8C"
      syntax-string: "#dda8ad"
      syntax-number: "#a2b9d1"
      syntax-comment: "#D8DEE9"
      syntax-function: "#EBCB8B"
      syntax-type: "#a7bad2"
      syntax-property: "#dda695"
  dracula:
    colors:
      backdrop: "#282936"
      canvas: "#282936"
      surface-1: "#3a3c4e"
      surface-2: "#4d4f68"
      surface-3: "#4d4f68"
      surface-raised: "#3a3c4e"
      rule: "#4d4f68"
      rule-panel: "#4d4f68"
      rule-strong: "#62d6e8"
      text: "#e9e9f4"
      text-muted: "#62d6e8"
      text-subtle: "#62d6e8"
      text-inverse: "#282936"
      accent: "#ebff87"
      on-accent: "#000000"
      accent-tint: "#3a3c4e"
      accent-ink: "#ebff87"
      on-attention: "#282936"
      attention-tint: "#3a3c4e"
      attention-ink: "#00f769"
      head-junction: "#00f769"
      danger: "#f6addb"
      on-danger: "#000000"
      danger-tint: "#3a3c4e"
      danger-ink: "#f6addb"
      info: "#62d6e8"
      info-tint: "#3a3c4e"
      info-ink: "#62d6e8"
      focus: "#62d6e8"
      toolbar: "#3a3c4e"
      toolbar-hover: "#4d4f68"
      panel-head: "#3a3c4e"
      field: "#282936"
      selection-edge: "#62d6e8"
      selection: "#4d4f68"
      status-added: "#ebff87"
      status-modified: "#00f769"
      status-deleted: "#f083c8"
      status-renamed: "#62d6e8"
      status-untracked: "#a1efe4"
      status-conflicted: "#cd92df"
      status-ignored: "#a5a6b8"
      graph-text: "#e9e9f4"
      graph-text-body: "#62d6e8"
      graph-text-active: "#f1f2f8"
      graph-row-hover: "#3a3c4e"
      graph-pill: "#3a3c4e"
      diff-added-word: "#282936"
      diff-removed-word: "#282936"
      diff-added-selected: "#3a3c4e"
      diff-removed-selected: "#3a3c4e"
      syntax-keyword: "#d097e1"
      syntax-string: "#ebff87"
      syntax-number: "#d097e1"
      syntax-comment: "#62d6e8"
      syntax-function: "#62d6e8"
      syntax-type: "#00f769"
      syntax-property: "#a1efe4"
  monokai:
    colors:
      backdrop: "#272822"
      canvas: "#272822"
      surface-1: "#383830"
      surface-2: "#49483e"
      surface-3: "#49483e"
      surface-raised: "#383830"
      rule: "#49483e"
      rule-panel: "#49483e"
      rule-strong: "#a59f85"
      text: "#f8f8f2"
      text-muted: "#bdb8a5"
      text-subtle: "#a59f85"
      text-inverse: "#272822"
      accent: "#a6e22e"
      on-accent: "#000000"
      accent-tint: "#383830"
      accent-ink: "#a6e22e"
      on-attention: "#272822"
      attention-tint: "#383830"
      attention-ink: "#f4bf75"
      head-junction: "#f4bf75"
      danger: "#fc99bd"
      on-danger: "#000000"
      danger-tint: "#383830"
      danger-ink: "#fc99bd"
      info: "#66d9ef"
      info-tint: "#383830"
      info-ink: "#66d9ef"
      focus: "#66d9ef"
      toolbar: "#383830"
      toolbar-hover: "#49483e"
      panel-head: "#383830"
      field: "#272822"
      selection-edge: "#66d9ef"
      selection: "#49483e"
      status-added: "#a6e22e"
      status-modified: "#f4bf75"
      status-deleted: "#fb72a3"
      status-renamed: "#66d9ef"
      status-untracked: "#a1efe4"
      status-conflicted: "#b48aff"
      status-ignored: "#a3a094"
      graph-text: "#f8f8f2"
      graph-text-body: "#a59f85"
      graph-text-active: "#f5f4f1"
      graph-row-hover: "#383830"
      graph-pill: "#383830"
      diff-added-word: "#272822"
      diff-removed-word: "#272822"
      diff-added-selected: "#383830"
      diff-removed-selected: "#383830"
      syntax-keyword: "#b993ff"
      syntax-string: "#a6e22e"
      syntax-number: "#fd971f"
      syntax-comment: "#b2ac96"
      syntax-function: "#66d9ef"
      syntax-type: "#f4bf75"
      syntax-property: "#a1efe4"
  woodland:
    colors:
      backdrop: "#231e18"
      canvas: "#231e18"
      surface-1: "#302b25"
      surface-2: "#48413a"
      surface-3: "#48413a"
      surface-raised: "#302b25"
      rule: "#48413a"
      rule-panel: "#48413a"
      rule-strong: "#b4a490"
      text: "#e2dad4"
      text-muted: "#bfb1a0"
      text-subtle: "#b4a490"
      text-inverse: "#231e18"
      accent: "#b7ba53"
      on-accent: "#000000"
      accent-tint: "#302b25"
      accent-ink: "#b7ba53"
      on-attention: "#231e18"
      attention-tint: "#302b25"
      attention-ink: "#e0ac16"
      head-junction: "#e0ac16"
      danger: "#e7a6a6"
      on-danger: "#000000"
      danger-tint: "#302b25"
      danger-ink: "#e7a6a6"
      info: "#88a4d3"
      info-tint: "#302b25"
      info-ink: "#88a4d3"
      focus: "#88a4d3"
      toolbar: "#302b25"
      toolbar-hover: "#48413a"
      panel-head: "#302b25"
      field: "#231e18"
      selection-edge: "#88a4d3"
      selection: "#48413a"
      status-added: "#b7ba53"
      status-modified: "#e0ac16"
      status-deleted: "#da7575"
      status-renamed: "#88a4d3"
      status-untracked: "#6eb958"
      status-conflicted: "#bb90e2"
      status-ignored: "#a19076"
      graph-text: "#cabcb1"
      graph-text-body: "#b4a490"
      graph-text-active: "#e2d6ce"
      graph-row-hover: "#302b25"
      graph-pill: "#302b25"
      diff-added-word: "#231e18"
      diff-removed-word: "#231e18"
      diff-added-selected: "#302b25"
      diff-removed-selected: "#302b25"
      syntax-keyword: "#bb90e2"
      syntax-string: "#b7ba53"
      syntax-number: "#d1914f"
      syntax-comment: "#b4a490"
      syntax-function: "#88a4d3"
      syntax-type: "#e0ac16"
      syntax-property: "#6eb958"
elevation:
  panel: "none"
  raised: "0 1px 2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04)"
  overlay: "0 8px 24px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.30)"
  modal: "0 24px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35)"
materials:
  panel:
    background: "{colors.surface-1}"
    fallback: "{colors.surface-1}"
    blur: 0px
    rim: "1px solid {colors.rule-panel}"
    shadow: "{elevation.panel}"
  graph:
    background: "{colors.canvas}"
    fallback: "{colors.canvas}"
    blur: 0px
    rim: "1px solid {colors.rule-panel}"
  raised:
    background: "{colors.surface-raised}"
    fallback: "{colors.surface-raised}"
    blur: 0px
  control:
    background: "{colors.surface-2}"
    fallback: "{colors.surface-2}"
    blur: 0px
    rim: "inset 0 0 0 1px {colors.rule}"
  control-hover:
    background: "{colors.surface-3}"
    fallback: "{colors.surface-3}"
    blur: 0px
    rim: "inset 0 0 0 1px {colors.rule}"
layers:
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
    toast-countdown: "the toast ring's stroke empties linearly over the toast lifetime and holds while the toast is hovered or holds focus; static under reduced motion"
    view-swap: "held content fades from opacity 1 to 0 over quick with standard easing above its replacement, which is opaque underneath; the replacement never fades in; instant under reduced motion"
    feedback-enter: "opacity 0 to 1 and translateY 4px to 0 over quick with entrance easing, for the operation pill and its result chip; instant under reduced motion"
---

# YForge desktop surface rules

## Overview

This surface is the YForge desktop application: a dense professional tool with one repository per tab. It contains:

- tab bar, command bar, state strip;
- sidebar, graph, inspector;
- center views (diff, file view, conflict resolver, interactive rebase editor, recompose, worktrees, recovery);
- the Activity drawer;
- settings, including AI providers, platform connections, and Privacy & diagnostics;
- platform integrations: the sidebar Pull requests section, the pull request inspector, the pull request compose view, and the merge dialog;
- history-editing dialogs (squash) and the optional AI drafts (commit message, conflict proposal, recompose proposal).

The defaults are:

- **Density:** "default" graph lanes (22px pitch and nodes) or "compact" lanes (10px pitch and nodes, 1px lines), GitKraken's two modes; graph rows stay 28px.
- **Theme:** Dark is the base theme; Light and System are first-class. Both themes use solid surfaces told apart by tone (S14).
- **Motion:** functional only (brand B7).
- **Viewports:** 1440×900 is the primary design viewport; 1280×720 is the supported laptop viewport; 960×600 is the minimum window.

This file extends the brand root [../DESIGN.md](../DESIGN.md). Its rules and values were approved on 2026-09-29 (Phase 8), revised by the approved GitKraken graph parity (P-G1), the approved lean Y Aurora direction with tinted Rail graph styling (2026-09-29), and the approved diagnostics rule S16 with the Switch component and the approved cursor rule S17 (both 2026-09-30, owner delegation), the approved graph, state strip, and sidebar rules S21 to S23 (2026-09-30, owner delegation), the approved AI assistance, history-editing, and third-party mark rules S24 to S26 (2026-09-30, owner delegation), and the approved recovery, worktree, file view, and command line rules S27 to S30 (2026-09-30, owner delegation), the platform, sidebar UX, workspace Esc, AI v2, and drag rules S31 to S34 and S36 (proposed 2026-09-30 to 2026-10-01, approved 2026-10-03 by the owner), and the design the owner chose through the 2026-10 proposal rounds (`docs/design/proposals/2026-10-*`): the solid charcoal palette with no aurora (S14), the Launchpad as the landing screen (S41), and the toast, tree view, Changes panel, Merge Tool, file history and blame, and AI rules S48 to S53 (2026-10-03, approved by the owner), and the motion review choices the owner approved on 2026-10-08 (`docs/design/proposals/2026-10-motion/`): hold-and-settle continuity (S72), operation feedback and incoming markers (S73, S74), and pull request badges, conflict prediction, the compose view, and AI pull request drafts (S75 to S78). The UI is built with Vite + SolidJS and rendered in the system webview of a Rust desktop shell, so web-surface practices apply:

- `color-scheme` set per theme;
- owned scrollbars;
- hover styles only for hover-capable pointers;
- focus styled with `:focus-visible`.

## Principles

- **The graph is the canvas.** Chrome recedes into flat, quiet controls and panels so that lanes, ref labels, and nodes carry the signal.
- **Separation by tone.** Every region is opaque: the tab bar, command bar, state strip, and activity bar sit on the darkest `backdrop`; the sidebar, graph, and inspector are rounded panels 8px apart; panels are lighter than the graph; fields are recessed; menus, dialogs, and toasts are raised. Only commit-graph rows may fade opaque lane color into canvas (brand B8); there is no other gradient, translucency, glow, or blur.
- **Graph topology parity with GitKraken.** The commit graph reproduces GitKraken Desktop 12.5.0's lane colors, lane assignment, geometry, edge routing, and node kinds (change P-G1, approved 2026-09-29), so users read topology the way they already know it. Row and ref label styling is YForge's own **tinted Rail** treatment, and the chrome around the graph stays YForge's own.
- **Meaning is layered.** Every state is encoded in at least two channels:
  - color;
  - shape or glyph;
  - text.

  This lets lane and status colors stay readable in both themes, and without color (B4).
- **Density with rhythm.** A 4px spacing scale, 32px sidebar rows, 15px UI prose, and unchanged 28px rows with 12px text in the graph. Alignment comes from columns, not boxes, so there are no card grids.
- **Stable geometry.** Async regions reserve their final size, and refreshes keep stale rows visible and marked busy.
- **Parity of input.** Anything a pointer can do is reachable by keyboard, and every hover affordance has a focus equivalent.

## Rules

| ID | Status | Binding statement | Enforcing check |
|---|---|---|---|
| S1 | approved | Graph nodes MUST encode kind by shape in addition to lane color: author disc (commit), 12px dot (merge), dotted ring (Changes), dotted square (stash). | review-only: approved 2026-09-29 (P-G1) |
| S2 | approved | Graph ref labels MUST use the tinted Rail treatment: a solid 18% lane-tint fill with a 3px lane-color inline-start edge, graph text, and a ref-kind glyph; the checked-out branch MUST show a check on the 38% lane fill; tags MUST use the solid outlined tag label. A row MUST show one ref label at its full width (the checked-out branch, else the first branch, else the first tag) and fold every other branch and tag into the `+N` overflow (S21), so labels never shrink against each other. | review-only: approved 2026-09-29 (tinted Rail); one label per row with tags in the overflow `app/src/components/GraphPanel.test.tsx`, `app/src/graph/refLabels.test.ts` · approved 2026-10-03 by the owner (GitKraken ref stack) |
| S3 | approved | Every file status color MUST pair with its status icon from one `statusIcon` mapping, and each icon MUST be named with its status word through its accessible name and tooltip; NEVER use color alone or render file status letters. The mapping MUST use plus for Added, minus for Deleted, edit for Modified, warning for Conflicted, copy for Copied, an arrow into a text bar for Renamed, two swapped arrows for Type changed, and a dashed-outline file for Untracked. Every file-status surface, including Changes chip counts, MUST use this mapping. | `app/src/state/changes.test.ts`, `app/src/components/FileRow.test.tsx`, `app/src/components/StateStrip.test.tsx` · approved 2026-09-29; amended 2026-10-10 by the owner: status icons everywhere, reuse plus/minus/edit/warning/copy and add renamed/type_changed/untracked glyphs |
| S4 | approved | The state strip MUST be visible in every repository view and MUST show the operation state whenever Git is mid-operation. | review-only: approved 2026-09-29 |
| S5 | approved | Destructive actions MUST use danger tokens and MUST NEVER be the default focused control. | review-only: approved 2026-09-29 |
| S6 | approved | Selected rows MUST show the selection fill plus a 2px inline-start `selection-edge` bar, except graph rows, which MUST show the selection fill plus the full-opacity lane strip; keyboard focus MUST show a 2px focus ring with a 2px offset. | review-only: approved 2026-09-29 (Rail); the bar moved from accent to `selection-edge` 2026-10-03 (owner) |
| S7 | approved | An action shown on hover MUST also be available on focus or selection; NEVER create hover-only actions. | review-only: approved 2026-09-29 |
| S8 | approved | Async regions MUST reserve their final geometry, and refreshes MUST keep stale rows visible and marked busy. | review-only: approved 2026-09-29 |
| S9 | approved | At 1280×720 the window MUST NOT scroll horizontally, and each staging list MUST show at least four rows. | review-only: approved 2026-09-29 |
| S10 | approved | Text MUST reach 4.5:1 and meaningful graphics 3:1 in every theme, measured against the opaque surface it sits on (`backdrop` included, for the bars); `contrast.test.ts` measures every reading surface. | `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict` for token pairs; render checks after implementation |
| S11 | approved | Motion MUST use brand durations, animate only opacity and transform, and NEVER slide graph rows; there is no ambient motion. | review-only: approved 2026-09-29; aurora drift withdrawn 2026-10-03 (owner) |
| S12 | approved | SHAs, paths, commands, and ref names outside the graph MUST use the mono roles; graph ref labels MUST use the `graph` role and graph tags the `graph-tag` role; paths MUST truncate from the left. | review-only: approved 2026-09-29 (Rail) |
| S13 | approved | The commit graph MUST follow GitKraken 12.5.0: lane color by column index over 10 colors, leftmost-free column reuse, 22px lane pitch and author discs, 2px orthogonal edges with 11px rounded corners; row treatments MUST follow COMPONENT_SPECS § Graph row. | review-only: approved 2026-09-29 (P-G1, Rail); render checks after implementation |
| S14 | approved | Every region MUST be an opaque surface told apart by tone, NEVER by translucency, glow, or blur; only the graph-row band may use the opaque lane-color fade in S64, with no other gradients. The tab bar, command bar, state strip, and activity bar use `backdrop` (the darkest); the sidebar and inspector use `surface-1` with `panel-head` headers; the graph and center views use `canvas`; fields recess on `field`; toolbar-style controls use `toolbar` with `toolbar-hover`; and menus, popovers, dialogs, tooltips, and toasts rise on `surface-raised` with their elevation. The three panels MUST be `rounded.lg` with a 1px `rule-panel` border and `layout.panel-gap` apart; selected rows use `selection` with the S6 `selection-edge` bar, and `accent` stays for affirmative actions and success. | `app/src/styles/tokens.test.ts`, `app/src/styles/contrast.test.ts`, `app/src/styles/surfaces.render.test.tsx` · scoped graph exception approved 2026-10-04 by the owner |
| S15 | approved | Controls and labels MUST be icon-driven where an established glyph carries the meaning (row actions, tab and pane controls, toolbar actions, section headers, state chips, menu items); every icon-only control MUST have an accessible name and a tooltip naming the action and its shortcut; confirmation, dialog, operation-banner, and destructive buttons MUST keep a text label; an icon MUST NEVER be the only carrier of state (B4). | review-only: approved 2026-09-30 |
| S16 | approved | Diagnostics data (usage events, crash reports, persisted activity history) MUST stay on this Mac and MUST be managed in Settings → Privacy & diagnostics: usage recording MUST be opt-in, off by default, and its setting MUST state exactly what is recorded and that nothing leaves the Mac; turning it off MUST state that stored events are deleted; every Delete or Clear MUST confirm in a dialog with a text-labelled danger button (S5, S15); an entry from an earlier session MUST say in text that it has no undo (B4). | review-only: approved 2026-09-30 (owner delegation) |
| S17 | approved | Every cursor MUST come from the `cursors` tokens as `var(--cursors-*)`, and the browser default MUST NEVER decide one: a raw cursor keyword, an inline cursor style, or a `--cursors-*` value outside `tokens.css` MUST NEVER appear. Buttons, links, tabs, menu items, palette and option rows, selectable graph, file, sidebar, and list rows, actionable chips, switches, checkboxes and radios with their labels, segmented controls, selects, and cards that act MUST use `action`; text inputs, textareas, contenteditable regions, and selectable text regions (diff content, commit message body, command output) MUST use `text`; disabled controls (`[disabled]`, `aria-disabled="true"`) MUST use `disabled` and MUST keep their reason tooltip; draggable ref labels MUST use `drag`, and the whole window MUST use `dragging` while one is dragged; panel and column dividers MUST use `resize-column` or `resize-row` by orientation; a control whose operation is running (`aria-busy="true"`) MUST use `busy`; every non-interactive surface MUST use `static`. An element that acts on click MUST be a native button or link, or carry the matching role, so the global mapping applies. | `app/src/styles/cursors.test.ts` (token-only scan of `app/src` and the specimen stylesheet, drift-checked mirror) and `app/src/styles/cursors.render.test.tsx` (rendered components) · approved 2026-09-30 (owner delegation) |
| S18 | approved | Every added or removed diff line MUST be selectable in Hunk, Inline, and Split modes through a per-line checkbox in its gutter (`role="checkbox"`, named "Select <added or removed> line <n>"; click toggles, ⇧-click extends the range within the hunk, ↑/↓ move between changed lines, ⇧↑/⇧↓ extend); a selected line MUST show the `diff-added-selected` or `diff-removed-selected` fill, the 2px `accent` inline-start bar, and a check glyph in place of the ± marker (never color alone, B4); selected lines act through Stage lines, Unstage lines, and Discard lines in the diff toolbar, and Discard lines MUST confirm with a text-labelled danger button (S5, S15); while Ignore whitespace is on, every hunk and line staging control MUST be `aria-disabled` with the tooltip and visible toolbar text "Turn off Ignore whitespace to stage changes". | `app/src/components/DiffView.test.tsx`, `app/src/state/lineSelection.test.ts`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S19 | approved | Code in a diff MUST use the `syntax-*` tokens for keyword, string, number, comment, function, type, and property, and the changed words of a paired removed and added line MUST sit on `diff-removed-word` and `diff-added-word`; every syntax color, `text`, and `text-muted` MUST reach 4.5:1 on `canvas`, `accent-tint`, `danger-tint`, both word fills, and both selected fills in both themes; a raw color MUST NEVER style code; syntax MUST never be the only carrier of added or removed (the ± marker stays); files with no grammar MUST render plain. | `app/src/styles/contrast.test.ts` (syntax and diff pairs), `app/src/styles/tokens.test.ts`, `app/src/state/syntax.test.ts`, `app/src/state/diffHighlight.test.ts` · approved 2026-09-30 (owner delegation) |
| S20 | approved | The composer's primary action MUST be a split button: the main segment commits, and the attached chevron segment (`aria-haspopup="menu"`, named "More commit actions") opens Commit (⌘↵) and Commit & Push (⌘⇧↵); Commit & Push MUST be `aria-disabled` with its reason shown in the menu whenever it cannot push (no remote, detached HEAD, operation or sync running, or an amend of a pushed commit); a failed push after a successful commit MUST leave the commit and report the push error. | `app/src/components/ChangesInspector.test.tsx`, `app/src/state/composer.test.ts` · approved 2026-09-30 (owner delegation) |
| S21 | approved | The graph MUST offer: a `+N` overflow control that is a native button named with the hidden branches and tags and opens a popover of them as ref labels (↑/↓ move, Enter activates a branch per S71, ⇧F10 opens the menu, Esc closes and returns focus to the graph; each label stays draggable and right-clickable), and hovering or focusing a row's ref cell MUST expand it into a stack of every ref label of that row, one under another at full width above the rows below, each draggable, right-clickable, and double-clickable; a column header that separates its fields with 1px `text-muted` vertical lines; an always-present working-tree row (the core's Changes row, which reads "Working tree clean" when nothing changed, and opens the Changes inspector); optional Author, Date / Time, and SHA columns, hidden by default, shown or hidden in the column settings popover, resized by focusable separators (pointer, ←/→ by 8px, Home resets) within their limits, saved per repository in the app database, and hidden below 1024px; a branch-hover highlight that fades the commits outside the hovered branch, with B pinning it from the keyboard (S7); multi-select by ⌘/Ctrl-click, ⇧-click, ⇧↑/⇧↓ (⇧J/⇧K) and Space, with a summary bar that states the count in text, Esc or Clear collapsing to one commit, and every single-commit verb disabled with the reason "Select a single commit"; branch visibility All or Current + upstream, applied by the core so the lanes are laid out again and hidden commits never render; and Reveal HEAD from the HEAD chip, H, and ⌘⇧H, run on open and after a checkout without changing the selection. | `app/src/components/GraphPanel.test.tsx`, `app/src/state/selection.test.ts`, `app/src/graph/reachability.test.ts`, `app/src/graph/columns.test.ts`, `app/src/state/graphPrefs.test.ts`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S22 | approved | Every state strip segment MUST act: HEAD reveals HEAD in the graph; the branch and upstream chip opens the branch menu (branches, Set upstream…, Unset upstream); ahead and behind opens the Pull menu; when the branch has diverged, Push MUST NOT be disabled merely for divergence and MUST open the existing force-push-with-lease confirmation directly, naming the remote commits that would be replaced and the lease, with Cancel as default focus and a danger confirm; the strip MUST NOT show a diverged notice (force push is not an item in the Fetch or Pull menu); the fetched chip fetches now, its age MUST stay current while the window is open, and when an automatic fetch fails it MUST read "Auto-fetch paused: <reason>" in text (no toast) and retry when activated; Changes opens the Changes inspector; the worktree chip opens the Worktrees panel (S28). While the machine is offline the strip MUST show a text "Offline" chip and every network menu item and command MUST be disabled with the reason "You are offline". An authentication failure MUST offer a text-labelled Fix that opens the settings section holding the credential (the SSH key for an SSH remote, the repository's remotes otherwise). The outcome of an auto-stashed pull and of a stash-and-switch MUST stay in the strip as a text notice with its actions and a dismiss (Apply and Pop for changes kept in a stash; Restore and Keep in stash when returning to a branch), never as a transient toast alone. | `app/src/components/StateStrip.test.tsx`, `app/src/state/repoActions.test.ts`, `app/src/state/syncModel.test.ts`, `app/src/state/online.test.ts` · approved 2026-09-30 (owner delegation); worktree chip amended by S28, 2026-09-30; auto-fetch failure amended 2026-10-01 by the owner; ahead/behind opens the Pull menu amended 2026-10-02 by the owner; amended 2026-10-10 by the owner: no Push/Force push result chip; Push on a diverged branch opens the force-push-with-lease confirmation |
| S23 | approved | Slash-separated local and remote branch names MUST render as folders: a chevron glyph (rotated when collapsed, by transform only), the branch count in text, `aria-expanded`, and a name that gives the full folder path; Enter, Space, → and ← toggle a folder, and the collapsed folders are saved per repository in the app database; a leaf shows its last segment with the full name in its tooltip and accessible name; a stash row selects the stash inspector (files, diff, Apply, Pop, Rename, Drop); a menu item that has a keyboard shortcut MUST show it after its label, taken from the same source as the palette. | `app/src/components/Sidebar.test.tsx`, `app/src/state/refTree.test.ts`, `app/src/state/sidebarPrefs.test.ts`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/ContextMenu.test.tsx` · approved 2026-09-30 (owner delegation) |
| S24 | approved | AI assistance MUST be optional, visibly bounded, and never automatic: every AI action MUST be an icon-only button with the neutral `wand` glyph (never sparkles, stars, or a "magic" label) whose tooltip and accessible name state what it does and to what ("Generate a commit message from the staged changes"), and whose disabled state states why in the same tooltip and name, MUST run only when the user presses it, MUST be cancellable while it runs, and MUST deliver an editable draft that changes nothing in Git until the user commits, accepts, or applies it; the generated text MUST keep the text it replaced restorable ("Restore my text", "Restore my grouping"); notes about withheld or cut files MUST be visible text; a failed AI action MUST state the cause and that nothing changed, and MUST offer the fix as a text-labelled button ("Open AI settings" for a missing or unreachable provider, "Sign in" for a revoked sign-in); Settings → AI MUST state exactly what is sent and to whom, list each provider with a status word plus glyph (never color alone, B4), never re-display a saved API key ("Key saved in the macOS Keychain" with Replace and Clear), and confirm Remove in a dialog with a text-labelled danger button (S5, S15). | `app/src/components/AiSettings.test.tsx`, `app/src/state/aiModel.test.ts`, `app/src/state/aiGenerate.test.ts`, `app/src/state/aiSignIn.test.ts`, `app/src/components/ChangesInspector.test.tsx`, `app/src/components/ConflictResolver.test.tsx`, `app/src/components/RecomposeView.test.tsx` · approved 2026-09-30 (owner delegation); the active-provider clause withdrawn 2026-10-01 at the owner's request (per-feature setup, S34); icon-only AI buttons approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-flow-minimal/`) |
| S25 | approved | History-editing views (the interactive rebase editor, the squash dialog, and the recompose view) MUST state the consequence before they act: a pushed commit in the range MUST show a text warning that the next push needs a force push, naming the count and the upstream; the apply button MUST stay disabled with its reason in text (nothing changed, a blank message, a squash with nothing below it, an unassigned change, a merge commit in range, or tracked changes in the working tree); a reorder MUST be possible by drag handle, by the move buttons, and by ⌥↑ and ⌥↓ (or the number keys 1–9 to assign a recompose change, 0 to unassign), and an action MUST be settable by the keys P, R, S, F, D, and E; the resulting history MUST be previewed as text before it is applied; a drag MUST show its drop position with the accent line or the accent fill and the whole window MUST use the `dragging` cursor while it runs (S17); a rebase that stops MUST hand over to the operation banner, which states "Stopped to edit <sha>" with Continue for an edit stop, or to the conflict resolver; every rewrite MUST end in the undo toast. | `app/src/components/RebaseEditor.test.tsx`, `app/src/components/SquashDialog.test.tsx`, `app/src/components/RecomposeView.test.tsx`, `app/src/state/rebaseModel.test.ts`, `app/src/state/recomposeModel.test.ts`, `app/src/components/StateStrip.test.tsx`, `app/src/graph/labelDrag.test.ts` · approved 2026-09-30 (owner delegation) |
| S26 | approved | A third-party provider mark MUST be an official file stored unmodified in `brand/third-party/` with its source, date, terms, and sha256 in `brand/third-party/SOURCE.md`, MUST render only through `ProviderLogo`, scaled proportionally, in the variant listed for the current theme, never recolored, cropped, combined, or larger than the provider name beside it; Settings → AI MUST state that the marks belong to their owners and imply no endorsement; a provider whose terms do not permit the mark, or that has no mark, MUST use the neutral glyph (`terminal` for a CLI, `plug` for an API endpoint). | `app/src/components/AiSettings.test.tsx`, `brand/third-party/SOURCE.md` (review-only for the terms) · approved 2026-09-30 (owner delegation) |
| S27 | approved | Recovery is a center view with the tabs Reflog, Lost commits, and Snapshots (`role="tablist"`, the segmented control), and it MUST always state in visible text what it cannot recover: work changed outside YForge and never committed, objects Git has already pruned, and that snapshots are kept 30 days, appear in `git log --all` in other tools, and are pushed only by `git push --mirror`. Every reflog entry and lost commit MUST offer Restore as a branch (a popover with a suggested free name), Check out detached, and Reset the current branch (Soft, Mixed, Hard) as icon controls whose names include the short SHA; they MUST be disabled with the reason as tooltip when Git has pruned the commit or HEAD is detached. A hard reset (warning glyph, the discarded tracked changes, the safety snapshot, and Undo named), a detached checkout (the clean working tree required), Restore everything, and Delete snapshot MUST confirm with text-labelled buttons (S5, S15); Restore everything MUST name both commits when HEAD moved and is forced only after that confirmation; a snapshot restore MUST state in text the ref that holds the previous state. The lost-commit scan MUST show a status line while it runs and a text-labelled Cancel scan, and MUST state when it was cancelled or found nothing. Reflog pages of 50 load with Show older. Every restore ends in the activity toast, with Undo where the core offers one. | `app/src/components/RecoveryView.test.tsx`, `app/src/state/recoveryModel.test.ts`, `app/src/components/IconDriven.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S28 | approved | A worktree opens as its own tab, and the tabs whose repository shares one main worktree MUST sit next to each other inside one bordered `role="group"` named "<repository> and its worktrees", a linked worktree leading with the worktree glyph and no other tab carrying a mark. The Worktrees panel (opened from the state strip chip, the sidebar section, or the palette) MUST list every worktree with its branch in mono, a "Main worktree" chip, the text flags current, changes, locked, and missing, and its left-truncated path; each row MUST offer Open as tab, Open in terminal, Integrate, and Remove as icon controls named with the path or branch, marked `aria-disabled` or `disabled` with the reason as tooltip when unavailable (the worktree open here, the main worktree, a locked or missing one, a dirty or branchless one); Open in terminal MUST be offered for every worktree with the configured terminal command. Create is a dialog with New branch or Existing branch, the start point, and a suggested folder that stays editable. Remove MUST confirm, and MUST confirm again with a text-labelled danger button that names the discarded changes and the safety snapshot when the worktree has changes. Integrate MUST state the exact sequence (rebase onto the target, fast-forward the target, optional removal and branch deletion) in text before it acts, and a rebase that stops on conflicts MUST open that worktree's tab, where the operation banner and the resolver apply, with a notice that names it. The tab mark was removed 2026-10-04 at the owner's request. | `app/src/components/WorktreePanel.test.tsx`, `app/src/state/worktreeModel.test.ts`, `app/src/state/worktreeActions.test.ts`, `app/src/state/tabs.test.ts`, `app/src/components/TabBar.test.tsx`, `app/src/components/Sidebar.test.tsx`, `app/src/components/StateStrip.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S29 | approved | The file view shows one file at a revision and MUST be reachable from the diff toolbar, each commit file row, and each stash file row (an icon control named "View file" or "View <path>"; a deleted file offers none). It MUST show numbered lines in the `code` role with the `syntax-*` tokens (S19), the line count, size, and line ending as text chips, and the source (commit, Staged, Working tree, or stash) in the breadcrumb. A binary file MUST show a text placeholder with its size; a file over 2 MiB MUST show an alert stating its size and the limit with Open in editor; any other refusal MUST be shown as the core states it. Esc, the breadcrumb, and the close control MUST return to where the user came from; the view MUST NEVER edit. | `app/src/components/FileView.test.tsx`, `app/src/state/fileView.test.ts`, `app/src/components/DiffView.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/StashInspector.test.tsx`, `app/src/styles/cursors.render.test.tsx` · approved 2026-09-30 (owner delegation) |
| S30 | approved | Settings → General MUST offer a text-labelled "Install yforge command" button that states the path it wrote, whether it replaced an earlier copy, and that `~/.local/bin` must be on PATH; a refusal MUST be shown with its cause and change nothing. A path handed over by a second `yforge <path>` launch MUST open or activate its tab, and a path that is not a repository MUST be reported as a notice visible on every screen. Application state MUST live in the app database, never in browser storage: the recent palette commands and the last parent folder are read and written through `app_ui_prefs_load` and `app_ui_prefs_save`. | `app/src/components/SettingsView.test.tsx`, `app/src/state/app.test.tsx`, `app/src/state/appUiPrefs.test.ts`, `crates/yforge-core/tests/app_ui_prefs.rs` · approved 2026-09-30 (owner delegation) |
| S31 | approved | Platform integrations MUST identify GitHub, GitLab, and Bitbucket by the neutral `github`, `gitlab`, and `bitbucket` glyphs in a `material.control` tile and MUST NEVER show a platform's logo. Settings → Platforms MUST list each connection with its glyph, name, kind, and mono host; MUST never re-display a saved token (the field is empty, with "Stored in the macOS Keychain and never shown again" for a new connection and "Paste a new token" when editing); MUST state the risk of the "Accept an untrusted certificate" checkbox in plain text beside it (anyone on the network could read the token and the code) and MUST mark a connection that has it on with the text chip "Certificate not checked" and the warning glyph (B4); Test MUST report "Connected as <login>" or the failure as text, and an authentication failure MUST read "Authentication failed for <host>" with a text-labelled "Edit connection" (also in the sidebar section and the inspector); Remove MUST confirm with a text-labelled danger button (S5, S15). The sidebar "Pull requests" section MUST exist only while a connection matches one of the repository's remotes; each row MUST show `#number`, the title, the author, `source → target` in mono, and a state chip with a word and a glyph (Open with `pullrequest`, Merged with `merge`, Closed with `close`); its row actions Open in browser and Merge MUST be icon buttons named with the number, visible on focus or selection (S7) and also reachable from the row menu (⇧F10), and Merge MUST be `aria-disabled` with the reason unless the pull request is open; the section MUST say "No open pull requests" as text when empty and offer "Show merged and closed". The pull request inspector MUST show the state chip, the author, the created and updated times (absolute time with the relative age), the mergeability in words (an unknown value as "—" with a tooltip, never a value), and the changed files with their status icon named with the status word (S3), left-truncated path, and +/- counts. Creating a pull request happens in the compose view (S77), which MUST default the source to the current branch, the target to the remote's main (then master, then its first branch), and the title to the HEAD subject, MUST require a title and a target different from the source, and MUST say in text when the source branch is not on the remote. Merge MUST confirm in a dialog that names the branches and the platform, states that the merge happens on the server and cannot be undone from YForge, and states that YForge then fetches all remotes; a refused merge MUST report the platform's message and MUST NOT fetch. | `app/src/components/PlatformSettings.test.tsx`, `app/src/components/PullRequests.test.tsx`, `app/src/state/platformModel.test.ts`, `app/src/state/palette.test.ts`, `app/src/components/IconDriven.test.tsx`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-09-30 (phase 6b), approved 2026-10-03 by the owner; create flow moved to the compose view (S77), revised 2026-10-08 by the owner |
| S32 | approved | Every sidebar section, in this order (Branches, Remotes, Worktrees, Tags, Stashes, Git Flow when initialized (S57), Submodules, Hooks (S56), Pull requests, Issues, Recovery), MUST have a header that is a native button with the section glyph, the name, and a chevron (rotated when collapsed, by transform only) and reports `aria-expanded`; a collapsed section shows its header and count only, and the collapsed sections are saved per repository in the app database next to the collapsed folders (S23, S30). Every section's rows MUST be drawn as children of that section in one tree: one straight vertical indent guide per level made of a CSS line (never a glyph), the full row height, with no elbow or horizontal stub, every row a direct child of its section at the first level, branch folders and the branches of every remote nesting one level deeper (the remote itself a child of the section), and tags, stashes, worktrees, and pull requests sitting one level under their section. One input named "Filter sidebar" at the top MUST hide every row that does not contain its text (case-insensitive substring of the row name, a remote branch by its full name, a stash by message or `stash@{n}`, a worktree by folder, path, or branch, a pull request by number, title, author, or branches), MUST open the folders that hold a match without changing the saved collapse, MUST show `matched/total` in a section count while it has text, MUST clear on Escape (consuming the key), and MUST NEVER change the selection. Within one section, ctrl-click or cmd-click toggles a row (macOS delivers a ctrl-click as a context menu, with either button number, and it MUST toggle too) and shift-click extends from the last anchor, which a plain click or a ctrl-click sets; a plain click selects only that row; a selected row takes the selection fill with a 1px accent inset and `aria-pressed`; with two or more rows selected, the context menu of a selected row MUST offer the bulk action instead of the single-row entries: Delete N branches… (disabled with the reason while the checked-out branch is selected), Delete N tags…, Fetch N remotes (the core fetches every remote, and the menu says so), Drop N stashes…, and Remove N worktrees…; every destructive bulk action MUST confirm once, naming the rows and the commits that would lose their name. An author avatar (24px circle, 16px inline) MUST be the Gravatar identicon at `https://www.gravatar.com/avatar/<md5 of the trimmed lower-case email>?s=48&d=identicon` beside the author in the commit inspector and beside the git identity in the Activity drawer; it MUST be decorative (`aria-hidden`, the name stays as text), MUST show the author's initial while loading, on failure, when Settings → Privacy & diagnostics → Profile pictures is off, and where only a platform login is known (the pull request rows), and MUST request nothing in the last two cases; images are cached in memory for the session; the setting states that only the MD5 hash of the email leaves the Mac and is on by default, and lasts the session until the app database can store it (S30). | `app/src/components/Sidebar.test.tsx`, `app/src/state/sidebarModel.test.ts`, `app/src/state/refTree.test.ts`, `app/src/state/avatar.test.ts`, `app/src/components/AuthorBadge.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/ActivityDrawer.test.tsx`, `app/src/components/PrivacyDiagnostics.test.tsx`, `app/src/state/repoActions.test.ts`, `app/src/state/worktreeActions.test.ts`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-09-30 (phase 7b), tree extended to every section and the ctrl-click toggle corrected 2026-10-01, the Changes section removed, tags made multi-selectable, and a plain click made the anchor 2026-10-01 at the owner's request, approved 2026-10-03 by the owner |
| S33 | approved | The Esc key in the workspace MUST be consumed (`preventDefault`) even when it closes nothing, unless a control inside already handled it, so the system never acts on it. Checking out a branch that another worktree has checked out MUST NOT be reported as a failed Git command: the state strip MUST show the core's message ("<branch> is checked out in worktree <path>") with the text-labelled action "Open worktree", which opens or focuses that worktree's tab and dismisses the notice; the notice MUST also go when the next switch starts. | `app/src/components/Workspace.test.tsx`, `app/src/state/repoActions.test.ts` · proposed 2026-09-30 (phase 7c), approved 2026-10-03 by the owner |
| S34 | approved | A provider that supports both MUST offer its sign-in as a two-option control ("API key", "Subscription") that names the consequence in text: with a key, YForge calls the provider API with the pasted key; with a subscription, ChatGPT signs in through YForge (browser or a headless code the user copies) and Claude uses the Claude Code sign-in read from the macOS Keychain, which YForge never copies or stores. The sign-in panel MUST show the address and, for the headless flow, the code as copyable text, MUST offer "Cancel sign-in" while it runs, and a signed-out subscription MUST state "Sign in to Claude Code first" for Claude. A provider has no model and is never "active": the provider dialog MUST NOT offer a model choice and the provider list MUST NOT mark a provider as active. Settings → AI MUST offer a per-feature card for each of Generate commit message, Propose with AI in Recompose, and Propose conflict resolution, each with a Switch "Use AI for <feature>" (the S16 pattern, its On or Off word beside it) that is disabled with the reason "Choose a provider and model to turn this on" until the feature has a saved provider and model, saving a feature's first configuration turning it On; a provider select; a model select that loads the chosen provider's models API by itself as soon as a provider is chosen (the trigger reads "Loading models…" while it loads; an empty list, an `ai_auth_required` failure, and any other failure are stated as text) beside an icon-only "Reload models" button (`sync` glyph, S15); a prompt editor whose `{context}` placeholder is stated in text and that MUST refuse to save without it; and "Reset to default", which restores the shipped prompt and turns the feature off. The card MUST have no Save button: the provider and model save as soon as both are chosen (the core still checks the model against the provider's list) and the prompt saves when the field loses focus, and the card states "Saved" or the failure in text after each save. A feature's AI action (Generate in the composer, Propose with AI in Recompose, Propose resolution in the conflict resolver) MUST NOT render at all unless its Switch is On, its saved provider still exists, and that provider's status is Ready; the core decides this as the feature's `available` flag, and a run of a feature that is not set up or is off is refused as `ai_not_configured` naming the feature. | `app/src/components/AiFeatures.test.tsx`, `app/src/state/aiFeatures.test.ts`, `app/src/components/AiSettings.test.tsx`, `app/src/components/ChangesInspector.test.tsx`, `app/src/components/RecomposeView.test.tsx`, `app/src/components/ConflictResolver.test.tsx`, `app/src/ipc/client.test.ts` · proposed 2026-10-01 (phase 7a-UI); provider model and active provider removed, the per-feature Switch, automatic model loading, and hidden unavailable actions added, and the Save button replaced by saving each change 2026-10-01 at the owner's request; approved 2026-10-01 by the owner |
| S35 | approved | Every choice in the app MUST be the owned `Select` (a `button` with `aria-haspopup="listbox"` and `aria-expanded`, the chosen label, and a chevron) and every multi-line field the owned `TextArea`; a native `select` or `option` MUST NEVER render (B3). The list is the `popover` surface, at least as wide as its trigger: `role="listbox"` with `role="option"` rows that carry the chosen mark and `aria-selected`, ↑ and ↓ move, Home and End jump, Enter or Space choose, and Escape closes and returns focus to the trigger; a disabled Select keeps its reason as the tooltip. The trigger's chevron MUST point down and MUST NEVER be rotated. An option shows its label and, when present, its hint as separate spans with a `spacing-2` gap, the hint in `ui-small` muted at the end of the row. A Select of more than 8 options MUST open with a search field at the top of its list, named "Search <label>" and focused when the list opens, that keeps only the options whose label, hint, or value contains its text (case-insensitive) as the user types; ↓ moves from the field to the first option, Enter in the field chooses the first remaining option, Escape closes, a list with nothing left states "No matches" in text, and a search never changes the chosen value. The Select trigger takes `cursors.action`, the search field and the TextArea `cursors.text` (S17). A TextArea grows with its content between its row limits, wraps its label and note in the same field grid as a one-line input so their edges line up, and shows its remaining count when one is set. | `app/src/components/Select.test.tsx`, `app/src/components/TextArea.test.tsx`, `app/src/styles/cursors.render.test.tsx` · proposed 2026-10-01 (owned controls), approved 2026-10-01 by the owner |
| S36 | approved | A drag with a pointer MUST show a ghost of what is being dragged beside the cursor and MUST dim its source, so the lift is visible before any drop target is reached; the whole window keeps the `dragging` cursor while it runs and the ghost MUST NEVER take pointer events. The commit graph MUST show a working-tree row only while the tree has changes; a clean tree shows no working-tree row, and the row's absence MUST NOT shift the refs or the lanes of the commits below. A commit node with a known author email MUST draw that author's Gravatar as a round avatar inside the node, the initials staying as the fallback while it loads and when pictures are off; the graph reads the email through `repo_graph`, which exposes it on `Author`. | `app/src/state/pointerDrag.test.ts`, `crates/yforge-core/tests/graph.rs`, `app/src/components/GraphPanel.test.tsx` · proposed 2026-10-01 (drag ghost, clean row, graph avatars), approved 2026-10-03 by the owner; the toast clause moved to S48 |
| S37 | approved | Repository tabs MAY be grouped by the user. A tab's context menu (right-click or ⇧F10) MUST offer "Add to new group…", "Add to group" with each existing group by name, and "Remove from group" for a grouped tab; a new group asks for a name (1 to 40 characters, required) and a color from the ten lane colors, each swatch a radio named by its color word (Cyan, Blue, Purple, Magenta, Pink, Red, Orange, Yellow, Green, Mint for lanes 0 to 9); group names may repeat. A group MUST render as a chip before its tabs: a native button with the group name in text on the lane's label fill with a 2px lane-color inline-start bar, `aria-expanded`, and, while collapsed, its tab count and the open repository's name in text, followed by its tabs inside one `role="group"` named "<name> tab group" (color never carries the group alone, B4). Clicking the chip collapses or expands the group; a collapsed group hides every member tab, including the open repository, and the window stays on that repository; activating a tab of a collapsed group, including with next or previous tab, expands it. The chip's menu MUST offer Move left and Move right (disabled with "This group is already first" or "This group is already last"), then Rename…, Color… (a popover with the ten swatches), Ungroup, and Close group, and while collapsed it also offers Alias <name>… for each hidden tab (S42), and Close group MUST confirm with a text-labelled danger button that names the tabs (S5, S15). A group's tabs stay contiguous: an added tab moves to the end of the group, a removed tab moves right after it, and a repository moves together with its worktree tabs (S28). A tab or a group chip can be dragged. Dropping one loose tab on another only reorders and does not create a group. Dropping a tab on a chip adds it to that group. Dropping a grouped tab outside its group removes it. Dragging a chip moves that group and its hidden members together. Dropping a group on a group does not nest it and says "Groups cannot nest." The tab menu offers Move left and Move right, disabled with "This tab is already first" or "This tab is already last." Groups, their names, colors, collapsed state, and members MUST be saved with the tab session in the app database and restored at launch; a group left without tabs is deleted. | `app/src/components/TabBar.test.tsx`, `app/src/state/tabs.test.ts`, `crates/yforge-core/tests/store.rs` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner; collapse hides every member, including the open repository, amended 2026-10-02 by the owner; drag reorder and Move left / Move right, amended 2026-10-02 by the owner |
| S38 | approved | When the working tree is clean and Amend is off, the Changes inspector MUST show a centered empty state (the 32px `changes` glyph, "Working tree clean" in `ui-strong`, and "Nothing to commit on <branch>" with the branch in mono) instead of the area lists, and MUST collapse the composer to one text button "Amend last commit" (disabled with its reason on an unborn branch or while an operation is in progress); choosing it shows the full composer with Amend on and the last message filled in, and the full composer returns by itself as soon as a file changes. | `app/src/components/ChangesInspector.test.tsx` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner |
| S39 | approved | Settings → Jira MUST connect Jira Cloud (site address, email, API token) and Jira Data Center (site address, personal access token); the token MUST be stored only in the macOS Keychain and never shown again, Test MUST report "Connected as <display name>" or the failure in text, and Remove MUST confirm with a text-labelled danger button (S5, S15). A Jira issue key (PROJECT-123, its project known to a connected site) in a branch name, a commit subject or message, or a pull request title MUST render as a chip with the neutral `issue` glyph and the key in mono; its tooltip and the commit inspector show the issue summary and status word, and an unknown or unreachable issue shows the key alone. While a Jira connection exists, the sidebar MUST show a "Jira issues" section listing the issues assigned to the user whose status is not in the Done category: each row shows the key in mono, the summary, and a status chip with a word (B4) toned by the status category (To Do neutral, In Progress `info`, Done `accent`), activating a row opens the issue inspector (summary, status and type chips, assignee and update time in text, Open in browser, stated as read-only), with Create branch from issue and Open in browser as icon controls named with the key (S7, S15) and in the row menu; Create branch opens the create-branch popover prefilled with `<KEY>-<summary slug>` (lower-case ASCII words joined by hyphens, at most 50 characters, editable). The section says "No open issues assigned to you" as text when empty. YForge MUST NEVER write to Jira. | `app/src/components/JiraSettings.test.tsx`, `app/src/components/Sidebar.test.tsx`, `app/src/state/jiraModel.test.ts`, `crates/yforge-platform/tests` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner |
| S40 | approved | Settings → Git hosts MUST list per-host identities, each with the host name (matched exactly, optionally with a port), an SSH private key file, and an HTTPS username; Generate key MUST create an ed25519 key pair at a file path the user can edit, prefilled with `~/.ssh/yforge_<host>` (port dropped) and refused when a file already exists there, with an optional passphrase that YForge saves in the macOS Keychain and says so in text; while it works it MUST name the file it is writing, and it then selects the key; an SSH passphrase prompt for a key whose passphrase YForge saved MUST be answered from the Keychain without asking; Copy public key MUST copy the `.pub` text and state "Copied". Clone, fetch, pull, push, and every remote operation MUST use the identity whose host matches the URL's host (`git@host:path`, `ssh://`, or `https://`), a repository's own SSH key overriding it and the app-wide key used when no host matches; the clone dialog MUST state in text which identity the typed URL will use, or that it uses the SSH agent and `~/.ssh/config`. An identity's HTTPS username MUST prefill the credentials prompt for that host; HTTPS passwords and tokens stay in Git's credential helper (the macOS Keychain on this Mac) and are never stored by YForge. | `app/src/components/GitHostsSettings.test.tsx`, `app/src/components/CloneDialog.test.tsx`, `crates/yforge-core/tests/git_hosts.rs` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner; key path and Keychain passphrase amended 2026-10-01 by the owner |
| S41 | approved | The Launchpad MUST be the landing screen: it MUST show in a window with no repository and for New tab (⌘T), replacing the launcher, and MUST also open from the tab bar with the `launchpad` glyph; its header MUST offer Open… (⌘O), Clone…, and Create…, and a folder dropped on it MUST open as a repository. It shows the tabs Repositories (every repository YForge knows: the ones the user opened and the ones found in scanned folders, S46), My pull requests (open pull requests authored by or assigned for review to the user across every platform connection), My issues (S39), and WIPs (listed repositories with uncommitted changes or unpushed commits), each with its count in text; Repositories MUST be a table with the column headers Repository, Branch, Status, and Last opened, a group row per scanned folder and one for repositories known only because the user opened them, and each row's status in text (changes, commits to push and to pull, Clean, "Not found" for a path that no longer exists, "Status unavailable" with the reason); the scanned folders MUST sit above the table as chips with Rescan and Stop scanning icon controls (S15) and an "Add folder…" button; the selected row's actions (Open, or Switch to its tab when it is open; Reveal in Finder; Open in Terminal; Remove from list) MUST sit in a bar under the table that names the row, Open MUST be absent for a repository that is not found, and Remove from list MUST offer Undo and state that nothing on disk changes; a search field filters the rows of the current tab by title, key, number, or repository, and a source filter narrows by connection. Rows MUST open the repository tab, the pull request in its inspector (in the browser when no local clone of its repository is known), or the issue in the browser; a tab with no source connected MUST say so in text and offer Connect for each missing service; loading, failure, and empty states MUST be stated in text per source, and each source MUST state its own update time ("<source> · updated <age> ago"), never one combined time. The Launchpad MUST NEVER write to a platform, to Jira, or inside a repository. | `app/src/components/Launchpad.test.tsx`, `app/src/state/launchpadModel.test.ts` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner; the Repositories table approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-table-command/`); the landing screen approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-two-pane-ai/`) |
| S42 | approved | A repository tab's context menu (right-click or ⇧F10) MUST offer, in this order: Close tab (⌘W), Close other tabs, Close tabs to the right, then Move left and Move right (S37), then the group items (S37), then Alias tab… (Remove alias when one is set), then Reopen closed tab (⇧⌘T); an item that cannot act MUST stay visible, `aria-disabled`, with its reason as the tooltip ("No other tabs", "No tabs to the right", "This tab is already first", "This tab is already last", "No closed tabs"). Closing several tabs MUST confirm only when one of them has an operation in progress, naming those tabs. An alias (1 to 40 characters, set in a popover prefilled with the current name) MUST replace the folder name on the tab, in Recent, and in the palette, with the folder name in the tab's tooltip and accessible description, and MUST be saved per repository in the app database. Double-clicking the tab opens that popover, and a collapsed group's chip menu lists Alias <name>… for each hidden tab and opens the same popover. Reopen closed tab MUST reopen the most recently closed tab of this session, up to the last 20, into its former group when that group still exists. | `app/src/components/TabBar.test.tsx`, `app/src/state/tabs.test.ts`, `app/src/state/app.test.tsx` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner; alias named Alias tab and opened by double-click or a collapsed chip, amended 2026-10-02 by the owner; Move left and Move right added, amended 2026-10-02 by the owner |
| S43 | approved | YForge MUST install its own macOS menu bar (a recorded platform exception: the menu bar is drawn by macOS): YForge (About YForge, View Release Notes, Check for Update…, Settings… ⌘,, Services, Hide YForge ⌘H, Hide Others ⌥⌘H, Show All, Quit YForge ⌘Q), File (New Tab ⌘T, Open Repository… ⌘O, Clone Repository…, Create Repository…, Launchpad, Close Tab ⌘W, Reopen Closed Tab ⇧⌘T), Edit (Undo ⌘Z, Redo ⇧⌘Z, Cut, Copy, Paste, Select All, Find ⌘F, Command Palette ⌘K), View (Theme, Density, Reveal HEAD ⇧⌘H, Zoom In ⌘=, Zoom Out ⌘−, Actual Size ⌘0, Toggle Sidebar ⌘\, Toggle Inspector ⌥⌘\, Enter Full Screen ⌃⌘F), Repository (Open Repository Search ⇧⌘O, Open in External Editor ⇧⌘E, Fetch ⇧⌘F, Pull ⇧⌘L, Push ⇧⌘P, Create Branch ⌘B, Stash ⇧⌘S, Undo Last Action, Redo Last Action), Window (Minimize ⌘M, Zoom, Show Next Tab ⌃⇥, Show Previous Tab ⌃⇧⇥, Bring All to Front), and Help (YForge Help, Keyboard Shortcuts, Report an Issue). Every shortcut MUST come from the same registry as the palette; an item that cannot act MUST be disabled. ⌘Z undoes typing inside a text field and otherwise runs YForge's Undo, and ⇧⌘Z likewise redoes typing or runs YForge's Redo (S61); Help → Keyboard Shortcuts opens the shortcuts sheet (S61). View Release Notes and Report an Issue open the project's GitHub pages. Check for Update MUST state in a dialog, in text, that it is checking, that YForge is up to date (with the version), that a version is available (with its version and release notes, Install and Relaunch, and Later), or why the check failed; an update MUST be verified against YForge's signing key before it installs, and nothing downloads until the user chooses Install and Relaunch. | `app/src-tauri/tests`, `app/src/components/UpdateDialog.test.tsx`, `app/src/state/shortcuts.test.ts` · proposed 2026-10-01 at the owner's request, approved 2026-10-01 by the owner |
| S44 | approved | Lists read from GitHub, GitLab, Bitbucket, and Jira (pull requests, pull request files, the Launchpad tabs, Jira issues and projects) MUST follow pagination to the complete result, up to a safety cap of 1,000 items per list; every count MUST be the true total, and a capped list MUST say so in text ("Showing 1,000 of <total>", or "Showing the first 1,000" when the service gives no total). | `crates/yforge-platform/tests/adapters.rs`, `crates/yforge-platform/tests/jira.rs`, `app/src/components/PullRequestInspector.test.tsx`, `app/src/components/Launchpad.test.tsx` · proposed and approved 2026-10-01 by the owner |
| S45 | approved | The tab bar MUST keep its trailing controls (Launchpad, Activity, Theme, Settings, and New tab) visible at every window width: repository tabs MUST shrink to a minimum width that keeps the leading glyph and a truncated name with the full name in the tooltip, and past that the tab list MUST scroll horizontally, keeping the active tab in view after it changes. | `app/src/components/TabBar.test.tsx`, `app/src/styles/tabBar.render.test.tsx` · proposed and approved 2026-10-01 under the owner's delegation of design decisions; the minimum width is `controls.tab-min` |
| S46 | approved | Scanned folders MUST be added from the Launchpad and from Settings → Repositories with "Add folder…", a dialog that takes a folder (the macOS folder picker through "Choose…", or a typed absolute path) and a depth of 1 to 5 levels (default 2), and Scan; it MUST then list every repository found with its path and branch, each new one ticked and each already listed one marked "Already listed", and add only the ticked ones; the unticked ones, and any repository the user later removes from the list, MUST be skipped by later rescans. Scanning MUST only read the disk: it MUST skip hidden folders, `node_modules`, symbolic links, and folders inside a repository, and MUST stop at 20,000 folders and say so. Failures MUST be stated in text and change nothing: no folder at the path, a folder that is already scanned ("Rescan it instead"), a depth outside 1 to 5, and no repository found (with the number of folders checked and an offer to look one level deeper). Rescan MUST add only repositories that are neither listed for that folder nor skipped, and state how many it added; Stop scanning MUST take the folder and the repositories found only there off the list, keep the ones the user opened, and offer Undo. Each folder MUST state its repository count, depth, and when it was last scanned. | `crates/yforge-core/tests/repositories.rs`, `app/src/components/ScanFolderDialog.test.tsx`, `app/src/components/Launchpad.test.tsx` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-table-command/`) |
| S47 | approved | Settings MUST open with a search field above a row of section tabs (`role="tablist"`, each with its glyph and name); while the field holds text, the tabs MUST show their number of matching settings and the body MUST list every matching setting across all sections, each with its title, its note, and its section and group as a breadcrumb ("Git › Defaults"); choosing a result MUST open its section and move focus to that setting; Esc in the field MUST clear it; a search with no match MUST say so in text and suggest terms. The scope tabs (All repositories, This repository) stay under the section tabs. | `app/src/components/SettingsView.test.tsx`, `app/src/state/settingsSearch.test.ts` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-table-command/`) |
| S48 | approved | A toast MUST enter at the top right below the tab bar, stacked newest first, with at most three visible and the rest queued behind a "<n> more" chip; it MUST NEVER cover the state strip or the composer. Each toast is a pill on `surface-raised` with its status glyph and a status word for screen readers (B4), the title, an optional body and list of items, at most one text action (Undo, Retry, Show), a close button, and a countdown ring that empties over its 3-second lifetime (S11 `toast-countdown`); a failure toast MUST join the same top-right stack with the same lifetime and MUST state the failed operation and cause in one concise sentence on one or two lines, NEVER raw commands, pathspecs, exit status, hints, or multiline stderr. One shared formatter MUST select the first meaningful fatal/error cause or plain known-kind wording; absent a usable cause it MUST state the operation failed and "See Activity for details". Full error messages and output MUST remain unchanged in Activity. Hover or focus inside MUST hold it, Esc MUST dismiss the newest, and it MUST announce through `role="status"` (`role="alert"` for a failure). | `app/src/components/Toasts.test.tsx`, `app/src/components/Workspace.test.tsx` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-merge-tool/`, Flow); lifetime cut from 5 to 3 seconds and failures placed in the stack with the same lifetime, approved 2026-10-09 by the owner; amended 2026-10-10 by the owner: failure toasts state the operation and cause concisely; raw Git output stays in Activity |
| S49 | approved | Every file list (Unstaged, Staged, and a commit's or stash's files) MUST offer a Path / Tree switch (a segmented icon control, S15), remembered for the app. Tree groups files by folder with 1px `text-muted` indent guides, a chevron rotated by transform when collapsed, and the file count in text, as `role="tree"` with `aria-level` and `aria-expanded`; Enter, → and ← toggle a folder; Collapse all and Expand all are icon controls; a folder row in Unstaged or Staged offers Stage folder or Unstage folder (icon control and Space), and its context menu (right-click, ⇧F10, or its More icon control) MUST offer Stage folder or Unstage folder, Stash folder (stashes only that folder's changes, untracked files included, into one stash named "Stash <folder>"), and Discard all changes in folder (a confirmation dialog naming the folder and its file count, with a text-labelled danger button, S5), never the platform menu (B3). A commit's files MUST offer View all files, which also lists the files the commit did not change, marked as unchanged. | `app/src/components/ChangesInspector.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/state/fileTree.test.ts` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-two-pane-ai/`); folder context menu added 2026-10-03 by the owner (GitKraken folder actions) |
| S50 | approved | The Changes inspector MUST be icon-driven and fixed in size: its header reads "Changes <count>" with icon controls for Path / Tree, Collapse or Expand all, and Explain changes (S53); Unstaged and Staged headers carry their counts and Stage all or Unstage all icon controls; every file and folder row shows its Stage or Unstage icon at rest, quiet until hover or the keyboard cursor (S7). The composer MUST offer Commit and Stash tabs; its summary is one line that never wraps, with the characters left and Generate (S24) inside the field; after an AI draft the field shows a wand mark and a Restore icon named "Restore my text" instead of a banner; the description is a fixed-height field that scrolls; Amend is a toggle chip; a disabled Commit button MUST state why in its label ("Write a summary to commit", "Stage files to commit"). Neither the lists nor the composer may change height while typing. S38's clean state still applies. | `app/src/components/ChangesInspector.test.tsx` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-flow-minimal/`) |
| S51 | approved | The conflict resolver MUST show Yours (the current side) and Theirs (the incoming side) side by side, each pane titled with its branch and role, every conflict carrying a checkbox in each pane; each pane header MUST hold a tri-state Select all for its side, the position "Conflict <k> of <n>", and previous and next conflict controls (P and N) that move both panes and the Output together. Below them an editable Output (the owned TextArea in the `code` role with line numbers) MUST hold exactly what will be saved, with every unresolved conflict shown as Git's `<<<<<<<`, `=======`, and `>>>>>>>` markers; Mark resolved MUST stay disabled with its reason until no markers remain; picking a side after editing the Output by hand MUST rebuild it from the choices and offer Undo. While a merge is being resolved, a merge bar MUST state "<k> of <n> files resolved" with Commit merge (disabled with its reason until every file is resolved) and Abort merge. Propose resolution (S24) fills the Output with "Restore my text". | `app/src/components/ConflictResolver.test.tsx`, `app/src/state/resolverModel.test.ts` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-forge-contrast/`, Merge Tool) |
| S52 | approved | File history MUST open from History and Blame on every diff and from History on a commit's file row, as a center view listing every commit that changed the file (following renames) with SHA in mono, summary, author, and age, and a view switch File / Diff / Blame. Diff MUST offer previous and next hunk, Hunk / Inline / Split, and Ignore whitespace, and Revert hunk, which puts the reverse change in Unstaged and is refused with its reason when the hunk no longer applies to the working tree. Blame MUST show a gutter per run of lines from one commit with its SHA, author, and age; choosing an entry selects that commit in the list. Esc closes the view. Everything here only reads, except Revert hunk, which changes only the working tree. | `app/src/components/FileHistory.test.tsx`, `crates/yforge-core/tests/file_history.rs` · approved 2026-10-03 by the owner (proposal `docs/design/proposals/2026-10-forge-contrast/`, Merge Tool) |
| S53 | approved | Besides the commit message, conflict proposal, and recompose drafts (S24), the app MUST offer these AI features, each an icon-only `wand` control that follows S24 and has its own Settings → AI feature card: Explain changes (the working tree) and Explain commit (the selected commit), which show a read-only explanation per file in a floating sheet over the graph beside the inspector that never resizes a panel and closes with Esc or ×; Compose commits, which proposes the working changes as groups of commits with editable messages and include checkboxes, leaves unchecked groups uncommitted, and creates the commits only through "Create <n> commits" with Undo; and Generate stash message, which fills the stash message in the composer's Stash tab with "Restore my text". | `app/src/components/AiSheet.test.tsx`, `app/src/components/ChangesInspector.test.tsx`, `crates/yforge-ai/tests`, `crates/yforge-core/tests/ai_context.rs` · approved 2026-10-03 by the owner (proposals `docs/design/proposals/2026-10-two-pane-ai/` and `2026-10-right-panel-ai/`, Flow Sheet) |
| S54 | approved | Settings MUST offer an External tools section with three owned Selects (B3, never a native `select`): External merge tool (None, Git config default, then each merge tool found on this Mac: FileMerge, Kaleidoscope, Beyond Compare, P4Merge, Sublime Merge, Visual Studio Code), External diff tool (Use merge tool, None, Git config default, then the same found tools), and External editor (None, Custom, then each editor found on this Mac: Visual Studio Code, Cursor, Zed, Sublime Text, Xcode, IntelliJ IDEA, Nova, BBEdit, TextMate); Git config default MUST be `aria-disabled` with the reason "No merge.tool in your Git config" (or diff.tool) when Git has none, Custom MUST show a command field that receives the path as its last argument, and the External terminal command moves into this section. ⇧⌘E and the palette's Open in external editor MUST open the repository in the chosen editor; every file row and diff MUST offer Open in editor (the file), every diff Open in external diff tool, and every conflicted file Open in external merge tool, which refreshes the conflict state when the tool exits and never marks the file resolved by itself. With None chosen, the control MUST stay visible, `aria-disabled`, with the reason "Choose an external editor in Settings → External tools" (or diff or merge tool); a launch that fails MUST be shown with its cause. | `app/src/components/SettingsView.test.tsx`, `app/src/components/DiffView.test.tsx`, `crates/yforge-core/tests/external_tools.rs` · approved 2026-10-03 at the owner's request (GitKraken External Tools) |
| S55 | approved | ⇧⌘O MUST open the palette scoped to repositories: an "Open repo" chip at the start of the input with a × control (Backspace in the empty input also removes it and returns to every command), the placeholder "Search for a repository to open", and one row per repository YForge knows (open tabs, recents, and scanned folders) showing its full path and its alias when one is set, filtered by the typed text; Enter opens the repository or activates its open tab, and Escape closes the palette. | `app/src/components/CommandPalette.test.tsx`, `app/src/state/palette.test.ts` · approved 2026-10-03 at the owner's request (GitKraken Open Repo) |
| S56 | approved | The sidebar MUST show a Hooks section listing every file in the repository's effective hooks directory (`core.hooksPath` when set, otherwise the common `.git/hooks`), named by hook, sample files excluded; a hook is Active when it is executable and named like a Git hook, otherwise Inactive with its reason ("Not executable: Git skips this hook", "Not a Git hook name"), and the section header states the directory. Each hook row MUST offer View, Run, and Test as icon controls and in its owned context menu. View opens a read-only sheet with the script in mono, its path, and its state. Run executes the hook in the worktree with the arguments and input Git would give it (commit-msg and prepare-commit-msg a temporary message file holding the composer's message, pre-push the upstream remote's name and URL, post-checkout `HEAD HEAD 1`, others none), Test does the same in a temporary detached worktree carrying the staged and unstaged changes and removes it afterwards, stating that nothing in the repository changed; both stream stdout and stderr into the sheet, end with the exit code and whether Git would stop the action, stop after 120 seconds or on Stop, and MUST ask for confirmation naming the script path before the first run of each hook in each repository and again after the script changes. An Inactive hook's Run and Test MUST be `aria-disabled` with its reason. | `app/src/components/HooksSection.test.tsx`, `crates/yforge-core/tests/hooks.rs` · approved 2026-10-03 at the owner's request |
| S57 | approved | Settings → This repository MUST offer Git Flow: Initialize Git Flow with the production branch (default `main`), development branch (default `develop`), the feature/, release/, hotfix/ prefixes, and the version tag prefix, saved as `gitflow.*` in the repository's Git config the way git-flow does. Once initialized, the sidebar MUST show a Git Flow section with Start feature…, Start release…, and Start hotfix… (a name dialog creating the branch from development, or from production for a hotfix, and checking it out) and, on a flow branch, Finish: a feature merges into development and is deleted; a release or hotfix merges into production, is tagged with the prefix plus its name, merges back into development, and is deleted. Every Start and Finish MUST be recorded with Undo, and a Finish that conflicts MUST stop in the operation state with nothing deleted. | `app/src/components/GitFlow.test.tsx`, `crates/yforge-core/tests/git_flow.rs` · approved 2026-10-03 at the owner's request |
| S58 | approved | Settings → This repository MUST offer Git LFS: whether `git-lfs` is installed (with its version, or "Git LFS is not installed" and no LFS actions), whether this repository is initialized for LFS, Initialize LFS (installs the LFS hooks into this repository only), and the tracked patterns read from `.gitattributes` with Track pattern… and Untrack, each change written to `.gitattributes` and left unstaged for the user to commit. | `app/src/components/LfsSettings.test.tsx`, `crates/yforge-core/tests/lfs.rs` · approved 2026-10-03 at the owner's request |
| S59 | approved | Settings → Git MUST offer Commit signing, applied to the global Git config or to this repository (an owned Select): Sign commits (`commit.gpgSign`), Sign tags (`tag.gpgSign`), Format (OpenPGP, SSH, or X.509, `gpg.format`), Signing key (an owned Select of the secret OpenPGP keys `gpg` lists or the SSH public keys in `~/.ssh`, by key ID or file and identity, plus Custom), and Program (`gpg.program`, empty for the default). Commits and tags YForge makes MUST be signed when signing is on, and a signing failure MUST be shown with Git's message and leave nothing committed. | `app/src/components/SettingsView.test.tsx`, `crates/yforge-core/tests/signing.rs` · approved 2026-10-03 at the owner's request |
| S60 | approved | Settings MUST offer Profiles: Default always exists; each profile has a name, an author name, and an author email, and can be added, renamed, and deleted (never the active profile or the last one). Switching profile (the palette's Switch to profile, or Settings) MUST save the current profile's open tabs, open the new profile's tabs (the Launchpad when it has none), and make every commit, merge commit, and tag YForge creates use the profile's author while it is active, without changing the Git config; the composer MUST state "Committing as <name> <email>" and the active profile's name MUST show in the tab bar's Launchpad tooltip. | `app/src/components/ProfilesSettings.test.tsx`, `crates/yforge-core/tests/profiles.rs` · approved 2026-10-03 at the owner's request |
| S61 | approved | The palette MUST offer every GitKraken command-palette action, each disabled with its reason when it cannot act: Repo (Close tab, Open repo ⇧⌘O, Reveal in Finder, Open in external editor ⇧⌘E, Open in external diff or merge tool…, Open in terminal, Clone, Create, Open, Perform repository maintenance, which runs `git maintenance run --task=gc --task=commit-graph --task=loose-objects --task=incremental-repack` with progress in the Activity drawer); Settings (Configure Git Flow, Configure LFS, Initialize LFS, Configure commit signing, Join the light side, Join the dark side, Manage accounts (Settings → Platforms), Settings, Switch to profile…); View (Zoom in ⌘=, Zoom out ⌘−, Reset zoom ⌘0, stepping 80, 90, 100, 110, 125, 140, 150, 175, 200 percent and remembered for the app; Keyboard shortcuts; Toggle sidebar ⌘\; Toggle inspector ⌥⌘\; Toggle syntax highlighting, remembered for the app; Toggle theme); History (History of file…, Blame of file…, both picking any tracked file; Search commits); Core (Undo, Redo); File (Create file…, Delete file…, Open file in editor…, View file…, Edit file…, Discard all changes, Stage all changes, Unstage all changes); Stash (Stash, Apply, Pop); Branch (Create branch, Create tag, Create annotated tag, Fetch all, Pull, Push, Rename branch, Start pull request, View working directory changes); Checkout…; Patch (Create patch from working directory changes, saved where the user chooses; Apply patch…, applied with a three-way fallback, recorded with Undo, refused with Git's message and nothing changed); and Logs (Activity log, Error log, Performance log, Release notes). Redo MUST re-apply the operation the last Undo reverted, from the palette, ⇧⌘Z outside text fields, and a Redo control beside Undo in the command bar, `aria-disabled` with "Nothing to redo" otherwise. Keyboard shortcuts (palette and Help → Keyboard Shortcuts) MUST open a sheet listing every shortcut from the registry by group. Edit file… opens the file in the center in an owned TextArea with Save (⌘S) and Close, refusing binary files and files over 1 MiB with that reason; Create file… refuses an existing path; Delete file… and Discard all changes MUST confirm with a text-labelled danger button and be recorded with Undo. Error log lists the recorded crashes and failed operations with time, kind, and message; Performance log lists the recorded operations with their durations and states when usage recording is off. | `app/src/state/palette.test.ts`, `app/src/components/CommandPalette.test.tsx`, `app/src/state/shortcuts.test.ts`, `crates/yforge-core/tests` · approved 2026-10-03 at the owner's request (GitKraken command palette parity) |
| S62 | approved | Every Unstaged, Untracked, and Staged file list MUST support multi-select (`aria-multiselectable`, each row `aria-selected`): click selects one file, ⌘-click toggles a file, ⇧-click and ⇧↑/⇧↓ extend the range, and ⌘A selects the whole list; a selection never spans two lists, and Escape clears it. With two or more files selected, the list header's action MUST read "Stage <n> files" (or "Unstage <n> files") as a text-labelled button, and a selected row's context menu (right-click, ⇧F10, or its More icon control) MUST act on the whole selection, in this order: Stage <n> files or Unstage <n> files, Discard <n> files (a confirmation naming the count and the files, with a text-labelled danger button; a staged file loses its staged and unstaged changes, and the discard is recorded with Undo), Ignore <n> files (appends each path to the repository's `.gitignore`, left unstaged, and untracks a tracked file only after confirmation), Stash <n> files (one stash named "Stash <n> files"), then a separator and Create patch from changes in <n> files (saved where the user chooses). One selected file keeps the single-file menu with the same items worded for that file. | `app/src/components/ChangesInspector.test.tsx`, `app/src/state/changes.test.ts`, `crates/yforge-core/tests/stage.rs` · approved 2026-10-03 at the owner's request (GitKraken multi-select) |

| S63 | approved | Theme selection MUST use the owned Select with System, YForge Dark, YForge Light, Classic Dark, Ocean, Eighties, Gruvbox, Nord, Dracula, Monokai, and Woodland; System follows macOS light/dark, YForge Dark remains the default named dark palette, and every named palette MUST supply its own opaque semantic color tokens with S10 contrast. The View menu and command palette MUST offer the same named choices. | `app/src/components/SettingsView.test.tsx`, `app/src/styles/tokens.test.ts`, `app/src/styles/contrast.test.ts`, `app/src/state/settingsModel.test.ts` · approved 2026-10-04 by the owner |
| S64 | approved | Each graph row MUST show an opaque lane-tinted band across its graph column, fading horizontally from lane color into canvas at the message edge (into selection fill when selected). The graph column MUST default to 56px and expand when active lanes need more room; default-density lane 0 MUST start 4px after the ref/graph divider, with its node ring clear of the divider; compact lanes retain their 10px gutter. The first nonblank commit-body line stays inline after the summary in muted graph text; 28px row height and S6 selection state stay unchanged. The ⌘F search surface MUST anchor at the graph's top right without hiding its header. | `app/src/graph/columns.test.ts`, `app/src/graph/laneArt.test.ts`, `app/src/styles/tokens.test.ts`, `app/src/components/GraphPanel.test.tsx` · 56px default approved 2026-10-05 by the owner |
| S65 | approved | Strata MUST use 15px `ui-body` for UI prose and Markdown, 18px/600/1.4 `title`, and retain 14px/22/600 `ui-strong` for the commit summary in normal `text` ink. Supporting chrome MUST be at least 12px; ref names stay 13px and tabs 14px. Desktop panels MUST use 260px sidebar and 380px inspector, with 220px/340px at 1280–1439 and existing compact rail/drawer behavior. Sidebar rows and virtual estimates MUST be 32px; section headers 36px with 12px section gaps and minimum 24×20px field-backed count pills; children indent 12px per level with 4px clearance from straight text-muted guides. Unselected rows MUST omit repeated metadata when the section already states it. The state strip MUST be 44px with 32px, 13px worded intrinsic-width chips and horizontal scrolling when needed; actions and outcomes MUST NOT be hidden. Panel section headers MUST be 40px with 16px inline insets and 13px/600 labels; inspector reading insets MUST be 16px, metadata 13px with 28px detail rows, and author badges outside the graph 24px. Launchpad MUST be top-aligned with 20px top inset, 42px minimum repository rows, 32px action buttons, and 14px table text; rows MAY grow for real multiline content rather than clip it. At minimum width the command field MUST retain 210px and the breadcrumb one line bounded to 120px. Retain all opaque role colors, 8px panel gaps, 10px panel radii, existing theme control/state, and overlay/modal elevation; panel shadows MUST be none. Every graph color, typography role, row, lane geometry, 56px default expanding column, and 130px ref column MUST remain unchanged. | `app/src/styles/tokens.test.ts`, `app/src/styles/surfaces.render.test.tsx`, `app/src/components/StateStrip.test.tsx`, `app/src/components/Sidebar.test.tsx`, `scripts/verify-repository-render.mjs` · Strata full scale approved 2026-10-11 by the owner; commit summary 14px and graph preservation retained |
| S66 | approved | Every user-triggered asynchronous action MUST show visible progress while it waits, announce its state in text, prevent conflicting edits and repeat submissions, and restore input on success, failure, or cancellation; a cancellable action MUST keep Cancel enabled. Loading motion MUST follow B7 and stop under reduced motion. | `app/src/components/Composer.test.tsx`, `app/src/components/MessageForm.test.tsx`, `app/src/styles/surfaces.render.test.tsx` · approved 2026-10-04 by the owner |
| S67 | approved | File and diff views MUST preview supported images and Markdown. Markdown previews and commit message bodies MUST use one shared sanitized GitHub-flavored Markdown renderer (`app/src/state/markdown.ts`): YAML front matter in a collapsed "Front matter" block with YAML highlighting; tables; task lists as read-only checkboxes; strikethrough; autolinks; h1–h6 headings with anchors so in-page # links scroll within the preview; fenced code highlighted by the app syntax highlighter; GitHub alerts titled Note, Tip, Important, Warning, or Caution (B4); footnotes; and quotes, rules, nested lists, and inline code styled from tokens. A relative repository-file link MUST open that file at the same revision in the file view; external links MUST stay non-navigable text with their URL as tooltip; raw HTML MUST be sanitized. The commit inspector summary MUST use `ui-strong` in `text` ink, NEVER `title`; its Markdown body MUST use `text` ink at `ui-body` with paragraph spacing and a 1px `rule` separating the message from the actions, retaining S17's text cursor. HTML preview MUST resolve relative styles, scripts, images, and linked assets within the selected repository revision, run local scripts only in an opaque-origin sandbox without YForge IPC or external network access, and refuse path traversal, symlink escape, unsupported schemes, and oversized resources. Text, binary, missing, and error states MUST remain explicit. | `app/src/components/FileView.test.tsx`, `app/src/components/DiffView.test.tsx`, `app/src/state/markdown.test.ts`, `crates/yforge-core/tests/file_view.rs`, `app/src-tauri/tests` · approved 2026-10-04 by the owner; amended 2026-10-10 by the owner: shared sanitized GFM previews and commit inspector message typography |
| S68 | approved | Edit file MUST use an owned LSP-capable editor with optional Vim normal, insert, and visual modes; connect only to configured installed language servers, show diagnostics, completion, hover, definition, and references, preserve Save, undo, EOL, dirty confirmation, and keyboard access, and keep editor content inside its repository. LSP server start and failure MUST be explicit and cancellable, never automatic code execution from file content. | `app/src/components/FileEditor.test.tsx`, `app/src/state/editor.test.ts`, `crates/yforge-core/tests` · approved 2026-10-04 by the owner |
| S69 | approved | Blame MUST highlight the code lines attributed to the selected commit, pair the fill with its selected commit label, update the highlight when selection changes, and leave other lines readable in every theme. | `app/src/components/FileHistory.test.tsx`, `app/src/styles/history.render.test.tsx` · approved 2026-10-04 by the owner |
| S70 | approved | Editing or amending HEAD MUST offer Generate message from the resulting commit (HEAD changes plus staged changes) when the AI feature is ready, as a cancellable draft that preserves and restores the user's prior summary and description and never writes Git until Save or Commit. While generation runs, both fields and Save MUST be locked and visibly busy. | `app/src/components/MessageForm.test.tsx`, `app/src/components/ChangesInspector.test.tsx`, `crates/yforge-core/tests/ai_context.rs` · approved 2026-10-04 by the owner |
| S71 | approved | Activating a remote branch by double-click, or the corresponding reference activation key, MUST open the owned Reset mode menu when its matching local branch is already checked out. Reset MUST retain its explicit confirmation and hard-reset safety snapshot; activation MUST NEVER silently rewrite Git. Other reference activations and the explicit Checkout command retain their checkout behavior. | `app/src/routes.test.tsx`, `app/src/state/repoActions.test.ts`, `app/src/components/Sidebar.test.tsx`, `app/src/components/GraphPanel.test.tsx` · approved 2026-10-07 by the owner: Reset local main; Double-click remote main |
| S72 | approved | A view whose content is being replaced by an asynchronous read (a repository tab switch, a commit selection, opening a diff, the next or previous file, a refresh) MUST keep showing its previous content, undimmed, until the replacement is ready. A pending indicator (a 2px progress line, or the static text "In progress…" under reduced motion) MUST appear only after 150ms and, once shown, MUST stay at least 400ms. A region with no previous content MUST show static skeletons in its final row and column geometry after the same 150ms, never a shimmer (B8). The replacement MUST arrive through `view-swap`. A read superseded by newer navigation MUST be cancelled and its result MUST NEVER render, so rapid switching ends on the last choice. A region MUST NEVER render blank during navigation, loading, an operation, or recovery. | `app/src/state/pending.test.ts`, `app/src/components/PendingLine.test.tsx`, `app/src/state/viewSwap.test.tsx`, `app/src/components/CommitInspector.test.tsx`, `app/src/components/DiffView.test.tsx`, `app/src/components/GraphPanel.test.tsx`, `app/src/graph/graphStore.test.ts`, `app/src/routes.test.tsx`, `scripts/verify-workspace-transitions.mjs` · approved 2026-10-08 by the owner (motion review `docs/design/proposals/2026-10-motion/`, Steady continuity) |
| S73 | approved | A running Git operation (fetch, pull, push, checkout, reset, commit) MUST show an operation pill in the state strip that names the operation and its current stage in text ("Fetching origin… Receiving objects"), with a determinate bar while the stage reports progress, and a text-labelled Cancel while it can still be cancelled. Successful Push and Force push MUST clear the pill without a result chip. Every other success result chip, including fetch, pull, publish, and push-to, MUST remain unchanged: the pill MUST become a result chip that states the outcome and, when there is a next step, offers it as a text-labelled action ("1 new commit on origin/main · Pull"); the chip MUST stay until the user acts on it or dismisses it, or the repository state changes. A failure MUST follow S66 and keep the last good content. | `app/src/state/syncModel.test.ts`, `app/src/state/repoActions.test.ts`, `app/src/state/composer.test.ts`, `app/src/components/StateStrip.test.tsx` · approved 2026-10-08 by the owner (motion review, Guided operation feedback); amended 2026-10-10 by the owner: no Push/Force push result chip; Push on a diverged branch opens the force-push-with-lease confirmation |
| S74 | approved | After a fetch, every commit on the upstream that the checked-out branch does not have MUST carry an "incoming" marker on its graph row: a registry glyph and the word "incoming", never color alone (B4), until it is pulled or its row is selected. | `crates/yforge-core/tests/sync.rs`, `app/src/state/repoActions.test.ts`, `app/src/components/GraphPanel.test.tsx`, `app/src/components/Workspace.test.tsx` · approved 2026-10-08 by the owner (motion review, Guided incoming markers) |
| S75 | approved | A graph ref label (S2) and a sidebar branch row, local or remote, MUST show the `pullrequest` glyph and a mono `#number` after the name while that branch is the head of an open or draft pull request on a connected platform; a draft MUST add the word "Draft". The badge MUST be a native button whose tooltip and accessible name state the number, title, state, `source → target`, and checks, and it MUST open the pull request inspector. Merged and closed pull requests MUST show no badge, and without a platform connection there MUST be no badge and no network call (B1). | `crates/yforge-platform/tests/service.rs`, `app/src/state/platformModel.test.ts`, `app/src/components/PullRequests.test.tsx` · approved 2026-10-08 by the owner (motion review, P1) |
| S76 | approved | YForge MUST predict merge conflicts locally and without the network, through an in-memory merge (`git merge-tree --write-tree --name-only` or an equivalent) that NEVER changes the repository, is cancellable, and is cached by tree ids. It MUST compare the checked-out branch with its upstream when they have diverged, each branch that heads an open pull request with that request's target, and the compose source with its target, and MUST run again after a fetch, commit, checkout, or refresh. A predicted conflict MUST mark the branch's ref label and sidebar row with the conflicted status (S3: the `!` glyph on `status-conflicted`, and the word "conflict" in its tooltip and accessible name). When the checked-out branch is affected, the state strip MUST show a conflict chip ("Conflicts with origin/main · 1 file") that opens a popover listing each file (each opens its diff), the merge base, "Rebase <branch> onto <target>…", which confirms before it runs, and "Compose pull request anyway". | `crates/yforge-core/tests/pull_request.rs`, `crates/yforge-core/tests/commit.rs`, `app/src/state/conflicts.test.ts`, `app/src/components/DiffView.test.tsx`, `app/src/components/Workspace.test.tsx`, `app/src/components/PullRequests.test.tsx` · approved 2026-10-08 by the owner (motion review, P2) |
| S77 | approved | Creating a pull request MUST happen in a compose center view of the workspace, in the content order of the former create dialog (S31). It shows the platform and repository line (S31), owned Selects for source and target (S35), the comparison summary (commits, files, +/− lines) with a read-only commit list, the conflict prediction for source → target (S76), the Title, an owned TextArea Description prefilled with the repository's pull request template, a Draft switch, the AI Generate action (S78), Cancel, and the primary "Create pull request". The primary action MUST be disabled with a visible reason while the title is empty or the comparison is still being read. When the source is not on the remote, creating MUST push it first and show the two steps "Pushing <branch> to <remote>…" and "Creating pull request…". The view MUST be reachable from the sidebar Pull requests header, the command palette, and the conflict popover. On success it MUST return to the graph, show the new badge (S75), and raise a toast "Created pull request #<n>" (S48) whose Show opens the pull request inspector with the web address. | `crates/yforge-core/tests/pull_request.rs`, `crates/yforge-core/tests/sync.rs`, `app/src/components/PullRequests.test.tsx`, `app/src/components/Toasts.test.tsx`, `app/src/state/palette.test.ts` · approved 2026-10-08 by the owner (motion review, P3) |
| S78 | approved | The compose view's Generate MUST be the AI feature for pull request descriptions, set up per feature in Settings → AI (S34), and MUST follow S24. A visible note under it MUST state what is sent and to whom ("Generate sends 2 commit messages and the diff of 3 files (+58 −5) to Work account"), and it MUST send only the commit messages, the diffstat, and bounded hunks of the compared range. While it runs, Title and Description MUST be locked and visibly busy, with Cancel (S70). The result MUST be an editable draft (a title of at most 72 characters and a description that fills the template's sections) with "Restore my text". A failure MUST state the cause and that nothing changed, and offer Generate again and "Open AI settings". It MUST NEVER run automatically, and nothing MUST reach Git or the platform until Create. | `crates/yforge-ai/tests/features.rs`, `crates/yforge-ai/tests/feature_config.rs`, `crates/yforge-core/tests/pull_request.rs`, `app/src/components/PullRequests.test.tsx` · approved 2026-10-08 by the owner (motion review, P4) |
| S79 | approved | A worktree is never locked to its branch: checking out a local branch that another worktree also has checked out, from any entry point (graph or sidebar activation, the branch picker, the ref menu, or the command palette), directly or through its remote branch, MUST check it out in the current worktree (Git `--ignore-other-worktrees`) without opening or focusing another tab, recording a failure, or raising a notice. While a worktree tab that has not been read yet loads, the active tab MUST keep showing its repository's worktree count. The command bar breadcrumb MUST name the place in which the user works: repository › branch in the main worktree, and repository › worktree glyph with the folder name › branch in a linked worktree, the folder's full path as the tooltip; it MUST NEVER show "main worktree" beside the branch. | `crates/yforge-core/tests/branches.rs`, `app/src/state/repoActions.test.ts`, `app/src/components/Workspace.test.tsx`, `app/src/routes.test.tsx`, `app/src/components/CommandBar.test.tsx` · approved 2026-10-09 by the owner (breadcrumb choice "Hide main, glyph linked"); amended 2026-10-10 by the owner (worktree not locked to a branch: choice "Check out anyway") |

## Colors

**Surfaces.** Dark is the base theme, and Light overrides it under `themes.light`. Every surface is opaque (S14).

| Role | Dark | Light | Use |
|---|---|---|---|
| backdrop | `#141619` | `#D7DBE2` | The darkest region: window, tab bar, command bar, state strip, activity bar |
| toolbar / toolbar-hover | `#2D3037` / `#3B3F48` | `#EDEFF3` / `#DFE3E9` | Toolbar-style controls on the bars |
| canvas | `#1A1C1F` | `#FFFFFF` | Graph, diff, center views |
| surface-1 | `#23252B` | `#F6F7F9` | Sidebar and inspector panels (lighter than the graph) |
| panel-head | `#2B2E35` | `#E8EBF0` | Panel and list headers |
| field | `#15171A` | `#FFFFFF` | Recessed inputs and text areas |
| surface-2 | `#2D3037` | `#EDEFF3` | Tabs, chips, buttons, command field, breadcrumb |
| surface-3 | `#3B3F48` | `#DFE3E9` | Active tab, control hover |
| surface-raised | `#343842` | `#FFFFFF` | Menus, palette, dialogs, tooltips, toasts (with elevation) |
| rule / rule-panel | `#3B3F47` | `#CAD0D8` | Hairlines, control outlines, panel borders |
| rule-strong | `#6E7685` | `#687180` | Input boundaries |

**Ink.** `contrast.test.ts` measures every text role on every reading surface above (S10).

| Role | Dark | Light | Use |
|---|---|---|---|
| text | `#F2F4F7` | `#12151A` | Primary text |
| text-muted | `#B3BAC6` | `#4A5260` | Secondary text, metadata, section labels |
| text-subtle | `#A9B1BD` | `#565E6C` | The graph column header |

**Semantic roles.**

| Role | Dark | Light | Meaning |
|---|---|---|---|
| accent / accent-ink | `#4EE29B` / `#5BE6A4` | `#0B8550` fill; `#0A7B47` ink | Affirmative actions, success, "in sync", current branch |
| attention / head-junction | ink `#F7D37C`; ring `#F0BE62` | ink `#8A5A00`; ring `#B87800` | HEAD in the state strip, pending work |
| danger | `#FF7B7B`; ink `#FF8585` | `#C53A3A`; ink `#9E2A2A` | Destructive, errors, deleted |
| info | `#82AAFF` | `#1C5FC4` | Links, informational banners |
| focus | `#4EE29B` | `#0B8B50` | Focus ring |
| selection / selection-edge | `#2A3B5D` / `#82AAFF` | `#E5ECFF` / `#2F5FC4` | Selected rows and their S6 bar |

Tints:

- accent-tint `#1D3A2E` / `#E0F4E9`;
- attention-tint `#3A3426` / `#FBF0DA`;
- danger-tint `#3E2429` / `#F9EBEB`;
- info-tint `#243352` / `#E2EBFA`.

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

**Git status colors.** Each rendered file status pairs with its named icon from the shared S3 mapping.

| Status | Icon | Dark | Light |
|---|---|---|---|
| Added | `plus` | `#4EE29B` | `#0A7B47` |
| Modified | `edit` | `#F7D37C` | `#946200` |
| Deleted | `minus` | `#EF6F6F` | `#C53A3A` |
| Renamed | `renamed` | `#79B8FF` | `#1C64C2` |
| Untracked | `untracked` | `#5CD2DC` | `#0A6D76` |
| Conflicted | `warning` | `#F28BC7` | `#AE2C73` |
| Copied | `copy` | text-muted | text-muted |
| Type changed | `type_changed` | text-muted | text-muted |

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

- **Ref label:** a solid fill of the lane mixed 18% into the canvas (the dark label tokens are recomputed for the `#1A1C1F` canvas), with a 3px lane-color inline-start edge and `graph-text`. The fill is opaque, so connector lines stop at the label edge.
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
| ui-body | Sans 15/23, 400 | Default UI, inputs, command field, Markdown body |
| ui-label | Sans 14/22, 500 | Buttons, tabs |
| ui-strong | Sans 14/22, 600 | Primary buttons, banner text, commit inspector summary |
| ui-small | Sans 13/17, 400 | Metadata, sidebar row meta |
| ui-caption | Sans 13/17, 500 | State strip chips |
| ui-section | Sans 13/17, 600 | Sidebar section and list headers (sentence case) |
| ui-micro | Sans 12/17, 500 | Counts in badges and keyboard hints |
| title | Sans 18/25.2, 600, −0.01em | Inspector titles except the commit summary, dialog titles |
| heading | Sans 21/27, 600 | Settings section titles |
| display | Brand display 24/30, 600 | Reserved for the About window; unused in the workspace |
| code | Mono 13/20, 400 | Diffs, commands, output, file paths |
| ref | Mono 13/17, 500 | Branch, tag, and remote names outside the graph; SHAs |
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
  - state strip 44px with 32px intrinsic-width chips and local horizontal scrolling;
  - three panels with an 8px gap and an 8px outer inset: sidebar 260px, graph (fills the remaining width), inspector 380px, each `rounded.lg` with a 1px `rule-panel` border and no panel shadow;
  - activity bar 30px.
- **Bars:** on the `backdrop`; every bar item is a control, chip, or button on `surface-2` or `toolbar` (S14).
- **Tab bar:** pill tabs 28px tall; a repository tab carries no mark and is named by its repository alone, with a worktree count on the active one; a linked worktree leads with the worktree glyph; the tabs of one repository's worktrees sit together in a bordered group (S28).
- **Command bar:** breadcrumb (repository › branch in `accent-ink` in the main worktree; repository › worktree glyph and folder name › branch in a linked worktree, the folder's full path as its tooltip, S79), a centered command field (search commits, branches, files, or run a command; ⌘K) up to 440px, then Sync (primary), Branch, Stash, and Undo.
- **Graph columns** (GitKraken defaults; widths are resizable and saved per repository):
  - Branch / Tag 130 (32–300);
  - Graph 56 (min 56, grows for active lanes): a 4px gutter, then lanes every 22px;
  - Commit message fills the remaining width (min 50);
  - optional and hidden by default: Author 130 (initials at 32), Date / Time 130, SHA 100.
- **Graph header:** 30px, with the labels "BRANCH / TAG", "GRAPH", and "COMMIT MESSAGE", the labels of the shown optional columns, and a column-settings button (a `controls.hit-min` square) at the end. Each resizable column has a `controls.divider-hit` separator at its inner edge; the message column and the settings square sit at the row end, so rows reserve the settings square. The optional columns are hidden below 1024px without forgetting the choice.
- **Alignment:**
  - Panel section headers are 40px with 16px inline insets; inspector reading and list insets are 16px.
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

- **Strategy:** solid panels on the backdrop. Depth comes from tone (panels lighter than the graph, fields recessed, overlays raised) and a 1px `rule-panel` border, with no panel shadow (S65); only graph-row lane bands may fade opaque color, with no other sheen, glow, gradient, translucency, or blur (brand B8, S14).
- **Materials:** `panel` (sidebar, inspector), `graph` (graph and center views), `raised` (composer, overlays), and `control` / `control-hover` for bar items and buttons; every material is opaque in both themes.
- **Overlays:** menus, the palette, dialogs, and toasts use the `overlay` and `modal` shadows, always paired with a 1px `rule-panel` border for a crisp edge.
- **Themes:** dark and light have their own shadow values.
- **Layers:**
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
| lg | 10px | Panels (S14), buttons, inputs, the command field, the breadcrumb, menus, empty-state boxes |
| xl | 14px | The composer, dialogs, the palette |
| pill | 999px | Tabs, chips, banners, time pills, counts, toasts (S48) |

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
  - the toast countdown ring (S48);
  - view swap, which replaces held content (S72);
  - feedback enter, for the operation pill and its result chip (S73).
- **Hold and settle (S72):** pending work stays invisible for its first 150ms, and an indicator, once shown, stays at least 400ms, so fast reads never flash; held content is never dimmed.
- **No motion on:** hover and press, which change state instantly. Rows never slide (S11).
- **Reduced motion:** every recipe becomes an instant change, and the toast ring is static. The indeterminate operation indicator becomes the static label "In progress…".

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

S65 supersedes S32's former 16px inline author badge: every author badge outside the graph is 24px. The graph's author discs remain unchanged.

Composer fields shrink within the inspector's assigned column; their one-line summary and fixed-height description never widen the panel (S50). Busy icon buttons keep the same square and replace the icon with a centered spinner in that square, not an added row below it (S8, S66). Returning repository tabs publish their own cached graph pages before awaiting refresh, keyed by repository and branch visibility (S8). Verify these states with `app/src/styles/changes.render.test.tsx`, `app/src/styles/surfaces.render.test.tsx`, and `app/src/graph/graphStore.test.ts`.

| Component | Purpose | Spec | Consumers |
|---|---|---|---|
| App shell (tab bar, command bar, activity bar) | Window frame | This file · [../docs/design/COMPONENT_SPECS.md](../docs/design/COMPONENT_SPECS.md) | S01–S31 |
| Backdrop and panels | Window background and region containers | This file (§Elevation & Depth, `materials`) | S01–S31 |
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
| Commit inspector actions | Branch here, Cherry-pick, Revert, and Reset in the header of a selected commit | COMPONENT_SPECS § Commit inspector actions; summary in `ui-strong` and `text` ink, body through the shared sanitized Markdown renderer in `ui-body` and `text` ink with paragraph spacing, a 1px `rule` before the actions, and S17's text cursor | S03, S15, S67 |
| Message edit form | Edit the HEAD commit message in the commit inspector | COMPONENT_SPECS § Message edit form | S03 |
| Menu, context menu, drop menu | Direct manipulation | UX_PATTERNS §6–7 | S12 |
| Command palette | Keyboard access | SCREEN_INVENTORY S21 | S21 |
| Dialog, confirmation | Risky actions | SCREEN_INVENTORY S11, S13, S14 | S11–S19 |
| Toast, tooltip, badge, progress | Feedback | Front matter tokens | S48 (toast), S30 and all |
| Switch | On/off setting (usage recording) | 32×18 pill with a 12px thumb, a 24px-tall hit area, `role="switch"` with an accessible name and `aria-checked`. Off: `material.control` fill, 1px `rule-strong` edge, `text-muted` thumb. On: `accent` fill, `on-accent` thumb. The thumb moves by transform only (S11). A visible "On" or "Off" label always sits beside it (S15, B4) | S16, S23, S24 |
| Diagnostics list (usage event, crash report, activity history) | Local records in Settings → Privacy & diagnostics | Rows reuse the Activity entry (status glyph, operation, summary, time; expandable body for crash details and commands). Pages of 25 load with a "Show older" button; an empty list states why it is empty. Header actions are Export… (native save dialog) and a text-labelled Delete or Clear (S5, S16) | S16, S23, S24 |
| Chip group (HEAD, branch, sync) | One pill of three segment buttons in the strip | A `chip` pill whose segments are flat buttons on `material.control-hover` at hover: HEAD (reveal), branch and upstream (branch menu), ahead and behind (Pull menu); a detached HEAD uses `attention-ink` and shows only the HEAD segment | S02, S22 |
| Strip notice | Persistent outcome with actions in the state strip | A `chip-attention` chip with its text, an optional `hint-text`, text-labelled `btn sm` actions, and a dismiss icon button; inside the operation banner it is plain text | S22 |
| Operation pill and result chip | Progress and outcome of a Git operation in the state strip | A `chip` pill with the operation and stage text, a 2px bar (determinate while the stage reports progress), and a text Cancel; on success the same pill states the outcome with a text-labelled `btn sm` next step and a dismiss icon button; it enters with `feedback-enter` | S66, S73 |
| Incoming marker | Commits fetched but not yet pulled | On the graph row, a 12px registry glyph and the word "incoming" in `ui-small` muted ink after the message; removed once the commit is pulled or its row is selected | S74 |
| Popover (ref overflow, graph settings, worktrees, upstream, Push to…, rename stash) | Small forms and lists anchored to their trigger | The `popover` surface; the first input, select, or list takes focus; Esc closes and returns focus to the opener | S21, S22 |
| Sidebar folder row | Slash-separated branch names | A 32px `srow` with a rotating chevron and folder name; the accessible name retains the branch count, and the selected row shows it; children indent 12px per level with 4px guide clearance | S23, S65 |
| Provider card, provider row, status badge | Choose and review AI providers in Settings → AI | A card is a `button` on `material.control` with a 24px or 32px provider mark (or neutral glyph), the provider name in `ui-strong`, and one line of `ui-small` muted copy; two per row in the add dialog. A row shows the mark, name, `ui-small` kind and model (mono), a status badge, the "Active" chip, and icon actions. The active row uses the selection fill with the 2px accent bar. A status badge is a pill with a 14px glyph and a word: check on `accent-tint` for Ready, warning on `attention-tint` for Not installed, Signed out, and Key missing, warning on `danger-tint` for Key rejected, Unreachable, and Check failed | S24, S26 |
| Rebase row and resulting-history preview | Edit history | A row is `canvas` with a 1px `rule` inset: drag handle, mono SHA, message, "Pushed" chip, action select, and move up and down; a reword or last squash row grows a message textarea, and a row that cannot apply shows its problem in `ui-small` danger ink below it. The drop position is a 2px accent line above or below the row. The preview lists the resulting commits newest first with their source SHAs and a text chip (Combined, Reworded, Stops here so you can amend it), then the dropped commits | S25 |
| Recompose change row and commit card | Regroup unpushed commits | A file row (named status icon, left-truncated path, assignment chip, assign button) with hunk rows and line checkboxes (S18 pattern) below it; the chip reads Unassigned (attention), Commit N, or Split (accent). A commit card is a `canvas` panel with a 1px `rule` inset holding the message textarea, move and remove icon buttons, and the assigned files with their scope and counts; while dragging over it, it takes the `accent-tint` fill and a 2px accent inset | S3, S25 |
| AI proposal | Conflict resolver | A `canvas` block with a 3px accent inline-start bar, a header naming it a draft, the rationale in `ui-small` muted, the proposed lines in `code`, and Accept, Edit, and Reject buttons | S24 |
| Tab group | Worktree tabs under their repository | A `tab-group` wrapper of pill tabs with a 1px `rule-panel` inset border and 4px padding when it holds two or more tabs; a linked worktree tab leads with the 16px `worktree` glyph, the first tab keeps the logo | S28 |
| Worktree lane row | One worktree in the Worktrees panel and its menu | A `canvas` row with a 1px `rule` inset: worktree glyph, mono branch, text chips for Main worktree and the flags, the left-truncated path, then four icon buttons; the worktree open here uses the selection fill with the 2px accent bar | S28 |
| Recovery row and snapshot row | Restore from the reflog, lost commits, and snapshots | A `canvas` row with a 1px `rule` inset: the action chip, mono short SHA, summary, mono selector, relative age with the absolute time as tooltip, and three icon buttons (branch, check, undo); a pruned commit reads "Commit no longer exists" in muted ink with the buttons disabled. A snapshot row is a button with the action in `ui-strong`, the description, a file-count chip, and the age; the open row takes the selection fill and the accent bar and shows its files (named status icon, left-truncated path, a checkbox) with Restore selected files, Restore everything…, and a danger Delete snapshot… | S3, S27 |
| File view | Read one file at a revision | The diff panel frame with a breadcrumb, line count, size, and line-ending chips, Open in editor, and Close; lines are a 56px right-aligned muted number and the `code` text with `syntax-*` tokens, virtualized | S29 |
| Platform connection row | A connection in Settings → Platforms | The provider row layout with a 24px neutral platform glyph tile (`provider-logo neutral`), name in `ui-strong` over the kind and mono host in `ui-small` muted, the `chip-attention` chip "Certificate not checked" when the certificate is not verified, a text Test button, and Edit and Remove icon buttons; a test result sits on its own line below as a `chip-success` "Connected as <login>" or an error note with a text-labelled "Edit connection" | S31 |
| Pull request row | One pull request in the sidebar Pull requests section | A `srow` that grows to two lines: `#number` (mono, muted) and the title, then the author and mono `source → target` in `ui-small` muted; a state chip (`chip-success` Open, plain Merged, `chip-danger` Closed) with a 14px glyph and the word; Open in browser and Merge as 24px icon buttons that show on hover, focus, and selection; the selected row uses the selection fill with the 2px accent bar | S31 |
| Pull request inspector | Details of the selected pull request | The inspector frame of the commit inspector: header with `#number title`, the state chip, the author, text buttons Open in browser and Merge…; the body shows the description, the meta rows (Branches, Author, Created, Updated, Mergeable, Address), and the Files list with named status icons, left-truncated paths, and +/- counts | S3, S31 |
| Pull request compose view | Open a pull request from a local branch | A center view of the workspace (`data-view="compose"`): the platform and repository line, Source and Target owned Selects, the comparison summary with a read-only commit list and the conflict line, Title, the owned TextArea Description prefilled with the repository template, a Draft switch, the AI Generate wand with its disclosure note, Cancel, and the primary "Create pull request" | S31, S77, S78 |
| Pull request badge | An open or draft pull request on a branch | A native button inside the ref label and the sidebar branch row: the `pullrequest` glyph, mono `#number`, and "Draft" for a draft; its tooltip names the number, title, state, `source → target`, and checks; it opens the pull request inspector | S75 |
| Conflict chip and popover | Predicted conflict of the checked-out branch | A `chip` with the `!` conflicted glyph and "Conflicts with <target> · <n> file" that opens a `popover` listing the files (each opens its diff), the merge base, "Rebase <branch> onto <target>…" (confirms first), and "Compose pull request anyway" | S76 |
| Sidebar section header | Collapse a sidebar section | A native button in `ui-section`: section glyph, the name, and a 14px chevron rotated by transform when collapsed; the count chip (`matched/total` while filtering) and the section buttons follow outside the button | S32 |
| Sidebar tree connectors | Show folders and remote branches as a tree | One straight 1px `text-muted` vertical indent guide per level, the full row height, with no elbow or horizontal stub; CSS borders only | S32 |
| Sidebar filter | Filter every section | The `input` with the search glyph above the sections, named "Filter sidebar", placeholder "Filter" | S32 |
| Author badge | Show who wrote a commit | A 24px pill-rounded tile outside the graph on `accent-tint` holding the Gravatar identicon, or the author's initial in 12px `ui-micro`; decorative | S32, S65 |
| Split pane, resizable divider | Layout | This file (`controls.divider-hit`; a focusable `role="separator"` with `aria-valuenow` and `aria-orientation` takes `cursors.resize-column` or `cursors.resize-row`, S17) | S02, S07, S09 |
| Empty state | Guidance | SCREEN_INVENTORY | S01, S03, S26, S29 |

The danger button is an outline: transparent fill, a 1px `danger` border, and `danger` text. Its token pair is checked on `surface-2`; on the operation banner it measures 4.59:1 dark and 4.57:1 light.

## Content

- Follow the brand Content rules.
- **Surface specifics:**
  - Menu labels name the source and target ("Rebase feature/greeting onto main").
  - Disabled items carry a reason.
  - Failure toasts use S48's shared concise operation-and-cause copy; raw error messages and output stay in Activity.
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
- **Contrast:** token pairs are validated by lint and by `contrast.test.ts` on every opaque reading surface (S10). Rendered contrast is checked in both themes after implementation.

## Verification

- **Lint:** `python3 ~/.agents/skills/daedalus/scripts/design_md.py lint app/DESIGN.md --strict`, which checks component contrast in both themes (S10).
- **Render matrix:** `python3 ~/.agents/skills/daedalus/scripts/design_md.py matrix app/DESIGN.md`. The specimens in [../docs/design/specimens/](../docs/design/specimens/) exercise it: `workspace.html` (screen 1) and one file per screen in `screens/`, built on the shared `specimen.css` and `specimen.js`. Each specimen's hash selects the theme and state (`dark`, `light`, `-still` to freeze motion; the workspace also takes `-rebase` and `-highlight`). Specimens are proposal evidence, not implementation; `specimen.css` carries the S14 palette with no aurora, but the PNGs in `renders/` predate it (2026-10-03) and show the retired aurora. The approved visual reference for S14 and S48–S53 is the offline proposal `docs/design/proposals/2026-10-table-command/`.
- **Review-only until implementation:** S1–S9, S11–S16, and S72–S78. Implementation must add:
  - a token source;
  - a repository drift test comparing this front matter with the token source in both directions;
  - render checks at `minimum`, `laptop`, `desktop`, and `wide` in both themes.

## Maintenance

- Change the rule here first and obtain approval.
- Update the token source, components, tests, and this file in the same change.
- Run the strict lint and, once code exists, the repository drift check.
- **Placement:** this surface file lives beside the SolidJS frontend as `app/DESIGN.md`; its token source is `app/src/styles/tokens.css`, and `app/src/styles/tokens.test.ts` checks drift in both directions (`pnpm test` in `app/`).

## Do's and Don'ts

- Do encode state in two channels, keep tags visible, name both refs in integration verbs, and put every bar item on a control or chip.
- Don't add card grids, gradients outside the approved graph-row band, glows, translucency, or blur, uppercase section labels, hover-only actions, a default-focused destructive button, or GitKraken service surfaces.

## Exceptions

| Rule | Scope | Reason | Approved by | Review date |
|---|---|---|---|---|
| S10 | Rendered contrast | Only token pairs are linted until an implementation exists; specimen renders and the worst-case composites are advisory | User (Phase 8 approval, 2026-09-29) | 2026-10-29 |
| S14, S64; brand B8 | Commit-graph row band only: opaque horizontal lane-color fade ending at canvas or selected-row fill | Brings the graph closer to the supplied GitKraken reference without changing any other surface | User, 2026-10-04 | 2026-11-04 |
| S10 | Graph lane lines: dark lane 2 (2.57:1); light lanes 7 (1.58:1), 8 (1.78:1), and 9 (2.01:1) | GitKraken-exact palette (P-G1); column position, labels, and initials also identify lanes. Contrast-safe values if revisited: dark 2 `#A800E6`; light 7 `#B4900B`, 8 `#58A720`, 9 `#26A880` | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| S10 | Dimmed graph rows (branch-hover highlight, search non-match): 1.86:1 dark, 1.61:1 light | Transient de-emphasis that matches GitKraken; highlighted rows keep full contrast | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| Brand Typography (no uppercase headers) | Graph column header | GitKraken parity (P-G1) | User (P-G1 approval, 2026-09-29) | 2026-10-29 |
| Colors (surface roles), S14, Layout and Responsive panel placement, S36 (toast placement) | Offline proposals under `docs/design/proposals/2026-10-kraken-contrast/`, `docs/design/proposals/2026-10-forge-contrast/`, `docs/design/proposals/2026-10-merge-tool/`, `docs/design/proposals/2026-10-two-pane-ai/`, `docs/design/proposals/2026-10-right-panel-ai/`, `docs/design/proposals/2026-10-flow-minimal/`, `docs/design/proposals/2026-10-launchpad-settings/`, and `docs/design/proposals/2026-10-table-command/` only | Compare five interactive workspace layouts, then five Forge Contrast variants of the conflict resolver (editable result), file history, and blame, then five workspace directions around the chosen Merge Tool, then five Two Pane variants of AI assistance (S24 wand buttons, editable drafts), Settings, the Launchpad, and file-list tree view, revised with Changes in the right panel, on candidate charcoal surfaces (tab bar darkest, distinct toolbar, panels lighter than the graph, blue selection with an edge bar, green kept for affirmative actions), each with its own top-right stacked, auto-dismissing toast. Production surfaces, components, and layout stay unchanged until one direction is approved | User, 2026-10-03: GitKraken's color scheme and layout are preferred for their high contrast and easy distinction between elements and actions; Forge Contrast chosen as the base for conflict, history, and blame variants; Merge Tool chosen as the base for three lean, one fluid, and one futuristic direction; Two Pane chosen as the base for AI, Settings, Launchpad, and tree view variants; Changes moved back to the right panel; Flow Sheet chosen and its Changes panel made minimal and icon-driven; five Launchpad and Settings variants requested on that workspace; the Table Launchpad and the Command Settings chosen | 2026-11-03 |
| S35, S61 (Edit file uses TextArea) | Edit file center view only | An owned code editor is necessary for Vim modes and LSP interaction; all other multi-line fields keep the owned TextArea | User, 2026-10-04 (S68 approval) | 2026-11-04 |
