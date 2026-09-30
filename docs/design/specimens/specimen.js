(() => {
  const base = document.currentScript.src;
  const brand = (file) => new URL(`../../../brand/${file}`, base).href;
  const svg = (paths, size = 16, width = 1.6) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    check: '<path d="M4 12.5 9.5 18 20 6"/>',
    warning: '<path d="M12 4 2.5 20h19zM12 10v4.5M12 17.5v.01"/>',
    undo: '<path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>',
    stash: '<path d="M4 9h16v11H4zM7 4h10l3 5H4zM9 14h6"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    remote: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="8" r="1.5"/>',
    worktree: '<path d="M12 21V11M12 11 6 5M12 11l6-6"/>',
    local: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    sync: '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5"/>',
    fetch: '<path d="M12 4v10M7.5 10 12 14.5 16.5 10M4 15v4.5a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V15"/>',
    pull: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
    push: '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
    branch: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8.5" r="2"/><path d="M6 7.5v9M18 10.5c0 3.5-3 5-8.5 6.3"/>',
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>',
    merge: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="15" r="2"/><path d="M6 7.5v9M6 7.5c0 5 12 2 12 5.5"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
    diff: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M8 9h6M11 6v6M8 16.5h8"/>',
    edit: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19zM14.5 6.5l3 3"/>',
    terminal: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7.5 10 3 2-3 2M13 15h3.5"/>',
    previous: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    next: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M12 8h2.5M12 12h3.5M12 16h2.5"/>',
    changes: '<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9.5 12h5M9.5 16h5"/>',
    key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    wand: '<path d="M4 20 13 11M11 9l4 4 4-4-4-4z"/>',
    rebase: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><path d="M6 7.5v9M9 5.5h5a4 4 0 0 1 4 4v3M15 10l3 3 3-3"/>',
    squash: '<path d="M5 4.5l7 6 7-6M5 19.5l7-6 7 6M4 12h16"/>',
    recompose: '<path d="M4 7h3.5l9 10H20M4 17h3.5l2.5-2.8M13.5 9.5 16.5 7H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    file: '<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2"/>'
  };
  const glyph = (name, size = 16) => svg(paths[name], size, size <= 16 ? 1.5 : 1.6);
  const icon = {
    local: svg('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>', 14, 1.8),
    remote: svg('<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z"/>', 14, 1.8),
    tag: svg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="8" r="1.5"/>', 14, 1.8),
    worktree: svg('<path d="M12 21V11M12 11 6 5M12 11l6-6"/>', 14, 1.8),
    check: svg('<path d="M4 12.5 9.5 18 20 6"/>', 12, 2.6),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', 15),
    warn: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 14),
    folder: svg('<path d="M3 6h7l2 2h9v11H3z"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 14),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>', 14)
  };

  const baseRows = () => [
    { m: "Changes: 1 modified, 1 untracked", kind: "wip", p: [1] },
    { m: "Export shout helper", p: [2], au: "YL", refs: [{ n: "feature/greeting", k: ["local"], head: true }] },
    { m: "Add shout helper", p: [3], au: "YL" },
    { m: "Personalize greeting", p: [4], au: "YL", refs: [{ n: "feature/inline-branch", k: ["local"] }, { n: "feature/greeting", k: ["remote"] }] },
    { m: "Merge remote-tracking branch 'origin/main'", kind: "merge", p: [5, 6], au: "YL", refs: [{ n: "main", k: ["local"] }], div: "an hour ago" },
    { m: "Tune retries and clamp helper", p: [8], au: "YL", ghost: "main" },
    { m: "Document verbose flag", p: [11], au: "CN", refs: [{ n: "main", k: ["remote"] }], div: "3 weeks ago" },
    { m: "WIP: try compact header", kind: "stash", p: [8] },
    { m: "Switch usage docs to npm start", p: [11], au: "YL", refs: [{ n: "hotfix/wt-demo", k: ["local", "worktree"] }] },
    { m: "Prototype settings panel", p: [12], au: "CN", refs: [{ n: "feature/remote-only", k: ["remote"] }] },
    { m: "Add fuzzy matching", p: [15], au: "CN", refs: [{ n: "feature/search", k: ["remote"] }] },
    { m: "Add release checklist", body: "Document the manual release steps so every maintainer follows the same order.", p: [12], au: "CN", refs: [{ n: "v0.3.0-rc1", k: ["tag"] }] },
    { m: "Refresh logo colors", p: [13], au: "BO" },
    { m: "Update greeting copy", p: [17], au: "AP" },
    { m: "Fix header alignment", p: [17], au: "BO", refs: [{ n: "bugfix/header", k: ["local"] }] },
    { m: "Improve search ranking", p: [16], au: "CN", refs: [{ n: "feature/search", k: ["local"] }], branch: "feature/search" },
    { m: "Add search module", p: [17], au: "CN", branch: "feature/search" },
    { m: "Merge branch 'feature/login'", kind: "merge", p: [18, 19], au: "AP", refs: [{ n: "v0.2.0", k: ["tag"] }], div: "4 weeks ago" },
    { m: "Fix typo in README", p: [21], au: "BO" },
    { m: "Validate login input", p: [20], au: "AP", refs: [{ n: "feature/login", k: ["local", "remote"] }] },
    { m: "Add login form", p: [21], au: "AP" },
    { m: "Add configuration loader", p: [22], au: "YL", refs: [{ n: "v0.1.0", k: ["tag"] }] },
    { m: "Add logo asset", p: [23], au: "BO" },
    { m: "Add app skeleton", p: [24], au: "AP" },
    { m: "Initial commit", p: [], au: "YL" }
  ];

  const iconBtn = (name, label, size = 16) => `<span class="icon-btn dense" aria-label="${label}">${glyph(name, size)}</span>`;
  const acts = (kind, { discard = true } = {}) => {
    const buttons = {
      stage: [iconBtn("diff", "Open diff"), iconBtn("edit", "Open in editor"), iconBtn("plus", "Stage")],
      unstage: [iconBtn("diff", "Open diff"), iconBtn("edit", "Open in editor"), iconBtn("minus", "Unstage")],
      conflict: [iconBtn("merge", "Resolve"), iconBtn("check", "Mark resolved")]
    }[kind];
    return `<span class="acts">${buttons.join("")}${kind !== "conflict" && discard ? iconBtn("more", "More actions") : ""}</span>`;
  };
  const lhead = (name, title, bulk) => `<div class="lhead"><span class="lhead-title">${glyph(name)}${title}</span>${bulk ? ` <span class="btn sm">${glyph(bulk.icon, 14)}${bulk.label}</span>` : ""}</div>`;
  const tip = (text, shortcut) => `<span class="tooltip">${text}${shortcut ? ` <kbd class="tip-key">${shortcut}</kbd>` : ""}</span>`;
  const item = (name, body, { cls = "", note = "" } = {}) => `<div class="item${cls ? " " + cls : ""}"><span class="item-main"><span class="item-icon">${name ? glyph(name) : ""}</span>${body}</span>${note}</div>`;

  const flags = new Set((location.hash.slice(1) || "dark").split("-"));
  const theme = flags.has("light") ? "light" : "dark";
  const still = [...flags].find(t => t.startsWith("still"));

  function boot(label) {
    document.documentElement.dataset.theme = theme;
    if (still) {
      const phase = Number(still.slice(5)) || 0;
      document.querySelectorAll(".aurora i").forEach((el, k) => { el.style.animationDelay = `-${k * 17 + phase * 23}s`; });
      document.body.classList.add("paused", "still");
    } else {
      const syncPause = () => document.body.classList.toggle("paused", document.hidden || !document.hasFocus());
      document.addEventListener("visibilitychange", syncPause);
      window.addEventListener("blur", syncPause);
      window.addEventListener("focus", syncPause);
    }
    const wm = document.createElement("div");
    wm.className = "watermark";
    wm.textContent = `YForge specimen · ${label} · ${theme} · design evidence, not implementation`;
    document.body.appendChild(wm);
  }

  const aurora = () => '<div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a4"></i></div>';

  function tabs({ repo = "sample", meta = "2 worktrees", others = ["other-repo"] } = {}) {
    const close = name => `<span class="tab-close" aria-label="Close ${name}">${glyph("close", 14)}</span>`;
    const rest = others.map(t => `<span class="tab">${t}${close(t)}</span>`).join("");
    const first = repo ? `<span class="tab active"><img class="mark" src="${brand("yforge-app-icon-small.svg")}" alt="">${repo}${meta ? ` <span class="n">${meta}</span>` : ""}${close(repo)}</span>` : "";
    return `<div class="bar"><div class="dots"><i></i><i></i><i></i></div>${first}${rest}<span class="icon-btn" aria-label="New tab">${glyph("plus")}</span><span class="spacer"></span><span class="icon-btn" aria-label="Activity">${glyph("activity")}</span><span class="icon-btn" aria-label="Toggle theme">${glyph("theme")}</span><span class="icon-btn" aria-label="Settings">${glyph("settings")}</span></div>`;
  }

  function tool(name, label, { primary = false, narrow = false, hint = "", caret = false } = {}) {
    const size = narrow ? 20 : 16;
    const text = narrow ? "" : label;
    const k = hint ? `<span class="k">${hint}</span>` : "";
    return `<span class="btn${primary ? " primary" : ""}${narrow ? " icon-only" : ""}" ${narrow ? `aria-label="${label}"` : ""}>${glyph(name, size)}${text}${k}${caret && !narrow ? glyph("chevron", 14) : ""}</span>`;
  }

  function command({ crumb = ["sample", "main worktree", "feature/greeting"], sync, syncClass = "primary", narrow = false } = {}) {
    const parts = crumb.map((c, i) => i === crumb.length - 1 ? `<span class="br">${c}</span>` : c).join(' <span class="sep">›</span> ');
    const syncButton = sync ? `<span class="btn ${syncClass}">${glyph("sync")}${sync}</span>` : tool("sync", "Sync", { primary: true, narrow, hint: "↑2", caret: true });
    return `<div class="bar"><span class="crumb">${parts} ▾</span><span class="cmd">${icon.search}<span class="ph">Search commits, branches, files, or run a command</span><span class="kbd">⌘K</span></span><span class="icon-btn" aria-label="Search commits">${glyph("search")}</span>${syncButton}${tool("branch", "Branch", { narrow })}${tool("stash", "Stash", { narrow })}${tool("undo", "Undo", { narrow })}</div>`;
  }

  const headChip = (branch = "feature/greeting", upstream = "origin/feature/greeting", counts = '<span class="st st-A">↑2</span> ↓0') =>
    `<span class="chip-group" role="group" aria-label="HEAD, branch, and sync"><span class="chip-seg"><span class="junction"></span>HEAD <span class="ref">${branch}</span></span>${upstream ? `<span class="chip-seg">→ <span class="ref">${upstream}</span></span><span class="chip-seg">${counts}</span>` : '<span class="chip-seg">no upstream</span>'}</span>`;

  const notice = (text, actions = [], detail = "") =>
    `<span class="strip-notice"><span class="chip attn">${glyph("stash")}${text}</span>${detail ? `<span class="hint">${detail}</span>` : ""}${actions.map(a => `<span class="btn sm">${a}</span>`).join("")}<span class="icon-btn dense" aria-label="Dismiss">${glyph("close", 14)}</span></span>`;

  function strip({ banner, chips, fresh = `<span class="chip ok">${glyph("check")}fetched 2 min ago</span>`, right = `<span class="chip">${glyph("worktree")}2 worktrees · 1 with changes</span>`, extra = "" } = {}) {
    if (banner) return `<div class="bar chips">${banner}</div>`;
    const left = chips || `${headChip()}<span class="chip">${glyph("changes")}Changes <span class="st st-M">M 1</span> <span class="st st-U">U 1</span></span>${fresh}${extra}`;
    return `<div class="bar chips">${left}<span class="spacer"></span>${right}</div>`;
  }

  const sec = (name, title, n) => `<div class="sec"><span class="sec-title">${glyph(name)}${title}</span> <span class="n">${n}</span></div>`;

  function sidebar({ current = "greeting", repo, recovery = false, worktrees = ["sample|main worktree|", "hotfix/wt-demo|clean|"] } = {}) {
    const row = (name, meta = "", cls = "") => `<div class="srow${cls}${name === current && cls.includes("child") ? " current" : ""}">${name}${meta ? ` <span class="meta${meta.startsWith("↑") ? " up" : ""}">${meta}</span>` : ""}</div>`;
    return `<aside class="panel sidebar" aria-label="Repository">${repo ? `<div class="sec">${repo}</div>` : ""}
      ${sec("changes", "Changes", 2)}
      ${sec("branch", "Branches", 7)}
      ${row("main", "↑3")}
      <div class="srow folder"><span class="chev">${glyph("chevron", 14)}</span>bugfix <span class="meta">1 branch</span></div>${row("header", "", " child")}
      <div class="srow folder"><span class="chev">${glyph("chevron", 14)}</span>feature <span class="meta">4 branches</span></div>${row("greeting", current === "greeting" ? "↑2 · HEAD" : "", " child")}${row("inline-branch", "", " child")}${row("login", "", " child")}${row("search", "↓1", " child")}
      ${sec("remote", "Remotes", 5)}
      ${sec("tag", "Tags", 3)}
      ${sec("stash", "Stashes", 2)}
      ${sec("worktree", "Worktrees", 2)}
      ${worktrees.map((entry) => { const [name, meta, cls] = entry.split("|"); return `<div class="srow${cls ? " " + cls : ""}">${name} <span class="meta">${meta}</span></div>`; }).join("")}
      ${recovery ? `${sec("history", "Recovery", "")}<div class="srow">Reflog</div><div class="srow">Lost commits</div><div class="srow">Safety snapshots</div>` : ""}
    </aside>`;
  }

  const COLUMNS = flags.has("columns") ? [["Author", 130], ["Date / Time", 130], ["SHA", 100]] : [];
  const EXTRA = COLUMNS.reduce((total, [, width]) => total + width, 0);

  const graphPanel = () => `<section class="panel graph" aria-label="Commit graph" style="--extra-w: ${EXTRA}px"><div class="ghead" style="grid-template-columns: var(--ref-w) var(--graph-w) 1fr${COLUMNS.map(([, width]) => ` ${width}px`).join("")} 24px"><span class="gh">Branch / Tag<i class="gresize end" role="separator" aria-orientation="vertical" aria-label="Resize Branch / Tag column"></i></span><span class="gh">Graph</span><span class="gh">Commit message</span>${COLUMNS.map(([name]) => `<span class="gh">${name}<i class="gresize start" role="separator" aria-orientation="vertical" aria-label="Resize ${name} column"></i></span>`).join("")}<span class="gh gear" aria-label="Graph columns">${svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>', 14)}</span></div><div class="gbody" id="gbody"><svg class="g" id="g"></svg></div></section>`;

  const activity = ({ command = 'git commit -m "Export shout helper"', duration = "0.2 s", action = "Undo commit" } = {}) =>
    `<div class="bar activity"><span class="chip">${glyph("activity", 14)}Activity · Last: <code>${command}</code> · ${duration}</span><span class="spacer"></span>${action ? `<span class="btn">${glyph("undo", 14)}${action}</span>` : ""}</div>`;

  const ROW = 28, PITCH = 22, GUTTER = 28, NODE = 22, MERGE = 12, LINE = 2, ARC = 11, LANES = 10;

  function layout(rows) {
    const lanes = [];
    rows.forEach((r, i) => {
      const waiting = [];
      lanes.forEach((v, c) => { if (v === i) waiting.push(c); });
      let col = waiting.length ? waiting[0] : lanes.indexOf(null);
      if (col < 0) col = lanes.length;
      r.col = col;
      lanes[col] = null;
      r.edges = r.p.map((p, k) => {
        if (k === 0) { lanes[col] = p; return { p, lane: col }; }
        const reserved = lanes.indexOf(p);
        if (reserved >= 0) return { p, lane: reserved };
        let free = lanes.findIndex((v, c) => v === null && !waiting.includes(c));
        if (free < 0) free = lanes.length;
        lanes[free] = p;
        return { p, lane: free };
      });
      waiting.slice(1).forEach(c => { if (lanes[c] === i) lanes[c] = null; });
    });
  }

  function orthogonal(points) {
    const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === pts.length - 1) { d += ` L${x} ${y}`; break; }
      const [px, py] = pts[i - 1], [nx, ny] = pts[i + 1];
      const ax = Math.sign(x - px), ay = Math.sign(y - py), bx = Math.sign(nx - x), by = Math.sign(ny - y);
      const r = Math.min(ARC, Math.abs(x - px) + Math.abs(y - py), Math.abs(nx - x) + Math.abs(ny - y));
      const sweep = ax * by - ay * bx > 0 ? 1 : 0;
      d += ` L${x - ax * r} ${y - ay * r} A${r} ${r} 0 0 ${sweep} ${x + bx * r} ${y + by * r}`;
    }
    return d;
  }

  function contrastInk(hex) {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? "#000000" : "#FFFFFF";
  }

  function mountGraph({ selected = 0, hovered = 5, highlight = null, conflict = null, dimAll = false, multi = [] } = {}) {
    const rows = baseRows();
    if (conflict) { rows[0].m = conflict; rows[0].conflict = true; }
    layout(rows);
    const css = getComputedStyle(document.documentElement);
    const refW = parseFloat(css.getPropertyValue("--ref-w"));
    const graphW = parseFloat(css.getPropertyValue("--graph-w"));
    const laneColor = c => css.getPropertyValue(`--l${c % LANES}`).trim();
    const laneVar = c => `var(--l${c % LANES})`;
    const nodeX = c => refW + GUTTER + c * PITCH + NODE / 2;
    const rowY = i => i * ROW + ROW / 2;
    const body = document.getElementById("gbody");
    const g = document.getElementById("g");
    g.setAttribute("width", refW + graphW);
    g.setAttribute("height", rows.length * ROW);
    let refLines = "", edges = "", nodes = "";
    rows.forEach((r, i) => {
      const y = rowY(i), x = nodeX(r.col), color = laneVar(r.col);
      if ((r.refs && r.refs.length) || (r.ghost && i === hovered && !highlight)) {
        const active = (i === selected || i === hovered) && Boolean(r.refs && r.refs.length);
        refLines += `<line x1="2" y1="${y}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="${active ? 2 : 1}" opacity="${active ? 1 : 0.25}"/>`;
      }
      r.edges.forEach(({ p, lane }) => {
        const q = rows[p], yp = rowY(p), xl = nodeX(lane);
        const d = orthogonal([[x, y], [xl, y], [xl, yp], [nodeX(q.col), yp]]);
        const dotted = r.kind === "wip" || r.kind === "stash" ? ' stroke-dasharray="2 2"' : "";
        edges += `<path d="${d}" fill="none" stroke="${laneVar(lane)}" stroke-width="${LINE}" stroke-linejoin="round"${dotted}/>`;
      });
      if (r.kind === "wip") {
        nodes += `<circle cx="${x}" cy="${y}" r="${(NODE - LINE) / 2}" fill="var(--canvas)" stroke="${color}" stroke-width="${LINE}" stroke-dasharray="2 3" stroke-linecap="round"/>`;
      } else if (r.kind === "stash") {
        const s = NODE - LINE;
        nodes += `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="var(--canvas)" stroke="${color}" stroke-width="${LINE}" stroke-dasharray="2 2"/>`;
        nodes += `<g transform="translate(${x - 6} ${y - 6}) scale(.5)" fill="none" stroke="${color}" stroke-width="3.2" stroke-linejoin="round"><path d="M4 9h16v11H4zM7 4h10l3 5H4zM9 14h6"/></g>`;
      } else if (r.kind === "merge") {
        nodes += `<circle cx="${x}" cy="${y}" r="${MERGE / 2}" fill="${color}"/>`;
      } else {
        nodes += `<circle cx="${x}" cy="${y}" r="${NODE / 2 - LINE / 2}" fill="${color}" stroke="${color}" stroke-width="${LINE}"/>`;
        nodes += `<text x="${x}" y="${y}" dy="0.35em" text-anchor="middle" font-family="Geist, system-ui, sans-serif" font-size="10" font-weight="700" fill="${contrastInk(laneColor(r.col))}">${r.au}</text>`;
      }
    });
    g.innerHTML = refLines + edges + nodes;
    rows.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = ["row", i === selected || multi.includes(i) ? "sel" : "", i === hovered && i !== selected ? "hover" : "", r.kind || "", r.conflict ? "conflict" : "", (highlight && r.branch !== highlight) || (dimAll && i !== selected) ? "dim" : ""].filter(Boolean).join(" ");
      el.style.top = `${i * ROW}px`;
      el.style.setProperty("--lane", laneVar(r.col));
      const msgLeft = refW + graphW;
      let html = `<div class="bg"></div><div class="lstrip" style="left:${msgLeft}px"></div>`;
      const labels = (r.refs || []).map(ref => {
        const kind = ref.k.includes("tag") ? " tag" : highlight && ref.n === highlight && ref.k.includes("local") && i === hovered ? " hover" : "";
        const title = ref.k.includes("remote") && !ref.k.includes("local") ? `origin/${ref.n}` : ref.n;
        const icons = ref.k.map(k => icon[k]).join("");
        return `<span class="label${ref.head ? " active" : ""}${kind}" title="${title}">${ref.head ? icon.check : ""}<span class="name">${ref.n}</span>${icons}</span>`;
      });
      if (!labels.length && r.ghost && i === hovered && !highlight) labels.push(`<span class="label ghost"><span class="name">${r.ghost}</span>${icon.local}</span>`);
      if (labels.length) html += `<div class="refcell">${labels[0]}${labels.length > 1 ? `<span class="more" aria-haspopup="dialog" aria-label="${labels.length - 1} more branch">+${labels.length - 1}</span>` : ""}</div>`;
      html += `<div class="msg" style="left:${msgLeft + 12}px"><span class="sum">${r.m}</span>${r.body ? `<span class="body">${r.body}</span>` : ""}</div>`;
      if (r.div) html += `<span class="tpill">${r.div}</span>`;
      if (COLUMNS.length) {
        const people = { YL: "Yui Lin", CN: "Chen Nakamura", BO: "Bo Okafor", AP: "Ada Petrov" };
        const ages = ["2m", "5m", "1h", "1h", "3h", "1d", "1d", "2d", "3d", "4d", "1w", "2w", "3w", "3w", "4w", "4w", "5w", "5w", "6w", "7w", "2mo", "2mo", "3mo", "3mo", "4mo"];
        const cells = { Author: people[r.au] || "", "Date / Time": r.kind === "wip" ? "" : ages[i % ages.length], SHA: r.kind === "wip" ? "" : (0x3b1c9d + i * 7919).toString(16).slice(0, 7) };
        html += `<div class="gextra">${COLUMNS.map(([name, width]) => `<span class="gcell${name === "SHA" ? " mono" : ""}" style="width:${width}px">${cells[name]}</span>`).join("")}</div>`;
      }
      el.innerHTML = html;
      body.appendChild(el);
    });
    if (multi.length > 1) {
      const short = i => (0x3b1c9d + i * 7919).toString(16).slice(0, 7);
      const oldest = Math.max(...multi), newest = Math.min(...multi);
      body.parentElement.insertAdjacentHTML("beforeend", `<div class="gsummary" role="status"><span>${multi.length} commits selected</span><span class="range"><span class="ref">${short(newest)}</span>${glyph("next", 14)}<span class="ref">${short(oldest)}</span></span><span class="spacer"></span><span class="icon-btn dense" aria-label="Clear selection">${glyph("close", 14)}</span></div>`);
    }
  }

  window.YF = { flags, theme, icon, glyph, notice, sec, iconBtn, acts, lhead, tip, item, tool, brand, boot, aurora, tabs, command, headChip, strip, sidebar, graphPanel, activity, mountGraph };
})();
