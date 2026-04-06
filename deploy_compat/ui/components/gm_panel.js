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
 * - Primarily a read-only view onto GMRuntime.getState(ctx) via GameAPI.getCtx(),
 *   with a small toggle for gm.enabled.
 */

import { attachGlobal } from "/utils/global.js";
import { getMechanicKnowledge } from "/core/gm/runtime/state_ensure.js";

let _panelEl = null;
let _summaryEl = null;
let _statsEl = null;
let _orchestratorEl = null;
let _questsEl = null;
let _traitsEl = null;
let _moodEl = null;
let _mechEl = null;
let _intentsEl = null;
let _eventsEl = null;
let _rawJsonEl = null;
let _toggleBtn = null;
let _copyBtn = null;
let _resetBtn = null;
let _clearBtn = null;
let _traitsFilterBtn = null;
let _mechFilterBtn = null;
let _open = false;
let _refreshTimer = null;
let _panelPrefs = null;
const _sectionRegistry = Object.create(null);

const MAX_EVENTS = 20;
const GM_PANEL_PREFS_KEY = "GM_PANEL_PREFS_V1";
const DEFAULT_SECTION_PREFS = Object.freeze({
  mood: true,
  orchestrator: true,
  quests: true,
  stats: true,
  traits: true,
  mechanics: true,
  intents: true,
  events: true,
  raw: false,
});

function cloneDefaultPanelPrefs() {
  return {
    sections: Object.assign({}, DEFAULT_SECTION_PREFS),
    showAllTraits: false,
    showAllMechanics: false,
  };
}

function normalizePanelPrefs(raw) {
  const next = cloneDefaultPanelPrefs();
  const sections = raw && raw.sections && typeof raw.sections === "object" ? raw.sections : null;
  const keys = Object.keys(DEFAULT_SECTION_PREFS);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (sections && Object.prototype.hasOwnProperty.call(sections, key)) {
      next.sections[key] = sections[key] !== false;
    }
  }
  next.showAllTraits = !!(raw && raw.showAllTraits === true);
  next.showAllMechanics = !!(raw && raw.showAllMechanics === true);
  return next;
}

function getPanelPrefs() {
  if (_panelPrefs) return _panelPrefs;
  let parsed = null;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(GM_PANEL_PREFS_KEY);
      if (raw) parsed = JSON.parse(raw);
    }
  } catch (_) {}
  _panelPrefs = normalizePanelPrefs(parsed);
  return _panelPrefs;
}

function savePanelPrefs() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const prefs = getPanelPrefs();
    window.localStorage.setItem(GM_PANEL_PREFS_KEY, JSON.stringify(prefs));
  } catch (_) {}
}

function clearPanelPrefs() {
  _panelPrefs = cloneDefaultPanelPrefs();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(GM_PANEL_PREFS_KEY);
    }
  } catch (_) {}
}

function isPanelFilterEnabled(key) {
  const prefs = getPanelPrefs();
  return prefs[key] === true;
}

function setPanelFilterEnabled(key, enabled, persist = true) {
  const prefs = getPanelPrefs();
  prefs[key] = enabled === true;
  if (persist) savePanelPrefs();
}

function updateFilterToggleLabel(btn, showAll) {
  if (!btn) return;
  btn.textContent = showAll ? "Show: all" : "Show: active only";
  btn.setAttribute("aria-pressed", showAll ? "true" : "false");
}

function createFilterControls(id, prefKey) {
  const row = document.createElement("div");
  row.className = "gm-panel-filter-row";

  const label = document.createElement("span");
  label.className = "gm-panel-filter-label";
  label.textContent = "View";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gm-panel-chip gm-panel-filter-toggle";
  btn.dataset.gmFilterToggle = id;
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const next = !isPanelFilterEnabled(prefKey);
    setPanelFilterEnabled(prefKey, next, true);
    updateFilterToggleLabel(btn, next);
    refresh();
  });
  updateFilterToggleLabel(btn, isPanelFilterEnabled(prefKey));

  row.appendChild(label);
  row.appendChild(btn);
  return { row, btn };
}

function isSectionExpanded(id) {
  const prefs = getPanelPrefs();
  return prefs.sections[id] !== false;
}

function setSectionExpanded(id, expanded, persist = true) {
  const prefs = getPanelPrefs();
  prefs.sections[id] = expanded !== false;
  const entry = _sectionRegistry[id];
  if (entry) {
    const isOpen = prefs.sections[id] !== false;
    if (entry.body) entry.body.hidden = !isOpen;
    if (entry.toggle) {
      entry.toggle.textContent = `${isOpen ? "▼" : "▶"} ${entry.title}`;
      entry.toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    if (entry.container) entry.container.dataset.collapsed = isOpen ? "false" : "true";
  }
  if (persist) savePanelPrefs();
}

function toggleSection(id) {
  const nextExpanded = !isSectionExpanded(id);
  setSectionExpanded(id, nextExpanded, true);
  if (!nextExpanded && id === "raw" && _rawJsonEl) {
    _rawJsonEl.textContent = "";
  }
  if (_open && nextExpanded) refresh();
}

function createPanelBlock(className) {
  const el = document.createElement("div");
  el.className = `gm-panel-block ${className}`;
  return el;
}

function createSection(id, title, contentEl, opts = {}) {
  const section = document.createElement("section");
  section.className = "gm-panel-section";
  section.dataset.gmSection = id;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "gm-panel-section-toggle";
  toggle.dataset.gmSectionToggle = id;
  toggle.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleSection(id);
  });

  contentEl.dataset.gmSectionBody = id;
  if (opts.scrollable === true) {
    contentEl.classList.add("gm-panel-block-scrollable");
    if (opts.maxHeight) contentEl.style.maxHeight = opts.maxHeight;
  }

  section.appendChild(toggle);
  if (opts.controlEl) section.appendChild(opts.controlEl);
  section.appendChild(contentEl);
  _sectionRegistry[id] = { container: section, toggle, body: contentEl, title };
  setSectionExpanded(id, isSectionExpanded(id), false);
  return section;
}

