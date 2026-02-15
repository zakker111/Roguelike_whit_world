/**
 * GMPanel: floating Game Master debug overlay (O).
 *
 * Exports (ESM + window.GMPanel):
 * - init(UI)
 * - show()
 * - hide()
 * - isOpen()
 * - refresh()
 *
 * Behavior:
 * - Non-blocking overlay; does not participate in modal gating.
 * - Read-only view onto GMRuntime.getState(ctx) via GameAPI.getCtx().
 */

import { attachGlobal } from "/utils/global.js";

let _panelEl = null;
let _summaryEl = null;
let _statsEl = null;
let _traitsEl = null;
let _mechEl = null;
let _eventsEl = null;
let _open = false;
let _refreshTimer = null;

const MAX_EVENTS = 20;

function getGMState() {
  try {
    if (typeof window === "undefined") return null;
    const GA = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    if (!GA || !GM || typeof GA.getCtx !== "function" || typeof GM.getState !== "function") return null;
    const ctx = GA.getCtx();
    if (!ctx) return null;
    return GM.getState(ctx) || null;
  } catch (_) {
    return null;
  }
}

function installDrag(headerEl, panelEl) {
  if (!headerEl || !panelEl || typeof window === "undefined") return;

  headerEl.addEventListener("mousedown", (ev) => {
    try {
      if (ev.button !== 0) return;
      const target = ev.target;
      if (target && typeof target.closest === "function" && target.closest(".gm-panel-close")) return;

      ev.preventDefault();
      const rect = panelEl.getBoundingClientRect();
      panelEl.style.left = `${rect.left}px`;
      panelEl.style.top = `${rect.top}px`;
      panelEl.style.right = "auto";

      const offsetX = ev.clientX - rect.left;
      const offsetY = ev.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;

      function onMove(e) {
        try {
          e.preventDefault();
          const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
          const vh = window.innerHeight || document.documentElement.clientHeight || 768;
          let nx = e.clientX - offsetX;
          let ny = e.clientY - offsetY;
          const margin = 8;
          const maxX = vw - width - margin;
          const maxY = vh - height - margin;
          if (nx < margin) nx = margin;
          else if (nx > maxX) nx = maxX;
          if (ny < margin) ny = margin;
          else if (ny > maxY) ny = maxY;
          panelEl.style.left = `${Math.round(nx)}px`;
          panelEl.style.top = `${Math.round(ny)}px`;
        } catch (_) {}
      }

      function onUp(e) {
        try { e.preventDefault(); } catch (_) {}
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    } catch (_) {}
  });
}

function ensurePanel() {
  if (_panelEl) return _panelEl;
  if (typeof document === "undefined") return null;

  const root = document.createElement("div");
  root.id = "gm-panel";
  root.style.position = "fixed";
  root.style.top = "80px";
  root.style.right = "24px";
  root.style.zIndex = "32000";
  root.style.minWidth = "320px";
  root.style.maxWidth = "420px";
  root.style.maxHeight = "70vh";
  root.style.background = "rgba(15,23,42,0.96)";
  root.style.border = "1px solid #1f2937";
  root.style.borderRadius = "8px";
  root.style.boxShadow = "0 20px 40px rgba(0,0,0,0.7)";
  root.style.color = "#e5e7eb";
  root.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  root.style.fontSize = "13px";
  root.style.overflowX = "hidden";
  root.style.overflowY = "auto";

  const header = document.createElement("div");
  header.className = "gm-panel-header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.padding = "6px 8px";
  header.style.borderBottom = "1px solid #1f2937";
  header.style.background = "linear-gradient(180deg, rgba(79,70,229,0.18), rgba(15,23,42,0.98))";
  header.style.cursor = "move";

  const titleWrap = document.createElement("div");
  titleWrap.style.display = "flex";
  titleWrap.style.alignItems = "center";

  const title = document.createElement("span");
  title.className = "gm-panel-title";
  title.textContent = "Game Master";
  title.style.fontWeight = "600";
  title.style.letterSpacing = "0.06em";
  title.style.textTransform = "uppercase";
  title.style.fontSize = "11px";
  title.style.color = "#a5b4fc";

  const dragHint = document.createElement("span");
  dragHint.className = "gm-panel-drag-hint";
  dragHint.textContent = "(drag)";
  dragHint.style.marginLeft = "8px";
  dragHint.style.fontSize = "10px";
  dragHint.style.color = "#9ca3af";

  titleWrap.appendChild(title);
  titleWrap.appendChild(dragHint);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "gm-panel-close";
  closeBtn.textContent = "×";
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.color = "#e5e7eb";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "16px";
  closeBtn.style.lineHeight = "1";
  closeBtn.style.padding = "2px 4px";
  closeBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    hide();
  });

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "gm-panel-body";
  body.style.padding = "8px 10px";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "8px";

  _summaryEl = document.createElement("div");
  _summaryEl.className = "gm-panel-summary";
  _summaryEl.style.fontSize = "12px";
  _summaryEl.style.color = "#e5e7eb";
  body.appendChild(_summaryEl);

  const statsLabel = document.createElement("div");
  statsLabel.textContent = "Stats";
  statsLabel.style.fontSize = "11px";
  statsLabel.style.textTransform = "uppercase";
  statsLabel.style.letterSpacing = "0.05em";
  statsLabel.style.color = "#9ca3af";
  statsLabel.style.marginTop = "4px";
  body.appendChild(statsLabel);

  _statsEl = document.createElement("div");
  _statsEl.className = "gm-panel-stats";
  _statsEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _statsEl.style.fontSize = "11px";
  _statsEl.style.whiteSpace = "pre-wrap";
  _statsEl.style.background = "#020617";
  _statsEl.style.borderRadius = "6px";
  _statsEl.style.border = "1px solid #1f2937";
  _statsEl.style.padding = "6px 8px";
  body.appendChild(_statsEl);

  const traitsLabel = document.createElement("div");
  traitsLabel.textContent = "Traits";
  traitsLabel.style.fontSize = "11px";
  traitsLabel.style.textTransform = "uppercase";
  traitsLabel.style.letterSpacing = "0.05em";
  traitsLabel.style.color = "#9ca3af";
  traitsLabel.style.marginTop = "4px";
  body.appendChild(traitsLabel);

  _traitsEl = document.createElement("div");
  _traitsEl.className = "gm-panel-traits";
  _traitsEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _traitsEl.style.fontSize = "11px";
  _traitsEl.style.whiteSpace = "pre-wrap";
  _traitsEl.style.background = "#020617";
  _traitsEl.style.borderRadius = "6px";
  _traitsEl.style.border = "1px solid #1f2937";
  _traitsEl.style.padding = "6px 8px";
  body.appendChild(_traitsEl);

  const mechLabel = document.createElement("div");
  mechLabel.textContent = "Mechanics";
  mechLabel.style.fontSize = "11px";
  mechLabel.style.textTransform = "uppercase";
  mechLabel.style.letterSpacing = "0.05em";
  mechLabel.style.color = "#9ca3af";
  mechLabel.style.marginTop = "4px";
  body.appendChild(mechLabel);

  _mechEl = document.createElement("div");
  _mechEl.className = "gm-panel-mechanics";
  _mechEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _mechEl.style.fontSize = "11px";
  _mechEl.style.whiteSpace = "pre-wrap";
  _mechEl.style.background = "#020617";
  _mechEl.style.borderRadius = "6px";
  _mechEl.style.border = "1px solid #1f2937";
  _mechEl.style.padding = "6px 8px";
  body.appendChild(_mechEl);

  const eventsLabel = document.createElement("div");
  eventsLabel.textContent = "Recent events";
  eventsLabel.style.fontSize = "11px";
  eventsLabel.style.textTransform = "uppercase";
  eventsLabel.style.letterSpacing = "0.05em";
  eventsLabel.style.color = "#9ca3af";
  eventsLabel.style.marginTop = "4px";
  body.appendChild(eventsLabel);

  _eventsEl = document.createElement("div");
  _eventsEl.className = "gm-panel-events";
  _eventsEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _eventsEl.style.fontSize = "11px";
  _eventsEl.style.whiteSpace = "pre-wrap";
  _eventsEl.style.background = "#020617";
  _eventsEl.style.borderRadius = "6px";
  _eventsEl.style.border = "1px solid #1f2937";
  _eventsEl.style.padding = "6px 8px";
  _eventsEl.style.maxHeight = "160px";
  _eventsEl.style.overflowY = "auto";
  body.appendChild(_eventsEl);

  root.appendChild(header);
  root.appendChild(body);
  document.body.appendChild(root);

  installDrag(header, root);

  _panelEl = root;
  return root;
}

