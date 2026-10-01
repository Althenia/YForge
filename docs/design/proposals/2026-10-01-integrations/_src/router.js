(() => {
  const schema = JSON.parse(document.getElementById("pg-schema").textContent);
  const axes = schema.axes;
  const root = document.documentElement;
  const frame = document.getElementById("pg-frame");
  const scaler = document.getElementById("pg-scaler");
  const controls = document.getElementById("pg-controls");
  const link = document.getElementById("pg-link");
  const live = document.getElementById("pg-live");
  const status = document.getElementById("pg-status");
  const note = document.getElementById("pg-note");
  const label = value => value.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());

  const defaults = () => Object.fromEntries(axes.map(axis => [axis.key, axis.default || axis.values[0]]));
  const parse = hash => {
    const query = new URLSearchParams(hash.replace(/^#/, ""));
    const state = defaults();
    for (const axis of axes) {
      const value = query.get(axis.key);
      if (value !== null && axis.values.includes(value)) state[axis.key] = value;
    }
    return state;
  };
  const serialize = state => axes.map(axis => `${axis.key}=${encodeURIComponent(state[axis.key])}`).join("&");

  const buildControls = () => {
    controls.replaceChildren(...axes.map(axis => {
      const group = document.createElement("div");
      group.className = "pg-control";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", axis.label || label(axis.key));
      const name = document.createElement("span");
      name.textContent = axis.label || label(axis.key);
      const seg = document.createElement("div");
      seg.className = "pg-seg";
      for (const value of axis.values) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.axis = axis.key;
        button.dataset.value = value;
        button.textContent = label(value);
        seg.append(button);
      }
      group.append(name, seg);
      return group;
    }));
    controls.addEventListener("click", event => {
      const button = event.target.closest("button[data-axis]");
      if (!button) return;
      location.hash = serialize({ ...parse(location.hash), [button.dataset.axis]: button.dataset.value });
    });
  };

  const fit = state => {
    const [width, height] = schema.sizes[state.size] || schema.frame;
    const host = scaler.parentElement;
    const padding = parseFloat(getComputedStyle(host).paddingLeft) + parseFloat(getComputedStyle(host).paddingRight);
    const available = host.clientWidth - padding - 2;
    const scale = Math.min(1, available / width);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    scaler.style.width = `${Math.round(width * scale) + 2}px`;
    scaler.style.height = `${Math.round(height * scale) + 2}px`;
    scaler.dataset.scale = scale.toFixed(4);
    note.textContent = `Frame ${width}×${height}px shown at ${Math.round(scale * 100)}%${scale < 1 ? "; widen the window for 100%" : ""}.`;
  };

  let current = defaults();
  const render = state => {
    current = state;
    if (state.theme === undefined || state.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.theme);
    root.style.colorScheme = state.theme === "light" || state.theme === "dark" ? state.theme : "light dark";
    for (const axis of axes) frame.dataset[axis.key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = state[axis.key];
    for (const screen of frame.querySelectorAll(":scope > .screen")) {
      const active = screen.dataset.screen === state.screen;
      screen.hidden = !active;
      for (const variant of screen.querySelectorAll(":scope > [data-state]")) variant.hidden = !active || variant.dataset.state !== state.state;
    }
    for (const button of controls.querySelectorAll("button[data-axis]")) button.setAttribute("aria-pressed", String(state[button.dataset.axis] === button.dataset.value));
    status.textContent = axes.map(axis => `${axis.key}: ${state[axis.key]}`).join(" · ");
    const summary = `${label(state.screen)} — ${label(state.state)}`;
    live.textContent = summary;
    document.title = `${summary} · ${schema.name}`;
    fit(state);
    link.value = location.href;
  };

  const sync = () => {
    const state = parse(location.hash);
    const normalized = `#${serialize(state)}`;
    if (location.hash !== normalized) history.replaceState(null, "", normalized);
    render(state);
  };

  buildControls();
  link.addEventListener("focus", () => link.select());
  window.addEventListener("hashchange", sync);
  window.addEventListener("resize", () => fit(current));
  window.proposalState = () => ({ ...current });
  sync();
})();