function formatValenceBar(val) {
  const totalSlots = 8;
  const half = totalSlots / 2;
  let v = typeof val === "number" && Number.isFinite(val) ? val : 0;
  if (v < -1) v = -1;
  else if (v > 1) v = 1;

  let negFilled = 0;
  let posFilled = 0;
  if (v < 0) {
    const magnitude = -v;
    negFilled = Math.round(magnitude * half);
  } else if (v > 0) {
    const magnitude = v;
    posFilled = Math.round(magnitude * half);
  }

  if (negFilled < 0) negFilled = 0;
  if (negFilled > half) negFilled = half;
  if (posFilled < 0) posFilled = 0;
  if (posFilled > half) posFilled = half;

  let left = "";
  for (let i = 0; i < half; i++) {
    left += i < negFilled ? "-" : ".";
  }

  let right = "";
  for (let i = 0; i < half; i++) {
    right += i < posFilled ? "+" : ".";
  }

  return `[${left}${right}]`;
}

function formatArousalBar(val) {
  const totalSlots = 10;
  let a = typeof val === "number" && Number.isFinite(val) ? val : 0;
  if (a < 0) a = 0;
  else if (a > 1) a = 1;

  const filled = Math.round(a * totalSlots);
  let bar = "";
  for (let i = 0; i < totalSlots; i++) {
    bar += i < filled ? "+" : "-";
  }
  return `[${bar}]`;
}

function formatIntentDebugExtras(intent) {
  if (!intent || typeof intent !== "object") return "";

  const parts = [];

  const channel = typeof intent.channel === "string" ? intent.channel.trim() : "";
  if (channel) parts.push(`ch=${channel}`);

  const reasonRaw = intent.reason;
  const reason =
    typeof reasonRaw === "string"
      ? reasonRaw.trim()
      : typeof reasonRaw === "number" || typeof reasonRaw === "boolean"
      ? String(reasonRaw)
      : "";
  if (reason) parts.push(`why=${reason}`);

  return parts.length ? " " + parts.join(" ") : "";
}

