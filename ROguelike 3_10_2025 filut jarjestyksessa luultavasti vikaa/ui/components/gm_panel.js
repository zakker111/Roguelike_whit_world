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

let _panelEl = null;
let _summaryEl = null;
let _statsEl = null;
let _profileEl = null;
let _traitsEl = null;
let _moodEl = null;
let _mechEl = null;
let _intentsEl = null;
let _eventsEl = null;
let _toggleBtn = null;
let _open = false;
let _refreshTimer = null;

const MAX_EVENTS = 20;

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

  const actionsWrap = document.createElement("div");
  actionsWrap.style.display = "flex";
  actionsWrap.style.alignItems = "center";
  actionsWrap.style.gap = "4px";

  _toggleBtn = document.createElement("button");
  _toggleBtn.type = "button";
  _toggleBtn.className = "gm-panel-toggle";
  _toggleBtn.textContent = "Toggle GM";
  _toggleBtn.style.background = "transparent";
  _toggleBtn.style.border = "1px solid #4b5563";
  _toggleBtn.style.borderRadius = "999px";
  _toggleBtn.style.color = "#e5e7eb";
  _toggleBtn.style.cursor = "pointer";
  _toggleBtn.style.fontSize = "10px";
  _toggleBtn.style.lineHeight = "1";
  _toggleBtn.style.padding = "2px 6px";
  _toggleBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    toggleGMEnabled();
  });

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

  actionsWrap.appendChild(_toggleBtn);
  actionsWrap.appendChild(closeBtn);

  header.appendChild(titleWrap);
  header.appendChild(actionsWrap);

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

  const profileLabel = document.createElement("div");
  profileLabel.textContent = "Profile";
  profileLabel.style.fontSize = "11px";
  profileLabel.style.textTransform = "uppercase";
  profileLabel.style.letterSpacing = "0.05em";
  profileLabel.style.color = "#9ca3af";
  profileLabel.style.marginTop = "4px";
  body.appendChild(profileLabel);

  _profileEl = document.createElement("div");
  _profileEl.className = "gm-panel-profile";
  _profileEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _profileEl.style.fontSize = "11px";
  _profileEl.style.whiteSpace = "pre-wrap";
  _profileEl.style.background = "#020617";
  _profileEl.style.borderRadius = "6px";
  _profileEl.style.border = "1px solid #1f2937";
  _profileEl.style.padding = "6px 8px";
  body.appendChild(_profileEl);

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

  const moodLabel = document.createElement("div");
  moodLabel.textContent = "Mood";
  moodLabel.style.fontSize = "11px";
  moodLabel.style.textTransform = "uppercase";
  moodLabel.style.letterSpacing = "0.05em";
  moodLabel.style.color = "#9ca3af";
  moodLabel.style.marginTop = "4px";
  body.appendChild(moodLabel);

  _moodEl = document.createElement("div");
  _moodEl.className = "gm-panel-mood";
  _moodEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _moodEl.style.fontSize = "11px";
  _moodEl.style.whiteSpace = "pre-wrap";
  _moodEl.style.background = "#020617";
  _moodEl.style.borderRadius = "6px";
  _moodEl.style.border = "1px solid #1f2937";
  _moodEl.style.padding = "6px 8px";
  body.appendChild(_moodEl);

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

  const intentsLabel = document.createElement("div");
  intentsLabel.textContent = "GM intents";
  intentsLabel.style.fontSize = "11px";
  intentsLabel.style.textTransform = "uppercase";
  intentsLabel.style.letterSpacing = "0.05em";
  intentsLabel.style.color = "#9ca3af";
  intentsLabel.style.marginTop = "4px";
  body.appendChild(intentsLabel);

  _intentsEl = document.createElement("div");
  _intentsEl.className = "gm-panel-intents";
  _intentsEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  _intentsEl.style.fontSize = "11px";
  _intentsEl.style.whiteSpace = "pre-wrap";
  _intentsEl.style.background = "#020617";
  _intentsEl.style.borderRadius = "6px";
  _intentsEl.style.border = "1px solid #1f2937";
  _intentsEl.style.padding = "6px 8px";
  _intentsEl.style.maxHeight = "160px";
  _intentsEl.style.overflowY = "auto";
  body.appendChild(_intentsEl);

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
    if (_profileEl) _profileEl.textContent = "";
    if (_traitsEl) _traitsEl.textContent = "";
    if (_moodEl) {
      _moodEl.textContent = "mood: (no data)\nvalence:  [........]\narousal:  [----------]";
    }
    if (_mechEl) _mechEl.textContent = "";
    if (_intentsEl) _intentsEl.textContent = "GM intents (latest first; 'none' = decision)\n  No GM intents yet.";
    _eventsEl.textContent = "No GM events (GMRuntime not available).";
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

  if (_toggleBtn) {
    _toggleBtn.textContent = enabled ? "Disable GM" : "Enable GM";
    _toggleBtn.disabled = false;
  }

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

  if (_profileEl) {
    const linesProfile = [];
    linesProfile.push(`  boredom: ${boredomLevel.toFixed(2)}`);

    const modeTurnsProfile = stats.modeTurns && typeof stats.modeTurns === "object" ? stats.modeTurns : {};
    const mtEntriesProfile = Object.keys(modeTurnsProfile).map((k) => [k, modeTurnsProfile[k] | 0]);
    if (mtEntriesProfile.length) {
      mtEntriesProfile.sort((a, b) => b[1] - a[1]);
      linesProfile.push("  top modes:");
      mtEntriesProfile.slice(0, 3).forEach(([key, val]) => {
        linesProfile.push(`    - ${key}: ${val}`);
      });
    }

    const familiesProfile = gm.families && typeof gm.families === "object" ? gm.families : {};
    const famRows = [];
    const famKeysProfile = Object.keys(familiesProfile);
    for (let i = 0; i < famKeysProfile.length; i++) {
      const key = famKeysProfile[i];
      const entry = familiesProfile[key];
      if (!entry || typeof entry !== "object") continue;
      const seen = entry.seen | 0;
      if (seen < 1) continue;
      const pos = entry.positive | 0;
      const neg = entry.negative | 0;
      const denom = pos + neg;
      let score = 0;
      if (denom > 0) {
        score = (pos - neg) / denom;
      }
      famRows.push({ key, seen, score });
    }
    if (famRows.length) {
      famRows.sort((a, b) => {
        if (b.seen !== a.seen) return b.seen - a.seen;
        if (b.score !== a.score) return b.score - a.score;
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
      });
      const topFamilies = famRows.slice(0, 3);
      linesProfile.push("  top families:");
      for (let i = 0; i < topFamilies.length; i++) {
        const f = topFamilies[i];
        const scoreStr = f.score.toFixed(2);
        linesProfile.push(`    - ${f.key}:  seen=${f.seen} score=${scoreStr}`);
      }
    }

    const traitLines = [];
    const traits = gm.traits && typeof gm.traits === "object" ? gm.traits : null;
    const TRAIT_MIN_SAMPLES_PROFILE = 3;
    const TRAIT_MIN_SCORE_PROFILE = 0.4;

    function addTraitSummary(key, label) {
      if (!traits) return;
      const tr = traits[key];
      if (!tr) return;
      const seen = tr.seen | 0;
      const pos = tr.positive | 0;
      const neg = tr.negative | 0;
      const samples = pos + neg;
      if (seen < TRAIT_MIN_SAMPLES_PROFILE) return;
      if (samples <= 0) return;
      const score = (pos - neg) / samples;
      if (Math.abs(score) < TRAIT_MIN_SCORE_PROFILE) return;
      traitLines.push(`    - ${label} (${score.toFixed(2)})`);
    }

    addTraitSummary("trollSlayer", "Troll Slayer");
    addTraitSummary("townProtector", "Town Protector");
    addTraitSummary("caravanAlly", "Caravan Ally");

    if (traitLines.length) {
      linesProfile.push("  traits:");
      for (let i = 0; i < traitLines.length; i++) {
        linesProfile.push(traitLines[i]);
      }
    }

    _profileEl.textContent = linesProfile.join("\n");
  }

  if (_traitsEl) {
    const t = gm.traits || {};
    const linesT = [];
    const dbg = gm.debug && typeof gm.debug === "object" ? gm.debug : {};
    const currentTurn = typeof dbg.lastTickTurn === "number" ? (dbg.lastTickTurn | 0) : null;
    const TRAIT_MIN_SAMPLES = 3; // minimum relevant events (kills/quests) before we treat this as an active trait
    const TRAIT_MIN_SCORE = 0.4; // how strongly skewed pos vs neg must be
    const TRAIT_FORGET_TURNS = 300; // after this many turns without updates, trait is considered forgotten

    const families = gm.families && typeof gm.families === "object" ? gm.families : {};
    const FAMILY_MIN_SEEN = 3; // minimum interactions with a family before we surface it
    const FAMILY_FORGET_TURNS = 300; // same forgetting window as named traits
    const FAMILY_MAX_ROWS = 6; // cap rows to keep panel compact

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
      if (seen < FAMILY_MIN_SEEN) continue;

      const lastTurn = entry.lastUpdatedTurn == null ? null : (entry.lastUpdatedTurn | 0);
      let remembered = true;
      if (currentTurn != null && lastTurn != null) {
        const delta = currentTurn - lastTurn;
        if (delta > FAMILY_FORGET_TURNS) remembered = false;
      }
      if (!remembered) continue;

      const samples = pos + neg;
      let score = 0;
      if (samples > 0) {
        score = (pos - neg) / samples;
      }
      famEntries.push({ key, seen, pos, neg, score });
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
        linesT.push(`${famName} ${role}: seen=${f.seen} pos=${f.pos} neg=${f.neg} score=${scoreStr}`);
      }
    }

    if (!linesT.length) {
      _traitsEl.textContent = "No active traits yet.";
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