function renderSnapshot(gm) {
  if (!_summaryEl || !_statsEl || !_eventsEl) return;

  if (!gm) {
    _summaryEl.textContent = "GM state not available (GMRuntime or GameAPI missing).";
    _statsEl.textContent = "";
    if (_traitsEl) _traitsEl.textContent = "";
    if (_mechEl) _mechEl.textContent = "";
    _eventsEl.textContent = "No GM events (GMRuntime not available).";
    return;
  }

  const stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
  const totalTurns = typeof stats.totalTurns === "number" ? stats.totalTurns : 0;
  const mode = typeof gm.lastMode === "string" && gm.lastMode ? gm.lastMode : "world";
  let boredomLevel = gm.boredom && typeof gm.boredom.level === "number" ? gm.boredom.level : 0;
  if (!Number.isFinite(boredomLevel)) boredomLevel = 0;
  if (boredomLevel < 0) boredomLevel = 0;
  if (boredomLevel > 1) boredomLevel = 1;
  const boredomPct = Math.round(boredomLevel * 100);
  const enabled = gm.enabled !== false;

  _summaryEl.textContent = `Mode: ${mode} | Turns: ${totalTurns} | Boredom: ${boredomPct}% | Enabled: ${enabled ? "On" : "Off"}`;

  const lines = [];
  lines.push(`Total turns: ${totalTurns}`);
  const encounterStarts = typeof stats.encounterStarts === "number" ? stats.encounterStarts : 0;
  const encounterCompletions = typeof stats.encounterCompletions === "number" ? stats.encounterCompletions : 0;
  lines.push(`Encounters: starts=${encounterStarts} | completions=${encounterCompletions}`);

  const modeTurns = stats.modeTurns && typeof stats.modeTurns === "object" ? stats.modeTurns : {};
  const mtEntries = Object.keys(modeTurns).map((k) => [k, modeTurns[k] | 0]);
  if (mtEntries.length) {
    mtEntries.sort((a, b) => b[1] - a[1]);
    lines.push("");
    lines.push("Mode turns (top 4):");
    mtEntries.slice(0, 4).forEach(([key, val]) => {
      lines.push(`  - ${key}: ${val}`);
    });
  }

  const modeEntries = stats.modeEntries && typeof stats.modeEntries === "object" ? stats.modeEntries : {};
  const meEntries = Object.keys(modeEntries).map((k) => [k, modeEntries[k] | 0]);
  if (meEntries.length) {
    meEntries.sort((a, b) => b[1] - a[1]);
    lines.push("");
    lines.push("Mode entries:");
    meEntries.forEach(([key, val]) => {
      lines.push(`  - ${key}: ${val}`);
    });
  }

  _statsEl.textContent = lines.join("\n");

  if (_traitsEl) {
    const t = gm.traits || {};
    const linesT = [];
    const dbg = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
    const currentTurn = typeof dbg.lastTickTurn === "number" ? (dbg.lastTickTurn | 0) : null;
    const TRAIT_MIN_SAMPLES = 3; // minimum relevant events (kills/quests) before we treat this as an active trait
    const TRAIT_MIN_SCORE = 0.4; // how strongly skewed pos vs neg must be
    const TRAIT_FORGET_TURNS = 300; // after this many turns without updates, trait is considered forgotten

    function pushTraitIfActive(key, label) {
      const tr = t[key];
      if (!tr) return;
      const seen = tr.seen | 0;
      const pos = tr.positive | 0;
      const neg = tr.negative | 0;
      const samples = pos + neg;
      let score = 0;
      if (samples > 0) {
        score = (pos - neg) / samples;
      }
      const lastTurn = tr.lastUpdatedTurn == null ? null : (tr.lastUpdatedTurn | 0);

      // Activation: enough evidence + clear bias
      const hasEnoughSamples = seen >= TRAIT_MIN_SAMPLES;
      const hasStrongBias = Math.abs(score) >= TRAIT_MIN_SCORE;

      // Memory: if we know current turn and last update, drop the trait after a long gap
      let remembered = true;
      if (currentTurn != null && lastTurn != null) {
        const delta = currentTurn - lastTurn;
        if (delta > TRAIT_FORGET_TURNS) remembered = false;
      }

      const isActive = hasEnoughSamples && hasStrongBias && remembered;
      if (!isActive) return;

      const scoreStr = score.toFixed(2);
      linesT.push(`${label}: seen=${seen} pos=${pos} neg=${neg} score=${scoreStr}`);
    }

    pushTraitIfActive("trollSlayer", "Troll Slayer");
    pushTraitIfActive("townProtector", "Town Protector");
    pushTraitIfActive("caravanAlly", "Caravan Ally");

    if (!linesT.length) {
      _traitsEl.textContent = "No active traits yet.";
    } else {
      _traitsEl.textContent = linesT.join("\n");
    }
  }

  if (_mechEl) {
    const m = gm.mechanics || {};
    const linesM = [];
    function pushMech(key, label) {
      const mc = m[key];
      if (!mc) {
        linesM.push(`${label}: (no data)`);
        return;
      }
      const seen = mc.seen | 0;
      const tried = mc.tried | 0;
      const success = mc.success | 0;
      const failure = mc.failure | 0;
      const dismiss = mc.dismiss | 0;
      let status = "unseen";
      if (seen > 0 && tried === 0) status = "seen";
      else if (tried > 0) status = "tried";
      const succRate = success + failure > 0 ? success / (success + failure) : 0;
      const succStr = succRate.toFixed(2);
      linesM.push(`${label}: status=${status} seen=${seen} tried=${tried} suc=${success} fail=${failure} dis=${dismiss} rate=${succStr}`);
    }
    pushMech("fishing", "Fishing");
    pushMech("lockpicking", "Lockpicking");
    pushMech("questBoard", "Quest Board");
    pushMech("followers", "Followers");
    _mechEl.textContent = linesM.join("\n");
  }

  const evBuf = gm.debug && Array.isArray(gm.debug.lastEvents) ? gm.debug.lastEvents : [];
  if (!_eventsEl) return;
  if (!evBuf.length) {
    _eventsEl.textContent = "No events observed yet.";
  } else {
    const max = Math.min(evBuf.length, MAX_EVENTS);
    const evLines = [];
    for (let i = 0; i < max; i++) {
      const e = evBuf[i];
      if (!e) continue;
      const t = typeof e.turn === "number" ? (e.turn | 0) : "?";
      const type = e.type || "?";
      const scope = e.scope || "?";
      evLines.push(`[T ${t}] ${type} @ ${scope}`);
    }
    _eventsEl.textContent = evLines.join("\n");
  }
}

function startAutoRefresh() {
  try {
    if (typeof window === "undefined") return;
    if (_refreshTimer != null) return;
    _refreshTimer = window.setInterval(() => {
      try {
        if (_open) refresh();
      } catch (_) {}
    }, 1000);
  } catch (_) {}
}

function stopAutoRefresh() {
  try {
    if (typeof window === "undefined") return;
    if (_refreshTimer != null) {
      window.clearInterval(_refreshTimer);
      _refreshTimer = null;
    }
  } catch (_) {}
}

export function init(UI) {
  const el = ensurePanel();
  if (el) el.hidden = true;
}

export function refresh() {
  const el = ensurePanel();
  if (!el) return;
  try {
    const gm = getGMState();
    renderSnapshot(gm);
  } catch (_) {}
}

export function show() {
  const el = ensurePanel();
  if (!el) return;
  el.hidden = false;
  _open = true;
  refresh();
  startAutoRefresh();
}

export function hide() {
  if (!_panelEl) return;
  _panelEl.hidden = true;
  _open = false;
  stopAutoRefresh();
}

export function isOpen() {
  return !!(_panelEl && !_panelEl.hidden);
}

attachGlobal("GMPanel", { init, show, hide, isOpen, refresh });