function getBottleMapFishingConfigForPanel() {
  const DEFAULTS = { S0: 60, Smax: 180, boredomMin: 0.2, boredomMultMax: 3.0, cooldownTurns: 400 };
  try {
    const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config)
      ? window.GameData.config
      : null;

    const f = cfg && cfg.gm && cfg.gm.bottleMap && cfg.gm.bottleMap.fishing && typeof cfg.gm.bottleMap.fishing === "object"
      ? cfg.gm.bottleMap.fishing
      : null;

    let S0 = f && typeof f.S0 === "number" && Number.isFinite(f.S0) ? (f.S0 | 0) : DEFAULTS.S0;
    let Smax = f && typeof f.Smax === "number" && Number.isFinite(f.Smax) ? (f.Smax | 0) : DEFAULTS.Smax;
    let boredomMin = f && typeof f.boredomMin === "number" && Number.isFinite(f.boredomMin) ? f.boredomMin : DEFAULTS.boredomMin;
    let boredomMultMax = f && typeof f.boredomMultMax === "number" && Number.isFinite(f.boredomMultMax) ? f.boredomMultMax : DEFAULTS.boredomMultMax;
    let cooldownTurns = f && typeof f.cooldownTurns === "number" && Number.isFinite(f.cooldownTurns) ? (f.cooldownTurns | 0) : DEFAULTS.cooldownTurns;

    if (S0 < 0) S0 = 0;
    if (Smax < S0) Smax = S0;
    if (boredomMin < 0) boredomMin = 0;
    if (boredomMin > 1) boredomMin = 1;
    if (boredomMultMax < 1) boredomMultMax = 1;
    if (cooldownTurns < 0) cooldownTurns = 0;

    return { S0, Smax, boredomMin, boredomMultMax, cooldownTurns };
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

function deriveBottleMapFishingChance(eligibleSuccesses, boredom, cfg) {
  const baseChance = 0.002;
  const maxChance = 0.10;

  let b = typeof boredom === "number" && Number.isFinite(boredom) ? boredom : 0;
  if (b < 0) b = 0;
  if (b > 1) b = 1;

  const S0 = (cfg && typeof cfg.S0 === "number") ? (cfg.S0 | 0) : 0;
  const Smax = (cfg && typeof cfg.Smax === "number") ? (cfg.Smax | 0) : 0;
  const boredomMin = (cfg && typeof cfg.boredomMin === "number" && Number.isFinite(cfg.boredomMin)) ? cfg.boredomMin : 0;
  const boredomMultMax = (cfg && typeof cfg.boredomMultMax === "number" && Number.isFinite(cfg.boredomMultMax)) ? cfg.boredomMultMax : 1;

  const s = eligibleSuccesses | 0;
  const eligible = b >= boredomMin;

  if (!eligible || s < S0) {
    return { eligible, s, boredom: b, chance: 0, forced: false };
  }

  const denom = Math.max(1, Smax - S0);
  const t = Math.max(0, Math.min(1, (s - S0) / denom));

  let chance = baseChance + t * (maxChance - baseChance);
  chance *= (1 + b * (boredomMultMax - 1));

  const forced = s >= Smax;
  if (forced) chance = 1;

  return { eligible, s, boredom: b, chance, forced };
}

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

function toggleGMEnabled() {
  try {
    if (typeof window === "undefined") return;
    const GA = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    if (!GA || !GM || typeof GA.getCtx !== "function" || typeof GM.getState !== "function") return;
    const ctx = GA.getCtx();
    if (!ctx) return;
    const gm = GM.getState(ctx);
    if (!gm || typeof gm !== "object") return;
    if (gm.enabled === false) gm.enabled = true;
    else gm.enabled = false;
    refresh();
  } catch (_) {}
}

async function copyGMStateToClipboard() {
  try {
    if (typeof window === "undefined") return false;
    const GA = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    if (!GA || !GM || typeof GA.getCtx !== "function" || typeof GM.exportState !== "function") return false;
    const ctx = GA.getCtx();
    if (!ctx) return false;
    const snap = GM.exportState(ctx);
    if (!snap) return false;
    const text = JSON.stringify(snap, null, 2);

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      try { ctx.log && ctx.log("[GM] State copied to clipboard.", "info"); } catch (_) {}
      return true;
    }

    // Fallback: prompt so user can copy manually
    try { window.prompt("Copy GM state:", text); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function resetGMState() {
  try {
    if (typeof window === "undefined") return false;
    const GA = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    if (!GA || !GM || typeof GA.getCtx !== "function" || typeof GM.reset !== "function") return false;
    const ctx = GA.getCtx();
    if (!ctx) return false;
    GM.reset(ctx);
    try { ctx.log && ctx.log("[GM] Reset GM state.", "notice"); } catch (_) {}
    refresh();
    return true;
  } catch (_) {
    return false;
  }
}

function clearGMPersistedState() {
  try {
    if (typeof window === "undefined") return false;
    const GA = window.GameAPI || null;
    const GM = window.GMRuntime || null;
    if (!GA || !GM || typeof GA.getCtx !== "function" || typeof GM.clearPersisted !== "function") return false;
    const ctx = GA.getCtx();
    if (!ctx) return false;
    GM.clearPersisted(ctx);
    clearPanelPrefs();
    const ids = Object.keys(DEFAULT_SECTION_PREFS);
    for (let i = 0; i < ids.length; i++) {
      setSectionExpanded(ids[i], DEFAULT_SECTION_PREFS[ids[i]] !== false, false);
    }
    try { ctx.log && ctx.log("[GM] Cleared persisted GM state (GM_STATE_V1) and GM panel prefs (GM_PANEL_PREFS_V1).", "notice"); } catch (_) {}
    refresh();
    return true;
  } catch (_) {
    return false;
  }
}

function installDrag(headerEl, panelEl) {
  if (!headerEl || !panelEl || typeof window === "undefined") return;

  headerEl.addEventListener("mousedown", (ev) => {
    try {
      if (ev.button !== 0) return;
      const target = ev.target;
      if (target && typeof target.closest === "function" && (target.closest(".gm-panel-close") || target.closest(".gm-panel-toggle"))) return;

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
  getPanelPrefs();

  const root = document.createElement("div");
  root.id = "gm-panel";
  root.className = "gm-panel";
  root.style.position = "fixed";
  root.style.top = "80px";
  root.style.right = "24px";

  const header = document.createElement("div");
  header.className = "gm-panel-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "gm-panel-title-wrap";

  const title = document.createElement("span");
  title.className = "gm-panel-title";
  title.textContent = "Game Master";

  const dragHint = document.createElement("span");
  dragHint.className = "gm-panel-drag-hint";
  dragHint.textContent = "(drag)";

  titleWrap.appendChild(title);
  titleWrap.appendChild(dragHint);

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "gm-panel-actions";

  _toggleBtn = document.createElement("button");
  _toggleBtn.type = "button";
  _toggleBtn.className = "gm-panel-chip gm-panel-toggle";
  _toggleBtn.textContent = "Toggle GM";
  _toggleBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleGMEnabled();
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "gm-panel-close";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    hide();
  });

  function styleSmallBtn(btn) {
    btn.classList.add("gm-panel-chip");
  }

  _copyBtn = document.createElement("button");
  _copyBtn.type = "button";
  _copyBtn.className = "gm-panel-copy";
  _copyBtn.textContent = "Copy";
  styleSmallBtn(_copyBtn);
  _copyBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    copyGMStateToClipboard();
  });

  _resetBtn = document.createElement("button");
  _resetBtn.type = "button";
  _resetBtn.className = "gm-panel-reset";
  _resetBtn.textContent = "Reset";
  styleSmallBtn(_resetBtn);
  _resetBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    resetGMState();
  });

  _clearBtn = document.createElement("button");
  _clearBtn.type = "button";
  _clearBtn.className = "gm-panel-clear";
  _clearBtn.textContent = "Clear LS";
  styleSmallBtn(_clearBtn);
  _clearBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    clearGMPersistedState();
  });

  actionsWrap.appendChild(_copyBtn);
  actionsWrap.appendChild(_resetBtn);
  actionsWrap.appendChild(_clearBtn);
  actionsWrap.appendChild(_toggleBtn);
  actionsWrap.appendChild(closeBtn);

  header.appendChild(titleWrap);
  header.appendChild(actionsWrap);

  const body = document.createElement("div");
  body.className = "gm-panel-body";

  _summaryEl = document.createElement("div");
  _summaryEl.className = "gm-panel-summary";
  body.appendChild(_summaryEl);

  _moodEl = createPanelBlock("gm-panel-mood");
  body.appendChild(createSection("mood", "Mood", _moodEl));

  _orchestratorEl = createPanelBlock("gm-panel-orchestrator");
  body.appendChild(createSection("orchestrator", "Next action / cooldowns", _orchestratorEl));

  _questsEl = createPanelBlock("gm-panel-quests");
  body.appendChild(createSection("quests", "Active quests", _questsEl));

  _statsEl = createPanelBlock("gm-panel-stats");
  body.appendChild(createSection("stats", "Stats", _statsEl));

  const traitsControls = createFilterControls("traits", "showAllTraits");
  _traitsFilterBtn = traitsControls.btn;
  _traitsEl = createPanelBlock("gm-panel-traits");
  body.appendChild(createSection("traits", "Traits", _traitsEl, { controlEl: traitsControls.row }));

  const mechanicsControls = createFilterControls("mechanics", "showAllMechanics");
  _mechFilterBtn = mechanicsControls.btn;
  _mechEl = createPanelBlock("gm-panel-mechanics");
  body.appendChild(createSection("mechanics", "Mechanics", _mechEl, { controlEl: mechanicsControls.row }));

  _intentsEl = createPanelBlock("gm-panel-intents");
  body.appendChild(createSection("intents", "GM intents", _intentsEl, { scrollable: true, maxHeight: "160px" }));

  _eventsEl = createPanelBlock("gm-panel-events");
  body.appendChild(createSection("events", "Recent events", _eventsEl, { scrollable: true, maxHeight: "160px" }));

  _rawJsonEl = createPanelBlock("gm-panel-json");
  body.appendChild(createSection("raw", "Raw GM JSON", _rawJsonEl, { scrollable: true, maxHeight: "240px" }));

  root.appendChild(header);
  root.appendChild(body);
  document.body.appendChild(root);

  installDrag(header, root);

  _panelEl = root;
  return root;
}

