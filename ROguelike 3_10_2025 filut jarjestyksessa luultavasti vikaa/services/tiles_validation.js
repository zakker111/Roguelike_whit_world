/**
 * TilesValidation: runtime tiles.json usage tracker and HUD diagnostics.
 *
 * Exports (ESM + window.TilesValidation):
 * - recordMap(ctx): scan current ctx.map once and track tile ids by mode
 * - getIssues(): returns summary { missingDef, missingFill, missingWalkable, missingBlocksFOV } per mode
 * - getHUDLines(): short lines suitable for a small on-screen HUD
 * - updateHUD(ctx): render/hide the small HUD based on DEV flag and current issues
 */

const STATE = {
  scannedMaps: new WeakSet(),
  usage: {
    overworld: new Map(),
    region: new Map(),
    dungeon: new Map(),
    town: new Map(),
  },
  lastTilesRef: null,
  lastIssues: null,
  hudEl: null,
};

function modeKey(ctxMode) {
  const m = String(ctxMode || "").toLowerCase();
  return m === "world" ? "overworld" : m;
}

function getTilesJSON() {
  try {
    return (typeof window !== "undefined" && window.GameData && window.GameData.tiles) ? window.GameData.tiles : null;
  } catch (_) { return null; }
}

function findTileDef(tiles, mode, id) {
  if (!tiles || !Array.isArray(tiles.tiles)) return null;
  const list = tiles.tiles;
  const m = String(mode || "").toLowerCase();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if ((t.id | 0) === (id | 0) && Array.isArray(t.appearsIn) && t.appearsIn.some(s => String(s).toLowerCase() === m)) {
      return t;
    }
  }
  return null;
}

function collectUsage(mode, map) {
  if (!Array.isArray(map) || !map.length) return;
  const key = modeKey(mode);
  const u = STATE.usage[key] || new Map();
  const rows = map.length;
  const cols = map[0] ? map[0].length : 0;
  for (let y = 0; y < rows; y++) {
    const row = map[y];
    for (let x = 0; x < cols; x++) {
      const id = row[x] | 0;
      u.set(id, (u.get(id) || 0) + 1);
    }
  }
  STATE.usage[key] = u;
}

function computeIssues() {
  const tiles = getTilesJSON();
  const tilesRef = tiles;
  const issues = { overworld: {}, region: {}, dungeon: {}, town: {} };

  function pushIssue(bucket, id) {
    bucket.add(id);
  }

  function evaluateMode(mode) {
    const used = STATE.usage[mode] || new Map();
    const missingDef = new Set();
    const missingFill = new Set();
    const missingWalkable = new Set();
    const missingBlocksFOV = new Set();

    for (const id of used.keys()) {
      const td = findTileDef(tiles, mode, id);
      if (!td) {
        pushIssue(missingDef, id);
        continue;
      }
      const colors = td.colors || {};
      const props = td.properties || {};
      if (!colors.fill) pushIssue(missingFill, id);
      // Walkable needed for movement modes (overworld, dungeon, town, region cursor)
      if (typeof props.walkable !== "boolean") pushIssue(missingWalkable, id);
      // blocksFOV needed for LOS modes (dungeon, town, region)
      if (mode !== "overworld" && typeof props.blocksFOV !== "boolean") pushIssue(missingBlocksFOV, id);
    }

    return {
      missingDef: Array.from(missingDef).sort((a, b) => a - b),
      missingFill: Array.from(missingFill).sort((a, b) => a - b),
      missingWalkable: Array.from(missingWalkable).sort((a, b) => a - b),
      missingBlocksFOV: Array.from(missingBlocksFOV).sort((a, b) => a - b),
    };
  }

  issues.overworld = evaluateMode("overworld");
  issues.region = evaluateMode("region");
  issues.dungeon = evaluateMode("dungeon");
  issues.town = evaluateMode("town");

  STATE.lastIssues = issues;
  STATE.lastTilesRef = tilesRef;
  return issues;
}

function ensureHUD() {
  if (STATE.hudEl) return STATE.hudEl;
  try {
    const el = document.createElement("div");
    el.id = "tiles-hud";
    el.style.position = "fixed";
    el.style.left = "8px";
    el.style.top = "56px";
    el.style.zIndex = "40000";
    el.style.background = "rgba(20,24,33,0.92)";
    el.style.border = "1px solid rgba(122,162,247,0.35)";
    el.style.borderRadius = "6px";
    el.style.padding = "6px 8px";
    el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
    el.style.color = "#cbd5e1";
    el.style.fontSize = "12px";
    el.style.maxWidth = "420px";
    el.style.pointerEvents = "none";
    el.hidden = true;
    document.body.appendChild(el);
    STATE.hudEl = el;
  } catch (_) {}
  return STATE.hudEl;
}

function formatList(arr) {
  if (!Array.isArray(arr) || !arr.length) return "none";
  const show = arr.slice(0, 6).join(", ");
  if (arr.length > 6) return `${show}, …`;
  return show;
}

export const TilesValidation = {
  recordMap(ctx) {
    if (!ctx || !Array.isArray(ctx.map)) return;
    const map = ctx.map;
    if (STATE.scannedMaps.has(map)) return;
    STATE.scannedMaps.add(map);

    const m = modeKey(ctx.mode);
    collectUsage(m, map);
    // Recompute issues when tiles.json changed reference or the first time
    try {
      const tilesRef = getTilesJSON();
      if (!STATE.lastIssues || tilesRef !== STATE.lastTilesRef) {
        computeIssues();
      }
    } catch (_) {}
    // Update HUD opportunistically
    this.updateHUD(ctx);
  },

  getIssues() {
    if (!STATE.lastIssues) computeIssues();
    return STATE.lastIssues;
  },

  getHUDLines() {
    const iss = this.getIssues();
    const lines = [];
    function addMode(mode, tag) {
      const m = iss[mode];
      const total =
        m.missingDef.length +
        m.missingFill.length +
        m.missingWalkable.length +
        m.missingBlocksFOV.length;
      if (total === 0) return;
      lines.push(`${tag}: ${total} issue(s)`);
      if (m.missingDef.length) lines.push(`- missing def: ${formatList(m.missingDef)}`);
      if (m.missingFill.length) lines.push(`- missing colors.fill: ${formatList(m.missingFill)}`);
      if (m.missingWalkable.length) lines.push(`- missing walkable: ${formatList(m.missingWalkable)}`);
      if (m.missingBlocksFOV.length) lines.push(`- missing blocksFOV: ${formatList(m.missingBlocksFOV)}`);
    }
    addMode("overworld", "Overworld");
    addMode("region", "Region");
    addMode("dungeon", "Dungeon");
    addMode("town", "Town");
    return lines;
  },

  updateHUD(ctx) {
    const el = ensureHUD();
    if (!el) return;
    const dev = !!(typeof window !== "undefined" && (window.DEV || localStorage.getItem("DEV") === "1"));
    const lines = this.getHUDLines();
    const hasIssues = Array.isArray(lines) && lines.length > 0;
    if (!dev || !hasIssues) {
      el.hidden = true;
      return;
    }
    const html = lines.map(s => `<div>${s}</div>`).join("");
    if (html !== TilesValidation._lastHTML) {
      el.innerHTML = html;
      TilesValidation._lastHTML = html;
    }
    el.hidden = false;
  },
};

// Back-compat
if (typeof window !== "undefined") {
  window.TilesValidation = TilesValidation;
}