function renderSnapshot(gm) {
  if (!_summaryEl || !_statsEl || !_eventsEl) return;

  updateFilterToggleLabel(_traitsFilterBtn, isPanelFilterEnabled("showAllTraits"));
  updateFilterToggleLabel(_mechFilterBtn, isPanelFilterEnabled("showAllMechanics"));

  if (!gm) {
    _summaryEl.textContent = "GM state not available (GMRuntime or GameAPI missing).";
    _statsEl.textContent = "";
    if (_orchestratorEl) _orchestratorEl.textContent = "";
    if (_questsEl) _questsEl.textContent = "";
    if (_traitsEl) _traitsEl.textContent = "";
    if (_moodEl) {
      _moodEl.textContent = "mood: (no data)\nvalence:  [........]\narousal:  [----------]";
    }
    if (_mechEl) _mechEl.textContent = "";
    if (_intentsEl) _intentsEl.textContent = "GM intents (latest first; 'none' = decision)\n  No GM intents yet.";
    _eventsEl.textContent = "No GM events (GMRuntime not available).";
    if (_rawJsonEl && isSectionExpanded("raw")) _rawJsonEl.textContent = "GM state not available.";
    if (_toggleBtn) {
      _toggleBtn.textContent = "GM N/A";
      _toggleBtn.disabled = true;
    }
    return;
  }

  const debug = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
  const stats = gm.stats && typeof gm.stats === "object" ? gm.stats : {};
  const totalTurns = typeof stats.totalTurns === "number" ? stats.totalTurns : 0;
  const mode = typeof gm.lastMode === "string" && gm.lastMode ? gm.lastMode : "world";
  let boredomLevel = gm.boredom && typeof gm.boredom.level === "number" ? gm.boredom.level : 0;
  if (!Number.isFinite(boredomLevel)) boredomLevel = 0;
  if (boredomLevel < 0) boredomLevel = 0;
  if (boredomLevel > 1) boredomLevel = 1;
  const boredomPct = Math.round(boredomLevel * 100);
  const enabled = gm.enabled !== false;
  const threads = gm.threads && typeof gm.threads === "object" ? gm.threads : {};
  const bottleMap = threads.bottleMap && typeof threads.bottleMap === "object" ? threads.bottleMap : null;
  const surveyCache = threads.surveyCache && typeof threads.surveyCache === "object" ? threads.surveyCache : null;
  const activeQuestCount = (bottleMap && bottleMap.active === true ? 1 : 0) + (surveyCache && surveyCache.active && typeof surveyCache.active === "object" ? 1 : 0);

  if (_toggleBtn) {
    _toggleBtn.textContent = enabled ? "Disable GM" : "Enable GM";
    _toggleBtn.disabled = false;
  }

  const pacing = gm.pacing && typeof gm.pacing === "object" ? gm.pacing : {};
  const nextEligibleTurn = (typeof pacing.nextEligibleTurn === "number" && Number.isFinite(pacing.nextEligibleTurn)) ? (pacing.nextEligibleTurn | 0) : 0;
  const lastInterventionTurn = (typeof pacing.lastInterventionTurn === "number" && Number.isFinite(pacing.lastInterventionTurn)) ? (pacing.lastInterventionTurn | 0) : -9999;

  _summaryEl.textContent = `Mode: ${mode} | Turns: ${totalTurns} | Boredom: ${boredomPct}% | Quests: ${activeQuestCount} | NextElig: T=${nextEligibleTurn} | LastInt: T=${lastInterventionTurn} | Enabled: ${enabled ? "On" : "Off"}`;

  const lines = [];
  lines.push(`Total turns: ${totalTurns}`);
  const encounterStarts = typeof stats.encounterStarts === "number" ? stats.encounterStarts : 0;
  const encounterCompletions = typeof stats.encounterCompletions === "number" ? stats.encounterCompletions : 0;
  lines.push(`Encounters: starts=${encounterStarts} | completions=${encounterCompletions}`);

  // Mechanics (high-level summary): show outcome-attempt counts (success+failure).
  const mech = gm.mechanics && typeof gm.mechanics === "object" ? gm.mechanics : {};
  const mechAttempts = (key) => {
    const m = mech[key];
    if (!m || typeof m !== "object") return 0;
    const s = m.success | 0;
    const f = m.failure | 0;
    return (s + f) | 0;
  };
  lines.push(
    `Mechanics attempts: fish=${mechAttempts("fishing")} lock=${mechAttempts("lockpicking")} quest=${mechAttempts("questBoard")} foll=${mechAttempts("followers")}`
  );

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

  // Guard Fine faction event slot status (read-only view from gm.storyFlags)
  const sf = gm.storyFlags && typeof gm.storyFlags === "object" ? gm.storyFlags : {};
  const fe = sf.factionEvents && typeof sf.factionEvents === "object" ? sf.factionEvents : {};
  const slot = fe.guardFine && typeof fe.guardFine === "object" ? fe.guardFine : null;

  let guardFineLine = "Guard Fine: none";
  if (slot) {
    const status = typeof slot.status === "string" ? slot.status : "none";
    const earliest = typeof slot.earliestTurn === "number" ? (slot.earliestTurn | 0) : null;
    const latest = typeof slot.latestTurn === "number" ? (slot.latestTurn | 0) : null;

    if (status === "scheduled") {
      const t = earliest != null ? earliest : "?";
      guardFineLine = "Guard Fine: scheduled @ T=" + t;
    } else if (status === "consumed") {
      const t = latest != null ? latest : "?";
      guardFineLine = "Guard Fine: consumed @ T=" + t;
    } else if (status !== "none") {
      guardFineLine = "Guard Fine: " + status;
    }
  }

  lines.push("");
  lines.push(guardFineLine);

  _statsEl.textContent = lines.join("\n");

  if (_orchestratorEl) {
    const linesOrchestrator = [];
    linesOrchestrator.push(`boredom: ${boredomLevel.toFixed(2)}`);

    const p = gm.pacing && typeof gm.pacing === "object" ? gm.pacing : {};
    const pNext = (typeof p.nextEligibleTurn === "number" && Number.isFinite(p.nextEligibleTurn)) ? (p.nextEligibleTurn | 0) : 0;
    const pLast = (typeof p.lastInterventionTurn === "number" && Number.isFinite(p.lastInterventionTurn)) ? (p.lastInterventionTurn | 0) : -9999;
    const pCd = (typeof p.lastCooldownTurns === "number" && Number.isFinite(p.lastCooldownTurns)) ? (p.lastCooldownTurns | 0) : 0;
    linesOrchestrator.push(`pacing: nextEligibleTurn=${pNext} lastInterventionTurn=${pLast} lastCooldownTurns=${pCd}`);

    // Phase 6-style GM stream visibility: RNG + scheduler.
    const rng = gm.rng && typeof gm.rng === "object" ? gm.rng : null;
    if (!rng) {
      linesOrchestrator.push("gm.rng: (no data)");
    } else {
      const algo = (typeof rng.algo === "string" && rng.algo) ? rng.algo : "?";
      const calls = (typeof rng.calls === "number" && Number.isFinite(rng.calls)) ? (rng.calls | 0) : 0;
      const rawState = rng.state;
      const state = (typeof rawState === "number" && Number.isFinite(rawState)) ? (rawState >>> 0) : null;
      const stateHex = state == null ? "-" : "0x" + state.toString(16).padStart(8, "0");
      linesOrchestrator.push(`gm.rng: algo=${algo} state=${stateHex} calls=${calls}`);
    }

    const sched = gm.scheduler && typeof gm.scheduler === "object" ? gm.scheduler : null;
    if (!sched) {
      linesOrchestrator.push("gm.scheduler: (no data)");
    } else {
      const lastAutoTurn = (typeof sched.lastAutoTurn === "number" && Number.isFinite(sched.lastAutoTurn)) ? (sched.lastAutoTurn | 0) : -9999;
      const rawLastAction = (typeof gm.lastActionTurn === "number" && Number.isFinite(gm.lastActionTurn))
        ? (gm.lastActionTurn | 0)
        : (typeof sched.lastActionTurn === "number" && Number.isFinite(sched.lastActionTurn))
        ? (sched.lastActionTurn | 0)
        : null;
      const q = Array.isArray(sched.queue) ? sched.queue : [];
      const h = Array.isArray(sched.history) ? sched.history : [];
      const nextId = (typeof sched.nextId === "number" && Number.isFinite(sched.nextId)) ? (sched.nextId | 0) : 0;
      const lastActionPart = rawLastAction == null ? "" : ` lastActionTurn=${rawLastAction}`;
      linesOrchestrator.push(`gm.scheduler: lastAutoTurn=${lastAutoTurn}${lastActionPart} queue=${q.length} history=${h.length} nextId=${nextId}`);

      const actions = (sched.actions && typeof sched.actions === "object") ? sched.actions : {};
      const showN = Math.min(q.length, 5);
      linesOrchestrator.push(`gm.scheduler.queue (next ${showN}${q.length > showN ? "/" + q.length : ""}):`);
      if (showN === 0) {
        linesOrchestrator.push("  (empty)");
      }
      for (let i = 0; i < showN; i++) {
        const id = (typeof q[i] === "string" && q[i]) ? q[i] : String(q[i] || "");
        const a = id && actions && typeof actions === "object" ? actions[id] : null;
        if (!a || typeof a !== "object") {
          linesOrchestrator.push(`  - ${id || "?"}: (missing action record)`);
          continue;
        }

        const kind = (typeof a.kind === "string" && a.kind) ? a.kind : "";
        const status = (typeof a.status === "string" && a.status) ? a.status : "?";
        const delivery = (typeof a.delivery === "string" && a.delivery) ? a.delivery : "?";
        const priority = (typeof a.priority === "number" && Number.isFinite(a.priority)) ? (a.priority | 0) : (a.priority | 0);
        const earliestTurn = (typeof a.earliestTurn === "number" && Number.isFinite(a.earliestTurn)) ? (a.earliestTurn | 0) : (a.earliestTurn | 0);
        const latestTurn = (typeof a.latestTurn === "number" && Number.isFinite(a.latestTurn)) ? (a.latestTurn | 0) : (a.latestTurn | 0);
        const eligible = earliestTurn <= totalTurns && (latestTurn <= 0 || totalTurns <= latestTurn) ? "ready" : "waiting";

        linesOrchestrator.push(
          `  - ${String(a.id || id || "?")}: kind=${kind || "-"} status=${status} delivery=${delivery} elig=${eligible} priority=${priority} earliestTurn=${earliestTurn} latestTurn=${latestTurn}`
        );
      }
    }

    const fishing = bottleMap && bottleMap.fishing && typeof bottleMap.fishing === "object" ? bottleMap.fishing : null;
    _orchestratorEl.textContent = linesOrchestrator.join("\n");

    if (_questsEl) {
      const linesQuests = [];
      if (activeQuestCount < 1) {
        linesQuests.push("No active quest threads.");
      } else {
        linesQuests.push(`Active quest threads: ${activeQuestCount}`);
      }

      linesQuests.push("");
      linesQuests.push("Bottle Map:");
      if (!bottleMap) {
        linesQuests.push("  (no data)");
      }
      const bmActive = !!(bottleMap && bottleMap.active === true);
      const bmStatus = bottleMap && typeof bottleMap.status === "string" && bottleMap.status ? bottleMap.status : "-";
      const bmInstanceId = bottleMap && bottleMap.instanceId != null ? String(bottleMap.instanceId) : "";

      const eligibleSuccesses = fishing ? (fishing.eligibleSuccesses | 0) : 0;
      const totalSuccesses = fishing ? (fishing.totalSuccesses | 0) : 0;
      const lastAwardTurn = fishing && typeof fishing.lastAwardTurn === "number" && Number.isFinite(fishing.lastAwardTurn) ? (fishing.lastAwardTurn | 0) : -9999;
      const awardCount = fishing ? (fishing.awardCount | 0) : 0;

      const cfgBM = getBottleMapFishingConfigForPanel();
      const derived = deriveBottleMapFishingChance(eligibleSuccesses, boredomLevel, cfgBM);
      const chancePct = Math.round((derived.chance * 100) * 1000) / 1000;
      const forcedStr = derived.forced ? " (FORCED)" : "";
      const iidPart = bmInstanceId ? ` instanceId=${bmInstanceId}` : "";

      linesQuests.push(`  thread: active=${bmActive} status=${bmStatus}${iidPart}`);
      linesQuests.push(`  counters: eligibleSuccesses=${eligibleSuccesses} totalSuccesses=${totalSuccesses} lastAwardTurn=${lastAwardTurn} awardCount=${awardCount}`);
      linesQuests.push(
        `  chance: eligible=${derived.eligible} boredom=${derived.boredom.toFixed(2)} s=${derived.s} chance=${chancePct}%${forcedStr}`
      );

      if (bottleMap) {
        const t = bottleMap.target && typeof bottleMap.target === "object" ? bottleMap.target : null;
        const tx = t && typeof t.absX === "number" ? (t.absX | 0) : null;
        const ty = t && typeof t.absY === "number" ? (t.absY | 0) : null;
        const createdTurn = bottleMap.createdTurn == null ? null : (bottleMap.createdTurn | 0);
        const claimedTurn = bottleMap.claimedTurn == null ? null : (bottleMap.claimedTurn | 0);
        const attempts = bottleMap.attempts == null ? 0 : (bottleMap.attempts | 0);
        const placementTries = bottleMap.placementTries == null ? null : (bottleMap.placementTries | 0);
        const failureReason = bottleMap.failureReason ? String(bottleMap.failureReason) : "";

        linesQuests.push(`  state: target=${tx == null ? "-" : tx},${ty == null ? "-" : ty} createdTurn=${createdTurn == null ? "-" : createdTurn} claimedTurn=${claimedTurn == null ? "-" : claimedTurn}`);
        linesQuests.push(`  progress: attempts=${attempts}${placementTries == null ? "" : ` placementTries=${placementTries}`}`);
        if (failureReason) linesQuests.push(`  failure: ${failureReason}`);
      }

      linesQuests.push("");
      linesQuests.push("Survey Cache:");
      if (!surveyCache) {
        linesQuests.push("  (no data)");
      } else {
        const scActive = surveyCache.active && typeof surveyCache.active === "object" ? surveyCache.active : null;
        const scInstanceId = scActive && scActive.instanceId != null ? String(scActive.instanceId) : "-";
        const scX = scActive && typeof scActive.absX === "number" && Number.isFinite(scActive.absX) ? (scActive.absX | 0) : null;
        const scY = scActive && typeof scActive.absY === "number" && Number.isFinite(scActive.absY) ? (scActive.absY | 0) : null;
        const scNextSpawnTurn = typeof surveyCache.nextSpawnTurn === "number" && Number.isFinite(surveyCache.nextSpawnTurn) ? (surveyCache.nextSpawnTurn | 0) : 0;
        const scClaimed = Array.isArray(surveyCache.claimedOrder) ? surveyCache.claimedOrder.length : 0;
        const scAttempts = surveyCache.attempts && typeof surveyCache.attempts === "object" ? Object.keys(surveyCache.attempts).length : 0;
        linesQuests.push(`  active=${!!scActive} instanceId=${scInstanceId} target=${scX == null ? "-" : scX},${scY == null ? "-" : scY}`);
        linesQuests.push(`  nextSpawnTurn=${scNextSpawnTurn} claimed=${scClaimed} attemptsTracked=${scAttempts}`);
      }

      _questsEl.textContent = linesQuests.join("\n");
    }
  }

  if (_traitsEl) {
    const t = gm.traits || {};
    const linesT = [];
    const showAllTraits = isPanelFilterEnabled("showAllTraits");
    const dbg = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
    const currentTurn = typeof dbg.lastTickTurn === "number" ? (dbg.lastTickTurn | 0) : null;
    const TRAIT_MIN_SAMPLES = 3; // minimum relevant events (kills/quests) before we treat this as an active trait
    const TRAIT_MIN_SCORE = 0.4; // how strongly skewed pos vs neg must be
    const TRAIT_FORGET_TURNS = 300; // after this many turns without updates, trait is considered forgotten

    const families = gm.families && typeof gm.families === "object" ? gm.families : {};
    const FAMILY_MIN_SEEN = 3; // minimum interactions with a family before we surface it
    const FAMILY_FORGET_TURNS = 300; // same forgetting window as named traits
    const FAMILY_MAX_ROWS = 6; // cap rows to keep panel compact

    function pushTraitRow(key, label) {
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
      const hasHistory = seen > 0 || pos > 0 || neg > 0 || lastTurn != null;
      if (!showAllTraits && !isActive) return;
      if (showAllTraits && !hasHistory) return;

      const scoreStr = score.toFixed(2);
      if (!showAllTraits) {
        linesT.push(`${label}: seen=${seen} pos=${pos} neg=${neg} score=${scoreStr}`);
        return;
      }

      const state = isActive ? "active" : remembered ? "inactive" : "forgotten";
      linesT.push(`${label}: state=${state} seen=${seen} pos=${pos} neg=${neg} score=${scoreStr}`);
    }

    pushTraitRow("trollSlayer", "Troll Slayer");
    pushTraitRow("townProtector", "Town Protector");
    pushTraitRow("caravanAlly", "Caravan Ally");

    // Dynamic family-based traits (e.g., Troll Slayer, Lizardman Ally, etc.)
    const famEntries = [];
    const famKeys = Object.keys(families);
    for (let i = 0; i < famKeys.length; i++) {
      const key = famKeys[i];
      const entry = families[key];
      if (!entry || typeof entry !== "object") continue;
      const seen = entry.seen | 0;
      const pos = entry.positive | 0;
      const neg = entry.negative | 0;
      const lastTurn = entry.lastUpdatedTurn == null ? null : (entry.lastUpdatedTurn | 0);
      let remembered = true;
      if (currentTurn != null && lastTurn != null) {
        const delta = currentTurn - lastTurn;
        if (delta > FAMILY_FORGET_TURNS) remembered = false;
      }

      const samples = pos + neg;
      let score = 0;
      if (samples > 0) {
        score = (pos - neg) / samples;
      }
      const isActive = seen >= FAMILY_MIN_SEEN && remembered;
      const hasHistory = seen > 0 || pos > 0 || neg > 0 || lastTurn != null;
      if (!showAllTraits && !isActive) continue;
      if (showAllTraits && !hasHistory) continue;
      famEntries.push({ key, seen, pos, neg, score, isActive, remembered });
    }

    if (famEntries.length) {
      famEntries.sort((a, b) => {
        if (b.seen !== a.seen) return b.seen - a.seen;
        const absA = Math.abs(a.score);
        const absB = Math.abs(b.score);
        if (absB !== absA) return absB - absA;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
      });

      const limited = famEntries.slice(0, FAMILY_MAX_ROWS);

      function formatFamilyName(key) {
        const base = String(key || "").trim();
        if (!base) return "Unknown";
        const cleaned = base.replace(/_/g, " ");
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      }

      for (let i = 0; i < limited.length; i++) {
        const f = limited[i];
        const famName = formatFamilyName(f.key);
        const role = f.score >= 0 ? "Slayer" : "Ally";
        const scoreStr = f.score.toFixed(2);
        if (!showAllTraits) {
          linesT.push(`${famName} ${role}: seen=${f.seen} pos=${f.pos} neg=${f.neg} score=${scoreStr}`);
          continue;
        }
        const state = f.isActive ? "active" : f.remembered ? "inactive" : "forgotten";
        linesT.push(`${famName} ${role}: state=${state} seen=${f.seen} pos=${f.pos} neg=${f.neg} score=${scoreStr}`);
      }
    }

    if (!linesT.length) {
      _traitsEl.textContent = showAllTraits ? "No trait history yet." : "No active traits yet.";
    } else {
      _traitsEl.textContent = linesT.join("\n");
    }
  }

  if (_moodEl) {
    const mood = gm.mood && typeof gm.mood === "object" ? gm.mood : null;
    const linesMood = [];
    if (!mood) {
      linesMood.push("mood: (no data)");
      linesMood.push("valence:  [........]");
      linesMood.push("arousal:  [----------]");
    } else {
      const primary = typeof mood.primary === "string" && mood.primary ? mood.primary : "neutral";
      const rawValence = typeof mood.valence === "number" && Number.isFinite(mood.valence) ? mood.valence : 0;
      const rawArousal = typeof mood.arousal === "number" && Number.isFinite(mood.arousal) ? mood.arousal : 0;
      const valenceStr = rawValence.toFixed(2);
      const arousalStr = rawArousal.toFixed(2);
      linesMood.push(`mood: ${primary} (val=${valenceStr}, ar=${arousalStr})`);
      linesMood.push(`valence:  ${formatValenceBar(rawValence)}`);
      linesMood.push(`arousal:  ${formatArousalBar(rawArousal)}`);
    }

    const lastIntent = debug.lastIntent && typeof debug.lastIntent === "object" ? debug.lastIntent : null;
    if (lastIntent) {
      let label = lastIntent.kind || "none";
      if (lastIntent.topic) label += `:${lastIntent.topic}`;
      if (lastIntent.target) label += `:${lastIntent.target}`;
      if (lastIntent.id) label += `:${lastIntent.id}`;
      const t = typeof lastIntent.turn === "number" ? (lastIntent.turn | 0) : "?";
      linesMood.push(`last intent: [T ${t}] ${label}${formatIntentDebugExtras(lastIntent)}`);
    } else {
      linesMood.push("last intent: (none)");
    }

    _moodEl.textContent = linesMood.join("\n");
  }

  if (_mechEl) {
    const m = gm.mechanics || {};
    const linesM = [];
    const showAllMechanics = isPanelFilterEnabled("showAllMechanics");

    const currentTurn = typeof debug.lastTickTurn === "number" ? (debug.lastTickTurn | 0) : 0;

    function turnStr(v) {
      if (typeof v !== "number" || !Number.isFinite(v)) return "-";
      const t = v | 0;
      if (t < 0) return "-";
      return String(t);
    }

    function pushMech(key, label) {
      const mc = m[key];
      if (!mc) {
        if (showAllMechanics) linesM.push(`${label}: (no data)`);
        return;
      }
      const seen = mc.seen | 0;
      const interactions = mc.tried | 0;
      const success = mc.success | 0;
      const failure = mc.failure | 0;
      const dismiss = mc.dismiss | 0;
      const attempts = (success + failure) | 0;

      let knowledge = "unknown";
      try {
        knowledge = getMechanicKnowledge(mc, currentTurn);
      } catch (_) {
        knowledge = "unknown";
      }

      const isActive = knowledge !== "unseen" && knowledge !== "disinterested";
      if (!showAllMechanics && !isActive) return;

      const succRate = attempts > 0 ? success / attempts : 0;
      const succStr = succRate.toFixed(2);

      linesM.push(
        `${label}: knowledge=${knowledge} seen=${seen} inter=${interactions} att=${attempts} suc=${success} fail=${failure} dis=${dismiss} rate=${succStr} first=${turnStr(mc.firstSeenTurn)} last=${turnStr(mc.lastUsedTurn)}`
      );
    }
    pushMech("fishing", "Fishing");
    pushMech("lockpicking", "Lockpicking");
    pushMech("questBoard", "Quest Board");
    pushMech("followers", "Followers");
    _mechEl.textContent = linesM.length ? linesM.join("\n") : "No active mechanics yet.";
  }

  if (_intentsEl) {
    const intentHistory = Array.isArray(debug.intentHistory) ? debug.intentHistory : null;
    if (!intentHistory || !intentHistory.length) {
      _intentsEl.textContent = "GM intents (latest first; 'none' = decision)\n  No GM intents yet.";
    } else {
      const intentLines = [];
      intentLines.push("GM intents (latest first; 'none' = decision)");
      const maxIntents = Math.min(intentHistory.length, 10);
      for (let i = 0; i < maxIntents; i++) {
        const it = intentHistory[i];
        if (!it || typeof it !== "object") continue;
        const turn = typeof it.turn === "number" ? (it.turn | 0) : "?";
        let kindPart = it.kind || "none";
        if (it.topic) kindPart += `:${it.topic}`;
        if (it.target) kindPart += `:${it.target}`;
        if (it.id) kindPart += `:${it.id}`;
        const gmMood = gm.mood && typeof gm.mood === "object" ? gm.mood : null;
        const moodLabel =
          typeof it.mood === "string" && it.mood
            ? it.mood
            : gmMood && typeof gmMood.primary === "string" && gmMood.primary
            ? gmMood.primary
            : "?";
        const boredomValue =
          typeof it.boredom === "number" && Number.isFinite(it.boredom)
            ? it.boredom.toFixed(2)
            : typeof gm.boredom === "object" && typeof gm.boredom.level === "number" && Number.isFinite(gm.boredom.level)
            ? gm.boredom.level.toFixed(2)
            : "?";
        let row = `  [T ${turn}] ${kindPart}`;
        row += formatIntentDebugExtras(it);
        row += `  mood=${moodLabel} boredom=${boredomValue}`;
        intentLines.push(row);
      }
      _intentsEl.textContent = intentLines.join("\n");
    }
  }

  const evBuf = Array.isArray(debug.lastEvents) ? debug.lastEvents : [];
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

  if (_rawJsonEl && isSectionExpanded("raw")) {
    try {
      _rawJsonEl.textContent = JSON.stringify(gm, null, 2);
    } catch (_) {
      _rawJsonEl.textContent = "(raw GM JSON unavailable)";
    }
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
